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
- `mpv-manager.ts` (~290 lines): spawns and talks to the mpv process through `node-mpv` (emits events, `setProperty`, `sendCommand`). `mpv/yall_auto_pause.lua` is loaded into mpv and handles pausing at clip ends.
- `playback-manager.ts` (~670 lines): the clip-aware playback state machine. It takes an `MpvManager` and the `uiWindow`, handles repeat, auto-pause, speed override and cinema mode, and sends `playback:state-update` to the renderer. Its unit tests mock `MpvManager` and the window.
- `yomitan-manager.ts`: loads the Yomitan extension from `electron-resources/extensions/yomitan` and proxies lookup requests through a hidden window. `scripts/patch-yomitan.js` patches the extension at install time.
- `preload.js`: the single `window.electronAPI` surface exposed to the renderer. Types are in `src/electron-api.d.ts`. Each IPC call is declared in three places: `ipcMain` in `electron-main.ts`, `preload.js`, and `electron-api.d.ts`.

### How video is displayed (current state)

mpv runs as a separate child process, started by `MpvManager` via `node-mpv` and controlled over its JSON IPC. It is launched with `--wid=<native handle>` of `videoWindow`, so mpv draws into that window itself. Frames never pass through Electron's renderer.

Three `BrowserWindow`s are involved:
- `mainWindow`: the visible frame (frameless, black background).
- `videoWindow`: frameless, unfocusable, click-through (`setIgnoreMouseEvents`), `skipTaskbar`. It is recreated when a project loads. It is the `--wid` target.
- `uiWindow`: transparent, holds the Angular app, and is re-parented to `videoWindow` so that it stays on top.

`syncWindowGeometry` in `electron-main.ts` keeps the windows aligned with each other on move, resize, minimize and restore. `window:update-draggable-zones` and `mpv:video-visibility-change` also exist because of this layout. The README reports Z-order problems on some Linux window managers and Wayland compositors, and macOS is untested.

mpv's own subtitle rendering can be toggled on or off (`useMpvSubtitles`, `showSubtitles`/`hideSubtitles`). Otherwise subtitles are rendered in the renderer, with ASS via assjs. The subtitles lookup uses a further `BrowserWindow` or `WebContentsView`.

### Angular renderer (`src/app`)

- Routes are in `app.routes.ts`: `projects`, `project/new`, `project/edit/:id`, and `project/:id` (`ProjectDetailsComponent`, with a resolver and a `canDeactivate` guard).
- `state/*`: signal-based state services (clips, video, app, global-settings, project-settings, anki, command-history).
- `model/*`: shared types. The Electron main process also imports the types (`anki`, `project`, `settings`, `video`), so they are listed in `tsconfig.electron.json` and have no Angular imports.
- `model/commands/*`: Command pattern (`execute`/`undo`) for timeline edits (split, merge, update times or text, shift all, etc.), executed through `CommandHistoryStateService` for undo/redo.
- `features/project-details`: the main player screen: timeline-editor (wavesurfer), video-controller, subtitles-overlay and highlighter, yomitan-popup, and per-feature services (tokenization, ass-edit, font-injection, keyboard shortcuts).
- `shared/` (repo root): subtitle parsing and ASS utilities and types used by both the main process and the renderer. Compiled `.js` for `shared/types` and `shared/utils` is gitignored.

### Binaries

mpv, ffmpeg, ffprobe and audiowaveform paths can be overridden in the Advanced settings (`customExecutables` in `electron-main.ts`). The ffmpeg-static and ffprobe-static packages are `asarUnpack`ed in the packaged app.
