#if defined(__linux__) && defined(YALL_HAVE_DMABUF)
#include "egl_context.h"
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <dirent.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <gbm.h>
#include <unistd.h>
#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>

namespace {

constexpr size_t kMaxNotes = 24;
constexpr uint32_t kFourccArgb8888 = 0x34325241;  // DRM_FORMAT_ARGB8888 'AR24'
constexpr uint64_t kModInvalid = 0x00ffffffffffffffULL;

// Only the GL entry points and enums used here, so no GL development headers are needed to build.
using GLenum = unsigned int;
using GLuint = unsigned int;
using GLint = int;
using GLsizei = int;
using GLbitfield = unsigned int;
using GLubyte = unsigned char;
using GLfloat = float;
constexpr GLenum GL_NO_ERROR_ = 0;
constexpr GLenum GL_VENDOR_ = 0x1F00, GL_RENDERER_ = 0x1F01, GL_VERSION_ = 0x1F02;
constexpr GLenum GL_TEXTURE_2D_ = 0x0DE1, GL_RGBA_ = 0x1908, GL_UNSIGNED_BYTE_ = 0x1401;
constexpr GLenum GL_FRAMEBUFFER_ = 0x8D40, GL_COLOR_ATTACHMENT0_ = 0x8CE0, GL_FRAMEBUFFER_COMPLETE_ = 0x8CD5;
constexpr GLbitfield GL_COLOR_BUFFER_BIT_ = 0x4000;

template <typename T>
bool Sym(void* lib, const char* name, T& fn) {
  fn = reinterpret_cast<T>(dlsym(lib, name));
  return fn != nullptr;
}

std::string Lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

uint32_t ReadHexFile(const std::string& path) {
  std::ifstream f(path);
  std::string text;
  if (!f || !(f >> text)) return 0;
  return static_cast<uint32_t>(std::strtoul(text.c_str(), nullptr, 16));
}

struct NodeInfo {
  std::string path;
  bool render = false;
  uint32_t vendor = 0, device = 0;
};

std::vector<NodeInfo> ListNodes() {
  std::vector<NodeInfo> nodes;
  DIR* dir = opendir("/dev/dri");
  if (!dir) return nodes;
  while (dirent* entry = readdir(dir)) {
    const std::string name = entry->d_name;
    const bool render = name.rfind("renderD", 0) == 0;
    if (!render && name.rfind("card", 0) != 0) continue;
    NodeInfo n;
    n.path = "/dev/dri/" + name;
    n.render = render;
    n.vendor = ReadHexFile("/sys/class/drm/" + name + "/device/vendor");
    n.device = ReadHexFile("/sys/class/drm/" + name + "/device/device");
    nodes.push_back(n);
  }
  closedir(dir);
  std::sort(nodes.begin(), nodes.end(), [](const NodeInfo& a, const NodeInfo& b) { return a.path < b.path; });
  return nodes;
}

}  // namespace

struct EglContext::Impl {
  void* eglLib = nullptr;
  void* gbmLib = nullptr;

  decltype(&::eglGetProcAddress) getProcAddress = nullptr;
  decltype(&::eglGetError) getError = nullptr;
  decltype(&::eglInitialize) initialize = nullptr;
  decltype(&::eglTerminate) terminate = nullptr;
  decltype(&::eglBindAPI) bindAPI = nullptr;
  decltype(&::eglChooseConfig) chooseConfig = nullptr;
  decltype(&::eglCreateContext) createContext = nullptr;
  decltype(&::eglDestroyContext) destroyContext = nullptr;
  decltype(&::eglMakeCurrent) makeCurrent = nullptr;
  decltype(&::eglQueryString) queryString = nullptr;
  decltype(&::eglReleaseThread) releaseThread = nullptr;
  PFNEGLGETPLATFORMDISPLAYEXTPROC getPlatformDisplay = nullptr;
  PFNEGLCREATEIMAGEKHRPROC createImage = nullptr;
  PFNEGLDESTROYIMAGEKHRPROC destroyImage = nullptr;
  void (*imageTargetTexture)(GLenum, void*) = nullptr;

