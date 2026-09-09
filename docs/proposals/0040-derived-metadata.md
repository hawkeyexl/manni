# 0040: derived metadata, evidence from git, CODEOWNERS and the forge

- **Status:** Implemented (#19)
- **Serves:** Maya · M1, M2 · Devin · D4 · Theo · T1
- **Depends on:** Three earlier proposals.
  - [0021](0021-frontmatter-as-a-database.md) is the query engine. The
    read-only `derived` table joins into the `docs` table it builds.
  - [0026](0026-corpus-checks-are-findings.md) settled that a computed fact
    about a file is reported as a finding on that file, rides the baseline,
    and lands on exit 1. It also settled that a corpus invariant is checked
    only on a config-corpus run, which is the rule this proposal must not
    inherit. Stress test 2 says why.
  - [0037](0037-sidecar-metadata.md) is the other channel beside the
    document. This proposal is deliberately not a sidecar. Decision 1 says
    why, and rule 4 keeps the two disjoint.
- **Relates to:** Four proposals this one touches without depending on them.
  - [0038](0038-sidecar-url-manifests.md) rejected `gh` and `glab` for a
    fetch manni can make itself. This proposal reaches for both, and decision
    7 says what is different.
  - [0039](0039-sidecar-join.md) deferred git history to a hint in the orphan
    error, citing shallow clones. Decision 9 answers the objection.
  - [0023](0023-metadata-vocabularies.md) round 9 put `created` and
    `last-updated` into stewardship and accepted the cost of a stamped date.
    This is the tooling that round pointed at.
  - [0014](0014-empty-input-is-not-success.md) is the reason a source that
    cannot answer is exit 2 rather than a skipped check.
- **Touches (planned):** `src/meta/core/derive/{types,git,codeowners,forge,cache}.ts` (new),
  `src/meta/core/{config,schema-registry}.ts`,
  `src/meta/reporters/{rule-id,derive}.ts`,
  `src/meta/commands/{derive,validate,get,query,fill}.ts`, `src/meta/cli.ts`,
  `src/meta/index.ts`,
  `reference/{configuration,cli,query,output-and-exit-codes,api}.mdx`,
  `set-up/derived-metadata.mdx`, `test/derive*.test.ts`,
  `test/fixtures/derive/`
- **Verdict:** Build a **derived** channel that never merges into what the
  schema sees. Config names the **managed** fields. `manni meta derive` stamps
  them from evidence, `validate` reports a stamp that disagrees with the
  evidence as a finding, and a source that cannot answer stops the run.

## Problem

The stewardship vocabulary was presented on LinkedIn on 2026-09-04. Batami
Gold's comment of 2026-09-05 asked for the thing the vocabulary does not
have:

> These make a lot of sense to me. Question about your metadata - do you
> have a built-in system that forces the updater to answer these questions?
>
> Like - whether git or another publishing tool - have the system ask
> questions at a check-in step: What version did you check this against?
> Did you validate the entire page? Are these values still correct?
>
> If it's an agent that's updating the page, it's a great way to make sure
> these always get updated. And if it's a human - well, humans get tired
> sometimes and need guardrails.

A schema can require the fields. It cannot make the values true. And of the
three questions, only the third has an answer the tool can check against
evidence. What version a page was verified against, and whether the whole
page was read, are facts only the updater holds. So this proposal is about
the third question, asked at check-in as a finding. It is also about writing
the answer down for the fields where evidence exists.

The stewardship page admits as much. Its design decisions say: "A hand-typed
`last-updated` goes stale quietly, and no JSON Schema can catch that.
Comparing the field against the repository's own history is a job for
tooling that can read both." Nothing in manni reads both today. The gap is
easy to reproduce:

```console
$ sed -i 's/Run the installer/Run the installer as root/' docs/install.md
$ manni meta validate docs/install.md
✓ docs/install.md
1 file checked, 1 passed, 0 failed, 0 errors
```

The body changed. `last-updated: 2026-08-20` did not. The run is green,
because the field is present and well-formed, which is all a schema can ask.
The same holds for `authors` after a colleague rewrites a section, for
`owner` after a CODEOWNERS reshuffle, and for `reviewed-by` after a review
nobody transcribed. Every one of those facts already exists somewhere the
tool could look. Git has the dates and the authors. CODEOWNERS has the
owner. The forge has the approvals. What is missing is the comparison, and a
way to write the answer down.

## Decision

Ten decisions, then the vocabulary, the config, the full interface, and the
output shapes.

1. **Evidence, not a value channel.** A sidecar merges values into the object
   the schema judges, and 0037 found seven merge sites to do it. A derived
   value never merges. The document stays the truth for validation. `derive`
   stamps managed fields into the document, and `validate` compares what is
   stamped against what the evidence says. So no extractor, validator or
   sidecar code changes.
2. **The commit that made the fact is the authority.** For a git-derived
   date, that commit is the one that added the path, or the one that last
   changed the body. If that commit also set the field, the value it set *is*
   the derived value. Otherwise the commit's author date is.
   This is what makes the comparison squash-proof. A squash commit carrying
   both the body edit and the stamp agrees with itself, whatever date the
   forge gave it.
3. **Body means everything outside the metadata block.** The split is
   `locateFrontmatter`, the same function the writers use. A frontmatter-only
   sweep is therefore not a body change, and a bulk stamp does not move
   `last-updated`. Non-fenced formats count any change as a body change. That
   covers HTML, XML, DITA, and the native reStructuredText and AsciiDoc
   headers. It is recorded as a limitation, with the follow-up through 0020's
   element ranges.
4. **Managed fields are derived and stamped; unmanaged fields are asserted by
   people.** `derive.fields` lists the managed ones, and only `derive` writes
   them. `query` refuses an `UPDATE` of a managed key at plan time, exit 2.
   `fill` skips a managed field with `skipReason: "managed"`, so the omission
   is visible. A key cannot be both sidecar-owned and managed. That is a
   config error, exit 2, because the two channels would disagree about where
   the value lives.
5. **Stale is a finding; unknown is not.** A managed field whose asserted
   value differs from a non-null derived value is `derived:stale`, exit 1. A
   null derived value is no finding. That covers no approval yet, an
   uncommitted file, and a path outside a repository. Lists compare as sets,
   so reordering `authors` is not drift.
6. **Never green by accident.** A requested source that cannot answer is
   exit 2 naming the cause and the fix, never a skipped check. Git missing,
   not a repository, or a shallow clone. `gh` or `glab` missing or not
   authenticated. A `derive.codeowners` path that does not exist. The message
   names the remedy, such as `fetch-depth: 0` or `gh auth login`. One absence
   is drawn on the other side of the line. A repository with no CODEOWNERS
   file has declared no owners, which is a fact. So `owner` derives null, and
   the source reports the search as a notice rather than a failure. The
   verification run found the first draft treating it as exit 2. That made a
   repository without the file unable to read the `derived` table at all. The
   deliberate opt-outs are `--no-derive` on `validate` and `--sources`
   narrowing. gitignore degrades open on purpose. This is the opposite, on
   purpose, for 0014's reason. A check that silently did not run is a green
   gate over nothing.
7. **The forge is reached through its CLI, chosen by the origin host.** 0038
   rejected `gh` and `glab` for fetching a URL that `fetch` reaches in one
   call. This is a different job. The facts live behind two vendors' auth
   stores and two API grammars, and the owner's direction is that the CLI is
   the trust boundary. `gh` is on every GitHub-hosted runner, and `glab` is
   one package install on GitLab's. manni never holds a token, never reads
   one, and never prints one.
8. **Git history is read in bulk.** One `git log --raw -M` walk per
   repository root, with no pathspec, so renames are followed from one
   process. One `git cat-file --batch -z` for the blobs the judge needs. The
   walk runs newest first and stops per file at the first body-changing
   commit. A run of 32 files or fewer uses the per-file `git log --follow
   --raw` form instead, because `--follow` forbids more than one pathspec.
   Both produce the same `FileHistory`, so the judge and its tests are
   shared.
9. **0039's shallow-clone objection is answered by decision 6.** 0039
   deferred git history as a hint because a shallow CI checkout has none.
   Here a shallow clone is detected with `git rev-parse
   --is-shallow-repository` and refused with the fix. It is not guessed
   around.
10. **Findings ride the existing identity.** The schema ref is
    `derived:stale`, the keyword `derived`, the instance path `/<field>`.
    The rule id is the ordinary join, `derived:stale/derived`, with no
    change to how rule ids are built. `derived` joins the reserved first
    segments beside `check` and `sidecar`. `FieldError.file` stays unset,
    because the document is where a managed value lives.

### The derivable vocabulary

Version one is fixed. Six fields, three sources.

| Field | Source | Derived value | Evidence string |
|---|---|---|---|
| `created` | git | The stamp set by the commit that added the path (rename-followed), if it set one. Otherwise that commit's author date as `YYYY-MM-DD` in the author's offset | `added in 7a0d424 (2026-08-26)` / `stamped in 7a0d424` |
| `last-updated` | git | The stamp set by the newest body-changing commit if it set one; else its author date. With an uncommitted body change: the working value if it differs from HEAD's, else today (the one place derive reads a clock) | `body changed in 424f71a (2026-09-07)` / `uncommitted body change` |
| `authors` | git | Names of authors of body-changing commits plus their `Co-authored-by` trailers, oldest first, deduplicated by email, names ending `[bot]` excluded | `4 body-changing commits` |
| `owner` | codeowners | Owners matching the path, `@` kept. GitHub: last matching line wins, first file found of `.github/CODEOWNERS`, `CODEOWNERS`, `docs/CODEOWNERS`. GitLab adds `.gitlab/CODEOWNERS` and sections: every section applies, last match wins per section, union of owners | `.github/CODEOWNERS:12` |
| `reviewed-by` | forge, then git | Logins with an `APPROVED` review on the merged PR/MR containing the newest body-changing commit, `[bot]` suffix stripped for dedupe. Fallback: `Reviewed-by:` trailers on that commit | `github PR #18` / `Reviewed-by trailer in 424f71a` |
| `last-reviewed` | forge, then git | Date of the latest `APPROVED` review on that PR/MR. Trailer fallback: the commit's author date | as above |

Not derivable, and not offered: `stakeholders`, `review-interval`,
`verified-against`, `source-of-truth`. Each is a judgment a person makes.
Naming one in `derive.fields` is a config error.

Forge lookups, by host. GitHub: the PR for a commit from
`gh api repos/{o}/{r}/commits/{sha}/pulls`, falling back to
`gh pr list --search <sha> --state merged`, and reviews from
`gh api repos/{o}/{r}/pulls/{n}/reviews`. GitLab:
`glab api projects/:fullpath/repository/commits/<sha>/merge_requests` and
`.../merge_requests/<iid>/approvals`. A merged answer is immutable, so it is
cached under `.manni/meta/forge-cache/`, keyed by host, owner, repository and
sha. An open PR's answer is never cached, because the next approval changes
it. `--no-cache` bypasses the cache for one run.

### Config

Under `meta:`, camelCase like `allowEmpty`:

```yaml
meta:
  derive:
    fields: [created, last-updated, authors, owner]   # managed
    sources: [git, codeowners, forge]                 # optional; default all three
    codeowners: .github/CODEOWNERS                     # optional; default: the forge's search order
```

| Key | Type | Required | Rule |
|---|---|---|---|
| `derive.fields` | `string[]` | no, but a `derive:` must set one of its three keys | Non-empty when present, unique, each a derivable field, never a sidecar-owned key. A violation is a config error, exit 2, naming `derive.fields`. Absent manages nothing; `sources` or `codeowners` alone shape the reads, which is how a machine without `gh` narrows the `derived` table. |
| `derive.sources` | list of `git`, `codeowners`, `forge` | no | Non-empty, unique. A field whose only sources are excluded derives null, and can never be stale. |
| `derive.codeowners` | `string` | no | Relative to the config's directory. Must exist when `codeowners` is an active source, exit 2. |

`derive` joins the known top-level keys, so an unknown key inside it is an
error like anywhere else in the file. `derive` is also reserved as a check
name, because `derived:stale/derived` would otherwise collide with a check
called `derived`.

### `manni meta derive [paths...]`

A new verb. It writes by default, like `fill` and `query`, and `--dry-run`
means the same thing everywhere.

| Argument or option | Type | Default | Meaning |
|---|---|---|---|
| `[paths...]` | positional | `paths:` from config | Files, directories, globs. `-` is refused, exit 2: `cannot derive <stdin>: no history behind it`. |
| `--fields <list>` | comma list, once | `derive.fields` | Which managed fields to stamp this run. An unknown or non-derivable name is exit 2. No config and no flag is exit 2: `nothing to derive: set derive.fields in manni.config.yaml or pass --fields`. |
| `--sources <list>` | comma list, once | `derive.sources`, else all three | Sources to consult. |
| `--dry-run` | flag | off | Report what would change; write nothing. |
| `--check` | flag | off | Implies `--dry-run`. A stale or unset managed field is a finding, exit 1 if any. |
| `-f, --format <fmt>` | `pretty`, `json`, `github`, `sarif`, `junit` | `pretty` | `github`, `sarif` and `junit` only with `--check`. Otherwise exit 2: `sarif is a findings format, which only --check produces`. |
| `--no-cache` | flag | cache on | Bypass the forge cache. |
| shared with `validate` | | | `--ext <list>`, `--exclude <glob>` (repeatable), `--as <format>`, `-c, --config <path>`, `--no-config`, `--allow-empty`, `--no-gitignore`, and the global `--no-color`. Same names, same semantics. |

Exit codes: `0` applied, or nothing to do. `1` only under `--check`. `2` for
usage and operational errors, including every unavailable source.

The ladder:

```console
$ manni meta derive
docs/install.md
    last-updated  2026-08-20 → 2026-09-07   (git: body changed in 424f71a)
    owner         (unset) → ["@platform-docs"]  (codeowners: .github/CODEOWNERS:12)
docs/faq.md  current
2 files, 1 changed, 2 fields written
                                                                    exit 0
$ manni meta derive --check -f github
::error file=docs/install.md,line=9::[derived:stale] /last-updated says 2026-08-20; git says 2026-09-07 (body changed in 424f71a) — run manni meta derive
                                                                    exit 1
$ manni meta derive                       # no derive: in config, no --fields
manni: nothing to derive: set derive.fields in manni.config.yaml or pass --fields
                                                                    exit 2
$ manni meta derive --fields verified-against
manni: "verified-against" is not derivable; derivable fields are created, last-updated, authors, owner, reviewed-by, last-reviewed
                                                                    exit 2
$ manni meta derive                       # CI with fetch-depth: 1
manni: git source unavailable: this checkout is shallow; use actions/checkout with fetch-depth: 0, or --sources codeowners,forge
                                                                    exit 2
$ manni meta derive --fields reviewed-by  # no gh on PATH
manni: forge source unavailable: gh is not on PATH (origin is github.com); install gh and run gh auth login, or drop reviewed-by from --fields
                                                                    exit 2
```

### `manni meta validate`

One flag, `--no-derive`. It skips the comparison even when `derive.fields`
is configured. With `derive.fields` set and the flag absent, `validate` runs
the derivation once for the run, then compares each file's managed fields.
That happens on scoped runs too, per file, unlike `checks:`. The baseline
settles the findings like any other.

```console
$ manni meta validate
docs/install.md
    /last-updated  last-updated says 2026-08-20; git says 2026-09-07 (body changed in 424f71a) — run manni meta derive  (line 9)  [derived:stale]
1 file checked, 1 failed
                                                                    exit 1
$ manni meta validate --no-derive
                                                                    exit 0
```

### `manni meta get`

One flag, `--derived`. It shows the derived value and its evidence beside the
asserted one. Pretty prints
`docs/install.md: last-updated=2026-08-20 (derived 2026-09-07, git: body changed in 424f71a)`.
JSON adds a `derived` record per file. A field that is not derivable prints
`(not derivable)`. Stdin is refused with the flag. The exit code is unchanged,
because it is a read.

### `manni meta query`

A read-only `derived` table, built when the statement mentions it. Columns
are `_path`, `created`, `last-updated`, `authors`, `owner`, `reviewed-by`,
`last-reviewed`, and `_sources`, a JSON object of `{field: {source,
evidence}}`. Lists are JSON text, as in `docs`. It is a view, so SQLite
refuses a write and manni completes the refusal:
`cannot modify derived because it is a view; a collection or the derived table is read-only`.
A write to a managed key through `docs` is refused at plan time:
`"last-updated" is managed by derive; run manni meta derive instead.` No flag.

### `manni meta fill`

A managed field is never a candidate. It is reported with
`skipReason: "managed"`, a new member of the existing union.

### Action and hook

`action.yml` gains no input. `args: --no-derive` is the opt-out, and the docs
show `actions/checkout` with `fetch-depth: 0` beside any `derive:` config. The
pre-commit hook needs nothing. It runs `validate` on staged files, and
`validate` now judges managed fields on scoped runs.

### Output shapes

The finding, in `json` output:

```json
{
  "schema": "derived:stale",
  "keyword": "derived",
  "instancePath": "/last-updated",
  "message": "last-updated says 2026-08-20; git says 2026-09-07 (body changed in 424f71a) — run manni meta derive",
  "line": 9
}
```

The public types, from `src/meta/core/derive/types.ts`:

```ts
export const DERIVABLE_FIELDS = ["created", "last-updated", "authors", "owner", "reviewed-by", "last-reviewed"] as const;
export type DerivableField = (typeof DERIVABLE_FIELDS)[number];
export const DERIVE_SOURCES = ["git", "codeowners", "forge"] as const;
export type DeriveSource = (typeof DERIVE_SOURCES)[number];

export interface DeriveConfig { fields: DerivableField[]; sources?: DeriveSource[]; codeowners?: string }

export interface DerivedValue { value: unknown; source: DeriveSource; evidence: string }
export interface DerivedRecord {
  /** Run label, as `_path` spells it. */
  file: string;
  /** null means the source answered and found no fact. */
  fields: Partial<Record<DerivableField, DerivedValue | null>>;
}
/** `reason` names the fix. */
export interface SourceStatus { available: boolean; reason?: string }

export type DerivedStatus = "current" | "stale" | "unset" | "unknown";
export interface DerivedField {
  field: DerivableField; asserted?: unknown; derived: unknown | null;
  source?: DeriveSource; evidence?: string; status: DerivedStatus; written: boolean;
}

/** Throws DocmetaError (exit 2) when a requested source cannot answer. */
export function deriveMetadata(inputs: DeriveInput[], ctx: DeriveContext):
  Promise<{ records: Map<string, DerivedRecord>; sources: Record<DeriveSource, SourceStatus> }>;
/** Pure. Lists compare as sets. */
export function compareDerived(field: DerivableField, asserted: unknown, derived: DerivedValue | null): DerivedField;
/** Pure. One finding per stale or unset managed field. */
export function staleFindings(fields: DerivedField[], lineFor: ExtractedMetadata["lineFor"]): FieldError[];

export interface DeriveFileResult { file: string; format: string; fields: DerivedField[]; changed: boolean; error?: string }
export interface DeriveSummary { files: number; changed: number; written: number; stale: number; unset: number; unknown: number; errors: number }
export interface DeriveRun { results: DeriveFileResult[]; summary: DeriveSummary; dryRun: boolean; check: boolean; sources: Record<DeriveSource, SourceStatus> }
```

The write path is `fill`'s. The extractor applies a patch, the atomic writer
lands it, and the empty-patch writability probe runs first. A sidecar-owned
managed key cannot exist, by config, so no runtime refusal is needed there.

## Stress test

1. **The sidecar merge route.** The first sketch made derived values a
   second manifest, merged like a sidecar, so the schema could see them.
   Rejected. A merged value is exactly the thing the document does not carry,
   and the point here is that the document should. It would also have put
   the comparison inside seven merge sites, and a stale stamp would have
   vanished under the merged one. Decision 1 followed.
2. **The checks route.** The second sketch phrased staleness as a corpus
   check in `checks:`. Rejected, for two reasons that compound. A corpus
   check runs only on a config-corpus run, and the pre-commit hook passes
   staged files, which is a scoped run. The one place a tired updater would
   be caught is the place the check would be skipped. The comparison is
   per-file, so it runs per file, on every run, and `--no-derive` is the
   opt-out.
3. **Comparing an asserted date to a commit date.** The obvious rule is that
   `last-updated` must equal the date of the last commit touching the body.
   Rejected. A squash merge rewrites every date to the merge, so a stamp
   written on Tuesday and squashed on Friday reads as stale forever. Decision
   2 makes the commit that made the fact the authority. If it carries the
   stamp, the stamp is right by definition.
4. **Degrade open.** gitignore filtering switches itself off when git cannot
   answer, and prints one line when asked to. The same shape was drafted
   here. Rejected. A gate that silently checked nothing is the false green
   0014 exists to end, and here the silent case is the CI default. A shallow
   checkout is `fetch-depth: 1` on every GitHub runner. Decision 6 makes it
   exit 2 with the fix in the message.
5. **Non-fenced formats.** `locateFrontmatter` finds a fenced block. An HTML
   `<head>`, an XML prolog, and a native reStructuredText docinfo have no
   fence. A stamp written into them changes the file, and so reads as a body
   change. The stamp then moves `last-updated` to the day it was written.
   Recorded as a limitation, and correct in the direction it errs. A stamp
   that is too new is visible; one that is too old is the drift this exists
   to catch. The fix is 0020's element ranges, which know where the metadata
   ends.
6. **The whole-repository walk in a monorepo.** A walk with no pathspec
   reads every commit. In a repository with a hundred thousand commits and
   forty documents, that is the wrong trade. The walk stops per file at the
   first body-changing commit. It is newest-first, so a run over documents
   that change often finishes early. A run over documents that
   never change reads to the root. Decision 8's threshold of 32 files takes
   the per-file `--follow` form for small runs. A `since:` bound is recorded
   as a follow-up for the rest.
7. **A shallow CI checkout.** `actions/checkout` defaults to depth 1. With
   it, every `created` and `last-updated` derives from the one visible commit,
   which is wrong in a way no message would reveal. Decision 9. The run
   refuses and names `fetch-depth: 0`. A team that wants `owner` and nothing
   from git narrows `--sources`.
8. **Bots in `authors`.** A dependency bot, a release bot, and a formatting
   bot all commit body changes. Their names end in `[bot]` on GitHub and are
   excluded. On GitLab the convention is weaker, and a bot with an ordinary
   name lands in `authors`. Recorded. The deduplication key is the email, so
   one person under two spellings collapses when the email matches, and does
   not when it does not.
9. **The 0038 rejection.** 0038 said delegating a fetch to `gh` or `glab`
   ties manni to two vendors' CLIs, auth stores and argument grammars. It
   also said the delegation spawns a process for something `fetch` does in
   one call. Every word of that still holds for a raw-file URL. It does not
   hold for a review. No URL answers "who approved the PR containing this
   commit" without a token. manni holding a token is an egress story this
   project has not written and does not want. The CLI already holds one, on
   the runner and on the laptop. Decision 7 is the owner's call that the CLI
   is the trust boundary. It is recorded here so the two proposals read as
   one line rather than a contradiction.
10. **The stamp commit and the approval.** The after-approval workflow pushes
    a stamp to the pull request branch. Under a branch rule that dismisses
    stale approvals on push, the stamp dismisses the approval that produced
    it. That is the forge's rule, not manni's, and the docs say so. The
    remedies are to exempt the bot, or to stamp on merge instead.

## Consequences

- A stale stamp is red. That is the whole point, and it is also the cost. A
  repository that stamps `last-updated` by hand today and adopts
  `derive.fields` will go red on every page whose body moved since the stamp.
  `--write-baseline` records that backlog, and the M2 page says how.
- `validate` may now spawn `git`, and with the `forge` source, `gh` or
  `glab`. A run with no `derive:` in config spawns nothing new. `--no-derive`
  makes a run with one behave as before.
- The derivation runs once per run, not once per file. The bulk walk is one
  process per repository root, so a corpus run over a thousand pages costs
  one `git log` and one `git cat-file`.
- `derive` is a fourth writer beside `fill`, `query` and `schemas vendor`. It
  shares `fill`'s write path, so comment preservation and the writability
  probe come for free. So does the refusal for a format that cannot be
  written.
- Managed fields are no longer `fill`'s or `query`'s to write. A script that
  backfilled `last-updated` with an `UPDATE` now gets exit 2 and the name of
  the command to run instead.
- The finding's message is a complete instruction. That matters most when
  the updater is an agent, which reads the message and runs the command it
  names.

### What the pre-merge review changed

The code review on the pull request confirmed ten defects in the first
implementation and the fixes narrowed four behaviours stated above. They are
recorded here rather than silently absorbed, because each is a rule the
next channel will meet again.

- A git root that cannot answer makes the whole git source unavailable, even
  when another root answered. The first draft kept the answering root and
  dropped the failing one's documents, which derived null and passed. That
  is the false green decision 6 refuses, and the forge source already applied
  the stricter rule.
- The `derived` table derives only the columns a statement can read, and is
  built only when the statement names the table after `FROM`, `JOIN` or a DDL
  keyword. The first draft derived all six fields for any SQL containing the
  word, so a `LIKE '%derived%'` read spawned the forge and exited 2 without
  `gh`.
- `derive` exits 1 when a file could not be parsed or written, `--check` or
  not, as `fill` and `get` do. `--fields` refuses a key a sidecar owns, the
  way the config parser already did.
- A `--db` export never carries the derived rows: the view and its backing
  table are dropped before the handle closes. A collection may not be named
  `derived` or `_derived_rows`.

Two smaller changes follow. The trailer atoms use `unfold`, so a wrapped
`Reviewed-by` is read whole. A wildcard-final CODEOWNERS pattern such as
`docs/*` no longer covers nested files, matching GitHub's own example.

## Follow-ups recorded, not promised

- **Slice 4, suggestions on the pull request.** A reporter that posts
  suggestion blocks to the PR or MR through `gh` or `glab`, one per stale
  managed field, so the fix is a click. `derive --check -f github` already
  annotates the diff, so this is a convenience over a working gate.
- **Element-range body split.** The non-fenced formats from stress test 5,
  through 0020's element ranges, so a stamp into an HTML `<head>` is not a
  body change.
- **`derive` inside `overrides[]`.** Different managed fields per override
  group, so a `docs/api/**` group can manage `reviewed-by` while a
  `blog/**` group manages only the dates.
- **A `since:` bound on the walk.** A date or a ref below which the bulk
  walk stops, for the monorepo case in stress test 6.
- **0023 round 10.** Steve Arrants' `released` field, with the note that
  Jekyll's built-in already claims `published` as a boolean, so the name
  has to avoid it. The same round should carry the `last-reviewed` answer to
  "what act moves it". Decision 2 gives it: the approval on the PR that
  contains the newest body-changing commit.
