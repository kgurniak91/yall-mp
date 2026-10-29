#include "host_core.h"
#include <algorithm>
#include <clocale>
#include "live_counts.h"
#include "mpv_loader.h"
#include "render/sw_readback.h"
#ifdef YALL_HAVE_DMABUF
#include "render/dmabuf_shared.h"
#endif
#include "socket_sink.h"

using proto::Json;

namespace {

constexpr int kDefaultSlotTimeoutMs = 3000;
// After destroy nobody comes back for in-flight frames, but frames already on the socket get this long.
constexpr int kDestroyDrainMs = 500;

Json NodeToJson(const NodeValue& v) {
  switch (v.type) {
    case NodeValue::Type::Bool: return v.b;
    case NodeValue::Type::Int: return v.i;
    case NodeValue::Type::Double: return v.d;
    case NodeValue::Type::String: return v.s;
    case NodeValue::Type::Array: {
      Json arr = Json::array();
      for (const auto& item : v.items) arr.push_back(NodeToJson(item));
      return arr;
    }
    case NodeValue::Type::Map: {
      Json obj = Json::object();
      for (const auto& entry : v.entries) obj[entry.first] = NodeToJson(entry.second);
      return obj;
    }
    case NodeValue::Type::None:
    default: return nullptr;
  }
}

Json PercentilesToJson(const PercentileStats& p) { return {{"p50", p.p50}, {"p95", p.p95}, {"max", p.max}}; }

Json AdapterToJson(const AdapterInfo& a) {
  return {{"name", a.name}, {"vendorId", a.vendorId}, {"deviceId", a.deviceId},
          {"luid", std::to_string(a.luidHigh) + ":" + std::to_string(a.luidLow)}, {"software", a.software},
          {"matched", a.matched}, {"selection", a.selection}};
}

Json StatsToJson(const RenderThreadStats& s, size_t draining) {
  const BackendStats& b = s.backend;
  return {{"attachId", s.attachId}, {"backend", b.backend}, {"impl", b.impl}, {"gpuWaitImpl", b.gpuWaitImpl},
          {"adapter", AdapterToJson(b.adapter)}, {"width", s.width}, {"height", s.height},
          {"generation", s.generation}, {"poolSize", b.poolSize}, {"inFlight", b.inFlight},
          {"rendered", b.rendered}, {"exhausted", b.exhausted}, {"released", b.released},
          {"lateReleases", b.lateReleases}, {"reclaimed", b.reclaimed}, {"gpuWaitTimeouts", b.gpuWaitTimeouts},
          {"readbackDropped", s.readbackDropped}, {"postFailures", s.postFailures},
          {"renderMs", PercentilesToJson(b.renderMs)}, {"gpuWaitMs", PercentilesToJson(b.gpuWaitMs)},
          {"releaseMs", PercentilesToJson(b.releaseMs)}, {"copyMs", PercentilesToJson(b.copyMs)},
          {"renderCpuMs", b.renderCpuMs}, {"waitCpuMs", b.waitCpuMs}, {"threadCpuMs", s.threadCpuMs},
          {"threadWallMs", s.threadWallMs}, {"draining", draining},
          {"glErrors", b.glErrors}, {"note", b.note}};
}

// A scalar JSON value as an mpv_node. The string pointer borrows from the JSON value.
bool ScalarToNode(const Json& value, mpv_node& node) {
  if (value.is_boolean()) {
    node.format = MPV_FORMAT_FLAG;
    node.u.flag = value.get<bool>() ? 1 : 0;
  } else if (value.is_number_integer()) {
    node.format = MPV_FORMAT_INT64;
    node.u.int64 = value.get<int64_t>();
  } else if (value.is_number()) {
    node.format = MPV_FORMAT_DOUBLE;
    node.u.double_ = value.get<double>();
  } else if (value.is_string()) {
    node.format = MPV_FORMAT_STRING;
    node.u.string = const_cast<char*>(value.get_ref<const std::string&>().c_str());
  } else {
    return false;
  }
  return true;
}

uint64_t IdOf(const Json& args, const char* key = "id") { return args.value(key, static_cast<uint64_t>(0)); }

}  // namespace

HostCore::~HostCore() { TearDown(); }

