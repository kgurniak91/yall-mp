#pragma once
// Owned copy of an mpv_node, so values can cross from the mpv event thread to the JS thread.
#include <napi.h>
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
Napi::Value ToJs(Napi::Env env, const NodeValue& v);

// A scalar JS value as an mpv_node for set_property: boolean -> FLAG, integer -> INT64,
// other number -> DOUBLE, string -> STRING. The string pointer borrows from `storage`.
// Returns false (and leaves `node` untouched) for unsupported types.
bool ScalarToNode(const Napi::Value& value, mpv_node& node, std::string& storage);

const char* MpvErrorName(int error);
