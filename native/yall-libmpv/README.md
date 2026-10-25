# yall-libmpv

N-API (C++17, node-addon-api, cmake-js) addon that embeds libmpv in the Electron main process. The TypeScript wrapper is `libmpv-bridge.ts` (no `electron` import), and the Electron side of frame delivery is `libmpv-frame-sender.ts`.

## Build

```bash
npm run native:build            # build/Release/yall_libmpv.node, against the installed Electron version
npm run native:build -- --prebuild   # also copies it to prebuilds/<platform>-<arch>/
npm run test:native             # integration tests (vitest, vo=null ao=null, no GPU needed)
npm run test:native:smoke -- --backend=auto --seconds=12   # Electron harness, see the header of test/native/electron-smoke/main.js
```

Prerequisites are listed in the root README (MSVC v142+, CMake 3.20+, system libmpv on macOS/Linux). `scripts/build-native.js` finds CMake (`CMAKE_PATH`, PATH, then the one bundled with Visual Studio) and never hard-codes a generator; `CMAKE_GENERATOR` still overrides. The CRT is linked statically.

**Linux limitation:** the addon works under plain Node (`test:native` runs there), but libmpv cannot be loaded inside the Electron main process: Electron's bundled `libffmpeg.so` is in the global symbol scope, libmpv binds to its libavcodec instead of the system one, and mpv exits in `mpv_initialize` with a version mismatch. `dlmopen` and `RTLD_DEEPBIND` do not fix it (they abort on free). Linux therefore needs libmpv in a separate host process; `test/native/support/ffmpeg-scope-probe.js` prints the evidence.

On Windows libmpv is `electron-resources/windows/libmpv-2.dll`, downloaded by `npm install`. On macOS and Linux the system library is used. `YALL_LIBMPV_ADDON` overrides the addon path and `YALL_LIBMPV_PATH` the library path in tests. Set `YALL_NATIVE_REQUIRED=1` to make `test:native` fail instead of skip when the addon or libmpv is missing (CI does).

## Linux dev loop

Linux does not build the addon, only `yall-mpv-host` (plain CMake, no Node headers). The inner loop is WSL2 (WSLg for Electron), with VMs for real X11 and Wayland sessions.

- Distros: `wsl.exe --install Ubuntu` and `wsl.exe --install Debian` (different libmpv generations). Call them explicitly with `wsl.exe -d <name>`, the Windows default distro may be something else. Run `wsl.exe --update` first if the first start fails with `E_UNEXPECTED`.
- Packages: `build-essential cmake git curl pkg-config libmpv-dev mpv libfontconfig1-dev xvfb gdb rsync xz-utils`, plus Node 22 from nodejs.org (the distro Node can be too old for node-gyp).
- Work in a clone or rsync copy on ext4 (`~/yall-mp`) with its own `node_modules`, not under `/mnt/c`:
  `rsync -a --delete --exclude node_modules --exclude build --exclude electron-resources --exclude 'dist*' --exclude .git /mnt/c/<repo>/ ~/yall-mp/`
- Shared core only: `cmake -S native/yall-libmpv -B /tmp/core -DYALL_BUILD_ADDON=OFF -DYALL_BUILD_HOST=OFF && cmake --build /tmp/core`.
- Host build: `npm run native:build` (writes `build/Release/yall-mpv-host`).

## Layout

- `yall_core` (static library, no Node dependency, shared by the addon and the Linux host): `mpv_loader`, `node_value`, `live_counts`, `thread_cpu`, `render/*`.
- `src/mpv_loader.*`: `LoadLibraryExW` / `dlopen` and the symbol table, so a missing library is an error and not a crash.
- `src/node_value.*`: `NodeValue` copy of an `mpv_node` and `MpvErrorName`. `src/node_convert.*`: the N-API half (`ToJs`, `ScalarToNode`).
- `src/core.*`, `src/addon.cpp`: `MpvCore`, one per instance. Options, `initialize`, promise-based `command` / `getProperty` / `setProperty` (`mpv_*_async` reply ids, the promise map is only touched on the JS thread), property observation, and one event thread (the only `mpv_wait_event` caller) feeding a single ThreadSafeFunction.
- `src/core_render.cpp`, `src/render/*`: render core.
  - `render_thread`: one per attach. Waits on the mpv update callback, renders, hands frames to JS.
  - `d3d11_shared`: 4-slot pool of shared NT-handle textures (Windows). `d3d11_readback`: staging-texture readback. `sw_readback`: mpv SW render API, default readback off Windows. macOS/Linux GPU backends are not implemented yet.
  - `d3d11_device`: adapter match by vendor/device id and the `GpuWaiter` (fence, then `EnqueueSetEvent`, then query + `Sleep(1)`; never a busy spin).
