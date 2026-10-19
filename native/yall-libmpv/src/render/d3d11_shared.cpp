#ifdef _WIN32
#include "d3d11_shared.h"
#include "../core.h"
#include "../thread_cpu.h"

using Microsoft::WRL::ComPtr;
using Clock = std::chrono::steady_clock;

namespace {
constexpr DWORD kGpuWaitTimeoutMs = 1000;

double MsSince(Clock::time_point t) { return std::chrono::duration<double, std::milli>(Clock::now() - t).count(); }
}  // namespace

std::string D3D11SharedBackend::Init(mpv_handle* handle) {
  d3d_ = std::make_unique<D3D11Device>();
  std::string err = d3d_->Init(adapterRequest_);
  if (!err.empty()) return err;
  adapterInfo_ = d3d_->info;
  gpuWaitImpl_ = d3d_->waiter.Impl();

  mpv_d3d11_init_params initParams{d3d_->device.Get()};
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_D3D11)},
      {MPV_RENDER_PARAM_D3D11_INIT_PARAMS, &initParams},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  int rc = mpv.render_context_create(&rc_, handle, params);
  if (rc < 0) return std::string("mpv_render_context_create: ") + mpv.error_string(rc);
  slots_.reserve(static_cast<size_t>(maxSlots_));
  return "";
}

void D3D11SharedBackend::FreeContext() {
  if (!rc_) return;
  mpv.render_context_set_update_callback(rc_, nullptr, nullptr);
  mpv.render_context_free(rc_);
  rc_ = nullptr;
}

bool D3D11SharedBackend::CreateSlotTexture(Slot& s, int w, int h) {
  D3D11_TEXTURE2D_DESC d{};
  d.Width = static_cast<UINT>(w);
  d.Height = static_cast<UINT>(h);
  d.MipLevels = 1;
  d.ArraySize = 1;
  d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT;
  d.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  // BGRA has no keyed mutex: ordering is "GPU-complete wait before hand-off" and "never render into a
  // slot before it was released".
  d.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
  if (FAILED(d3d_->device->CreateTexture2D(&d, nullptr, &s.tex))) return false;
  ComPtr<IDXGIResource1> res;
  if (FAILED(s.tex.As(&res)) ||
      FAILED(res->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr,
                                     &s.nt))) {
    s.tex.Reset();
    return false;
  }
  s.w = w;
  s.h = h;
  Counts().slots++;
  return true;
}

void D3D11SharedBackend::DestroySlotTexture(Slot& s) {
  if (!s.tex && !s.nt) return;
  if (s.nt) CloseHandle(s.nt);
  s.nt = nullptr;
  s.tex.Reset();
  Counts().slots--;
}

int D3D11SharedBackend::AcquireSlot(int w, int h, uint32_t gen) {
  for (size_t i = 0; i < slots_.size(); i++) {
    Slot& s = slots_[i];
    if (s.state != State::Free) continue;
    if (!s.tex || s.gen != gen || s.w != w || s.h != h) {
      DestroySlotTexture(s);
      if (!CreateSlotTexture(s, w, h)) continue;
      s.gen = gen;
    }
    return static_cast<int>(i);
  }
  if (static_cast<int>(slots_.size()) < maxSlots_) {
    slots_.emplace_back();
    Slot& s = slots_.back();
    if (!CreateSlotTexture(s, w, h)) {
      slots_.pop_back();
      return -1;
    }
    s.gen = gen;
    return static_cast<int>(slots_.size() - 1);
  }
  return -1;
}

