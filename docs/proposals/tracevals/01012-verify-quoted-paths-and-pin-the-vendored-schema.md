---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
---

# Verify repo paths quoted in the docs, and pin the vendored schema's bytes

## Context and Problem Statement

An audit found two pieces of documentation that had been confidently wrong since
[ADR 01010](01010-adopt-the-docmeta-artifact-evals-vocabulary.md) landed, and neither was catchable
by anything:

- [docs/src/content/docs/reference/api.mdx](../docs/src/content/docs/reference/api.mdx) listed
  `moose-tracevals/schemas/artifact-evals-0.1.json` as a package subpath, described as "the previous
  version, for pinned consumers". That schema file was **deleted** by the 01010 change, and
  `package.json` had never exported it, so importing the specifier throws
  `ERR_PACKAGE_PATH_NOT_EXPORTED`. The row documented an entry point that could not have worked on
  any version, published or not.
- [docs/content_strategy/information_architecture/ia-gap-analysis.md](../docs/content_strategy/information_architecture/ia-gap-analysis.md)
  still named `schemas/artifact-evals-0.2.json` and `schemas/artifact-evals-0.1.json` as the source
  of truth for the `reference/evals-schema` page. It sent the next writer who opened the strategy to
  two files that no longer exist.

The gates check **links, not prose**. `npm run docs:check-strategy` covers anchors, orphans, CUJ
routes, relative links between strategy files, site-internal links, page frontmatter, and heading
anchors. That is seven sections, every one of them about something shaped like a link. Doc Detective
runs what is written as a command. A path or a package specifier quoted inside backticks was
invisible to both. Both errors survived the 01010 change, its review, and later edits to the same
files.

The same audit exposed the reciprocal hole on the schema itself. [CLAUDE.md](../CLAUDE.md) and ADR
01010 both require `schemas/artifact-evals-1.0.0-proposal.1.json` to stay byte-identical to docmeta's
draft and to be **re-synced rather than patched**. But
[test/unit/schema.test.ts](../test/unit/schema.test.ts) is a *behavior* ladder, with 13 accepts and
9 rejects. A reworded `description`, a reordered key, an added `$comment`, or a tightened `pattern`
no case exercises all pass it untouched. The invariant was written down twice and enforced nowhere.

## Decision Drivers

- Documentation that names a deleted file reads as authoritative, so it is worse than no
  documentation at all.
- [ADR 01007](01007-ship-a-cuj-first-documentation-site.md) already settled the principle that docs
  drift is caught mechanically rather than by review. These were holes in that principle, not
  exceptions to it.
- A "keep it byte-identical" rule with nothing checking it is a comment.
- Every docs gate must stay offline. The hermetic rule is not relaxed for tooling that only reads
  Markdown.
- **docmeta does not ship the schema.** Its `exports` is `"."` plus `"./package.json"` and its
  `files` is `["dist"]`, so there is no upstream copy on disk to diff against at test time. That
  holds at any version, in any install.

## Considered Options

For the quoted references:

- Extend `scripts/check-content-strategy.mjs` with a source-level path and subpath check
- Run a link checker over the rendered HTML
- Make Doc Detective assert the paths
- Do nothing and rely on review

For the vendored schema:

- Pin the file's SHA-256 in the unit suite
- Vendor docmeta as a git submodule and diff against it
- Fetch docmeta's draft in CI and diff
- Do nothing and rely on the written rule

## Decision Outcome

The chosen option is **a new section 8 in
[scripts/check-content-strategy.mjs](../scripts/check-content-strategy.mjs).** It resolves every
repo path and package subpath quoted in the docs. It comes with **a SHA-256 pin on the vendored
schema in [test/unit/schema.test.ts](../test/unit/schema.test.ts).**

### 1. Quoted paths and subpaths must resolve

Section 8 scans every `.md` under `docs/content_strategy/` and every `.md`/`.mdx` under
`docs/src/content/docs/`, and classifies each backticked span:

| Span | Assertion |
|---|---|
| Starts with `moose-tracevals/` | Rewritten to `./…` and required to be a key of `package.json`'s `exports` |
| Starts with `src/`, `test/`, `docs/`, `schemas/`, `adrs/`, `scripts/`, `.github/`, or `.husky/` | Required to exist on disk |
| Anything else | Ignored |

The top-level-directory prefix list is what makes this tractable. Prose is full of backticked
identifiers, such as flags, config keys, grader names, and type names. Only a span that begins at a
real repository root directory is treated as a claim about the filesystem.

Three refinements keep it accurate rather than merely loud:

- A **line citation** is stripped before the check: `src/cli.ts:42` and `src/cli.ts:42:7` are tested
  as `src/cli.ts`, so pointing at a line still resolves.
- A span containing `*`, `<`, `>`, `{`, or `}` is a **glob or a placeholder**, a shape rather than a
  file, and is skipped.
- `PATH_EXAMPLES` allowlists paths that look like citations but are deliberately illustrative. It
  holds exactly one entry, `src/app.ts`, used in the `file-access` suffix-matching passage of
  [reference/graders.mdx](../docs/src/content/docs/reference/graders.mdx) itself. A real
  repository path there would imply the rule was about that particular file. **Every entry in that
  set is a place the gate is blind.** That is why it is kept to the minimum, and why the source
  says so above the declaration.

The subpath half is the sharper one. `exports` is the sole authority on what is importable, so
checking documented specifiers against it tests exactly what a reader copying the string would hit.
That includes the reverse drift, where an export is dropped while a page still advertises it.

### 2. The vendored schema's bytes are pinned

