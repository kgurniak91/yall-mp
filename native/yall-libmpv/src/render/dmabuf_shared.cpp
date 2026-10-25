#if defined(__linux__) && defined(YALL_HAVE_DMABUF)
#include "dmabuf_shared.h"
#include <sstream>
#include "../live_counts.h"
#include "../thread_cpu.h"

using Clock = std::chrono::steady_clock;

namespace {
constexpr int kGlRgba8 = 0x8058;

double MsSince(Clock::time_point t) { return std::chrono::duration<double, std::milli>(Clock::now() - t).count(); }

void* GetProc(void* ctx, const char* name) { return static_cast<EglContext*>(ctx)->GetProcAddress(name); }
}  // namespace

std::string DmabufSharedBackend::Init(mpv_handle* handle) {
  std::string err = egl_.Open(options_);
  if (!err.empty()) return err;
  // The render thread makes the context current for itself (OnThreadStart); never leave it bound to this thread.
  if (!egl_.MakeCurrent()) return "eglMakeCurrent failed";
  struct Unbind {
    EglContext& egl;
    ~Unbind() { egl.Release(); }
  } unbind{egl_};

  adapterInfo_.name = egl_.GlRenderer();
  adapterInfo_.software = egl_.Software();
  adapterInfo_.matched = options_.vendorId != 0;
  adapterInfo_.selection = (egl_.IsRenderNode() ? "render-node " : "card-node ") + egl_.Node();

  mpv_opengl_init_params glInit{&GetProc, &egl_};
  // The render node lets mpv's VA-API interop (hwdec vaapi-egl) share the GPU with this context.
  mpv_opengl_drm_params_v2 drm{};
  drm.fd = -1;
  drm.render_fd = egl_.IsRenderNode() ? egl_.NodeFd() : -1;
  mpv_render_param params[] = {
      {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_OPENGL)},
      {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &glInit},
      {MPV_RENDER_PARAM_DRM_DISPLAY_V2, &drm},
      {MPV_RENDER_PARAM_INVALID, nullptr}};
  if (drm.render_fd < 0) params[2] = {MPV_RENDER_PARAM_INVALID, nullptr};
  int rc = mpv.render_context_create(&rc_, handle, params);
  egl_.CheckGl("mpv_render_context_create");
  if (rc < 0) return std::string("mpv_render_context_create: ") + mpv.error_string(rc);
  slots_.reserve(static_cast<size_t>(maxSlots_));
  return "";
}

void DmabufSharedBackend::FreeContext() {
  if (!rc_) return;
  egl_.MakeCurrent();  // mpv deletes its GL objects here
  mpv.render_context_set_update_callback(rc_, nullptr, nullptr);
  mpv.render_context_free(rc_);
  rc_ = nullptr;
  egl_.CheckGl("mpv_render_context_free");
}

void DmabufSharedBackend::OnThreadStart() { egl_.MakeCurrent(); }

void DmabufSharedBackend::OnThreadStop() { egl_.Release(); }

bool DmabufSharedBackend::CreateSlotTarget(int index, Slot& s, int w, int h, uint32_t gen) {
  std::string error;
  if (!egl_.CreateTarget(w, h, s.target, error)) return false;
  s.gen = gen;
  s.announced = false;
  Counts().slots++;
  // The descriptor goes out once per buffer; frames then name the slot only.
  std::ostringstream meta;
  meta << "{\"attachId\":" << attachId_ << ",\"slotId\":" << index << ",\"generation\":" << gen << ",\"width\":" << w
       << ",\"height\":" << h << ",\"stride\":" << s.target.stride << ",\"offset\":" << s.target.offset
       << ",\"size\":" << static_cast<uint64_t>(s.target.stride) * static_cast<uint64_t>(h) << ",\"modifier\":\""
       << s.target.modifier << "\"}";
  if (sendFd_ && sendFd_(s.target.fd, meta.str())) {
    s.announced = true;
  } else {
    sendFailures_++;
    DestroySlotTarget(index, s, false);
    return false;
  }
  return true;
}

void DmabufSharedBackend::DestroySlotTarget(int index, Slot& s, bool notify) {
  if (!s.target.bo) return;
  egl_.DestroyTarget(s.target);
  Counts().slots--;
  if (notify && s.announced && slotClosed_) slotClosed_(index);
  s.announced = false;
}

int DmabufSharedBackend::AcquireSlot(int w, int h, uint32_t gen) {
  for (size_t i = 0; i < slots_.size(); i++) {
    Slot& s = slots_[i];
    if (s.state != State::Free) continue;
    if (!s.target.bo || s.gen != gen || s.target.w != w || s.target.h != h) {
      // A replacement overwrites the client's table entry for this slot, so no close message is needed.
      DestroySlotTarget(static_cast<int>(i), s, false);
      if (!CreateSlotTarget(static_cast<int>(i), s, w, h, gen)) continue;
    }
    return static_cast<int>(i);
  }
  if (static_cast<int>(slots_.size()) < maxSlots_) {
    slots_.emplace_back();
    const int index = static_cast<int>(slots_.size() - 1);
    if (!CreateSlotTarget(index, slots_.back(), w, h, gen)) {
      slots_.pop_back();
      return -1;
    }
    return index;
  }
  return -1;
}

