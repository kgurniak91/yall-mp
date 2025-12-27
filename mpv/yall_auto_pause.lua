local target_end_time = nil
local auto_pause_enabled = false
local has_fired_for_current_target = false

mp.register_script_message("set-auto-pause", function(time, enabled)
    local t = tonumber(time)
    if not t or t <= 0 then
        target_end_time = nil
    else
        target_end_time = t
    end

    auto_pause_enabled = (enabled == "true")
    has_fired_for_current_target = false
end)

mp.observe_property("time-pos", "number", function(_, time)
    if not time or not target_end_time or has_fired_for_current_target then
        return
    end

    if time >= target_end_time then
        has_fired_for_current_target = true

        if auto_pause_enabled then
            -- Pause immediately
            mp.set_property("pause", "yes")

            -- Snap the internal MPV clock to the end (minus buffer)
            mp.commandv("seek", target_end_time - 0.01, "absolute", "exact")

            auto_pause_enabled = false

            -- Notify UI that the snap is done
            mp.set_property("user-data/auto-pause-fired", mp.get_time())
        else
            if mp.get_property_bool("pause") == false then
                mp.set_property("user-data/clip-ended-naturally", mp.get_time())
            else
                has_fired_for_current_target = false
            end
        end
    end
end)
