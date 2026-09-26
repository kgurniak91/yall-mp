// Y'ALL Media Player - macOS native video surface.
//
// Why this exists: mpv has no `--wid` support on macOS, so a separate mpv
// process can never draw inside an Electron window there. Instead we load
// libmpv into the Electron main process, put an NSOpenGLView into the window
// underneath Chromium's web view, and let libmpv paint into it through the
// mpv render API. Playback control stays on mpv's JSON IPC socket
// (`input-ipc-server`), so the rest of the application is unchanged.
//
// The NSOpenGLView setup, the software fallback and the view/thread teardown
// order follow IPTVnator's embedded_mpv.mm (MIT License, Copyright (c)
// IPTVnator contributors), reduced to what Y'ALL MP needs. Rendering here is
// driven directly by mpv's update callback rather than a CVDisplayLink.
//
// Thread model:
//   - N-API entry points run on the Electron main thread (== AppKit main thread).
//   - libmpv calls the update callback from its own threads; we only flag and
//     dispatch to a serial render queue from there.
//   - One event thread drains mpv events (shutdown + log lines).

#include <napi.h>

#define GL_SILENCE_DEPRECATION 1

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl3.h>
#import <QuartzCore/QuartzCore.h>

#include <dlfcn.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

// ISC-licensed client API headers vendored under vendor/mpv (see README.md).
#include "mpv/client.h"
#include "mpv/render.h"
#include "mpv/render_gl.h"

// ---------------------------------------------------------------------------
// libmpv loaded at runtime.
//
// The add-on is NOT linked against libmpv. Every function is resolved with
// dlsym so that (a) the add-on builds without mpv installed, (b) a missing
// libmpv turns into a readable error instead of a dyld crash, and (c) the
// library location can come from settings.
// ---------------------------------------------------------------------------

namespace {

struct LibMpv {
    void* dl = nullptr;
    std::string path;

