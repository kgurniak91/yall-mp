#include "render_thread.h"
#include <algorithm>
#include <chrono>
#include "../live_counts.h"
#include "../thread_cpu.h"

using Clock = std::chrono::steady_clock;

namespace {
// Readback frames queued towards JS before new ones are skipped.
constexpr int kMaxOutstandingReadback = 2;
constexpr auto kTick = std::chrono::milliseconds(250);
}  // namespace

RenderThread::RenderThread(uint64_t attachId, std::unique_ptr<RenderBackend> backend,
                           std::unique_ptr<FrameSink> sink, int width, int height, int slotTimeoutMs)
    : attachId_(attachId),
      backend_(std::move(backend)),
      sink_(std::move(sink)),
      slotTimeoutMs_(slotTimeoutMs),
      w_(width),
      h_(height) {}

RenderThread::~RenderThread() {
  Detach();
  ForceDrainEnd();
  Join();
  if (sink_) sink_->Close();  // idempotent; covers a thread that never started
}

std::string RenderThread::Start(mpv_handle* handle) {
  std::string err = backend_->Init(handle);
  if (!err.empty()) {
    backend_->FreeContext();
    backend_->ReleaseAll();
    return err;
  }
  Counts().renderers++;
  // render.h: the callback may run on any thread and must not call into mpv; it only signals.
  mpv.render_context_set_update_callback(backend_->Context(), &RenderThread::OnUpdate, this);
  started_ = true;
  thread_ = std::thread(&RenderThread::Run, this);
  return "";
}

void RenderThread::OnUpdate(void* self) {
  auto* t = static_cast<RenderThread*>(self);
  {
    std::lock_guard<std::mutex> lock(t->mu_);
    t->updatePending_ = true;
  }
  t->cv_.notify_one();
}

void RenderThread::Detach() {
  {
    std::lock_guard<std::mutex> lock(mu_);
    stop_ = true;
  }
  cv_.notify_all();
}

void RenderThread::ForceDrainEnd() {
  forceDrainEnd_ = true;
  cv_.notify_all();
}

void RenderThread::Resize(int w, int h) {
  {
    std::lock_guard<std::mutex> lock(mu_);
    if (w == w_ && h == h_) return;
    w_ = w;
    h_ = h;
    gen_++;
    force_ = true;  // redraw even when paused, so the picture follows the new size
  }
  cv_.notify_one();
}

void RenderThread::Release(int slotId, uint64_t serial) {
  backend_->Release(slotId, serial);
  cv_.notify_all();  // wakes the drain phase
}

bool RenderThread::WaitContextFreed(int timeoutMs) {
  auto deadline = Clock::now() + std::chrono::milliseconds(timeoutMs);
  while (!contextFreed_ && started_ && !finished_) {
    if (Clock::now() >= deadline) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return true;
}

void RenderThread::Join() {
  if (thread_.joinable()) thread_.join();
}

RenderThreadStats RenderThread::Stats() {
  RenderThreadStats s;
  backend_->FillStats(s.backend);
  s.attachId = attachId_;
  s.detached = stop_;
  {
    std::lock_guard<std::mutex> lock(mu_);
    s.generation = gen_;
    s.width = w_;
    s.height = h_;
  }
  std::lock_guard<std::mutex> lock(statsMu_);
  s.threadCpuMs = threadCpuMs_;
  s.threadWallMs = threadWallMs_;
  s.readbackDropped = readbackDropped_;
  s.postFailures = postFailures_;
  return s;
}

void RenderThread::Run() {
  Counts().renderThreads++;
  const auto startWall = Clock::now();
  const double startCpu = ThreadCpuMs();
  auto publishCpu = [&] {
    std::lock_guard<std::mutex> lock(statsMu_);
    threadCpuMs_ = ThreadCpuMs() - startCpu;
    threadWallMs_ = std::chrono::duration<double, std::milli>(Clock::now() - startWall).count();
  };

  while (true) {
    bool force;
    int w, h;
    uint32_t gen;
    {
      std::unique_lock<std::mutex> lock(mu_);
      cv_.wait_for(lock, kTick, [&] { return updatePending_ || force_ || stop_; });
      if (stop_) break;
      force = force_;
      force_ = false;
      updatePending_ = false;
      w = w_;
      h = h_;
      gen = gen_;
    }
    backend_->ReclaimExpired(slotTimeoutMs_);

    // render.h: mpv_render_context_update() must be called after every update callback.
    uint64_t flags = mpv.render_context_update(backend_->Context());
    if (!(flags & MPV_RENDER_UPDATE_FRAME) && !force) continue;
    if (w <= 0 || h <= 0) continue;

    if (backend_->IsReadback() && sink_->Outstanding() >= kMaxOutstandingReadback) {
      std::lock_guard<std::mutex> lock(statsMu_);
      readbackDropped_++;
      continue;
    }

    Frame frame;
    if (backend_->Render(w, h, gen, frame)) {
      frame.attachId = attachId_;
      int slotId = frame.slotId;
      uint64_t serial = frame.serial;
      if (!sink_->Post(std::move(frame))) {
        // Could not hand the frame over: give the slot back so the pool does not leak.
        if (slotId >= 0) backend_->Release(slotId, serial);
        std::lock_guard<std::mutex> lock(statsMu_);
        postFailures_++;
      }
      mpv.render_context_report_swap(backend_->Context());
    }
    publishCpu();
  }
  publishCpu();

  // Detach: free the render context on this thread (render.h), then stop posting.
  backend_->FreeContext();
  Counts().renderers--;
  contextFreed_ = true;
  sink_->Close();

  // Drain: slots handed to JS stay valid until released or until the timeout.
  const auto drainStart = Clock::now();
  while (!forceDrainEnd_ && backend_->InFlight() > 0) {
    const int limitMs = std::min(slotTimeoutMs_, drainCapMs_.load());
    if (Clock::now() - drainStart >= std::chrono::milliseconds(limitMs)) break;
    std::unique_lock<std::mutex> lock(mu_);
    cv_.wait_for(lock, std::chrono::milliseconds(20));
  }
  backend_->ReleaseAll();
  finished_ = true;
  Counts().renderThreads--;
}
