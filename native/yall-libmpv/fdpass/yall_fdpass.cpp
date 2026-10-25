// yall_fdpass: receives file descriptors that yall-mpv-host sends over a unix socket (SCM_RIGHTS). Node cannot
// read ancillary data itself. The addon links neither libmpv nor ffmpeg, so unlike libmpv it can be loaded into
// the Electron main process. Linux only.
#include <napi.h>
#include <algorithm>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <map>
#include <memory>
#include <mutex>
#include <poll.h>
#include <string>
#include <sys/socket.h>
#include <sys/uio.h>
#include <thread>
#include <unistd.h>

namespace {

constexpr size_t kMaxMeta = 4096;

struct Delivery {
  int fd;
  std::string meta;
};

class Receiver {
 public:
  Receiver(int socketFd, Napi::ThreadSafeFunction tsfn) : socketFd_(socketFd), tsfn_(std::move(tsfn)) {
    if (pipe2(stop_, O_CLOEXEC) != 0) stop_[0] = stop_[1] = -1;
    thread_ = std::thread([this] { Run(); });
  }

  void Stop() {
    if (stop_[1] >= 0) {
      const char byte = 1;
      (void)!write(stop_[1], &byte, 1);
    }
    if (thread_.joinable()) thread_.join();
    tsfn_.Release();
    if (stop_[0] >= 0) close(stop_[0]);
    if (stop_[1] >= 0) close(stop_[1]);
    stop_[0] = stop_[1] = -1;
  }

 private:
  void Run() {
    char buf[kMaxMeta];
    alignas(struct cmsghdr) char control[CMSG_SPACE(sizeof(int))];
    for (;;) {
      pollfd fds[2] = {{socketFd_, POLLIN, 0}, {stop_[0], POLLIN, 0}};
      const int rc = poll(fds, stop_[0] >= 0 ? 2 : 1, -1);
      if (rc < 0) {
        if (errno == EINTR) continue;
        return;
      }
      if (stop_[0] >= 0 && (fds[1].revents & POLLIN)) return;
      if (!(fds[0].revents & (POLLIN | POLLHUP | POLLERR))) continue;

      iovec iov{buf, sizeof(buf)};
      msghdr msg{};
      msg.msg_iov = &iov;
      msg.msg_iovlen = 1;
      msg.msg_control = control;
      msg.msg_controllen = sizeof(control);
      const ssize_t n = recvmsg(socketFd_, &msg, MSG_CMSG_CLOEXEC);
      if (n < 0) {
        if (errno == EINTR || errno == EAGAIN) continue;
        return;
      }
      int received = -1;
      for (cmsghdr* c = CMSG_FIRSTHDR(&msg); c; c = CMSG_NXTHDR(&msg, c)) {
        if (c->cmsg_level == SOL_SOCKET && c->cmsg_type == SCM_RIGHTS) {
          std::memcpy(&received, CMSG_DATA(c), sizeof(int));
        }
      }
      if (n == 0 && received < 0) return;  // the peer closed its end
      auto* delivery = new Delivery{received, std::string(buf, static_cast<size_t>(n))};
      const napi_status status = tsfn_.NonBlockingCall(delivery, [](Napi::Env env, Napi::Function callback, Delivery* d) {
        // The fd belongs to the JS side from here on (closeFd).
        if (env != nullptr) callback.Call({Napi::Number::New(env, d->fd), Napi::String::New(env, d->meta)});
        else if (d->fd >= 0) close(d->fd);
        delete d;
      });
      if (status != napi_ok) {
        if (received >= 0) close(received);
        delete delivery;
        return;
      }
    }
  }

  int socketFd_;
  int stop_[2] = {-1, -1};
  Napi::ThreadSafeFunction tsfn_;
  std::thread thread_;
};

std::mutex g_mutex;
std::map<int, std::unique_ptr<Receiver>> g_receivers;
int g_nextReceiver = 1;

bool IntArg(const Napi::CallbackInfo& info, size_t index, int& out) {
  if (info.Length() <= index || !info[index].IsNumber()) {
    Napi::TypeError::New(info.Env(), "expected an integer argument").ThrowAsJavaScriptException();
    return false;
  }
  out = info[index].As<Napi::Number>().Int32Value();
  return true;
}

// createFdChannel() -> {parentFd, childFd}. Both ends are close-on-exec; spawn() dup2()s the child end into the
// child (which clears the flag there), and the caller closes its own copy afterwards.
Napi::Value CreateFdChannel(const Napi::CallbackInfo& info) {
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, sv) != 0) {
    Napi::Error::New(info.Env(), std::string("socketpair: ") + std::strerror(errno)).ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  Napi::Object out = Napi::Object::New(info.Env());
  out.Set("parentFd", sv[0]);
  out.Set("childFd", sv[1]);
  return out;
}

