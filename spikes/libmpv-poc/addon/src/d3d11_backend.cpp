#include "d3d11_backend.h"
#include <algorithm>

using Microsoft::WRL::ComPtr;
using Clock = std::chrono::steady_clock;

static void Push(std::vector<double>& v, double x) {
  v.push_back(x);
  if (v.size() > 1200) v.erase(v.begin(), v.begin() + 600);
}

static double Pct(std::vector<double> v, double p) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  return v[std::min(v.size() - 1, static_cast<size_t>(p * v.size()))];
}

void D3D11Renderer::OnUpdate(void* self) {
  auto* r = static_cast<D3D11Renderer*>(self);
  {
    std::lock_guard<std::mutex> l(r->mu_);
    r->updatePending_ = true;
  }
  r->cv_.notify_one();
}

std::string D3D11Renderer::Init(mpv_handle* h, const RenderInit& init, FrameCb cb) {
  cb_ = std::move(cb);
  maxSlots_ = init.slots;
  readback_ = init.readback;
  w_ = init.width;
  h_ = init.height;

  ComPtr<IDXGIAdapter> adapter;
  D3D_DRIVER_TYPE type = D3D_DRIVER_TYPE_HARDWARE;
  if (init.warp) {
    type = D3D_DRIVER_TYPE_WARP;
  } else if (init.hasLuid) {
    ComPtr<IDXGIFactory4> f;
    if (SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&f))) &&
        SUCCEEDED(f->EnumAdapterByLuid(init.luid, IID_PPV_ARGS(&adapter)))) {
      type = D3D_DRIVER_TYPE_UNKNOWN;
    }
  }
  D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  HRESULT hr = D3D11CreateDevice(adapter.Get(), type, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2,
                                 D3D11_SDK_VERSION, &dev_, nullptr, &ctx_);
  if (FAILED(hr)) return "D3D11CreateDevice failed 0x" + std::to_string(static_cast<unsigned>(hr));

  ComPtr<ID3D10Multithread> mt;
  if (SUCCEEDED(dev_.As(&mt))) mt->SetMultithreadProtected(TRUE);

  ComPtr<IDXGIDevice> dxgiDev;
  ComPtr<IDXGIAdapter> used;
  if (SUCCEEDED(dev_.As(&dxgiDev)) && SUCCEEDED(dxgiDev->GetAdapter(&used))) {
    DXGI_ADAPTER_DESC d;
    used->GetDesc(&d);
    char name[256];
    WideCharToMultiByte(CP_UTF8, 0, d.Description, -1, name, sizeof(name), nullptr, nullptr);
    adapterName = std::string(name) + " luid=" + std::to_string(d.AdapterLuid.HighPart) + ":" +
                  std::to_string(d.AdapterLuid.LowPart);
  }

  D3D11_QUERY_DESC qd{D3D11_QUERY_EVENT, 0};
  dev_->CreateQuery(&qd, &query_);

  mpv_d3d11_init_params ip{dev_.Get()};
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_D3D11)},
      {MPV_RENDER_PARAM_D3D11_INIT_PARAMS, &ip},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  int rc = mpv.render_context_create(&rc_, h, params);
  if (rc < 0) return std::string("mpv_render_context_create: ") + mpv.error_string(rc);

  if (readback_ && !init.shmName.empty()) {
    std::string e = InitShm(init.shmName);
    if (!e.empty()) return e;
  }
  mpv.render_context_set_update_callback(rc_, &D3D11Renderer::OnUpdate, this);
  thread_ = std::thread(&D3D11Renderer::Loop, this);
  return "";
}

bool D3D11Renderer::CreateSlot(Slot& s, int w, int h) {
  D3D11_TEXTURE2D_DESC d{};
  d.Width = w;
  d.Height = h;
  d.MipLevels = 1;
  d.ArraySize = 1;
  d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT;
  d.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
  d.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
  if (FAILED(dev_->CreateTexture2D(&d, nullptr, &s.tex))) return false;
  ComPtr<IDXGIResource1> res;
  if (FAILED(s.tex.As(&res))) return false;
  if (FAILED(res->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr,
                                     &s.nt)))
    return false;
  s.w = w;
  s.h = h;
  return true;
}

void D3D11Renderer::DestroySlot(Slot& s) {
  if (s.nt) CloseHandle(s.nt);
  s.nt = nullptr;
  s.tex.Reset();
}

// Caller holds mu_. Returns the index of a free slot of the current generation, creating one if the pool
// has room; -1 when exhausted.
int D3D11Renderer::AcquireSlot(int w, int h, uint32_t gen) {
  for (size_t i = 0; i < slots_.size(); i++) {
    if (slots_[i].state == State::Free && slots_[i].gen != gen) {
      DestroySlot(slots_[i]);
      if (!CreateSlot(slots_[i], w, h)) return -1;
      slots_[i].gen = gen;
    }
    if (slots_[i].state == State::Free && slots_[i].gen == gen) return static_cast<int>(i);
  }
  if (static_cast<int>(slots_.size()) < maxSlots_) {
    slots_.emplace_back();
    Slot& s = slots_.back();
    if (!CreateSlot(s, w, h)) {
      slots_.pop_back();
      return -1;
    }
    s.gen = gen;
    return static_cast<int>(slots_.size() - 1);
  }
  return -1;
}

