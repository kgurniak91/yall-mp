# Laptop benchmark

Measures the new single-window player against the old (legacy) release on the same machine. Everything is a PowerShell
script; nothing needs to be installed. Unzip `bench-kit.zip` somewhere, for example `C:\bench`:

```
C:\bench\win-unpacked\   the new build
C:\bench\bench\          scripts (this file, laptop-bench.ps1, sampler.ps1)
C:\bench\media\          1080p30-h264.mp4, 1080p60-h264.mp4
```

Open a PowerShell window in `C:\bench\bench` and allow scripts for this window only:
`Set-ExecutionPolicy -Scope Process Bypass`.

## Rules for every run

- Close everything else (browser, chat, updaters). Same screen brightness and resolution for all runs.
- "plugged" = charger connected, power mode on the default. "battery" = charger removed **before** starting the run and
  the battery above 50 %. The script records which one it saw.
- Do not touch mouse or keyboard during a run (about 80 s). Run each scenario **3 times** (`-Scenario` name + `-1`, `-2`, `-3`).
- Use your own 1080p h264 episode with an ASS subtitle as `-Media` / `-Subtitle`. A second episode with 10-bit video
  (Hi10P) is the "hard" case.

## New build

```powershell
$exe = "C:\bench\win-unpacked\Y'ALL Media Player.exe"
.\laptop-bench.ps1 -Exe $exe -Media D:\ep01.mkv -Subtitle D:\ep01.ass -Scenario new-plugged-auto-1
.\laptop-bench.ps1 -Exe $exe -Media D:\ep01.mkv -Subtitle D:\ep01.ass -Scenario new-plugged-off-1 -Hwdec no
.\laptop-bench.ps1 -Exe $exe -Media D:\hi10p.mkv -Subtitle D:\hi10p.ass -Scenario new-plugged-hi10p-1
.\laptop-bench.ps1 -Exe $exe -Media C:\bench\media\1080p60-h264.mp4 -Scenario new-plugged-1080p60-1
```

The app opens by itself, plays from 60 s for about a minute and closes. Repeat with `battery` in the scenario name
after unplugging the charger.

## Legacy build (the installed old release)

```powershell
.\laptop-bench.ps1 -Legacy -Scenario legacy-plugged-auto-1
```

The script asks you to open the project in the old app, sizes its window to the same size as the new build, and then asks
you to press Space in the app and Enter in PowerShell. Do not touch anything for the next minute. The old build has no
drop counters, so write down by eye whether playback was smooth (any stutter, tearing, audio out of sync).

## What to bring back

The whole `C:\bench\bench\results` folder: for each run `*.json` (all numbers), `*.video.log` (which video backend and
GPU the new build picked, and why) and, per scenario, a line from you about smoothness.

## Acceptance (gate)

For the plugged-in, hwdec auto, 1080p h264 + ASS runs: dropped frames at most 0.5 % over the minute, audio and picture in sync
within one frame, the backend is `d3d11-shared` (not a fallback), and the CPU is at most twice the legacy build or at most
legacy + 25 points of one core, whichever is looser. Battery, hwdec off and Hi10P runs are recorded, not gating.
