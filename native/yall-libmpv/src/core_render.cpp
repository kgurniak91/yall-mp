// Render side of MpvCore: attach/detach, resize, slot release, stats, and the N-API frame delivery.
#include <algorithm>
#include "core.h"
#include "render/sw_readback.h"
#ifdef _WIN32
#include "render/d3d11_readback.h"
#include "render/d3d11_shared.h"
#endif
#ifdef __APPLE__
#include "render/iosurface_shared.h"
#endif

Napi::Error MakeCodedError(Napi::Env env, const char* code, const std::string& message) {
  Napi::Error e = Napi::Error::New(env, message);
  e.Set("code", Napi::String::New(env, code));
  return e;
}

namespace {

constexpr int kDefaultSlots = 4;
constexpr int kDefaultSlotTimeoutMs = 3000;
constexpr int kMaxSlots = 8;

// State of one attach's frame TSFN. Owned by the TSFN (deleted by its finalizer on the JS thread).
struct FrameCtx {
  Napi::FunctionReference callback;
  std::atomic<int> outstanding{0};
};

struct FrameMsg {
  Frame frame;
  bool readback = false;
};

void FrameCallJs(Napi::Env env, Napi::Function, FrameCtx* ctx, FrameMsg* rawMsg) {
  std::unique_ptr<FrameMsg> msg(rawMsg);
  if (ctx && msg->readback) ctx->outstanding--;
  if (env == nullptr || ctx == nullptr || ctx->callback.IsEmpty()) return;

  try {
    const Frame& f = msg->frame;
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("attachId", Napi::Number::New(env, static_cast<double>(f.attachId)));
    obj.Set("slotId", Napi::Number::New(env, f.slotId));
    obj.Set("serial", Napi::Number::New(env, static_cast<double>(f.serial)));
    obj.Set("generation", Napi::Number::New(env, f.generation));
    obj.Set("width", Napi::Number::New(env, f.width));
    obj.Set("height", Napi::Number::New(env, f.height));
    if (f.pixels) {
      // Electron's V8 memory cage forbids external ArrayBuffers, so the bytes have to be copied.
      obj.Set("pixels", Napi::Buffer<uint8_t>::Copy(env, f.pixels->data(), f.pixels->size()));
    } else {
      uint64_t handle = f.handle;
      obj.Set("handle", Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<uint8_t*>(&handle), sizeof(handle)));
    }
    ctx->callback.Call({obj});
  } catch (const Napi::Error& e) {
    napi_fatal_exception(env, e.Value());
  }
}

using FrameTsfn = Napi::TypedThreadSafeFunction<FrameCtx, FrameMsg, &FrameCallJs>;

class TsfnFrameSink : public FrameSink {
 public:
  TsfnFrameSink(FrameTsfn tsfn, FrameCtx* ctx) : tsfn_(tsfn), ctx_(ctx) {}

  bool Post(Frame&& frame) override {
    auto* msg = new FrameMsg();
    msg->readback = frame.pixels != nullptr;
    msg->frame = std::move(frame);
    if (msg->readback) ctx_->outstanding++;
    if (tsfn_.NonBlockingCall(msg) != napi_ok) {
      if (msg->readback) ctx_->outstanding--;
      delete msg;
      return false;
    }
    return true;
  }

  int Outstanding() override { return ctx_->outstanding.load(); }

  void Close() override {
    if (closed_) return;
    closed_ = true;
    tsfn_.Release();
  }

 private:
  FrameTsfn tsfn_;
  FrameCtx* ctx_;  // valid until Close(): the finalizer runs only after the TSFN is released
  bool closed_ = false;
};

bool GetInt(Napi::Object o, const char* key, int& out) {
  Napi::Value v = o.Get(key);
  if (!v.IsNumber()) return false;
  out = v.As<Napi::Number>().Int32Value();
  return true;
}

