#ifdef __APPLE__
#define GL_SILENCE_DEPRECATION
#include "iosurface_shared.h"
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOReturn.h>
#include <OpenGL/CGLIOSurface.h>
#include <OpenGL/CGLRenderers.h>
#include <OpenGL/gl3.h>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include "../live_counts.h"
#include "../thread_cpu.h"

#pragma clang diagnostic ignored "-Wdeprecated-declarations"

using Clock = std::chrono::steady_clock;

namespace {
constexpr size_t kMaxNotes = 24;
constexpr uint32_t kPixelFormatBGRA = 'BGRA';

double MsSince(Clock::time_point t) { return std::chrono::duration<double, std::milli>(Clock::now() - t).count(); }

void* GetProcAddress(void*, const char* name) {
  static CFBundleRef bundle = CFBundleGetBundleWithIdentifier(CFSTR("com.apple.opengl"));
  CFStringRef cfName = CFStringCreateWithCString(kCFAllocatorDefault, name, kCFStringEncodingASCII);
  void* fn = bundle ? CFBundleGetFunctionPointerForName(bundle, cfName) : nullptr;
  CFRelease(cfName);
  return fn;
}

const char* GlString(GLenum name) {
  const char* s = reinterpret_cast<const char*>(glGetString(name));
  return s ? s : "?";
}

bool Contains(const std::string& text, const char* part) { return text.find(part) != std::string::npos; }

void SetCfInt(CFMutableDictionaryRef dict, CFStringRef key, int32_t value) {
  CFNumberRef number = CFNumberCreate(kCFAllocatorDefault, kCFNumberSInt32Type, &value);
  CFDictionarySetValue(dict, key, number);
  CFRelease(number);
}
}  // namespace

bool IOSurfaceSharedBackend::MakeCurrent() {
  if (!ctx_) return false;
  if (CGLGetCurrentContext() == ctx_) return true;
  return CGLSetCurrentContext(ctx_) == kCGLNoError;
}

void IOSurfaceSharedBackend::Note(const std::string& text) {
  if (verbose_) std::fprintf(stderr, "[iosurface-shared] %s\n", text.c_str());
  if (notes_.size() < kMaxNotes) notes_.push_back(text);
}

void IOSurfaceSharedBackend::CheckGl(const char* where) {
  for (int i = 0; i < 8; i++) {
    GLenum e = glGetError();
    if (e == GL_NO_ERROR) return;
    glErrors_++;
    char buf[96];
    std::snprintf(buf, sizeof(buf), "glGetError 0x%04x after %s", static_cast<unsigned>(e), where);
    Note(buf);
  }
}

