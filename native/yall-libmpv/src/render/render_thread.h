#pragma once
// One render thread per attach. It owns the backend: waits for mpv's update callback, renders, hands the
// frame to the sink, and on detach frees the render context and then drains (waits for in-flight slots
// to be released or for the slot timeout) before freeing the backend's resources.
#include <atomic>
#include <climits>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <thread>
#include "backend.h"

// Receives frames on the render thread. Implemented by the N-API glue in core_render.cpp.
class FrameSink {
 public:
  virtual ~FrameSink() = default;
  virtual bool Post(Frame&& frame) = 0;  // false when the frame could not be queued
  virtual int Outstanding() = 0;         // readback frames queued or being delivered
  virtual void Close() = 0;              // the render thread will not post anymore
};

struct RenderThreadStats {
  BackendStats backend;
  uint64_t attachId = 0;
  uint32_t generation = 0;
  int width = 0, height = 0;
  uint64_t readbackDropped = 0;
  uint64_t postFailures = 0;
  double threadCpuMs = 0;   // CPU time of the render thread since attach
  double threadWallMs = 0;  // wall time since attach
  bool detached = false;
};

class RenderThread {
 public:
  RenderThread(uint64_t attachId, std::unique_ptr<RenderBackend> backend, std::unique_ptr<FrameSink> sink,
               int width, int height, int slotTimeoutMs);
  ~RenderThread();

  // Creates the render context and starts the thread. Returns an error message, empty on success.
  std::string Start(mpv_handle* handle);

  // Non-blocking. Idempotent.
  void Detach();
  void Resize(int w, int h);
  void Release(int slotId, uint64_t serial);
  RenderThreadStats Stats();

  uint64_t AttachId() const { return attachId_; }
  bool IsDetached() const { return stop_; }
  bool ContextFreed() const { return contextFreed_; }
  bool Finished() const { return finished_; }
  // Waits until the render context is freed (needed before mpv_terminate_destroy). False on timeout.
  bool WaitContextFreed(int timeoutMs);
  // Ends the drain phase now: remaining slots are freed even if not released.
  void ForceDrainEnd();
  // Caps the drain phase at `ms` from its start (core destroy: nobody will come back for the slots, but
  // frames already queued towards JS still get a moment to be released).
  void LimitDrain(int ms) { drainCapMs_ = ms; }
  void Join();

 private:
  static void OnUpdate(void* self);
  void Run();

  const uint64_t attachId_;
  std::unique_ptr<RenderBackend> backend_;
  std::unique_ptr<FrameSink> sink_;
  const int slotTimeoutMs_;

  std::mutex mu_;
  std::condition_variable cv_;
  bool updatePending_ = false;
  bool force_ = false;
  int w_, h_;
  uint32_t gen_ = 1;

  std::atomic<bool> stop_{false};
  std::atomic<bool> forceDrainEnd_{false};
  std::atomic<int> drainCapMs_{INT_MAX};
  std::atomic<bool> contextFreed_{false};
  std::atomic<bool> finished_{false};
  std::atomic<bool> started_{false};
  std::thread thread_;

  std::mutex statsMu_;
  double threadCpuMs_ = 0;
  double threadWallMs_ = 0;
  uint64_t readbackDropped_ = 0;
  uint64_t postFailures_ = 0;
};
