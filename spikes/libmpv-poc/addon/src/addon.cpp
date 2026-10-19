// Spike addon: libmpv client API + D3D11 shared-texture render backend exposed through N-API.
#include <napi.h>
#include <atomic>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include "d3d11_backend.h"
#include "mpv_loader.h"

namespace {

struct EventMsg {
  std::string event, name, data;
  int error = 0;
  int reason = -1;
};

mpv_handle* g_h = nullptr;
std::thread g_eventThread;
std::atomic<bool> g_stopEvents{false};
Napi::ThreadSafeFunction g_eventTsfn;
bool g_eventTsfnLive = false;

Napi::ThreadSafeFunction g_frameTsfn;
bool g_frameTsfnLive = false;
std::unique_ptr<D3D11Renderer> g_renderer;

std::wstring ToWide(const std::string& s) {
  if (s.empty()) return L"";
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  std::wstring w(n - 1, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
  return w;
}

void Throw(Napi::Env env, const std::string& msg) {
  Napi::Error::New(env, msg).ThrowAsJavaScriptException();
}

Napi::Value LoadMpvJs(const Napi::CallbackInfo& info) {
  std::string err = LoadMpv(ToWide(info[0].As<Napi::String>().Utf8Value()));
  if (!err.empty()) Throw(info.Env(), err);
  return info.Env().Undefined();
}

// create({ key: 'value', ... }): sets options before mpv_initialize.
Napi::Value Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_h) {
    Throw(env, "already created");
    return env.Undefined();
  }
  g_h = mpv.create();
  if (!g_h) {
    Throw(env, "mpv_create failed");
    return env.Undefined();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  Napi::Array keys = opts.GetPropertyNames();
  for (uint32_t i = 0; i < keys.Length(); i++) {
    std::string k = keys.Get(i).As<Napi::String>().Utf8Value();
    std::string v = opts.Get(k).ToString().Utf8Value();
    int rc = mpv.set_option_string(g_h, k.c_str(), v.c_str());
    if (rc < 0) {
      Throw(env, "option " + k + "=" + v + ": " + mpv.error_string(rc));
      return env.Undefined();
    }
  }
  int rc = mpv.initialize(g_h);
  if (rc < 0) Throw(env, std::string("mpv_initialize: ") + mpv.error_string(rc));
  return env.Undefined();
}

Napi::Value Command(const Napi::CallbackInfo& info) {
  Napi::Array a = info[0].As<Napi::Array>();
  std::vector<std::string> store;
  std::vector<const char*> argv;
  for (uint32_t i = 0; i < a.Length(); i++) store.push_back(a.Get(i).ToString().Utf8Value());
  for (auto& s : store) argv.push_back(s.c_str());
  argv.push_back(nullptr);
  return Napi::Number::New(info.Env(), g_h ? mpv.command(g_h, argv.data()) : -1);
}

Napi::Value GetProperty(const Napi::CallbackInfo& info) {
  if (!g_h) return info.Env().Null();
  char* v = mpv.get_property_string(g_h, info[0].As<Napi::String>().Utf8Value().c_str());
  if (!v) return info.Env().Null();
  Napi::String s = Napi::String::New(info.Env(), v);
  mpv.free(v);
  return s;
}

Napi::Value SetProperty(const Napi::CallbackInfo& info) {
  int rc = g_h ? mpv.set_property_string(g_h, info[0].As<Napi::String>().Utf8Value().c_str(),
                                         info[1].ToString().Utf8Value().c_str())
               : -1;
  return Napi::Number::New(info.Env(), rc);
}

Napi::Value Observe(const Napi::CallbackInfo& info) {
  int rc = g_h ? mpv.observe_property(g_h, 0, info[0].As<Napi::String>().Utf8Value().c_str(), MPV_FORMAT_STRING) : -1;
  return Napi::Number::New(info.Env(), rc);
}

void EventLoop() {
  while (!g_stopEvents) {
    mpv_event* ev = mpv.wait_event(g_h, 0.5);
    if (g_stopEvents) break;
    if (ev->event_id == MPV_EVENT_NONE) continue;
    auto* msg = new EventMsg();
    msg->event = mpv.event_name(ev->event_id);
    msg->error = ev->error;
    if (ev->event_id == MPV_EVENT_PROPERTY_CHANGE) {
      auto* p = static_cast<mpv_event_property*>(ev->data);
      msg->name = p->name;
      if (p->format == MPV_FORMAT_STRING && p->data) msg->data = *static_cast<char**>(p->data);
      else if (p->format == MPV_FORMAT_NONE) msg->data = "\x01none";
    } else if (ev->event_id == MPV_EVENT_END_FILE) {
      msg->reason = static_cast<mpv_event_end_file*>(ev->data)->reason;
    } else if (ev->event_id == MPV_EVENT_CLIENT_MESSAGE) {
      auto* m = static_cast<mpv_event_client_message*>(ev->data);
      for (int i = 0; i < m->num_args; i++) msg->data += std::string(i ? " " : "") + m->args[i];
    }
    bool shutdown = ev->event_id == MPV_EVENT_SHUTDOWN;
    g_eventTsfn.NonBlockingCall(msg, [](Napi::Env env, Napi::Function cb, EventMsg* m) {
      Napi::Object o = Napi::Object::New(env);
      o.Set("event", m->event);
      if (!m->name.empty()) o.Set("name", m->name);
      if (m->event == "property-change") o.Set("data", m->data == "\x01none" ? env.Null() : Napi::String::New(env, m->data).As<Napi::Value>());
      else if (!m->data.empty()) o.Set("data", m->data);
      if (m->error) o.Set("error", m->error);
      if (m->reason >= 0) o.Set("reason", m->reason);
      cb.Call({o});
      delete m;
    });
    if (shutdown) break;
  }
}

Napi::Value OnEvent(const Napi::CallbackInfo& info) {
  if (!g_h) {
    Throw(info.Env(), "create() first");
    return info.Env().Undefined();
  }
  g_eventTsfn = Napi::ThreadSafeFunction::New(info.Env(), info[0].As<Napi::Function>(), "mpv-events", 0, 1);
  g_eventTsfnLive = true;
  g_stopEvents = false;
  g_eventThread = std::thread(EventLoop);
  return info.Env().Undefined();
}

struct FrameMsg {
  D3D11Renderer::Frame f;
};

// attachRenderer({width, height, slots, luidLow, luidHigh, warp}, onFrame(slot, handleBuffer, w, h, gen)) -> adapter string
Napi::Value AttachRenderer(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_h) {
    Throw(env, "create() first");
    return env.Undefined();
  }
  Napi::Object o = info[0].As<Napi::Object>();
  RenderInit init;
  init.width = o.Get("width").As<Napi::Number>().Int32Value();
  init.height = o.Get("height").As<Napi::Number>().Int32Value();
  if (o.Has("slots")) init.slots = o.Get("slots").As<Napi::Number>().Int32Value();
  if (o.Has("luidLow") && o.Has("luidHigh")) {
    init.hasLuid = true;
    init.luid.LowPart = o.Get("luidLow").As<Napi::Number>().Uint32Value();
    init.luid.HighPart = o.Get("luidHigh").As<Napi::Number>().Int32Value();
  }
  if (o.Has("warp")) init.warp = o.Get("warp").ToBoolean().Value();
  if (o.Has("readback")) init.readback = o.Get("readback").ToBoolean().Value();
  if (o.Has("shmName")) init.shmName = o.Get("shmName").As<Napi::String>().Utf8Value();

