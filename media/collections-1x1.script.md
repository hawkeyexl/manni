# Video script: `collections:`, the family-level home for document sets

- **Feature:** `collections:` at the top level of the config (proposal 0041).
  A repository declares its document sets once, and every tool in the family reads the same
  declaration.
- **Format:** 1080x1080, 30 fps, **37.90 s**, MP4 (H.264, yuv420p, silent AAC).
- **Assets:** `media/collections-1x1.mp4`, `.gif`, `.thumb.png`, `.vtt`,
  `.transcript.txt`.
- **Spec followed:** `docs/content-strategy/design.md`.
- **Accent:** `#58a6ff` blue, the palette value. It is not red, green, yellow
  or cyan, because manni's own output uses all four in this very frame.
  `meta validate` and `a11y check` print a green `✓` and green summaries, and
  the a11y report prints cyan URLs.

## Story variant

The brief offered two shapes for the payoff. This is the **two-tool** one:
`manni meta validate` checks the collection's *files* and
`manni a11y check --collection guides` crawls the *site those files are
published at*, both from one declaration and one `url:`. It fits: 37.90 s of a
45 s ceiling.

It is the better of the two because the argument for the feature is that a
document set is nobody's property. A metadata-only variant (`--collection` plus
`SELECT … FROM guides`) demonstrates narrowing, which is a smaller claim. It
shows one tool and one config key, and gives no reason the key had to move to
the top level. Here
the two commands print two different *kinds* of thing, file paths and URLs, off
the same six lines of YAML. That contrast is the feature.

## How it was made, and what is staged

A Remotion replay of real captures, the same pipeline the three sidecar videos
used (`media/remotion`, composition `CollectionsDemo`). Every terminal line in
the frame is bytes captured from `node dist/cli.js` run in
`media/scratch-collections/`. The preload `media/capture/tty.cjs` makes the CLI
believe stdout is a terminal, so its colour is the colour a user sees. Nothing
is retyped, reflowed or recoloured; the replay adds only the typing animation,
the bands and the wrap.

Staged, and disclosed:

- The corpus is purpose-built: two guides, a two-page static site, a house
  schema. It is not a fixture, because no fixture carries both a `paths:` glob
  and a live `url:`.
- The site is served by `media/scratch-collections/serve.mjs` on
  `127.0.0.1:4321`. The crawl in beat 5 is a real Chromium/axe-core run against
  it, not a recording of the deployed docs.
- The site is clean, so the a11y beat ends at `0 violations`. That is a
  staging choice about the *input*. An axe finding carries a
  `dequeuniversity.com` help URL 79 characters long. It cannot be wrapped at a
  space, so it would have forced the whole video down to 20 px type. The beat
  is about where the seeds came from, and three page URLs prove that in three
  rows.
- Beat 5 types `--no-progress`. It is on screen because it was run; progress
  bars would otherwise print to stderr and land in the capture.

## Derived font size

`media/capture-collections/cols.mjs` runs the composition's own space-only wrap
over every real line at each candidate size. Its algorithm is copied from
`Demo.tsx` `wrapLine`, so the derivation and the render agree.

Longest line: **223 chars**, the refusal. Longest unbreakable token: **75
chars**, `https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections`.
That token is the whole constraint. At 24 px (72 columns) it hard-breaks
mid-URL, which reads as a broken renderer.

| px | cols | hard breaks | tallest beat |
|---|---|---|---|
| 24 | 72 | **1** | 646 px |
| 23 | 75 | 0 | 544 px |
| **22** | **78** | 0 | **527 px** |

23 px is the largest size that never splits a token, and was rendered first. It
puts the 75-character URL row's highlight within 15 px of the frame edge, which
reads as full-bleed. 22 px costs 4 % of glyph height and buys 60 px of right
margin, so **22 px / 78 columns / 31 px line height** ships. The tallest beat is
527 px in an 878 px terminal area.

## Beats

Five beats, two chains. Beats 1–2 share a screen; beats 4–5 share a screen, so
the payoff shows both tools' output at once.

<!-- The Title and Caption cells are burned into the rendered video, so they stay as shown. -->
<!-- vale Voices.ColonReveal = NO -->

