# One benchmark scenario on the machine it runs on (built for the old laptop, works anywhere on Windows).
#
#   New build:  .\laptop-bench.ps1 -Exe ..\win-unpacked\"Y'ALL Media Player.exe" -Media D:\ep01.mkv -Subtitle D:\ep01.ass -Scenario new-plugged-auto
#   Legacy:     .\laptop-bench.ps1 -Legacy -Scenario legacy-plugged-auto   (open the project in the old app first, press Space when asked)
#
# Writes results\<Scenario>.json with the sampler numbers (CPU and GPU engines), the power source and, for the new
# build, the counters of the built-in bench mode (dropped frames, avsync, backend, adapter).
param(
  [string]$Exe,
  [string[]]$AppArgs = @(),   # only for trying the script on a dev tree: -Exe electron.exe -AppArgs <repo folder>
  [string]$Media,
  [string]$Subtitle = '',
  [Parameter(Mandatory = $true)][string]$Scenario,
  [ValidateSet('auto', 'no')][string]$Hwdec = 'auto',
  [switch]$Legacy,
  [string]$LegacyProcessName = "Y'ALL Media Player",
  [double]$StartSec = 60,
  [double]$WarmupSec = 10,
  [double]$MeasureSec = 60,
  [int]$Width = 1600,
  [int]$Height = 900
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$results = Join-Path $here 'results'
New-Item -ItemType Directory -Force $results | Out-Null
$sampler = Join-Path $here 'sampler.ps1'
$samplerOut = Join-Path $results "$Scenario.sampler.json"

function Get-PowerSource {
  $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $battery) { return 'no battery (desktop)' }
  # 1 = discharging, 2 = on AC power, 3-5 = charged / charging
  if ($battery.BatteryStatus -eq 1) { return 'battery' } else { return 'plugged in' }
}

function Read-Json([string]$path) {
  Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json
}

$summary = [ordered]@{
  scenario = $Scenario; legacy = [bool]$Legacy; hwdec = $Hwdec; power = Get-PowerSource
  machine = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
  gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) (driver $($_.DriverVersion))" })
  media = $Media; time = (Get-Date).ToString('s')
}

