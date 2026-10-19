#include "core.h"
#include <clocale>
#include <functional>

// libmpv render.h threading rules this core follows (the render side lives in src/render):
//  - the render update callback never calls into mpv, it only signals a condition variable;
//  - every mpv_render_* call runs on the render thread, one at a time;
//  - MPV_RENDER_PARAM_ADVANCED_CONTROL is not set: its rules (servicing update callbacks without
//    blocking the core) are not needed by anything in this addon;
//  - the render context is freed before mpv_terminate_destroy.

LiveCounts& Counts() {
  static LiveCounts counts;
  return counts;
}

namespace {

// After destroy() nobody comes back for in-flight slots, but frames already queued towards JS get this long
// to be released before the render thread closes the handles.
constexpr int kDestroyDrainMs = 500;

Napi::Error MakeMpvError(Napi::Env env, int rc) {
  Napi::Error e = Napi::Error::New(env, mpv.error_string(rc));
  e.Set("code", Napi::String::New(env, MpvErrorName(rc)));
  e.Set("mpvError", Napi::Number::New(env, rc));
  return e;
}

Napi::Error MakeDestroyedError(Napi::Env env) {
  Napi::Error e = Napi::Error::New(env, "destroyed");
  e.Set("code", Napi::String::New(env, "DESTROYED"));
  return e;
}

const char* EndReasonName(mpv_end_file_reason reason) {
  switch (reason) {
    case MPV_END_FILE_REASON_EOF: return "eof";
    case MPV_END_FILE_REASON_STOP: return "stop";
    case MPV_END_FILE_REASON_QUIT: return "quit";
    case MPV_END_FILE_REASON_ERROR: return "error";
    case MPV_END_FILE_REASON_REDIRECT: return "redirect";
    default: return "unknown";
  }
}

// Converts an mpv event into an owned message. Returns null for events nobody listens to.
std::unique_ptr<EventMsg> ConvertEvent(const mpv_event* ev) {
  auto msg = std::make_unique<EventMsg>();
  switch (ev->event_id) {
    case MPV_EVENT_PROPERTY_CHANGE: {
      msg->event = "property-change";
      msg->observeId = ev->reply_userdata;
      auto* p = static_cast<mpv_event_property*>(ev->data);
      msg->propertyName = p->name ? p->name : "";
      if (p->format == MPV_FORMAT_NODE && p->data) msg->value = CopyNode(*static_cast<mpv_node*>(p->data));
      return msg;
    }
    case MPV_EVENT_GET_PROPERTY_REPLY: {
      msg->kind = EventMsg::Kind::Reply;
      msg->replyId = ev->reply_userdata;
      msg->error = ev->error;
      auto* p = static_cast<mpv_event_property*>(ev->data);
      if (ev->error >= 0 && p && p->format == MPV_FORMAT_NODE && p->data) {
        msg->value = CopyNode(*static_cast<mpv_node*>(p->data));
      }
      return msg;
    }
    case MPV_EVENT_SET_PROPERTY_REPLY: {
      msg->kind = EventMsg::Kind::Reply;
      msg->replyId = ev->reply_userdata;
      msg->error = ev->error;
      return msg;
    }
    case MPV_EVENT_COMMAND_REPLY: {
      msg->kind = EventMsg::Kind::Reply;
      msg->replyId = ev->reply_userdata;
      msg->error = ev->error;
      auto* c = static_cast<mpv_event_command*>(ev->data);
      if (ev->error >= 0 && c) msg->value = CopyNode(c->result);
      return msg;
    }
    case MPV_EVENT_END_FILE: {
      msg->event = "end-file";
      auto* e = static_cast<mpv_event_end_file*>(ev->data);
      msg->reason = EndReasonName(e->reason);
      if (e->reason == MPV_END_FILE_REASON_ERROR && e->error < 0) {
        msg->error = e->error;
        msg->errorName = MpvErrorName(e->error);
        msg->errorText = mpv.error_string(e->error);
      }
      return msg;
    }
    case MPV_EVENT_START_FILE:
    case MPV_EVENT_FILE_LOADED:
    case MPV_EVENT_SEEK:
    case MPV_EVENT_PLAYBACK_RESTART:
    case MPV_EVENT_SHUTDOWN:
      msg->event = mpv.event_name(ev->event_id);
      return msg;
    case MPV_EVENT_LOG_MESSAGE: {
      msg->event = "log-message";
      auto* l = static_cast<mpv_event_log_message*>(ev->data);
      msg->prefix = l->prefix ? l->prefix : "";
      msg->level = l->level ? l->level : "";
      msg->text = l->text ? l->text : "";
      return msg;
    }
    case MPV_EVENT_CLIENT_MESSAGE: {
      msg->event = "client-message";
      auto* m = static_cast<mpv_event_client_message*>(ev->data);
      for (int i = 0; i < m->num_args; i++) msg->args.emplace_back(m->args[i] ? m->args[i] : "");
      return msg;
    }
    default:
      return nullptr;
  }
}

// Runs mpv_terminate_destroy off the main thread: it waits for the core to shut down (open network
// streams, other clients), which can take a while.
class TerminateWorker : public Napi::AsyncWorker {
 public:
  TerminateWorker(Napi::Env env, mpv_handle* handle, Napi::Promise::Deferred deferred, std::function<void()> before,
                  std::function<void()> after)
      : Napi::AsyncWorker(env),
        handle_(handle),
        deferred_(deferred),
        before_(std::move(before)),
        after_(std::move(after)) {}

