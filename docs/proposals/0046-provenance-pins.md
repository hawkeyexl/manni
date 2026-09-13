# 0046: provenance pins the lines a machine wrote; meta-provenance keeps the fields

- **Status:** Implemented (#34)
- **Serves:** Maya · M8 · Sara · S1 · Devin · D4
- **Depends on:** [0040](0040-derived-metadata.md), the derived channel this
  field rides. `manni meta derive` stamps it, and `validate` reports a stale
  stamp. 0040's decision 2 is the squash-proofing rule generalized here from a
  date to a range. [0044](0044-citations-and-drift.md), the pin: a line range
  and an integrity hash, counted in body lines, under one hashing rule.
  [0023](0023-metadata-vocabularies.md), the family whose `provenance`,
  `kg.provenance`, `eval-provenance` and `metadata.eval-provenance` this
  proposal redraws. [0041](0041-collections.md), the `externalMetadata:`
  manifest the record may live in. [0043](0043-resolved-reads.md), the
  `resolved` view that exposes it
- **Relates to:** [0045](0045-family-encryption-key.md), for why a pin over a
  public page is always plain `sha256-`, and for treating an empty environment
  variable as unset. [0002](0002-ci-distribution-artifacts.md), the pre-commit
  hook file the `manni-meta-derive` hook joins. [0017](0017-fill-egress-and-bounds.md),
  for what `fill` sends, which now excludes both provenance keys
- **Supersedes, in part:** one rule of 0040, for `provenance` only: a managed
  field a manifest owns is refused. See [In an external manifest](#in-an-external-manifest).
  0040 is not edited
- **Touches (planned):** `docs/proposals/0023/schemas/ai-context/1.0.0-proposal.2.json`,
  `docs/proposals/0023/schemas/kg/1.0.0-proposal.2.json`,
  `docs/proposals/0023/schemas/evals/1.0.0-proposal.3.json`,
  `docs/proposals/0023/schemas/artifact-evals/1.0.0-proposal.3.json` (all new),
  `docs/proposals/0046/ladders/**` (new), `docs/proposals/0023/design-notes.md`,
  `docs/content-strategy/cujs.md`,
  `docs/src/content/docs/meta/proposals/{ai-context,kg,evals,artifact-evals}.mdx`.
  The implementation, later: `src/meta/core/derive/{git,index,types,config}.ts`,
  `src/meta/commands/{derive,fill}.ts`, `src/meta/commands/fill-types.ts`,
  `src/meta/reporters/fill.ts`, `src/meta/core/config.ts`,
  `src/cite/core/{hash,range}.ts` moving to `src/shared/`,
  `.pre-commit-hooks.yaml`, `test/pre-commit-hook.test.ts`, `test/derive*`,
  `test/fill*`, `test/fixtures/derive/**`,
  `docs/src/content/docs/meta/ci/recipes.mdx`
- **Verdict:** Redefine `provenance` as a derived record of which machine wrote
  which lines of the body. Each entry is a pin, `lines` plus `integrity`, with
  the machine's name. `manni meta derive` stamps it from `git blame` and commit
  evidence, and `validate` fails when a pinned range has changed or the
  evidence names another machine. Rename today's per-model field attribution
  to `meta-provenance`, address its fields by JSON Pointer, and fold
  `kg.provenance`, `eval-provenance` and `metadata.eval-provenance` into it.
  `manni meta fill` writes it for the fields it fills. Drop the page-level
  `generated-by`, which `provenance` makes redundant. No new verb: one option
  and one positional form on `derive`, one config key, and one more pre-commit
  hook, `manni-meta-derive`. Review round 1 settled the five open questions.

## Problem

Agents edit docs every day now. A Claude Code session rewrites a procedure. A
support bot patches a troubleshooting section. A person copy-edits both a week
later. Maya reviews by pull request, and once the PR merges she can no longer
see which parts of a page a machine wrote.

The family has one field for it. `generated-by` names the model that generated
a page's content: one string for one page. A page with three authors names one
of them. The `provenance` arrays beside it answer a different question, which
machine proposed which *frontmatter fields*, and a human deletes an entry once
it is reviewed. So they are a to-review list, not a history, and they say
nothing about prose. They also come in four shapes. There is a free list of
names in ai-context and a closed enum inside `kg`. There is a list of eval ids
under the reserved `eval-` prefix, and the same one level down in an
artifact's `metadata`.

What that costs:

- **Review goes to the wrong text.** Maya re-reads whole pages to find the
  machine-written parts. Or she trusts the last diff and misses the section an
  agent rewrote three PRs ago.
- **A human edit over machine text is silent.** Nothing notices when reviewed
  text a machine was credited with is replaced.
- **The bias check reads the wrong author.** The evals self-preference-bias
  check reads the page's one `generated-by`, so a judge can grade a section its
  own model wrote without knowing.
- **Sara maintains four shapes for one idea**, each with its own guard exception
  and its own review page.

Git does not answer this on its own. 0023's review round 9 recorded that git
knows who *committed* a change, not who wrote the prose, which is why `authors`
is asserted. 0040 confirms the machinery: it reads `git log --raw`, which is per
file, and never calls `git blame`. Nothing in the codebase produces per-line
attribution today.

## Summary

- **`provenance`** is a list of pins. Each says one machine wrote one range of
  body lines, and carries the integrity of that range. It is a managed field:
  `derive` stamps it, `validate` compares the stamp with the present, `fill`
  never proposes it, and `query UPDATE` refuses it.
- **Evidence** comes from `git blame` plus what machines leave behind. They
  leave a stamp in the commit that made the edit, a `Generated-by:` trailer,
  or a `Co-authored-by:` trailer the config names as a machine. A machine that
  leaves nothing is invisible, and the proposal says so rather than guessing.
- **Adding an entry is one command an agent already runs.** With
  `MANNI_GENERATED_BY` set, `manni meta derive` before a commit attributes the
  uncommitted lines, and the stamp lands in the same commit as the edit. From
  then on the stamp is its own evidence.
- **The pre-commit hook does it for them.** `manni-meta-derive` runs `derive`
  on the staged files, so an agent with `MANNI_GENERATED_BY` exported gets its
  lines attributed without remembering a command.
- **`meta-provenance`** is today's field attribution under a name that says
  what it attributes. Fields become JSON Pointers, evals stay ids, and the
  three other shapes fold into it. `fill` writes it for the fields it fills.
- **There is no page-level `generated-by`.** The machines that wrote a page are
  the distinct `generated-by` values across its `provenance`, and the
  self-preference-bias check reads them there.
- **Nothing is keyed by a string copied from the content.** A pin locates
  prose. A pointer locates a value. Both survive the record moving to an
  external manifest.

## The vocabulary

### `provenance`

In `manni:ai-context:1.0.0-proposal.2`. A list, `minItems: 1`. Each entry is
closed.

```yaml
---
title: Rate limits
provenance:
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: sha256-c41f09aa…
  - generated-by: claude-sonnet-5
    lines: 44
    integrity: sha256-0b7e11d4…
---
```

| Field | Type / pattern | Required | Meaning |
|---|---|---|---|
| `generated-by` | string, `minLength: 1` | **yes** | The machine that wrote these lines, as one name. There is no separate agent field |
| `lines` | `L` or `"L1-L2"` | **yes** | Body lines, counted from the first line after the frontmatter. Where the pin was last seen |
| `integrity` | `^sha256-[0-9a-f]{64}$` | **yes** | The pin, and the entry's identity |

Four rules come from 0044 and are cited rather than restated. `lines` and
`integrity` are spelled and patterned exactly as in
`manni:citations:1.0.0-proposal.3`. The hashing rule is that proposal's, stated
once there. Lines are body lines for that proposal's reason: otherwise a
frontmatter edit, including this field's own stamp, would move every pin.
`L2 >= L1` is the tool's rule, because a pattern cannot compare numbers.

**`integrity` is always plain.** The page is public, so a keyed
`hmac-sha256-` pin would hide nothing, which is why a citation's claim end is
always plain too.

**`lines` is a position, `integrity` is an identity.** Matching goes by
integrity. A stale `lines` value is a moved pin, not a wrong one.

**There is no `commit-sha`.** Evidence is read from blame when the record is
checked, so the stamp does not change when uncommitted lines are committed. A
field that changed on that commit would make every attribution a second commit.

**Humans never appear.** `authors` carries them. A range no machine wrote has
no entry, and an all-human page has no `provenance`.

**There is no page-level `generated-by`.** ai-context `proposal.1` had one:
one model for one page. The machines that wrote a page are now the distinct
`generated-by` values across its `provenance`, which is both finer and harder
to get wrong. The kg harvest reads them there.

### The self-preference-bias check

A judge is grading its own author when its model is among the machines
attributed for what it grades. What it grades is the eval's `target`:

| `target` | Machines compared against |
|---|---|
| `body` (the default) | the distinct `provenance[].generated-by` |
| `frontmatter` | the distinct `meta-provenance[].generated-by` |
| `raw` | both |
| `{source: file, path}` | none; a companion file carries its own record if it is a page |

The check covers the whole body, because `target` has no form that names
lines. A `{lines}` target is a question for a later evals draft, not this one;
see stress test 17.

### `meta-provenance`

Also in `manni:ai-context:1.0.0-proposal.2`. It is the field attribution that
`provenance` was, with its meaning unchanged. There is one entry per model, and
consumers merge entries by `generated-by`. A human deletes an entry once its
fields are reviewed, so a surviving entry means unreviewed machine metadata. It
is not managed and not derived. `manni meta fill` writes it; see
[`fill` writes meta-provenance](#fill-writes-meta-provenance).

```yaml
meta-provenance:
  - generated-by: claude-fable-5
    fields: [/intent, /kg/label]
    evals: [install-works]
    confidence:
      /intent: 0.9
      /kg/label: 0.84
      install-works: 0.7
```

| Field | Type / pattern | Required | Meaning |
|---|---|---|---|
| `generated-by` | string, `minLength: 1` | **yes** | The model that proposed them |
| `fields` | list of JSON Pointers, `^/`, unique, `minItems: 1` | one of `fields` or `evals` | The metadata values it proposed. `/kg/label` reaches inside a block |
| `evals` | list of eval ids, `^[a-z0-9][a-z0-9-]*$`, unique, `minItems: 1` | one of `fields` or `evals` | The evals it proposed, by id, so reordering the list orphans nothing |
| `confidence` | map from a pointer or an eval id to a number in 0..1 | no | Per-field or per-eval confidence |

The two key forms of `confidence` cannot collide. A pointer starts with `/`,
and an id cannot.

### From draft to draft

What the new drafts change against the drafts under review:

| Earlier draft | New draft |
|---|---|
| ai-context `generated-by` | removed; the machines come from `provenance` |
| ai-context `provenance: [{generated-by, fields: [intent], confidence: {intent: 0.9}}]` | `meta-provenance: [{generated-by, fields: [/intent], confidence: {/intent: 0.9}}]` |
| `kg: {provenance: [{generated-by, fields: [label]}]}` | page-level `meta-provenance: [{generated-by, fields: [/kg/label]}]` |
| `eval-provenance: [{generated-by, evals: [x]}]` | page-level `meta-provenance: [{generated-by, evals: [x]}]` |
| artifact-evals `metadata.eval-provenance` | `metadata.meta-provenance`, the same entry one level down |
| evals root guard `^eval-(?!suite$\|skip$\|provenance$)` | `^eval-(?!suite$\|skip$)` |
| artifact-evals `metadata` guard `^eval-(?!skip$\|provenance$)` | `^eval-(?!skip$)` |
| evals and artifact-evals `severity`: `error \| warning \| info` | `error \| warning \| notice`, the family scale |

The artifact side keeps its record under `metadata` for the reason 0023 gave.
An artifact's top level is its host tool's contract, and `metadata` is the
extension bag. Both drafts carry the same entry definition, and the ladder
asserts that they do.

The new eval drafts also rename one severity level. Both enumerated
`error | warning | info`, while the family scale in manni's shared severity is
`notice | warning | error`. Shared concepts use shared values, so the
drafts say `notice`.

Two changes to the entry are deliberate. Pointers replace bare names, because
a pointer is the location `validate` already reports and a bare name cannot
reach into `kg`. An entry must name `fields` or `evals`, because today
`- generated-by: x` passes and says nothing.

## The derivation contract

`provenance` derives from the existing `git` source. `FIELD_SOURCES.provenance`
is `["git"]`, and blame runs only when `provenance` is in `derive.fields`, which
is the per-field gating 0040 already has. There is no `blame` source to turn
off: the field list already decides whether blame runs.

**Evidence, per body line, first match wins:**

1. **Uncommitted, with a name.** Blame reports the zero sha, and
   `--generated-by` or `MANNI_GENERATED_BY` is set. The line is that machine's.
2. **A stamp in the commit that wrote it.** Blame gives the line's number in
   the commit that last changed it. That commit's own blob may carry a
   `provenance` entry whose range covers that number, and whose integrity
   matches that blob's lines. If it does, the line is that entry's machine.
   This is 0040's decision 2, generalized from a date to a range. The commit
   that made the fact is the authority. A stamp it carried agrees with itself
   whatever a squash later did to the history.
3. **A `Generated-by:` trailer** on that commit names the machine.
4. **A `Co-authored-by:` trailer** on that commit whose name or email matches
   `derive.machines` names the machine, by the trailer's name.
5. **Otherwise, no evidence.**

Contiguous lines resolved to one machine form one entry, hashed under the
hashing rule.

How the evidence is read, where the list above leaves room:

- **Uncommitted lines take evidence from rule 1 only.** The working tree's
  stamp is never evidence for itself. A `validate` before the commit reads a
  fresh stamp as current with no evidence, not as stale.
- **Rule 2 checks a stamp only at its recorded lines,** converted to that
  commit's own body numbering. The same text elsewhere in that blob does not
  count. An entry that fails the schema is not evidence. When two valid entries
  cover one line, the first in the list wins. Where the record lives in a
  manifest, rule 2 reads the manifest's blob at that commit, under the page's
  path. That is where the stamp landed when edit and stamp were committed
  together.
- **A stamp outranks its own commit's trailer.** Rules 2 and 3 can disagree on
  one commit. The stamp wins, because it names lines and the trailer names a
  commit.
- **Trailers.** Keys compare without case, as git's own trailer parsing does.
  When a commit carries several trailers of one kind, the first wins. Rule 4's
  machine is the trailer's name as written, such as `Claude Opus 5`, and the
  email only when the name is empty.

**Comparing the stamp with the present.** Each stamped entry is matched to the
freshly derived entries by integrity. Position only breaks a tie between
ranges of identical text. The nearest start line wins, and an equal distance
goes to the earlier range. Each derived entry is taken by one stamp at most. A
stamp that matches no derived entry is searched for anywhere in the current
body. Found nowhere, it is `changed`. Found, it is `stale` if any line in the
window names a different machine, and otherwise current or moved. A window of
lines that name the same machine or none is not a contradiction.

| Case | Status | Finding |
|---|---|---|
| Same integrity and machine, same lines | current | none |
| Same integrity and machine, other lines | moved | none; `derive` rewrites `lines` when it next writes |
| The pinned text is found nowhere | changed | `derived:stale` |
| The evidence names a different machine for those lines | stale | `derived:stale` |
| The evidence names no machine, and the pin matches | current | none |
| The evidence names a machine for lines no entry covers | unset | `derived:stale` |

**No evidence is not a contradiction.** A stamped range over lines whose commit
names no machine stands for as long as its pin matches. Without that rule, a
person could never attribute lines after the fact. The next check would call
the attribution stale because git had nothing to say.

A derived range is `unset` only where some of its lines fall outside every
stamp matched above and outside the recorded lines of every changed stamp. So a
person's edit inside an agent's range is one `changed` finding, not a changed
finding plus two unset ones.

`derive` keeps current and moved entries, rewriting `lines` for a moved one.
It re-derives changed and stale ones from the evidence, dropping a changed one
when no evidence remains, and adds unset ones. It never drops an entry that
nothing contradicts. `moved` and `changed` mean what they mean in 0044.

## Adding an entry

Four ways, cheapest first.

**An agent stamps its own edit, before committing.** Blame cannot see
uncommitted lines, so `--generated-by` attributes exactly those. An agent sets
the variable once per session; it is one line in a repository's agent
instructions.

```bash
export MANNI_GENERATED_BY=claude-fable-5
# …the agent rewrites lines 12-31 of docs/limits.md…
manni meta derive
# docs/limits.md
#     provenance  lines 12-31: (unset) → claude-fable-5  (git: uncommitted)
git commit -am "docs: rewrite the install steps"
```

The edit and its stamp land in one commit, so evidence rule 2 reads the stamp
back from that commit from then on. No trailer is ever needed. This is the path
the docs lead with.

**A person, precisely.** A range on the path scopes the attribution, in the
spelling `cite add` uses. Both commands split it with one parser,
`splitPageArgument` in `src/shared/pin.ts`:

```bash
manni meta derive docs/limits.md:12-31 --generated-by claude-fable-5
```

With a range, `--generated-by` attributes those lines whether committed or not,
unless evidence rules 2 to 4 name a different machine, which is refused.
Without a range, it attributes uncommitted lines only. The range is also the
answer when a person and an agent both have uncommitted edits in one file.

**A trailer.** `Generated-by: claude-fable-5` in a commit message, for a tool
that commits without running `derive`. Every later run picks it up.

**`derive.machines`, so history attributes itself.** Many repositories already
end agent commits with a `Co-authored-by:` naming the model, and this one does.
The tool cannot tell that trailer from a person's, so this is a key rather than
a detection. A matching `Co-authored-by:` trailer counts as a machine for
`provenance`. Any matching identity, a commit's author included, is excluded
from `authors`. That also fixes the weakness 0040 records, where a bot with an
ordinary name lands in `authors`.

## In an external manifest

A pin needs nothing from the page but its body, so the record works the same
from a manifest. The manifest is keyed by page path, which is the join 0041
owns, and below that the entries are pins.

```yaml
# private/provenance.yaml
docs/limits.md:
  provenance:
    - generated-by: claude-fable-5
      lines: 12-31
      integrity: sha256-c41f09aa…
```

Today a managed field that a manifest owns is refused, exit 2, both at config
load and in `derive`. The refusal says "a managed field has one authority, and
a manifest key already has one." That rule protects a hand-curated manifest,
such as an owners list, from a tool overwriting it. A `provenance` entry is
never hand-curated. It is a pin a tool mints. So, **for `provenance` only**,
the manifest is where the stamp is stored rather than a second authority.
`derive` writes into it with the same comment-preserving splice `cite update`
uses. Every other managed field keeps the refusal.

Three manifests cannot hold the record, and `derive` refuses each, exit 2. The
implementation found them; the first draft did not name them.

| Manifest | Message |
|---|---|
| A URL, which `derive` cannot write | `collection site: provenance cannot come from a URL manifest, because manni meta derive writes it.` |
| One of two, when a page is in two collections whose manifests both own `provenance` | `docs/limits.md is in collections site and limits, and both keep provenance in a manifest.` |
| Joined on a field the page does not carry | `docs/limits.md carries no id, which private/by-id.yaml joins on, so its provenance has no entry there.` |

`validate` and `get` only read the record, so they refuse none of the three. A
URL manifest's copy at a past commit is simply not evidence.

When every range of a page loses its evidence, `derive` removes the key from a
page. In a manifest it writes `provenance: []` under the page's entry, keeping
the entry in place.

## The tool

No new verb. `manni meta derive` gains one option and one positional form, and
`meta.derive` gains one key.

### Options and arguments

| Change | Spelling | Meaning |
|---|---|---|
| New option | `--generated-by <name>` | Attributes uncommitted body lines, or the lines a range names, to `<name>`. Defaults to `MANNI_GENERATED_BY`; an empty value is unset |
| New positional form | `<path>:L`, `<path>:L1-L2` | File lines of one file, scoping `--generated-by`. Split by `splitPageArgument` in `src/shared/pin.ts`, the parser `cite add` uses: the last `:L` suffix, so a drive letter is not a range. Legal only with `--generated-by` |

The variable and the option differ in one way. `MANNI_GENERATED_BY` alone never
refuses a run and never prints a notice. An agent session exports it once, and
a run that manages other fields has nothing for it to attribute. Only the
option, or a range, meets the "not in `--fields`" refusal and the "no
uncommitted body lines" notice.

Every other `derive` flag is unchanged, including `-` refusing stdin.

**What people see is file lines.** The range on the command line, every
message and every report use file lines, as in cite. Only the YAML holds body
lines, and `derive` translates. The examples below are file lines.

### Config, before and after

```yaml
# before
collections:
  - name: site
    paths: ["docs/**/*.md"]
meta:
  derive:
    fields: [created, last-updated, authors]
```

```yaml
# after
collections:
  - name: site
    paths: ["docs/**/*.md"]
    externalMetadata:                                  # optional
      - file: ./private/provenance.yaml
        keys: [provenance]
meta:
  derive:
    fields: [created, last-updated, authors, provenance]
    machines: ["*[bot]", "noreply@anthropic.com"]      # optional
```

| Key | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `meta.derive.fields` | list of strings | no | absent: nothing managed | Unchanged. `provenance` is a legal value |
| `meta.derive.machines` | list of glob strings, non-empty, unique | no | `["*[bot]"]` | Trailer identities that are machines, matched against a trailer's name and its email. Globs match case-sensitively, and brackets are literal, so `*[bot]` means a name ending in `[bot]` |
| `collections[].externalMetadata[].keys` | list of strings | yes | none | Unchanged. May name `provenance` beside `derive.fields` |

The default for `machines` is exactly today's behaviour, so a configuration
that never writes the key changes nothing. `meta-provenance` needs no config.

### Messages and exit codes

| When | Output | Exit |
|---|---|---|
| `validate`, a pinned range changed | `provenance lines 12-31 changed since claude-fable-5 wrote them — run manni meta derive` | 1 |
| `validate`, the evidence names another machine | `provenance lines 12-31 say claude-fable-5; blame says claude-sonnet-5 (9b0e2c1) — run manni meta derive` | 1 |
| `validate`, machine lines with no entry | `provenance is unset for lines 44-52; blame says claude-sonnet-5 (4c1d2e0) — run manni meta derive` | 1 |
| `derive`, written | `    provenance  lines 44: (unset) → claude-sonnet-5  (git: blame 9b0e2c1)`, under the file | 0 |
| `derive`, written from `--generated-by` | `    provenance  lines 12-31: (unset) → claude-fable-5  (git: uncommitted)` | 0 |
| `derive`, the evidence names another machine | `    provenance  lines 12-31: claude-fable-5 → claude-sonnet-5  (git: blame 9b0e2c1)` | 0 |
| `derive`, a changed pin | `    provenance  lines 13-15: claude-fable-5 → re-derived  (git: pin)` | 0 |
| `derive`, a moved pin | `    provenance  lines 15-34: moved from 12-31  (git: pin)` | 0 |
| `derive`, into a manifest | the file header reads `private/provenance.yaml (for docs/limits.md)`, and the range lines follow | 0 |
| `derive`, the footer | `1 file, 1 changed, 1 range written`, counting ranges when `provenance` is among the fields | 0 |
| `derive --generated-by`, nothing uncommitted | `manni: docs/limits.md: no uncommitted body lines; --generated-by attributes only what is not yet committed.`, a notice on stderr | unchanged |
| `derive --check` | the three `validate` findings, nothing written | 1 |
| `derive`, a non-fenced format on the page | under `✗ docs/page.html`: `provenance cannot be stamped into the page: in the "html" format the metadata is part of the body it pins. Keep provenance in an externalMetadata manifest.` | 1 |
| `get` | `docs/limits.md: provenance=lines 12-31 claude-fable-5; lines 44 claude-sonnet-5 (derived, git: blame 9b0e2c1)` | 0 |
| `get -f json` | the result adds `provenance: {bodyLine, current}` when `provenance` is requested | 0 |
| `query` | `derived._sources` holds `{"provenance": {"source": "git", "evidence": "blame 9b0e2c1"}}`; with several commits, `blame 9b0e2c1, 2 commits` | 0 |
| `query UPDATE` | `"provenance" is managed by derive; run manni meta derive instead.` | 2 |
| a range the evidence contradicts | `docs/limits.md:12-31: blame attributes these lines to claude-sonnet-5 (9b0e2c1); --generated-by cannot overrule a recorded machine.` | 2 |
| a range without the option | `docs/limits.md:12-31 names lines, which only --generated-by uses. Pass --generated-by, or drop the range.` | 2 |
| the option without the field | `--generated-by attributes provenance, which is not in --fields. Add provenance, or drop --generated-by.` | 2 |
| a range past the end | `docs/limits.md has no lines 12-99: the file ends at line 40.` | 2 |
| a range into the frontmatter | `docs/limits.md:2-5 reaches into the frontmatter; provenance pins body lines, which start at line 8.` | 2 |
| a range that ends before it starts | `docs/limits.md:31-12 ends before it starts.` | 2 |
| a manifest that cannot hold the record | the three messages in [In an external manifest](#in-an-external-manifest) | 2 |
| a shallow clone | 0040's message, unchanged | 2 |

In `derive -f json`, the `provenance` field adds `ranges`, one object per range
with `lines` in file lines, `generated-by`, `integrity`, `status`, `evidence`,
`written`, and `from` on a moved or stale range. It adds `manifest` when a
manifest holds the record. `summary` adds `ranges`.

The three findings keep 0040's rule id, `derived:stale/derived`, and instance
path, `/provenance`. They add one thing 0040's findings do not carry, the file
line of the range. With it, the `github` and `sarif` formats annotate the prose
rather than line 1. Diagnostics carry the `manni:` prefix on stderr; report
lines do not. The finding's `subject` is `provenance <integrity>`, so a baseline
that forgives one range does not forgive the others.

### From the minimum to every option

```bash
# 1. Attribute what I just wrote
MANNI_GENERATED_BY=claude-fable-5 manni meta derive --fields provenance
# docs/limits.md
#     provenance  lines 12-31: (unset) → claude-fable-5  (git: uncommitted)

# 2. Precisely, for committed or mixed work
manni meta derive docs/limits.md:12-31 --generated-by claude-fable-5 --fields provenance

# 3. From config: every managed field, stamps landing in the manifest
manni meta derive

# 4. The gate
manni meta validate
# ✗ docs/limits.md
#     /provenance  provenance lines 12-31 changed since claude-fable-5 wrote them — run manni meta derive  (line 12)  [derived:stale]

# 5. CI, without writing
manni meta derive --check -f github
# ::error file=docs/limits.md,line=12::[derived:stale] /provenance provenance lines 12-31 changed since claude-fable-5 wrote them — run manni meta derive

# 6. Scripting: every range one family of models wrote
manni meta query "SELECT _path, e.value FROM resolved, json_each(resolved.provenance) AS e WHERE json_extract(e.value, '$.generated-by') LIKE 'claude-%'" -f json

# 7. Every option at once
manni meta derive docs/limits.md:12-31 --generated-by claude-fable-5 \
  --fields provenance,last-updated --sources git --collection site \
  --ext md,mdx --exclude "docs/legacy/**" --check -f sarif --no-cache -c manni.config.yaml

# 8. Usage errors, exit 2
manni meta derive docs/limits.md:12-31
# manni: docs/limits.md:12-31 names lines, which only --generated-by uses. Pass --generated-by, or drop the range.
manni meta derive --generated-by claude-fable-5 --fields last-updated
# manni: --generated-by attributes provenance, which is not in --fields. Add provenance, or drop --generated-by.
manni meta derive docs/limits.md:12-31 --generated-by claude-fable-5
# manni: docs/limits.md:12-31: blame attributes these lines to claude-sonnet-5 (9b0e2c1); --generated-by cannot overrule a recorded machine.
manni meta derive --fields provenance -
# manni: cannot derive <stdin>: no history behind it
```

Rung 7 pairs a range with `--check`. The check reports what the attribution
would write and exits 1 if anything is stale, writing nothing, which is what
`--check` means for every field.

## `fill` writes meta-provenance

For each file where `fill` writes at least one field, it records those fields
in `meta-provenance` in the same write. Under `--dry-run` it reports the entry
it would write. There is no switch: the page's schemas decide, below.

**The entry.** `generated-by` is the run's model, the name the footer prints
after the provider (`anthropic/claude-sonnet-4-5` records `claude-sonnet-4-5`).
`fields` are the JSON Pointers of the fields written, escaped per RFC 6901, so
a key `a/b` is `/a~1b`. `confidence` maps each of those pointers to the
confidence it was written at. Re-encrypting an existing value in place is not a
proposal and is not recorded. An encrypted field is recorded by pointer; its
value never appears.

**The merge.** `fill` replaces top-level values, so it computes the whole list.
Where an entry for this model exists, the new pointers go after its existing
`fields` and their confidences are set. Everything else in the entry is kept.
Where two entries share the model, which only a hand edit produces, the first
is used. Otherwise a new entry is appended. A pointer a reviewer removed comes
back only when `fill` writes that field again, which is a new machine value.

**Never proposed.** `provenance` and `meta-provenance` are never candidates for
the model, skipped as `$schema` is, and both are removed from the existing
metadata `fill` sends. A schema that defines them would otherwise ask a model to
invent hashes and to attribute itself.

**Not written, while the fields still are.** `fill`'s re-check ignores errors at
the document root, which is where `additionalProperties` reports, so the entry
is checked on its own. It is not written when any error sits at or under
`/meta-provenance` or a root error names it. Nor is it written when a manifest
owns `meta-provenance`, since `fill` writes no manifest. Nor is it written where
the format's writer cannot hold a list of entries, as in an HTML or XML
attribute. None of the three changes the exit code: failing a file for its side
record would block filling.

| Surface | Addition |
|---|---|
| pretty, written | `    meta-provenance  claude-sonnet-4-5: /intent, /title`, under the file, after its fields |
| pretty, schema | `    meta-provenance not written: this page's schemas do not allow it` |
| pretty, manifest | `    meta-provenance not written: owned by manifest private/meta.yaml, which manni meta fill does not write` |
| pretty, format | `    meta-provenance not written: html metadata cannot hold it` |
| JSON, `FillFileResult.metaProvenance` | `{"written": true, "entry": {"generated-by": "claude-sonnet-4-5", "fields": ["/intent"], "confidence": {"/intent": 0.9}}}`, or `{"written": false, "skipReason": "schema-mismatch"}`, or `{"written": false, "skipReason": "manifest-owned", "manifest": "private/meta.yaml"}`, or `{"written": false, "skipReason": "unwritable"}`. Absent when no field was written |
| `github` | nothing new; it is not an error |
| summary and exit codes | unchanged; the entry is not counted in `written` |

`metaProvenance` follows `FillFileResult`'s camelCase, beside `skipReason` and
`dryRun`. No flag and no usage error is added.

```bash
# 1. The minimum
manni meta fill docs/limits.md
# ✓ docs/limits.md
#     /intent  "Set request limits"  0.90
#     meta-provenance  claude-sonnet-4-5: /intent
# anthropic/claude-sonnet-4-5 · Threshold 0.7 · 1 file · 1 field written · 0 skipped

# 2. Scripting
manni meta fill docs/limits.md --dry-run -f json
#   "metaProvenance": {"written": true, "entry": {"generated-by": "claude-sonnet-4-5", "fields": ["/intent"], "confidence": {"/intent": 0.9}}}

# 3. A closed schema without the key: the field is written, the entry is not, exit 0
manni meta fill
#     meta-provenance not written: this page's schemas do not allow it

# 4. Every option at once; none is new
manni meta fill docs/ --fields intent,title --confidence 0.8 --provider anthropic \
  --model claude-sonnet-4-5 --collection site --ext md,mdx --exclude "docs/legacy/**" \
  --max-turns 20 --no-cache --dry-run -f json -c manni.config.yaml
```

## The pre-commit hook

A second hook joins `manni-meta` in `.pre-commit-hooks.yaml`, with the same
`files` pattern, which `test/pre-commit-hook.test.ts` asserts for both:

```yaml
- id: manni-meta-derive
  name: manni meta derive
  description: Stamp managed metadata, including provenance, before a commit
  entry: npx --yes @hawkeyexl/manni@latest meta derive
  language: system
  files: '(?i)\.(adoc|asciidoc|dita|ditamap|htm|html|markdown|md|mdx|rst|xml)$'
```

A repository lists it ahead of validation:

```yaml
repos:
  - repo: https://github.com/hawkeyexl/manni
    rev: vX.Y.Z
    hooks:
      - id: manni-meta-derive
      - id: manni-meta
```

pre-commit passes the staged files, and `derive` stamps them. With
`MANNI_GENERATED_BY` exported, the uncommitted lines are attributed by evidence
rule 1. Without it, only what history already evidences is stamped. When
`derive` changes a file, pre-commit stops the commit, as it does for any
formatter. Re-staging and committing again passes, because the stamp now reads
as current. The edit and its stamp then land in one commit, which evidence
rule 2 needs.

```bash
# 1. An agent session
export MANNI_GENERATED_BY=claude-fable-5
git commit -am "docs: rewrite the install steps"
# manni meta derive........................................................Failed
# - hook id: manni-meta-derive
# - files were modified by this hook
# docs/limits.md
#     provenance  lines 12-31: (unset) → claude-fable-5  (git: uncommitted)
git add -u && git commit -m "docs: rewrite the install steps"
# manni meta derive........................................................Passed
# manni meta validate......................................................Passed

# 2. A repository that manages nothing: derive's existing refusal, exit 2
# manni: nothing to derive: set derive.fields in manni.config.yaml or pass --fields
```

The hook is for repositories with `derive.fields` set. A shallow clone gets
0040's message, exit 2. `Generated-by:` stays readable as evidence rule 3 for a
tool that commits without the hook.

## Stress test

What was tried against this design, and what each attempt changed.

### 1. The first design added four verbs

The first sketch was `manni meta authorship add|check|update|log`, a copy of
cite's surface with a new pin engine behind it. Its one real advantage is worth
keeping in view. A pin that is never re-derived catches an edit nobody
recorded, where a derivation simply re-attributes. The costs were four verbs
that repeat `derive`'s inputs, a second implementation of the hashing rule, and
a `log` verb. That verb answered what `git log -p` on the page already shows.

**Changed as a result:** built on `derive`, which already reads git, parses
trailers, writes stamps and reports stale ones through `validate`, `get` and
`query`. The advantage survives in part: a range someone edited after the stamp
is `changed` until `derive` runs. No verb was needed. A later verb is welcome
where a job does not fit `derive`.

### 2. Sections were keyed by heading slug

The second sketch mapped a GitHub-style heading slug to the machines that wrote
the section, as `kg.sections` keys its typing. A slug is a copy of the heading
text. Renaming a heading orphans the key. In an external manifest, nothing sees
the heading change at all.

**Changed as a result:** an entry is a pin. It refers to content by where it is
and a hash of it, never by copying it. That is the rule the citation claim end
was redesigned to follow.

### 3. A new key, `authorship`, beside `provenance`

Keeping `provenance` for fields and adding `authorship` for prose left two keys
for one question, and four shapes for the field half of it. Nothing registers
`provenance` yet; one test and one fixture read the draft.

**Changed as a result:** `provenance` means prose attribution, and the field
attribution is renamed `meta-provenance`, absorbing the other three shapes.

### 4. One record for prose and fields

A single `provenance` with entries located by `lines` or by `pointer` was
considered. It would have made field attribution derived too, and retired the
delete-on-review loop, which is how a reviewer marks machine metadata as
checked.

**Changed as a result:** two keys. Prose attribution is derived. Field
attribution keeps its review semantics under a clearer name.

### 5. `blame` was its own source

A sixth source, `blame`, would let a monorepo keep `git` and skip the cost of
blame. That is a switch for something the configuration already says: blame is
needed exactly when `provenance` is in `derive.fields`.

**Changed as a result:** `provenance` derives from `git`, and the field list is
the switch.

### 6. The stamp carried `commit-sha`

With `commit-sha` in each entry, an entry written from uncommitted lines has no
commit. Committing it gives it one, the derived value differs, and `derive`
writes again. Every attribution became two commits.

**Changed as a result:** no `commit-sha`. Blame supplies the commit when the
record is read, and messages and `get` show it.

### 7. No evidence was read as a person

Reading "the commit names no machine" as "a person wrote it" made every
after-the-fact attribution stale on the next check. Git has nothing to say
about lines a person attributes later.

**Changed as a result:** no evidence is not a contradiction. A pin that matches
over lines whose commit names no machine is current.

### 8. The stamp is part of the body in HTML, XML and DITA

0040 records that `bodyOf` returns the whole content for a format whose
metadata is not fenced, so a stamp write counts as a body change. For
`last-updated` that self-triggers a date. For `provenance` it is worse: the
stamp shifts and changes the very lines it pins.

**Changed as a result:** in those formats `derive` refuses to stamp
`provenance` into the page, as a per-file error. It names the manifest as the
place to keep it. A manifest pin over those pages works, because the manifest
is not part of the page.

### 9. A person edits inside an agent's range

An agent's stamp pins body lines 3 to 8, and a person changes line 5. The pin
no longer matches: `changed`. `derive` re-blames. Lines 3, 4 and 6 to 8 still
come from the agent's commit, whose own blob carried the stamp. So evidence
rule 2 keeps them with the agent. Line 5 comes from the person's commit and has
no evidence.

**Changed as a result:** nothing; this is the case the generalized decision 2
exists for. The blame ladder reproduces it, and it is the demo.

### 10. A squash merge

Blame collapses the branch onto the squash commit, which carries no trailer of
its own. Its blob carries every stamp written on the branch.

**Changed as a result:** nothing. Evidence rule 2 reads the stamps from the
squash commit, and the ladder reproduces it.

### 11. A reflow across a page

Every line changes, so every pin is `changed`, and the next `derive` finds no
machine evidence on the reflow commit.

**Changed as a result:** nothing, and the loss is stated. The bytes the machine
wrote are no longer there. A formatter run belongs in its own commit, before or
after attribution, not between an edit and its stamp.

### 12. Two ranges with identical text

A repeated admonition or a duplicated step has one integrity for two places.

**Changed as a result:** the tie rule. Integrity matches first, then the nearest
`lines` value. The ladder reproduces it.

### 13. kg loses a guard

`kg.provenance` enumerated the twelve fields a machine may fill, so a machine
attribution on `sections`, `revision-of` or `derived-from` failed the schema.
Those three are curated by hand. A free JSON Pointer cannot express that.

**Changed as a result:** the guard moves from the schema to kg's harvest, which
reports a `meta-provenance` pointer under `/kg/sections`, `/kg/revision-of` or
`/kg/derived-from`. The kg review page's pointer to this proposal says so.

### 14. A `machines` glob that is too wide

`*noreply*` would catch the GitHub no-reply addresses real contributors commit
with, and remove them from `authors`.

**Changed as a result:** the default stays `["*[bot]"]`, the example uses an
exact address, and the configuration reference recommends exact addresses.

### 15. Cost

0040 reads each file's history only back to its first body-changing commit.
Blame reads every line's history, and there is no shortcut for it.

**Changed as a result:** blame runs only when `provenance` is managed. The
implementation caches nothing for it. `derive`'s existing cache holds merged
review answers, which never change, and a blame answer changes with every
commit. `--no-cache` still governs the review cache alone. The configuration
reference states the cost.

### 16. `*[bot]` was a character class

The reference ladder matched `derive.machines` with plain `picomatch`, which
reads `[bot]` as a character class. The default then matched any name ending
in `b`, `o` or `t`, so Scott and Matt counted as machines and left `authors`.

**Changed as a result:** brackets in a `machines` glob are literal, so the
default keeps 0040's exact `[bot]`-suffix behaviour. The ladder asserts that
Scott and Matt are people.

### 17. The bias check cannot narrow to a section

An eval's `target` is `body`, `raw`, `frontmatter` or a companion file. None
names lines, so a judge grading one section is compared with every machine that
wrote any part of the body.

**Changed as a result:** nothing in this proposal. The check is whole-body, and a
lines form for `target` is left to a later evals draft.

### 18. `fill`'s re-check drops errors at the root

`fill` re-validates the patched document but keeps only errors under a field.
`additionalProperties` reports at the root, so a closed schema that disallows
`meta-provenance` would have let the entry through.

**Changed as a result:** the entry is checked on its own, including root errors
that name it.

### 19. A manifest owns `meta-provenance`

`fill` fails a file when a key it must write belongs to a manifest. Applied to
the side record, one manifest entry would stop every page in the collection
from being filled.

**Changed as a result:** the entry is reported as not written, and the fields
are filled.

### 20. The hook stops the commit it stamps

A pre-commit hook that changes files fails the run. The first commit attempt
after an agent's edit therefore stops.

**Changed as a result:** accepted, as the pattern every formatter hook has. The
second attempt passes, and the stamp lands in the same commit as the edit. The
rejected alternative, a `prepare-commit-msg` hook writing `Generated-by:`,
never interrupts. But it needed a new verb or `sh` on the PATH, and it
attributes a commit rather than lines.

### 21. `fill` builds its pointers unescaped

`fill` spells a field's pointer as `/` plus the key, so a key holding `/` or `~`
gives a malformed pointer.

**Changed as a result:** `meta-provenance` pointers are escaped per RFC 6901,
and the implementation fixes the pointer where `fill` builds it.

### 22. A schema defines the provenance keys

A schema set that defines `provenance` or `meta-provenance` makes each a missing
field, and `fill` would ask the model for it.

**Changed as a result:** both are excluded from `fill`'s candidates and from the
metadata it sends.

## Verification

```bash
node docs/proposals/0046/ladders/provenance-examples.cjs   # 34 rungs + 8 structural checks, 42/42, exit 0
node docs/proposals/0046/ladders/blame-examples.cjs        # cases A-J and variants, 55 checks, golden hashes; exit 0
node docs/proposals/0023/ladders/evals-examples.cjs        # earlier drafts untouched
node docs/proposals/0023/ladders/artifact-evals-examples.cjs
node docs/proposals/0023/ladders/kg-examples.cjs
node docs/proposals/0044/ladders/citations-examples.cjs    # the pin this borrows
node dist/cli.js meta validate                             # the dogfood gate; exit 0
```

The ladders run today, with nothing registered and no `src/` change.

## Placement

The four drafts live under `docs/proposals/0023/schemas/`, beside the drafts
they revise. That is where 0023's review rounds put every revision, and it is
different from 0044's case. 0044 added a tenth id, which 0023's "Do not" rules
out, while this proposal revises four of the nine. `1.0.0-proposal.1` of
ai-context and kg, and `1.0.0-proposal.2` of evals and artifact-evals, are left
exactly as written. When `test/default-schema.test.ts` moves its pins to the
new drafts, `FIELDS["ai-context"]` becomes `meta-provenance`, `provenance`,
`risks` and `sample-questions` in the same commit. The family count stays 36,
one key out and one in, and the disjointness test confirms no other house id
claims the new one.

## Not breaking

The drafts are additive files, and nothing resolves them by default. The
implementation is `feat(meta):`, a minor release. It adds a new legal value
for `derive.fields`, a new optional key and a new option. It also adds a new
positional form that is legal only beside that option, and one more hook. The
one relaxed rule, a manifest owning `provenance`, turns an exit 2 into a
success. One behaviour is new for existing users: `fill` adds `meta-provenance` to pages
whose schemas allow it. The release notes say so.

## Consequences

- The implementation extracts cite's hashing and range parsing to
  `src/shared/`, so the family has one hashing rule in code as it does in
  prose.
- The implementation PR ships the demo video. Its story is stress test 9: an
  agent's stamp, a person's edit inside it, `validate` naming the line, one
  `derive`.
- `docs/content-strategy/cujs.md` gains M8. The meta reference pages for
  `derive` and configuration gain the option, the positional form, the key and
  the messages above.
- The CI recipes page gains `manni-meta-derive` beside `manni-meta`.
- 0023's design notes carry a dated ruling pointing here.
- No question is left open. [Review round 1](#review-round-1) records the
  answers.

## Review round 1

The first draft ended with five open questions. The answers:

| # | Question | Answer | What changed |
|---|---|---|---|
| 1 | Split the machine's name into model and agent? | No | An entry's `generated-by` is one name. No `Agent:` trailer, no second field |
| 2 | A hook that makes attribution automatic? | Yes, one that runs `derive` | [The pre-commit hook](#the-pre-commit-hook), chosen over a trailer hook; stress test 20 |
| 3 | Should `fill` write `meta-provenance`? | Yes | [`fill` writes meta-provenance](#fill-writes-meta-provenance); stress tests 18, 19, 21 and 22 |
| 4 | Should the bias check read `provenance`? | Yes, and drop the page-level `generated-by` | [The self-preference-bias check](#the-self-preference-bias-check); stress test 17 |
| 5 | Core or ai-context? | ai-context | Both keys stay in ai-context, which closes 0023's open question 7 for them |

The answers also removed a concern the first draft carried. Every key this
proposal renames or removes was only ever proposed. So there is no migration to
describe, only the draft-to-draft table.