- `ring_stats.h`, `thread_cpu.*`: `stats()` percentiles and per-thread CPU time.
- `src/event_msg.*`: the Node-free conversion of an mpv event into an owned message, used by the addon and the host.
- `host/*` (Linux only): `yall-mpv-host`, libmpv in its own process. `protocol.*` frames messages over the unix socket the client passes as fd 3 (`[u32 type][u32 jsonLen][u32 binLen][json][bin]`, JSON through the vendored `third_party/nlohmann/json.hpp`), `host_core.*` is the counterpart of `MpvCore` (create, command/get/set with reply ids, observe, attach, destroy), `socket_sink.*` writes readback frames to the socket. `yall-mpv-host --probe <path>` loads a library and prints its client API version. The host exits when the socket closes (`PR_SET_PDEATHSIG` covers a killed parent). The TypeScript client is `libmpv-host.ts`; it presents the host as a `NativeAddon`, so nothing above `libmpv-bridge.ts` knows which transport is used. `test/libmpv-host.test.ts` tests the client against a scripted host on any OS, `test/native/host.test.ts` the real process on Linux.

### Slot lifecycle (shared backend)

```
Free --render--> Rendering --GPU wait--> InFlight --releaseSlot(attachId, slotId, serial)--> Free
                                            |
                                            +-- older than slotTimeoutMs --> reclaimed (handle closed, slot recreated, serial bumped)
```

Every hand-off bumps the slot serial, so a release with a stale serial or attach id is ignored (`lateReleases`). Old-size frames are still delivered (the renderer draws them scaled), because dropping them froze the picture during a resize.

## Threading rules (render.h)

- The update callback only signals a condition variable. No mpv calls in it.
- Every `mpv_render_*` call runs on the render thread, one at a time.
- `MPV_RENDER_PARAM_ADVANCED_CONTROL` is not set.
- The render context is freed before `mpv_terminate_destroy`. `destroy()` waits for it (bounded), then terminates on an `AsyncWorker`.

## Headers

Only the vendored headers in `include/mpv/` are compiled against, never the ones in a mpv-dev archive (the shinchiro archive lacks `render_d3d11.h`). See `include/mpv/VENDORED.md` for the commit and the ISC licence.

## Bumping libmpv

In one change:
1. Update `LIBMPV` (archive name, sha256, mirror tag) in `scripts/download-dependencies.js`.
2. Re-vendor the headers from the same mpv commit: `node scripts/vendor-mpv-headers.js <commit>`.
3. Update the commit in `scripts/generate-licenses.js`.
4. Create the mirror release for the new archive (see the comment above `LIBMPV`), then run `npm run native:build && npm run test:native`.

## macOS GPU backend (`iosurface-shared`)

`src/render/iosurface_shared.mm`: a CGL 3.2 core context (accelerated pixel format first, Apple's software renderer second), a pool of IOSurface-backed FBOs, mpv's OpenGL render API with `FLIP_Y=0`, `glFinish` before a frame is handed out. `Init` builds and frees a 16x16 target first, so a missing IOSurface path fails the attach (`RENDER_INIT_FAILED`) and the frame sender falls back to readback. A software GL renderer is refused unless `YALL_MP_ALLOW_SOFTWARE_GL=1` (hosted CI Macs have nothing else).

- No Mac is needed for the usual work: CI (`native` job on macOS) runs the `iosurface-shared` suite in `test/native/render.test.ts`, which reads pixels with `addon.readSurfacePixel(handle, x, y)` inside the frame callback (a slot is rendered into again right after its release). Its log shows the GL renderer, the sampled colours and `glErrors`.
- `YALL_MP_GL_DEBUG=1` prints the backend's GL notes and errors to stderr; the same notes are in `stats().note` and in `video.log`.
- The app uses readback on macOS by default; `YALL_MP_VIDEO_BACKEND=iosurface-shared` opts in to the GPU backend.
