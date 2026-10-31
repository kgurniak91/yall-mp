# The plain mpv.exe side of decode-bench.js: the same options, no video output, CPU seconds of the process.
#   .\decode-bench-mpv.ps1 -Mpv <mpv.exe> -Media <file> [-Hwdec no] [-Mode timed|untimed] [-Seconds 40]
param(
  [Parameter(Mandatory)][string]$Mpv,
  [Parameter(Mandatory)][string]$Media,
  [string]$Hwdec = 'no',
  [ValidateSet('timed', 'untimed')][string]$Mode = 'timed',
  [int]$Seconds = 40
)
$mpvArgs = @(
  '--no-config', '--vo=null', '--ao=null', "--hwdec=$Hwdec", '--no-osc', '--input-default-bindings=no', '--keep-open=no',
  '--sub-visibility=no', '--hr-seek=default', '--hr-seek-framedrop=yes', '--cache=no', '--vd-lavc-threads=0',
  '--demuxer-max-bytes=150MiB', '--demuxer-readahead-secs=20', '--framedrop=vo', '--vd-lavc-fast=yes',
  '--sws-allow-zimg=no', '--msg-level=all=no', '--start=5', "--length=$Seconds"
)
if ($Mode -eq 'untimed') { $mpvArgs += '--untimed'; $mpvArgs += '--ao-null-untimed=yes' }
$mpvArgs += $Media
$p = Start-Process -FilePath $Mpv -ArgumentList $mpvArgs -PassThru -WindowStyle Hidden
$p.WaitForExit()
$wallMs = ($p.ExitTime - $p.StartTime).TotalMilliseconds
$cpuMs = $p.TotalProcessorTime.TotalMilliseconds
$version = (Get-Item $Mpv).VersionInfo.ProductVersion
[ordered]@{
  engine = 'mpv.exe'; mode = $Mode; hwdec = $Hwdec; seconds = $Seconds; wallMs = [int]$wallMs; cpuMs = [int]$cpuMs
  cpuPctOfOneCore = [math]::Round($cpuMs / $wallMs * 100, 1); version = $version; exe = $Mpv
} | ConvertTo-Json -Compress
