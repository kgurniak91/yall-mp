#ifdef _WIN32
#include "d3d11_readback.h"
#include <chrono>
#include <cstring>
#include "../thread_cpu.h"

using Clock = std::chrono::steady_clock;

namespace {
constexpr DWORD kGpuWaitTimeoutMs = 1000;
double MsBetween(Clock::time_point a, Clock::time_point b) {
  return std::chrono::duration<double, std::milli>(b - a).count();
}
}  // namespace

std::string D3D11ReadbackBackend::Init(mpv_handle* handle) {
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
  if (adapterInfo_.software) {
    // libmpv's render API probes every hwdec interop at context creation, whatever `hwdec` says. On the Basic
    // Render Driver the dxva2 interop fails fatally ("Can't StretchRect from NV12 to XRGB") and takes the video
    // output with it; hardware decoding is pointless on a software adapter anyway.
    mpv.set_option_string(handle, "gpu-hwdec-interop", "no");
  }
  int rc = mpv.render_context_create(&rc_, handle, params);
  if (rc < 0) return std::string("mpv_render_context_create: ") + mpv.error_string(rc);
  return "";
}

void D3D11ReadbackBackend::FreeContext() {
  if (!rc_) return;
  mpv.render_context_set_update_callback(rc_, nullptr, nullptr);
  mpv.render_context_free(rc_);
  rc_ = nullptr;
}

bool D3D11ReadbackBackend::Render(int w, int h, uint32_t gen, Frame& out) {
  if (!rt_ || rtW_ != w || rtH_ != h) {
    rt_.Reset();
    staging_.Reset();
    D3D11_TEXTURE2D_DESC d{};
    d.Width = static_cast<UINT>(w);
    d.Height = static_cast<UINT>(h);
    d.MipLevels = 1;
    d.ArraySize = 1;
    d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    d.SampleDesc.Count = 1;
    d.Usage = D3D11_USAGE_DEFAULT;
    d.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
    if (FAILED(d3d_->device->CreateTexture2D(&d, nullptr, &rt_))) return false;
    d.Usage = D3D11_USAGE_STAGING;
    d.BindFlags = 0;
    d.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    if (FAILED(d3d_->device->CreateTexture2D(&d, nullptr, &staging_))) {
      rt_.Reset();
      return false;
    }
    rtW_ = w;
    rtH_ = h;
  }

  auto t0 = Clock::now();
  double cpu0 = ThreadCpuMs();
  mpv_d3d11_fbo fbo{rt_.Get()};
  mpv_render_param rp[] = {{MPV_RENDER_PARAM_D3D11_FBO, &fbo}, {MPV_RENDER_PARAM_INVALID, nullptr}};
  mpv.render_context_render(rc_, rp);
  d3d_->context->CopyResource(staging_.Get(), rt_.Get());
  double cpu1 = ThreadCpuMs();
  auto t1 = Clock::now();
  bool done = d3d_->waiter.Wait(kGpuWaitTimeoutMs);
  double cpu2 = ThreadCpuMs();
  auto t2 = Clock::now();
  if (!done) {
    std::lock_guard<std::mutex> lock(mu_);
    renderCpuMs_ += cpu1 - cpu0;
    waitCpuMs_ += cpu2 - cpu1;
    gpuWaitTimeouts_++;
    return false;
  }

  D3D11_MAPPED_SUBRESOURCE mapped{};
  if (FAILED(d3d_->context->Map(staging_.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return false;
  const size_t rowBytes = static_cast<size_t>(w) * 4;
  auto pixels = pool_->Acquire(rowBytes * static_cast<size_t>(h));
  for (int y = 0; y < h; y++) {
    std::memcpy(pixels->data() + static_cast<size_t>(y) * rowBytes,
                static_cast<const uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch, rowBytes);
  }
  d3d_->context->Unmap(staging_.Get(), 0);
  auto t3 = Clock::now();

  {
    std::lock_guard<std::mutex> lock(mu_);
    rendered_++;
    renderCpuMs_ += cpu1 - cpu0;
    waitCpuMs_ += cpu2 - cpu1;
    renderMs_.Push(MsBetween(t0, t1));
    gpuWaitMs_.Push(MsBetween(t1, t2));
    copyMs_.Push(MsBetween(t2, t3));
  }
  out.pixels = std::move(pixels);
  out.generation = gen;
  out.width = w;
  out.height = h;
  return true;
}

void D3D11ReadbackBackend::ReleaseAll() {
  rt_.Reset();
  staging_.Reset();
  d3d_.reset();
}

void D3D11ReadbackBackend::FillStats(BackendStats& out) {
  std::lock_guard<std::mutex> lock(mu_);
  out.backend = "readback";
  out.impl = "d3d11";
  out.gpuWaitImpl = gpuWaitImpl_;
  out.adapter = adapterInfo_;
  out.rendered = rendered_;
  out.gpuWaitTimeouts = gpuWaitTimeouts_;
  out.renderMs = Summarize(renderMs_);
  out.gpuWaitMs = Summarize(gpuWaitMs_);
  out.copyMs = Summarize(copyMs_);
  out.renderCpuMs = renderCpuMs_;
  out.waitCpuMs = waitCpuMs_;
}
#endif
