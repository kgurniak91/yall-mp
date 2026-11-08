# E2E fixtures

Self-generated, so there is no copyright issue. Regenerate with `npm run e2e:fixtures` (uses `ffmpeg-static`, see `scripts/generate-test-media.js`). The total must stay under 1 MB.

| File | Content |
|---|---|
| `sample.mp4` | 10 s, 640x360, h264 + aac (440 Hz tone). 0-3 s red, 3-6 s green, 6-10 s blue, with a moving `testsrc2` inset in the top-left corner (the centre is always a solid colour) |
| `sample.srt` | `0.5-2.5 s` "Red line one", `3.5-5.5 s` "Green line two", `6.5-8.5 s` "Blue line three" |
| `sample-styled.ass` | The same three lines and times as ASS, one `Default` style, PlayRes 640x360. Deliberately **not** named `sample.ass`: the companion-subtitle matcher picks the shortest `sample*` name and would tie with `sample.srt` |
| `clips.mp4` | 15 s, 320x180, h264 (keyframe every 8 frames) + aac. Ten clips, each a solid colour, so the centre pixel tells which clip is on screen (the moving inset is top-left only) |
| `clips.srt`, `clips.ass` | The five subtitled clips of `clips.json` (the ASS has PlayRes 320x180) |
| `clips.json` | The clip timeline (index, start, end, hasSubtitle, text, colour) as the app's clip generator cuts it: gap 0-1, subtitle 1-2.5, gap 2.5-4, subtitle 4-5.5, subtitle 5.5-7 (adjacent), short gap 7-7.3, subtitle 7.3-8.8, long gap 8.8-12, subtitle 12-13.5, trailing gap 13.5-15. Written by the generator and read by `support/clips.ts`, so the timeline is defined in one place |
| `sample-5.1.mkv` | 5 s (red 2 s, green 2 s, blue 1 s), ac3 5.1(side) audio and `sample-styled.ass` embedded. For track selection and the Anki `-ac 2` downmix |