bool HostCore::Handle(proto::Message&& message) {
  const Json& args = message.json;
  switch (message.type) {
    case proto::kCreate: Create(args); break;
    case proto::kCommand: Command(args); break;
    case proto::kGetProperty: GetProperty(args); break;
    case proto::kSetProperty: SetProperty(args); break;
    case proto::kObserve: Observe(args); break;
    case proto::kUnobserve: Unobserve(args); break;
    case proto::kLogMessages: LogMessages(args); break;
    case proto::kAttach: Attach(args); break;
    case proto::kResize: Resize(args); break;
    case proto::kDetach: Detach(); break;
    case proto::kRedraw:
      if (currentRenderer_) currentRenderer_->RequestRedraw();
      break;
    case proto::kStats: Stats(args); break;
    case proto::kFrameAck: {
      const int count = args.value("count", 1);
      int current = outstanding_.load();
      while (!outstanding_.compare_exchange_weak(current, std::max(0, current - count))) {}
      break;
    }
    case proto::kReleaseSlot: ReleaseSlot(args); break;
    case proto::kDestroy:
      Destroy(args);
      return false;
    default: break;  // unknown messages are ignored so newer clients can talk to older hosts
  }
  return true;
}

bool HostCore::Ready(uint64_t id) {
  if (destroyed_) {
    SendError(id, "DESTROYED", "destroyed");
    return false;
  }
  if (!initialized_) {
    SendMpvError(id, MPV_ERROR_UNINITIALIZED);
    return false;
  }
  return true;
}

void HostCore::SendReply(uint64_t id, const Json& value) {
  channel_.Write(proto::kReply, {{"id", id}, {"value", value}});
}

void HostCore::SendError(uint64_t id, const std::string& code, const std::string& message, int mpvError) {
  Json error = {{"code", code}, {"message", message}};
  if (mpvError != 0) error["mpvError"] = mpvError;
  channel_.Write(proto::kReply, {{"id", id}, {"error", error}});
}

void HostCore::SendMpvError(uint64_t id, int rc) { SendError(id, MpvErrorName(rc), mpv.error_string(rc), rc); }

void HostCore::SendEvent(const EventMsg& msg) {
  Json out = {{"event", msg.event}};
  if (msg.event == "property-change") {
    out["id"] = msg.observeId;
    out["name"] = msg.propertyName;
    out["data"] = NodeToJson(msg.value);
  } else if (msg.event == "end-file") {
    out["reason"] = msg.reason;
    if (!msg.errorName.empty()) out["error"] = {{"code", msg.errorName}, {"message", msg.errorText}};
  } else if (msg.event == "log-message") {
    out["prefix"] = msg.prefix;
    out["level"] = msg.level;
    out["text"] = msg.text;
  } else if (msg.event == "client-message") {
    out["args"] = msg.args;
  }
  channel_.Write(proto::kEvent, out);
}

void HostCore::Create(const Json& args) {
  const uint64_t id = IdOf(args);
  if (handle_) {
    SendError(id, "INIT_FAILED", "already created");
    return;
  }
  LoadResult loaded = LoadMpv(args.value("lib", std::string()));
  if (!loaded.ok) {
    SendError(id, loaded.code.empty() ? "LIB_NOT_FOUND" : loaded.code, loaded.error);
    return;
  }
  // libmpv refuses to start unless LC_NUMERIC is "C".
  setlocale(LC_NUMERIC, "C");
  handle_ = mpv.create();
  if (!handle_) {
    SendError(id, "INIT_FAILED", "mpv_create failed (LC_NUMERIC must be \"C\")");
    return;
  }
  Counts().cores++;

  for (const auto& option : args.value("options", Json::array())) {
    const std::string name = option.at(0).get<std::string>();
    const std::string value = option.at(1).get<std::string>();
    int rc = mpv.set_option_string(handle_, name.c_str(), value.c_str());
    if (rc < 0) {
      SendError(id, MpvErrorName(rc), "option " + name + "=" + value + ": " + mpv.error_string(rc), rc);
      TearDown();
      return;
    }
  }
  int rc = mpv.initialize(handle_);
  if (rc < 0) {
    SendMpvError(id, rc);
    TearDown();
    return;
  }
  initialized_ = true;
  stop_ = false;
  eventThread_ = std::thread(&HostCore::EventLoop, this);
  SendReply(id, {{"path", loaded.path}, {"apiVersion", {loaded.apiVersion >> 16, loaded.apiVersion & 0xFFFF}}});
}

