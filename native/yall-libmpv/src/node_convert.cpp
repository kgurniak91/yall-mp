#include "node_convert.h"
#include <cmath>

NodeValue CopyNode(const mpv_node& node) {
  NodeValue v;
  switch (node.format) {
    case MPV_FORMAT_STRING:
      v.type = NodeValue::Type::String;
      if (node.u.string) v.s = node.u.string;
      break;
    case MPV_FORMAT_FLAG:
      v.type = NodeValue::Type::Bool;
      v.b = node.u.flag != 0;
      break;
    case MPV_FORMAT_INT64:
      v.type = NodeValue::Type::Int;
      v.i = node.u.int64;
      break;
    case MPV_FORMAT_DOUBLE:
      v.type = NodeValue::Type::Double;
      v.d = node.u.double_;
      break;
    case MPV_FORMAT_NODE_ARRAY:
      v.type = NodeValue::Type::Array;
      if (node.u.list) {
        v.items.reserve(static_cast<size_t>(node.u.list->num));
        for (int k = 0; k < node.u.list->num; k++) v.items.push_back(CopyNode(node.u.list->values[k]));
      }
      break;
    case MPV_FORMAT_NODE_MAP:
      v.type = NodeValue::Type::Map;
      if (node.u.list) {
        v.entries.reserve(static_cast<size_t>(node.u.list->num));
        for (int k = 0; k < node.u.list->num; k++) {
          v.entries.emplace_back(node.u.list->keys[k] ? node.u.list->keys[k] : "", CopyNode(node.u.list->values[k]));
        }
      }
      break;
    default:
      break;  // NONE, BYTE_ARRAY
  }
  return v;
}

Napi::Value ToJs(Napi::Env env, const NodeValue& v) {
  switch (v.type) {
    case NodeValue::Type::Bool:
      return Napi::Boolean::New(env, v.b);
    case NodeValue::Type::Int:
      return Napi::Number::New(env, static_cast<double>(v.i));
    case NodeValue::Type::Double:
      return Napi::Number::New(env, v.d);
    case NodeValue::Type::String:
      return Napi::String::New(env, v.s);
    case NodeValue::Type::Array: {
      Napi::Array arr = Napi::Array::New(env, v.items.size());
      for (size_t k = 0; k < v.items.size(); k++) arr.Set(static_cast<uint32_t>(k), ToJs(env, v.items[k]));
      return arr;
    }
    case NodeValue::Type::Map: {
      Napi::Object obj = Napi::Object::New(env);
      for (const auto& entry : v.entries) obj.Set(entry.first, ToJs(env, entry.second));
      return obj;
    }
    case NodeValue::Type::None:
    default:
      return env.Null();
  }
}

bool ScalarToNode(const Napi::Value& value, mpv_node& node, std::string& storage) {
  if (value.IsBoolean()) {
    node.format = MPV_FORMAT_FLAG;
    node.u.flag = value.As<Napi::Boolean>().Value() ? 1 : 0;
    return true;
  }
  if (value.IsNumber()) {
    double d = value.As<Napi::Number>().DoubleValue();
    if (std::isfinite(d) && std::floor(d) == d && std::fabs(d) < 9007199254740992.0) {
      node.format = MPV_FORMAT_INT64;
      node.u.int64 = static_cast<int64_t>(d);
    } else {
      node.format = MPV_FORMAT_DOUBLE;
      node.u.double_ = d;
    }
    return true;
  }
  if (value.IsString()) {
    storage = value.As<Napi::String>().Utf8Value();
    node.format = MPV_FORMAT_STRING;
    node.u.string = const_cast<char*>(storage.c_str());
    return true;
  }
  return false;
}

const char* MpvErrorName(int error) {
  switch (error) {
    case MPV_ERROR_SUCCESS: return "SUCCESS";
    case MPV_ERROR_EVENT_QUEUE_FULL: return "EVENT_QUEUE_FULL";
    case MPV_ERROR_NOMEM: return "NOMEM";
    case MPV_ERROR_UNINITIALIZED: return "UNINITIALIZED";
    case MPV_ERROR_INVALID_PARAMETER: return "INVALID_PARAMETER";
    case MPV_ERROR_OPTION_NOT_FOUND: return "OPTION_NOT_FOUND";
    case MPV_ERROR_OPTION_FORMAT: return "OPTION_FORMAT";
    case MPV_ERROR_OPTION_ERROR: return "OPTION_ERROR";
    case MPV_ERROR_PROPERTY_NOT_FOUND: return "PROPERTY_NOT_FOUND";
    case MPV_ERROR_PROPERTY_FORMAT: return "PROPERTY_FORMAT";
    case MPV_ERROR_PROPERTY_UNAVAILABLE: return "PROPERTY_UNAVAILABLE";
    case MPV_ERROR_PROPERTY_ERROR: return "PROPERTY_ERROR";
    case MPV_ERROR_COMMAND: return "COMMAND";
    case MPV_ERROR_LOADING_FAILED: return "LOADING_FAILED";
    case MPV_ERROR_AO_INIT_FAILED: return "AO_INIT_FAILED";
    case MPV_ERROR_VO_INIT_FAILED: return "VO_INIT_FAILED";
    case MPV_ERROR_NOTHING_TO_PLAY: return "NOTHING_TO_PLAY";
    case MPV_ERROR_UNKNOWN_FORMAT: return "UNKNOWN_FORMAT";
    case MPV_ERROR_UNSUPPORTED: return "UNSUPPORTED";
    case MPV_ERROR_NOT_IMPLEMENTED: return "NOT_IMPLEMENTED";
    default: return "GENERIC";
  }
}