`test/unit/schema.test.ts` gains a `vendored schema identity` block asserting that
`sha256(schemas/artifact-evals-1.0.0-proposal.1.json)` equals a constant, with a failure message that
names the two possible causes and their two different remedies. A deliberate re-sync **updates the
constant**. A local patch gets **reverted**, because the shape belongs upstream.

Updating the constant is the point rather than a chore. It is a one-line edit that cannot happen by
accident, and that reads in a diff as *the vendored vocabulary changed*. That is precisely the event
ADR 01010 said must stay visible, and the one the `-proposal.1` prerelease suffix exists to
advertise.

A digest is not a diff. It cannot say the file matches docmeta's *current* draft, only that it
matches what this repo was verified against. Given that docmeta ships no copy to compare with, that
is the available substitute. The alternatives that would give a real comparison each cost more
than the property is worth while the vocabulary is still a proposal.

### Consequences

- Good, because both audit findings now fail a gate instead of surviving review, and so does the
  next one of their kind.
- Good, because section 8 adds no dependency, no network call, and no CI step. It runs inside the
  script the docs workflow already invokes, and reports in the same format.
- Good, because it reads **source, not rendered HTML**. It therefore covers `docs/content_strategy/`,
  which is internal and never built into the site, and where one of the two findings lived.
- Good, because the pin makes an invariant that existed only in prose fail loudly. It turns a
  re-sync into a recorded act rather than an undetectable one.
- Bad, because coverage stops at the docs tree. `README.md`, `CLAUDE.md`, and the ADRs themselves
  quote repo paths and are not scanned. For the ADRs this is deliberate. They are dated records
  that should name files as they were, and rewriting history to keep a gate green would be the wrong
  fix. `README.md` and `CLAUDE.md` are simply uncovered.
- Bad, because only backticked spans count. A path written as bare prose is invisible, and the gate
  reports a lower count rather than a failure.
- Bad, because `PATH_EXAMPLES` is an unfalsifiable escape hatch by construction: an entry silences
  the gate for that string forever. One entry today, and nothing but the comment above it keeps the
  list short.
- Bad, because the SHA pin goes red on every legitimate re-sync and someone must update it by hand.
  That is accepted, because the cost is one line and the red is the notification.
- Bad, because the pin proves nothing about docmeta. Both repos can drift apart with every check
  green. It detects *change here*, never *divergence from there*.

### Confirmation

- `npm run docs:check-strategy` runs section 8 of
  [scripts/check-content-strategy.mjs](../scripts/check-content-strategy.mjs), on every PR through
  [docs.yml](../.github/workflows/docs.yml), which gates the Pages deploy. It was verified **red
  before the fixes**, reporting `moose-tracevals/schemas/artifact-evals-0.1.json` as undeclared in
  `exports` from `reference/api.mdx`, and both deleted `schemas/artifact-evals-0.*.json` paths from
  `ia-gap-analysis.md`. It is green after.
- [test/unit/schema.test.ts](../test/unit/schema.test.ts), the `vendored schema identity` block, run
  by `npm test` on both OS legs of [ci.yml](../.github/workflows/ci.yml). Verified to **fail when the
  schema file changes** and pass when it is restored.

## Pros and Cons of the Options

### Section 8 in `check-content-strategy.mjs` (chosen)

- Good, because it reuses an existing script, its reporting format, and its existing workflow slot.
- Good, because reading source is what lets it see the internal strategy files at all.
- Good, because the subpath check compares against `exports`, the real resolution authority, rather
  than against a guess about what is published.
- Bad, because it is bespoke matching over backticks and will miss any citation phrased differently.

### A link checker over the rendered HTML

- Good, because it is off-the-shelf and maintained by someone else.
- Bad, because a repo path in prose is not a link, so there is nothing to crawl. The `api.mdx`
  finding was a literal string in a table cell.
- Bad, because it cannot see `docs/content_strategy/`, which is never rendered.
- Bad, because most link checkers want to fetch, and the hermetic rule forbids it.

### Make Doc Detective assert the paths

- Good, because the docs already run every documented command against the real build.
- Bad, because Doc Detective asserts what a documented **procedure** does. Turning a prose citation
  into a procedure means adding a step to the page that exists for the gate, not the reader.
- Bad, because it needs a built `dist/` and the linked bin. A typo'd path should fail in seconds, in
  the check that already reads these files.

### Do nothing, rely on review

- Good, because it costs nothing.
- Bad, because it is the option that just failed. Both errors passed through the change that created
  them and every review since.

### SHA-256 pin (chosen)

- Good, because it is offline, dependency-free, instant, and exact.
- Good, because the remedy is encoded in the failure message, so the next person meets the ADR 01010
  rule at the moment it applies.
- Bad, because it detects change rather than divergence, and cannot distinguish "we drifted" from
  "we deliberately re-synced" without a human reading the diff.

### docmeta as a git submodule

- Good, because it would give a real diff against upstream.
- Bad, because it reintroduces the sibling-checkout tax that moving to `@hawkeyexl/inference`
  deliberately paid off ([ADR 01006](01006-take-inference-from-the-shared-library-not-docevals.md)).
  A clean clone plus `npm install` would stop being the entire setup, and every worktree would need
  wiring again.
- Bad, because a submodule is itself pinned to one revision. That is the same "matches what we
  verified" property as a digest, at far higher cost.

### Fetch docmeta's draft in CI and diff

- Good, because it is the only option that detects genuine upstream divergence.
- Bad, because it reaches the network from a suite that must be hermetic.
- Bad, because the draft is a proposal under active review. It is *expected* to move, and an upstream
  edit turning an unrelated PR red trains people to ignore the check. Worth revisiting as a
  scheduled, non-blocking job once the vocabulary is registered and stable.
