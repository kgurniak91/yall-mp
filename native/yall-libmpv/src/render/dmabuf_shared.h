#pragma once
#if defined(__linux__) && defined(YALL_HAVE_DMABUF)
// Pool of dma-buf backed render targets (Linux). mpv renders with its OpenGL API into a free slot's FBO on an EGL
// context created on a DRM node, glFinish makes the pixels visible to other processes, and the slot's dma-buf
// descriptor (sent once per slot to the client, see `SendFd`) is what the client imports. The slot stays InFlight
// until the client releases it or the timeout reclaims it.
#include <chrono>
#include <functional>
#include <mutex>
#include <vector>
#include <mpv/render_gl.h>
#include "backend.h"
#include "egl_context.h"

class DmabufSharedBackend : public RenderBackend {
 public:
  // Called when a slot gets (or loses) its buffer. `SendFd` delivers a descriptor and its JSON description to the
  // client; both run on the render thread.
  using SendFd = std::function<bool(int fd, const std::string& meta)>;
  using SlotClosed = std::function<void(int slotId)>;

  DmabufSharedBackend(uint64_t attachId, int maxSlots, EglOptions options, SendFd sendFd, SlotClosed slotClosed)
      : attachId_(attachId),
        maxSlots_(maxSlots),
        options_(std::move(options)),
        sendFd_(std::move(sendFd)),
        slotClosed_(std::move(slotClosed)) {}
  ~DmabufSharedBackend() override { ReleaseAll(); }

  std::string Init(mpv_handle* handle) override;
  mpv_render_context* Context() override { return rc_; }
  void FreeContext() override;
  void OnThreadStart() override;
  void OnThreadStop() override;
  bool Render(int w, int h, uint32_t generation, Frame& out) override;
  void Release(int slotId, uint64_t serial) override;
  void ReclaimExpired(int timeoutMs) override;
  int InFlight() override;
  void ReleaseAll() override;
  bool IsReadback() const override { return false; }
  void FillStats(BackendStats& out) override;

 private:
  enum class State { Free, Rendering, InFlight };
  struct Slot {
    DmabufTarget target;
    uint32_t gen = 0;
    State state = State::Free;
    uint64_t serial = 0;
    bool announced = false;  // the client has been sent this buffer's descriptor
    std::chrono::steady_clock::time_point sentAt;
  };

  bool CreateSlotTarget(int index, Slot& s, int w, int h, uint32_t gen);
  void DestroySlotTarget(int index, Slot& s, bool notify);
  int AcquireSlot(int w, int h, uint32_t gen);  // mu_ held, GL context current

  uint64_t attachId_;
  int maxSlots_;
  EglOptions options_;
  SendFd sendFd_;
  SlotClosed slotClosed_;
  EglContext egl_;
  mpv_render_context* rc_ = nullptr;

  std::mutex mu_;
  std::vector<Slot> slots_;
  int probeFramesLeft_ = kProbeFrames;  // frames that carry probe samples (the client's validation window)
  uint64_t rendered_ = 0, exhausted_ = 0, released_ = 0, lateReleases_ = 0, reclaimed_ = 0, sendFailures_ = 0;
  RingStats renderMs_, gpuWaitMs_, releaseMs_;
  double renderCpuMs_ = 0, waitCpuMs_ = 0;
  AdapterInfo adapterInfo_;
};
#endif