    decltype(&mpv_client_api_version) client_api_version = nullptr;
    decltype(&mpv_create) create = nullptr;
    decltype(&mpv_initialize) initialize = nullptr;
    decltype(&mpv_terminate_destroy) terminate_destroy = nullptr;
    decltype(&mpv_set_option_string) set_option_string = nullptr;
    decltype(&mpv_wait_event) wait_event = nullptr;
    decltype(&mpv_wakeup) wakeup = nullptr;
    decltype(&mpv_error_string) error_string = nullptr;
    decltype(&mpv_request_log_messages) request_log_messages = nullptr;
    decltype(&mpv_render_context_create) render_context_create = nullptr;
    decltype(&mpv_render_context_free) render_context_free = nullptr;
    decltype(&mpv_render_context_set_update_callback) render_context_set_update_callback = nullptr;
    decltype(&mpv_render_context_update) render_context_update = nullptr;
    decltype(&mpv_render_context_render) render_context_render = nullptr;
    decltype(&mpv_render_context_report_swap) render_context_report_swap = nullptr;
};

LibMpv gLib;
std::mutex gLibMutex;

std::vector<std::string> libmpvCandidates(const std::string& preferred)
{
    std::vector<std::string> candidates;
    if (!preferred.empty()) {
        candidates.push_back(preferred);
    }
    if (const char* env = std::getenv("YALL_LIBMPV_PATH")) {
        if (env[0] != '\0') {
            candidates.emplace_back(env);
        }
    }
    // Homebrew on Apple silicon, Homebrew on Intel, MacPorts, then dyld search.
    candidates.emplace_back("/opt/homebrew/lib/libmpv.2.dylib");
    candidates.emplace_back("/usr/local/lib/libmpv.2.dylib");
    candidates.emplace_back("/opt/local/lib/libmpv.2.dylib");
    candidates.emplace_back("libmpv.2.dylib");
    candidates.emplace_back("libmpv.dylib");
    return candidates;
}

template <typename Fn>
bool resolveSymbol(void* dl, const char* name, Fn& target, std::string& missing)
{
    void* symbol = dlsym(dl, name);
    if (!symbol) {
        if (!missing.empty()) {
            missing += ", ";
        }
        missing += name;
        return false;
    }
    target = reinterpret_cast<Fn>(symbol);
    return true;
}

// Loads libmpv once per process. Returns an empty string on success, or the
// reason it could not be loaded.
std::string ensureLibMpv(const std::string& preferred)
{
    std::lock_guard<std::mutex> lock(gLibMutex);
    if (gLib.dl) {
        return "";
    }

    std::string lastError;
    for (const auto& candidate : libmpvCandidates(preferred)) {
        void* dl = dlopen(candidate.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (!dl) {
            const char* reason = dlerror();
            lastError = candidate + ": " + (reason ? reason : "dlopen failed");
            continue;
        }

        LibMpv lib;
        lib.dl = dl;
        lib.path = candidate;
        std::string missing;
        resolveSymbol(dl, "mpv_client_api_version", lib.client_api_version, missing);
        resolveSymbol(dl, "mpv_create", lib.create, missing);
        resolveSymbol(dl, "mpv_initialize", lib.initialize, missing);
        resolveSymbol(dl, "mpv_terminate_destroy", lib.terminate_destroy, missing);
        resolveSymbol(dl, "mpv_set_option_string", lib.set_option_string, missing);
        resolveSymbol(dl, "mpv_wait_event", lib.wait_event, missing);
        resolveSymbol(dl, "mpv_wakeup", lib.wakeup, missing);
        resolveSymbol(dl, "mpv_error_string", lib.error_string, missing);
        resolveSymbol(dl, "mpv_request_log_messages", lib.request_log_messages, missing);
        resolveSymbol(dl, "mpv_render_context_create", lib.render_context_create, missing);
        resolveSymbol(dl, "mpv_render_context_free", lib.render_context_free, missing);
        resolveSymbol(dl, "mpv_render_context_set_update_callback", lib.render_context_set_update_callback, missing);
        resolveSymbol(dl, "mpv_render_context_update", lib.render_context_update, missing);
        resolveSymbol(dl, "mpv_render_context_render", lib.render_context_render, missing);
        resolveSymbol(dl, "mpv_render_context_report_swap", lib.render_context_report_swap, missing);

        if (!missing.empty()) {
            lastError = candidate + ": missing symbols: " + missing;
            dlclose(dl);
            continue;
        }

        gLib = lib;
        return "";
    }

    return lastError.empty() ? "libmpv not found" : lastError;
}

std::string mpvErrorText(int code)
{
    return gLib.error_string ? gLib.error_string(code) : std::to_string(code);
}

} // namespace

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

// Opaque black view that fills the Electron content view. It takes the place
// of the black "mainWindow" used on Windows: whatever the UI page leaves
// transparent shows this view (or the video view inside it), never the desktop.
// Flipped so that child frames use Electron's top-left coordinate system.
@interface YallMpvBaseView : NSView
@end

@implementation YallMpvBaseView
- (BOOL)isFlipped
{
    return YES;
}

- (BOOL)isOpaque
{
    return YES;
}

// Never take mouse events away from Chromium's view above us.
- (NSView*)hitTest:(NSPoint)point
{
    return nil;
}
@end

@interface YallMpvGLView : NSOpenGLView
@property (nonatomic, assign) std::atomic<bool>* backingChangedFlag;
@end

@implementation YallMpvGLView
- (NSView*)hitTest:(NSPoint)point
{
    return nil;
}

- (BOOL)isOpaque
{
    return YES;
}

// AppKit calls -update when the drawable moves or resizes. Rendering happens on
// another thread, so the CGL context must be locked around it.
- (void)update
{
    CGLContextObj cgl = [[self openGLContext] CGLContextObj];
    if (cgl) {
        CGLLockContext(cgl);
    }
    [super update];
    if (cgl) {
        CGLUnlockContext(cgl);
    }
}

- (void)viewDidChangeBackingProperties
{
    [super viewDidChangeBackingProperties];
    if (self.backingChangedFlag) {
        self.backingChangedFlag->store(true);
    }
}

// The frame is drawn from the render queue; AppKit itself has nothing to paint.
- (void)drawRect:(NSRect)dirtyRect
{
}
@end

@interface YallMpvSoftwareView : NSView
@end

@implementation YallMpvSoftwareView
- (NSView*)hitTest:(NSPoint)point
{
    return nil;
}

- (BOOL)isOpaque
{
    return YES;
}
@end

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

namespace {

enum class Renderer {
    OpenGL,
    Software,
};

struct EventPayload {
    std::string type;    // "shutdown" | "log" | "render-error" | "client-message"
    std::string level;   // log level for "log"
    std::string prefix;  // log prefix for "log"
    std::string text;
};

struct Session {
    uint32_t id = 0;
    mpv_handle* mpv = nullptr;
    mpv_render_context* renderContext = nullptr;

    NSView* __strong hostView = nil;
    YallMpvBaseView* __strong baseView = nil;
    NSView* __strong videoView = nil;
    NSOpenGLPixelFormat* __strong glPixelFormat = nil;
    NSOpenGLContext* __strong glContext = nil;

    dispatch_queue_t renderQueue = nullptr;
    std::thread eventThread;
    std::atomic<bool> running{false};
    std::atomic<bool> renderScheduled{false};
    std::atomic<bool> backingChanged{false};
    // Set when the surface changed (frame, visibility, scale): redraw the
    // current frame even if mpv has no new one, e.g. a resize while paused.
    std::atomic<bool> redrawRequested{false};
    std::atomic<uint64_t> renderedFrames{0};
    std::atomic<uint64_t> renderErrors{0};

    // Render failures are recorded here and reported by the event thread,
    // which is the only thread allowed to use the JS callback.
    std::mutex renderErrorMutex;
    std::string pendingRenderError;

    std::mutex metricsMutex;
    int widthPixels = 0;
    int heightPixels = 0;
    double contentsScale = 1.0;

    Renderer renderer = Renderer::OpenGL;
    std::vector<uint8_t> softwareBuffer;

