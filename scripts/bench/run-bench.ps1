# Runs the whole benchmark on this machine with the files that come in the kit, then zips the results.
#
#   .\run-bench.ps1            the new build, every scenario, 3 runs each, unattended (about 25 minutes, do not touch the PC)
#   .\run-bench.ps1 -Legacy    the old (installed) release, the same files, you open the project by hand (see README-laptop.md)
#
# Output: results\*.json and bench-results.zip (send the zip back).
param(
  [string]$Exe = (Join-Path (Split-Path -Parent $PSScriptRoot) "win-unpacked\Y'ALL Media Player.exe"),
  [string]$MediaDir = (Join-Path (Split-Path -Parent $PSScriptRoot) 'media'),
  [switch]$Legacy,
  [string]$LegacyProcessName = "Y'ALL Media Player",
  [int]$Runs = 3,
  [double]$StartSec = 5,
  [double]$WarmupSec = 10,
  [double]$MeasureSec = 60,
  [int]$Width = 1600,
  [int]$Height = 900,
  [string[]]$Only = @(),
  [string[]]$AppArgs = @()   # only for trying the script on a dev tree: -Exe electron.exe -AppArgs <repo folder>
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$results = Join-Path $here 'results'
New-Item -ItemType Directory -Force $results | Out-Null
$sampler = Join-Path $here 'sampler.ps1'

# The media of the kit. Sub = index of the embedded ASS track, or -1 for none.
$media = @{
  episode = @{ File = 'episode-1080p-ass.mkv'; Sub = 2; Duration = 120 }
  hi10p   = @{ File = 'episode-hi10p-ass.mkv'; Sub = 2; Duration = 120 }
  fixture = @{ File = '1080p60-h264.mp4'; Sub = -1; Duration = 75 }
}
# episode-auto is the one the acceptance gate is judged on.
$scenarios = @(
  @{ Name = 'episode-auto'; Media = 'episode'; Hwdec = 'auto' }
  @{ Name = 'episode-nohw'; Media = 'episode'; Hwdec = 'no' }
  @{ Name = 'hi10p-auto'; Media = 'hi10p'; Hwdec = 'auto' }
  @{ Name = 'fixture60-auto'; Media = 'fixture'; Hwdec = 'auto' }
)
if ($Legacy) { $scenarios = @($scenarios[0], $scenarios[3]) }
if ($Only.Count -gt 0) { $scenarios = @($scenarios | Where-Object { $Only -contains $_.Name }) }

function Get-PowerSource {
  $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $battery) { return 'no battery' }
  if ($battery.BatteryStatus -eq 1) { return 'battery' } else { return 'plugged in' }
}

function Read-Json([string]$path) { Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json }

function New-UserData([string]$dir, $item, [string]$hwdec) {
  New-Item -ItemType Directory -Force (Join-Path $dir 'projects') | Out-Null
  $id = '00000000-0000-4000-8000-00000000e2e0'
  $now = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  $file = (Resolve-Path (Join-Path $MediaDir $item.File)).Path
  $selection = if ($item.Sub -ge 0) { @{ type = 'embedded'; trackIndex = $item.Sub } } else { @{ type = 'none' } }
  [object[]]$tracks = if ($item.Sub -ge 0) { @(@{ index = $item.Sub; language = 'eng'; languageCode = 'en'; title = 'Styled Subtitles'; codec = 'ass'; isSupported = $true }) } else { @() }
  $minimal = [ordered]@{
    id = $id; catalogId = ''; mediaFileName = $item.File; subtitleFileName = ''; mediaPath = $file
    createdDate = $now; lastOpenedDate = $now; duration = $item.Duration; lastPlaybackTime = $StartSec
    subtitleCount = 0; lastSubtitleEndTime = 0
  }
  $project = [ordered]@{} + $minimal
  $project['subtitleSelection'] = $selection
  $project['detectedLanguage'] = 'other'
  $project['subtitles'] = @(); $project['audioTracks'] = @(); $project['subtitleTracks'] = $tracks; $project['ankiTags'] = @()
  $project['settings'] = [ordered]@{
    autoPauseAtStart = $false; autoPauseAtEnd = $false; subtitledClipSpeed = 1; gapSpeed = 1; skipGaps = $false; speedOverride = 0.5
    subtitleBehavior = 'DoNothing'; selectedAudioTrackIndex = $null; useMpvSubtitles = $false; assScale = 1; assScalePercentage = 100
    subtitlesVisible = $true; subtitlesLanguage = 'other'; defaultSubtitleLookupServiceId = $null
  }
  $appData = @{ projects = @($minimal); lastOpenedProjectId = $id; globalSettings = @{ hardwareAcceleration = ($hwdec -eq 'auto') } }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $dir 'yall-mp-app-data.json'), ($appData | ConvertTo-Json -Depth 8), $utf8)
  [IO.File]::WriteAllText((Join-Path $dir "projects\$id.json"), ($project | ConvertTo-Json -Depth 8), $utf8)
}

