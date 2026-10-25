#include "socket_sink.h"

bool SocketSink::Post(Frame&& frame) {
  if (!frame.pixels) return false;  // only readback backends exist on this side
  proto::Json meta = {{"attachId", frame.attachId}, {"slotId", frame.slotId}, {"serial", frame.serial},
                      {"generation", frame.generation}, {"width", frame.width}, {"height", frame.height}};
  outstanding_++;
  if (!channel_.Write(proto::kFrame, meta, frame.pixels->data(), frame.pixels->size())) {
    outstanding_--;
    return false;
  }
  return true;
}