  void Execute() override {
    before_();
    mpv.terminate_destroy(handle_);
    Counts().cores--;
  }
  void OnOK() override {
    after_();
    deferred_.Resolve(Env().Undefined());
  }
  void OnError(const Napi::Error& e) override {
    after_();
    deferred_.Reject(e.Value());
  }

 private:
  mpv_handle* handle_;
  Napi::Promise::Deferred deferred_;
  std::function<void()> before_;
  std::function<void()> after_;
};

}  // namespace

void CoreCallJs(Napi::Env env, Napi::Function, CoreContext* ctx, EventMsg* rawMsg) {
  std::unique_ptr<EventMsg> msg(rawMsg);
  if (env == nullptr || ctx == nullptr) return;  // env teardown: drop the message

  try {
    if (msg->kind == EventMsg::Kind::Reply) {
      auto it = ctx->pending.find(msg->replyId);
      if (it == ctx->pending.end()) return;  // already rejected by destroy()
      Napi::Promise::Deferred deferred = it->second;
      ctx->pending.erase(it);
      if (ctx->pending.empty() && ctx->tsfnRaw) napi_unref_threadsafe_function(env, ctx->tsfnRaw);
      if (msg->error < 0) {
        deferred.Reject(MakeMpvError(env, msg->error).Value());
      } else {
        deferred.Resolve(ToJs(env, msg->value));
      }
      return;
    }

    if (ctx->listener.IsEmpty()) return;
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("event", msg->event);
    if (msg->event == "property-change") {
      obj.Set("id", Napi::Number::New(env, static_cast<double>(msg->observeId)));
      obj.Set("name", msg->propertyName);
      obj.Set("data", ToJs(env, msg->value));
    } else if (msg->event == "end-file") {
      obj.Set("reason", msg->reason);
      if (!msg->errorName.empty()) {
        Napi::Object err = Napi::Object::New(env);
        err.Set("code", msg->errorName);
        err.Set("message", msg->errorText);
        obj.Set("error", err);
      }
    } else if (msg->event == "log-message") {
      obj.Set("prefix", msg->prefix);
      obj.Set("level", msg->level);
      obj.Set("text", msg->text);
    } else if (msg->event == "client-message") {
      Napi::Array args = Napi::Array::New(env, msg->args.size());
      for (size_t i = 0; i < msg->args.size(); i++) args.Set(static_cast<uint32_t>(i), msg->args[i]);
      obj.Set("args", args);
    }
    ctx->listener.Call({obj});
  } catch (const Napi::Error& e) {
    // A throwing listener must not unwind through the N-API frame; surface it as an uncaught exception.
    napi_fatal_exception(env, e.Value());
  }
}

