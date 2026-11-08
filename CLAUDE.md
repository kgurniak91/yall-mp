# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Y'ALL MP: an Electron + Angular 19 (signals, PrimeNG 19) language-learning media player. mpv does the playback, with an interactive subtitle timeline, a bundled Yomitan dictionary extension, and Anki export. Windows is the primary platform. Linux and macOS are experimental and depend on system-installed mpv and audiowaveform.

## Commands

- `npm install`: the `postinstall` script downloads the Windows mpv, audiowaveform and Yomitan binaries into `electron-resources/` (gitignored) and generates the license files.
- Dev run needs two terminals. First `npm run electron:watch:build` (Angular watch plus `tsc --watch` for the Electron files), then, once the initial build finishes, `npm run electron:watch:run` (nodemon runs `electron .`). On Linux add `-- --no-sandbox`.
- `npm run electron:build`: one-shot build (`ng build --configuration=electron` plus `tsc -p tsconfig.electron.json`).
- `npm run package:win|mac|linux`: build, then electron-builder. Output goes to `dist_electron/`.
- `npm run test:angular`: Karma/Jasmine, headless Chrome, with Spectator and ng-mocks. Specs are `src/**/*.spec.ts`.
- `npm run test:electron`: runs `tsc -p tsconfig.electron.json`, then Vitest on `test/**/*.test.ts`. These cover `playback-manager` and `shared/utils/subtitle-parsing`.
- Single Electron test: `npx vitest run test/playback-manager.test.ts -t "name"`.
- Single Angular spec: `npx ng test --no-watch --browsers=ChromeHeadless --include=src/app/path/to/file.spec.ts`.
- `npm run build:github-pages`: regenerates the `docs/` site from `github-pages/src` (Mustache templates) and `github-pages/locales/{en,pl}.json`. Edit the sources, not the generated `docs/*.html`.

## Architecture

### Electron main process (repo root, CommonJS)

The root `.ts` files compile **in place** to sibling `.js` files, using `tsconfig.electron.json`. Those `.js` files are gitignored, except `preload.js` and the two `subtitles-lookup-*-preload.js` files, which are handwritten and committed. Only the files listed in `tsconfig.electron.json` `include` are compiled.

A new main-process source file must be listed in that `include` list, and its output in `build.files` in `package.json`, or it won't be compiled or packaged.

- `electron-main.ts` (~3k lines): window management, all `ipcMain` handlers, subtitle/media parsing (ffprobe, mkv fonts, ASS), Anki export (ffmpeg), and persistence. Dev runs use a separate userData dir, `yall-mp-dev`.
- `libmpv-manager.ts`: the mpv backend. It drives libmpv in-process through the native addon in `native/yall-libmpv` (wrapped by `libmpv-bridge.ts`) and emits events, `setProperty` and `sendCommand`. `mpv/yall_auto_pause.lua` is loaded into mpv and handles pausing at clip ends. `libmpv-frame-sender.ts` moves the rendered frames to the renderer, falls back from a GPU backend to readback (GPU process gone, device lost, black frames, no frame after a wake-up) and adds the tone mapping filter for HDR sources on the software renderer (`hdr-tonemap.ts`). `fullscreen-transition.ts` and `engine-restart.ts` are small pure policies (fullscreen re-entry, engine restart rate) so they can be unit tested; the main process pauses playback on system suspend and checks the picture after resume (`electron-main.ts`).
- `playback-manager.ts` (~670 lines): the clip-aware playback state machine. It takes the mpv manager and the `mainWindow`, handles repeat, auto-pause, speed override and cinema mode, and sends `playback:state-update` to the renderer. Its unit tests mock the manager and the window.
- `yomitan-manager.ts`: loads the Yomitan extension from `electron-resources/extensions/yomitan` and proxies lookup requests through a hidden window. `scripts/patch-yomitan.js` patches the extension at install time.
- `preload.js`: the single `window.electronAPI` surface exposed to the renderer. Types are in `src/electron-api.d.ts`. Each IPC call is declared in three places: `ipcMain` in `electron-main.ts`, `preload.js`, and `electron-api.d.ts`.

### How video is displayed (current state)

There is one opaque, frameless `BrowserWindow` (`mainWindow`) that holds the Angular app. libmpv renders each frame into a GPU texture (Windows) or a readback buffer (fallback), `LibmpvFrameSender` hands it to the renderer as a `VideoFrame`, and `video-surface-renderer.ts` draws it onto a `<canvas>` in the video area. Subtitles, the timeline and dialogs are plain DOM over that canvas. Set `YALL_MP_VIDEO_BACKEND` / `YALL_MP_VIDEO_ADAPTER` to force a backend or adapter.

Window behaviour is native: maximize, resize (min 800x600) and Aero Snap come from the OS, and the header is a CSS `-webkit-app-region: drag` area with `no-drag` on its controls (body-appended overlays are covered by a global `no-drag` rule in `styles.scss`). The display is kept awake with `powerSaveBlocker` while mpv is unpaused. The window starts with a splash inlined in `src/index.html`.

mpv's own subtitle rendering can be toggled on or off (`useMpvSubtitles`, `showSubtitles`/`hideSubtitles`). Otherwise subtitles are rendered in the renderer, with ASS via assjs. The subtitles lookup uses a further `BrowserWindow` or `WebContentsView`, parented to `mainWindow`. libmpv does not run on Linux yet, and macOS shows the readback picture.

### Angular renderer (`src/app`)

- Routes are in `app.routes.ts`: `projects`, `project/new`, `project/edit/:id`, and `project/:id` (`ProjectDetailsComponent`, with a resolver and a `canDeactivate` guard).
- `state/*`: signal-based state services (clips, video, app, global-settings, project-settings, anki, command-history).
- `model/*`: shared types. The Electron main process also imports the types (`anki`, `project`, `settings`, `video`), so they are listed in `tsconfig.electron.json` and have no Angular imports.
- `model/commands/*`: Command pattern (`execute`/`undo`) for timeline edits (split, merge, update times or text, shift all, etc.), executed through `CommandHistoryStateService` for undo/redo.
- `features/project-details`: the main player screen: timeline-editor (wavesurfer), video-controller, subtitles-overlay and highlighter, yomitan-popup, and per-feature services (tokenization, ass-edit, font-injection, keyboard shortcuts).
- `shared/` (repo root): subtitle parsing and ASS utilities and types used by both the main process and the renderer. Compiled `.js` for `shared/types` and `shared/utils` is gitignored.

### Binaries

mpv, ffmpeg, ffprobe and audiowaveform paths can be overridden in the Advanced settings (`customExecutables` in `electron-main.ts`). The ffmpeg-static and ffprobe-static packages are `asarUnpack`ed in the packaged app.
