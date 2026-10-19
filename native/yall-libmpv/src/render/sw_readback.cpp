#include "sw_readback.h"
#include <chrono>
#include <cstdlib>
#include <cstring>
#include "../thread_cpu.h"

#ifdef _WIN32
#include <malloc.h>
#endif

using Clock = std::chrono::steady_clock;

namespace {

uint8_t* AlignedAlloc(size_t bytes) {
#ifdef _WIN32
  return static_cast<uint8_t*>(_aligned_malloc(bytes, 64));
#else
  void* p = nullptr;
  return posix_memalign(&p, 64, bytes) == 0 ? static_cast<uint8_t*>(p) : nullptr;
#endif
}

void AlignedFree(uint8_t* p) {
#ifdef _WIN32
  _aligned_free(p);
#else
  free(p);
#endif
}

double MsBetween(Clock::time_point a, Clock::time_point b) {
  return std::chrono::duration<double, std::milli>(b - a).count();
}

}  // namespace

std::string SwReadbackBackend::Init(mpv_handle* handle) {
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_SW)},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  int rc = mpv.render_context_create(&rc_, handle, params);
  if (rc < 0) return std::string("mpv_render_context_create (sw): ") + mpv.error_string(rc);
  return "";
}

void SwReadbackBackend::FreeContext() {
  if (!rc_) return;
  mpv.render_context_set_update_callback(rc_, nullptr, nullptr);
  mpv.render_context_free(rc_);
  rc_ = nullptr;
}

bool SwReadbackBackend::Render(int w, int h, uint32_t gen, Frame& out) {
  const size_t stride = (static_cast<size_t>(w) * 4 + 63) & ~static_cast<size_t>(63);
  const size_t needed = stride * static_cast<size_t>(h);
  if (needed > scratchBytes_) {
    AlignedFree(scratch_);
    scratch_ = AlignedAlloc(needed);
    scratchBytes_ = scratch_ ? needed : 0;
    if (!scratch_) return false;
  }

  auto t0 = Clock::now();
  double cpu0 = ThreadCpuMs();
  int size[2] = {w, h};
  size_t strideParam = stride;
  mpv_render_param rp[] = {
      {MPV_RENDER_PARAM_SW_SIZE, size},
      {MPV_RENDER_PARAM_SW_FORMAT, const_cast<char*>("bgr0")},
      {MPV_RENDER_PARAM_SW_STRIDE, &strideParam},
      {MPV_RENDER_PARAM_SW_POINTER, scratch_},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  int rc = mpv.render_context_render(rc_, rp);
  auto t1 = Clock::now();
  if (rc < 0) return false;

  // "bgr0" leaves the fourth byte undefined; force it opaque so the result is plain BGRA for canvas upload.
  const size_t rowPixels = static_cast<size_t>(w);
  auto pixels = pool_->Acquire(rowPixels * 4 * static_cast<size_t>(h));
  for (int y = 0; y < h; y++) {
    const uint32_t* src = reinterpret_cast<const uint32_t*>(scratch_ + static_cast<size_t>(y) * stride);
    uint32_t* dst = reinterpret_cast<uint32_t*>(pixels->data() + static_cast<size_t>(y) * rowPixels * 4);
    for (size_t x = 0; x < rowPixels; x++) dst[x] = src[x] | 0xFF000000u;
  }
  auto t2 = Clock::now();
  double cpu1 = ThreadCpuMs();

  {
    std::lock_guard<std::mutex> lock(mu_);
    rendered_++;
    renderMs_.Push(MsBetween(t0, t1));
    copyMs_.Push(MsBetween(t1, t2));
    renderCpuMs_ += cpu1 - cpu0;
  }
  out.pixels = std::move(pixels);
  out.generation = gen;
  out.width = w;
  out.height = h;
  return true;
}

void SwReadbackBackend::ReleaseAll() {
  AlignedFree(scratch_);
  scratch_ = nullptr;
  scratchBytes_ = 0;
}

void SwReadbackBackend::FillStats(BackendStats& out) {
  std::lock_guard<std::mutex> lock(mu_);
  out.backend = "readback";
  out.impl = "sw";
  out.gpuWaitImpl = "none";
  out.adapter.name = "mpv software renderer";
  out.adapter.software = true;
  out.adapter.selection = "sw";
  out.rendered = rendered_;
  out.renderMs = Summarize(renderMs_);
  out.copyMs = Summarize(copyMs_);
  out.renderCpuMs = renderCpuMs_;
}
