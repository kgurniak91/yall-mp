#pragma once
// Runtime loader for libmpv: no import lib needed, a missing dll gives a JS error instead of a crash.
#include <mpv/client.h>
#include <mpv/render.h>
#include <mpv/render_d3d11.h>
#include <string>

struct MpvApi {
  mpv_handle* (*create)();
  int (*set_option_string)(mpv_handle*, const char*, const char*);
  int (*initialize)(mpv_handle*);
  int (*command)(mpv_handle*, const char**);
  int (*command_async)(mpv_handle*, uint64_t, const char**);
  int (*get_property)(mpv_handle*, const char*, mpv_format, void*);
  char* (*get_property_string)(mpv_handle*, const char*);
  int (*set_property_string)(mpv_handle*, const char*, const char*);
  int (*observe_property)(mpv_handle*, uint64_t, const char*, mpv_format);
  mpv_event* (*wait_event)(mpv_handle*, double);
  void (*wakeup)(mpv_handle*);
  void (*terminate_destroy)(mpv_handle*);
  void (*free)(void*);
  const char* (*error_string)(int);
  const char* (*event_name)(mpv_event_id);
  int (*render_context_create)(mpv_render_context**, mpv_handle*, mpv_render_param*);
  void (*render_context_set_update_callback)(mpv_render_context*, mpv_render_update_fn, void*);
  uint64_t (*render_context_update)(mpv_render_context*);
  int (*render_context_render)(mpv_render_context*, mpv_render_param*);
  void (*render_context_report_swap)(mpv_render_context*);
  void (*render_context_free)(mpv_render_context*);
};

extern MpvApi mpv;

// Returns an empty string on success, otherwise an error message.
std::string LoadMpv(const std::wstring& dllPath);
