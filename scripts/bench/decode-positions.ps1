# Decode cost of the bundled libmpv at several positions of one file (scenes differ in cost), same options as the app.
#   .\decode-positions.ps1 -AppDir <win-unpacked> -Media <file> [-Starts 5,25,45,65,85] [-Seconds 20] [-Attach none|d3d11-shared|readback]
param(
  [Parameter(Mandatory)][string]$AppDir,
  [Parameter(Mandatory)][string]$Media,
  [int[]]$Starts = @(5, 25, 45, 65, 85),
  [int]$Seconds = 20,
  [string]$Attach = 'd3d11-shared',
  [string]$Hwdec = 'no'
)
$exe = Join-Path $AppDir "Y'ALL Media Player.exe"
$script = Join-Path $PSScriptRoot 'decode-bench.js'
foreach ($start in $Starts) {
  $file = Join-Path $env:TEMP 'decode-positions.json'
  Remove-Item $file -ErrorAction SilentlyContinue
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:DECODE_OUT = $file
  $env:DECODE_START = "$start"
  Start-Process -FilePath $exe -ArgumentList @("`"$script`"", "`"$AppDir`"", "`"$Media`"", $Hwdec, 'timed', $Seconds, $Attach) -Wait -WindowStyle Hidden
  Remove-Item Env:\ELECTRON_RUN_AS_NODE, Env:\DECODE_OUT, Env:\DECODE_START -ErrorAction SilentlyContinue
  if (Test-Path $file) {
    $j = Get-Content $file -Raw | ConvertFrom-Json
    Write-Host ("start {0,3} s: {1,5} % of one core ({2} ms CPU over {3} ms)" -f $start, $j.cpuPctOfOneCore, $j.cpuMs, $j.wallMs)
  } else {
    Write-Host "start $start s: no result"
  }
}