void HostCore::EventLoop() {
  Counts().eventThreads++;
  while (!stop_) {
    // A bounded wait as a safety net; teardown normally ends the wait through mpv_wakeup.
    mpv_event* ev = mpv.wait_event(handle_, 1.0);
    if (stop_) break;
    if (ev->event_id == MPV_EVENT_NONE) continue;
    std::unique_ptr<EventMsg> msg = ConvertEvent(ev);
    if (!msg) continue;
    if (msg->kind == EventMsg::Kind::Reply) {
      if (msg->error < 0) {
        SendMpvError(msg->replyId, msg->error);
      } else {
        SendReply(msg->replyId, NodeToJson(msg->value));
      }
    } else {
      SendEvent(*msg);
    }
  }
  Counts().eventThreads--;
}

void HostCore::Command(const Json& args) {
  const uint64_t id = IdOf(args);
  if (!Ready(id)) return;
  std::vector<std::string> store = args.value("args", std::vector<std::string>());
  std::vector<const char*> argv;
  for (const auto& s : store) argv.push_back(s.c_str());
  argv.push_back(nullptr);
  int rc = mpv.command_async(handle_, id, argv.data());
  if (rc < 0) SendMpvError(id, rc);
}

void HostCore::GetProperty(const Json& args) {
  const uint64_t id = IdOf(args);
  if (!Ready(id)) return;
  int rc = mpv.get_property_async(handle_, id, args.value("name", std::string()).c_str(), MPV_FORMAT_NODE);
  if (rc < 0) SendMpvError(id, rc);
}

void HostCore::SetProperty(const Json& args) {
  const uint64_t id = IdOf(args);
  if (!Ready(id)) return;
  mpv_node node{};
  if (!args.contains("value") || !ScalarToNode(args["value"], node)) {
    SendError(id, "INVALID_PARAMETER", "setProperty value must be a boolean, number or string");
    return;
  }
  // mpv copies the node, so it only has to outlive the call.
  int rc = mpv.set_property_async(handle_, id, args.value("name", std::string()).c_str(), MPV_FORMAT_NODE, &node);
  if (rc < 0) SendMpvError(id, rc);
}

void HostCore::Observe(const Json& args) {
  if (destroyed_ || !initialized_) return;
  mpv.observe_property(handle_, IdOf(args, "oid"), args.value("name", std::string()).c_str(), MPV_FORMAT_NODE);
}

void HostCore::Unobserve(const Json& args) {
  if (destroyed_ || !initialized_) return;
  mpv.unobserve_property(handle_, IdOf(args, "oid"));
}

void HostCore::LogMessages(const Json& args) {
  if (destroyed_ || !initialized_) return;
  mpv.request_log_messages(handle_, args.value("level", std::string("no")).c_str());
}