function Invoke-NewRun([string]$name, $scenario, [int]$run) {
  $item = $media[$scenario.Media]
  $dir = Join-Path ([IO.Path]::GetTempPath()) ("yall-bench-" + [Guid]::NewGuid().ToString('N'))
  New-UserData $dir $item $scenario.Hwdec
  $benchOut = Join-Path $results "$name.app.json"
  $samplerOut = Join-Path $results "$name.sampler.json"
  $marker = "$benchOut.measuring"
  Remove-Item $benchOut, $marker -ErrorAction SilentlyContinue
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $benchConfig = Join-Path $dir 'bench.json'
  [IO.File]::WriteAllText($benchConfig, (@{ warmupSec = $WarmupSec; measureSec = $MeasureSec; width = $Width; height = $Height; out = $benchOut } | ConvertTo-Json), $utf8)

  $env:YALL_MP_USER_DATA_DIR = $dir
  $env:YALL_MP_BENCH = $benchConfig
  $app = Start-Process -FilePath $Exe -ArgumentList $AppArgs -PassThru
  # The app writes a marker when its measuring window starts (after loading and the warm-up), so a slow start does not shift the sampling.
  $loadDeadline = (Get-Date).AddSeconds(180 + $WarmupSec)
  while (-not (Test-Path $marker) -and -not $app.HasExited -and (Get-Date) -lt $loadDeadline) { Start-Sleep -Milliseconds 250 }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sampler -RootPid $app.Id -WarmupSec 0 -DurationSec ($MeasureSec - 3) -Out $samplerOut
  $deadline = (Get-Date).AddSeconds(30)
  while (-not (Test-Path $benchOut) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
  if (-not $app.HasExited) { [void]$app.WaitForExit(15000) }
  if (-not $app.HasExited) { Stop-Process -Id $app.Id -Force }
  Remove-Item Env:\YALL_MP_BENCH, Env:\YALL_MP_USER_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item $marker -ErrorAction SilentlyContinue
  $videoLog = Join-Path $dir 'video.log'
  if (Test-Path $videoLog) { Copy-Item $videoLog (Join-Path $results "$name.video.log") -Force }
  Start-Sleep -Seconds 2
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
  return [ordered]@{
    app = $(if (Test-Path $benchOut) { Read-Json $benchOut } else { 'no result: the app did not finish the bench mode' })
    sampler = $(if (Test-Path $samplerOut) { Read-Json $samplerOut } else { $null })
  }
}

function Invoke-LegacyRun([string]$name, $scenario, [int]$run) {
  $item = $media[$scenario.Media]
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Win32Window {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
}
'@ -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "=== LEGACY $name (run $run of $Runs) ==="
  Write-Host "In the old app: open (or create a project from) '$($item.File)' from the media folder, subtitles: the embedded ASS track. Pause at the start."
  Write-Host "Then press Enter here."
  [void](Read-Host)
  $proc = Get-Process | Where-Object { $_.ProcessName -eq $LegacyProcessName -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $proc) { throw "No window of '$LegacyProcessName' found; pass -LegacyProcessName." }
  [void][Win32Window]::ShowWindow($proc.MainWindowHandle, 9)
  [void][Win32Window]::SetWindowPos($proc.MainWindowHandle, [IntPtr]::Zero, 50, 50, $Width, $Height, 0x0044)
  Write-Host "Window sized to ${Width}x${Height}. Press Space in the app to start, then press Enter here. Do not touch anything for the next minute."
  [void](Read-Host)
  $samplerOut = Join-Path $results "$name.sampler.json"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $sampler -RootPid $proc.Id -WarmupSec $WarmupSec -DurationSec ($MeasureSec - 3) -Out $samplerOut
  $smooth = Read-Host 'Was playback smooth (y/n, add a note if not)?'
  return [ordered]@{ app = 'legacy build: no drop counters'; smoothByUser = $smooth; sampler = $(if (Test-Path $samplerOut) { Read-Json $samplerOut } else { $null }) }
}

$machine = [ordered]@{
  cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name
  gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name) (driver $($_.DriverVersion))" })
  os = (Get-CimInstance Win32_OperatingSystem).Caption
  power = Get-PowerSource
  legacy = [bool]$Legacy
}
if (-not $Legacy -and -not (Test-Path $Exe)) { throw "The new build was not found at $Exe (pass -Exe)." }

$rows = @()
foreach ($scenario in $scenarios) {
  for ($run = 1; $run -le $Runs; $run++) {
    $prefix = $(if ($Legacy) { 'legacy' } else { 'new' })
    $name = "$prefix-$($scenario.Name)-$run"
    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] $name"
    $out = if ($Legacy) { Invoke-LegacyRun $name $scenario $run } else { Invoke-NewRun $name $scenario $run }
    $summary = [ordered]@{ scenario = $name; machine = $machine; time = (Get-Date).ToString('s') } + $out
    $summary | ConvertTo-Json -Depth 10 | Out-File -Encoding utf8 (Join-Path $results "$name.json")
    $app = $out.app
    $cpu = if ($out.sampler) { $out.sampler.appCpuPctOfOneCore } else { $null }
    $row = [pscustomobject]@{
      Run = $name; CpuPctOneCore = $cpu; Dwm = $(if ($out.sampler) { $out.sampler.dwmCpuPctOfOneCore } else { $null })
      Fps = $(if ($app -is [string] -or -not $app.presentedFps) { $null } else { [math]::Round($app.presentedFps, 1) })
      Dropped = $(if ($app -is [string]) { $null } else { $app.mpv.frameDrops })
      Backend = $(if ($app -is [string]) { $null } else { $app.sender.backend })
      Fallback = $(if ($app -is [string]) { $null } else { $app.sender.fallbackReason })
    }
    $rows += $row
    $row | Format-List | Out-String | Write-Host
  }
}

$rows | Format-Table -AutoSize | Out-String | Write-Host
$rows | ConvertTo-Json | Out-File -Encoding utf8 (Join-Path $results 'table.json')
$zip = Join-Path $here 'bench-results.zip'
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $results '*') -DestinationPath $zip
Write-Host "Done. Send back: $zip"