void MpvCore::Init(Napi::Env env, Napi::Object exports) {
  Napi::Function ctor = DefineClass(env, "MpvCore", {
    InstanceMethod("setOption", &MpvCore::SetOption),
    InstanceMethod("initialize", &MpvCore::Initialize),
    InstanceMethod("onEvent", &MpvCore::OnEvent),
    InstanceMethod("command", &MpvCore::Command),
    InstanceMethod("getProperty", &MpvCore::GetProperty),
    InstanceMethod("setProperty", &MpvCore::SetProperty),
    InstanceMethod("observeProperty", &MpvCore::ObserveProperty),
    InstanceMethod("unobserveProperty", &MpvCore::UnobserveProperty),
    InstanceMethod("requestLogMessages", &MpvCore::RequestLogMessages),
    InstanceMethod("destroy", &MpvCore::Destroy),
    InstanceMethod("attachRenderer", &MpvCore::AttachRenderer),
    InstanceMethod("resize", &MpvCore::Resize),
    InstanceMethod("releaseSlot", &MpvCore::ReleaseSlot),
    InstanceMethod("detachRenderer", &MpvCore::DetachRenderer),
    InstanceMethod("stats", &MpvCore::Stats),
  });
  exports.Set("MpvCore", ctor);
}

MpvCore::MpvCore(const Napi::CallbackInfo& info) : Napi::ObjectWrap<MpvCore>(info), env_(info.Env()) {
  if (!IsMpvLoaded()) {
    throw Napi::Error::New(info.Env(), "libmpv is not loaded, call loadLibrary() first");
  }
#ifndef _WIN32
  // libmpv refuses to start unless LC_NUMERIC is "C", and a host (Chromium) may have changed it.
  setlocale(LC_NUMERIC, "C");
#endif
  handle_ = mpv.create();
  if (!handle_) {
    throw Napi::Error::New(info.Env(), "mpv_create failed (LC_NUMERIC must be \"C\")");
  }
  Counts().cores++;
  ctx_ = std::make_shared<CoreContext>();
  napi_add_env_cleanup_hook(env_, &MpvCore::CleanupHook, this);
  hookActive_ = true;
}

MpvCore::~MpvCore() {
  if (hookActive_) {
    napi_remove_env_cleanup_hook(env_, &MpvCore::CleanupHook, this);
    hookActive_ = false;
  }
  DestroySync();
}

void MpvCore::CleanupHook(void* arg) {
  auto* self = static_cast<MpvCore*>(arg);
  self->hookActive_ = false;
  // Also covers a core that was destroyed asynchronously but whose render threads are still draining.
  self->ForceStopRenderers();
  self->DestroySync();
}

void MpvCore::StopEventThread() {
  stop_ = true;
  if (handle_ && initialized_) mpv.wakeup(handle_);
  if (eventThread_.joinable()) eventThread_.join();
}

void MpvCore::DestroySync() {
  if (destroyed_) return;
  destroyed_ = true;
  // The renderer is detached here before the core goes away (render.h: free the render context first).
  ForceStopRenderers();
  StopEventThread();
  if (ctx_) {
    ctx_->pending.clear();
    ctx_->listener.Reset();
  }
  if (handle_) {
    mpv.terminate_destroy(handle_);
    handle_ = nullptr;
    Counts().cores--;
  }
  if (tsfnLive_) {
    tsfn_.Release();
    tsfnLive_ = false;
  }
}

void MpvCore::RejectPending(Napi::Env env) {
  auto pending = std::move(ctx_->pending);
  ctx_->pending.clear();
  for (auto& entry : pending) entry.second.Reject(MakeDestroyedError(env).Value());
}

void MpvCore::EventLoop() {
  Counts().eventThreads++;
  while (!stop_) {
    // A bounded wait as a safety net; destroy() normally ends the wait through mpv_wakeup.
    mpv_event* ev = mpv.wait_event(handle_, 1.0);
    if (stop_) break;
    if (ev->event_id == MPV_EVENT_NONE) continue;
    std::unique_ptr<EventMsg> msg = ConvertEvent(ev);
    if (!msg) continue;
    if (tsfn_.NonBlockingCall(msg.get()) == napi_ok) msg.release();
  }
  Counts().eventThreads--;
}

