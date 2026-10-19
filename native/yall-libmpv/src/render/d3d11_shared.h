#pragma once
#ifdef _WIN32
// Pool of shared NT-handle textures. mpv renders into a free slot, the GPU is awaited, then the slot is
// handed to JS (Electron sharedTexture) and stays InFlight until JS releases it or the timeout reclaims it.
#include <chrono>
#include <memory>
#include <mutex>
#include <vector>
#include "backend.h"
#include "d3d11_device.h"

class D3D11SharedBackend : public RenderBackend {
 public:
  D3D11SharedBackend(AdapterRequest adapter, int maxSlots) : adapterRequest_(adapter), maxSlots_(maxSlots) {}
  ~D3D11SharedBackend() override { ReleaseAll(); }

  std::string Init(mpv_handle* handle) override;
  mpv_render_context* Context() override { return rc_; }
  void FreeContext() override;
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
    Microsoft::WRL::ComPtr<ID3D11Texture2D> tex;
    HANDLE nt = nullptr;
    int w = 0, h = 0;
    uint32_t gen = 0;
    State state = State::Free;
    uint64_t serial = 0;
    std::chrono::steady_clock::time_point sentAt;
  };

  bool CreateSlotTexture(Slot& s, int w, int h);
  void DestroySlotTexture(Slot& s);
  int AcquireSlot(int w, int h, uint32_t gen);  // mu_ held

  AdapterRequest adapterRequest_;
  int maxSlots_;
  std::unique_ptr<D3D11Device> d3d_;
  mpv_render_context* rc_ = nullptr;

  std::mutex mu_;
  std::vector<Slot> slots_;
  uint64_t rendered_ = 0, exhausted_ = 0, released_ = 0, lateReleases_ = 0, reclaimed_ = 0, gpuWaitTimeouts_ = 0;
  RingStats renderMs_, gpuWaitMs_, releaseMs_;
  double renderCpuMs_ = 0, waitCpuMs_ = 0;
  AdapterInfo adapterInfo_;
  std::string gpuWaitImpl_ = "none";
};
#endif
