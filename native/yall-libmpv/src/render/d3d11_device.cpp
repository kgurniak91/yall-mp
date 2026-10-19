#ifdef _WIN32
#include "d3d11_device.h"
#include <dxgi.h>

using Microsoft::WRL::ComPtr;

std::string WideToUtf8(const std::wstring& w) {
  if (w.empty()) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string s(static_cast<size_t>(n > 0 ? n - 1 : 0), '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, &s[0], n, nullptr, nullptr);
  return s;
}

GpuWaiter::~GpuWaiter() {
  if (event_) CloseHandle(event_);
}

bool GpuWaiter::Init(ID3D11Device* device, ID3D11DeviceContext* context) {
  ctx_ = context;
  event_ = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  if (!event_) return false;

  ComPtr<ID3D11Device5> device5;
  ComPtr<ID3D11DeviceContext4> ctx4;
  ComPtr<ID3D11Fence> fence;
  if (SUCCEEDED(device->QueryInterface(IID_PPV_ARGS(&device5))) &&
      SUCCEEDED(context->QueryInterface(IID_PPV_ARGS(&ctx4))) &&
      SUCCEEDED(device5->CreateFence(0, D3D11_FENCE_FLAG_NONE, IID_PPV_ARGS(&fence)))) {
    fence_ = fence;
    ctx4_ = ctx4;
    impl_ = "fence";
    return true;
  }

  ComPtr<IDXGIDevice2> dxgi2;
  if (SUCCEEDED(device->QueryInterface(IID_PPV_ARGS(&dxgi2)))) {
    dxgi2_ = dxgi2;
    impl_ = "enqueue-event";
    return true;
  }

  D3D11_QUERY_DESC qd{D3D11_QUERY_EVENT, 0};
  if (SUCCEEDED(device->CreateQuery(&qd, &query_))) {
    impl_ = "query-poll";
    return true;
  }
  return false;
}

bool GpuWaiter::Wait(DWORD timeoutMs) {
  if (fence_) {
    UINT64 value = ++fenceValue_;
    if (FAILED(ctx4_->Signal(fence_.Get(), value))) return false;
    ctx_->Flush();
    if (FAILED(fence_->SetEventOnCompletion(value, event_))) return false;
    return WaitForSingleObject(event_, timeoutMs) == WAIT_OBJECT_0;
  }
  if (dxgi2_) {
    ctx_->Flush();
    if (FAILED(dxgi2_->EnqueueSetEvent(event_))) return false;
    return WaitForSingleObject(event_, timeoutMs) == WAIT_OBJECT_0;
  }
  if (query_) {
    ctx_->End(query_.Get());
    ctx_->Flush();
    ULONGLONG deadline = GetTickCount64() + timeoutMs;
    // Last resort: poll, but yield the CPU for a millisecond between checks instead of spinning.
    while (ctx_->GetData(query_.Get(), nullptr, 0, 0) == S_FALSE) {
      if (GetTickCount64() > deadline) return false;
      Sleep(1);
    }
    return true;
  }
  return false;
}

namespace {

void DescribeAdapter(ID3D11Device* device, AdapterInfo& info) {
  ComPtr<IDXGIDevice> dxgiDevice;
  ComPtr<IDXGIAdapter> adapter;
  if (FAILED(device->QueryInterface(IID_PPV_ARGS(&dxgiDevice))) || FAILED(dxgiDevice->GetAdapter(&adapter))) return;
  DXGI_ADAPTER_DESC desc;
  if (FAILED(adapter->GetDesc(&desc))) return;
  info.name = WideToUtf8(desc.Description);
  info.vendorId = desc.VendorId;
  info.deviceId = desc.DeviceId;
  info.luidHigh = desc.AdapterLuid.HighPart;
  info.luidLow = desc.AdapterLuid.LowPart;
  // 0x1414 is Microsoft: the Basic Render Driver / WARP.
  if (desc.VendorId == 0x1414) info.software = true;
}

ComPtr<IDXGIAdapter1> FindAdapter(uint32_t vendorId, uint32_t deviceId) {
  ComPtr<IDXGIFactory1> factory;
  if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return nullptr;
  for (UINT i = 0;; i++) {
    ComPtr<IDXGIAdapter1> adapter;
    if (factory->EnumAdapters1(i, &adapter) == DXGI_ERROR_NOT_FOUND) break;
    DXGI_ADAPTER_DESC1 desc;
    if (FAILED(adapter->GetDesc1(&desc))) continue;
    if (desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE) continue;
    if (desc.VendorId == vendorId && desc.DeviceId == deviceId) return adapter;
  }
  return nullptr;
}

}  // namespace

std::string D3D11Device::Init(const AdapterRequest& request) {
  Reset();
  ComPtr<IDXGIAdapter1> adapter;
  D3D_DRIVER_TYPE type = D3D_DRIVER_TYPE_HARDWARE;
  info = AdapterInfo{};
  info.selection = "default";
  if (request.mode == AdapterRequest::Mode::Warp) {
    type = D3D_DRIVER_TYPE_WARP;
    info.selection = "warp";
    info.software = true;
  } else if (request.mode == AdapterRequest::Mode::Match) {
    adapter = FindAdapter(request.vendorId, request.deviceId);
    if (adapter) {
      type = D3D_DRIVER_TYPE_UNKNOWN;
      info.selection = "match";
      info.matched = true;
    } else {
      info.selection = "default-no-match";
    }
  }

  // These flags are known to work with d3d11va hwdec: keep them.
  const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  auto create = [&](IDXGIAdapter* a, D3D_DRIVER_TYPE t) {
    return D3D11CreateDevice(a, t, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, levels, 2, D3D11_SDK_VERSION, &device,
                             nullptr, &context);
  };
  HRESULT hr = create(adapter.Get(), type);
  if (FAILED(hr) && type != D3D_DRIVER_TYPE_WARP) {
    // No usable hardware device (GPU-less runner, broken driver): software rasteriser instead.
    device.Reset();
    context.Reset();
    hr = create(nullptr, D3D_DRIVER_TYPE_WARP);
    if (SUCCEEDED(hr)) {
      info.selection = "warp-fallback";
      info.software = true;
      info.matched = false;
    }
  }
  if (FAILED(hr)) return "D3D11CreateDevice failed: 0x" + std::to_string(static_cast<unsigned>(hr));

  ComPtr<ID3D10Multithread> multithread;
  if (SUCCEEDED(device.As(&multithread))) multithread->SetMultithreadProtected(TRUE);
  DescribeAdapter(device.Get(), info);

  if (!waiter.Init(device.Get(), context.Get())) return "could not create a GPU completion waiter";
  return "";
}

void D3D11Device::Reset() {
  context.Reset();
  device.Reset();
}
#endif