    std::weak_ptr<Session>* callbackContext = nullptr;

    Napi::ThreadSafeFunction eventCallback;
    bool hasEventCallback = false;
    std::atomic<bool> eventCallbackReleased{false};
};

std::mutex gSessionsMutex;
std::unordered_map<uint32_t, std::shared_ptr<Session>> gSessions;
std::atomic<uint32_t> gNextSessionId{1};

std::shared_ptr<Session> findSession(uint32_t id)
{
    std::lock_guard<std::mutex> lock(gSessionsMutex);
    const auto it = gSessions.find(id);
    return it == gSessions.end() ? nullptr : it->second;
}

void runOnMainSync(dispatch_block_t block)
{
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

void emitEvent(const std::shared_ptr<Session>& session, EventPayload payload)
{
    if (!session->hasEventCallback || session->eventCallbackReleased.load()) {
        return;
    }
    auto* data = new EventPayload(std::move(payload));
    const napi_status status = session->eventCallback.NonBlockingCall(
        data,
        [](Napi::Env env, Napi::Function callback, EventPayload* payload) {
            Napi::Object event = Napi::Object::New(env);
            event.Set("type", payload->type);
            if (!payload->level.empty()) {
                event.Set("level", payload->level);
            }
            if (!payload->prefix.empty()) {
                event.Set("prefix", payload->prefix);
            }
            event.Set("text", payload->text);
            callback.Call({event});
            delete payload;
        }
    );
    if (status != napi_ok) {
        delete data;
    }
}

void recordRenderError(const std::shared_ptr<Session>& session, const std::string& text)
{
    if (session->renderErrors.fetch_add(1) != 0) {
        return; // report the first failure only; later ones are the same story
    }
    std::lock_guard<std::mutex> lock(session->renderErrorMutex);
    session->pendingRenderError = text;
}

// --- geometry -------------------------------------------------------------

// Main thread only.
void refreshMetricsOnMain(const std::shared_ptr<Session>& session)
{
    if (!session->videoView) {
        return;
    }
    const NSSize backing = [session->videoView convertSizeToBacking:session->videoView.bounds.size];
    const double scale = session->videoView.window
        ? session->videoView.window.backingScaleFactor
        : NSScreen.mainScreen.backingScaleFactor;

    std::lock_guard<std::mutex> lock(session->metricsMutex);
    session->widthPixels = std::max(0, static_cast<int>(std::lround(backing.width)));
    session->heightPixels = std::max(0, static_cast<int>(std::lround(backing.height)));
    session->contentsScale = scale > 0 ? scale : 1.0;
}

void scheduleRender(const std::shared_ptr<Session>& session);

// Safe from any thread. Never blocks on the main thread: the main thread may
// itself be waiting on the render queue (dispatch_sync in freeRenderContext),
// so a dispatch_sync from the render queue to main would deadlock.
void refreshMetricsAsync(const std::shared_ptr<Session>& session)
{
    if ([NSThread isMainThread]) {
        refreshMetricsOnMain(session);
        return;
    }
    // Blocks capture C++ references by reference, not by value: `session` is
    // the caller's variable and may be gone when the block runs. Copy it.
    std::shared_ptr<Session> keep = session;
    dispatch_async(dispatch_get_main_queue(), ^{
        refreshMetricsOnMain(keep);
        keep->redrawRequested.store(true);
        scheduleRender(keep);
    });
}

// --- rendering ------------------------------------------------------------

void renderOpenGL(const std::shared_ptr<Session>& session)
{
    if (!session->renderContext || !session->glContext) {
        return;
    }

    int width = 0;
    int height = 0;
    {
        std::lock_guard<std::mutex> lock(session->metricsMutex);
        width = session->widthPixels;
        height = session->heightPixels;
    }

    CGLContextObj cgl = [session->glContext CGLContextObj];
    if (!cgl) {
        return;
    }

    CGLLockContext(cgl);
    [session->glContext makeCurrentContext];

    const bool redraw = session->redrawRequested.exchange(false);
    const uint64_t flags = gLib.render_context_update(session->renderContext);
    if (((flags & MPV_RENDER_UPDATE_FRAME) == 0 && !redraw) || width <= 0 || height <= 0) {
        CGLUnlockContext(cgl);
        return;
    }

    glViewport(0, 0, width, height);

    mpv_opengl_fbo fbo = {0, width, height, 0};
    int flipY = 1;
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
        {MPV_RENDER_PARAM_FLIP_Y, &flipY},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };

    const int result = gLib.render_context_render(session->renderContext, params);
    if (result < 0) {
        CGLUnlockContext(cgl);
        recordRenderError(session, "OpenGL render failed: " + mpvErrorText(result));
        return;
    }

    [session->glContext flushBuffer];
    gLib.render_context_report_swap(session->renderContext);
    CGLUnlockContext(cgl);
    session->renderedFrames.fetch_add(1);
}

void renderSoftware(const std::shared_ptr<Session>& session)
{
    if (!session->renderContext) {
        return;
    }

    int width = 0;
    int height = 0;
    double scale = 1.0;
    {
        std::lock_guard<std::mutex> lock(session->metricsMutex);
        width = session->widthPixels;
        height = session->heightPixels;
        scale = session->contentsScale;
    }

    const bool redraw = session->redrawRequested.exchange(false);
    const uint64_t flags = gLib.render_context_update(session->renderContext);
    if (((flags & MPV_RENDER_UPDATE_FRAME) == 0 && !redraw) || width <= 0 || height <= 0) {
        return;
    }

    const size_t stride = ((static_cast<size_t>(width) * 4) + 63) & ~static_cast<size_t>(63);
    const size_t byteCount = stride * static_cast<size_t>(height);
    if (session->softwareBuffer.size() != byteCount) {
        session->softwareBuffer.assign(byteCount, 0);
    }

    int size[] = {width, height};
    size_t strideValue = stride;
    char format[] = "bgr0";
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_SW_SIZE, size},
        {MPV_RENDER_PARAM_SW_FORMAT, format},
        {MPV_RENDER_PARAM_SW_STRIDE, &strideValue},
        {MPV_RENDER_PARAM_SW_POINTER, session->softwareBuffer.data()},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };

