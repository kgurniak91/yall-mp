# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Y'ALL MP: an Electron + Angular 19 (signals, PrimeNG 19) language-learning media player. libmpv does the playback (through a native addon, its picture drawn inside the app window), with an interactive subtitle timeline, a bundled Yomitan dictionary extension, and Anki export. Windows is the primary platform. Linux and macOS are experimental and depend on the system libmpv (Homebrew `mpv`, distro `libmpv2`, 0.40 or newer) and audiowaveform.

## Commands

- `npm install`: the `postinstall` script downloads the Windows libmpv (`libmpv-2.dll` from a pinned mpv-dev archive, sha256-checked), audiowaveform and Yomitan into `electron-resources/` (gitignored) and generates the license files.
- `npm run native:build`: builds the native addon in `native/yall-libmpv` (CMake via cmake-js; on Linux also `yall-mpv-host` and `yall_fdpass.node`). Needed once after cloning and after native changes; the `package:*` scripts run it. Toolchain in `native/yall-libmpv/README.md`.
- Dev run needs two terminals. First `npm run electron:watch:build` (Angular watch plus `tsc --watch` for the Electron files), then, once the initial build finishes, `npm run electron:watch:run` (nodemon runs `electron .`). On Linux add `-- --no-sandbox`.
- `npm run electron:build`: one-shot build (`ng build --configuration=electron` plus `tsc -p tsconfig.electron.json`).
- `npm run package:win|mac|linux`: build, then electron-builder. Output goes to `dist_electron/`.
- `npm run test:angular`: Karma/Jasmine, headless Chrome, with Spectator and ng-mocks. Specs are `src/**/*.spec.ts`.
- `npm run test:electron`: runs `tsc -p tsconfig.electron.json`, then Vitest on `test/**/*.test.ts` (the main-process modules and policies, e.g. `playback-manager`, the frame sender, the libmpv bridge and host client, and `shared/utils/subtitle-parsing`).
- `npm run test:native`: Vitest integration tests of the native addon against the real libmpv (`test/native`, `vitest.native.config.ts`). `npm run test:native:smoke` runs a small Electron harness that plays a file on one video backend (`--backend=...`) and prints a summary (fps, CPU, fallbacks).
- `npm run test:e2e`: builds, then runs the Playwright suite in `test/e2e` against the real app (`test:e2e:run` skips the build). It uses a throwaway userData dir; the `@os-input` specs move the real mouse (`--grep-invert @os-input` to skip them).
- `npm run soak` (`scripts/soak-video.js`, needs `electron:build`) plays a looped file for an hour with seeks, pauses, resizes and project reopens and fails on memory growth or leak counters; `npm run bench:kit` (`scripts/make-bench-kit.js`) packs a benchmark kit for a machine without dev tools (`scripts/bench`).
- Single Electron test: `npx vitest run test/playback-manager.test.ts -t "name"`.
- Single Angular spec: `npx ng test --no-watch --browsers=ChromeHeadless --include=src/app/path/to/file.spec.ts`.
- `npm run build:github-pages`: regenerates the `docs/` site from `github-pages/src` (Mustache templates) and `github-pages/locales/{en,pl}.json`. Edit the sources, not the generated `docs/*.html`.

## Architecture

### Electron main process (repo root, CommonJS)

The root `.ts` files compile **in place** to sibling `.js` files, using `tsconfig.electron.json`. Those `.js` files are gitignored, except `preload.js` and the two `subtitles-lookup-*-preload.js` files, which are handwritten and committed. Only the files listed in `tsconfig.electron.json` `include` are compiled.

A new main-process source file must be listed in that `include` list, and its output in `build.files` in `package.json`, or it won't be compiled or packaged.

