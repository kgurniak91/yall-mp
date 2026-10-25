#pragma once
// The libmpv core of the host process: the counterpart of MpvCore in the addon, driven by protocol messages.
// Handle() runs on the socket reader thread; replies and events are written from the mpv event thread and
// the render thread.
#include <atomic>
#include <memory>
#include <thread>
#include <vector>
#include "event_msg.h"
#include "protocol.h"
#include "render/render_thread.h"

class HostCore {
 public:
  explicit HostCore(proto::Channel& channel) : channel_(channel) {}
  ~HostCore();

  // Returns false once the host should exit (kDestroy was handled).
  bool Handle(proto::Message&& message);
  // Socket closed without a kDestroy: tear everything down so the process can exit cleanly.
  void Shutdown();

 private:
  void Create(const proto::Json& args);
  void Command(const proto::Json& args);
  void GetProperty(const proto::Json& args);
  void SetProperty(const proto::Json& args);
  void Observe(const proto::Json& args);
  void Unobserve(const proto::Json& args);
  void LogMessages(const proto::Json& args);
  void Attach(const proto::Json& args);
  void Resize(const proto::Json& args);
  void Detach();
  void Stats(const proto::Json& args);
  void ReleaseSlot(const proto::Json& args);
  void Destroy(const proto::Json& args);

  void EventLoop();
  void SendEvent(const EventMsg& msg);
  void SendReply(uint64_t id, const proto::Json& value);
  void SendError(uint64_t id, const std::string& code, const std::string& message, int mpvError = 0);
  void SendMpvError(uint64_t id, int rc);
  // Replies with an error and returns false when the core cannot serve requests (not created, destroyed).
  bool Ready(uint64_t id);

  void DetachAllRenderers();
  void ReapRenderers();
  void ForceStopRenderers();
  void StopEventThread();
  void TearDown();

  proto::Channel& channel_;
  mpv_handle* handle_ = nullptr;
  bool initialized_ = false;
  bool destroyed_ = false;
  std::atomic<bool> stop_{false};
  std::thread eventThread_;

  // Frames the client has not acknowledged yet, shared by every attach of this core.
  std::atomic<int> outstanding_{0};
  std::vector<std::shared_ptr<RenderThread>> renderers_;
  std::shared_ptr<RenderThread> currentRenderer_;
};
