#pragma once
// Runtime loader for libmpv. The addon never links against libmpv: a missing or too old
// library gives a JS error with the tried path instead of a process that fails to start.
#include <mpv/client.h>
#include <mpv/render.h>
#ifdef _WIN32
#include <mpv/render_d3d11.h>
#endif
#include <string>

#define YALL_MPV_FUNCS(X)                              \
  X(client_api_version, mpv_client_api_version)        \
  X(create, mpv_create)                                \
  X(set_option_string, mpv_set_option_string)          \
  X(initialize, mpv_initialize)                        \
  X(command_async, mpv_command_async)                  \
  X(get_property_async, mpv_get_property_async)        \
  X(set_property_async, mpv_set_property_async)        \
  X(observe_property, mpv_observe_property)            \
  X(unobserve_property, mpv_unobserve_property)        \
  X(request_log_messages, mpv_request_log_messages)    \
  X(wait_event, mpv_wait_event)                        \
  X(wakeup, mpv_wakeup)                                \
  X(terminate_destroy, mpv_terminate_destroy)          \
  X(free, mpv_free)                                    \
  X(free_node_contents, mpv_free_node_contents)        \
  X(error_string, mpv_error_string)                    \
  X(event_name, mpv_event_name)                        \
  X(render_context_create, mpv_render_context_create)  \
  X(render_context_set_update_callback, mpv_render_context_set_update_callback) \
  X(render_context_update, mpv_render_context_update)  \
  X(render_context_render, mpv_render_context_render)  \
  X(render_context_report_swap, mpv_render_context_report_swap) \
  X(render_context_free, mpv_render_context_free)

struct MpvApi {
#define X(field, symbol) decltype(&::symbol) field;
  YALL_MPV_FUNCS(X)
#undef X
};

extern MpvApi mpv;

struct LoadResult {
  bool ok = false;
  std::string error;       // user-readable, set when !ok
  std::string code;        // LIB_NOT_FOUND | LIB_INVALID | LIB_ALREADY_LOADED, set when !ok
  std::string path;        // path the library was loaded from
  unsigned long apiVersion = 0;
};

// Loads libmpv once per process. A second call with the same path succeeds, with a different path it fails
// ("already loaded from X"). `path` is UTF-8; a bare name (no separator) goes through the OS library search.
LoadResult LoadMpv(const std::string& path);
bool IsMpvLoaded();
unsigned long MpvApiVersion();