  decltype(&::gbm_create_device) gbmCreateDevice = nullptr;
  decltype(&::gbm_device_destroy) gbmDeviceDestroy = nullptr;
  decltype(&::gbm_bo_create) boCreate = nullptr;
  decltype(&::gbm_bo_destroy) boDestroy = nullptr;
  decltype(&::gbm_bo_get_fd) boGetFd = nullptr;
  decltype(&::gbm_bo_get_stride) boGetStride = nullptr;
  decltype(&::gbm_bo_get_offset) boGetOffset = nullptr;
  decltype(&::gbm_bo_get_modifier) boGetModifier = nullptr;

  const GLubyte* (*glGetString)(GLenum) = nullptr;
  GLenum (*glGetError)() = nullptr;
  void (*glGenTextures)(GLsizei, GLuint*) = nullptr;
  void (*glDeleteTextures)(GLsizei, const GLuint*) = nullptr;
  void (*glBindTexture)(GLenum, GLuint) = nullptr;
  void (*glGenFramebuffers)(GLsizei, GLuint*) = nullptr;
  void (*glDeleteFramebuffers)(GLsizei, const GLuint*) = nullptr;
  void (*glBindFramebuffer)(GLenum, GLuint) = nullptr;
  void (*glFramebufferTexture2D)(GLenum, GLenum, GLenum, GLuint, GLint) = nullptr;
  GLenum (*glCheckFramebufferStatus)(GLenum) = nullptr;
  void (*glClearColor)(GLfloat, GLfloat, GLfloat, GLfloat) = nullptr;
  void (*glClear)(GLbitfield) = nullptr;
  void (*glReadPixels)(GLint, GLint, GLsizei, GLsizei, GLenum, GLenum, void*) = nullptr;
  void (*glFinish)() = nullptr;

  gbm_device* gbm = nullptr;
  EGLDisplay display = EGL_NO_DISPLAY;
  EGLContext context = EGL_NO_CONTEXT;
  bool dmabufModifiers = false;
  bool linearOnly = true;  // the last successful allocation needed no non-linear fallback
};

EglContext::EglContext() : impl_(new Impl) {}

EglContext::~EglContext() {
  Close();
  if (impl_->eglLib) dlclose(impl_->eglLib);
  if (impl_->gbmLib) dlclose(impl_->gbmLib);
  delete impl_;
}

void EglContext::Note(const std::string& text) {
  if (notes_.size() < kMaxNotes) notes_.push_back(text);
}

void EglContext::CheckGl(const char* where) {
  if (!impl_->glGetError) return;
  for (int i = 0; i < 8; i++) {
    GLenum e = impl_->glGetError();
    if (e == GL_NO_ERROR_) return;
    glErrors_++;
    char buf[96];
    std::snprintf(buf, sizeof(buf), "glGetError 0x%04x after %s", static_cast<unsigned>(e), where);
    Note(buf);
  }
}

