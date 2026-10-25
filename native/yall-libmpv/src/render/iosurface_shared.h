#pragma once
#ifdef __APPLE__
// Pool of IOSurface-backed render targets. mpv renders (OpenGL render API, core profile) into a free slot's
// FBO, glFinish makes the pixels visible to other processes, then the IOSurfaceRef is handed to JS (Electron
// sharedTexture). The slot stays InFlight until JS releases it or the timeout reclaims it.
#include <OpenGL/OpenGL.h>
#include <IOSurface/IOSurfaceRef.h>
#include <chrono>
#include <mutex>
#include <vector>
#include "backend.h"

class IOSurfaceSharedBackend : public RenderBackend {
 public:
  explicit IOSurfaceSharedBackend(int maxSlots) : maxSlots_(maxSlots) {}
  ~IOSurfaceSharedBackend() override { ReleaseAll(); }

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
    IOSurfaceRef surface = nullptr;
    unsigned int texture = 0;
    unsigned int fbo = 0;
    int w = 0, h = 0;
    uint32_t gen = 0;
    State state = State::Free;
    uint64_t serial = 0;
    std::chrono::steady_clock::time_point sentAt;
  };

  bool MakeCurrent();
  bool CreateSlotTarget(Slot& s, int w, int h);
  void DestroySlotTarget(Slot& s);
  int AcquireSlot(int w, int h, uint32_t gen);  // mu_ held, GL context current
  // Reads glGetError() until it is clear; counts the errors and keeps the first few as text.
  void CheckGl(const char* where);
  void Note(const std::string& text);  // mu_ held, or single-threaded (Init)

  int maxSlots_;
  int probeFramesLeft_ = kProbeFrames;
  CGLContextObj ctx_ = nullptr;
  mpv_render_context* rc_ = nullptr;

  std::mutex mu_;
  std::vector<Slot> slots_;
  uint64_t rendered_ = 0, exhausted_ = 0, released_ = 0, lateReleases_ = 0, reclaimed_ = 0;
  RingStats renderMs_, gpuWaitMs_, releaseMs_;
  double renderCpuMs_ = 0, waitCpuMs_ = 0;
  AdapterInfo adapterInfo_;
  uint64_t glErrors_ = 0;
  std::vector<std::string> notes_;
  bool verbose_ = false;
};

// Test support: reads the BGRA pixel at (x, y) of a live IOSurface (the 8-byte handle of a delivered frame).
// False when the handle is null or the position is outside the surface.
bool ReadIOSurfacePixel(uint64_t handle, int x, int y, uint8_t out[4]);
#endif
