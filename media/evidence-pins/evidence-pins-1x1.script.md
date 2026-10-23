# Demo beat sheet for a persona's pain pinned to its evidence (proposal 0108)

- **Type:** feature demo, terminal session. No narration; captions only
  (LinkedIn autoplays muted).
- **Audience:** Schema authors who keep personas and journeys as records, and
  docs engineers who pin claims with `manni cite`. Phone-sized, muted.
- **Target:** 40 s, five beats, one caption line each.
- **Objective:** the viewer sees a metadata value pinned like a sentence. A
  persona's first pain is pinned by JSON Pointer to a line of an interview
  note. The pin follows the value when the list reorders. It fails the run
  when the note stops saying what the pain claims.
- **Assets:** `media/evidence-pins/evidence-pins-1x1.mp4` (not committed),
  `.thumb.png`, `.vtt`, `.srt`, `.transcript.txt`, `.post.txt`, this file, and
  the capture sources beside it. In `media/remotion/`, the files are
  `src/evidence-pins/`, `scripts/{captures,vtt,transcript}-evidence-pins.*` and
  the `EvidencePinsDemo` composition in `src/Root.tsx`. No GIF and no
  storyboard. The brief asked for neither, and one shot type, a terminal,
  needs no plan beyond this table.
- **Look:** `docs/content-strategy/design.md`. 1080×1080, 30 fps, title band
  112 px with an `n / 5` counter, caption band 86 px, accent `#58a6ff` blue.
  Never red, green, yellow or cyan. The frame already holds a green `✓`, a red
  `✗`, a cyan pin id, and the red and green lines of each diff.
- **Material.** `test/fixtures/strategy/evidence/`, staged by `capture.sh` into
  `media/scratch-evidence-pins/` (gitignored by `media/scratch-*/`). The
  scratch copy is its own git repository with one baseline commit, so cite
  pins the commit. It holds the persona `theo` with two pains, the audience
  `contributors`, one page, the persona schema, and one interview note. The
  script lists each change it makes to the fixture input. Everything shown is
  real execution.

| # | Time | Title band | Caption band | Typed | On screen |
|---|---|---|---|---|---|
| 1 | 0:00–0:04 | A persona's pains | A persona makes claims. What do they rest on? | `cat records/personas/theo.md` | the frontmatter, with `pains:` and its first item marked |
| 2 | 0:04–0:12 | manni cite add | Pin the first pain to line 3 of an interview note. | `manni cite add records/personas/theo.md#/pains/0 research/contributor.md:3 --id terse-messages` | `added terse-messages to records/personas/theo.citations.yaml:3 (claim at /pains/0, sha256-…` and the quoted note line |
| 3 | 0:12–0:17 | manni cite check | The pain and its evidence both read current. | `manni cite check records/personas/theo.md` | green `✓ terse-messages   #/pains/0 current   research/contributor.md:3 current`; the green summary |
| 4 | 0:17–0:29 | The pains reorder | The pin follows the moved value. update rewrites it. | `git diff -U1 records/personas/theo.md`, then `manni cite check`, then `manni cite update` | the two pains swap; `#/pains/0 moved -> #/pains/1` under a dim `ℹ`, the `claim-moved` notice and exit 0; `claim #/pains/0 -> #/pains/1 (moved)` |
| 5 | 0:29–0:40 | The evidence changes | The evidence changed, so the check fails. Exit 1. | `git diff research/contributor.md`, then `manni cite check`, then `echo $?` | line 3 of the note now says the error said how to fix it; red `✗` and `changed since <sha>, 0 commits`; `source-changed`; the red summary; `1` |

Exact cue times are in `evidence-pins-1x1.vtt`, generated from the beats the
composition renders.

## Why this story

A persona is a set of claims, and until now its structured claims had no
pin. Beat 1 asks the question over the record itself. Beat 2 answers it with
one command, and the output names the pointer, the hash and the quoted note
line. Beat 3 is the steady state, with both ends current. Beat 4 shows that
the pin follows the value and not its position. The pains swap, the check
reads `moved` as a notice and still passes, and `update` rewrites the
pointer. Beat 5 is the payoff for CI. The note no longer backs the pain, and
the run exits 1 with `source-changed`.

## Capture notes

- **The CLI is this branch's build,** `node dist/cli.js`, typed as `manni`.
  Its `--version` prints 4.20.0, the published version. semantic-release
  bumps it when the feature ships, so no version is claimed on screen.
