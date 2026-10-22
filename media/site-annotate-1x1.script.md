# Demo beat sheet for `manni site annotate` (proposal 0095)

- **Type:** feature demo, a terminal session and one browser frame. No
  narration; captions only (LinkedIn autoplays muted).
- **Audience.** Docs engineers who pin sentences to code with `manni cite`,
  and whose readers never see it. Phone-sized, muted.
- **Target:** 32 s, four beats, one caption each.
- **Objective:** the viewer sees a built page gain proof as data, with no
  visible change. Then three lines of CSS turn that data into marks.
- **Status.** Script only. Nothing is recorded or rendered yet.
- **Assets, once made:** `media/site-annotate-1x1.mp4` (not committed),
  `.gif`, `.thumb.png`, `.vtt`, `.transcript.txt`, `.post.txt`, this file and
  `media/capture-site-annotate/`.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 4` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. manni's own output uses all four, and
  beat 4's marks are green and red on purpose.
- **Material.** The test fixture, `test/site/fixtures/annotate/`, copied to
  `media/scratch-site-annotate/` (gitignored), so the demo is what CI runs. It
  is a Starlight-shaped built site with a stamped page and the chunk artifact
  `manni graph publish` wrote for it.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:07 | The proof stops at CI | This paragraph is pinned to code. The built page cannot tell. | `grep -n 'drifted claim' site/dist/guide/index.html` | `<p data-manni-src="src/content/docs/guide.md:6-6">A drifted claim reads here &amp; nowhere else.</p>`, the rehype plugin's line stamp and nothing else |
| 2 | 0:07–0:15 | One command after the build | Annotate joins each pin to the block it describes. | `manni site annotate` | `manni: Starlight in site/. Annotating site/dist from graph/chunks.json.` then `site/dist: 2 pages annotated. 5 of 8 pins placed, 3 listed on their page only. 2 blocks carry a verification.`; exit `0` |
| 3 | 0:15–0:23 | Data, not decoration | The block now names its pins and their state. The stamp is gone. | `grep -n 'drifted claim' site/dist/guide/index.html` | `<p data-manni-node="…/guide.md" data-manni-pins="drifts" data-manni-state="drifted">A drifted claim…</p>` |
| 4 | 0:23–0:32 | Your theme draws the marks | Three lines of CSS. No manni code in the browser. | `cat marks.css`, then cut to the browser | the three rules from the annotate page; then the guide page with ✓ after the current paragraphs and ✗ after the drifted one |

## Why this story

The feature is a join. Beat 1 shows the gap in one line: the build knows the
source lines, and nothing else on the page says the sentence is proven.
Beat 2 is the one command, with the counts that say how much it placed.
Beat 3 is the payoff a theme author cares about, the same `<p>` carrying its
pins as attributes. Beat 4 shows why data beats marks: the look is three lines
of the site's own CSS.

## Capture commands

Run from the repo root on this branch.

```bash
npm run build
rm -rf media/scratch-site-annotate
cp -r test/site/fixtures/annotate media/scratch-site-annotate
cd media/scratch-site-annotate
mkdir .git    # stops config discovery here
cat > marks.css <<'EOF'
[data-manni-state="current"]::after { content: " ✓"; color: #3fb950; }
[data-manni-state="drifted"]::after { content: " ✗"; color: #f85149; }
[data-manni-verified]::before { content: "Verified " attr(data-manni-verified) " · "; }
EOF

grep -n 'drifted claim' site/dist/guide/index.html
manni site annotate
grep -n 'drifted claim' site/dist/guide/index.html
cat marks.css
```

`manni` is this branch's `node dist/cli.js`, linked the way
`.github/workflows/docs-as-tests.yml` links it. For beat 4's browser frame,
add `<link rel="stylesheet" href="/marks.css">` to a copy of
`site/dist/guide/index.html`, serve the folder with
`npx serve media/scratch-site-annotate`, and screenshot the page at 1080 px.
The frame shows the page as a reader sees it, so crop the browser chrome.

## Captions (`.vtt` source)

```text
00:00.000 --> 00:07.000
This paragraph is pinned to code. The built page cannot tell.

00:07.000 --> 00:15.000
Annotate joins each pin to the block it describes.

00:15.000 --> 00:23.000
The block now names its pins and their state. The stamp is gone.

00:23.000 --> 00:32.000
Three lines of CSS. No manni code in the browser.
```

## Checks before shipping (design.md)

1. Longest line measured at the chosen font size, so no line wraps. Beat 3's
   `<p>` is long; crop the node IRI to `…/guide.md`.
2. No text touches the frame edge.
3. Captions on every beat, burned in and in the `.vtt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p.
5. Accent `#58a6ff`, blue. The green and red in beat 4 are the marks
   themselves, not chrome.

## Suggested LinkedIn caption

Your docs pin sentences to code, and CI proves them. Your readers never see
it. `manni site annotate` joins each pin to the paragraph it describes, as
data attributes on the built page. Three lines of CSS show the proof.

Do not post; hand over.
