#include "mpv_loader.h"
#include <mutex>

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

MpvApi mpv{};

namespace {

std::mutex g_mutex;
std::string g_loadedPath;
unsigned long g_apiVersion = 0;
bool g_loaded = false;

#ifdef _WIN32
using LibHandle = HMODULE;

std::wstring ToWide(const std::string& s) {
  if (s.empty()) return L"";
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  std::wstring w(static_cast<size_t>(n > 0 ? n - 1 : 0), L'\0');
  if (n > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n);
  return w;
}

std::string ToUtf8(const std::wstring& w) {
  if (w.empty()) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
  std::string s(static_cast<size_t>(n > 0 ? n - 1 : 0), '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, &s[0], n, nullptr, nullptr);
  return s;
}

std::string LastErrorMessage() {
  DWORD code = GetLastError();
  wchar_t* buf = nullptr;
  DWORD len = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                             nullptr, code, 0, reinterpret_cast<LPWSTR>(&buf), 0, nullptr);
  std::string msg = len && buf ? ToUtf8(std::wstring(buf, len)) : "";
  if (buf) LocalFree(buf);
  while (!msg.empty() && (msg.back() == '\r' || msg.back() == '\n' || msg.back() == ' ' || msg.back() == '.')) msg.pop_back();
  return (msg.empty() ? std::string("unknown error") : msg) + " (error " + std::to_string(code) + ")";
}

LibHandle OpenLib(const std::string& path, std::string& err) {
  bool hasDir = path.find('\\') != std::string::npos || path.find('/') != std::string::npos ||
                path.find(':') != std::string::npos;
  // LOAD_WITH_ALTERED_SEARCH_PATH is only defined for absolute paths; it makes libmpv's own dependencies
  // (ffmpeg dlls etc. next to it) resolve from its directory.
  LibHandle h = LoadLibraryExW(ToWide(path).c_str(), nullptr, hasDir ? LOAD_WITH_ALTERED_SEARCH_PATH : 0);
  if (!h) err = LastErrorMessage();
  return h;
}

void* FindSymbol(LibHandle h, const char* name) {
  return reinterpret_cast<void*>(GetProcAddress(h, name));
}

void CloseLib(LibHandle h) { FreeLibrary(h); }
#else
using LibHandle = void*;

LibHandle OpenLib(const std::string& path, std::string& err) {
  LibHandle h = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!h) {
    const char* e = dlerror();
    err = e ? e : "dlopen failed";
  }
  return h;
}

void* FindSymbol(LibHandle h, const char* name) { return dlsym(h, name); }

void CloseLib(LibHandle h) { dlclose(h); }
#endif

}  // namespace

LoadResult LoadMpv(const std::string& path) {
  std::lock_guard<std::mutex> lock(g_mutex);
  LoadResult result;
  if (g_loaded) {
    if (g_loadedPath != path) {
      result.code = "LIB_ALREADY_LOADED";
      result.error = "libmpv is already loaded from " + g_loadedPath + ", cannot load " + path;
      return result;
    }
    result.ok = true;
    result.path = g_loadedPath;
    result.apiVersion = g_apiVersion;
    return result;
  }

  std::string err;
  LibHandle lib = OpenLib(path, err);
  if (!lib) {
    result.code = "LIB_NOT_FOUND";
    result.error = "Could not load libmpv from " + path + ": " + err;
    return result;
  }

  MpvApi api{};
  bool ok = true;
#define X(field, symbol)                                                                   \
  if (ok) {                                                                                \
    api.field = reinterpret_cast<decltype(api.field)>(FindSymbol(lib, #symbol));           \
    if (!api.field) {                                                                      \
      ok = false;                                                                          \
      result.error = "The library at " + path + " is not a usable libmpv: missing export " #symbol; \
    }                                                                                      \
  }
  YALL_MPV_FUNCS(X)
#undef X
  if (!ok) {
    CloseLib(lib);
    return result;
  }

  mpv = api;
  g_loaded = true;
  g_loadedPath = path;
  g_apiVersion = mpv.client_api_version();
  result.ok = true;
  result.path = path;
  result.apiVersion = g_apiVersion;
  return result;
}

bool IsMpvLoaded() {
  std::lock_guard<std::mutex> lock(g_mutex);
  return g_loaded;
}

unsigned long MpvApiVersion() {
  std::lock_guard<std::mutex> lock(g_mutex);
  return g_apiVersion;
}
