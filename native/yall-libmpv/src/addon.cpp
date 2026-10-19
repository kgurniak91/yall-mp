#include <napi.h>
#include "core.h"
#include "mpv_loader.h"

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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("loadLibrary", Napi::Function::New(env, LoadLibraryJs));
  exports.Set("apiVersion", Napi::Function::New(env, ApiVersionJs));
  exports.Set("liveCounts", Napi::Function::New(env, LiveCountsJs));
  MpvCore::Init(env, exports);
  return exports;
}

}  // namespace

NODE_API_MODULE(yall_libmpv, Init)
