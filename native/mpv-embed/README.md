# `yall_mpv_embed` — macOS video surface

Small native Node add-on (N-API, Objective-C++) used only on macOS.

## Why

On Windows and Linux the app starts `mpv` as a separate process and passes
`--wid=<window id>` so mpv paints inside an Electron window. mpv has no `--wid`
support on macOS (only X11, win32 and Android are documented), and an
`NSView*` from Electron is meaningless to another process anyway, so on a Mac
the separate-process design cannot draw inside the app window at all.

This add-on loads **libmpv** (from Homebrew's `mpv` package) into the Electron
main process, inserts an `NSOpenGLView` into the window *underneath* Chromium's
web view, and lets libmpv paint into it through the mpv render API. The
transparent parts of the UI page then show the video, exactly as the separate
video window does on Windows. Playback control is unchanged: libmpv still
opens the JSON IPC socket (`input-ipc-server`) that `node-mpv` talks to.

## API (see `mpv-embed.ts` for the typed wrapper)

| Function | Purpose |
| --- | --- |
| `probe(libmpvPath?)` | Try to load libmpv; returns `{ok, path, apiVersion}` or `{ok: false, error}`. |
| `create(handle, options)` | `handle` = `BrowserWindow.getNativeWindowHandle()`. Creates the views, the libmpv instance (options applied before `mpv_initialize`) and the render context. Returns `{id, renderer, libmpvPath, rejectedOptions}`. |
| `setFrame(id, x, y, w, h)` | Video rectangle in points, top-left origin, relative to the window content area. |
| `setVisible(id, visible)` | Hide/show the video view (the black base view stays). |
| `destroy(id)` | Frees the render context, terminates libmpv, removes the views. |
| `stats(id)` | Renderer name, frame counters, backing size — for diagnostics. |
| `attach(handle, position?)` / `detach(handle)` | Add/remove the black base view before any video exists. |
| `setWindowAspectLock(handle, aspect, extraWidth, extraHeight, minVideoWidth)` | Keeps the window in the video's shape while the user resizes it (content = extras + video at `aspect`, following the dragged edge); `aspect` 0 unlocks. Overrides `windowWillResize:toSize:` on a dynamic subclass of Electron's window delegate, because `BrowserWindow.setAspectRatio` also sets NSWindow's own aspect ratio, which ignores `extraSize` and fights it. |
| `watchWindow(handle, onEvent)` / `unwatchWindow(handle)` | `onEvent('will-enter-full-screen' \| 'did-exit-full-screen')`, called synchronously as the transition starts — Electron's own events come after it, too late to drop the window's aspect-ratio lock. |

`create` accepts `renderer: 'gl' | 'sw'` (default OpenGL, automatic fallback to
the software renderer if OpenGL is unavailable), `position: 'below' | 'above'`
(relative to the web view), `logLevel` and an `onEvent` callback that receives
`{type: 'shutdown' | 'log' | 'render-error', ...}`.

Environment overrides for troubleshooting: `YALL_LIBMPV_PATH=/path/to/libmpv.2.dylib`,
`YALL_MPV_RENDERER=sw`.

## Building

`npm install` runs `scripts/build-native.js --optional` on macOS, which compiles
the add-on against the installed Electron version with `node-gyp`. It needs the
Xcode Command Line Tools (`xcode-select --install`). libmpv itself is **not**
needed at build time — it is loaded with `dlopen` at run time from
`/opt/homebrew/lib`, `/usr/local/lib`, `/opt/local/lib` or `YALL_LIBMPV_PATH`.

Rebuild by hand with `npm run build:native`.

## Licensing

- `vendor/mpv/*.h` are the libmpv client API headers, ISC licensed by the mpv
  developers (the notice is at the top of each file).
- The rendering loop, software fallback and teardown order follow
  [IPTVnator](https://github.com/4gray/iptvnator)'s `embedded_mpv.mm` (MIT).
- Everything else is part of Y'ALL MP (GPLv3).
