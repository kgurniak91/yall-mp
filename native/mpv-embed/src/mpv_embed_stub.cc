// Non-macOS build of the add-on: nothing to embed, `probe()` says so.
// Windows and Linux keep the separate mpv process + `--wid` window embedding.

#include <napi.h>

namespace {

Napi::Value Probe(const Napi::CallbackInfo& info)
{
    Napi::Object result = Napi::Object::New(info.Env());
    result.Set("ok", false);
    result.Set("error", "yall_mpv_embed is only implemented for macOS");
    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    exports.Set("probe", Napi::Function::New(env, Probe));
    return exports;
}

} // namespace

NODE_API_MODULE(yall_mpv_embed, Init)