std::string IOSurfaceSharedBackend::Init(mpv_handle* handle) {
  verbose_ = std::getenv("YALL_MP_GL_DEBUG") != nullptr;

  // Hardware first, then Apple's software renderer (a VM or a CI runner without a GPU still has it).
  std::string attempts;
  bool software = false;
  for (int pass = 0; pass < 2 && !ctx_; pass++) {
    std::vector<CGLPixelFormatAttribute> attrs = {
        kCGLPFAOpenGLProfile, static_cast<CGLPixelFormatAttribute>(kCGLOGLPVersion_3_2_Core),
        kCGLPFAColorSize, static_cast<CGLPixelFormatAttribute>(24),
        kCGLPFAAlphaSize, static_cast<CGLPixelFormatAttribute>(8)};
    if (pass == 0) {
      attrs.push_back(kCGLPFAAccelerated);
      attrs.push_back(kCGLPFAAllowOfflineRenderers);
    } else {
      attrs.push_back(kCGLPFARendererID);
      attrs.push_back(static_cast<CGLPixelFormatAttribute>(kCGLRendererGenericFloatID));
    }
    attrs.push_back(static_cast<CGLPixelFormatAttribute>(0));

    const char* label = pass == 0 ? "accelerated" : "software";
    CGLPixelFormatObj pix = nullptr;
    GLint count = 0;
    CGLError err = CGLChoosePixelFormat(attrs.data(), &pix, &count);
    if (err != kCGLNoError || !pix) {
      attempts += std::string(label) + " pixel format: " + CGLErrorString(err) + "; ";
      continue;
    }
    err = CGLCreateContext(pix, nullptr, &ctx_);
    CGLDestroyPixelFormat(pix);
    if (err != kCGLNoError || !ctx_) {
      attempts += std::string(label) + " context: " + CGLErrorString(err) + "; ";
      ctx_ = nullptr;
      continue;
    }
    software = pass == 1;
  }
  if (!ctx_) return "no OpenGL 3.2 core context (" + attempts + ")";

  CGLError cerr = CGLSetCurrentContext(ctx_);
  if (cerr != kCGLNoError) return std::string("CGLSetCurrentContext: ") + CGLErrorString(cerr);
  // The render thread makes the context current for itself (OnThreadStart); never leave it bound to this thread.
  struct Unbind {
    ~Unbind() { CGLSetCurrentContext(nullptr); }
  } unbind;

  std::string renderer = GlString(GL_RENDERER);
  adapterInfo_.name = renderer;
  adapterInfo_.software = software || Contains(renderer, "Software") || Contains(renderer, "llvmpipe");
  adapterInfo_.selection = adapterInfo_.software ? "software" : "accelerated";
  // Apple's software renderer needs about a second per 1024x642 frame (hosted CI runner): the capped readback
  // path is far faster there, so leave the choice to the fallback unless a test asks for the GL path anyway.
  if (adapterInfo_.software && !std::getenv("YALL_MP_ALLOW_SOFTWARE_GL")) {
    return "OpenGL renderer is software (" + renderer + "), readback is faster";
  }
  Note(std::string("GL ") + GlString(GL_VERSION) + " | " + renderer + " | " + GlString(GL_VENDOR) +
       (attempts.empty() ? "" : " | earlier attempts: " + attempts));
  CheckGl("context creation");

  // Prove that an IOSurface-backed FBO works before mpv is involved, so a failure here becomes a clean fallback.
  {
    Slot probe;
    if (!CreateSlotTarget(probe, 16, 16)) {
      std::string detail;
      for (const std::string& n : notes_) detail += n + "; ";
      return "IOSurface render target unavailable (" + detail + ")";
    }
    DestroySlotTarget(probe);
  }

  mpv_opengl_init_params glInit{&GetProcAddress, nullptr};
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  int rc = mpv.render_context_create(&rc_, handle, params);
  CheckGl("mpv_render_context_create");
  if (rc < 0) return std::string("mpv_render_context_create: ") + mpv.error_string(rc);
  slots_.reserve(static_cast<size_t>(maxSlots_));
  return "";
}

void IOSurfaceSharedBackend::FreeContext() {
  if (!rc_) return;
  MakeCurrent();  // mpv deletes its GL objects here
  mpv.render_context_set_update_callback(rc_, nullptr, nullptr);
  mpv.render_context_free(rc_);
  rc_ = nullptr;
  CheckGl("mpv_render_context_free");
}

void IOSurfaceSharedBackend::OnThreadStart() {
  if (!MakeCurrent()) Note("could not make the GL context current on the render thread");
}

void IOSurfaceSharedBackend::OnThreadStop() { CGLSetCurrentContext(nullptr); }

bool IOSurfaceSharedBackend::CreateSlotTarget(Slot& s, int w, int h) {
  if (!MakeCurrent()) {
    Note("no current GL context for a render target");
    return false;
  }
  CFMutableDictionaryRef props = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks,
                                                           &kCFTypeDictionaryValueCallBacks);
  SetCfInt(props, kIOSurfaceWidth, w);
  SetCfInt(props, kIOSurfaceHeight, h);
  SetCfInt(props, kIOSurfaceBytesPerElement, 4);
  SetCfInt(props, kIOSurfacePixelFormat, static_cast<int32_t>(kPixelFormatBGRA));
  IOSurfaceRef surface = IOSurfaceCreate(props);
  CFRelease(props);
  if (!surface) {
    Note("IOSurfaceCreate failed for " + std::to_string(w) + "x" + std::to_string(h));
    return false;
  }

  GLuint texture = 0, fbo = 0;
  glGenTextures(1, &texture);
  glBindTexture(GL_TEXTURE_RECTANGLE, texture);
  CGLError err = CGLTexImageIOSurface2D(ctx_, GL_TEXTURE_RECTANGLE, GL_RGBA, w, h, GL_BGRA,
                                        GL_UNSIGNED_INT_8_8_8_8_REV, surface, 0);
  CheckGl("CGLTexImageIOSurface2D");
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_RECTANGLE, texture, 0);
  GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
  CheckGl("framebuffer setup");
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glBindTexture(GL_TEXTURE_RECTANGLE, 0);

  if (err != kCGLNoError || status != GL_FRAMEBUFFER_COMPLETE) {
    char buf[160];
    std::snprintf(buf, sizeof(buf), "render target %dx%d: CGLTexImageIOSurface2D=%s framebuffer status=0x%04x", w, h,
                  CGLErrorString(err), static_cast<unsigned>(status));
    Note(buf);
    glDeleteFramebuffers(1, &fbo);
    glDeleteTextures(1, &texture);
    CFRelease(surface);
    return false;
  }
  s.surface = surface;
  s.texture = texture;
  s.fbo = fbo;
  s.w = w;
  s.h = h;
  Counts().slots++;
  return true;
}