if ($Legacy) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Win32Window {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
}
'@
  Write-Host "Open your project in the legacy app, then press Enter here (do not press Space yet)."
  [void](Read-Host)
  $proc = Get-Process | Where-Object { $_.ProcessName -eq $LegacyProcessName -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { throw "No window of '$LegacyProcessName' found; pass -LegacyProcessName." }
  [void][Win32Window]::ShowWindow($proc.MainWindowHandle, 9)   # SW_RESTORE
  [void][Win32Window]::SetWindowPos($proc.MainWindowHandle, [IntPtr]::Zero, 50, 50, $Width, $Height, 0x0044)  # SWP_NOZORDER | SWP_SHOWWINDOW
  Write-Host "Window sized to ${Width}x${Height}. Press Space in the app to start playback, then press Enter here."
  [void](Read-Host)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sampler -RootPid $proc.Id -WarmupSec $WarmupSec -DurationSec $MeasureSec -Out $samplerOut
  $summary['note'] = 'Legacy build: no drop counters. Note by eye whether playback was smooth.'
} else {
  if (-not $Exe -or -not (Test-Path $Exe)) { throw 'Pass -Exe with the path of the new build (win-unpacked).' }
  if (-not $Media -or -not (Test-Path $Media)) { throw 'Pass -Media with the path of the video file.' }
  $dir = Join-Path ([IO.Path]::GetTempPath()) ("yall-bench-" + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force (Join-Path $dir 'projects') | Out-Null
  $id = '00000000-0000-4000-8000-00000000e2e0'
  $now = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $subtitleSelection = if ($Subtitle) { @{ type = 'external'; filePath = (Resolve-Path $Subtitle).Path } } else { @{ type = 'none' } }
  $minimal = [ordered]@{
    id = $id; catalogId = ''; mediaFileName = (Split-Path -Leaf $Media); subtitleFileName = $(if ($Subtitle) { Split-Path -Leaf $Subtitle } else { '' })
    mediaPath = (Resolve-Path $Media).Path; createdDate = $now; lastOpenedDate = $now; duration = 1440; lastPlaybackTime = $StartSec
    subtitleCount = 0; lastSubtitleEndTime = 0
  }
  $project = [ordered]@{} + $minimal
  $project['subtitleSelection'] = $subtitleSelection
  $project['detectedLanguage'] = 'other'
  $project['subtitles'] = @(); $project['audioTracks'] = @(); $project['subtitleTracks'] = @(); $project['ankiTags'] = @()
  $project['settings'] = [ordered]@{
    autoPauseAtStart = $false; autoPauseAtEnd = $false; subtitledClipSpeed = 1; gapSpeed = 1; skipGaps = $false; speedOverride = 0.5
    subtitleBehavior = 'DoNothing'; selectedAudioTrackIndex = $null; useMpvSubtitles = $false; assScale = 1; assScalePercentage = 100
    subtitlesVisible = $true; subtitlesLanguage = 'other'; defaultSubtitleLookupServiceId = $null
  }
  $appData = @{ projects = @($minimal); lastOpenedProjectId = $id; globalSettings = @{ hardwareAcceleration = ($Hwdec -eq 'auto') } }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $dir 'yall-mp-app-data.json'), ($appData | ConvertTo-Json -Depth 8), $utf8)
  [IO.File]::WriteAllText((Join-Path $dir "projects\$id.json"), ($project | ConvertTo-Json -Depth 8), $utf8)

  $benchOut = Join-Path $results "$Scenario.app.json"
  $benchConfig = Join-Path $dir 'bench.json'
  [IO.File]::WriteAllText($benchConfig, (@{ warmupSec = $WarmupSec; measureSec = $MeasureSec; width = $Width; height = $Height; out = $benchOut } | ConvertTo-Json), $utf8)
  Remove-Item $benchOut -ErrorAction SilentlyContinue

  $env:YALL_MP_USER_DATA_DIR = $dir
  $env:YALL_MP_BENCH = $benchConfig
  $app = Start-Process -FilePath $Exe -ArgumentList $AppArgs -PassThru
  # The app writes a marker when its measuring window starts (after loading and the warm-up), so a slow start does not shift the sampling.
  $marker = "$benchOut.measuring"
  Remove-Item $marker -ErrorAction SilentlyContinue
  $loadDeadline = (Get-Date).AddSeconds(180 + $WarmupSec)
  while (-not (Test-Path $marker) -and -not $app.HasExited -and (Get-Date) -lt $loadDeadline) { Start-Sleep -Milliseconds 250 }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sampler -RootPid $app.Id -WarmupSec 0 -DurationSec ($MeasureSec - 3) -Out $samplerOut
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $benchOut) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if (-not $app.HasExited) { [void]$app.WaitForExit(15000) }
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
  if (Test-Path $benchOut) { $summary['app'] = Read-Json $benchOut } else { $summary['app'] = 'no result: the app did not finish the bench mode' }
  $videoLog = Join-Path $dir 'video.log'
  if (Test-Path $videoLog) { Copy-Item $videoLog (Join-Path $results "$Scenario.video.log") -Force }
  Remove-Item Env:\YALL_MP_BENCH, Env:\YALL_MP_USER_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item $marker -ErrorAction SilentlyContinue
}

if (Test-Path $samplerOut) { $summary['sampler'] = Read-Json $samplerOut }
$final = Join-Path $results "$Scenario.json"
$summary | ConvertTo-Json -Depth 10 | Out-File -Encoding utf8 $final
Write-Host "Written $final"
if ($summary['sampler']) {
  Write-Host ("CPU: {0} % of one core, dwm {1} %, GPU 3D {2} %" -f $summary['sampler'].appCpuPctOfOneCore, $summary['sampler'].dwmCpuPctOfOneCore, $summary['sampler'].gpu.app3d)
}
