# Decode-only matrix: the bundled libmpv (through the app runtime in node mode) against plain mpv.exe builds, same options,
# no video output, no window. Appends one JSON line per run to results.jsonl next to this script.
#   .\decode-matrix.ps1 -AppDir <win-unpacked> -Media <file> -MpvExe <mpv.exe>[,<mpv.exe>...] [-Runs 3] [-Seconds 40] [-Hwdec no]
param(
  [Parameter(Mandatory)][string]$AppDir,
  [Parameter(Mandatory)][string]$Media,
  [Parameter(Mandatory)][string[]]$MpvExe,
  [int]$Runs = 3,
  [int]$Seconds = 40,
  [string]$Hwdec = 'no',
  [string[]]$Attach = @('none'),   # render attach of the libmpv runs: none, d3d11-shared, readback
  [switch]$LibmpvOnly
)
$here = $PSScriptRoot
$out = Join-Path $here 'results.jsonl'
$exe = Join-Path $AppDir "Y'ALL Media Player.exe"
$script = Join-Path $here 'decode-bench.js'
$mpvScript = Join-Path $here 'decode-bench-mpv.ps1'

function Invoke-Libmpv([string]$mode, [string]$attach) {
  $file = Join-Path $env:TEMP ("decode-" + [Guid]::NewGuid().ToString('N') + '.json')
  $env:ELECTRON_RUN_AS_NODE = '1'
  $env:DECODE_OUT = $file
  $p = Start-Process -FilePath $exe -ArgumentList @("`"$script`"", "`"$AppDir`"", "`"$Media`"", $Hwdec, $mode, $Seconds, $attach) -PassThru -Wait -WindowStyle Hidden
  Remove-Item Env:\ELECTRON_RUN_AS_NODE, Env:\DECODE_OUT -ErrorAction SilentlyContinue
  if (Test-Path $file) { $line = Get-Content $file -Raw; Remove-Item $file; return $line }
  return (@{ engine = 'libmpv'; mode = $mode; error = "no result, exit $($p.ExitCode)" } | ConvertTo-Json -Compress)
}

for ($run = 1; $run -le $Runs; $run++) {
  foreach ($mode in 'untimed', 'timed') {
    $lines = @()
    foreach ($a in $Attach) { $lines += (Invoke-Libmpv $mode $a) }
    if (-not $LibmpvOnly) { foreach ($mpv in $MpvExe) { $lines += (& $mpvScript -Mpv $mpv -Media $Media -Hwdec $Hwdec -Mode $mode -Seconds $Seconds) } }
    foreach ($line in $lines) {
      $obj = $line | ConvertFrom-Json
      $obj | Add-Member -NotePropertyName run -NotePropertyValue $run -Force
      $obj | ConvertTo-Json -Compress | Add-Content -Path $out -Encoding utf8
      Write-Host $($obj | ConvertTo-Json -Compress)
    }
  }
}
Write-Host 'MATRIX DONE'