void IOSurfaceSharedBackend::DestroySlotTarget(Slot& s) {
  if (!s.surface && !s.texture && !s.fbo) return;
  if (MakeCurrent()) {
    if (s.fbo) glDeleteFramebuffers(1, &s.fbo);
    if (s.texture) glDeleteTextures(1, &s.texture);
  }
  if (s.surface) CFRelease(s.surface);
  s.surface = nullptr;
  s.texture = 0;
  s.fbo = 0;
  Counts().slots--;
}

int IOSurfaceSharedBackend::AcquireSlot(int w, int h, uint32_t gen) {
  for (size_t i = 0; i < slots_.size(); i++) {
    Slot& s = slots_[i];
    if (s.state != State::Free) continue;
    if (!s.surface || s.gen != gen || s.w != w || s.h != h) {
      DestroySlotTarget(s);
      if (!CreateSlotTarget(s, w, h)) continue;
      s.gen = gen;
    }
    return static_cast<int>(i);
  }
  if (static_cast<int>(slots_.size()) < maxSlots_) {
    slots_.emplace_back();
    Slot& s = slots_.back();
    if (!CreateSlotTarget(s, w, h)) {
      slots_.pop_back();
      return -1;
    }
    s.gen = gen;
    return static_cast<int>(slots_.size() - 1);
  }
  return -1;
}

