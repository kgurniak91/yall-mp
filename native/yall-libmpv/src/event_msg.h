#pragma once
// An mpv event converted into an owned message that can leave the mpv event thread. No Node dependency:
// shared by the addon and the Linux host. Command/get/set replies are separated from plain events by `kind`.
#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include "node_value.h"

struct EventMsg {
  enum class Kind { Event, Reply };
  Kind kind = Kind::Event;

  // Reply
  uint64_t replyId = 0;
  int error = 0;
  NodeValue value;

  // Event
  std::string event;  // mpv event name: property-change, end-file, seek, ...
  uint64_t observeId = 0;
  std::string propertyName;
  std::string reason;      // end-file: eof | stop | quit | error | redirect
  std::string errorName;   // end-file with reason error
  std::string errorText;
  std::string prefix, level, text;  // log-message
  std::vector<std::string> args;    // client-message
};

// Converts an mpv event into an owned message. Returns null for events nobody listens to.
std::unique_ptr<EventMsg> ConvertEvent(const mpv_event* ev);
