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

On Windows libmpv is `electron-resources/windows/libmpv-2.dll`, downloaded by `npm install`. On macOS and Linux the system library is used. `YALL_LIBMPV_ADDON` overrides the addon path and `YALL_LIBMPV_PATH` the library path in tests. Set `YALL_NATIVE_REQUIRED=1` to make `test:native` fail instead of skip when the addon or libmpv is missing (CI does).

## Layout

- `src/mpv_loader.*`: `LoadLibraryExW` / `dlopen` and the symbol table, so a missing library is an error and not a crash.
- `src/core.*`, `src/addon.cpp`: `MpvCore`, one per instance. Options, `initialize`, promise-based `command` / `getProperty` / `setProperty` (`mpv_*_async` reply ids, the promise map is only touched on the JS thread), property observation, and one event thread (the only `mpv_wait_event` caller) feeding a single ThreadSafeFunction.
- `src/core_render.cpp`, `src/render/*`: render core.
  - `render_thread`: one per attach. Waits on the mpv update callback, renders, hands frames to JS.
  - `d3d11_shared`: 4-slot pool of shared NT-handle textures (Windows). `d3d11_readback`: staging-texture readback. `sw_readback`: mpv SW render API, default readback off Windows. macOS/Linux GPU backends are Phase 8.
  - `d3d11_device`: adapter match by vendor/device id and the `GpuWaiter` (fence, then `EnqueueSetEvent`, then query + `Sleep(1)`; never a busy spin).
- `ring_stats.h`, `thread_cpu.*`: `stats()` percentiles and per-thread CPU time.

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
