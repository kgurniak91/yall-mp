---
name: release
description: Cut a new Y'ALL MP release from master - preflight checks, version bump, push, tag, wait for the Build/Release CI run, then fill the DRAFT GitHub release with the notes. The user publishes it by hand. Run only when the user types /release.
disable-model-invocation: true
argument-hint: <version> [release-notes-file]
---

# /release <version> [release-notes-file]

Cuts release `v<version>` of Y'ALL MP. Example: `/release 0.9.9-beta notes.md`.

The user asked for one confirmation at the start and then a full run. **The release itself is never published by this skill.** It stays a draft, and the user clicks "Publish release" on GitHub.

Arguments: `$ARGUMENTS`
- **First word:** the version. Strip a leading `v`.
- **Second word (optional):** a Markdown file with the release notes.

If the version is missing, stop and ask for it.

## 1. Preflight (read-only)

Run `node scripts/release-preflight.js <version>` and show its output. It checks:
- the version format;
- the git state: on `master`, clean tree, HEAD equal to `origin/master`, tag free;
- CI of HEAD (all runs completed and green);
- the dependency URLs in `scripts/download-dependencies.js`;
- the pinned libmpv: its mirror is downloaded and its sha256 checked.

Results:
- **Any `FAIL`:** stop and report. Do not fix things on your own.
- **Only `FAIL CI ... in_progress`/`queued`:** you may wait with `gh run watch <id> --exit-status` and run the preflight again.
- **A libmpv mirror failure:** the pin was bumped without its copy. Tell the user to create the `deps-mpv-dev-<date>` pre-release first; the steps are in the comment above `LIBMPV` in `scripts/download-dependencies.js`.
- **`WARN` lines** (a pruned upstream fallback) do not block.

Keep the `LIBMPV_NOTE:` line for step 3.

## 2. Release notes and the one confirmation

**Notes:**
- **With a notes file:** read it.
- **Without one:** draft notes from `git log <previous tag>..HEAD --no-merges --format='%s%n%b'`. The previous tag is `git describe --tags --abbrev=0 --match 'v*'`. Use the style of the previous release (`gh release view <previous tag> --json body --jq .body`): bold section headers and short bullets in plain English. Save the draft to a scratch file.

In both cases, append the `LIBMPV_NOTE` sentence as the last line, unless the notes already name the libmpv build.

**Then ask ONE question** (AskUserQuestion). Show:
- the version change;
- the commit that will be tagged;
- the notes, in full or the path plus the first lines;
- the plan: bump version, commit "Chore: bump version to <version>", push master, tag `v<version>`, push the tag, wait for the Build/Release run, fill the draft release.

Offer two options: "Run it" or "Stop". Anything other than "Run it" ends the skill with nothing changed.

## 3. Run (no more questions unless something fails)

1. **Bump:** `npm version <version> --no-git-tag-version`. This updates `package.json` and `package-lock.json`; check that both changed and nothing else did.
2. **Commit:** `git commit -am "Chore: bump version to <version>"`, with the commit attribution trailer from the session instructions.
3. **Push master:** `git push origin master`. If it is rejected (someone pushed meanwhile), stop and report. Never force-push.
4. **Tag:** `git tag v<version>`, then `git push origin v<version>`.
5. **Wait for the build:** find the run with `gh run list --workflow build.yml --branch v<version> --limit 1 --json databaseId,status,url`; retry for up to about a minute until it appears. Then watch it: `gh run watch <id> --exit-status`, in the background, about 15-25 min, and wait for the notification. If it fails, stop and report: the failing job, the end of its log (`gh run view <id> --log-failed | tail -80`), and the options (fix and release a new patch version, or delete the tag and the draft). Do nothing on your own here: the tag is already public.
6. **Check the draft:** `gh release view v<version> --json isDraft,name,assets --jq '.isDraft, .name, (.assets[].name)'`.
   - It must be a draft.
   - It must have files ending in `.exe`, `.dmg`, `.AppImage` and `.deb`, plus `latest.yml`, `latest-mac.yml` and `latest-linux.yml`.
   - Report anything missing.
7. **Fill in the notes:** `gh release edit v<version> --title "<version>" --notes-file <notes file> --draft=true`. Then read it back (`gh release view v<version> --json body --jq .body | head -20`).

## 4. Hand over

Tell the user:
- the draft URL (`gh release view v<version> --json url --jq .url`);
- the asset list;
- that the notes are filled in.

Their part:
- open the draft;
- check it;
- click "Publish release";
- then, if wanted, answer and close the related GitHub issues.

Never run `gh release edit --draft=false` or anything else that publishes.

## Rules

- No force push, no tag deletion, no `--no-verify`, no publishing.
- Every failure: stop, show the output, explain the options in plain words, wait for the user.
- Do not run `npm install` or the install scripts here.