Napi::Value MpvCore::SetOption(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (destroyed_) throw MakeDestroyedError(env);
  if (info.Length() < 2 || !info[0].IsString()) throw Napi::TypeError::New(env, "setOption(name, value)");
  std::string name = info[0].As<Napi::String>().Utf8Value();
  std::string value = info[1].ToString().Utf8Value();
  int rc = mpv.set_option_string(handle_, name.c_str(), value.c_str());
  if (rc < 0) {
    Napi::Error e = Napi::Error::New(env, "option " + name + "=" + value + ": " + mpv.error_string(rc));
    e.Set("code", Napi::String::New(env, MpvErrorName(rc)));
    e.Set("mpvError", Napi::Number::New(env, rc));
    throw e;
  }
  return env.Undefined();
}

Napi::Value MpvCore::Initialize(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (destroyed_) throw MakeDestroyedError(env);
  if (initialized_) throw Napi::Error::New(env, "already initialized");
  int rc = mpv.initialize(handle_);
  if (rc < 0) throw MakeMpvError(env, rc);
  initialized_ = true;

  // The TSFN is unref'd so a core nobody destroyed never keeps Node alive. The finalizer frees the
  // context only after every queued message was delivered.
  tsfn_ = EventTsfn::New(env, "yall-libmpv-events", 0, 1, ctx_.get(),
                         [](Napi::Env, std::shared_ptr<CoreContext>* holder, CoreContext*) { delete holder; },
                         new std::shared_ptr<CoreContext>(ctx_));
  tsfn_.Unref(env);
  ctx_->tsfnRaw = tsfn_;
  tsfnLive_ = true;
  stop_ = false;
  eventThread_ = std::thread(&MpvCore::EventLoop, this);
  return env.Undefined();
}

Napi::Value MpvCore::OnEvent(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (destroyed_) throw MakeDestroyedError(env);
  if (info.Length() < 1 || !info[0].IsFunction()) throw Napi::TypeError::New(env, "onEvent(listener)");
  ctx_->listener = Napi::Persistent(info[0].As<Napi::Function>());
  return env.Undefined();
}

template <typename Issue>
Napi::Value MpvCore::Track(Napi::Env env, Issue issue) {
  auto deferred = Napi::Promise::Deferred::New(env);
  if (destroyed_) {
    deferred.Reject(MakeDestroyedError(env).Value());
    return deferred.Promise();
  }
  if (!initialized_) {
    deferred.Reject(MakeMpvError(env, MPV_ERROR_UNINITIALIZED).Value());
    return deferred.Promise();
  }
  uint64_t id = nextReplyId_++;
  if (ctx_->pending.empty()) napi_ref_threadsafe_function(env, ctx_->tsfnRaw);
  ctx_->pending.emplace(id, deferred);
  int rc = issue(id);
  if (rc < 0) {
    ctx_->pending.erase(id);
    if (ctx_->pending.empty()) napi_unref_threadsafe_function(env, ctx_->tsfnRaw);
    deferred.Reject(MakeMpvError(env, rc).Value());
  }
  return deferred.Promise();
}

Napi::Value MpvCore::Command(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsArray()) throw Napi::TypeError::New(env, "command(args: string[])");
  Napi::Array arr = info[0].As<Napi::Array>();
  std::vector<std::string> store;
  store.reserve(arr.Length());
  for (uint32_t i = 0; i < arr.Length(); i++) store.push_back(arr.Get(i).ToString().Utf8Value());
  std::vector<const char*> argv;
  for (const auto& s : store) argv.push_back(s.c_str());
  argv.push_back(nullptr);
  return Track(env, [&](uint64_t id) { return mpv.command_async(handle_, id, argv.data()); });
}

Napi::Value MpvCore::GetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) throw Napi::TypeError::New(env, "getProperty(name)");
  std::string name = info[0].As<Napi::String>().Utf8Value();
  return Track(env, [&](uint64_t id) { return mpv.get_property_async(handle_, id, name.c_str(), MPV_FORMAT_NODE); });
}