  g_frameTsfn = Napi::ThreadSafeFunction::New(env, info[1].As<Napi::Function>(), "mpv-frames", 0, 1);
  g_frameTsfnLive = true;
  g_renderer = std::make_unique<D3D11Renderer>();
  std::string err = g_renderer->Init(g_h, init, [](const D3D11Renderer::Frame& f) {
    auto* m = new FrameMsg{f};
    napi_status st = g_frameTsfn.NonBlockingCall(m, [](Napi::Env env, Napi::Function cb, FrameMsg* m) {
      Napi::Buffer<uint8_t> buf = m->f.data
          ? Napi::Buffer<uint8_t>::Copy(env, m->f.data->data(), m->f.data->size())
          : Napi::Buffer<uint8_t>::Copy(env, reinterpret_cast<uint8_t*>(&m->f.handle), 8);
      cb.Call({Napi::Number::New(env, m->f.slot), buf, Napi::Number::New(env, m->f.width),
               Napi::Number::New(env, m->f.height), Napi::Number::New(env, m->f.generation)});
      delete m;
    });
    if (st != napi_ok) {
      // Could not hand the frame over; give the slot back so the pool does not leak.
      if (g_renderer) g_renderer->Release(m->f.slot);
      delete m;
    }
  });
  if (!err.empty()) {
    g_renderer.reset();
    Throw(env, err);
    return env.Undefined();
  }
  return Napi::String::New(env, g_renderer->adapterName);
}

