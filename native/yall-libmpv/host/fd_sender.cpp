#include "fd_sender.h"
#include <cerrno>
#include <cstring>
#include <sys/socket.h>
#include <sys/uio.h>

FdSender::FdSender(int fd) {
  int type = 0;
  socklen_t length = sizeof(type);
  if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &type, &length) == 0 && type == SOCK_SEQPACKET) fd_ = fd;
}

bool FdSender::Send(int fd, const std::string& meta) {
  if (fd_ < 0) return false;
  iovec iov{const_cast<char*>(meta.data()), meta.size()};
  msghdr msg{};
  msg.msg_iov = &iov;
  msg.msg_iovlen = 1;
  alignas(struct cmsghdr) char control[CMSG_SPACE(sizeof(int))];
  if (fd >= 0) {
    msg.msg_control = control;
    msg.msg_controllen = sizeof(control);
    cmsghdr* c = CMSG_FIRSTHDR(&msg);
    c->cmsg_level = SOL_SOCKET;
    c->cmsg_type = SCM_RIGHTS;
    c->cmsg_len = CMSG_LEN(sizeof(int));
    std::memcpy(CMSG_DATA(c), &fd, sizeof(int));
  }
  ssize_t n;
  do {
    n = sendmsg(fd_, &msg, MSG_NOSIGNAL);
  } while (n < 0 && errno == EINTR);
  return n >= 0;
}
