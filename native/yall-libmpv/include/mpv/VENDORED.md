# Vendored mpv client API headers

These headers are copied unmodified from the mpv repository and are the only mpv headers the addon is built against.
Do not compile against the headers inside a mpv-dev archive (the shinchiro archive lacks `render_d3d11.h`).

- Commit: `dde0671072723c311df874a32dc4e48b5197ca62`
- Commit date: 2026-10-16T22:34:45Z
- Files:
  - https://raw.githubusercontent.com/mpv-player/mpv/dde0671072723c311df874a32dc4e48b5197ca62/include/mpv/client.h
  - https://raw.githubusercontent.com/mpv-player/mpv/dde0671072723c311df874a32dc4e48b5197ca62/include/mpv/render.h
  - https://raw.githubusercontent.com/mpv-player/mpv/dde0671072723c311df874a32dc4e48b5197ca62/include/mpv/render_d3d11.h
  - https://raw.githubusercontent.com/mpv-player/mpv/dde0671072723c311df874a32dc4e48b5197ca62/include/mpv/render_gl.h
  - https://raw.githubusercontent.com/mpv-player/mpv/dde0671072723c311df874a32dc4e48b5197ca62/include/mpv/stream_cb.h

To bump: `node scripts/vendor-mpv-headers.js <commit>` with the same commit as the libmpv archive pinned in `scripts/download-dependencies.js`, in one change.

## Licence (ISC, from `client.h`)

```
Copyright (C) 2017 the mpv developers

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```
