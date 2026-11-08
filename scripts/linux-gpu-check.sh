#!/usr/bin/env bash
# Linux video path check: collects a system report, runs the native tests and the Electron smoke on every video
# backend, and writes everything to one folder plus a tarball you can attach to a bug report.
#
#   scripts/linux-gpu-check.sh [--out=<folder>] [--seconds=N] [--clip=WxH@fps] [--skip-native]
#
# Run it inside the graphical session you want to test (X11 or Wayland) from a checkout where `npm install` and
# `npm run native:build` were done. Needs a screen: the smoke opens a window. The exit code is non-zero when a check
# failed. The report holds no serial numbers, MAC addresses or user names.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2

OUT=""
SECONDS_ARG=12
CLIP=1920x1080@30
SKIP_NATIVE=0
for a in "$@"; do
  case "$a" in
    --out=*) OUT="${a#--out=}" ;;
    --seconds=*) SECONDS_ARG="${a#--seconds=}" ;;
    --clip=*) CLIP="${a#--clip=}" ;;
    --skip-native) SKIP_NATIVE=1 ;;
    -h|--help) sed -n 2,10p "$0"; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
SESSION="${XDG_SESSION_TYPE:-unknown}"
OUT="${OUT:-linux-gpu-check-$(date +%Y%m%d-%H%M%S)-$SESSION}"
mkdir -p "$OUT/smoke"
OUT="$(cd "$OUT" && pwd)"

# Removes what identifies a person or a machine from text.
scrub() {
  sed -E -e 's/([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/xx:xx:xx:xx:xx:xx/g' \
         -e '/[Ss]erial|[Uu]uid|UUID/d' \
         -e "s|$HOME|~|g" \
         -e "s#/home/[^/ ]+#/home/user#g" -e "s#/run/user/[0-9]+#/run/user/UID#g"
}
have() { command -v "$1" >/dev/null 2>&1; }
section() { printf '\n===== %s =====\n' "$1"; }

declare -a RESULT_NAME RESULT_STATE RESULT_NOTE
record() { RESULT_NAME+=("$1"); RESULT_STATE+=("$2"); RESULT_NOTE+=("${3:-}"); }

# ---------------------------------------------------------------- system report
{
  section "system"
  . /etc/os-release 2>/dev/null && echo "distro: ${PRETTY_NAME:-unknown}"
  echo "kernel: $(uname -r) $(uname -m)"
  echo "session: $SESSION  wayland-display: ${WAYLAND_DISPLAY:+yes}  x-display: ${DISPLAY:+yes}  desktop: ${XDG_CURRENT_DESKTOP:-?}"
  echo "node: $(node --version 2>/dev/null || echo missing)"
  echo "cpu: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ //')  threads: $(nproc)"
  echo "memory: $(awk '/MemTotal/ {printf "%.1f GB", $2/1048576}' /proc/meminfo)"
  echo "groups: $(id -Gn)"
  section "graphics devices (pci)"
  if have lspci; then lspci -nn | grep -Ei 'vga|3d controller|display controller'; else echo "lspci not installed"; fi
  section "/dev/dri"
  ls -l /dev/dri 2>&1
  for c in /sys/class/drm/card[0-9]*/device; do
    [ -r "$c/vendor" ] && echo "$(basename "$(dirname "$c")"): vendor $(cat "$c/vendor") device $(cat "$c/device") driver $(basename "$(readlink -f "$c/driver" 2>/dev/null)")"
  done
  section "libmpv / mpv"
  ldconfig -p 2>/dev/null | grep -E 'libmpv\.so' || echo "libmpv.so not in the linker cache"
  have mpv && mpv --version | head -1
  section "glxinfo -B"
  if have glxinfo; then glxinfo -B 2>&1 | grep -Ei 'direct rendering|vendor|renderer|OpenGL version|OpenGL core|Mesa|Device|Accelerated|Video memory' ; else echo "glxinfo not installed (mesa-utils)"; fi
  section "eglinfo -B (per platform; the GBM platform may list llvmpipe even when the host uses the GPU render node)"
  if have eglinfo; then eglinfo -B 2>&1 | grep -Ei 'platform|OpenGL renderer|OpenGL core profile renderer|EGL driver|vendor' ; else echo "eglinfo not installed (mesa-utils-bin)"; fi
  section "vainfo"
  if have vainfo; then vainfo 2>&1 | grep -Ei 'libva|Driver|VAProfile' ; else echo "vainfo not installed (vainfo)"; fi
  section "vulkaninfo (summary)"
  if have vulkaninfo; then vulkaninfo --summary 2>&1 | grep -Ei 'deviceName|driverName|apiVersion' | head -8; else echo "vulkaninfo not installed"; fi
} 2>&1 | scrub > "$OUT/system.txt"

HW_RENDERER="$(grep -m1 -i 'OpenGL renderer' "$OUT/system.txt" | cut -d: -f2- | sed 's/^ //')"
if [ -z "$HW_RENDERER" ]; then
  record "session reports a GPU renderer" SKIP "glxinfo missing or no display"
elif echo "$HW_RENDERER" | grep -Eqi 'llvmpipe|softpipe|swrast|software'; then
  record "session reports a GPU renderer" FAIL "software renderer: $HW_RENDERER"
else
  record "session reports a GPU renderer" PASS "$HW_RENDERER"
fi

# ---------------------------------------------------------------- native tests
if [ "$SKIP_NATIVE" = 1 ]; then
  record "native tests" SKIP "--skip-native"