Napi::Object AdapterToJs(Napi::Env env, const AdapterInfo& a) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("name", a.name);
  o.Set("vendorId", Napi::Number::New(env, a.vendorId));
  o.Set("deviceId", Napi::Number::New(env, a.deviceId));
  o.Set("luid", std::to_string(a.luidHigh) + ":" + std::to_string(a.luidLow));
  o.Set("software", Napi::Boolean::New(env, a.software));
  o.Set("matched", Napi::Boolean::New(env, a.matched));
  o.Set("selection", a.selection);
  return o;
}

Napi::Object PercentilesToJs(Napi::Env env, const PercentileStats& p) {
  Napi::Object o = Napi::Object::New(env);
  o.Set("p50", Napi::Number::New(env, p.p50));
  o.Set("p95", Napi::Number::New(env, p.p95));
  o.Set("max", Napi::Number::New(env, p.max));
  return o;
}

Napi::Object StatsToJs(Napi::Env env, const RenderThreadStats& s, size_t draining) {
  const BackendStats& b = s.backend;
  Napi::Object o = Napi::Object::New(env);
  o.Set("attachId", Napi::Number::New(env, static_cast<double>(s.attachId)));
  o.Set("backend", b.backend);
  o.Set("impl", b.impl);
  o.Set("gpuWaitImpl", b.gpuWaitImpl);
  o.Set("adapter", AdapterToJs(env, b.adapter));
  o.Set("width", Napi::Number::New(env, s.width));
  o.Set("height", Napi::Number::New(env, s.height));
  o.Set("generation", Napi::Number::New(env, s.generation));
  o.Set("poolSize", Napi::Number::New(env, b.poolSize));
  o.Set("inFlight", Napi::Number::New(env, b.inFlight));
  o.Set("rendered", Napi::Number::New(env, static_cast<double>(b.rendered)));
  o.Set("exhausted", Napi::Number::New(env, static_cast<double>(b.exhausted)));
  o.Set("released", Napi::Number::New(env, static_cast<double>(b.released)));
  o.Set("lateReleases", Napi::Number::New(env, static_cast<double>(b.lateReleases)));
  o.Set("reclaimed", Napi::Number::New(env, static_cast<double>(b.reclaimed)));
  o.Set("gpuWaitTimeouts", Napi::Number::New(env, static_cast<double>(b.gpuWaitTimeouts)));
  o.Set("readbackDropped", Napi::Number::New(env, static_cast<double>(s.readbackDropped)));
  o.Set("postFailures", Napi::Number::New(env, static_cast<double>(s.postFailures)));
  o.Set("renderMs", PercentilesToJs(env, b.renderMs));
  o.Set("gpuWaitMs", PercentilesToJs(env, b.gpuWaitMs));
  o.Set("releaseMs", PercentilesToJs(env, b.releaseMs));
  o.Set("copyMs", PercentilesToJs(env, b.copyMs));
  o.Set("renderCpuMs", Napi::Number::New(env, b.renderCpuMs));
  o.Set("waitCpuMs", Napi::Number::New(env, b.waitCpuMs));
  o.Set("threadCpuMs", Napi::Number::New(env, s.threadCpuMs));
  o.Set("threadWallMs", Napi::Number::New(env, s.threadWallMs));
  o.Set("draining", Napi::Number::New(env, static_cast<double>(draining)));
  o.Set("glErrors", Napi::Number::New(env, static_cast<double>(b.glErrors)));
  o.Set("note", b.note);
  return o;
}

}  // namespace

void MpvCore::DetachAllRenderers() {
  for (const auto& r : renderers_) r->Detach();
  currentRenderer_.reset();
}

void MpvCore::ReapRenderers() {
  auto finished = [](const std::shared_ptr<RenderThread>& r) { return r->Finished(); };
  for (auto& r : renderers_) {
    if (finished(r)) r->Join();
  }
  renderers_.erase(std::remove_if(renderers_.begin(), renderers_.end(), finished), renderers_.end());
}

void MpvCore::ForceStopRenderers() {
  for (const auto& r : renderers_) r->Detach();
  for (const auto& r : renderers_) {
    r->ForceDrainEnd();
    r->Join();
  }
  renderers_.clear();
  currentRenderer_.reset();
}

