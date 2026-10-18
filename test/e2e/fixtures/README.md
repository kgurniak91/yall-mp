# E2E fixtures

Self-generated, so there is no copyright issue. Regenerate with `npm run e2e:fixtures` (uses `ffmpeg-static`, see `scripts/generate-test-media.js`). The total must stay under 1 MB.

| File | Content |
|---|---|
| `sample.mp4` | 10 s, 640x360, h264 + aac (440 Hz tone). 0-3 s red, 3-6 s green, 6-10 s blue, with a moving `testsrc2` inset in the top-left corner (the centre is always a solid colour) |
| `sample.srt` | `0.5-2.5 s` "Red line one", `3.5-5.5 s` "Green line two", `6.5-8.5 s` "Blue line three" |
| `sample-styled.ass` | The same three lines and times as ASS, one `Default` style, PlayRes 640x360. Deliberately **not** named `sample.ass`: the companion-subtitle matcher picks the shortest `sample*` name and would tie with `sample.srt` |
| `sample-5.1.mkv` | 5 s (red 2 s, green 2 s, blue 1 s), ac3 5.1(side) audio and `sample-styled.ass` embedded. For track selection and the Anki `-ac 2` downmix |