else
  YALL_NATIVE_REQUIRED=1 npm run test:native > "$OUT/test-native.log" 2>&1
  rc=$?
  scrub < "$OUT/test-native.log" > "$OUT/test-native.log.s" && mv "$OUT/test-native.log.s" "$OUT/test-native.log"
  summary="$(grep -E 'Tests ' "$OUT/test-native.log" | tail -1 | sed 's/\x1b\[[0-9;]*m//g')"
  if [ $rc -eq 0 ]; then record "native tests" PASS "$summary"; else record "native tests" FAIL "exit $rc: $summary"; fi
fi

# ---------------------------------------------------------------- smoke per backend
# The smoke names the GPU the host picked (adapter) and the render node, which tells the real device from the
# software one: `eglinfo` lists llvmpipe under the GBM platform on some machines while the dma-buf path uses the
# render node and reports the hardware driver.
for backend in readback dmabuf-shared auto; do
  json="$OUT/smoke/$backend.json"
  log="$OUT/smoke/$backend.log"
  npm run test:native:smoke -- --backend="$backend" --clip="$CLIP" --seconds="$SECONDS_ARG" --warmup=3 --json="$json" > "$log" 2>&1
  rc=$?
  scrub < "$log" > "$log.s" && mv "$log.s" "$log"
  info="$(node -e '
    try {
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const w = r.window || {};
      const cpu = r.renderThreadCpuPct && r.renderThreadCpuPct.total;
      console.log([
        "backend=" + r.backend, r.fallbackReason ? "fallback=" + r.fallbackReason : "",
        w.fps != null ? "fps=" + Number(w.fps).toFixed(1) : "", cpu != null ? "render-thread-cpu=" + Number(cpu).toFixed(1) + "%" : "",
        "failed=" + ((r.checks || []).filter(c => !c.ok).map(c => c.name).join("|") || "none")
      ].filter(Boolean).join(" "));
    } catch (e) { console.log("no result file"); }' "$json")"
  if [ $rc -eq 0 ]; then record "smoke $backend ($CLIP)" PASS "$info"; else record "smoke $backend ($CLIP)" FAIL "exit $rc: $info"; fi
  # what the host reports as GPU and render node
  grep -Ei 'renderD[0-9]+|adapter=|Mesa|llvmpipe' "$log" | head -3 >> "$OUT/gpu-lines.txt"
  if grep -Eqi 'llvmpipe|softpipe|swrast' "$log"; then
    record "smoke $backend uses hardware" FAIL "the log names a software renderer"
  fi
  # The adapter the host reports on attach is the authority: it names the render node it opened and whether that
  # device is software. (eglinfo can list llvmpipe under its GBM platform while this node is the real GPU.)
  if [ "$backend" = dmabuf-shared ]; then
    adapter="$(grep -m1 -o '"adapter":{[^}]*}' "$log")"
    if [ -z "$adapter" ]; then
      record "dmabuf-shared adapter" FAIL "no adapter in the smoke log (the backend did not attach)"
    elif echo "$adapter" | grep -q '"software":false'; then
      record "dmabuf-shared adapter" PASS "$(echo "$adapter" | grep -o '"selection":"[^"]*"' | cut -d'"' -f4)"
    else
      record "dmabuf-shared adapter" FAIL "software adapter: $adapter"
    fi
  fi
done

# ---------------------------------------------------------------- crash dumps and kernel complaints
dumps=$(find "$HOME/.config" "$HOME/.cache" /var/crash /tmp -newer "$OUT/system.txt" \( -name '*.dmp' -o -name '*.crash' \) 2>/dev/null | wc -l)
if [ "$dumps" -eq 0 ]; then record "no crash dumps during the run" PASS; else record "no crash dumps during the run" FAIL "$dumps new dump file(s)"; fi
if have journalctl && journalctl -k --since "-30min" >/dev/null 2>&1; then
  bad=$(journalctl -k --since "-30min" 2>/dev/null | grep -Eci 'segfault|gpu hang|ring .* timeout|gpu reset|\*ERROR\*|out of memory')
  journalctl -k --since "-30min" 2>/dev/null | grep -Ei 'segfault|gpu hang|ring .* timeout|gpu reset|\*ERROR\*|out of memory' | scrub > "$OUT/kernel-complaints.txt"
  if [ "$bad" -eq 0 ]; then record "no kernel GPU or memory complaints" PASS; else record "no kernel GPU or memory complaints" FAIL "$bad line(s), see kernel-complaints.txt"; fi
fi

# ---------------------------------------------------------------- summary
{
  echo "Linux video path check, $(date -u +%Y-%m-%dT%H:%M:%SZ), session $SESSION"
  echo "GPU renderer: ${HW_RENDERER:-unknown}"
  echo
  failed=0
  for i in "${!RESULT_NAME[@]}"; do
    printf '%-4s  %-40s %s\n' "${RESULT_STATE[$i]}" "${RESULT_NAME[$i]}" "${RESULT_NOTE[$i]}"
    [ "${RESULT_STATE[$i]}" = FAIL ] && failed=$((failed + 1))
  done
  echo
  if [ "$failed" -eq 0 ]; then echo "RESULT: all checks passed"; else echo "RESULT: $failed check(s) failed"; fi
} | tee "$OUT/summary.txt"

tar -czf "$OUT.tar.gz" -C "$(dirname "$OUT")" "$(basename "$OUT")"
echo "Report: $OUT.tar.gz"
grep -q '^FAIL' "$OUT/summary.txt" && exit 1
exit 0