// attachRenderer({backend, width, height, slots?, slotTimeoutMs?, impl?, adapter?}, onFrame(frame))
//   backend: 'd3d11-shared' (Windows) | 'iosurface-shared' (macOS) | 'readback'; impl (readback only): 'd3d11' | 'sw'
//   adapter: 'default' | 'warp' | {vendorId, deviceId}
// Returns {attachId, backend, impl, adapter}.
Napi::Value MpvCore::AttachRenderer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (destroyed_) throw MakeCodedError(env, "DESTROYED", "destroyed");
  if (!initialized_) throw MakeCodedError(env, "UNINITIALIZED", "attachRenderer() needs an initialized core");
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    throw Napi::TypeError::New(env, "attachRenderer(options, onFrame)");
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  Napi::Function onFrame = info[1].As<Napi::Function>();

  std::string backendName = opts.Get("backend").IsString() ? opts.Get("backend").As<Napi::String>().Utf8Value() : "";
  if (backendName != "d3d11-shared" && backendName != "iosurface-shared" && backendName != "readback") {
    throw Napi::TypeError::New(env, "backend must be 'd3d11-shared', 'iosurface-shared' or 'readback'");
  }
  int width = 0, height = 0;
  if (!GetInt(opts, "width", width) || !GetInt(opts, "height", height) || width <= 0 || height <= 0) {
    throw Napi::TypeError::New(env, "width and height must be positive integers");
  }
  int slots = kDefaultSlots;
  int slotTimeoutMs = kDefaultSlotTimeoutMs;
  GetInt(opts, "slots", slots);
  GetInt(opts, "slotTimeoutMs", slotTimeoutMs);
  slots = std::max(1, std::min(slots, kMaxSlots));
  slotTimeoutMs = std::max(50, slotTimeoutMs);

  std::string impl = opts.Get("impl").IsString() ? opts.Get("impl").As<Napi::String>().Utf8Value() : "";
  const bool d3d11Capable = MpvApiVersion() >= MPV_MAKE_VERSION(2, 6);

  std::unique_ptr<RenderBackend> backend;
#ifdef _WIN32
  if (backendName == "iosurface-shared") {
    throw MakeCodedError(env, "BACKEND_UNSUPPORTED", "the iosurface-shared backend is only available on macOS");
  }
  AdapterRequest adapter;
  Napi::Value adapterOpt = opts.Get("adapter");
  if (adapterOpt.IsString()) {
    std::string mode = adapterOpt.As<Napi::String>().Utf8Value();
    if (mode == "warp") adapter.mode = AdapterRequest::Mode::Warp;
  } else if (adapterOpt.IsObject()) {
    Napi::Object a = adapterOpt.As<Napi::Object>();
    int vendor = 0, device = 0;
    if (GetInt(a, "vendorId", vendor) && GetInt(a, "deviceId", device)) {
      adapter.mode = AdapterRequest::Mode::Match;
      adapter.vendorId = static_cast<uint32_t>(vendor);
      adapter.deviceId = static_cast<uint32_t>(device);
    }
  }

  const bool wantD3d11 = backendName == "d3d11-shared" || impl == "d3d11" || (impl.empty() && d3d11Capable);
  if (wantD3d11 && !d3d11Capable) {
    unsigned long v = MpvApiVersion();
    throw MakeCodedError(env, "LIB_TOO_OLD",
                         "libmpv has client API " + std::to_string(v >> 16) + "." + std::to_string(v & 0xFFFF) +
                             "; Y'ALL MP needs 2.6+ for D3D11 rendering");
  }
  if (backendName == "d3d11-shared") {
    backend = std::make_unique<D3D11SharedBackend>(adapter, slots);
  } else if (wantD3d11) {
    backend = std::make_unique<D3D11ReadbackBackend>(adapter);
  } else {
    backend = std::make_unique<SwReadbackBackend>();
  }
#else
  (void)d3d11Capable;
  if (backendName == "d3d11-shared") {
    throw MakeCodedError(env, "BACKEND_UNSUPPORTED", "the d3d11-shared backend is only available on Windows");
  }
