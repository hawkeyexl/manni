# Video script: Sidecar manifests by URL

**Objective:** Show that `sidecars[].file` now takes a URL. One repository's
pages can be validated against a manifest served from another, with no checkout
and no shell step. A private manifest needs only `tokenEnv:`. A manifest that
cannot be reached is exit 2, never a silent pass.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 40.2 s (spec: 20-45 s).
**Audience:** CI engineers and docs engineers who keep a docset next to another
repository's metadata (personas Devin and Maya, CUJs D1 / D2 / M1).
**Feature:** proposal 0038, `docs/proposals/0038-sidecar-url-manifests.md`.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue; never
red, green, yellow or cyan, which the CLI's own output uses). Terminal
`#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px
accent rules, caption band 86 px.

## How it was made, and what is staged

Everything printed in the terminal is a real run of `node dist/cli.js` on this
branch. The typed command reads `manni` through a shim on PATH
(`media/bin/manni`) that execs the built CLI.

- **A Remotion replay, not a VHS capture.** VHS cannot record on this machine,
  because its bundled `ttyd` hangs on connect. This run re-checked it with a
  one-line tape, which produced no frame in 60 s. So the CLI was run under a
  small preload that makes stdout/stderr report as a TTY
  (`media/capture/tty.cjs`), and the bytes were saved verbatim
  (`media/capture-url/*.ans`). A Remotion composition
  (`media/remotion/src/url/beats.ts`, `src/Demo.tsx`) replays them. It types at
  45 ms/char, presses Enter, and shows the output after the command's
  **measured** latency. Nothing in the output is edited.
- **The server is local.** There is no public repository to fetch from, so the
  manifest is served from `media/scratch-url/` by `python -m http.server 8765`
  on loopback. The feature permits `http://` for loopback, and any other host
  must be `https://`. The URL on screen is the real one, `http://127.0.0.1:8765/…`.
  No substitution for a `raw.githubusercontent.com` URL was made, because the
  same URL appears in the CLI's output and that output must stay byte-exact.
- **`media/scratch-url/` is its own git repository.** `media/` is gitignored
  in the manni repo, and `manni meta` honours `.gitignore` through
  `git check-ignore`, which would have skipped every page. A `git init` inside
  the scratch directory makes it the "public repo" of the story. It also takes
  the outer ignore file out of the picture, with no extra flag on any typed
  command.
  Nothing was committed to manni.
- **The config edit between beats 2 and 3 is off camera.** Beat 3 begins with
  `cat manni.config.yaml` showing the `tokenEnv: PRIVATE_DOCS_TOKEN` line already
  added. `PRIVATE_DOCS_TOKEN` was unset for the whole session.
- **Beat 4 was captured with the private config in place** (the one from beat
  3). The `--offline` output is identical with the public config; both captures
  are in `media/capture-url/` (`offline.ans`, `offline-private.ans`).
- **Long lines wrap at spaces, with a hanging indent.** A real terminal would
  hard-wrap mid-URL at the column edge. The replay breaks only at a space and
  gives the continuation row the line's own indent. No token is split
  (design.md check 2). The bytes are the same; only where the row breaks differs.

## Derived font size

The longest real line is 137 characters (the `tokenEnv` error). Unwrapped, it
fits 1040 px only at 15 px, which is illegible on a phone, so the terminal wraps.
With space-only wrapping, every candidate from 16 px to 30 px fits the 878 px
terminal area. **23 px / 75 columns** is the largest size at which every long
line wraps to exactly two rows with no orphaned last word. At 24 px the
`docs/ops.md` finding takes three rows, and at 25 px `set.` is orphaned. Line
height 32 px.
The tallest beat is 17 rows = 544 px. The search is `media/capture-url/cols3.mjs`
and `cols4.mjs`, run over the captured bytes.

## Beats

<!-- The Title and Caption cells are burned into the rendered video, so they stay as shown. -->
<!-- vale Voices.ColonReveal = NO -->

| # | Title (band) | Terminal | Caption (band) | Length |
|---|---|---|---|---|
| 1 | file: is a URL now | `cat manni.config.yaml` | The manifest lives in another repo. A public one needs no token: a URL and the keys it owns. | 6.1 s |
| 2 | validate fetches it | `manni meta validate` then `echo $?` | The merged object is checked. billing's bad ticket is reported at the URL, line 6, not in the page. | 10.2 s |
| 3 | Private: add tokenEnv | `cat manni.config.yaml`, `manni meta validate`, `echo $?` | tokenEnv names the variable holding the token. Unset, the run stops with exit 2 and names the variable. | 12.6 s |
| 4 | --offline refuses it | `manni meta validate --offline` | A remote manifest is fetched every run, never cached. With no network there is nothing to check, so it stops. | 6.3 s |
| 5 | Exit codes for CI | `echo $?` (same screen as beat 4) | 1 for findings, 2 when the manifest cannot be reached. The message names the variable, never the token. | 5.0 s |

<!-- vale Voices.ColonReveal = YES -->

Beats 1-4 each start on a cleared terminal. Beat 5 continues beat 4's screen
because `$?` refers to the command above it.

Two caption claims are not demonstrated on screen and were verified instead.
The first is "never cached" (0038 rule 1), and `src/meta/core/sidecar-fetch.ts`
has no cache path. The second is "never the token" (0038 rule 4). The beat 3
message names the variable `PRIVATE_DOCS_TOKEN`, and the token value is only
ever placed in the `Authorization` header.

## Real output quoted

Beat 2, `manni meta validate` (exit 1):

```
Using manni.config.yaml (.)
✓ docs/auth.md
✗ docs/billing.md
    /jira  must match pattern "^PLAT-[0-9]+$"  (http://127.0.0.1:8765/docs-meta.yaml:6)  [./private.schema.json]
✗ docs/new.md
    (root)  must have required property 'jira'  (line 1)  [./private.schema.json]
✗ docs/ops.md
    /jira  "jira" is owned by sidecar http://127.0.0.1:8765/docs-meta.yaml; remove it from the document  (line 3)  [sidecar:owned]

4 files checked, 1 passed, 3 failed, 3 errors
```

Beat 3, `manni meta validate` with `tokenEnv: PRIVATE_DOCS_TOKEN` and the
variable unset (exit 2):

```
Using manni.config.yaml (.)
manni: Sidecar manifest http://127.0.0.1:8765/docs-meta.yaml: the environment variable PRIVATE_DOCS_TOKEN named by "tokenEnv" is not set.
```

Beat 4, `manni meta validate --offline` (exit 2):

```
Using manni.config.yaml (.)
manni: Sidecar manifest http://127.0.0.1:8765/docs-meta.yaml is remote and the run is offline. Vendor it to a path, or drop --offline.
```

One more run was verified but not shown. With `PRIVATE_DOCS_TOKEN=abc` set,
the private config produces the beat 2 output and exit 1. The local server
ignores the header, so that run proves the fetch, not the authentication.

## Timing rules applied

- Typing 45 ms per character (spec: 35-70 ms). Cursor is a solid block, no blink.
- Output appears after the command's real measured latency, from three runs
  each. The runs took 563-591 ms for validate (including the fetch), 532-556 ms
  with the token unset, and 521-547 ms offline. See `latency` in `media/remotion/src/url/beats.ts`.
- Each beat holds for 3.6-5 s after its main output, so the caption can be
  read twice.
- Cuts between beats, no transitions.

## Exact commands, as typed in the video

```bash
cd media/scratch-url                 # its own git repo; server running on :8765
cat manni.config.yaml
manni meta validate
echo $?
# off camera: add `tokenEnv: PRIVATE_DOCS_TOKEN` under the sidecar entry
cat manni.config.yaml
manni meta validate
echo $?
manni meta validate --offline
echo $?
```

## Material

```
media/scratch-url/
  docs/{auth,billing,new,ops}.md     copied from test/fixtures/sidecars/docs/
  private.schema.json                copied from test/fixtures/sidecars/
  docs-meta.yaml                     auth: source + jira PLAT-412; billing: jira not-a-ticket; ops: jira PLAT-9
  manni.config.yaml                  sidecars[0].file = http://127.0.0.1:8765/docs-meta.yaml, keys [source, jira]
```

Served with `python -m http.server 8765 --bind 127.0.0.1` from that directory
for the duration of the captures, then stopped.

## Reproduce

```bash
npm run build
cd media/scratch-url && python -m http.server 8765 --bind 127.0.0.1 &   # then, from media/scratch-url:
node -r ../capture/tty.cjs ../../dist/cli.js meta validate > ../capture-url/validate.ans 2>&1
cd ../remotion
node scripts/captures-url.mjs
npx remotion render src/index.ts SidecarUrlDemo out/url/render.mp4
```
