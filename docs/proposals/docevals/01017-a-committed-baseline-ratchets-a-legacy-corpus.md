---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
---

# A committed baseline ratchets a legacy corpus

## Context and Problem Statement

There is no baseline, no waiver, and no accepted-failure record anywhere in
`src/`. Grepping the whole tree for one returns nothing.

The only lever for adopting moose-docevals on a corpus that already fails is
severity. `src/core/engine.ts:439` computes
`const hasError = own.some((f) => f.severity === "error")` and sets the outcome
from it on the next lines; `src/types.ts:35` states the rule as a comment,
"Only `error` affects exit codes." An eval set to `warning` therefore reports
everywhere and blocks nowhere.

That is one dial, and its two positions are *gate the whole corpus* and *gate
nothing*. A team with 500 pages and 300 pre-existing findings can fix all 300
before turning the check on. The alternative is turning it down to `warning` and
losing the gate's meaning. There is no third position.

`docs/src/content/docs/adopt/retrofit-a-legacy-corpus.mdx` documents the second
as *the* answer, at line 17: "Keep the assertions honest. Lower the **severity**
instead." It is right to, because it is the only answer the tool has. But
read what the journey behind that page is called.
`docs/content-strategy/journeys/cuj-retrofit-corpus.md` is titled "Get a legacy
corpus onto a ratchet without a wall of red". Its `success_criteria` are
"One section is gated at error severity, the rest reports at warning."
**The journey is named for a ratchet the tool cannot do.** What the page
actually describes is a manual severity migration, section by section, that
depends on somebody scheduling the burndown. Iris
(`docs/content-strategy/personas/iris-retrofitter.md`) inherits a corpus she did
not write. The page tells her to plan a quarter of cleanup before anything can
hold.

The missing mechanism is small. Record today's findings, and fail only on *new*
ones. That is what lets a standard tighten on a Monday instead of after a
cleanup nobody staffs.

docmeta already has it: `.docmeta-baseline.json`, `--baseline` /
`--no-baseline` / `--write-baseline`, and a `baseline:` config key
(`node_modules/docmeta/dist/index.d.ts:379`, `:546`, `:551`; the source is
`src/core/baseline.ts` in `hawkeyexl/docmeta`, shipped compiled at the 4.12.0
this repo already depends on). And `moose.config.yaml` is a shared family config
([ADR 01008](01008-rename-to-moose-docevals-and-share-one-family-config.md)).
Two tools writing into one file should not spell the same idea two ways.

## Decision Drivers

- **A ratchet is not the same knob as severity.** Severity says how much a
  *class* of finding matters. A baseline says which *instances* were already
  there. Collapsing the two means the only way to forgive yesterday is to stop
  caring about tomorrow.
- **The forgiving direction is the dangerous one.** A baseline's failure mode is
  over-forgiveness, whether from a narrowed glob, a mistyped exclude, or a stale
  record. It is silent by construction, because its whole job is to make a red
  run green. Several choices below exist only to make that visible.
- **One family, one spelling.** A user who learned `--write-baseline` in docmeta
  should not have to learn a second vocabulary for the tool sharing its config
  file.
- **A committed artifact is read in diffs.** This file gets reviewed,
  hand-edited, and merge-conflicted. It has to be deterministic, sorted, and
  loud about corruption.
- **Prose has no JSON Pointer.** docmeta's fingerprint anchors on structured
  metadata. Ours cannot, and the design has to say plainly what that costs
  rather than inventing a fake anchor.

## Considered Options

1. **Port docmeta's baseline.**
2. **Per-finding waivers in page frontmatter.**
3. **A `since:` date, failing only on findings from pages changed after it.**
4. **Keep severity inversion as the only lever.**

## Decision Outcome

**Option 1 wins.** Port docmeta's design, and diverge only where prose forces
it.

**1. The file.** `.moose-docevals-baseline.json`, committed to the repo, shaped
`{ version, generatedWith, entries: { <file>: [<fingerprint>] } }`. Keys and
fingerprint lists are sorted on write, so a re-record produces a reviewable diff
rather than a reshuffle.