    const int result = gLib.render_context_render(session->renderContext, params);
    if (result < 0) {
        recordRenderError(session, "Software render failed: " + mpvErrorText(result));
        return;
    }

    CFDataRef data = CFDataCreate(kCFAllocatorDefault, session->softwareBuffer.data(), static_cast<CFIndex>(byteCount));
    if (!data) {
        return;
    }
    CGDataProviderRef provider = CGDataProviderCreateWithCFData(data);
    CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
    CGImageRef image = CGImageCreate(
        static_cast<size_t>(width),
        static_cast<size_t>(height),
        8,
        32,
        stride,
        colorSpace,
        static_cast<CGBitmapInfo>(kCGBitmapByteOrder32Little | kCGImageAlphaNoneSkipFirst),
        provider,
        nullptr,
        false,
        kCGRenderingIntentDefault
    );
    CGColorSpaceRelease(colorSpace);
    CGDataProviderRelease(provider);
    CFRelease(data);
    if (!image) {
        return;
    }

    id frame = CFBridgingRelease(image);
    std::shared_ptr<Session> keep = session; // see refreshMetricsAsync
    dispatch_async(dispatch_get_main_queue(), ^{
        if (!keep->videoView || !keep->videoView.layer) {
            return;
        }
        keep->videoView.layer.contents = frame;
        keep->videoView.layer.contentsScale = scale;
        keep->videoView.layer.contentsGravity = kCAGravityResize;
    });
    session->renderedFrames.fetch_add(1);
}

void scheduleRender(const std::shared_ptr<Session>& session)
{
    if (!session->renderQueue || !session->running.load()) {
        return;
    }
    if (session->renderScheduled.exchange(true)) {
        return;
    }
    std::shared_ptr<Session> keep = session; // see refreshMetricsAsync
    dispatch_async(session->renderQueue, ^{
        // Clear the flag before rendering so an update that arrives while we
        // draw schedules one more pass instead of being lost.
        keep->renderScheduled.store(false);
        if (!keep->running.load()) {
            return;
        }
        if (keep->backingChanged.exchange(false)) {
            // Display scale changed (window moved to another screen). Refresh
            // on main and redraw; this frame still uses the previous size.
            refreshMetricsAsync(keep);
        }
        if (keep->renderer == Renderer::OpenGL) {
            renderOpenGL(keep);
        } else {
            renderSoftware(keep);
        }
    });
}

void onMpvRenderUpdate(void* context)
{
    auto* weak = static_cast<std::weak_ptr<Session>*>(context);
    if (!weak) {
        return;
    }
    if (const auto session = weak->lock()) {
        scheduleRender(session);
    }
}

// --- mpv event thread ------------------------------------------------------

void runEventLoop(std::shared_ptr<Session> session)
{
    while (session->running.load()) {
        mpv_event* event = gLib.wait_event(session->mpv, 0.25);

        {
            std::string renderError;
            {
                std::lock_guard<std::mutex> lock(session->renderErrorMutex);
                renderError.swap(session->pendingRenderError);
            }
            if (!renderError.empty()) {
                emitEvent(session, {"render-error", "", "", renderError});
            }
        }

        if (!event || event->event_id == MPV_EVENT_NONE) {
            continue;
        }
        if (event->event_id == MPV_EVENT_SHUTDOWN) {
            session->running.store(false);
            emitEvent(session, {"shutdown", "", "", "mpv core shut down"});
            break;
        }
        if (event->event_id == MPV_EVENT_LOG_MESSAGE) {
            auto* msg = static_cast<mpv_event_log_message*>(event->data);
            std::string text = msg->text ? msg->text : "";
            while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) {
                text.pop_back();
            }
            emitEvent(session, {"log", msg->level ? msg->level : "", msg->prefix ? msg->prefix : "", text});
        }
        if (event->event_id == MPV_EVENT_CLIENT_MESSAGE) {
            // `script-message <args...>` from key bindings (media keys); args joined by newlines.
            auto* msg = static_cast<mpv_event_client_message*>(event->data);
            std::string text;
            for (int i = 0; i < msg->num_args; ++i) {
                if (i > 0) {
                    text += '\n';
                }
                text += msg->args[i] ? msg->args[i] : "";
            }
            emitEvent(session, {"client-message", "", "", text});
        }
    }

    if (session->hasEventCallback && !session->eventCallbackReleased.exchange(true)) {
        session->eventCallback.Release();
    }
}

