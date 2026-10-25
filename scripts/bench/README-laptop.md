# Laptop benchmark

Compares the new single-window player with the old (legacy) release on the same machine. The kit brings its own test
videos (two minutes of an anime episode with embedded styled subtitles, once as ordinary 8-bit 1080p and once as
10-bit, plus a 1080p60 test clip), so you do not need any files of your own. Nothing needs to be installed.

Unzip `bench-kit.zip` (for example to `C:\bench`):

```
bench-kit\win-unpacked\   the new build
bench-kit\media\          the test videos
bench-kit\bench\          the scripts (this file, run-bench.ps1, sampler.ps1)
```

Open PowerShell in the `bench` folder and run `Set-ExecutionPolicy -Scope Process Bypass`.

## Before you start

Close everything else (browser, chat, updaters), plug the charger in if the laptop has a battery, and do not touch the
mouse or keyboard while a run is going.

## 1. New build (about 25 minutes, fully automatic)

```powershell
.\run-bench.ps1
```

It runs four scenarios three times each (episode with hardware decoding, episode without, 10-bit episode, 1080p60 clip): the app opens by itself,
plays about a minute and closes. At the end it prints a table and writes `bench-results.zip`.

## 2. Old build (about 10 minutes, a few clicks)

Install or keep the old release as it was. Then:

```powershell
.\run-bench.ps1 -Legacy
```

For each run the script tells you which file to open in the old app (drag it in and create the project; pick the
embedded subtitle track). It resizes the window, you press Space when asked, then do not touch anything for a minute
and say whether playback looked smooth. Do this six times in total (two files, three runs each).

If your old app has another name than `Y'ALL Media Player` in the task manager, add `-LegacyProcessName "<name>"`.

## What to send back

`bench\bench-results.zip` (made by the script; the second run overwrites the first, so copy the new-build one away
before running `-Legacy`, for example rename it to `bench-results-new.zip`).

## Gate (for the maintainer)

For `episode-auto`: dropped frames at most 0.5 % over the minute, the backend is `d3d11-shared` (no fallback), and the
CPU is at most twice the legacy build or at most legacy + 25 points of one core, whichever is looser. The other scenarios
are recorded, not gating. The 10-bit episode may be slow without hardware decoding on an old GPU; that is the same in the old build.`benchench-results.zip` after the last run. It contains the results of both the new and the old build (they pile up in the `results` folder), so send only the final zip.

## Gate (for the maintainer)

For `episode-auto`: dropped frames at most 0.5 % over the minute, the backend is `d3d11-shared` (no fallback), and the
CPU is at most twice the legacy build or at most legacy + 25 points of one core, whichever is looser. The other scenarios
are recorded, not gating. The 10-bit episode may be slow without hardware decoding on an old GPU; that is the same in the old build.
