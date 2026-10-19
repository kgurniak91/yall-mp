#include "thread_cpu.h"

#ifdef _WIN32
#include <windows.h>

double ThreadCpuMs() {
  FILETIME create, exit, kernel, user;
  if (!GetThreadTimes(GetCurrentThread(), &create, &exit, &kernel, &user)) return 0;
  auto toMs = [](const FILETIME& ft) {
    ULARGE_INTEGER u;
    u.LowPart = ft.dwLowDateTime;
    u.HighPart = ft.dwHighDateTime;
    return static_cast<double>(u.QuadPart) / 10000.0;  // 100 ns units
  };
  return toMs(kernel) + toMs(user);
}
#else
#include <time.h>

double ThreadCpuMs() {
  timespec ts;
  if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &ts) != 0) return 0;
  return static_cast<double>(ts.tv_sec) * 1000.0 + static_cast<double>(ts.tv_nsec) / 1e6;
}
#endif
