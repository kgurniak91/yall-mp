#pragma once
// FrameSink that writes readback frames to the socket. `outstanding` counts frames the client has not
// acknowledged yet (kFrameAck); the render thread skips frames while it is at the limit.
#include <atomic>
#include "protocol.h"
#include "render/render_thread.h"

class SocketSink : public FrameSink {
 public:
  SocketSink(proto::Channel& channel, std::atomic<int>& outstanding) : channel_(channel), outstanding_(outstanding) {}

  bool Post(Frame&& frame) override;
  int Outstanding() override { return outstanding_.load(); }
  void Close() override {}

 private:
  proto::Channel& channel_;
  std::atomic<int>& outstanding_;
};