- `electron-main.ts` (~3k lines): window management, all `ipcMain` handlers, subtitle/media parsing (ffprobe, mkv fonts, ASS), Anki export (ffmpeg), and persistence. Dev runs use a separate userData dir, `yall-mp-dev`.
- `libmpv-manager.ts`: the mpv backend. On Windows and macOS it drives libmpv in-process through the native addon in `native/yall-libmpv` (wrapped by `libmpv-bridge.ts`); on Linux libmpv cannot share a process with Electron's own ffmpeg, so it runs in the out-of-process `yall-mpv-host` (`native/yall-libmpv/host`), whose client `libmpv-host.ts` has the shape of the addon (frames come back as dma-buf fds through `yall_fdpass.node`, or as copies). It emits events, `setProperty` and `sendCommand`. `mpv/yall_auto_pause.lua` is loaded into mpv and handles pausing at clip ends. `libmpv-frame-sender.ts` moves the rendered frames to the renderer, falls back from a GPU backend to readback (GPU process gone, device lost, black frames, no frame after a wake-up) and adds the tone mapping filter for HDR sources on the software renderer (`hdr-tonemap.ts`). `fullscreen-transition.ts` and `engine-restart.ts` are small pure policies (fullscreen re-entry, engine restart rate) so they can be unit tested; the main process pauses playback on system suspend and checks the picture after resume (`electron-main.ts`).
- `lookup-host.ts`: the subtitles lookup panel (its own frameless window on Windows and macOS, a view inside the main window on Linux). `window-fit.ts`: keeps the window inside a smaller display it was moved to. `linux-display-server.ts` and `linux-desktop-entry.ts`: the X11/XWayland choice and the AppImage's own menu entry and icon on Linux.
- `playback-manager.ts` (~670 lines): the clip-aware playback state machine. It takes the mpv manager and the `mainWindow`, handles repeat, auto-pause, speed override and cinema mode, and sends `playback:state-update` to the renderer. Its unit tests mock the manager and the window.
- `yomitan-manager.ts`: loads the Yomitan extension from `electron-resources/extensions/yomitan` and proxies lookup requests through a hidden window. `scripts/patch-yomitan.js` patches the extension at install time. `setLanguageFull` points Yomitan at the subtitle language and restores the dictionary switches remembered for that language (`dictionary-switches.ts`, stored in `userData/yomitan-dictionary-switches.json`); dictionaries without a declared language get one from the user on the Offline Dictionaries tab (`dictionary-language-dialog`, asked right after the import and editable later).
- `preload.js`: the single `window.electronAPI` surface exposed to the renderer. Types are in `src/electron-api.d.ts`. Each IPC call is declared in three places: `ipcMain` in `electron-main.ts`, `preload.js`, and `electron-api.d.ts`.

### How video is displayed (current state)

There is one opaque, frameless `BrowserWindow` (`mainWindow`) that holds the Angular app. libmpv renders each frame into a shared GPU buffer or a readback (CPU copy) buffer, `LibmpvFrameSender` hands it to the renderer as a `VideoFrame`, and `video-surface-renderer.ts` draws it onto a `<canvas>` in the video area. Subtitles, the timeline and dialogs are plain DOM over that canvas. The default backend (`auto`) is the platform's shared GPU path: `d3d11-shared` on Windows, `iosurface-shared` on macOS, `dmabuf-shared` on Linux (readback there when the GL renderer is software). Any attach, import, black-frame or GPU-loss failure falls back to readback, and the "Fast video path (GPU)" global setting off means readback from the start. The choice and the reason are logged to `video.log` in userData. Set `YALL_MP_VIDEO_BACKEND` / `YALL_MP_VIDEO_ADAPTER` to force a backend or adapter.

Window behaviour is native: maximize, resize (min 800x600) and Aero Snap come from the OS, and the header is a CSS `-webkit-app-region: drag` area with `no-drag` on its controls (body-appended overlays are covered by a global `no-drag` rule in `styles.scss`). On Linux the packaged app runs through X11 (XWayland on a Wayland desktop): a native Wayland client cannot know its window position or monitor, so the packaging step (`scripts/linux-launcher.js`) puts a launcher script in front of the binary that starts it with `--ozone-platform=x11`; a development run needs that switch by hand. The display is kept awake with `powerSaveBlocker` while mpv is unpaused. The window starts with a splash inlined in `src/index.html`.

mpv's own subtitle rendering can be toggled on or off (`useMpvSubtitles`, `showSubtitles`/`hideSubtitles`). Otherwise subtitles are rendered in the renderer, with ASS via assjs. The subtitles lookup uses a further `BrowserWindow` or `WebContentsView`, parented to `mainWindow` (`lookup-host.ts`).

### Angular renderer (`src/app`)

- Routes are in `app.routes.ts`: `projects`, `project/new`, `project/edit/:id`, and `project/:id` (`ProjectDetailsComponent`, with a resolver and a `canDeactivate` guard).
- `state/*`: signal-based state services (clips, video, app, global-settings, project-settings, anki, command-history).
- `model/*`: shared types. The Electron main process also imports the types (`anki`, `project`, `settings`, `video`), so they are listed in `tsconfig.electron.json` and have no Angular imports.
- `model/commands/*`: Command pattern (`execute`/`undo`) for timeline edits (split, merge, update times or text, shift all, etc.), executed through `CommandHistoryStateService` for undo/redo.
- `features/project-details`: the main player screen: timeline-editor (wavesurfer), video-controller, subtitles-overlay and highlighter, yomitan-popup, and per-feature services (tokenization, ass-edit, font-injection, keyboard shortcuts).
- `shared/` (repo root): subtitle parsing and ASS utilities and types used by both the main process and the renderer. Compiled `.js` for `shared/types` and `shared/utils` is gitignored.

### Binaries

The libmpv library, ffmpeg, ffprobe and audiowaveform paths can be overridden in the Advanced settings (`customExecutables` in `electron-main.ts`). On macOS and Linux libmpv is looked up in the system library paths (on macOS also the Homebrew prefixes, so an app started from Finder finds it). The ffmpeg-static and ffprobe-static packages are `asarUnpack`ed in the packaged app.
