#pragma once
// Live object counts, for leak tests (exported as liveCounts() by the addon, summed by the host).
#include <atomic>

struct LiveCounts {
  std::atomic<int> cores{0};
  std::atomic<int> eventThreads{0};
  std::atomic<int> renderers{0};
  std::atomic<int> renderThreads{0};
  std::atomic<int> slots{0};
};
LiveCounts& Counts();