// --- view creation ---------------------------------------------------------

// One base view per Electron window, shared by successive mpv sessions so the
// video area never flashes the desktop between projects. Keyed by the content
// view pointer; the entry lives until detachBaseView() or process exit.
std::mutex gBaseViewsMutex;
std::unordered_map<void*, YallMpvBaseView*> gBaseViews;

NSView* resolveHostView(NSView* view)
{
    return [view window] ? [[view window] contentView] : view;
}

// Main thread only. Creates the base view on first use.
YallMpvBaseView* ensureBaseView(NSView* host, bool above)
{
    void* key = (__bridge void*)host;
    {
        std::lock_guard<std::mutex> lock(gBaseViewsMutex);
        const auto it = gBaseViews.find(key);
        if (it != gBaseViews.end() && it->second.superview == host) {
            return it->second;
        }
    }

    YallMpvBaseView* base = [[YallMpvBaseView alloc] initWithFrame:host.bounds];
    base.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    base.wantsLayer = YES;
    base.layer.backgroundColor = NSColor.blackColor.CGColor;
    [host addSubview:base positioned:(above ? NSWindowAbove : NSWindowBelow) relativeTo:nil];

    std::lock_guard<std::mutex> lock(gBaseViewsMutex);
    gBaseViews[key] = base;
    return base;
}

void detachBaseView(NSView* host)
{
    void* key = (__bridge void*)host;
    YallMpvBaseView* base = nil;
    {
        std::lock_guard<std::mutex> lock(gBaseViewsMutex);
        const auto it = gBaseViews.find(key);
        if (it == gBaseViews.end()) {
            return;
        }
        base = it->second;
        gBaseViews.erase(it);
    }
    [base removeFromSuperview];
}

bool createBaseView(const std::shared_ptr<Session>& session, bool above)
{
    __block bool created = false;
    runOnMainSync(^{
        NSView* host = session->hostView;
        if (!host) {
            return;
        }
        session->baseView = ensureBaseView(host, above);
        created = session->baseView != nil;
    });
    return created;
}

bool createOpenGLView(const std::shared_ptr<Session>& session)
{
    __block bool created = false;
    runOnMainSync(^{
        NSOpenGLPixelFormatAttribute attributes[] = {
            NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core,
            NSOpenGLPFAAccelerated,
            NSOpenGLPFADoubleBuffer,
            NSOpenGLPFAColorSize, 24,
            NSOpenGLPFAAlphaSize, 8,
            NSOpenGLPFAAllowOfflineRenderers,
            0,
        };
        NSOpenGLPixelFormat* pixelFormat = [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
        if (!pixelFormat) {
            return;
        }
        YallMpvGLView* view = [[YallMpvGLView alloc] initWithFrame:NSMakeRect(0, 0, 0, 0) pixelFormat:pixelFormat];
        if (!view) {
            return;
        }
        view.backingChangedFlag = &session->backingChanged;
        [view setWantsBestResolutionOpenGLSurface:YES];
        NSOpenGLContext* context = [view openGLContext];
        if (!context) {
            return;
        }
        GLint swapInterval = 1;
        [context setValues:&swapInterval forParameter:NSOpenGLContextParameterSwapInterval];
        [session->baseView addSubview:view];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        // NSOpenGLView attaches its context itself once it is in a window; the
        // explicit call only makes the drawable valid immediately.
        [context setView:view];
#pragma clang diagnostic pop

        session->glPixelFormat = pixelFormat;
        session->glContext = context;
        session->videoView = view;
        created = true;
    });
    return created;
}

bool createSoftwareView(const std::shared_ptr<Session>& session)
{
    __block bool created = false;
    runOnMainSync(^{
        YallMpvSoftwareView* view = [[YallMpvSoftwareView alloc] initWithFrame:NSMakeRect(0, 0, 0, 0)];
        view.wantsLayer = YES;
        view.layer.backgroundColor = NSColor.blackColor.CGColor;
        view.layer.contentsGravity = kCAGravityResize;
        [session->baseView addSubview:view];
        session->videoView = view;
        created = true;
    });
    return created;
}

void removeVideoView(const std::shared_ptr<Session>& session)
{
    runOnMainSync(^{
        if (session->videoView) {
            [session->videoView removeFromSuperview];
            session->videoView = nil;
        }
        session->glContext = nil;
        session->glPixelFormat = nil;
    });
}

int createOpenGLRenderContext(const std::shared_ptr<Session>& session)
{
    __block int result = MPV_ERROR_UNSUPPORTED;
    dispatch_sync(session->renderQueue, ^{
        CGLContextObj cgl = [session->glContext CGLContextObj];
        if (!cgl) {
            return;
        }
        CGLLockContext(cgl);
        [session->glContext makeCurrentContext];

        mpv_opengl_init_params glInit = {
            [](void*, const char* name) -> void* { return dlsym(RTLD_DEFAULT, name); },
            nullptr,
        };
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_OPENGL},
            {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
            {MPV_RENDER_PARAM_INVALID, nullptr},
        };
        result = gLib.render_context_create(&session->renderContext, session->mpv, params);

        [NSOpenGLContext clearCurrentContext];
        CGLUnlockContext(cgl);
    });
    return result;
}

