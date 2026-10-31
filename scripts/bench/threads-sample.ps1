# Where does the CPU of the app's main process go? Waits for the app to start, lets it load and warm up, then reads the CPU
# time of every thread twice and groups the difference by thread name (mpv and Chromium name their threads; the start
# address is useless, every thread starts in ntdll). Read-only; run it next to a bench run:
#   .\threads-sample.ps1 [-WarmupSec 25] [-MeasureSec 30] [-Out threads.json]
param(
  [string]$ProcessName = "Y'ALL Media Player",
  [int]$WarmupSec = 25,
  [int]$MeasureSec = 30,
  [string]$Out = (Join-Path $PSScriptRoot 'threads.json'),
  [int]$WaitForAppSec = 900
)
$ErrorActionPreference = 'Stop'

function Find-Main {
  # The browser process is the one whose parent is not another process of the same name
  $wqlName = $ProcessName.Replace("'", "\'")
  $all = @(Get-CimInstance Win32_Process -Filter "Name = '$wqlName.exe'")
  $ids = $all | ForEach-Object { $_.ProcessId }
  return $all | Where-Object { $ids -notcontains $_.ParentProcessId } | Select-Object -First 1
}

$deadline = (Get-Date).AddSeconds($WaitForAppSec)
$main = $null
while (-not $main -and (Get-Date) -lt $deadline) { $main = Find-Main; if (-not $main) { Start-Sleep -Milliseconds 500 } }
if (-not $main) { throw 'the app did not start' }
Write-Host "main process $($main.ProcessId), warming up $WarmupSec s"
Start-Sleep -Seconds $WarmupSec

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ThreadNames {
  [DllImport("kernel32.dll")] static extern IntPtr OpenThread(uint access, bool inherit, uint id);
  [DllImport("kernel32.dll")] static extern int GetThreadDescription(IntPtr thread, out IntPtr name);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr mem);
  public static string Of(uint id) {
    IntPtr h = OpenThread(0x0800, false, id);
    if (h == IntPtr.Zero) return "";
    try {
      IntPtr p;
      if (GetThreadDescription(h, out p) < 0 || p == IntPtr.Zero) return "";
      string s = Marshal.PtrToStringUni(p);
      LocalFree(p);
      return s;
    } finally { CloseHandle(h); }
  }
}
'@
function Snapshot {
  $p = Get-Process -Id $main.ProcessId
  $map = @{}
  foreach ($th in $p.Threads) {
    try { $map[$th.Id] = [pscustomobject]@{ Cpu = $th.TotalProcessorTime.TotalMilliseconds; Name = [ThreadNames]::Of([uint32]$th.Id) } } catch { }
  }
  return $map
}
$t0 = Get-Date
$a = Snapshot
Start-Sleep -Seconds $MeasureSec
$b = Snapshot
$wallMs = ((Get-Date) - $t0).TotalMilliseconds

$threads = foreach ($id in $b.Keys) {
  $before = if ($a.ContainsKey($id)) { $a[$id].Cpu } else { 0 }
  $name = if ($b[$id].Name) { $b[$id].Name } else { '(unnamed)' }
  [pscustomobject]@{ Id = $id; Name = $name; CpuMs = [math]::Round($b[$id].Cpu - $before, 1) }
}
$byName = $threads | Group-Object Name | ForEach-Object {
  [pscustomobject]@{ Name = $_.Name; Threads = $_.Count; PctOfOneCore = [math]::Round(($_.Group | Measure-Object CpuMs -Sum).Sum / $wallMs * 100, 1) }
} | Sort-Object PctOfOneCore -Descending
$top = $threads | Sort-Object CpuMs -Descending | Select-Object -First 12 | ForEach-Object {
  [pscustomobject]@{ Id = $_.Id; Name = $_.Name; PctOfOneCore = [math]::Round($_.CpuMs / $wallMs * 100, 1) }
}
$result = [ordered]@{ pid = $main.ProcessId; wallMs = [int]$wallMs; totalPct = [math]::Round(($threads | Measure-Object CpuMs -Sum).Sum / $wallMs * 100, 1); byName = @($byName); topThreads = @($top) }
$result | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $Out
$byName | Format-Table -AutoSize | Out-String | Write-Host
$top | Format-Table -AutoSize | Out-String | Write-Host
Write-Host "THREADS DONE total $($result.totalPct) %"
