#pragma once
#ifdef _WIN32
// Readback through D3D11: render into a private texture, copy it to a staging texture, wait for the GPU
// with the event-based waiter, then Map and copy the rows out. Works on hardware and on WARP.
#include <mutex>
#include "backend.h"
#include "d3d11_device.h"

class D3D11ReadbackBackend : public RenderBackend {
 public:
  explicit D3D11ReadbackBackend(AdapterRequest adapter) : adapterRequest_(adapter) {}
  ~D3D11ReadbackBackend() override { ReleaseAll(); }

  std::string Init(mpv_handle* handle) override;
  mpv_render_context* Context() override { return rc_; }
  void FreeContext() override;
  bool Render(int w, int h, uint32_t generation, Frame& out) override;
  void Release(int, uint64_t) override {}
  void ReclaimExpired(int) override {}
  int InFlight() override { return 0; }
  void ReleaseAll() override;
  bool IsReadback() const override { return true; }
  void FillStats(BackendStats& out) override;

 private:
  AdapterRequest adapterRequest_;
  std::unique_ptr<D3D11Device> d3d_;
  mpv_render_context* rc_ = nullptr;
  Microsoft::WRL::ComPtr<ID3D11Texture2D> rt_, staging_;
  int rtW_ = 0, rtH_ = 0;
  std::shared_ptr<PixelPool> pool_ = std::make_shared<PixelPool>();

  std::mutex mu_;
  uint64_t rendered_ = 0, gpuWaitTimeouts_ = 0;
  RingStats renderMs_, gpuWaitMs_, copyMs_;
  double renderCpuMs_ = 0, waitCpuMs_ = 0;
  AdapterInfo adapterInfo_;
  std::string gpuWaitImpl_ = "none";
};
#endif
