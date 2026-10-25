#include <napi.h>
#include <cstring>
#include "core.h"
#include "mpv_loader.h"
#ifdef __APPLE__
#include "render/iosurface_shared.h"
#endif

namespace {

// loadLibrary(path) -> {path, apiVersion: [major, minor]}. Throws an Error with `code` on failure.
Napi::Value LoadLibraryJs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) throw Napi::TypeError::New(env, "loadLibrary(path)");
  LoadResult result = LoadMpv(info[0].As<Napi::String>().Utf8Value());
  if (!result.ok) {
    Napi::Error e = Napi::Error::New(env, result.error);
    e.Set("code", Napi::String::New(env, result.code));
    throw e;
  }
  Napi::Object out = Napi::Object::New(env);
  out.Set("path", result.path);
  Napi::Array version = Napi::Array::New(env, 2);
  version.Set(0u, Napi::Number::New(env, static_cast<double>(result.apiVersion >> 16)));
  version.Set(1u, Napi::Number::New(env, static_cast<double>(result.apiVersion & 0xFFFF)));
  out.Set("apiVersion", version);
  return out;
}

// apiVersion() -> [major, minor] of the loaded libmpv, or null when none is loaded.
Napi::Value ApiVersionJs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!IsMpvLoaded()) return env.Null();
  unsigned long v = MpvApiVersion();
  Napi::Array version = Napi::Array::New(env, 2);
  version.Set(0u, Napi::Number::New(env, static_cast<double>(v >> 16)));
  version.Set(1u, Napi::Number::New(env, static_cast<double>(v & 0xFFFF)));
  return version;
}

Napi::Value LiveCountsJs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  LiveCounts& c = Counts();
  Napi::Object out = Napi::Object::New(env);
  out.Set("cores", c.cores.load());
  out.Set("eventThreads", c.eventThreads.load());
  out.Set("renderers", c.renderers.load());
  out.Set("renderThreads", c.renderThreads.load());
  out.Set("slots", c.slots.load());
  return out;
}

#ifdef __APPLE__
// readSurfacePixel(handle: Buffer, x, y) -> {r, g, b, a} | null. Test support: peeks into a live IOSurface.
Napi::Value ReadSurfacePixelJs(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsNumber() || !info[2].IsNumber()) {
    throw Napi::TypeError::New(env, "readSurfacePixel(handle, x, y)");
  }
  Napi::Buffer<uint8_t> handle = info[0].As<Napi::Buffer<uint8_t>>();
  if (handle.Length() != sizeof(uint64_t)) throw Napi::TypeError::New(env, "readSurfacePixel: handle must be 8 bytes");
  uint64_t value;
  std::memcpy(&value, handle.Data(), sizeof(value));
  uint8_t bgra[4];
  if (!ReadIOSurfacePixel(value, info[1].As<Napi::Number>().Int32Value(), info[2].As<Napi::Number>().Int32Value(),
                          bgra)) {
    return env.Null();
  }
  Napi::Object out = Napi::Object::New(env);
  out.Set("b", bgra[0]);
  out.Set("g", bgra[1]);
  out.Set("r", bgra[2]);
  out.Set("a", bgra[3]);
  return out;
}
#endif

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("loadLibrary", Napi::Function::New(env, LoadLibraryJs));
  exports.Set("apiVersion", Napi::Function::New(env, ApiVersionJs));
  exports.Set("liveCounts", Napi::Function::New(env, LiveCountsJs));
#ifdef __APPLE__
  exports.Set("readSurfacePixel", Napi::Function::New(env, ReadSurfacePixelJs));
#endif
  MpvCore::Init(env, exports);
  return exports;
}

}  // namespace

NODE_API_MODULE(yall_libmpv, Init)
