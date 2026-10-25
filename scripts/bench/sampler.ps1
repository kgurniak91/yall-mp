# External CPU/GPU sampler for one bench run.
# CPU: TotalProcessorTime deltas of the process tree under RootPid (grouped by process name). dwm.exe runs under another
# account, so its TotalProcessorTime reads 0: it is sampled with the Win32_PerfFormattedData_PerfProc_Process class (not Get-Counter, whose paths are localized).
# GPU: '\GPU Engine(*)\Utilization Percentage' summed per engine type for the same pids.
# Idle mode (-RootPid 0) measures only dwm.exe and the whole-GPU totals, for a baseline.
param(
  [int]$RootPid = 0,
  [double]$WarmupSec = 10,
  [double]$DurationSec = 60,
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'SilentlyContinue'
$cores = [Environment]::ProcessorCount

function Get-Tree([int]$root) {
  if ($root -le 0) { return @() }
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $ids = New-Object System.Collections.Generic.HashSet[int]
  [void]$ids.Add($root)
  $grew = $true
  while ($grew) {
    $grew = $false
    foreach ($p in $all) {
      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $grew = $true }
    }
  }
  return $ids
}

function Get-CpuSnapshot($pids) {
  $snap = @{}
  foreach ($p in (Get-Process)) {
    if ($pids -contains $p.Id) {
      $snap[$p.Id] = @{ name = $p.ProcessName; cpu = $p.TotalProcessorTime.TotalSeconds }
    }
  }
  return $snap
}

Start-Sleep -Seconds $WarmupSec

$cpuSamples = @()
$gpuSamples = @()
$end = (Get-Date).AddSeconds($DurationSec)
$pids = @(Get-Tree $RootPid)
$prev = Get-CpuSnapshot $pids
$prevT = Get-Date
$tick = 0
while ((Get-Date) -lt $end) {
  Start-Sleep -Milliseconds 1000
  $tick++
  if ($tick % 5 -eq 1) { $pids = @(Get-Tree $RootPid) }
  $now = Get-CpuSnapshot $pids
  $nowT = Get-Date
  $dt = ($nowT - $prevT).TotalSeconds
  $byName = @{}
  foreach ($id in $now.Keys) {
    if ($prev.ContainsKey($id)) {
      $d = $now[$id].cpu - $prev[$id].cpu
      $n = $now[$id].name
      if (-not $byName.ContainsKey($n)) { $byName[$n] = 0.0 }
      $byName[$n] += $d / $dt * 100.0   # % of one core
    }
  }
  $dwm = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter "Name='dwm'"
  if ($dwm) { $byName['dwm'] = [double]($dwm | Measure-Object -Property PercentProcessorTime -Sum).Sum }
  $cpuSamples += , $byName
  $prev = $now
  $prevT = $nowT

  $c = Get-Counter '\GPU Engine(*)\Utilization Percentage' -ErrorAction SilentlyContinue
  if ($c) {
    $g = @{ app3d = 0.0; appVideoDecode = 0.0; appVideoProc = 0.0; appCopy = 0.0; dwm3d = 0.0; all3d = 0.0 }
    $dwmPid = (Get-Process dwm | Select-Object -First 1).Id
    foreach ($s in $c.CounterSamples) {
      if ($s.InstanceName -notmatch '^pid_(\d+)_.*engtype_(\w+)') { continue }
      $gp = [int]$Matches[1]; $et = $Matches[2]; $v = $s.CookedValue
      if ($et -eq '3D') { $g.all3d += $v }
      if ($pids -contains $gp) {
        switch ($et) { '3D' { $g.app3d += $v } 'VideoDecode' { $g.appVideoDecode += $v } 'VideoProcessing' { $g.appVideoProc += $v } 'Copy' { $g.appCopy += $v } }
      }
      if ($gp -eq $dwmPid -and $et -eq '3D') { $g.dwm3d += $v }
    }
    $gpuSamples += , $g
  }
}

function Mean($xs) { if ($xs.Count -eq 0) { return $null } else { return ($xs | Measure-Object -Average).Average } }

$names = @{}
foreach ($s in $cpuSamples) { foreach ($k in $s.Keys) { $names[$k] = 1 } }
$cpu = @{}
foreach ($n in $names.Keys) {
  $vals = @($cpuSamples | ForEach-Object { if ($_.ContainsKey($n)) { $_[$n] } else { 0.0 } })
  $cpu[$n] = [math]::Round((Mean $vals), 2)
}
$appCpu = 0.0
foreach ($n in $cpu.Keys) { if ($n -ne 'dwm') { $appCpu += $cpu[$n] } }

$result = [ordered]@{
  rootPid = $RootPid; cores = $cores; samples = $cpuSamples.Count
  cpuPctOfOneCoreByProcess = $cpu
  appCpuPctOfOneCore = [math]::Round($appCpu, 2)
  appCpuPctOfTotal = [math]::Round($appCpu / $cores, 2)
  dwmCpuPctOfOneCore = if ($cpu.ContainsKey('dwm')) { $cpu['dwm'] } else { 0 }
  gpu = [ordered]@{
    samples = $gpuSamples.Count
    app3d = [math]::Round((Mean @($gpuSamples | ForEach-Object { $_.app3d })), 2)
    appVideoDecode = [math]::Round((Mean @($gpuSamples | ForEach-Object { $_.appVideoDecode })), 2)
    appVideoProcessing = [math]::Round((Mean @($gpuSamples | ForEach-Object { $_.appVideoProc })), 2)
    appCopy = [math]::Round((Mean @($gpuSamples | ForEach-Object { $_.appCopy })), 2)
    dwm3d = [math]::Round((Mean @($gpuSamples | ForEach-Object { $_.dwm3d })), 2)
    all3d = [math]::Round((Mean @($gpuSamples | ForEach-Object { $_.all3d })), 2)
  }
}
$result | ConvertTo-Json -Depth 6 | Out-File -Encoding utf8 $Out