Napi::Value MpvCore::SetProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsString()) throw Napi::TypeError::New(env, "setProperty(name, value)");
  std::string name = info[0].As<Napi::String>().Utf8Value();
  mpv_node node{};
  std::string storage;
  if (!ScalarToNode(info[1], node, storage)) {
    auto deferred = Napi::Promise::Deferred::New(env);
    deferred.Reject(Napi::TypeError::New(env, "setProperty value must be a boolean, number or string").Value());
    return deferred.Promise();
  }
  // mpv copies the node, so the stack node and the string storage only need to outlive the call.
  return Track(env, [&](uint64_t id) {
    return mpv.set_property_async(handle_, id, name.c_str(), MPV_FORMAT_NODE, &node);
  });
}

Napi::Value MpvCore::ObserveProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (destroyed_) throw MakeDestroyedError(env);
  if (!initialized_) throw MakeMpvError(env, MPV_ERROR_UNINITIALIZED);
  if (info.Length() < 1 || !info[0].IsString()) throw Napi::TypeError::New(env, "observeProperty(name)");
  std::string name = info[0].As<Napi::String>().Utf8Value();
  uint64_t id = nextObserveId_++;
  int rc = mpv.observe_property(handle_, id, name.c_str(), MPV_FORMAT_NODE);
  if (rc < 0) throw MakeMpvError(env, rc);
  return Napi::Number::New(env, static_cast<double>(id));
}

Napi::Value MpvCore::UnobserveProperty(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (destroyed_) throw MakeDestroyedError(env);
  if (!initialized_) throw MakeMpvError(env, MPV_ERROR_UNINITIALIZED);
  if (info.Length() < 1 || !info[0].IsNumber()) throw Napi::TypeError::New(env, "unobserveProperty(id)");
  uint64_t id = static_cast<uint64_t>(info[0].As<Napi::Number>().DoubleValue());
  int rc = mpv.unobserve_property(handle_, id);
  if (rc < 0) throw MakeMpvError(env, rc);
  return env.Undefined();
}

Napi::Value MpvCore::RequestLogMessages(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (destroyed_) throw MakeDestroyedError(env);
  if (!initialized_) throw MakeMpvError(env, MPV_ERROR_UNINITIALIZED);
  if (info.Length() < 1 || !info[0].IsString()) throw Napi::TypeError::New(env, "requestLogMessages(level)");
  std::string level = info[0].As<Napi::String>().Utf8Value();
  int rc = mpv.request_log_messages(handle_, level.c_str());
  if (rc < 0) throw MakeMpvError(env, rc);
  return env.Undefined();
}

Napi::Value MpvCore::Destroy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  auto deferred = Napi::Promise::Deferred::New(env);
  if (destroyed_) {
    deferred.Resolve(env.Undefined());
    return deferred.Promise();
  }
  destroyed_ = true;

  // Order: 1. detach the renderer (render context freed first), 2. stop and join the event thread,
  // 3. mpv_terminate_destroy on a worker thread, 4. reject pending promises, 5. release the TSFN.
  // The cleanup hook stays registered: render threads may still be draining after this resolves, and the
  // hook force-stops them at env teardown.
  for (const auto& r : renderers_) r->LimitDrain(kDestroyDrainMs);
  DetachAllRenderers();
  StopEventThread();
  RejectPending(env);

  mpv_handle* handle = handle_;
  handle_ = nullptr;
  EventTsfn tsfn = tsfn_;
  bool live = tsfnLive_;
  tsfnLive_ = false;
  std::vector<std::shared_ptr<RenderThread>> renderers = renderers_;
  auto* worker = new TerminateWorker(
      env, handle, deferred,
      [renderers]() {
        // The render context must be freed before mpv_terminate_destroy. It happens on each render thread
        // right after it sees the stop flag, so this wait is short.
        for (const auto& r : renderers) r->WaitContextFreed(5000);
      },
      [tsfn, live]() mutable {
        if (live) tsfn.Release();
      });
  worker->Queue();
  return deferred.Promise();
}
