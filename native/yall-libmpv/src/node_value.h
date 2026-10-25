#pragma once
// Owned copy of an mpv_node, so values can cross from the mpv event thread to another thread.
// No Node dependency: the Linux host shares this with the addon.
#include <cstdint>
#include <string>
#include <utility>
#include <vector>
#include <mpv/client.h>

struct NodeValue {
  enum class Type { None, Bool, Int, Double, String, Array, Map };
  Type type = Type::None;
  bool b = false;
  int64_t i = 0;
  double d = 0;
  std::string s;
  std::vector<NodeValue> items;                            // Array
  std::vector<std::pair<std::string, NodeValue>> entries;  // Map
};

// Deep copy of an mpv_node. Byte arrays are dropped (None).
NodeValue CopyNode(const mpv_node& node);

const char* MpvErrorName(int error);
