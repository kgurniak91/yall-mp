#pragma once
// Sends file descriptors to the Electron main process over the child's fd 4 (a SOCK_SEQPACKET unix socket,
// SCM_RIGHTS). Each message is one fd plus a short JSON text; the receiver is the yall_fdpass addon.
#include <string>

class FdSender {
 public:
  // Takes the inherited descriptor. Available() is false when it is missing or not a seqpacket socket.
  explicit FdSender(int fd);

  bool Available() const { return fd_ >= 0; }
  // Duplicates `fd` into the receiver; the caller keeps its own. `fd` may be -1 for a text-only message.
  bool Send(int fd, const std::string& meta);

 private:
  int fd_ = -1;
};
