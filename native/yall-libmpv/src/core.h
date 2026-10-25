#pragma once
// One libmpv core per MpvCore instance. No process globals except the diagnostic live counters.
#include <napi.h>
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>
#include "event_msg.h"
#include "live_counts.h"
#include "mpv_loader.h"
#include "node_convert.h"
#include "render/render_thread.h"

// State shared between the JS thread and the TSFN callback. Kept alive by the TSFN finalizer so
// queued messages never see a destroyed context. Only touched on the JS thread.
struct CoreContext {
  Napi::FunctionReference listener;
  std::unordered_map<uint64_t, Napi::Promise::Deferred> pending;
  // The TSFN is unref'd while idle; it is ref'd while a request is pending so an awaited command
  // keeps Node alive until its reply (or destroy) arrives.
  napi_threadsafe_function tsfnRaw = nullptr;
};

void CoreCallJs(Napi::Env env, Napi::Function, CoreContext* ctx, EventMsg* msg);
using EventTsfn = Napi::TypedThreadSafeFunction<CoreContext, EventMsg, &CoreCallJs>;

class MpvCore : public Napi::ObjectWrap<MpvCore> {
 public:
  static void Init(Napi::Env env, Napi::Object exports);
  explicit MpvCore(const Napi::CallbackInfo& info);
  ~MpvCore() override;

 private:
  Napi::Value SetOption(const Napi::CallbackInfo& info);
  Napi::Value Initialize(const Napi::CallbackInfo& info);
  Napi::Value OnEvent(const Napi::CallbackInfo& info);
  Napi::Value Command(const Napi::CallbackInfo& info);
  Napi::Value GetProperty(const Napi::CallbackInfo& info);
  Napi::Value SetProperty(const Napi::CallbackInfo& info);
  Napi::Value ObserveProperty(const Napi::CallbackInfo& info);
  Napi::Value UnobserveProperty(const Napi::CallbackInfo& info);
  Napi::Value RequestLogMessages(const Napi::CallbackInfo& info);
  Napi::Value Destroy(const Napi::CallbackInfo& info);

  // Render side, in core_render.cpp.
  Napi::Value AttachRenderer(const Napi::CallbackInfo& info);
  Napi::Value Resize(const Napi::CallbackInfo& info);
  Napi::Value ReleaseSlot(const Napi::CallbackInfo& info);
  Napi::Value DetachRenderer(const Napi::CallbackInfo& info);
  Napi::Value SimulateDeviceLost(const Napi::CallbackInfo& info);
  Napi::Value Stats(const Napi::CallbackInfo& info);
  // Non-blocking: asks every render thread to stop; each frees its render context and then drains.
  void DetachAllRenderers();
  // Joins and drops render threads that finished draining.
  void ReapRenderers();
  // Blocking: ends all drains now and joins every render thread (env teardown, GC of an undestroyed core).
  void ForceStopRenderers();

  template <typename Issue>
  Napi::Value Track(Napi::Env env, Issue issue);
  void EventLoop();
  void StopEventThread();
  void RejectPending(Napi::Env env);
  // Blocking teardown for env shutdown and GC of a core that JS never destroyed.
  void DestroySync();
  static void CleanupHook(void* arg);

  mpv_handle* handle_ = nullptr;
  napi_env env_ = nullptr;
  bool initialized_ = false;
  bool destroyed_ = false;
  bool hookActive_ = false;
  uint64_t nextReplyId_ = 1;
  uint64_t nextObserveId_ = 1;

  std::shared_ptr<CoreContext> ctx_;
  EventTsfn tsfn_;
  bool tsfnLive_ = false;
  std::thread eventThread_;
  std::atomic<bool> stop_{false};

  // Render threads: the current attach plus detached ones that are still draining. Touched on the JS thread.
  std::vector<std::shared_ptr<RenderThread>> renderers_;
  std::shared_ptr<RenderThread> currentRenderer_;
  uint64_t nextAttachId_ = 1;
};

// Error with a `code` property, for failures JS wants to branch on.
Napi::Error MakeCodedError(Napi::Env env, const char* code, const std::string& message);
