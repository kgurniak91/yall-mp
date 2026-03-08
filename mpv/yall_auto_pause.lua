local target_end_time = nil
local current_token = nil
local has_fired_for_current_target = false
local trigger_offset = 0.01

mp.register_script_message("set-auto-pause", function(time, token)
  local t = tonumber(time)
  if not t or t <= 0 then
    target_end_time = nil
    current_token = nil
  else
    target_end_time = t
    current_token = token
  end
  has_fired_for_current_target = false
end)

mp.observe_property("time-pos", "number", function(_, time)
  if not time or not target_end_time or has_fired_for_current_target then
    return
  end

  if time >= (target_end_time - trigger_offset) then
    has_fired_for_current_target = true

    -- Pause immediately
    mp.set_property("pause", "yes")

    -- Snap the internal MPV clock to the end (minus buffer) if auto-pause happened too late
    if time >= target_end_time then
      mp.commandv("seek", target_end_time - trigger_offset, "absolute", "exact")
    end

    -- Notify UI that the snap is done, returning the validation token
    mp.set_property("user-data/auto-pause-fired", current_token)
  end
end)
