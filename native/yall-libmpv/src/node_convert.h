#pragma once
// Conversions between JS values and mpv/NodeValue data (the Node-dependent half; see node_value.h).
#include <napi.h>
#include <string>
#include <mpv/client.h>
#include "node_value.h"

Napi::Value ToJs(Napi::Env env, const NodeValue& v);

// A scalar JS value as an mpv_node for set_property: boolean -> FLAG, integer -> INT64,
// other number -> DOUBLE, string -> STRING. The string pointer borrows from `storage`.
// Returns false (and leaves `node` untouched) for unsupported types.
bool ScalarToNode(const Napi::Value& value, mpv_node& node, std::string& storage);