bool DmabufSharedBackend::Render(int w, int h, uint32_t gen, Frame& out) {
  int index;
  unsigned int fbo;
  {
    std::lock_guard<std::mutex> lock(mu_);
    egl_.MakeCurrent();
    index = AcquireSlot(w, h, gen);
    if (index < 0) {
      // Pool exhausted (or a target could not be created): skip, the next update delivers a fresh one.
      exhausted_++;
      return false;
    }
    Slot& s = slots_[static_cast<size_t>(index)];
    s.state = State::Rendering;
    fbo = s.target.fbo;
  }

  auto t0 = Clock::now();
  double cpu0 = ThreadCpuMs();
  // mpv's default (no flip) already puts the first row of the picture first in memory.
  mpv_opengl_fbo target{static_cast<int>(fbo), w, h, kGlRgba8};
  int flipY = 0;
  mpv_render_param rp[] = {{MPV_RENDER_PARAM_OPENGL_FBO, &target},
                           {MPV_RENDER_PARAM_FLIP_Y, &flipY},
                           {MPV_RENDER_PARAM_INVALID, nullptr}};
  mpv.render_context_render(rc_, rp);
  double cpu1 = ThreadCpuMs();
  auto t1 = Clock::now();
  // The buffer is read by another process (Chromium's GPU process): make sure every write has landed. Mesa
  // synchronises implicitly, NVIDIA before driver 555 does not.
  egl_.Finish();
  double cpu2 = ThreadCpuMs();
  auto t2 = Clock::now();

  std::lock_guard<std::mutex> lock(mu_);
  egl_.CheckGl("render");
  Slot& s = slots_[static_cast<size_t>(index)];
  renderCpuMs_ += cpu1 - cpu0;
  waitCpuMs_ += cpu2 - cpu1;
  s.state = State::InFlight;
  s.serial++;
  s.sentAt = Clock::now();
  rendered_++;
  renderMs_.Push(std::chrono::duration<double, std::milli>(t1 - t0).count());
  gpuWaitMs_.Push(std::chrono::duration<double, std::milli>(t2 - t1).count());

  if (probeFramesLeft_ > 0) {
    probeFramesLeft_--;
    const int xs[5] = {w / 2, w / 4, w * 3 / 4, w / 4, w * 3 / 4};
    const int ys[5] = {h / 2, h / 4, h / 4, h * 3 / 4, h * 3 / 4};
    out.hasProbe = true;
    for (int i = 0; i < 5; i++) {
      if (!egl_.ReadPixel(s.target, xs[i], ys[i], out.probe + i * 4)) out.hasProbe = false;
    }
  }

  out.slotId = index;
  out.serial = s.serial;
  out.generation = gen;
  out.width = w;
  out.height = h;
  return true;
}

void DmabufSharedBackend::Release(int slotId, uint64_t serial) {
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

void DmabufSharedBackend::ReclaimExpired(int timeoutMs) {
  std::lock_guard<std::mutex> lock(mu_);
  bool current = false;
  for (size_t i = 0; i < slots_.size(); i++) {
    Slot& s = slots_[i];
    if (s.state != State::InFlight || MsSince(s.sentAt) < timeoutMs) continue;
    // Never reuse a buffer the consumer may still hold: drop our reference (the consumer keeps its own after
    // import) and recreate the slot on the next acquire. The serial bump makes a late release stale.
    if (!current) current = egl_.MakeCurrent();
    DestroySlotTarget(static_cast<int>(i), s, true);
    s.serial++;
    s.state = State::Free;
    reclaimed_++;
  }
}

int DmabufSharedBackend::InFlight() {
  std::lock_guard<std::mutex> lock(mu_);
  int n = 0;
  for (const Slot& s : slots_) {
    if (s.state == State::InFlight) n++;
  }
  return n;
}

void DmabufSharedBackend::ReleaseAll() {
  std::lock_guard<std::mutex> lock(mu_);
  egl_.MakeCurrent();
  for (size_t i = 0; i < slots_.size(); i++) DestroySlotTarget(static_cast<int>(i), slots_[i], true);
  slots_.clear();
  egl_.Close();
}

void DmabufSharedBackend::FillStats(BackendStats& out) {
  std::lock_guard<std::mutex> lock(mu_);
  out.backend = "dmabuf-shared";
  out.impl = "gl";
  out.gpuWaitImpl = "finish";
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
  out.renderMs = Summarize(renderMs_);
  out.gpuWaitMs = Summarize(gpuWaitMs_);
  out.releaseMs = Summarize(releaseMs_);
  out.renderCpuMs = renderCpuMs_;
  out.waitCpuMs = waitCpuMs_;
  out.glErrors = egl_.GlErrors();
  std::ostringstream note;
  note << "GL " << egl_.GlVersion() << " | " << egl_.GlRenderer() << " | " << egl_.GlVendor() << " | EGL "
       << egl_.EglVendor() << " | " << egl_.Node() << (egl_.Gles() ? " | gles" : " | desktop-gl");
  if (sendFailures_) note << " | descriptor send failures: " << sendFailures_;
  for (const std::string& n : egl_.Notes()) note << " | " << n;
  out.note = note.str();
}
#endif