| # | Title | Screen | Caption |
|---|---|---|---|
| 1 | One set, named twice | `cat manni.config.yaml` in the old shape | One document set, spelled twice: a glob under meta:, a URL under a11y:. Move the docs and one goes stale. |
| 2 | 0.3.0 refuses it | `manni meta validate`, `echo $?` → 2 | Exit 2, and the message names where the key went: a top-level collections: list. |
| 3 | Declared once | `cat manni.config.yaml` in the new shape | One collection: the paths, and the url those pages are published at. No tool owns it. |
| 4 | meta reads it | `manni meta validate` → 2 files, green | A bare validate checks the collection's files. Nothing typed on the command line. |
| 5 | a11y reads it too | `manni a11y check --collection guides --no-progress` → 3 pages | --collection guides seeds the crawl from that same url:. No URL typed, no second key. |

<!-- vale Voices.ColonReveal = YES -->

Beat 1 highlights the two lines that name the same document set. Beat 2
highlights the refusal. Beat 3 highlights `collections:` and the `url:`. Beat 4
highlights the two file paths, and beat 5 the three page URLs. They are the same
collection, seen by two tools as two different kinds of thing.

Durations: 5.50 / 9.50 / 6.70 / 5.73 / 10.47 s.

## Real output quoted

The refusal, in full and unedited:

```
manni: manni.config.yaml: "paths" is no longer a meta key. Document sets are
declared once for every tool, under a top-level collections: list. See
https://hawkeyexl.github.io/manni/meta/reference/configuration/#collections
```

(one logical line; the break is the composition's wrap, at spaces.)

## Timing rules applied

- Typing 45 ms/char, inside design.md's 35–70 ms.
- No speed-up anywhere. Nothing was compressed, so the 1.3x ceiling never
  applied.
- Latency measured, three runs each, and replayed at the measured value:

| Command | Runs | Replayed |
|---|---|---|
| `meta validate` (refused) | 543 / 568 / 569 ms | 0.55 s |
| `meta validate` (the collection) | 613 / 597 / 608 ms | 0.61 s |
| `a11y check --collection guides` | 2564 / 1620 / 1588 / 2531 ms | 2.00 s |

A cold Chromium launch costs about a second more than a warm one, so the a11y
figure is bimodal. 2.00 s is the middle of the four measured runs. Disclosed here
rather than trimmed.

## Exact commands, as typed in the video

```bash
cd media/scratch-collections          # its own git repo
cat manni.config.yaml                 # the old shape
manni meta validate
echo $?
cat manni.config.yaml                 # the new shape
manni meta validate
manni a11y check --collection guides --no-progress
```

## Material

```
media/scratch-collections/
  manni.config.yaml          the new shape: one collections: entry, paths + url
  manni.config.old.yaml      the old shape: meta.paths + a11y.urls
  guides/{install,auth}.md   two pages with title + description
  house.schema.json          requires a non-empty title and description
  site/{index,install,auth}.html   where the guides are published
  serve.mjs                  static server for site/ on 127.0.0.1:4321
```

## Reproduce

```bash
npm run build
cd media/scratch-collections
node serve.mjs &                       # the site the collection is published at
cp manni.config.old.yaml manni.config.yaml
cat manni.config.yaml > ../capture-collections/cat-config-old.txt
node -r ../capture/tty.cjs ../../dist/cli.js meta validate \
  > ../capture-collections/validate-refused.ans 2>&1
git checkout manni.config.yaml          # back to the new shape
cat manni.config.yaml > ../capture-collections/cat-config-new.txt
node -r ../capture/tty.cjs ../../dist/cli.js meta validate \
  > ../capture-collections/validate.ans 2>&1
node -r ../capture/tty.cjs ../../dist/cli.js a11y check --collection guides \
  --no-progress > ../capture-collections/a11y.ans 2>&1
cd ../remotion
node scripts/captures-collections.mjs
node ../capture-collections/cols.mjs    # re-derive the font size
npx remotion render src/index.ts CollectionsDemo out/collections/render.mp4
cd .. && ffmpeg -i remotion/out/collections/render.mp4 -f lavfi \
  -i anullsrc=r=48000:cl=stereo -shortest -c:v copy -c:a aac collections-1x1.mp4
```

## Checks before shipping (design.md)

1. Longest real line measured against the chosen size, column count read from
   the wrap the composition actually runs. ✔ (`cols.mjs`, 78 columns, 0 hard
   breaks)
2. No text touching the frame edge; no token split across a line break. ✔
3. Captions present on every beat. ✔ (5 of 5)
4. `ffprobe` confirms 1080x1080 and the duration. ✔ (1080x1080, 30/1, 37.90 s)
5. Loudness measured on the finished file. **N/A** for a silent video. The
   AAC track is `anullsrc`, present only so every player accepts the file. A
   `loudnorm` pass on silence would be meaningless.
6. Accent is not red, green, yellow or cyan. ✔ (`#58a6ff`)
