#include "socket_sink.h"

bool SocketSink::Post(Frame&& frame) {
  proto::Json meta = {{"attachId", frame.attachId}, {"slotId", frame.slotId}, {"serial", frame.serial},
                      {"generation", frame.generation}, {"width", frame.width}, {"height", frame.height}};
  if (!frame.pixels) {
    // A shared buffer: the client already holds its descriptor, so the message names the slot only. The pool
    // bounds the frames in flight, which is why these do not count as outstanding.
    meta["shared"] = true;
    if (frame.hasProbe) meta["probe"] = std::vector<int>(frame.probe, frame.probe + sizeof(frame.probe));
    return channel_.Write(proto::kFrame, meta);
  }
  outstanding_++;
  if (!channel_.Write(proto::kFrame, meta, frame.pixels->data(), frame.pixels->size())) {
    outstanding_--;
    return false;
  }
  return true;
}
