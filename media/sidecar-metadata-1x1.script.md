# Video script: Sidecar metadata

**Objective:** Show that a private YAML manifest can supply frontmatter keys for
public pages, so private values are validated against public docs without ever
appearing in the public repo.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** target 36-40 s (spec: 20-45 s).
**Audience:** docs engineers and CI engineers who keep a public docset next to a
private one (personas Maya and Devin, CUJs M2 / D1).
**Material:** `test/fixtures/sidecars/`, run from inside that directory. Every
line of output is a real run of `node dist/cli.js` on this branch; the typed
command reads `manni` through a shim on PATH that execs the built CLI.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue; never
red, green, yellow or cyan, which the CLI's own output uses). Terminal
`#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band 112 px, 2 px
accent rules, caption band 86 px.

**Derived font size:** the longest real line is 108 characters (the
`docs/ops.md` finding). At 1080 px wide with 20 px insets, JetBrains Mono at
16 px (9.6 px advance) fits 108 characters in 1037 px. 17 px does not (1101 px).
So the terminal is set at 16 px for the whole video, and no line wraps.

## Beats

| # | Title (band) | Terminal | Caption (band) | Length |
|---|---|---|---|---|
| 1 | A public page | `cat docs/auth.md` | The public page carries a title and nothing else. Its ticket and source file must not ship with it. | 6.5 s |
| 2 | The sidecar | `cat docs-meta.yaml` then `cat manni.config.yaml` | A private manifest supplies source and jira per page. Two lines of config declare which keys it owns. | 10 s |
| 3 | validate sees one object | `manni meta validate` then `echo $?` | auth passes on the merged values. billing's bad ticket is reported at docs-meta.yaml:6, not in the page. | 11.5 s |
| 4 | The page stays clean | `manni meta query "UPDATE docs SET jira = 'PLAT-1' WHERE _path = 'docs/auth.md'"` | query refuses to write a sidecar-owned key into the public file. | 9 s |
| 5 | Exit codes for CI | `echo $?` (same screen as beat 4) | 1 for findings, 2 for the refusal. Nothing private reaches the public repo. | 5 s |

Beats 1-4 each start on a cleared terminal (no scrollback noise). Beat 5
continues beat 4's screen because `$?` refers to the command above it.

## Real output quoted

Beat 3, `manni meta validate` (exit 1):

```
Using manni.config.yaml (.)
✓ docs/auth.md
✗ docs/billing.md
    /jira  must match pattern "^PLAT-[0-9]+$"  (docs-meta.yaml:6)  [./private.schema.json]
✗ docs/new.md
    (root)  must have required property 'jira'  (line 1)  [./private.schema.json]
✗ docs/ops.md
    /jira  "jira" is owned by sidecar docs-meta.yaml; remove it from the document  (line 3)  [sidecar:owned]

4 files checked, 1 passed, 3 failed, 3 errors
```

Beat 4, the refusal (exit 2; `docs/auth.md` is untouched afterwards):

```
Using manni.config.yaml (.)
manni: "docs/auth.md": "jira" is owned by sidecar docs-meta.yaml; edit the sidecar file instead.
```

`--dry-run` is omitted on purpose: the refusal happens before any write, the
exit code is 2 either way, and the shorter line is the honest one.

## Timing rules applied

- Typing 45 ms per character (spec: 35-70 ms). Cursor is a solid block, no blink.
- Output appears after the command's real measured latency (see the
  `latency` constants in `media/remotion/src/Demo.tsx`), never sooner.
- Each beat holds for 4-8 s after its output, so the caption can be read twice.
- Cuts between beats, no transitions.

## Exact commands, as typed in the video

```bash
cd test/fixtures/sidecars
cat docs/auth.md
cat docs-meta.yaml
cat manni.config.yaml
manni meta validate
echo $?
manni meta query "UPDATE docs SET jira = 'PLAT-1' WHERE _path = 'docs/auth.md'"
echo $?
```