**2. The flags.** `--baseline [path]`, `--no-baseline`, `--write-baseline`, plus
a `baseline:` key under `$defs/docevalsConfig` in `src/core/config-schema.json`.
The config field comes first, per the "Adding a new knob" rule in
[CLAUDE.md](../CLAUDE.md#adding-a-new-knob). Setting `baseline:` implies
`--baseline` on every run; `--no-baseline` suppresses it for one.

**A bare `--write-baseline` records into the *configured* path, not the
default.** docmeta names this trap explicitly in `resolveBaselineRequest`. The
no-argument form falls through to `configured ?? DEFAULT_BASELINE_PATH`, never
straight to the default. Get it backwards and a repo that points `baseline:`
somewhere else records into a file nothing reads. Every run still fails, an
unreferenced file grows in the diff, and the ratchet does nothing at all while
looking like it works.

**3. Atomic writes, and a `removed` count reported on every re-record.**
docmeta's `diffBaselines` returns `{ added, removed }` against the previous file
and reports both. That count is the only thing that makes an accidentally
over-forgiving `--write-baseline` visible in a CI log. The fingerprints
themselves are opaque hashes, so a diff that drops 200 of them reads as noise
unless a number names it. For the write, reuse docmeta's exported
`writeFileAtomic` rather than adding a fourth copy of the same wrapper. The repo
already carries a standing rule against re-implementing what a shared library
owns.

**4. Null-prototype objects for the entries map.** `Object.create(null)`, in
build, parse, and serialize alike, as docmeta does in all three. `__proto__` is
the famous key, but the reachable one here is `toString`. It is a legal
filename. A plain object literal would hand back an inherited function for a
file with no entry, pass a truthiness guard, and then fail to iterate.

### Where ours must differ from docmeta's

docmeta fingerprints a violation over `schema + instancePath + keyword +
subject`, because it has a JSON Pointer into structured metadata. We grade prose and
have no such pointer.

Our stable parts are `evalName` and `ruleId`. `ruleId` already exists on
`Finding` (`src/types.ts:48`), and the exact accessor is already written:
`ruleIdFor(f) = f.ruleId ?? f.evalName` in `src/reporters/sarif.ts:48`. The
adapters populate it from each tool's own rule vocabulary, as in
`src/graders/tools/markdownlint.ts:70` (`MD013` and friends),
`src/graders/tools/vale.ts:69` (`issue.Check`),
`src/graders/tools/docmeta.ts:56` (`err.schema`),
`src/graders/tools/doc-structure-lint.ts:105` (`err.type`). It is genuinely
optional. `src/graders/tools/doc-detective.ts:231` leaves it `undefined` when
there is no report, so `ruleIdFor`'s `?? evalName` fallback is load-bearing
rather than defensive.

Three things are **deliberately excluded** from the fingerprint, for docmeta's
own reasons:

- **The line number.** Adding one line shifts every finding below it. A
  fingerprint that moved with it would present a pure reordering as a wall of
  new findings.
- **The message prose.** It is generated by markdownlint or Vale, not by us. An
  upstream reword would invalidate every consuming repo's baseline at once, and
  would present as "moose-docevals broke our build".
- **The file path.** It is already the entry key.

### Consequences

- **Identity lands at `(file, evalName, ruleId)`, per rule per file rather than
  per occurrence.** A file already baselined for three `MD013` violations will not
  fail when a fourth appears. This is not an oversight to fix later, because
  per-occurrence identity has no stable anchor in prose. The candidates are a
  text snippet, which churns on every edit, or an ordinal, which renumbers on
  every insertion. That is the line-number problem wearing a different hat. It is
  a real weakening of the gate in exchange for a baseline that survives ordinary
  editing. A reader deciding whether to adopt the ratchet needs it stated in
  those terms. The coarsest case is an eval whose findings carry no `ruleId` at
  all, where identity collapses to one fingerprint per file per eval.
- **Renaming an eval invalidates every fingerprint that used it.** The eval name
  is part of the identity, so the tool cannot tell it is the same check. That is
  correct and still surprising. The remedy is a re-record. The run that
  suddenly reports a page's whole backlog as fresh should be readable enough to
  reach that conclusion.
- **`adopt/retrofit-a-legacy-corpus.mdx` changes answer.** The ratchet becomes
  the headline. Severity inversion becomes the fallback for a finding class you
  never intend to fix. That is a smaller and more honest claim than the one the
  page makes today. `cuj-retrofit-corpus.md`'s steps change with it.
- **A baseline is a shared artifact, so path canonicalization is not a detail.**
  Its keys must name a file the same way from the repo root and from a
  subdirectory, and on both separators. Config discovery already walks up to the
  repository root
  ([ADR 01012](01012-config-discovery-walks-up-to-the-repository-root.md),
  `ancestorsOf` in `src/core/config.ts`). `LoadedConfig.configDir` exists so
  relative paths resolve against the config rather than the cwd. Canonicalize
  against that. Get it wrong and every baselined finding reads as new. That
  happens for exactly the subdirectory workflow config discovery exists to
  support.
- **It adds a file most repos will commit and rarely read.** That is maintenance
  surface for a record that is only accurate until the next edit.
  The `removed` count is what keeps it honest.
- **`generatedWith` is camelCase in a file**, which is in tension with
  [ADR 01010](01010-kebab-case-is-the-file-vocabulary.md). That decision's scope
  is the vocabulary people *write*: frontmatter, config eval definitions,
  config settings, and grader options. This file is machine-written on both
  ends, and matching docmeta's bytes is what lets one reader read both tools'
  baselines. Named here rather than left to be discovered, because it is the one
  place this file looks like a mistake. `version` is the escape hatch if that
  judgment turns out wrong.
- **The run report gains a baseline block.** `renderJson` serializes the whole
  `EngineReport` (`src/reporters/json.ts`), so anything added to `RunReport`
  (`src/types.ts:109`) is visible to every consumer of `--format json`.

### Confirmation

Tests in `test/unit/baseline.test.ts` assert:

- A fingerprint is **stable across a line shift and across a message rewording**,
  and **distinct across rule ids**. Those are the three properties the exclusions
  above exist to produce.
- A baselined finding is suppressed while a new finding in the same file still
  fails, so suppression is per-fingerprint and not per-file.
- The same baseline resolves identically **from the repo root and from a
  subdirectory**, with `\` and `/` both normalized.
- A hand-edited fingerprint that is not 16 lowercase hex characters is rejected
  loudly. The error **names the entry it came from** rather than the whole file.
- Re-recording after a narrowed glob reports what it `removed`.

The fixture corpus deliberately encodes both outcomes. `goTo.mdx` fails at error
severity and `concepts.md` reports at warning. A fixture-level baseline is
therefore also the end-to-end check the "Fixtures" rule in
[CLAUDE.md](../CLAUDE.md#fixtures-required) requires. The recorded run passes,
and an added finding still fails.

## Pros and Cons of the Options

### Option 1, port docmeta's baseline

- Good, because it separates "already there" from "doesn't matter". That is the
  distinction severity cannot express, and the reason the retrofit journey has no
  ratchet today.
- Good, because a user of the shared config file meets one vocabulary. Every
  hazard docmeta already found arrives already named: the configured-path trap,
  the `removed` count, and the prototype-pollution key.
- Neutral, because fingerprints are opaque in a review diff. That is the cost of
  a stable identity, and it is why the `added`/`removed` counts have to be
  reported rather than left to the reader.
- Bad, because identity is per rule per file rather than per occurrence, so a
  fourth `MD013` in an already-baselined file passes.
- Bad, because it adds a committed file that is stale the moment the corpus
  changes and that nobody reads until it misbehaves.

### Option 2, per-finding waivers in page frontmatter

- Good, because the waiver sits next to the thing it forgives, and needs no new
  file, flag, or config key.
- Bad, because it puts the backlog in the content. 300 findings means 300 page
  edits, and a permanent record of a temporary state in the files whose whole
  purpose is to be the documentation.
- Bad, because it hands a contributor a one-line way to silence a finding. It is
  in the same file they are already editing, in the same commit, past a reviewer
  who is reading the prose. A separate committed file makes the same act a visible,
  reviewable change to the gate.

### Option 3, a `since:` date

- Good, because it needs no per-finding identity at all, which sidesteps the
  entire fingerprint problem.
- Bad, because it tracks page edits rather than findings. Touching a typo on a
  legacy page re-arms every pre-existing finding on it, so the cheapest possible
  contribution becomes the most expensive one.
- Bad, because it forgives genuinely new findings on pages nobody has touched. An
  eval added after the date is not scored at all on the pages the date excused.

### Option 4, keep severity inversion as the only lever

- Good, because it is what ships today and costs nothing.
- Bad, because it is corpus-wide per eval and cannot ratchet. Nothing gets
  stricter over time on its own.
- Bad, because the eval turned down to `warning` stays a warning. The page
  promises a section-by-section climb back to `error`. The mechanism for it
  is a human remembering to do it, and the reliable outcome of that is a
  permanent warning.
