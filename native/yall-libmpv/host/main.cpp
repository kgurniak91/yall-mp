// yall-mpv-host: runs libmpv in its own process and speaks the protocol of protocol.h on fd 3.
// On Linux libmpv cannot live in the Electron main process (it would bind to Electron's bundled ffmpeg).
#include <clocale>
#include <csignal>
#include <cstdio>
#include <cstring>
#include <sys/mman.h>
#include <sys/prctl.h>
#include <unistd.h>
#include "fd_sender.h"
#include "host_core.h"
#include "mpv_loader.h"
#ifdef YALL_HAVE_DMABUF
#include "render/egl_context.h"
#endif

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

#ifdef YALL_HAVE_DMABUF
// `yall-mpv-host --egl-selftest [vendorHex deviceHex]`: opens EGL on a DRM node, renders a colour into a
// dma-buf backed target and reads it back. Prints one JSON object; exit code 0 when the path works.
int EglSelfTest(uint32_t vendorId, uint32_t deviceId) {
  proto::Json out;
  EglContext egl;
  EglOptions options;
  options.vendorId = vendorId;
  options.deviceId = deviceId;
  std::string err = egl.Open(options);
  if (!err.empty()) {
    out = {{"ok", false}, {"error", err}};
  } else {
    out = {{"ok", false}, {"node", egl.Node()}, {"renderNode", egl.IsRenderNode()}, {"glVersion", egl.GlVersion()},
           {"glRenderer", egl.GlRenderer()}, {"glVendor", egl.GlVendor()}, {"eglVendor", egl.EglVendor()},
           {"software", egl.Software()}, {"gles", egl.Gles()}};
    if (!egl.MakeCurrent()) {
      out["error"] = "MakeCurrent failed";
    } else {
      DmabufTarget target;
      std::string error;
      if (!egl.CreateTarget(64, 32, target, error)) {
        out["error"] = error;
      } else {
        egl.Clear(target, 1.f, 0.f, 0.f, 1.f);
        uint8_t px[4] = {0, 0, 0, 0};
        egl.ReadPixel(target, 10, 10, px);
        out["stride"] = target.stride;
        out["offset"] = target.offset;
        out["modifier"] = std::to_string(target.modifier);
        out["pixel"] = {px[0], px[1], px[2], px[3]};
        out["ok"] = px[2] == 255 && px[1] == 0 && px[0] == 0;
        egl.DestroyTarget(target);
      }
      egl.Release();
    }
    out["glErrors"] = egl.GlErrors();
    out["notes"] = egl.Notes();
  }
  std::printf("%s\n", out.dump(-1, ' ', false, proto::Json::error_handler_t::replace).c_str());
  return out["ok"].get<bool>() ? 0 : 1;
}
#endif

// `yall-mpv-host --fd-selftest`: sends a memfd holding "yall-fd-test" over fd 4 and exits (test support).
int FdSelfTest() {
  FdSender sender(proto::kFdChannelFd);
  if (!sender.Available()) {
    std::printf("{\"ok\":false,\"error\":\"fd 4 is not a seqpacket socket\"}\n");
    return 1;
  }
  const int fd = memfd_create("yall-fd-test", MFD_CLOEXEC);
  const char text[] = "yall-fd-test";
  if (fd < 0 || write(fd, text, sizeof(text) - 1) != static_cast<ssize_t>(sizeof(text) - 1) || !sender.Send(fd, "{\"slotId\":7}")) {
    std::printf("{\"ok\":false,\"error\":\"send failed\"}\n");
    return 1;
  }
  close(fd);
  std::printf("{\"ok\":true}\n");
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  setlocale(LC_NUMERIC, "C");
  signal(SIGPIPE, SIG_IGN);
  if (argc == 3 && std::strcmp(argv[1], "--probe") == 0) {
    return Probe(argv[2]);
  }
  if (argc == 2 && std::strcmp(argv[1], "--fd-selftest") == 0) {
    return FdSelfTest();
  }
  if (argc >= 2 && std::strcmp(argv[1], "--egl-selftest") == 0) {
#ifdef YALL_HAVE_DMABUF
    return EglSelfTest(argc >= 4 ? std::strtoul(argv[2], nullptr, 16) : 0, argc >= 4 ? std::strtoul(argv[3], nullptr, 16) : 0);
#else
    std::printf("{\"ok\":false,\"error\":\"built without EGL/GBM headers\"}\n");
    return 1;
#endif
  }

  // The client owns this process: when it dies the host must not linger (it may hold the audio device).
  const pid_t parent = getppid();
  prctl(PR_SET_PDEATHSIG, SIGKILL);
  if (getppid() != parent) return 1;

  proto::Channel channel(kSocketFd);
  FdSender fdSender(proto::kFdChannelFd);
  HostCore core(channel, &fdSender);
  proto::Message message;
  while (channel.Read(message)) {
    if (!core.Handle(std::move(message))) {
      return 0;
    }
  }
  core.Shutdown();
  return 0;
}