int createSoftwareRenderContext(const std::shared_ptr<Session>& session)
{
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_API_TYPE, (void*)MPV_RENDER_API_TYPE_SW},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };
    return gLib.render_context_create(&session->renderContext, session->mpv, params);
}

void freeRenderContext(const std::shared_ptr<Session>& session)
{
    if (!session->renderQueue) {
        return;
    }
    dispatch_sync(session->renderQueue, ^{
        if (!session->renderContext) {
            return;
        }
        CGLContextObj cgl = session->glContext ? [session->glContext CGLContextObj] : nullptr;
        if (cgl) {
            CGLLockContext(cgl);
            [session->glContext makeCurrentContext];
        }
        gLib.render_context_set_update_callback(session->renderContext, nullptr, nullptr);
        gLib.render_context_free(session->renderContext);
        session->renderContext = nullptr;
        if (cgl) {
            [NSOpenGLContext clearCurrentContext];
            CGLUnlockContext(cgl);
        }
    });
}

// --- teardown --------------------------------------------------------------

void destroySession(const std::shared_ptr<Session>& session)
{
    session->running.store(false);

    // 1. Stop the event thread (mpv_terminate_destroy must not race mpv_wait_event).
    if (session->mpv) {
        gLib.wakeup(session->mpv);
    }
    if (session->eventThread.joinable()) {
        session->eventThread.join();
    }
    if (session->hasEventCallback && !session->eventCallbackReleased.exchange(true)) {
        session->eventCallback.Release();
    }

    // 2. Free the render context on the render thread with the GL context current.
    freeRenderContext(session);

    // 3. Shut the core down.
    if (session->mpv) {
        gLib.terminate_destroy(session->mpv);
        session->mpv = nullptr;
    }

    if (session->callbackContext) {
        delete session->callbackContext;
        session->callbackContext = nullptr;
    }

    // 4. Remove the video view. The black base view stays with the window.
    runOnMainSync(^{
        if (session->videoView) {
            [session->videoView removeFromSuperview];
            session->videoView = nil;
        }
        session->baseView = nil;
        session->glContext = nil;
        session->glPixelFormat = nil;
        session->hostView = nil;
    });
}

// ---------------------------------------------------------------------------
// N-API surface
// ---------------------------------------------------------------------------

std::string optionalString(const Napi::Object& object, const char* key)
{
    if (!object.Has(key)) {
        return "";
    }
    const Napi::Value value = object.Get(key);
    return value.IsString() ? value.As<Napi::String>().Utf8Value() : "";
}

NSView* hostViewFromArg(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsBuffer()) {
        throw Napi::TypeError::New(info.Env(), "Expected the Buffer from BrowserWindow.getNativeWindowHandle().");
    }
    const auto handleBuffer = info[0].As<Napi::Buffer<uint8_t>>();
    if (handleBuffer.Length() < sizeof(uintptr_t)) {
        throw Napi::Error::New(info.Env(), "Native window handle buffer is too small.");
    }
    uintptr_t handleValue = 0;
    std::memcpy(&handleValue, handleBuffer.Data(), sizeof(uintptr_t));
    NSView* view = (__bridge NSView*)reinterpret_cast<void*>(handleValue);
    if (!view) {
        throw Napi::Error::New(info.Env(), "Could not resolve the Electron window's NSView.");
    }
    return resolveHostView(view);
}

// probe(libmpvPath?) -> { ok, path?, apiVersion?, error? }
Napi::Value Probe(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    const std::string preferred = info.Length() > 0 && info[0].IsString()
        ? info[0].As<Napi::String>().Utf8Value()
        : "";

    Napi::Object result = Napi::Object::New(env);
    const std::string error = ensureLibMpv(preferred);
    if (!error.empty()) {
        result.Set("ok", false);
        result.Set("error", error);
        return result;
    }

    const unsigned long version = gLib.client_api_version();
    result.Set("ok", true);
    result.Set("path", gLib.path);
    result.Set("apiVersion", std::to_string(version >> 16) + "." + std::to_string(version & 0xffff));
    return result;
}

