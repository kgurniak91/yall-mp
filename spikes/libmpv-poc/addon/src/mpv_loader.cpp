#include "mpv_loader.h"
#include <windows.h>

MpvApi mpv{};
static HMODULE g_lib = nullptr;

template <typename T>
static bool Bind(T& fn, const char* name, std::string& err) {
  fn = reinterpret_cast<T>(GetProcAddress(g_lib, name));
  if (!fn) {
    err = std::string("libmpv is missing export ") + name;
    return false;
  }
  return true;
}

std::string LoadMpv(const std::wstring& dllPath) {
  if (g_lib) return "";
  g_lib = LoadLibraryExW(dllPath.c_str(), nullptr, LOAD_WITH_ALTERED_SEARCH_PATH);
  if (!g_lib) return "LoadLibrary failed, error " + std::to_string(GetLastError());
  std::string err;
  bool ok = Bind(mpv.create, "mpv_create", err) &&
            Bind(mpv.set_option_string, "mpv_set_option_string", err) &&
            Bind(mpv.initialize, "mpv_initialize", err) &&
            Bind(mpv.command, "mpv_command", err) &&
            Bind(mpv.command_async, "mpv_command_async", err) &&
            Bind(mpv.get_property, "mpv_get_property", err) &&
            Bind(mpv.get_property_string, "mpv_get_property_string", err) &&
            Bind(mpv.set_property_string, "mpv_set_property_string", err) &&
            Bind(mpv.observe_property, "mpv_observe_property", err) &&
            Bind(mpv.wait_event, "mpv_wait_event", err) &&
            Bind(mpv.wakeup, "mpv_wakeup", err) &&
            Bind(mpv.terminate_destroy, "mpv_terminate_destroy", err) &&
            Bind(mpv.free, "mpv_free", err) &&
            Bind(mpv.error_string, "mpv_error_string", err) &&
            Bind(mpv.event_name, "mpv_event_name", err) &&
            Bind(mpv.render_context_create, "mpv_render_context_create", err) &&
            Bind(mpv.render_context_set_update_callback, "mpv_render_context_set_update_callback", err) &&
            Bind(mpv.render_context_update, "mpv_render_context_update", err) &&
            Bind(mpv.render_context_render, "mpv_render_context_render", err) &&
            Bind(mpv.render_context_report_swap, "mpv_render_context_report_swap", err) &&
            Bind(mpv.render_context_free, "mpv_render_context_free", err);
  return ok ? "" : err;
}