// startReceiver(socketFd, (fd, meta) => void) -> receiverId
Napi::Value StartReceiver(const Napi::CallbackInfo& info) {
  int socketFd;
  if (!IntArg(info, 0, socketFd)) return info.Env().Undefined();
  if (info.Length() < 2 || !info[1].IsFunction()) {
    Napi::TypeError::New(info.Env(), "expected a callback").ThrowAsJavaScriptException();
    return info.Env().Undefined();
  }
  auto tsfn = Napi::ThreadSafeFunction::New(info.Env(), info[1].As<Napi::Function>(), "yall_fdpass", 0, 1);
  // Node must be able to exit while a receiver exists.
  tsfn.Unref(info.Env());
  std::lock_guard<std::mutex> lock(g_mutex);
  const int id = g_nextReceiver++;
  g_receivers[id] = std::make_unique<Receiver>(socketFd, std::move(tsfn));
  return Napi::Number::New(info.Env(), id);
}

// stopReceiver(receiverId): returns when the thread is gone. Does not close the socket.
Napi::Value StopReceiver(const Napi::CallbackInfo& info) {
  int id;
  if (!IntArg(info, 0, id)) return info.Env().Undefined();
  std::unique_ptr<Receiver> receiver;
  {
    std::lock_guard<std::mutex> lock(g_mutex);
    auto it = g_receivers.find(id);
    if (it == g_receivers.end()) return info.Env().Undefined();
    receiver = std::move(it->second);
    g_receivers.erase(it);
  }
  receiver->Stop();
  return info.Env().Undefined();
}

Napi::Value CloseFd(const Napi::CallbackInfo& info) {
  int fd;
  if (IntArg(info, 0, fd) && fd >= 0) close(fd);
  return info.Env().Undefined();
}

// sendFd(socketFd, fdOrMinus1, meta): the sender side, for tests (the real sender is the host).
Napi::Value SendFd(const Napi::CallbackInfo& info) {
  int socketFd, fd;
  if (!IntArg(info, 0, socketFd) || !IntArg(info, 1, fd)) return info.Env().Undefined();
  const std::string meta = info.Length() > 2 && info[2].IsString() ? info[2].As<Napi::String>().Utf8Value() : "";
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
  if (sendmsg(socketFd, &msg, MSG_NOSIGNAL) < 0) {
    Napi::Error::New(info.Env(), std::string("sendmsg: ") + std::strerror(errno)).ThrowAsJavaScriptException();
  }
  return info.Env().Undefined();
}

// readFd(fd, length) -> Buffer: pread from offset 0 (test support: reads a received memfd).
Napi::Value ReadFd(const Napi::CallbackInfo& info) {
  int fd;
  if (!IntArg(info, 0, fd)) return info.Env().Undefined();
  const int length = info.Length() > 1 && info[1].IsNumber() ? info[1].As<Napi::Number>().Int32Value() : 256;
  std::string data(static_cast<size_t>(std::max(0, length)), '\0');
  const ssize_t n = pread(fd, &data[0], data.size(), 0);
  return Napi::Buffer<char>::Copy(info.Env(), data.data(), n < 0 ? 0 : static_cast<size_t>(n));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createFdChannel", Napi::Function::New(env, CreateFdChannel));
  exports.Set("startReceiver", Napi::Function::New(env, StartReceiver));
  exports.Set("stopReceiver", Napi::Function::New(env, StopReceiver));
  exports.Set("closeFd", Napi::Function::New(env, CloseFd));
  exports.Set("sendFd", Napi::Function::New(env, SendFd));
  exports.Set("readFd", Napi::Function::New(env, ReadFd));
  return exports;
}

}  // namespace

NODE_API_MODULE(yall_fdpass, Init)