// create(windowHandle: Buffer, options: {
//   libmpvPath?: string,
//   options?: [name, value][],   // applied with mpv_set_option_string before mpv_initialize
//   position?: 'below' | 'above', // where the video sits relative to the web view (default 'below')
//   renderer?: 'gl' | 'sw',       // default 'gl' with automatic fallback to 'sw'
//   logLevel?: string,            // mpv_request_log_messages level (default 'warn')
//   onEvent?: (event) => void     // { type: 'shutdown' | 'log' | 'render-error', ... }
// }) -> id
Napi::Value Create(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    NSView* hostView = hostViewFromArg(info);

    Napi::Object options = info.Length() > 1 && info[1].IsObject()
        ? info[1].As<Napi::Object>()
        : Napi::Object::New(env);

    const std::string loadError = ensureLibMpv(optionalString(options, "libmpvPath"));
    if (!loadError.empty()) {
        throw Napi::Error::New(env, "libmpv could not be loaded: " + loadError);
    }

    auto session = std::make_shared<Session>();
    session->id = gNextSessionId.fetch_add(1);
    session->hostView = resolveHostView(hostView);
    session->renderQueue = dispatch_queue_create("com.yall-mp.mpv-embed.render", DISPATCH_QUEUE_SERIAL);

    const std::string rendererName = optionalString(options, "renderer");
    const char* envRenderer = std::getenv("YALL_MPV_RENDERER");
    const bool wantSoftware = rendererName == "sw" || (envRenderer && std::string(envRenderer) == "sw");
    session->renderer = wantSoftware ? Renderer::Software : Renderer::OpenGL;

    if (options.Has("onEvent") && options.Get("onEvent").IsFunction()) {
        session->eventCallback = Napi::ThreadSafeFunction::New(
            env,
            options.Get("onEvent").As<Napi::Function>(),
            "yall-mpv-embed-events",
            0,
            1
        );
        session->hasEventCallback = true;
    }

    const bool above = optionalString(options, "position") == "above";
    if (!createBaseView(session, above)) {
        destroySession(session);
        throw Napi::Error::New(env, "Could not attach the video base view to the window.");
    }

    if (session->renderer == Renderer::OpenGL && !createOpenGLView(session)) {
        session->renderer = Renderer::Software;
    }
    if (session->renderer == Renderer::Software && !createSoftwareView(session)) {
        destroySession(session);
        throw Napi::Error::New(env, "Could not create the video view.");
    }

    session->mpv = gLib.create();
    if (!session->mpv) {
        destroySession(session);
        throw Napi::Error::New(env, "mpv_create failed.");
    }

    // Fixed options for the embedded case; the caller's list comes afterwards
    // and may override everything except the video output.
    gLib.set_option_string(session->mpv, "terminal", "no");
    gLib.set_option_string(session->mpv, "input-vo-keyboard", "no");
    gLib.set_option_string(session->mpv, "input-default-bindings", "no");

    std::vector<std::string> rejected;
    if (options.Has("options") && options.Get("options").IsArray()) {
        const Napi::Array list = options.Get("options").As<Napi::Array>();
        for (uint32_t i = 0; i < list.Length(); i++) {
            const Napi::Value entry = list.Get(i);
            if (!entry.IsArray()) {
                continue;
            }
            const Napi::Array pair = entry.As<Napi::Array>();
            if (pair.Length() < 2 || !pair.Get(0u).IsString()) {
                continue;
            }
            const std::string name = pair.Get(0u).As<Napi::String>().Utf8Value();
            const std::string value = pair.Get(1u).ToString().Utf8Value();
            if (name == "vo" || name == "wid") {
                continue;
            }
            const int status = gLib.set_option_string(session->mpv, name.c_str(), value.c_str());
            if (status < 0) {
                rejected.push_back(name + " (" + mpvErrorText(status) + ")");
            }
        }
    }

    gLib.set_option_string(session->mpv, "vo", "libmpv");

    std::string logLevel = optionalString(options, "logLevel");
    if (logLevel.empty()) {
        logLevel = "warn";
    }
    gLib.request_log_messages(session->mpv, logLevel.c_str());

    const int initResult = gLib.initialize(session->mpv);
    if (initResult < 0) {
        const std::string message = "mpv_initialize failed: " + mpvErrorText(initResult);
        destroySession(session);
        throw Napi::Error::New(env, message);
    }

    int renderResult = session->renderer == Renderer::OpenGL
        ? createOpenGLRenderContext(session)
        : createSoftwareRenderContext(session);

    if (renderResult < 0 && session->renderer == Renderer::OpenGL) {
        // OpenGL is deprecated on macOS; keep working if it ever goes away.
        removeVideoView(session);
        session->renderer = Renderer::Software;
        if (createSoftwareView(session)) {
            renderResult = createSoftwareRenderContext(session);
        }
    }
    if (renderResult < 0) {
        const std::string message = "mpv_render_context_create failed: " + mpvErrorText(renderResult);
        destroySession(session);
        throw Napi::Error::New(env, message);
    }

    session->callbackContext = new std::weak_ptr<Session>(session);
    session->running.store(true);
    gLib.render_context_set_update_callback(session->renderContext, onMpvRenderUpdate, session->callbackContext);
    session->eventThread = std::thread(runEventLoop, session);

    refreshMetricsAsync(session);

    {
        std::lock_guard<std::mutex> lock(gSessionsMutex);
        gSessions.emplace(session->id, session);
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("id", session->id);
    result.Set("renderer", session->renderer == Renderer::OpenGL ? "gl" : "sw");
    result.Set("libmpvPath", gLib.path);
    Napi::Array rejectedList = Napi::Array::New(env, rejected.size());
    for (size_t i = 0; i < rejected.size(); i++) {
        rejectedList.Set(static_cast<uint32_t>(i), rejected[i]);
    }
    result.Set("rejectedOptions", rejectedList);
    return result;
}

std::shared_ptr<Session> sessionFromArgs(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber()) {
        throw Napi::TypeError::New(info.Env(), "Expected a session id.");
    }
    return findSession(info[0].As<Napi::Number>().Uint32Value());
}