bool IOSurfaceSharedBackend::Render(int w, int h, uint32_t gen, Frame& out) {
  int index;
  unsigned int fbo;
  IOSurfaceRef surface;
  {
    std::lock_guard<std::mutex> lock(mu_);
    MakeCurrent();
    index = AcquireSlot(w, h, gen);
    if (index < 0) {
      // Pool exhausted (or a target could not be created, see the notes): skip, the next update delivers a fresh one.
      exhausted_++;
      return false;
    }
    Slot& s = slots_[static_cast<size_t>(index)];
    s.state = State::Rendering;
    fbo = s.fbo;
    surface = s.surface;
  }

  auto t0 = Clock::now();
  double cpu0 = ThreadCpuMs();
  // Measured on a macOS runner: with FLIP_Y=1 the IOSurface came out upside down, mpv's default already
  // writes the first row at the top of the picture.
  mpv_opengl_fbo target{static_cast<int>(fbo), w, h, GL_RGBA8};
  int flipY = 0;
  mpv_render_param rp[] = {{MPV_RENDER_PARAM_OPENGL_FBO, &target},
                           {MPV_RENDER_PARAM_FLIP_Y, &flipY},
                           {MPV_RENDER_PARAM_INVALID, nullptr}};
  mpv.render_context_render(rc_, rp);
  double cpu1 = ThreadCpuMs();
  auto t1 = Clock::now();
  // The surface is read by another process (the GPU process): make sure every write has landed.
  glFinish();
  double cpu2 = ThreadCpuMs();
  auto t2 = Clock::now();

  std::lock_guard<std::mutex> lock(mu_);
  CheckGl("render");
  Slot& s = slots_[static_cast<size_t>(index)];
  if (probeFramesLeft_ > 0) {
    probeFramesLeft_--;
    const int xs[5] = {w / 2, w / 4, w * 3 / 4, w / 4, w * 3 / 4};
    const int ys[5] = {h / 2, h / 4, h / 4, h * 3 / 4, h * 3 / 4};
    glBindFramebuffer(GL_FRAMEBUFFER, s.fbo);
    while (glGetError() != GL_NO_ERROR) {
    }
    for (int i = 0; i < 5; i++) {
      glReadPixels(xs[i], ys[i], 1, 1, GL_BGRA, GL_UNSIGNED_INT_8_8_8_8_REV, out.probe + i * 4);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    out.hasProbe = glGetError() == GL_NO_ERROR;
  }
  renderCpuMs_ += cpu1 - cpu0;
  waitCpuMs_ += cpu2 - cpu1;
  s.state = State::InFlight;
  s.serial++;
  s.sentAt = Clock::now();
  rendered_++;
  renderMs_.Push(std::chrono::duration<double, std::milli>(t1 - t0).count());
  gpuWaitMs_.Push(std::chrono::duration<double, std::milli>(t2 - t1).count());

  out.slotId = index;
  out.serial = s.serial;
  out.generation = gen;
  out.width = w;
  out.height = h;
  out.handle = reinterpret_cast<uint64_t>(surface);
  return true;
}

void IOSurfaceSharedBackend::Release(int slotId, uint64_t serial) {
  std::lock_guard<std::mutex> lock(mu_);
  if (slotId < 0 || slotId >= static_cast<int>(slots_.size())) {
    lateReleases_++;
    return;
  }
  Slot& s = slots_[static_cast<size_t>(slotId)];
  if (s.state != State::InFlight || s.serial != serial) {
    lateReleases_++;
    return;
  }
  releaseMs_.Push(MsSince(s.sentAt));
  released_++;
  s.state = State::Free;
}

void IOSurfaceSharedBackend::ReclaimExpired(int timeoutMs) {
  std::lock_guard<std::mutex> lock(mu_);
  for (Slot& s : slots_) {
    if (s.state != State::InFlight || MsSince(s.sentAt) < timeoutMs) continue;
    // Never reuse a surface the consumer may still hold: drop our reference (the consumer keeps its own
    // after import) and recreate the slot on the next acquire. The serial bump makes a late release stale.
    DestroySlotTarget(s);
    s.serial++;
    s.state = State::Free;
    reclaimed_++;
  }
}

int IOSurfaceSharedBackend::InFlight() {
  std::lock_guard<std::mutex> lock(mu_);
  int n = 0;
  for (const Slot& s : slots_) {
    if (s.state == State::InFlight) n++;
  }
  return n;
}

void IOSurfaceSharedBackend::ReleaseAll() {
  {
    std::lock_guard<std::mutex> lock(mu_);
    if (ctx_) CGLSetCurrentContext(ctx_);
    for (Slot& s : slots_) DestroySlotTarget(s);
    slots_.clear();
  }
  if (ctx_) {
    CGLSetCurrentContext(nullptr);
    CGLDestroyContext(ctx_);
    ctx_ = nullptr;
  }
}

void IOSurfaceSharedBackend::FillStats(BackendStats& out) {
  std::lock_guard<std::mutex> lock(mu_);
  out.backend = "iosurface-shared";
  out.impl = "gl";
  out.gpuWaitImpl = "finish";
  out.adapter = adapterInfo_;
  out.poolSize = static_cast<int>(slots_.size());
  int inFlight = 0;
  for (const Slot& s : slots_) {
    if (s.state == State::InFlight) inFlight++;
  }
  out.inFlight = inFlight;
  out.rendered = rendered_;
  out.exhausted = exhausted_;
  out.released = released_;
  out.lateReleases = lateReleases_;
  out.reclaimed = reclaimed_;
  out.renderMs = Summarize(renderMs_);
  out.gpuWaitMs = Summarize(gpuWaitMs_);
  out.releaseMs = Summarize(releaseMs_);
  out.renderCpuMs = renderCpuMs_;
  out.waitCpuMs = waitCpuMs_;
  out.glErrors = glErrors_;
  std::ostringstream note;
  for (size_t i = 0; i < notes_.size(); i++) note << (i ? " | " : "") << notes_[i];
  out.note = note.str();
}

bool ReadIOSurfacePixel(uint64_t handle, int x, int y, uint8_t out[4]) {
  IOSurfaceRef surface = reinterpret_cast<IOSurfaceRef>(handle);
  if (!surface || x < 0 || y < 0) return false;
  if (static_cast<size_t>(x) >= IOSurfaceGetWidth(surface) || static_cast<size_t>(y) >= IOSurfaceGetHeight(surface)) {
    return false;
  }
  if (IOSurfaceLock(surface, kIOSurfaceLockReadOnly, nullptr) != kIOReturnSuccess) return false;
  const uint8_t* base = static_cast<const uint8_t*>(IOSurfaceGetBaseAddress(surface));
  const uint8_t* px = base + static_cast<size_t>(y) * IOSurfaceGetBytesPerRow(surface) + static_cast<size_t>(x) * 4;
  for (int i = 0; i < 4; i++) out[i] = px[i];
  IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, nullptr);
  return true;
}
#endif
