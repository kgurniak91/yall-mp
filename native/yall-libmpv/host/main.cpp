// yall-mpv-host: runs libmpv in its own process and speaks the protocol of protocol.h on fd 3.
// On Linux libmpv cannot live in the Electron main process (it would bind to Electron's bundled ffmpeg).
#include <clocale>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <sys/prctl.h>
#include <unistd.h>
#include "host_core.h"
#include "mpv_loader.h"

namespace {

constexpr int kSocketFd = 3;

// `yall-mpv-host --probe <path>`: loads the library and prints {"path", "apiVersion"} or {"code", "error"}.
int Probe(const char* path) {
  LoadResult result = LoadMpv(path);
  proto::Json out;
  if (result.ok) {
    out = {{"path", result.path}, {"apiVersion", {result.apiVersion >> 16, result.apiVersion & 0xFFFF}}};
  } else {
    out = {{"code", result.code.empty() ? "LIB_NOT_FOUND" : result.code}, {"error", result.error}};
  }
  std::printf("%s\n", out.dump(-1, ' ', false, proto::Json::error_handler_t::replace).c_str());
  return result.ok ? 0 : 1;
}

}  // namespace

int main(int argc, char** argv) {
  setlocale(LC_NUMERIC, "C");
  signal(SIGPIPE, SIG_IGN);
  if (argc == 3 && std::strcmp(argv[1], "--probe") == 0) {
    return Probe(argv[2]);
  }

  // The client owns this process: when it dies the host must not linger (it may hold the audio device).
  const pid_t parent = getppid();
  prctl(PR_SET_PDEATHSIG, SIGKILL);
  if (getppid() != parent) return 1;

  proto::Channel channel(kSocketFd);
  HostCore core(channel);
  proto::Message message;
  while (channel.Read(message)) {
    if (!core.Handle(std::move(message))) {
      return 0;
    }
  }
  core.Shutdown();
  return 0;
}
