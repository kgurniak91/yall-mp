#include "node_value.h"

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
