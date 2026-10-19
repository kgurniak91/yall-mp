#pragma once
// Readback through mpv's software renderer (MPV_RENDER_API_TYPE_SW). The only readback path off
// Windows until GL backends exist. mpv scales and converts on the CPU, so the frame size
// is capped by the caller.
#include <mutex>
#include "backend.h"

class SwReadbackBackend : public RenderBackend {
 public:
  ~SwReadbackBackend() override { ReleaseAll(); }

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
  mpv_render_context* rc_ = nullptr;
  uint8_t* scratch_ = nullptr;  // 64-byte aligned, stride is a multiple of 64
  size_t scratchBytes_ = 0;
  std::shared_ptr<PixelPool> pool_ = std::make_shared<PixelPool>();

  std::mutex mu_;
  uint64_t rendered_ = 0;
  RingStats renderMs_, copyMs_;
  double renderCpuMs_ = 0;
};
