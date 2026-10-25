#include "node_convert.h"
#include <cmath>

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
