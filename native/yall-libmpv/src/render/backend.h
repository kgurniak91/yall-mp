#pragma once
// Render backend interface. A backend owns the GPU/CPU resources and the mpv render context for one
// attach. Everything except Release() and FillStats() runs on the render thread.
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include "../mpv_loader.h"
#include "../ring_stats.h"

struct Frame {
  uint64_t attachId = 0;
  int slotId = -1;           // shared backends: pool slot; readback: -1
  uint64_t serial = 0;       // bumped on every hand-off of a slot, so a stale release can be told apart
  uint32_t generation = 0;   // bumped by resize()
  int width = 0;
  int height = 0;
  uint64_t handle = 0;       // shared backends: NT handle value / IOSurfaceRef
  std::shared_ptr<std::vector<uint8_t>> pixels;  // readback: tightly packed BGRA, alpha = 255
  // GL shared backends, first frames only: BGRA of five points (centre and the four quarter points) read from the
  // rendered buffer, so the client can tell a black import from a black video.
  bool hasProbe = false;
  uint8_t probe[20] = {};
};

struct AdapterInfo {
  std::string name;
  uint32_t vendorId = 0;
  uint32_t deviceId = 0;
  int64_t luidHigh = 0;
  uint32_t luidLow = 0;
  bool software = false;
  bool matched = false;        // a requested vendor/device was found among the DXGI adapters
  std::string selection;       // "default" | "warp" | "match" | "default-no-match" | "warp-fallback"
};

struct PercentileStats {
  double p50 = 0, p95 = 0, max = 0;
};

inline PercentileStats Summarize(const RingStats& r) { return {r.Percentile(0.5), r.Percentile(0.95), r.Max()}; }

struct BackendStats {
  std::string backend;     // d3d11-shared | iosurface-shared | readback
  std::string impl;        // d3d11 | gl | sw
  std::string gpuWaitImpl; // fence | enqueue-event | query-poll | finish | none
  AdapterInfo adapter;
  int poolSize = 0;
  int inFlight = 0;
  uint64_t rendered = 0;
  uint64_t exhausted = 0;
  uint64_t released = 0;
  uint64_t lateReleases = 0;
  uint64_t reclaimed = 0;
  uint64_t gpuWaitTimeouts = 0;
  PercentileStats renderMs, gpuWaitMs, releaseMs, copyMs;
  double renderCpuMs = 0;  // render-thread CPU spent inside mpv_render_context_render
  double waitCpuMs = 0;    // render-thread CPU spent waiting for the GPU (about 0 when event based)
  uint64_t glErrors = 0;   // GL backends: glGetError() results other than GL_NO_ERROR
  std::string note;        // backend-specific diagnostics (GL version/renderer, first GL errors), for logs
};

// Reusable pixel buffers, so a steady stream of readback frames does not allocate per frame.
class PixelPool : public std::enable_shared_from_this<PixelPool> {
 public:
  std::shared_ptr<std::vector<uint8_t>> Acquire(size_t bytes) {
    std::unique_ptr<std::vector<uint8_t>> v;
    {
      std::lock_guard<std::mutex> lock(mu_);
      if (!free_.empty()) {
        v = std::move(free_.back());
        free_.pop_back();
      }
    }
    if (!v) v = std::make_unique<std::vector<uint8_t>>();
    v->resize(bytes);
    auto self = shared_from_this();
    return std::shared_ptr<std::vector<uint8_t>>(v.release(), [self](std::vector<uint8_t>* p) { self->Return(p); });
  }

 private:
  void Return(std::vector<uint8_t>* p) {
    std::lock_guard<std::mutex> lock(mu_);
    if (free_.size() < 4) {
      free_.emplace_back(p);
    } else {
      delete p;
    }
  }
  std::mutex mu_;
  std::vector<std::unique_ptr<std::vector<uint8_t>>> free_;
};

class RenderBackend {
 public:
  virtual ~RenderBackend() = default;

  // Creates the device resources and the mpv render context. Returns an error message, empty on success.
  virtual std::string Init(mpv_handle* handle) = 0;
  virtual mpv_render_context* Context() = 0;
  // Clears the update callback and frees the render context (render thread, before the core is destroyed).
  virtual void FreeContext() = 0;
  // First and last thing the render thread does for this backend (GL backends make their context current
  // there and give it up again). Init() runs on the thread that attaches, so a GL backend releases the
  // context at the end of Init(). OnThreadStop runs after FreeContext() and before the drain phase.
  virtual void OnThreadStart() {}
  virtual void OnThreadStop() {}

  // Renders one frame at w x h. False when the frame was skipped (pool exhausted, GPU wait timeout, ...).
  virtual bool Render(int w, int h, uint32_t generation, Frame& out) = 0;
  // Any thread. Stale (slot, serial) pairs are ignored and counted.
  virtual void Release(int slotId, uint64_t serial) = 0;
  // In-flight slots older than the timeout are abandoned instead of reused.
  virtual void ReclaimExpired(int timeoutMs) = 0;
  virtual int InFlight() = 0;
  // Frees every remaining resource, whether released or not.
  virtual void ReleaseAll() = 0;

  virtual bool IsReadback() const = 0;
  virtual void FillStats(BackendStats& out) = 0;
};
