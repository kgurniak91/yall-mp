#include "protocol.h"
#include <cerrno>
#include <cstring>
#include <sys/socket.h>
#include <unistd.h>

namespace proto {

namespace {
constexpr size_t kHeaderBytes = 12;
}

bool Channel::ReadExact(void* data, size_t length) {
  auto* p = static_cast<uint8_t*>(data);
  while (length > 0) {
    ssize_t n = ::read(fd_, p, length);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return false;
    p += n;
    length -= static_cast<size_t>(n);
  }
  return true;
}

bool Channel::WriteAll(const void* data, size_t length) {
  auto* p = static_cast<const uint8_t*>(data);
  while (length > 0) {
    ssize_t n = ::send(fd_, p, length, MSG_NOSIGNAL);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return false;
    p += n;
    length -= static_cast<size_t>(n);
  }
  return true;
}

bool Channel::Read(Message& out) {
  uint8_t header[kHeaderBytes];
  if (!ReadExact(header, sizeof(header))) return false;
  uint32_t type, jsonLength, binLength;
  std::memcpy(&type, header, 4);
  std::memcpy(&jsonLength, header + 4, 4);
  std::memcpy(&binLength, header + 8, 4);
  if (jsonLength > kMaxJsonBytes || binLength > kMaxBinBytes) return false;

  std::vector<uint8_t> json(jsonLength);
  if (jsonLength > 0 && !ReadExact(json.data(), jsonLength)) return false;
  out.type = type;
  out.json = Json::parse(json.begin(), json.end(), nullptr, false);
  if (out.json.is_discarded()) return false;
  out.bin.resize(binLength);
  return binLength == 0 || ReadExact(out.bin.data(), binLength);
}

bool Channel::Write(uint32_t type, const Json& json, const uint8_t* bin, size_t binLength) {
  // Invalid UTF-8 (file names, tags) is replaced instead of throwing out of the event thread.
  const std::string body = json.dump(-1, ' ', false, Json::error_handler_t::replace);
  const auto jsonLength = static_cast<uint32_t>(body.size());
  const auto binBytes = static_cast<uint32_t>(binLength);

  std::vector<uint8_t> head(kHeaderBytes + body.size());
  std::memcpy(head.data(), &type, 4);
  std::memcpy(head.data() + 4, &jsonLength, 4);
  std::memcpy(head.data() + 8, &binBytes, 4);
  std::memcpy(head.data() + kHeaderBytes, body.data(), body.size());

  std::lock_guard<std::mutex> lock(writeMutex_);
  return WriteAll(head.data(), head.size()) && (binLength == 0 || WriteAll(bin, binLength));
}

}  // namespace proto
