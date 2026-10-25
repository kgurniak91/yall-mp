#pragma once
// Wire format between the Electron main process and yall-mpv-host, over one unix socket (the child's fd 3).
// A message is `[u32 type][u32 jsonLen][u32 binLen][json][bin]`, integers little endian. The JSON part
// carries the arguments or the result, the binary part only pixel data of frames.
#include <cstdint>
#include <mutex>
#include <vector>
#include <nlohmann/json.hpp>

namespace proto {

using Json = nlohmann::json;

enum Type : uint32_t {
  // Node -> host
  kCreate = 1,       // {id, lib, options: [[name, value], ...]}                    -> reply
  kCommand = 2,      // {id, args: [string]}                                         -> reply {value}
  kGetProperty = 3,  // {id, name}                                                   -> reply {value}
  kSetProperty = 4,  // {id, name, value}                                            -> reply
  kObserve = 5,      // {oid, name}
  kUnobserve = 6,    // {oid}
  kLogMessages = 7,  // {level}
  kAttach = 8,       // {id, attachId, backend, width, height, slots?, slotTimeoutMs?, impl?} -> reply {value}
  kResize = 9,       // {width, height}
  kDetach = 10,      // {}
  kStats = 11,       // {id}                                                         -> reply {value}
  kFrameAck = 12,    // {count}: readback frames the client has taken over
  kReleaseSlot = 13, // {attachId, slotId, serial}
  kDestroy = 14,     // {id}                                                         -> reply, then the host exits

  // Host -> node
  kReply = 101,      // {id, value} or {id, error: {code, message, mpvError?}}
  kEvent = 102,      // {event, ...}: the shape of LibmpvEvent
  kFrame = 103       // {attachId, slotId, serial, generation, width, height} + BGRA pixels
};

constexpr uint32_t kMaxJsonBytes = 16u << 20;
constexpr uint32_t kMaxBinBytes = 64u << 20;

struct Message {
  uint32_t type = 0;
  Json json;
  std::vector<uint8_t> bin;
};

// Blocking reads (one reader thread) and mutex-serialised writes (any thread).
class Channel {
 public:
  explicit Channel(int fd) : fd_(fd) {}

  // False on EOF, a socket error or a malformed message.
  bool Read(Message& out);
  bool Write(uint32_t type, const Json& json, const uint8_t* bin = nullptr, size_t binLength = 0);

 private:
  bool ReadExact(void* data, size_t length);
  bool WriteAll(const void* data, size_t length);

  int fd_;
  std::mutex writeMutex_;
};

}  // namespace proto