void EglContext::Close() {
  Impl& m = *impl_;
  if (m.display != EGL_NO_DISPLAY) {
    m.makeCurrent(m.display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
    if (m.context != EGL_NO_CONTEXT) m.destroyContext(m.display, m.context);
    m.terminate(m.display);
    m.releaseThread();
  }
  m.context = EGL_NO_CONTEXT;
  m.display = EGL_NO_DISPLAY;
  if (m.gbm) m.gbmDeviceDestroy(m.gbm);
  m.gbm = nullptr;
  if (nodeFd_ >= 0) close(nodeFd_);
  nodeFd_ = -1;
}

std::string EglContext::Open(const EglOptions& options) {
  Impl& m = *impl_;
  if (!m.eglLib) {
    m.eglLib = dlopen("libEGL.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!m.eglLib) return "libEGL.so.1 is not installed";
    m.gbmLib = dlopen("libgbm.so.1", RTLD_NOW | RTLD_LOCAL);
    if (!m.gbmLib) return "libgbm.so.1 is not installed";
    bool ok = Sym(m.eglLib, "eglGetProcAddress", m.getProcAddress) && Sym(m.eglLib, "eglGetError", m.getError) &&
              Sym(m.eglLib, "eglInitialize", m.initialize) && Sym(m.eglLib, "eglTerminate", m.terminate) &&
              Sym(m.eglLib, "eglBindAPI", m.bindAPI) && Sym(m.eglLib, "eglChooseConfig", m.chooseConfig) &&
              Sym(m.eglLib, "eglCreateContext", m.createContext) &&
              Sym(m.eglLib, "eglDestroyContext", m.destroyContext) &&
              Sym(m.eglLib, "eglMakeCurrent", m.makeCurrent) && Sym(m.eglLib, "eglQueryString", m.queryString) &&
              Sym(m.eglLib, "eglReleaseThread", m.releaseThread) &&
              Sym(m.gbmLib, "gbm_create_device", m.gbmCreateDevice) &&
              Sym(m.gbmLib, "gbm_device_destroy", m.gbmDeviceDestroy) && Sym(m.gbmLib, "gbm_bo_create", m.boCreate) &&
              Sym(m.gbmLib, "gbm_bo_destroy", m.boDestroy) && Sym(m.gbmLib, "gbm_bo_get_fd", m.boGetFd) &&
              Sym(m.gbmLib, "gbm_bo_get_stride", m.boGetStride);
    if (!ok) return "libEGL or libgbm lacks a required entry point";
    // Optional: older libgbm has no per-plane offset or modifier query.
    Sym(m.gbmLib, "gbm_bo_get_offset", m.boGetOffset);
    Sym(m.gbmLib, "gbm_bo_get_modifier", m.boGetModifier);
    m.getPlatformDisplay = reinterpret_cast<PFNEGLGETPLATFORMDISPLAYEXTPROC>(dlsym(m.eglLib, "eglGetPlatformDisplay"));
    if (!m.getPlatformDisplay) {
      m.getPlatformDisplay =
          reinterpret_cast<PFNEGLGETPLATFORMDISPLAYEXTPROC>(m.getProcAddress("eglGetPlatformDisplayEXT"));
    }
    m.createImage = reinterpret_cast<PFNEGLCREATEIMAGEKHRPROC>(m.getProcAddress("eglCreateImageKHR"));
    m.destroyImage = reinterpret_cast<PFNEGLDESTROYIMAGEKHRPROC>(m.getProcAddress("eglDestroyImageKHR"));
    if (!m.getPlatformDisplay || !m.createImage || !m.destroyImage) return "EGL lacks the GBM platform or EGLImage support";
  }

  std::vector<NodeInfo> nodes = ListNodes();
  if (nodes.empty() && options.node.empty()) return "no DRM device in /dev/dri";
  std::vector<std::string> candidates;
  auto add = [&](const std::string& path) {
    if (std::find(candidates.begin(), candidates.end(), path) == candidates.end()) candidates.push_back(path);
  };
  if (!options.node.empty()) add(options.node);
  for (int pass = 0; pass < 4; pass++) {
    const bool wantRender = pass < 2;
    const bool wantMatch = pass % 2 == 0;
    for (const NodeInfo& n : nodes) {
      const bool match = options.vendorId && n.vendor == options.vendorId && (!options.deviceId || n.device == options.deviceId);
      if (n.render == wantRender && match == wantMatch) add(n.path);
    }
  }

  std::string failures;
  for (const std::string& path : candidates) {
    std::string err = OpenNode(path);
    if (err.empty()) {
      Release();
      return "";
    }
    failures += (failures.empty() ? "" : "; ") + path + ": " + err;
    Close();
  }
  return failures.empty() ? "no usable DRM node" : failures;
}

std::string EglContext::OpenNode(const std::string& path) {
  Impl& m = *impl_;
  nodeFd_ = open(path.c_str(), O_RDWR | O_CLOEXEC);
  if (nodeFd_ < 0) return std::string("open failed: ") + std::strerror(errno);
  node_ = path;
  isRenderNode_ = path.find("renderD") != std::string::npos;
  m.gbm = m.gbmCreateDevice(nodeFd_);
  if (!m.gbm) return "gbm_create_device failed";
  m.display = m.getPlatformDisplay(EGL_PLATFORM_GBM_KHR, m.gbm, nullptr);
  if (m.display == EGL_NO_DISPLAY) return "eglGetPlatformDisplay(GBM) failed";
  EGLint major = 0, minor = 0;
  if (!m.initialize(m.display, &major, &minor)) {
    m.display = EGL_NO_DISPLAY;
    return "eglInitialize failed";
  }
  const std::string extensions = m.queryString(m.display, EGL_EXTENSIONS) ? m.queryString(m.display, EGL_EXTENSIONS) : "";
  if (extensions.find("EGL_EXT_image_dma_buf_import") == std::string::npos) return "EGL_EXT_image_dma_buf_import is missing";
  m.dmabufModifiers = extensions.find("EGL_EXT_image_dma_buf_import_modifiers") != std::string::npos;
  const char* vendor = m.queryString(m.display, EGL_VENDOR);
  eglVendor_ = vendor ? vendor : "";

  // Desktop GL 3.2 core first (mpv's best path), OpenGL ES 3 as the second choice.
  gles_ = false;
  for (int pass = 0; pass < 2 && m.context == EGL_NO_CONTEXT; pass++) {
    const bool es = pass == 1;
    if (!m.bindAPI(es ? EGL_OPENGL_ES_API : EGL_OPENGL_API)) continue;
    const EGLint configAttrs[] = {EGL_RENDERABLE_TYPE, es ? EGL_OPENGL_ES3_BIT : EGL_OPENGL_BIT,
                                  EGL_RED_SIZE, 8, EGL_GREEN_SIZE, 8, EGL_BLUE_SIZE, 8, EGL_NONE};
    EGLConfig config = nullptr;
    EGLint count = 0;
    if (!m.chooseConfig(m.display, configAttrs, &config, 1, &count) || count < 1) continue;
    const EGLint desktopAttrs[] = {EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 2,
                                   EGL_CONTEXT_OPENGL_PROFILE_MASK, EGL_CONTEXT_OPENGL_CORE_PROFILE_BIT, EGL_NONE};
    const EGLint esAttrs[] = {EGL_CONTEXT_MAJOR_VERSION, 3, EGL_NONE};
    m.context = m.createContext(m.display, config, EGL_NO_CONTEXT, es ? esAttrs : desktopAttrs);
    gles_ = es && m.context != EGL_NO_CONTEXT;
  }
  if (m.context == EGL_NO_CONTEXT) return "no OpenGL 3.2 core or OpenGL ES 3 context";
  if (!m.makeCurrent(m.display, EGL_NO_SURFACE, EGL_NO_SURFACE, m.context)) return "eglMakeCurrent without a surface failed";

  bool ok = true;
#define GL_FN(name) ok = ok && (m.name = reinterpret_cast<decltype(m.name)>(m.getProcAddress(#name)))
  GL_FN(glGetString); GL_FN(glGetError); GL_FN(glGenTextures); GL_FN(glDeleteTextures); GL_FN(glBindTexture);
  GL_FN(glGenFramebuffers); GL_FN(glDeleteFramebuffers); GL_FN(glBindFramebuffer); GL_FN(glFramebufferTexture2D);
  GL_FN(glCheckFramebufferStatus); GL_FN(glClearColor); GL_FN(glClear); GL_FN(glReadPixels); GL_FN(glFinish);
#undef GL_FN
  m.imageTargetTexture = reinterpret_cast<decltype(m.imageTargetTexture)>(m.getProcAddress("glEGLImageTargetTexture2DOES"));
  if (!ok || !m.imageTargetTexture) return "GL entry points are missing (glEGLImageTargetTexture2DOES?)";

  auto str = [&](GLenum name) {
    const GLubyte* s = m.glGetString(name);
    return std::string(s ? reinterpret_cast<const char*>(s) : "?");
  };
  glVersion_ = str(GL_VERSION_);
  glRenderer_ = str(GL_RENDERER_);
  glVendor_ = str(GL_VENDOR_);
  const std::string r = Lower(glRenderer_);
  software_ = r.find("llvmpipe") != std::string::npos || r.find("softpipe") != std::string::npos ||
              r.find("swrast") != std::string::npos || r.find("software") != std::string::npos;
  CheckGl("context creation");

  // The authority on whether this node works: allocate, export, import and render into a small target.
  DmabufTarget probe;
  std::string error;
  if (!CreateTarget(16, 16, probe, error)) return "render target: " + error;
  Clear(probe, 0.f, 1.f, 0.f, 1.f);
  uint8_t px[4] = {0, 0, 0, 0};
  const bool read = ReadPixel(probe, 8, 8, px);
  DestroyTarget(probe);
  if (!read) return "the probe target could not be read back";
  if (px[1] != 255) return "the probe target did not take the rendered colour";
  return "";
}

bool EglContext::MakeCurrent() {
  return impl_->display != EGL_NO_DISPLAY &&
         impl_->makeCurrent(impl_->display, EGL_NO_SURFACE, EGL_NO_SURFACE, impl_->context);
}

void EglContext::Release() {
  if (impl_->display != EGL_NO_DISPLAY) {
    impl_->makeCurrent(impl_->display, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
  }
}

void* EglContext::GetProcAddress(const char* name) {
  return reinterpret_cast<void*>(impl_->getProcAddress(name));
}

bool EglContext::CreateTarget(int w, int h, DmabufTarget& out, std::string& error) {
  Impl& m = *impl_;
  gbm_bo* bo = m.boCreate(m.gbm, static_cast<uint32_t>(w), static_cast<uint32_t>(h), GBM_FORMAT_ARGB8888,
                          GBM_BO_USE_RENDERING | GBM_BO_USE_LINEAR);
  if (!bo) {
    // Some drivers refuse an explicit LINEAR request; the reported modifier tells the importer what we got.
    bo = m.boCreate(m.gbm, static_cast<uint32_t>(w), static_cast<uint32_t>(h), GBM_FORMAT_ARGB8888, GBM_BO_USE_RENDERING);
  }
  if (!bo) {
    error = "gbm_bo_create " + std::to_string(w) + "x" + std::to_string(h) + " failed";
    return false;
  }
  const int fd = m.boGetFd(bo);
  if (fd < 0) {
    m.boDestroy(bo);
    error = "gbm_bo_get_fd failed";
    return false;
  }
  const uint32_t stride = m.boGetStride(bo);
  const uint32_t offset = m.boGetOffset ? m.boGetOffset(bo, 0) : 0;
  const uint64_t modifier = m.boGetModifier ? m.boGetModifier(bo) : 0;

  std::vector<EGLint> attrs = {EGL_WIDTH, w, EGL_HEIGHT, h, EGL_LINUX_DRM_FOURCC_EXT, static_cast<EGLint>(kFourccArgb8888),
                               EGL_DMA_BUF_PLANE0_FD_EXT, fd, EGL_DMA_BUF_PLANE0_OFFSET_EXT, static_cast<EGLint>(offset),
                               EGL_DMA_BUF_PLANE0_PITCH_EXT, static_cast<EGLint>(stride)};
  if (m.dmabufModifiers && modifier != kModInvalid) {
    attrs.push_back(EGL_DMA_BUF_PLANE0_MODIFIER_LO_EXT);
    attrs.push_back(static_cast<EGLint>(modifier & 0xffffffffu));
    attrs.push_back(EGL_DMA_BUF_PLANE0_MODIFIER_HI_EXT);
    attrs.push_back(static_cast<EGLint>(modifier >> 32));
  }
  attrs.push_back(EGL_NONE);
  EGLImageKHR image = m.createImage(m.display, EGL_NO_CONTEXT, EGL_LINUX_DMA_BUF_EXT, nullptr, attrs.data());
  if (image == EGL_NO_IMAGE_KHR) {
    char buf[96];
    std::snprintf(buf, sizeof(buf), "eglCreateImage(dma-buf) failed, EGL error 0x%04x", static_cast<unsigned>(m.getError()));
    error = buf;
    close(fd);
    m.boDestroy(bo);
    return false;
  }

  GLuint texture = 0, fbo = 0;
  m.glGenTextures(1, &texture);
  m.glBindTexture(GL_TEXTURE_2D_, texture);
  m.imageTargetTexture(GL_TEXTURE_2D_, image);
  CheckGl("glEGLImageTargetTexture2DOES");
  m.glGenFramebuffers(1, &fbo);
  m.glBindFramebuffer(GL_FRAMEBUFFER_, fbo);
  m.glFramebufferTexture2D(GL_FRAMEBUFFER_, GL_COLOR_ATTACHMENT0_, GL_TEXTURE_2D_, texture, 0);
  const GLenum status = m.glCheckFramebufferStatus(GL_FRAMEBUFFER_);
  m.glBindFramebuffer(GL_FRAMEBUFFER_, 0);
  m.glBindTexture(GL_TEXTURE_2D_, 0);
  CheckGl("framebuffer setup");
  if (status != GL_FRAMEBUFFER_COMPLETE_) {
    char buf[96];
    std::snprintf(buf, sizeof(buf), "framebuffer status 0x%04x for %dx%d", static_cast<unsigned>(status), w, h);
    error = buf;
    m.glDeleteFramebuffers(1, &fbo);
    m.glDeleteTextures(1, &texture);
    m.destroyImage(m.display, image);
    close(fd);
    m.boDestroy(bo);
    return false;
  }

  out.w = w;
  out.h = h;
  out.fd = fd;
  out.stride = stride;
  out.offset = offset;
  out.modifier = modifier == kModInvalid ? 0 : modifier;
  out.bo = bo;
  out.image = image;
  out.texture = texture;
  out.fbo = fbo;
  return true;
}

void EglContext::DestroyTarget(DmabufTarget& t) {
  Impl& m = *impl_;
  if (t.fbo) m.glDeleteFramebuffers(1, &t.fbo);
  if (t.texture) m.glDeleteTextures(1, &t.texture);
  if (t.image) m.destroyImage(m.display, t.image);
  if (t.fd >= 0) close(t.fd);
  if (t.bo) m.boDestroy(static_cast<gbm_bo*>(t.bo));
  t = DmabufTarget();
}

bool EglContext::ReadPixel(const DmabufTarget& t, int x, int y, uint8_t bgra[4]) {
  Impl& m = *impl_;
  if (!t.fbo || x < 0 || y < 0 || x >= t.w || y >= t.h) return false;
  uint8_t rgba[4] = {0, 0, 0, 0};
  m.glBindFramebuffer(GL_FRAMEBUFFER_, t.fbo);
  m.glReadPixels(x, y, 1, 1, GL_RGBA_, GL_UNSIGNED_BYTE_, rgba);
  m.glBindFramebuffer(GL_FRAMEBUFFER_, 0);
  CheckGl("glReadPixels");
  bgra[0] = rgba[2];
  bgra[1] = rgba[1];
  bgra[2] = rgba[0];
  bgra[3] = rgba[3];
  return true;
}

void EglContext::Clear(const DmabufTarget& t, float r, float g, float b, float a) {
  Impl& m = *impl_;
  m.glBindFramebuffer(GL_FRAMEBUFFER_, t.fbo);
  m.glClearColor(r, g, b, a);
  m.glClear(GL_COLOR_BUFFER_BIT_);
  m.glBindFramebuffer(GL_FRAMEBUFFER_, 0);
  m.glFinish();
  CheckGl("clear");
}

void EglContext::Finish() { impl_->glFinish(); }
#endif