void D3D11Renderer::Loop() {
  while (true) {
    int w, h, si;
    uint32_t gen;
    bool force;
    {
      std::unique_lock<std::mutex> l(mu_);
      cv_.wait(l, [&] { return updatePending_ || forceRender_ || stop_; });
      if (stop_) return;
      updatePending_ = false;
      force = forceRender_;
      forceRender_ = false;
      w = w_;
      h = h_;
      gen = gen_;
    }
    uint64_t flags = mpv.render_context_update(rc_);
    if (!(flags & MPV_RENDER_UPDATE_FRAME) && !force) continue;
    if (w <= 0 || h <= 0) continue;

    if (readback_) {
      RenderReadback(w, h, gen);
      mpv.render_context_report_swap(rc_);
      continue;
    }

    ID3D11Texture2D* tex;
    HANDLE nt;
    {
      std::lock_guard<std::mutex> l(mu_);
      si = AcquireSlot(w, h, gen);
      if (si < 0) {
        // Pool exhausted: skip this frame, the next update delivers a fresh one.
        exhausted_++;
        continue;
      }
      slots_[si].state = State::Rendering;
      tex = slots_[si].tex.Get();
      nt = slots_[si].nt;
    }

    auto t0 = Clock::now();
    mpv_d3d11_fbo fbo{tex};
    mpv_render_param rp[] = {{MPV_RENDER_PARAM_D3D11_FBO, &fbo}, {MPV_RENDER_PARAM_INVALID, nullptr}};
    mpv.render_context_render(rc_, rp);
    auto t1 = Clock::now();
    if (query_) {
      ctx_->End(query_.Get());
      while (ctx_->GetData(query_.Get(), nullptr, 0, 0) == S_FALSE) std::this_thread::yield();
    }
    auto t2 = Clock::now();

    Frame f{si, reinterpret_cast<uint64_t>(nt), w, h, gen, nullptr};
    {
      std::lock_guard<std::mutex> l(mu_);
      slots_[si].state = State::InFlight;
      slots_[si].sentAt = Clock::now();
      rendered_++;
      Push(renderMs_, std::chrono::duration<double, std::milli>(t1 - t0).count());
      Push(gpuMs_, std::chrono::duration<double, std::milli>(t2 - t1).count());
    }
    cb_(f);
    mpv.render_context_report_swap(rc_);
  }
}

// Shared memory layout: 64-byte header {u32 seq, u32 w, u32 h, u32 cap}, then 2 buffers of `cap` bytes.
// The writer fills buffer (n & 1) for frame n and then publishes seq = n; the reader copies buffer (seq & 1).
static const uint32_t kShmCap = 3840 * 2160 * 4;

std::string D3D11Renderer::InitShm(const std::string& name) {
  std::wstring wn(name.begin(), name.end());
  uint64_t total = 64 + 2ull * kShmCap;
  shmMap_ = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, static_cast<DWORD>(total >> 32),
                               static_cast<DWORD>(total & 0xffffffff), wn.c_str());
  if (!shmMap_) return "CreateFileMapping failed " + std::to_string(GetLastError());
  shmView_ = static_cast<uint8_t*>(MapViewOfFile(shmMap_, FILE_MAP_ALL_ACCESS, 0, 0, 0));
  if (!shmView_) return "MapViewOfFile failed " + std::to_string(GetLastError());
  auto* hdr = reinterpret_cast<uint32_t*>(shmView_);
  hdr[0] = 0;
  hdr[3] = kShmCap;
  return "";
}

