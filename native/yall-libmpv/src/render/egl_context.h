#pragma once
#if defined(__linux__) && defined(YALL_HAVE_DMABUF)
// EGL on the GBM platform for a DRM node, plus dma-buf backed render targets. libEGL and libgbm are loaded with
// dlopen, so a host on a system without them still runs (readback only). No libmpv dependency.
#include <cstdint>
#include <string>
#include <vector>

struct DmabufTarget {
  int w = 0, h = 0;
  int fd = -1;            // dma-buf of the buffer object; owned by the target (closed by DestroyTarget)
  uint32_t stride = 0;    // bytes per row of plane 0
  uint32_t offset = 0;
  uint64_t modifier = 0;  // DRM format modifier, 0 = LINEAR
  void* bo = nullptr;     // gbm_bo*
  void* image = nullptr;  // EGLImage
  unsigned int texture = 0;
  unsigned int fbo = 0;
};

struct EglOptions {
  uint32_t vendorId = 0;  // PCI ids of the GPU Chromium renders on; 0 = no preference
  uint32_t deviceId = 0;
  std::string node;       // explicit DRM node path, tried first
};

class EglContext {
 public:
  EglContext();
  ~EglContext();
  EglContext(const EglContext&) = delete;
  EglContext& operator=(const EglContext&) = delete;

  // Tries the preferred render node, the other render nodes, then the card nodes (software GL drivers can
  // refuse buffer allocation on a render node). A node is accepted once a 16x16 target works end to end.
  // Returns an error message, empty on success.
  std::string Open(const EglOptions& options);
  void Close();

  bool MakeCurrent();  // on the calling thread
  void Release();      // unbinds from the calling thread
  void* GetProcAddress(const char* name);

  // Context must be current.
  bool CreateTarget(int w, int h, DmabufTarget& out, std::string& error);
  void DestroyTarget(DmabufTarget& target);
  bool ReadPixel(const DmabufTarget& target, int x, int y, uint8_t bgra[4]);
  void Clear(const DmabufTarget& target, float r, float g, float b, float a);
  void Finish();
  // Drains glGetError, counts what it finds and keeps the first few as notes.
  void CheckGl(const char* where);

  const std::string& Node() const { return node_; }
  bool IsRenderNode() const { return isRenderNode_; }
  int NodeFd() const { return nodeFd_; }
  const std::string& GlVersion() const { return glVersion_; }
  const std::string& GlRenderer() const { return glRenderer_; }
  const std::string& GlVendor() const { return glVendor_; }
  const std::string& EglVendor() const { return eglVendor_; }
  bool Software() const { return software_; }
  bool Gles() const { return gles_; }
  uint64_t GlErrors() const { return glErrors_; }
  const std::vector<std::string>& Notes() const { return notes_; }

 private:
  struct Impl;
  Impl* impl_;
  std::string node_;
  bool isRenderNode_ = false;
  int nodeFd_ = -1;
  std::string glVersion_, glRenderer_, glVendor_, eglVendor_;
  bool software_ = false;
  bool gles_ = false;
  uint64_t glErrors_ = 0;
  std::vector<std::string> notes_;

  std::string OpenNode(const std::string& path);
  void Note(const std::string& text);
};
#endif
