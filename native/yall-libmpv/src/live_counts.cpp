#include "live_counts.h"

LiveCounts& Counts() {
  static LiveCounts counts;
  return counts;
}