- **One trim to the fixture.** The note moves from
  `research/notes/2026-09-12-contributor.md` to `research/contributor.md`. Its
  heading still carries the date. The fixture's longer path wrapped every pin
  row at a legible size. The fixture's `cite.repos` entry goes unused, since
  the scratch copy is one repository and the note is cited by its path there.
- **The edits are files beside the script.** `theo.reordered.md` is the
  fixture's persona with its two pains swapped. `note.edited.md` is the
  fixture's note with line 3 rewritten. Each is copied in before its diff.
- **Colour.** `media/capture/tty.cjs` tells the CLI it writes to a terminal.
  `git diff` gets `-c color.ui=always` for the same reason.
- **The edits are uncommitted,** so cite reports `changed since <sha>, 0
  commits`. The sha is the scratch repository's one commit. It changes on
  every capture.
- **Latency is replayed at 1x,** as `latency.txt` measured it. Each command
  took under 0.7 s, so nothing is compressed.
- **Typing at 35 ms,** the floor of design.md's range. The `cite add` line is
  92 characters.
- **Font size is derived per beat, not chosen** (`node evidence-pins/cols.mjs`
  from `media/`). Beat 1 takes 27 px, the largest at which no frontmatter
  line wraps. Beat 2 takes 29 px and beat 3 takes 26 px. Beat 4 takes 19 px /
  91 columns. Its moved pin row is 87 characters, and every larger size
  leaves one word alone on a row. Beat 5 takes 23 px.
- **Ligatures off.** The record's `---` fences and the diff's `---` header
  would draw as one rule.

## How to rebuild it

```bash
# from the repo root
npm run build
bash media/evidence-pins/capture.sh          # stages media/scratch-evidence-pins, captures every byte
cd media && node evidence-pins/cols.mjs      # re-derive the font sizes, per beat

cd remotion
npm ci
node scripts/captures-evidence-pins.mjs      # captures -> src/evidence-pins/captures.json
npx remotion render EvidencePinsDemo ../evidence-pins/raw.mp4
# the render has no audio stream; design.md's container carries AAC 48 kHz, so add a silent one
ffmpeg -i ../evidence-pins/raw.mp4 -f lavfi -i anullsrc=r=48000:cl=stereo -c:v copy -c:a aac \
  -shortest -movflags +faststart ../evidence-pins/evidence-pins-1x1.mp4 && rm ../evidence-pins/raw.mp4
npx remotion still EvidencePinsDemo ../evidence-pins/evidence-pins-1x1.thumb.png --frame=873

# timings for the sidecars come from the same beats the composition uses
npx tsc --ignoreConfig src/evidence-pins/beats.ts src/beats.ts --outDir scripts/out-evidence-pins \
  --module commonjs --target ES2022 --resolveJsonModule --esModuleInterop --skipLibCheck
cd scripts && node vtt-evidence-pins.cjs && node transcript-evidence-pins.cjs
```

Thumbnail (`.thumb.png`): frame 873, the end of beat 4. The swapped pains,
the moved pointer and the rewrite are all in view. That is the feature in one
frame.

## Checks before shipping (design.md)

1. Longest lines measured per beat by `cols.mjs`, and checked in rendered
   stills of every beat.
2. No text touches the frame edge, and no token is split.
3. Captions on every beat, one line each, burned in and in the `.vtt` and
   `.srt`.
4. `ffprobe`: 1080×1080, 30 fps, h264 yuv420p, AAC 48 kHz, 39.97 s.
5. The audio track is silent by construction (`anullsrc`). There is no
   narration, so no loudness pass.
6. Accent `#58a6ff`, blue.

## Suggested LinkedIn caption

Also in `evidence-pins-1x1.post.txt`. Post it only after the release that
ships the feature, since the install line needs it. Do not post; hand it
over.

```text
A persona says error messages are terse. Says who?

New in manni, a citation's claim can be a metadata value.

On a persona, audience or journey record, manni cite add pins a value to the evidence it rests on. A JSON Pointer names the value, as in theo.md#/pains/0.

Here the first pain is pinned to a line of an interview note. The pains then swap places. The check says the value moved to #/pains/1, and cite update rewrites the pointer.

Then someone edits the note. The check fails with source-changed and exits 1, so the claim gets looked at again.

Pages that are not records behave exactly as before.

Real output from a real test fixture. Only the input is staged.

npm i -g @hawkeyexl/manni · manni cite add
```
