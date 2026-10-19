#pragma once
// Fixed-size sample ring with percentiles. Not thread-safe: callers hold their own lock.
#include <algorithm>
#include <array>
#include <cstddef>
#include <vector>

class RingStats {
 public:
  void Push(double v) {
    samples_[next_] = v;
    next_ = (next_ + 1) % kCapacity;
    if (count_ < kCapacity) count_++;
    if (v > max_) max_ = v;
  }

  // p in [0, 1]. Sorts a copy, so call it from stats(), not per frame.
  double Percentile(double p) const {
    if (count_ == 0) return 0;
    std::vector<double> copy(samples_.begin(), samples_.begin() + static_cast<std::ptrdiff_t>(count_));
    std::sort(copy.begin(), copy.end());
    size_t idx = std::min(copy.size() - 1, static_cast<size_t>(p * static_cast<double>(copy.size())));
    return copy[idx];
  }

  double Max() const { return max_; }
  size_t Count() const { return count_; }

 private:
  static constexpr size_t kCapacity = 512;
  std::array<double, kCapacity> samples_{};
  size_t next_ = 0;
  size_t count_ = 0;
  double max_ = 0;
};
