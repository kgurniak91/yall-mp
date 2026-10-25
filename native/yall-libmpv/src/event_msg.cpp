#include "event_msg.h"
#include "mpv_loader.h"

namespace {

const char* EndReasonName(mpv_end_file_reason reason) {
  switch (reason) {
    case MPV_END_FILE_REASON_EOF: return "eof";
    case MPV_END_FILE_REASON_STOP: return "stop";
    case MPV_END_FILE_REASON_QUIT: return "quit";
    case MPV_END_FILE_REASON_ERROR: return "error";
    case MPV_END_FILE_REASON_REDIRECT: return "redirect";
    default: return "unknown";
  }
}

}  // namespace

std::unique_ptr<EventMsg> ConvertEvent(const mpv_event* ev) {
  auto msg = std::make_unique<EventMsg>();
  switch (ev->event_id) {
    case MPV_EVENT_PROPERTY_CHANGE: {
      msg->event = "property-change";
      msg->observeId = ev->reply_userdata;
      auto* p = static_cast<mpv_event_property*>(ev->data);
      msg->propertyName = p->name ? p->name : "";
      if (p->format == MPV_FORMAT_NODE && p->data) msg->value = CopyNode(*static_cast<mpv_node*>(p->data));
      return msg;
    }
    case MPV_EVENT_GET_PROPERTY_REPLY: {
      msg->kind = EventMsg::Kind::Reply;
      msg->replyId = ev->reply_userdata;
      msg->error = ev->error;
      auto* p = static_cast<mpv_event_property*>(ev->data);
      if (ev->error >= 0 && p && p->format == MPV_FORMAT_NODE && p->data) {
        msg->value = CopyNode(*static_cast<mpv_node*>(p->data));
      }
      return msg;
    }
    case MPV_EVENT_SET_PROPERTY_REPLY: {
      msg->kind = EventMsg::Kind::Reply;
      msg->replyId = ev->reply_userdata;
      msg->error = ev->error;
      return msg;
    }
    case MPV_EVENT_COMMAND_REPLY: {
      msg->kind = EventMsg::Kind::Reply;
      msg->replyId = ev->reply_userdata;
      msg->error = ev->error;
      auto* c = static_cast<mpv_event_command*>(ev->data);
      if (ev->error >= 0 && c) msg->value = CopyNode(c->result);
      return msg;
    }
    case MPV_EVENT_END_FILE: {
      msg->event = "end-file";
      auto* e = static_cast<mpv_event_end_file*>(ev->data);
      msg->reason = EndReasonName(e->reason);
      if (e->reason == MPV_END_FILE_REASON_ERROR && e->error < 0) {
        msg->error = e->error;
        msg->errorName = MpvErrorName(e->error);
        msg->errorText = mpv.error_string(e->error);
      }
      return msg;
    }
    case MPV_EVENT_START_FILE:
    case MPV_EVENT_FILE_LOADED:
    case MPV_EVENT_SEEK:
    case MPV_EVENT_PLAYBACK_RESTART:
    case MPV_EVENT_SHUTDOWN:
      msg->event = mpv.event_name(ev->event_id);
      return msg;
    case MPV_EVENT_LOG_MESSAGE: {
      msg->event = "log-message";
      auto* l = static_cast<mpv_event_log_message*>(ev->data);
      msg->prefix = l->prefix ? l->prefix : "";
      msg->level = l->level ? l->level : "";
      msg->text = l->text ? l->text : "";
      return msg;
    }
    case MPV_EVENT_CLIENT_MESSAGE: {
      msg->event = "client-message";
      auto* m = static_cast<mpv_event_client_message*>(ev->data);
      for (int i = 0; i < m->num_args; i++) msg->args.emplace_back(m->args[i] ? m->args[i] : "");
      return msg;
    }
    default:
      return nullptr;
  }
}