Napi::Value Resize(const Napi::CallbackInfo& info) {
  if (g_renderer) g_renderer->Resize(info[0].As<Napi::Number>().Int32Value(), info[1].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

Napi::Value ReleaseSlot(const Napi::CallbackInfo& info) {
  if (g_renderer) g_renderer->Release(info[0].As<Napi::Number>().Int32Value());
  return info.Env().Undefined();
}

Napi::Value Stats(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object o = Napi::Object::New(env);
  if (!g_renderer) return o;
  RenderStats s = g_renderer->Stats();
  o.Set("rendered", static_cast<double>(s.rendered));
  o.Set("exhausted", static_cast<double>(s.exhausted));
  o.Set("released", static_cast<double>(s.released));
  o.Set("inFlight", static_cast<double>(s.inFlight));
  o.Set("generation", static_cast<double>(s.generation));
  o.Set("renderMsP50", s.renderMsP50);
  o.Set("renderMsP95", s.renderMsP95);
  o.Set("gpuWaitMsP50", s.gpuWaitMsP50);
  o.Set("gpuWaitMsP95", s.gpuWaitMsP95);
  o.Set("releaseMsP50", s.releaseMsP50);
  o.Set("releaseMsP95", s.releaseMsP95);
  o.Set("releaseMsMax", s.releaseMsMax);
  o.Set("copyMsP50", s.copyMsP50);
  o.Set("copyMsP95", s.copyMsP95);
  o.Set("shmTooBig", static_cast<double>(s.shmTooBig));
  return o;
}

// Orderly teardown: render context first, then the event thread, then the core.
Napi::Value Destroy(const Napi::CallbackInfo& info) {
  if (g_renderer) {
    g_renderer->Shutdown();
    g_renderer.reset();
  }
  if (g_frameTsfnLive) {
    g_frameTsfn.Release();
    g_frameTsfnLive = false;
  }
  g_stopEvents = true;
  if (g_h) mpv.wakeup(g_h);
  if (g_eventThread.joinable()) g_eventThread.join();
  if (g_eventTsfnLive) {
    g_eventTsfn.Release();
    g_eventTsfnLive = false;
  }
  if (g_h) {
    mpv.terminate_destroy(g_h);
    g_h = nullptr;
  }
  return info.Env().Undefined();
}

// Reader side of the shared-memory readback, used from a sandbox:false preload in the renderer process.
HANDLE g_shmMap = nullptr;
uint8_t* g_shmView = nullptr;

Napi::Value ShmOpen(const Napi::CallbackInfo& info) {
  std::wstring name = ToWide(info[0].As<Napi::String>().Utf8Value());
  g_shmMap = OpenFileMappingW(FILE_MAP_READ, FALSE, name.c_str());
  if (!g_shmMap) {
    Throw(info.Env(), "OpenFileMapping failed " + std::to_string(GetLastError()));
    return info.Env().Undefined();
  }
  g_shmView = static_cast<uint8_t*>(MapViewOfFile(g_shmMap, FILE_MAP_READ, 0, 0, 0));
  if (!g_shmView) Throw(info.Env(), "MapViewOfFile failed " + std::to_string(GetLastError()));
  return info.Env().Undefined();
}

// shmRead(Uint8Array dst) -> [seq, w, h]; copies the latest frame into dst (one memcpy), seq 0 when none.
Napi::Value ShmRead(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Array out = Napi::Array::New(env, 3);
  out.Set(0u, 0);
  if (!g_shmView) return out;
  auto* hdr = reinterpret_cast<volatile uint32_t*>(g_shmView);
  uint32_t seq = hdr[0], w = hdr[1], h = hdr[2], cap = hdr[3];
  Napi::Uint8Array dst = info[0].As<Napi::Uint8Array>();
  size_t bytes = static_cast<size_t>(w) * h * 4;
  if (seq == 0 || bytes == 0 || bytes > cap || bytes > dst.ByteLength()) return out;
  memcpy(dst.Data(), g_shmView + 64 + static_cast<size_t>(seq & 1) * cap, bytes);
  out.Set(0u, seq);
  out.Set(1u, w);
  out.Set(2u, h);
  return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("shmOpen", Napi::Function::New(env, ShmOpen));
  exports.Set("shmRead", Napi::Function::New(env, ShmRead));
  exports.Set("loadMpv", Napi::Function::New(env, LoadMpvJs));
  exports.Set("create", Napi::Function::New(env, Create));
  exports.Set("command", Napi::Function::New(env, Command));
  exports.Set("getProperty", Napi::Function::New(env, GetProperty));
  exports.Set("setProperty", Napi::Function::New(env, SetProperty));
  exports.Set("observe", Napi::Function::New(env, Observe));
  exports.Set("onEvent", Napi::Function::New(env, OnEvent));
  exports.Set("attachRenderer", Napi::Function::New(env, AttachRenderer));
  exports.Set("resize", Napi::Function::New(env, Resize));
  exports.Set("releaseSlot", Napi::Function::New(env, ReleaseSlot));
  exports.Set("stats", Napi::Function::New(env, Stats));
  exports.Set("destroy", Napi::Function::New(env, Destroy));
  return exports;
}

}  // namespace

NODE_API_MODULE(yall_libmpv_poc, Init)