void HostCore::Attach(const Json& args) {
  const uint64_t id = IdOf(args);
  if (!Ready(id)) return;
  const std::string backendName = args.value("backend", std::string());
  const std::string impl = args.value("impl", std::string());
  const bool dmabuf = backendName == "dmabuf-shared";
  if (!dmabuf && (backendName != "readback" || (!impl.empty() && impl != "sw"))) {
    SendError(id, "BACKEND_UNSUPPORTED", "the Linux host provides the readback backend (software renderer) and dmabuf-shared");
    return;
  }
#ifndef YALL_HAVE_DMABUF
  if (dmabuf) {
    SendError(id, "BACKEND_UNSUPPORTED", "this host was built without EGL/GBM headers");
    return;
  }
#else
  if (dmabuf && (!fdSender_ || !fdSender_->Available())) {
    SendError(id, "BACKEND_UNSUPPORTED", "the descriptor channel (fd 4) is not available");
    return;
  }
#endif
  const int width = args.value("width", 0);
  const int height = args.value("height", 0);
  if (width <= 0 || height <= 0) {
    SendError(id, "INVALID_PARAMETER", "width and height must be positive integers");
    return;
  }
  const int slotTimeoutMs = std::max(50, args.value("slotTimeoutMs", kDefaultSlotTimeoutMs));

  // Only one render context may exist per core: wait for the previous attach to free its own (short).
  ReapRenderers();
  if (currentRenderer_) {
    auto previous = currentRenderer_;
    previous->Detach();
    currentRenderer_.reset();
    if (!previous->WaitContextFreed(5000)) {
      SendError(id, "DETACH_TIMEOUT", "the previous renderer did not release its render context");
      return;
    }
  }

  const uint64_t attachId = args.value("attachId", static_cast<uint64_t>(renderers_.size() + 1));
  std::unique_ptr<RenderBackend> backend;
#ifdef YALL_HAVE_DMABUF
  if (dmabuf) {
    EglOptions egl;
    egl.vendorId = args.value("vendorId", 0u);
    egl.deviceId = args.value("deviceId", 0u);
    egl.node = args.value("node", std::string());
    FdSender* sender = fdSender_;
    proto::Channel& channel = channel_;
    backend = std::make_unique<DmabufSharedBackend>(
        attachId, std::max(2, args.value("slots", 4)), egl,
        [sender](int fd, const std::string& meta) { return sender->Send(fd, meta); },
        [&channel, attachId](int slotId) {
          channel.Write(proto::kSlotClosed, {{"attachId", attachId}, {"slotId", slotId}});
        });
  }
#endif
  if (!backend) backend = std::make_unique<SwReadbackBackend>();
  auto renderer = std::make_shared<RenderThread>(attachId, std::move(backend),
                                                 std::make_unique<SocketSink>(channel_, outstanding_), width, height,
                                                 slotTimeoutMs);
  std::string err = renderer->Start(handle_);
  if (!err.empty()) {
    SendError(id, "RENDER_INIT_FAILED", err);
    return;
  }
  renderers_.push_back(renderer);
  currentRenderer_ = renderer;

  const RenderThreadStats stats = renderer->Stats();
  SendReply(id, {{"attachId", attachId}, {"backend", stats.backend.backend}, {"impl", stats.backend.impl},
                 {"gpuWaitImpl", stats.backend.gpuWaitImpl}, {"adapter", AdapterToJson(stats.backend.adapter)}});
}

void HostCore::Resize(const Json& args) {
  const int w = args.value("width", 0);
  const int h = args.value("height", 0);
  if (w > 0 && h > 0 && currentRenderer_) currentRenderer_->Resize(w, h);
}

void HostCore::Detach() { DetachAllRenderers(); }

void HostCore::Stats(const Json& args) {
  const uint64_t id = IdOf(args);
  ReapRenderers();
  if (!currentRenderer_) {
    SendReply(id, nullptr);
    return;
  }
  SendReply(id, StatsToJson(currentRenderer_->Stats(), renderers_.size() - 1));
}

void HostCore::ReleaseSlot(const Json& args) {
  const uint64_t attachId = IdOf(args, "attachId");
  for (const auto& r : renderers_) {
    if (r->AttachId() == attachId) {
      r->Release(args.value("slotId", -1), IdOf(args, "serial"));
      break;
    }
  }
}

void HostCore::DetachAllRenderers() {
  for (const auto& r : renderers_) r->Detach();
  currentRenderer_.reset();
}

void HostCore::ReapRenderers() {
  auto finished = [](const std::shared_ptr<RenderThread>& r) { return r->Finished(); };
  for (auto& r : renderers_) {
    if (finished(r)) r->Join();
  }
  renderers_.erase(std::remove_if(renderers_.begin(), renderers_.end(), finished), renderers_.end());
}

void HostCore::ForceStopRenderers() {
  for (const auto& r : renderers_) r->Detach();
  for (const auto& r : renderers_) {
    r->ForceDrainEnd();
    r->Join();
  }
  renderers_.clear();
  currentRenderer_.reset();
}

void HostCore::StopEventThread() {
  stop_ = true;
  if (handle_ && initialized_) mpv.wakeup(handle_);
  if (eventThread_.joinable()) eventThread_.join();
}

// Order matters (render.h): the render context is freed before mpv_terminate_destroy.
void HostCore::TearDown() {
  if (destroyed_) return;
  destroyed_ = true;
  for (const auto& r : renderers_) r->LimitDrain(kDestroyDrainMs);
  DetachAllRenderers();
  StopEventThread();
  for (const auto& r : renderers_) r->WaitContextFreed(5000);
  if (handle_) {
    mpv.terminate_destroy(handle_);
    handle_ = nullptr;
    Counts().cores--;
  }
  ForceStopRenderers();
}

void HostCore::Destroy(const Json& args) {
  TearDown();
  SendReply(IdOf(args), nullptr);
}

void HostCore::Shutdown() { TearDown(); }