// Render into a private texture, copy to a CPU-readable staging texture, wait for the GPU, then Map and copy
// rows out (to a fresh vector for IPC, or into the shared mapping). Synchronous on the render thread.
void D3D11Renderer::RenderReadback(int w, int h, uint32_t gen) {
  if (!rt_ || rtW_ != w || rtH_ != h) {
    rt_.Reset();
    staging_.Reset();
    D3D11_TEXTURE2D_DESC d{};
    d.Width = w;
    d.Height = h;
    d.MipLevels = 1;
    d.ArraySize = 1;
    d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    d.SampleDesc.Count = 1;
    d.Usage = D3D11_USAGE_DEFAULT;
    d.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(dev_->CreateTexture2D(&d, nullptr, &rt_))) return;
    d.Usage = D3D11_USAGE_STAGING;
    d.BindFlags = 0;
    d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    if (FAILED(dev_->CreateTexture2D(&d, nullptr, &staging_))) return;
    rtW_ = w;
    rtH_ = h;
  }
  auto t0 = Clock::now();
  mpv_d3d11_fbo fbo{rt_.Get()};
  mpv_render_param rp[] = {{MPV_RENDER_PARAM_D3D11_FBO, &fbo}, {MPV_RENDER_PARAM_INVALID, nullptr}};
  mpv.render_context_render(rc_, rp);
  auto t1 = Clock::now();
  ctx_->CopyResource(staging_.Get(), rt_.Get());
  ctx_->End(query_.Get());
  while (ctx_->GetData(query_.Get(), nullptr, 0, 0) == S_FALSE) std::this_thread::yield();
  auto t2 = Clock::now();

  D3D11_MAPPED_SUBRESOURCE m{};
  if (FAILED(ctx_->Map(staging_.Get(), 0, D3D11_MAP_READ, 0, &m))) return;
  const size_t rowBytes = static_cast<size_t>(w) * 4;
  Frame f{-1, 0, w, h, gen, nullptr};
  bool ok = true;
  if (shmView_) {
    if (rowBytes * h > kShmCap) {
      ok = false;
      std::lock_guard<std::mutex> l(mu_);
      shmTooBig_++;
    } else {
      auto* hdr = reinterpret_cast<volatile uint32_t*>(shmView_);
      uint32_t n = hdr[0] + 1;
      uint8_t* dst = shmView_ + 64 + static_cast<size_t>(n & 1) * kShmCap;
      for (int y = 0; y < h; y++) memcpy(dst + y * rowBytes, static_cast<uint8_t*>(m.pData) + y * m.RowPitch, rowBytes);
      hdr[1] = w;
      hdr[2] = h;
      MemoryBarrier();
      hdr[0] = n;
      f.handle = n;
    }
  } else {
    f.data = std::make_shared<std::vector<uint8_t>>(rowBytes * h);
    for (int y = 0; y < h; y++)
      memcpy(f.data->data() + y * rowBytes, static_cast<uint8_t*>(m.pData) + y * m.RowPitch, rowBytes);
  }
  ctx_->Unmap(staging_.Get(), 0);
  auto t3 = Clock::now();
  {
    std::lock_guard<std::mutex> l(mu_);
    rendered_++;
    Push(renderMs_, std::chrono::duration<double, std::milli>(t1 - t0).count());
    Push(gpuMs_, std::chrono::duration<double, std::milli>(t2 - t1).count());
    Push(copyMs_, std::chrono::duration<double, std::milli>(t3 - t2).count());
  }
  if (ok) cb_(f);
}

void D3D11Renderer::Resize(int w, int h) {
  {
    std::lock_guard<std::mutex> l(mu_);
    if (w == w_ && h == h_) return;
    w_ = w;
    h_ = h;
    gen_++;
    forceRender_ = true;
  }
  cv_.notify_one();
}

void D3D11Renderer::Release(int slot) {
  std::lock_guard<std::mutex> l(mu_);
  if (slot < 0 || slot >= static_cast<int>(slots_.size())) return;
  Slot& s = slots_[slot];
  if (s.state != State::InFlight) return;
  double ms = std::chrono::duration<double, std::milli>(Clock::now() - s.sentAt).count();
  Push(releaseMs_, ms);
  releaseMax_ = std::max(releaseMax_, ms);
  released_++;
  s.state = State::Free;
}

RenderStats D3D11Renderer::Stats() {
  std::lock_guard<std::mutex> l(mu_);
  RenderStats s;
  s.rendered = rendered_;
  s.exhausted = exhausted_;
  s.released = released_;
  s.generation = gen_;
  for (auto& x : slots_) {
    if (x.state == State::InFlight) s.inFlight++;
  }
  s.renderMsP50 = Pct(renderMs_, 0.5);
  s.renderMsP95 = Pct(renderMs_, 0.95);
  s.gpuWaitMsP50 = Pct(gpuMs_, 0.5);
  s.gpuWaitMsP95 = Pct(gpuMs_, 0.95);
  s.releaseMsP50 = Pct(releaseMs_, 0.5);
  s.releaseMsP95 = Pct(releaseMs_, 0.95);
  s.releaseMsMax = releaseMax_;
  s.copyMsP50 = Pct(copyMs_, 0.5);
  s.copyMsP95 = Pct(copyMs_, 0.95);
  s.shmTooBig = shmTooBig_;
  return s;
}

void D3D11Renderer::Shutdown() {
  {
    std::lock_guard<std::mutex> l(mu_);
    if (stop_) return;
    stop_ = true;
  }
  cv_.notify_one();
  if (thread_.joinable()) thread_.join();
  if (rc_) {
    mpv.render_context_set_update_callback(rc_, nullptr, nullptr);
    mpv.render_context_free(rc_);
    rc_ = nullptr;
  }
  for (auto& s : slots_) DestroySlot(s);
  slots_.clear();
  query_.Reset();
  rt_.Reset();
  staging_.Reset();
  if (shmView_) UnmapViewOfFile(shmView_);
  if (shmMap_) CloseHandle(shmMap_);
  shmView_ = nullptr;
  shmMap_ = nullptr;
  ctx_.Reset();
  dev_.Reset();
}