#ifdef __APPLE__
  if (backendName == "iosurface-shared") {
    backend = std::make_unique<IOSurfaceSharedBackend>(slots);
  } else {
    backend = std::make_unique<SwReadbackBackend>();
  }
#else
  if (backendName == "iosurface-shared") {
    throw MakeCodedError(env, "BACKEND_UNSUPPORTED", "the iosurface-shared backend is only available on macOS");
  }
  backend = std::make_unique<SwReadbackBackend>();
#endif
#endif

  // Only one render context may exist per core: wait for the previous attach to free its own (short).
  ReapRenderers();
  if (currentRenderer_) {
    auto previous = currentRenderer_;
    previous->Detach();
    currentRenderer_.reset();
    if (!previous->WaitContextFreed(5000)) {
      throw MakeCodedError(env, "DETACH_TIMEOUT", "the previous renderer did not release its render context");
    }
  }

  auto* ctx = new FrameCtx();
  ctx->callback = Napi::Persistent(onFrame);
  FrameTsfn tsfn = FrameTsfn::New(env, "yall-libmpv-frames", 0, 1, ctx,
                                  [](Napi::Env, FrameCtx* data, FrameCtx*) { delete data; }, ctx);
  tsfn.Unref(env);  // frames never keep Node alive on their own

  uint64_t attachId = nextAttachId_++;
  auto renderer = std::make_shared<RenderThread>(attachId, std::move(backend),
                                                 std::make_unique<TsfnFrameSink>(tsfn, ctx), width, height,
                                                 slotTimeoutMs);
  std::string err = renderer->Start(handle_);
  if (!err.empty()) {
    renderer.reset();  // closes the sink, which lets the TSFN finalize
    throw MakeCodedError(env, "RENDER_INIT_FAILED", err);
  }
  renderers_.push_back(renderer);
  currentRenderer_ = renderer;

  RenderThreadStats stats = renderer->Stats();
  Napi::Object result = Napi::Object::New(env);
  result.Set("attachId", Napi::Number::New(env, static_cast<double>(attachId)));
  result.Set("backend", stats.backend.backend);
  result.Set("impl", stats.backend.impl);
  result.Set("gpuWaitImpl", stats.backend.gpuWaitImpl);
  result.Set("adapter", AdapterToJs(env, stats.backend.adapter));
  return result;
}

Napi::Value MpvCore::Resize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) throw Napi::TypeError::New(env, "resize(w, h)");
  int w = info[0].As<Napi::Number>().Int32Value();
  int h = info[1].As<Napi::Number>().Int32Value();
  if (w <= 0 || h <= 0) throw Napi::TypeError::New(env, "resize: width and height must be positive");
  if (currentRenderer_) currentRenderer_->Resize(w, h);
  return env.Undefined();
}

// releaseSlot(attachId, slotId, serial): also valid for a detached attach that is still draining.
// Unknown or stale ids are ignored (counted by the backend when the attach is known).
Napi::Value MpvCore::ReleaseSlot(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
    throw Napi::TypeError::New(env, "releaseSlot(attachId, slotId, serial)");
  }
  uint64_t attachId = static_cast<uint64_t>(info[0].As<Napi::Number>().DoubleValue());
  int slotId = info[1].As<Napi::Number>().Int32Value();
  uint64_t serial = static_cast<uint64_t>(info[2].As<Napi::Number>().DoubleValue());
  for (const auto& r : renderers_) {
    if (r->AttachId() == attachId) {
      r->Release(slotId, serial);
      break;
    }
  }
  return env.Undefined();
}

Napi::Value MpvCore::DetachRenderer(const Napi::CallbackInfo& info) {
  DetachAllRenderers();
  return info.Env().Undefined();
}

// stats() -> stats of the current attach (plus the number of detached ones still draining), or null.
Napi::Value MpvCore::Stats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  ReapRenderers();
  if (!currentRenderer_) return env.Null();
  return StatsToJs(env, currentRenderer_->Stats(), renderers_.size() - 1);
}
