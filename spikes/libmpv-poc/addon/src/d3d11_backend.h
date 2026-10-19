#pragma once
// D3D11 render backend: mpv renders into a pool of shared NT-handle textures on a dedicated thread.
#include "mpv_loader.h"
#include <d3d11.h>
#include <dxgi1_4.h>
#include <wrl/client.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

struct RenderStats {
  uint64_t rendered = 0, exhausted = 0, released = 0, inFlight = 0, generation = 0;
  double renderMsP50 = 0, renderMsP95 = 0, gpuWaitMsP50 = 0, gpuWaitMsP95 = 0;
  double releaseMsP50 = 0, releaseMsP95 = 0, releaseMsMax = 0;
  double copyMsP50 = 0, copyMsP95 = 0;
  uint64_t shmTooBig = 0;
};

struct RenderInit {
  int width = 0, height = 0, slots = 3;
  bool hasLuid = false;
  LUID luid{};
  bool warp = false;
  // readback: render into a private texture, copy to a staging texture and Map it.
  // shmName non-empty: write pixels into a named file mapping instead of handing a Buffer to JS.
  bool readback = false;
  std::string shmName;
};

class D3D11Renderer {
 public:
  struct Frame {
    int slot;
    uint64_t handle;
    int width, height;
    uint32_t generation;
    std::shared_ptr<std::vector<uint8_t>> data;  // readback over IPC: tightly packed BGRA
  };
  using FrameCb = std::function<void(const Frame&)>;

  ~D3D11Renderer() { Shutdown(); }
  std::string Init(mpv_handle* h, const RenderInit& init, FrameCb cb);
  void Resize(int w, int h);
  void Release(int slot);
  RenderStats Stats();
  void Shutdown();
  // Description of the adapter actually used, for the log.
  std::string adapterName;

 private:
  enum class State { Free, Rendering, InFlight };
  struct Slot {
    Microsoft::WRL::ComPtr<ID3D11Texture2D> tex;
    HANDLE nt = nullptr;
    int w = 0, h = 0;
    uint32_t gen = 0;
    State state = State::Free;
    std::chrono::steady_clock::time_point sentAt;
  };

  void Loop();
  void RenderReadback(int w, int h, uint32_t gen);
  std::string InitShm(const std::string& name);
  int AcquireSlot(int w, int h, uint32_t gen);
  bool CreateSlot(Slot& s, int w, int h);
  void DestroySlot(Slot& s);
  static void OnUpdate(void* self);

  Microsoft::WRL::ComPtr<ID3D11Device> dev_;
  Microsoft::WRL::ComPtr<ID3D11DeviceContext> ctx_;
  Microsoft::WRL::ComPtr<ID3D11Query> query_;
  mpv_render_context* rc_ = nullptr;
  FrameCb cb_;
  int maxSlots_ = 3;

  std::mutex mu_;
  std::condition_variable cv_;
  std::vector<Slot> slots_;
  bool updatePending_ = false, forceRender_ = false, stop_ = false;
  int w_ = 0, h_ = 0;
  uint32_t gen_ = 1;
  std::thread thread_;

  bool readback_ = false;
  Microsoft::WRL::ComPtr<ID3D11Texture2D> rt_, staging_;
  int rtW_ = 0, rtH_ = 0;
  HANDLE shmMap_ = nullptr;
  uint8_t* shmView_ = nullptr;
  uint64_t shmTooBig_ = 0;

  std::vector<double> renderMs_, gpuMs_, releaseMs_, copyMs_;
  uint64_t rendered_ = 0, exhausted_ = 0, released_ = 0;
  double releaseMax_ = 0;
};
