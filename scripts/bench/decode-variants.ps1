# Adds what the app has around the engine to the decode-only test, one thing at a time, to see which one makes decoding cost more.
#   .\decode-variants.ps1 -AppDir <win-unpacked> -Media <file> [-Start 45] [-Seconds 20] [-Reps 2]
param(
  [Parameter(Mandatory)][string]$AppDir,
  [Parameter(Mandatory)][string]$Media,
  [int]$Start = 45,
  [int]$Seconds = 20,
  [int]$Reps = 2,
  [string]$Attach = 'd3d11-shared'
)
$exe = Join-Path $AppDir "Y'ALL Media Player.exe"
$script = Join-Path $PSScriptRoot 'decode-bench.js'
$lua = Join-Path $AppDir 'resources\mpv\yall_auto_pause.lua'
if (-not (Test-Path $lua)) { Write-Host "lua script not found: $lua" }
$variants = [ordered]@{
  'base (no audio, no subs, no script)' = ''
  '+ real audio device (wasapi)'        = 'ao=wasapi;aid=1;volume=100'
  '+ embedded ASS track selected'       = 'sid=1;sub-visibility=no'
  '+ Lua auto-pause script'             = "load-scripts=yes;scripts=$lua"
  'all three together'                  = "ao=wasapi;aid=1;volume=100;sid=1;sub-visibility=no;load-scripts=yes;scripts=$lua"
}
for ($rep = 1; $rep -le $Reps; $rep++) {
  foreach ($name in $variants.Keys) {
    $file = Join-Path $env:TEMP 'decode-variants.json'
    Remove-Item $file -ErrorAction SilentlyContinue
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:DECODE_OUT = $file
    $env:DECODE_START = "$Start"
    $env:DECODE_EXTRA = $variants[$name]
    Start-Process -FilePath $exe -ArgumentList @("`"$script`"", "`"$AppDir`"", "`"$Media`"", 'no', 'timed', $Seconds, $Attach) -Wait -WindowStyle Hidden
    Remove-Item Env:\ELECTRON_RUN_AS_NODE, Env:\DECODE_OUT, Env:\DECODE_START, Env:\DECODE_EXTRA -ErrorAction SilentlyContinue
    if (Test-Path $file) {
      $j = Get-Content $file -Raw | ConvertFrom-Json
      if ($j.cpuPctOfOneCore) { Write-Host ("rep {0}  {1,-40} {2,6} %" -f $rep, $name, $j.cpuPctOfOneCore) } else { Write-Host ("rep {0}  {1,-40} {2}" -f $rep, $name, (Get-Content $file -Raw).Substring(0, 160)) }
    } else {
      Write-Host "rep $rep  $name : no result"
    }
  }
}
