#pragma once
#ifdef _WIN32
// D3D11 device creation on a requested adapter, plus the GPU-completion wait used by the D3D11 backends.
#include <d3d11_4.h>
#include <dxgi1_2.h>
#include <wrl/client.h>
#include <string>
#include "backend.h"

struct AdapterRequest {
  enum class Mode { Default, Warp, Match };
  Mode mode = Mode::Default;
  uint32_t vendorId = 0;  // Match: the active GPU's ids from app.getGPUInfo('complete')
  uint32_t deviceId = 0;
};

// Waits until the GPU has finished everything submitted so far, without spinning a core.
// Preference order: D3D11 fence, IDXGIDevice2::EnqueueSetEvent, event query polled with Sleep(1).
class GpuWaiter {
 public:
  ~GpuWaiter();
  bool Init(ID3D11Device* device, ID3D11DeviceContext* context);
  // Returns false on timeout.
  bool Wait(DWORD timeoutMs);
  const char* Impl() const { return impl_; }

 private:
  ID3D11DeviceContext* ctx_ = nullptr;
  HANDLE event_ = nullptr;
  Microsoft::WRL::ComPtr<ID3D11Fence> fence_;
  Microsoft::WRL::ComPtr<ID3D11DeviceContext4> ctx4_;
  Microsoft::WRL::ComPtr<IDXGIDevice2> dxgi2_;
  Microsoft::WRL::ComPtr<ID3D11Query> query_;
  UINT64 fenceValue_ = 0;
  const char* impl_ = "none";
};

struct D3D11Device {
  Microsoft::WRL::ComPtr<ID3D11Device> device;
  Microsoft::WRL::ComPtr<ID3D11DeviceContext> context;
  GpuWaiter waiter;
  AdapterInfo info;

  // Returns an error message, empty on success. A failing hardware device falls back to WARP.
  std::string Init(const AdapterRequest& request);
  void Reset();
  // True (with "DEVICE_REMOVED 0x887A0005"-style text) once the device was removed or reset (TDR, driver update).
  bool IsRemoved(std::string& reason) const;
};

std::string WideToUtf8(const std::wstring& w);
#endif