// setFrame(id, x, y, width, height) -- points, top-left origin, relative to the window's content area
Napi::Value SetFrame(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    auto session = sessionFromArgs(info);
    if (!session) {
        return env.Undefined();
    }
    if (info.Length() < 5) {
        throw Napi::TypeError::New(env, "setFrame(id, x, y, width, height)");
    }
    const double x = info[1].ToNumber().DoubleValue();
    const double y = info[2].ToNumber().DoubleValue();
    const double width = std::max(0.0, info[3].ToNumber().DoubleValue());
    const double height = std::max(0.0, info[4].ToNumber().DoubleValue());

    runOnMainSync(^{
        if (!session->videoView) {
            return;
        }
        [session->videoView setFrame:NSMakeRect(x, y, width, height)];
        if (session->glContext && [session->videoView isKindOfClass:[NSOpenGLView class]]) {
            [(NSOpenGLView*)session->videoView update];
        }
    });
    refreshMetricsAsync(session);
    session->redrawRequested.store(true);
    scheduleRender(session);
    return env.Undefined();
}

// setVisible(id, visible)
Napi::Value SetVisible(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    auto session = sessionFromArgs(info);
    if (!session) {
        return env.Undefined();
    }
    const bool visible = info.Length() > 1 && info[1].ToBoolean().Value();
    runOnMainSync(^{
        if (session->videoView) {
            session->videoView.hidden = !visible;
        }
    });
    if (visible) {
        session->redrawRequested.store(true);
        scheduleRender(session);
    }
    return env.Undefined();
}

// destroy(id)
Napi::Value Destroy(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    auto session = sessionFromArgs(info);
    if (!session) {
        return env.Undefined();
    }
    {
        std::lock_guard<std::mutex> lock(gSessionsMutex);
        gSessions.erase(session->id);
    }
    destroySession(session);
    return env.Undefined();
}

// stats(id) -> { renderer, renderedFrames, renderErrors, widthPixels, heightPixels, contentsScale }
Napi::Value Stats(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    auto session = sessionFromArgs(info);
    if (!session) {
        return env.Null();
    }
    Napi::Object result = Napi::Object::New(env);
    result.Set("renderer", session->renderer == Renderer::OpenGL ? "gl" : "sw");
    result.Set("renderedFrames", static_cast<double>(session->renderedFrames.load()));
    result.Set("renderErrors", static_cast<double>(session->renderErrors.load()));
    std::lock_guard<std::mutex> lock(session->metricsMutex);
    result.Set("widthPixels", session->widthPixels);
    result.Set("heightPixels", session->heightPixels);
    result.Set("contentsScale", session->contentsScale);
    return result;
}

// attach(windowHandle, position?) -- adds the black base view now, before any
// video session exists, so transparent page areas never show the desktop.
Napi::Value Attach(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    NSView* host = hostViewFromArg(info);
    const bool above = info.Length() > 1 && info[1].IsString() && info[1].As<Napi::String>().Utf8Value() == "above";
    runOnMainSync(^{
        ensureBaseView(host, above);
    });
    return env.Undefined();
}

// detach(windowHandle) -- removes the base view (video sessions must be destroyed first).
Napi::Value Detach(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    NSView* host = hostViewFromArg(info);
    runOnMainSync(^{
        detachBaseView(host);
    });
    return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("probe", Napi::Function::New(env, Probe));
    exports.Set("attach", Napi::Function::New(env, Attach));
    exports.Set("detach", Napi::Function::New(env, Detach));
    exports.Set("create", Napi::Function::New(env, Create));
    exports.Set("setFrame", Napi::Function::New(env, SetFrame));
    exports.Set("setVisible", Napi::Function::New(env, SetVisible));
    exports.Set("destroy", Napi::Function::New(env, Destroy));
    exports.Set("stats", Napi::Function::New(env, Stats));
    return exports;
}

} // namespace

NODE_API_MODULE(yall_mpv_embed, Init)