bool D3D11SharedBackend::Render(int w, int h, uint32_t gen, Frame& out) {
  int index;
  ID3D11Texture2D* tex;
  HANDLE nt;
  {
    std::lock_guard<std::mutex> lock(mu_);
    index = AcquireSlot(w, h, gen);
    if (index < 0) {
      // Pool exhausted: skip this frame, the next update delivers a fresh one.
      exhausted_++;
      return false;
    }
    slots_[static_cast<size_t>(index)].state = State::Rendering;
    tex = slots_[static_cast<size_t>(index)].tex.Get();
    nt = slots_[static_cast<size_t>(index)].nt;
  }

  auto t0 = Clock::now();
  double cpu0 = ThreadCpuMs();
  mpv_d3d11_fbo fbo{tex};
  mpv_render_param rp[] = {{MPV_RENDER_PARAM_D3D11_FBO, &fbo}, {MPV_RENDER_PARAM_INVALID, nullptr}};
  mpv.render_context_render(rc_, rp);
  double cpu1 = ThreadCpuMs();
  auto t1 = Clock::now();
  bool done = d3d_->waiter.Wait(kGpuWaitTimeoutMs);
  double cpu2 = ThreadCpuMs();
  auto t2 = Clock::now();

  std::lock_guard<std::mutex> lock(mu_);
  Slot& s = slots_[static_cast<size_t>(index)];
  renderCpuMs_ += cpu1 - cpu0;
  waitCpuMs_ += cpu2 - cpu1;
  if (!done) {
    s.state = State::Free;
    gpuWaitTimeouts_++;
    return false;
  }
  s.state = State::InFlight;
  s.serial++;
  s.sentAt = Clock::now();
  rendered_++;
  renderMs_.Push(std::chrono::duration<double, std::milli>(t1 - t0).count());
  gpuWaitMs_.Push(std::chrono::duration<double, std::milli>(t2 - t1).count());

  out.slotId = index;
  out.serial = s.serial;
  out.generation = gen;
  out.width = w;
  out.height = h;
  out.handle = reinterpret_cast<uint64_t>(nt);
  return true;
}

void D3D11SharedBackend::Release(int slotId, uint64_t serial) {
  std::lock_guard<std::mutex> lock(mu_);
  if (slotId < 0 || slotId >= static_cast<int>(slots_.size())) {
    lateReleases_++;
    return;
  }
  Slot& s = slots_[static_cast<size_t>(slotId)];
  if (s.state != State::InFlight || s.serial != serial) {
    lateReleases_++;
    return;
  }
  releaseMs_.Push(MsSince(s.sentAt));
  released_++;
  s.state = State::Free;
}

void D3D11SharedBackend::ReclaimExpired(int timeoutMs) {
  std::lock_guard<std::mutex> lock(mu_);
  for (Slot& s : slots_) {
    if (s.state != State::InFlight || MsSince(s.sentAt) < timeoutMs) continue;
    // Never reuse a texture the consumer may still hold: drop our references (Chromium keeps its own
    // after import) and recreate the slot on the next acquire. The serial bump makes a late release stale.
    DestroySlotTexture(s);
    s.serial++;
    s.state = State::Free;
    reclaimed_++;
  }
}

int D3D11SharedBackend::InFlight() {
  std::lock_guard<std::mutex> lock(mu_);
  int n = 0;
  for (const Slot& s : slots_) {
    if (s.state == State::InFlight) n++;
  }
  return n;
}

void D3D11SharedBackend::ReleaseAll() {
  {
    std::lock_guard<std::mutex> lock(mu_);
    for (Slot& s : slots_) DestroySlotTexture(s);
    slots_.clear();
  }
  d3d_.reset();
}

void D3D11SharedBackend::FillStats(BackendStats& out) {
  std::lock_guard<std::mutex> lock(mu_);
  out.backend = "d3d11-shared";
  out.impl = "d3d11";
  out.gpuWaitImpl = gpuWaitImpl_;
  out.adapter = adapterInfo_;
  out.poolSize = static_cast<int>(slots_.size());
  int inFlight = 0;
  for (const Slot& s : slots_) {
    if (s.state == State::InFlight) inFlight++;
  }
  out.inFlight = inFlight;
  out.rendered = rendered_;
  out.exhausted = exhausted_;
  out.released = released_;
  out.lateReleases = lateReleases_;
  out.reclaimed = reclaimed_;
  out.gpuWaitTimeouts = gpuWaitTimeouts_;
  out.renderMs = Summarize(renderMs_);
  out.gpuWaitMs = Summarize(gpuWaitMs_);
  out.releaseMs = Summarize(releaseMs_);
  out.renderCpuMs = renderCpuMs_;
  out.waitCpuMs = waitCpuMs_;
}
#endif
