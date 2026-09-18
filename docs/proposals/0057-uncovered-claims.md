# 0057: uncovered claims, judged once and recorded

- **Status:** Proposed
- **Serves:** Two journeys.
  - Maya · M5, "Pin a claim and catch it going stale". Her citations cover the
    sentences she pinned. Nothing tells her which sentences she never pinned.
  - Devin · D5, "Gate citations in CI without blocking on prose". His gate
    stays deterministic, and a new rule rides the same baseline and formats.
- **Depends on:** Five earlier proposals.
  - [0044](0044-citations-and-drift.md) is the citation, the hashing rule, the
    claim search, the rule table, and the baseline identity a new rule joins.
  - [0017](0017-fill-egress-and-bounds.md) is the egress analysis this copies,
    and the provider flags this reuses rather than reinvents.
  - [0001](0001-validation-baseline.md) is the ratchet a new rule ramps in on.
  - [0034](0034-command-grammar.md) is the grammar, with one separator per list
    and no default subcommand.
  - [0041](0041-collections.md) is the document set both verbs read.
- **Supersedes, in part:** [0044](0044-citations-and-drift.md), for one
  sentence and for a new verb only. 0044's verdict says the check runs "from
  git alone, with no model and no network". That stays true of `check`. It
  stops being true of the domain, because a new verb asks a model. 0044 is
  left exactly as written.
- **Relates to:** Two proposals.
  - [0036](0036-a11y-fix.md) declined inference inside a gate, and named what a
    proposal would have to carry. This is that proposal, for cite rather than
    a11y.
  - [0054](0054-marker-reanchoring.md) shipped `marker-misplaced`, which made
    the rule table fifteen names long. It also decides what a misplaced marker
    covers, which step 2 below has to answer. See stress test 16.
- **Touches:** `src/cite/core/{runs,judge,verdicts}.ts` (new),
  `src/cite/core/{config,check-page,severity,adapt}.ts`,
  `src/cite/commands/{claims,check}.ts`, `src/cite/cli.ts`,
  `src/cite/reporters/{pretty,json,github,sarif,junit}.ts`, `src/cite/types.ts`,
  `src/cite/index.ts`,
  `docs/src/content/docs/cite/**`, `docs/content-strategy/cujs.md`,
  `test/cite/**`, `test/fixtures/cite/**`
- **Verdict:** Add `manni cite claims`. It segments a page's uncovered body
  lines into runs and asks a model whether each run asserts behaviour. Each
  verdict goes into a committed file. Add one rule, `claim-uncovered`, which
  `check` reports from that file alone. `check` keeps calling no model and
  opening no socket.

## Problem

A citation says when a pinned sentence went stale. It says nothing about a
sentence nobody pinned.

This project hit that on its own docs. Pull request
[#54](https://github.com/hawkeyexl/manni/pull/54) corrected nine claims in the
`manni key` pages against the code. One said no other command reads
`encryptionKeyPrevious`, when `key set` refuses while a valid one is present.
One said every command refuses a key of the wrong shape, when `key set` writes
over a malformed one. One said `key rotate` will not start beside a value it
cannot decrypt, when it runs, reports the skip and exits 1.

Every one of those sentences asserted behaviour. None carried a citation. So
`manni cite check` reported nothing, `manni meta validate` passed, and the docs
build stayed green. They surfaced because a person read the pull request diff
against the source. That is the check this proposal gives a name.

The cheap fix is worse than the gap. Report every changed body line and a
one-word typo fix becomes a finding beside a rewritten paragraph. An edit is not
a claim. A heading, a link, a sentence saying where a page sits in the set, and
a rewrapped line are all edits that assert nothing. Sorting those from the
sentences that do assert behaviour is a judgement, and no deterministic rule
makes it. A keyword list would flag "the command reads the config" and miss
"nothing else touches it".

So the work needs a model, and the gate must not have one.

## What 0044 and 0036 said

### 0044

The verdict is quoted in full, because one clause of it moves:

> The check classifies each pin as current, moved, changed, never true or
> missing, from git alone, with no model and no network.

Its economics section is blunter. "No model, no network, ever." The published
pages repeat it. `cite/index.mdx` says "It runs from git alone. No model, no
network, one hash per end on a clean run." Its "It doesn't" card lists "call a
model, or reach the network". `cite/reference/cli.mdx` says "No model and no
network are involved."

**The answer.** Every one of those sentences is about `check`, and every one
stays true of `check`. A verdict file changes what `check` *reads*, never what
it *calls*. Two runs of `check` on one commit with one verdict file always
agree, because the classification is a hash comparison against a recorded
boolean. What moves is the scope of the promise. It was a promise about the
domain, and it becomes a promise about the verb. The published sentences are
rewritten to name `check`, and a page for `claims` carries the egress table
below. 0044's file is untouched.

### 0036

0036 declined a model inside the a11y fixer, and said why:

> The only way to fill the right column without a person is inference, a model
> writing the alt text. That is `fill`'s territory, is not deterministic, and
> under 0017 sends the document off the machine. `fix` does not do that.

Its last consequence set the bar:

> Nothing here proposes a model writing alt text under the a11y domain. If that
> is ever wanted, it is a `fill`-shaped proposal with 0017's egress analysis
> attached.

**The answer.** Two halves, taken in order.

On determinism, the model never runs inside the gate. `claims` asks, and writes
the answer to a file a person reviews and commits. `check` reads the file. The
gate is then deterministic in the sense that matters. Two runs on one commit
agree, and a re-run cannot flip a check from red to green. A model call inside
`check` would have had neither property.

On egress, this is the `fill`-shaped proposal 0036 asked for. 0017's analysis
is attached below, as a table of what goes and a table of what never does.
The difference from `fill` is that the record stops the repeated calls.
`fill` sends a page on every run that fills it. `claims` sends a run once, and
never again until its text changes.

## Decision

### 1. A new verb, `manni cite claims`

It runs in four steps, and only the third needs a provider.

1. **Read the page's body.** Frontmatter is never read for content, only for
   the entries. Fenced code blocks, markers and HTML comments are dropped.
2. **Drop what a citation covers.** Every line inside an entry's `claim.lines`,
   and every line of the unit a marker anchors, is covered. A bare pin covers
   nothing, because it anchors no page text.
3. **Judge each remaining run.** A **run** is a maximal span of contiguous
   uncovered body lines inside one block. The blocks are a paragraph, a list
   item, a table row, a heading and a block quote's paragraph. The model is
   asked one question per run and answers a claim or not a claim.
4. **Record the verdict.** Both answers are written, so the next run re-judges
   only what changed.

A run's identity is the page path and the hash of its text under 0044's hashing
rule. Sentence splitting was rejected for step 3's unit. Abbreviations, code
spans and list punctuation make it a guess, and 0044's claim search is already
paragraph-scoped. A block is what a marker already anchors.

`--since <ref>` narrows the scope to the runs a git diff since that ref touches.
Without it, every uncovered run in the document set is in scope. The record, not
the flag, is what makes a second run cheap.

### 2. `check` reads only the record

With a verdict file, `check` recomputes each page's runs by the same
segmentation, hashes each one, and looks it up. A run whose hash matches a
recorded entry with a claim verdict is reported as `claim-uncovered`. Anything
else is silence. A recorded entry that matches no run today is a verdict about
text that has since been edited, and it is ignored.

`check` therefore calls no model and opens no socket. It reads one more file. It
needs no provider, no API key and no `@hawkeyexl/inference` construction. With
no verdict file it behaves exactly as it does today.

### 3. The record is committed

`.manni-cite-claims.json` at the repository root by default, `verdicts:` under
`cite:` in config, and `--verdicts [path]` on both verbs. It is committed, for
the same reason the baseline is. A verdict is a reviewable fact about the docs,
and a reviewer should see it arrive in a diff.

Both answers are recorded. A recorded `false` is what stops `claims` re-asking
about every heading on every run. Each entry pins the judged text with a hash
under 0044's hashing rule, so an edit invalidates that verdict rather than
reusing it. The record holds the hash and never the sentence, so the file leaks
no prose that was not already in the page.

### 4. `claim-uncovered` severity is configurable

It is the sixteenth rule, default `notice`, settable to `error`, `warning`,
`notice` or `off` like every other. A team may gate on it. main carries
fifteen, the fourteen 0044 shipped plus 0054's `marker-misplaced`. A rule
landing in parallel moves the ordinal and nothing else.

That is safe because the verdict is recorded. Two runs of `check` on one commit
read one file and reach one answer. A rule whose severity a team can raise to
`error` has to be reproducible, and a model call inside `check` would not have
been.

### 5. Providers come from where `fill` gets them

The dependency is `@hawkeyexl/inference`, already in `package.json` for
`meta fill`. The flags are `fill`'s flags, spelled the same way.

`--provider` takes `auto`, `anthropic`, `openai`, `claude-cli`, `llama-cpp` or
`mock`. `auto` detects one in the library's own order, which is an Anthropic
key, then an OpenAI key, then a `claude` CLI, then the local model. An
unavailable provider fails with the library's own message, verbatim, exit 2.
`--model` needs a named provider, as it does on `fill`. `--local` means
`llama-cpp` exactly as on `fill`, and refuses `claude-cli` with `fill`'s
sentence. Local is not forced, and `auto` behaves as it does on `fill`.

`--max-turns` is not added. One run is one call, so the call count is the run
count, and `--dry-run` prints it before anything is sent.

### 6. Egress, in 0017's terms

Per uncovered run, `claims` transmits:

| What | Exactly what goes |
|---|---|
| The page path | The path as it was matched, interpolated into the prompt. In a docs repository a path often names a product that is not public. |
| The run's text | The uncovered body lines, verbatim, after CRLF and BOM normalization. |
| The block holding them | The paragraph, list item, table row, heading or quote the run sits in. A run can be a fragment of a soft-wrapped sentence, and the block is what makes it judgeable. |
| The question | One fixed instruction and a two-value answer shape. No schema of yours, and no property description. |

And what never goes, each because `claims` never reads it:

| What | Why it cannot leave |
|---|---|
| Any source file | `claims` resolves no source. It takes no `--root` and builds no source index. |
| `source.file`, plain | An entry is read for its `claim.lines` and its marker id. No source field reaches the prompt. |
| `source.file`, encrypted | Same, and the ciphertext is never decrypted. |
| A decrypted path | No key is read. `claims` never touches `MANNI_ENCRYPTION_KEY` or `encryptionKey:`. |
| `provenance`, `meta-provenance` | Frontmatter never reaches the prompt at all, so these need no removal step. |
| Every other frontmatter field | Same. |
| A covered line | Dropped in step 2, before a prompt exists. |
| Fenced code, markers, comments | Never part of a run. |

And what is retained afterwards:

| Item | What is kept |
|---|---|
| The verdict record | Page path, run hash, the boolean, the body lines, the provider and model id, and a timestamp. Never the text. |
| The verdict cache | `.manni/cite/claims-cache`, keyed by prompt version, provider, model and run hash. It holds the boolean only. `--no-cache` bypasses it. |

`--dry-run` prints the run count and the exact byte count of every prompt it
would send, then stops. It calls nothing and writes nothing. That reading is
free, because the count needs no model.

`fill --dry-run` is documented as a review gate rather than an egress control,
and the difference is worth naming. Both flags mean the same thing, which is
that nothing is written. On `fill` the preview is the proposal, and a proposal
needs the call. On `claims` the preview is a count, and a count needs no call.
One rule, two costs.

## The interface

### Config

Before, this repository's own `manni.config.yaml`, abridged. It carries no
`cite:` section at all, because every cite key is a default:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/

tools:
  vale:
    config: .vale.ini

meta:
  overrides:
    - collection: site
      schemas:
        - ./docs/doc-frontmatter.schema.json
        - astro:starlight:0.41

a11y:
  severity: notice
```

After, for a repository that adopts the verb and gates on it:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    url: http://127.0.0.1:4321/manni/

tools:
  vale:
    config: .vale.ini

meta:
  overrides:
    - collection: site
      schemas:
        - ./docs/doc-frontmatter.schema.json
        - astro:starlight:0.41

a11y:
  severity: notice

cite:
  verdicts: .manni-cite-claims.json
  severity:
    claim-uncovered: error
  claims:
    provider: anthropic
    model: claude-sonnet-4-6
    concurrency: 4
```

A repository that never wants the verb writes none of that, and this repository
keeps its own config as it is. The new keys, `additionalProperties` false at
every level:

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `cite.verdicts` | path | `.manni-cite-claims.json` | no | The verdict record, relative to the config file. Read by `check` and written by `claims`. |
| `cite.claims.provider` | string | `auto` | no | Inference provider for `claims`. One of `auto`, `anthropic`, `openai`, `claude-cli`, `llama-cpp`, `mock`. An unknown name is an error, exit 2. |
| `cite.claims.model` | string | provider default | no | Model override. Needs `provider` set to something other than `auto`, exit 2 otherwise. |
| `cite.claims.concurrency` | number | `4` | no | Runs judged in parallel, between 1 and 64. |
| `cite.severity.claim-uncovered` | level | `notice` | no | `error`, `warning`, `notice` or `off`, joining the fifteen rule names already accepted. |

There is no key that turns `claims` on, and no key that lets `check` call a
model. The verb is the switch. That is the "detect, don't switch" rule applied
to the one thing the tool cannot detect. Whether a team wants a model involved
at all is not a fact about the machine.

### `manni cite claims`

```
manni cite claims [paths...] [options]
```

| Option | Argument | Default | Description |
|---|---|---|---|
| `--since` | `<ref>` | none | Judge only the runs a git diff since this ref touches. Without it, every uncovered run in the set is in scope. An unresolvable ref is an error, exit 2. |
| `--verdicts` | `[path]` | config `verdicts:`, else `.manni-cite-claims.json` | The record to read and write. The value is optional. |
| `--rejudge` | n/a | off | Ignore recorded verdicts for the runs in scope and ask again. Implies `--no-cache`. |
| `--prune` | n/a | off | Drop recorded entries whose text is no longer a run on their page. |
| `--dry-run` | n/a | off | Print the run count and the exact prompt byte count, then stop. Calls nothing and writes nothing. |
| `--provider` | `<name>` | `auto` | `auto`, `anthropic`, `openai`, `claude-cli`, `llama-cpp` or `mock`. An unknown name is an error, exit 2. |
| `--model` | `<model>` | provider default | Model override. Needs a named provider, from `--provider` or config. Pairing it with `auto` is an error, exit 2. |
| `--local` | n/a | off | Run inference on this machine. Refuses a hosted provider even under `auto`, `claude-cli` included. |
| `--no-cache` | n/a | cache on | Bypass the verdict cache in `.manni/cite/claims-cache`. |
| `--concurrency` | `<n>` | `4` | Runs judged in parallel. |
| `-f, --format` | `<pretty\|json\|github>` | `pretty` | Output format. `sarif` and `junit` are refused, exit 2. They describe findings, and `claims` produces verdicts. |
| `--collection` | `<name>` | every collection | Narrow the run to named collections. Repeatable, one name per occurrence. |
| `--ext` | `<list>` | supported extensions | Comma-separated extensions for directory and glob walks. |
| `--exclude` | `<glob>` | n/a | Glob to exclude. Repeatable, never comma-split. |
| `--as` | `<format>` | n/a | Force an input format. |
| `-c, --config` | `<path>` | discovered | The config file. |
| `--no-config` | n/a | off | Ignore any discovered config. |
| `-q, --quiet` | n/a | off | In `pretty`, hide pages with no run in scope. |
| `--allow-empty` | n/a | off | Treat zero matched files as success. |
| `--no-gitignore` | n/a | on | Read files `.gitignore` covers. |

`claims` takes no `--root`, no `--reveal`, no `--show-diff` and no
`--no-check-sources`. None of them has a meaning for a verb that never reads a
source. It takes no `-` either, because a page from stdin has no path and a
verdict is keyed by one.

Exit `0` when every run in scope was judged and the record was written. Exit `1`
for partial success, meaning work was left undone, matching `update`'s exit
contract. Exit `2` for a `CiteError`.

### `manni cite check`, the two additions

| Option | Argument | Default | Description |
|---|---|---|---|
| `--verdicts` | `[path]` | config `verdicts:`, else `.manni-cite-claims.json` | Report `claim-uncovered` from this record. A named file that does not exist is an error, exit 2. |
| `--no-verdicts` | n/a | off | Ignore a record supplied by config for this run. |

Every other flag, the baseline, the five formats and the exit contract are
unchanged. The default record path is read when it exists and passed over in
silence when it does not.

### The record

```json
{
  "version": 1,
  "verdicts": [
    {
      "file": "docs/src/content/docs/key/reference/cli.mdx",
      "integrity": "sha256-c41f09aa7d2b4e6f8a0c1d3e5f708192a3b4c5d6e7f8091a2b3c4d5e6f708192",
      "lines": "212-213",
      "claim": true,
      "prompt": "claims-1",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "judged": "2026-09-14T09:12:44Z"
    },
    {
      "file": "docs/src/content/docs/key/reference/cli.mdx",
      "integrity": "sha256-0b7e5c9a1d2f3e4b5a6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2",
      "lines": "4",
      "claim": false,
      "prompt": "claims-1",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "judged": "2026-09-14T09:12:44Z"
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | number | The record format. This build writes and reads `1`. |
| `file` | path | The page, repository-root relative, as the baseline spells a path. |
| `integrity` | `^sha256-[0-9a-f]{64}$` | The judged text under 0044's hashing rule. Always plain, because the page is public. |
| `lines` | string | Body lines, in `"L"` or `"L1-L2"` form. Advisory, and never used for lookup. See the refresh rule below. |
| `claim` | boolean | The verdict. `true` asserts behaviour. |
| `prompt` | string | The judging prompt's version. A bump makes `claims` re-ask and leaves `check` reading the entry. |
| `provider` | string | The provider that answered. |
| `model` | string | The model that answered. |
| `judged` | ISO 8601 timestamp | When it answered. |

Entries are sorted by `file` then `integrity`, so two people judging different
pages produce a diff that merges by line. Lookup is by `file` and `integrity`
together. An entry whose `version` this build does not know is an error rather
than a silent skip.

**The refresh rule.** Text can sit at new lines with its hash unchanged, when a
paragraph above it grew. `claims` then reuses the verdict and rewrites `lines`
to where the text sits now. Nothing else on a reused entry is rewritten, so
`judged`, `provider`, `model` and `prompt` keep saying when and what answered.
A timestamp that moved without a model being asked would be a lie about the
record.

The scope is what the run read. `claims` refreshes `lines` for every page it
read, and leaves an entry for a page outside the scope exactly as it found it.
Segmentation is deterministic, so the same command on one commit computes the
same lines every time. `check` never reads `lines` at all, which is why a
refresh cannot change a finding.

### Messages and exit codes

| Situation | stderr or stdout | Exit |
|---|---|---|
| No provider is available under `auto` | The library's own message, verbatim, prefixed `manni: `. cite never rewords it. | 2 |
| `--local` on a machine with no local runtime | The library's own message, verbatim. | 2 |
| `--local` resolved to `claude-cli` | `manni: --local cannot use "claude-cli": the CLI runs on this machine but its inference does not. Use --provider llama-cpp.` | 2 |
| `--local` with a hosted provider named | `manni: --local cannot use "anthropic", which sends document content to a hosted API. Use --provider llama-cpp, or drop --local.` | 2 |
| The record was written by a newer manni | `manni: .manni-cite-claims.json was written by a newer manni: version 4, and this build reads 1. Upgrade manni, or delete the file and run manni cite claims.` | 2 |
| The record is not a verdict record | `manni: .manni-cite-claims.json:1: not a verdict record. Delete it and run manni cite claims.` | 2 |
| A record entry is malformed | `manni: .manni-cite-claims.json: verdict 12 has no integrity. Delete it and run manni cite claims.` | 2 |
| `--verdicts nowhere.json` on `check` | `manni: File not found: "nowhere.json".` | 2 |
| Some runs were left unjudged | `manni: 3 of 41 runs were not judged. The record holds the other 38; run manni cite claims again.` | 1 |
| git is unavailable and `--since` was given | `manni: --since needs git, and git is not available here.` | 2 |
| `--no-config` on a page carrying no `citations:`, said once per run | `manni: --no-config reads frontmatter only, and citations may live in a manifest a collection declares. docs/limits.md was judged as though it had none.` | unchanged |
| `--local` with no weights on disk | The library's own warning before it fetches, verbatim. | unchanged |

Every message names a file and an action. None of them echoes a run's text,
because a diagnostic that quotes prose would put it in CI logs. The two
`unchanged` rows are warnings rather than refusals, so the run continues and
decides its own exit code.

### What `claim-uncovered` prints

`pretty` adds one row per uncovered claim under the page, beneath the citation
rows. The row reads the file lines, the rule, and when and by what it was
judged:

```
ℹ docs/src/content/docs/key/reference/cli.mdx
    ✓ rotate-order    :188 current          src/key/commands/rotate.ts:514-563 current
    ℹ uncovered       :212-213               judged 2026-09-14, anthropic/claude-sonnet-4-6

1 file checked, 1 passed, 0 failed, 1 finding (1 notice)
```

At `error` severity the mark is `✗`, the file is `✗`, and the run fails. The
row never quotes the sentence. A reader has the line.

`json` carries it as a finding on the page, with the shape 0044 gave every
finding and three fields of its own:

```json
{
  "rule": "claim-uncovered",
  "ruleId": "manni:cite/claim-uncovered",
  "severity": "notice",
  "message": "No citation covers the claim at lines 212-213.",
  "line": 212,
  "lines": "212-213",
  "id": null,
  "src": null,
  "index": null,
  "judged": "2026-09-14T09:12:44Z",
  "judgedBy": "anthropic/claude-sonnet-4-6"
}
```

`id`, `src` and `index` are `null`, because the finding belongs to no entry.
The run's text and its hash are not in it.

`github` prints one annotation per finding, on the run's first line:

```
::notice file=docs/src/content/docs/key/reference/cli.mdx,line=212,title=manni%3Acite/claim-uncovered::No citation covers the claim at lines 212-213.
```

`sarif` is cite's own renderer over meta's envelope. `ruleId` is
`manni:cite/claim-uncovered`, `level` is `note` at `notice`, `warning` at
`warning` and `error` at `error`, and `region.startLine` is the run's first
line. Two things the renderer keeps per rule need a new entry. The
`RULE_DESCRIPTIONS` row reads "A run of body lines asserts behaviour and no
citation covers it." The `helpUri` points at the rule's row of the citations
reference, which means `citations.mdx` gains a `<span id="claim-uncovered">`
row like `marker-misplaced`'s.

`junit` is cite's renderer too, under the `manni.cite` classname, with the
message the `github` annotation carries. A notice or a warning is not a
`<failure>` and its testcase passes. At `error` the file's testcase carries one
`<failure>` per finding, which matches the exit code.

The baseline takes it like any rule. Under 0044's identity, `schema` is
`manni:cite`, `keyword` is the rule name, `instancePath` is empty because there
is no entry, and `subject` is the run's integrity. So a paragraph reworded after
being baselined comes back as new, and one that merely moved down the page does
not.

### What `claims` prints as JSON

`-f json` on `claims` is a first-class interface, because the scripting rung
below pipes it. Its shape:

```json
{
  "pages": [
    {
      "file": "docs/src/content/docs/cite/index.mdx",
      "runs": [
        {
          "lines": "26",
          "integrity": "sha256-c41f09aa7d2b4e6f8a0c1d3e5f708192a3b4c5d6e7f8091a2b3c4d5e6f708192",
          "claim": true,
          "reused": false,
          "judged": "2026-09-17T11:02:08Z",
          "judgedBy": "anthropic/claude-sonnet-4-6"
        }
      ]
    }
  ],
  "verdicts": { "file": ".verdicts.json", "written": 2, "reused": 0, "pruned": 1, "entries": 2141 },
  "egress": { "prompts": 2, "bytes": 3114, "dryRun": false },
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "exitCode": 0
}
```

| Field | Type | Always | Meaning |
|---|---|---|---|
| `pages` | array | yes | One object per page read, in input order. Empty on a run that matched nothing under `--allow-empty`. |
| `pages[].file` | string | yes | The page, repository-root relative, as the record spells it. |
| `pages[].runs` | array | yes | Every uncovered run in scope on that page, in body order. Empty when the page has none. |
| `pages[].runs[].lines` | string | yes | Body lines, in `"L"` or `"L1-L2"` form. |
| `pages[].runs[].integrity` | string | yes | The run's hash, which is its key in the record. A hash carries no prose, so it is safe in a log. |
| `pages[].runs[].claim` | boolean or null | yes | The verdict. `null` when the run was not judged, which is every run under `--dry-run` and the leftover runs at exit 1. |
| `pages[].runs[].reused` | boolean | yes | Whether the verdict came from the record rather than from a model. |
| `pages[].runs[].judged` | timestamp or null | yes | When a model answered, from the record for a reused verdict. `null` when `claim` is `null`. |
| `pages[].runs[].judgedBy` | string or null | yes | `provider/model` that answered. `null` when `claim` is `null`. |
| `verdicts.file` | string | yes | The record's path, as it was given. |
| `verdicts.written` | number | yes | Entries written. `0` under `--dry-run`. |
| `verdicts.reused` | number | yes | Entries whose verdict was reused. |
| `verdicts.pruned` | number | yes | Entries dropped. `0` without `--prune`. |
| `verdicts.entries` | number | yes | Entries in the record after the run, which is how stress test 2's growth stays visible. |
| `egress.prompts` | number | yes | Prompts sent, or under `--dry-run` prompts that would be sent. |
| `egress.bytes` | number | yes | UTF-8 bytes of those prompts. |
| `egress.dryRun` | boolean | yes | Which of the two readings the two numbers carry. |
| `provider` | string | yes | The resolved provider, never `auto`. Under `--dry-run` it is the requested value, `auto` included, because no detection runs. |
| `model` | string or null | yes | The resolved model, or the requested one under `--dry-run`. `null` when neither was set. |
| `exitCode` | number | yes | `0`, `1` or `2`. |

`egress` is always present, on a real run as well as under `--dry-run`. A
pipeline recording what left the machine should not have to run the command
twice to learn it. A run that reused every verdict says so as
`{"prompts": 0, "bytes": 0, "dryRun": false}`. `dryRun` is what separates bytes
that left from bytes that would have.

### The ladder

The minimum that does something useful. One page, the default provider, the
default record:

```console
$ manni cite claims docs/src/content/docs/key/reference/cli.mdx
docs/src/content/docs/key/reference/cli.mdx: 41 runs, 38 new
    claim      :212-213
    claim      :226
    no claim   :4
    ...
.manni-cite-claims.json: 38 verdicts written, 3 reused
# exit 0
```

Then `check` reports them, with the default severity:

```console
$ manni cite check docs/src/content/docs/key/reference/cli.mdx
ℹ docs/src/content/docs/key/reference/cli.mdx
    ℹ uncovered       :212-213               judged 2026-09-14, anthropic/claude-sonnet-4-6
    ℹ uncovered       :226                   judged 2026-09-14, anthropic/claude-sonnet-4-6

1 file checked, 1 passed, 0 failed, 2 findings (2 notices)
# exit 0
```

The config fallback. No paths, so the set is every declared collection:

```console
$ manni cite claims
101 pages, 2,140 runs, 0 new
.manni-cite-claims.json: 2,140 verdicts reused
# exit 0
```

The egress preview, which is the rung to read before the first real run:

```console
$ manni cite claims --dry-run
101 pages, 2,140 runs, 2,140 would be judged
2,140 prompts, 3,118,442 bytes
Nothing was sent, and nothing was written.
# exit 0
```

The pull request rung, narrowed to what the branch touched:

```console
$ manni cite claims --since origin/main
docs/src/content/docs/cite/index.mdx: 6 runs, 2 new
    claim      :26
    no claim   :19
.manni-cite-claims.json: 2 verdicts written, 4 reused
# exit 0
```

The CI gate, with `claim-uncovered` at `error` in config. It calls no model:

```console
$ manni cite check -f github
::error file=docs/src/content/docs/cite/index.mdx,line=26,title=manni%3Acite/claim-uncovered::No citation covers the claim at line 26.
# exit 1
```

The scripting form:

```console
$ manni cite claims --since origin/main -f json | jq '[.pages[].runs[] | select(.claim)] | length'
2
# exit 0
```

The local form, which sends nothing off the machine:

```console
$ manni cite claims --provider llama-cpp --model granite-4.1-3b-q2 docs/
101 pages, 2,140 runs, 2,140 new
.manni-cite-claims.json: 2,140 verdicts written, 0 reused
# exit 0
```

Every option at once:

```console
$ manni cite claims docs/ - --as mdx --since origin/main --verdicts .verdicts.json \
    --rejudge --prune --provider anthropic --model claude-sonnet-4-6 \
    --no-cache --concurrency 8 --collection site --ext md,mdx \
    --exclude "**/proposals/**" --exclude "**/schemas/**" \
    -f json -c manni.config.yaml -q --allow-empty --no-gitignore
manni: cite claims cannot read stdin: a verdict is keyed by the page's path.
# exit 2
```

The maximal rung is a usage error, and that is the finding. `-` cannot appear
on this verb, and the every-flag form is the invocation that shows it. Without
`-` and without `--collection`, which positional paths already exclude:

```console
$ manni cite claims docs/ --as mdx --since origin/main --verdicts .verdicts.json \
    --rejudge --prune --provider anthropic --model claude-sonnet-4-6 \
    --no-cache --concurrency 8 --ext md,mdx \
    --exclude "**/proposals/**" --exclude "**/schemas/**" \
    -f json -c manni.config.yaml -q --allow-empty --no-gitignore
{
  "pages": [
    {
      "file": "docs/src/content/docs/cite/index.mdx",
      "runs": [
        {
          "lines": "26",
          "integrity": "sha256-c41f09aa…",
          "claim": true,
          "reused": false,
          "judged": "2026-09-17T11:02:08Z",
          "judgedBy": "anthropic/claude-sonnet-4-6"
        },
        {
          "lines": "19",
          "integrity": "sha256-0b7e5c9a…",
          "claim": false,
          "reused": false,
          "judged": "2026-09-17T11:02:08Z",
          "judgedBy": "anthropic/claude-sonnet-4-6"
        }
      ]
    }
  ],
  "verdicts": { "file": ".verdicts.json", "written": 2, "reused": 0, "pruned": 1, "entries": 2141 },
  "egress": { "prompts": 2, "bytes": 3114, "dryRun": false },
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "exitCode": 0
}
# exit 0
```

The two `integrity` values are abbreviated here for the page. The real output
carries the full sixty-four hex characters, as the record does.

### The usage errors

| Invocation | stderr | Exit |
|---|---|---|
| `cite claims -` | `manni: cite claims cannot read stdin: a verdict is keyed by the page's path.` | 2 |
| `cite claims` with no paths and no collections | `manni: no input. Name a path, or declare a collection under collections:.` | 2 |
| `cite claims nowhere/` | `manni: File not found: "nowhere/".` | 2 |
| `cite claims --provider antropic` | `manni: unknown provider "antropic". Expected auto \| anthropic \| openai \| claude-cli \| llama-cpp \| mock.` | 2 |
| `cite claims --model claude-sonnet-4-6` | `manni: --model needs --provider: a model name does not say which provider owns it.` | 2 |
| `cite claims --concurrency 0` | `manni: --concurrency must be between 1 and 64.` | 2 |
| `cite claims -f sarif` | `manni: sarif is a findings format, and cite claims produces verdicts. Expected pretty \| json \| github.` | 2 |
| `cite claims --since nope` | `manni: --since "nope" is not a ref this repository resolves.` | 2 |
| `cite claims --collection site docs/` | `manni: --collection cannot be combined with positional paths.` | 2 |
| `cite claims --root ../code` | `error: unknown option '--root'` | 2 |
| `cite check --verdicts nowhere.json` | `manni: File not found: "nowhere.json".` | 2 |
| `severity: {claim-uncovered: fatal}` | `manni: manni.config.yaml: cite.severity.claim-uncovered "fatal" is not a level. Expected notice \| warning \| error \| off.` | 2 |
| `cite: {claims: {provider: auto, model: x}}` | `manni: manni.config.yaml: cite.claims.model needs cite.claims.provider set to something other than "auto".` | 2 |
| `cite: {claims: {verdicts: x}}` | `manni: manni.config.yaml: cite.claims does not carry "verdicts". It is cite.verdicts, which check reads too.` | 2 |

### The programmatic API

`src/index.ts` is unchanged. The cite barrel, `src/cite/index.ts`, gains these:

| Export | Kind | What it is |
|---|---|---|
| `runsOf` | function | Segments a read page into uncovered runs |
| `Run` | interface | One run, with its lines, text and integrity |
| `judgeRuns` | function | The provider call, one run per call |
| `JudgeOptions` | interface | Provider, model, local, cache, concurrency |
| `CLAIMS_PROMPT_VERSION` | const | The `prompt` value written into the record |
| `readVerdicts`, `writeVerdicts` | functions | The record's two halves |
| `VerdictRecord`, `Verdict` | interfaces | The record and one entry |
| `runClaims` | function | The `claims` command core |
| `renderClaimsPretty`, `renderClaimsJson`, `renderClaimsGithub` | functions | The three reporters |

`CITE_RULES` in `src/cite/types.ts` gains `claim-uncovered`, so
`DEFAULT_SEVERITY` carries it and `isCiteRule` accepts it. All three are
already exported, so none of them is a new name. cite's SARIF renderer's
`RULE_DESCRIPTIONS` gains its row, which is internal.

## Stress test

What was tried against this design, and what each attempt changed.

### 1. No verdict file at all

The common case on day one, and the case in every repository that never adopts
the verb. `check` finds nothing at the default path, reports no
`claim-uncovered`, and behaves exactly as it does today.

A missing record is silence rather than a notice. An earlier draft warned once,
on the theory that a team might have deleted the file by accident. It was wrong.
Every repository that never runs `claims` would carry that warning forever, and
a warning nobody can act on teaches people to ignore warnings.

**Changed as a result:** a missing record at the *default* path is silence. A
record named explicitly, by `--verdicts <path>` or by `verdicts:` in config,
must exist, and its absence is exit 2. Naming a file is a statement that it is
there.

### 2. A verdict whose text was edited since

Lookup is by hash, so an edited run hashes to nothing in the record and the
verdict is not reused. `check` reports nothing for it, and the next `claims`
run judges it again.

The residue is a stale entry that matches no run. It costs bytes in the record
and nothing else, and `--prune` drops it. Pruning is not the default, because a
sentence often comes back in the next commit, and a pruned verdict is a call
paid for twice.

**Changed as a result:** `--prune` exists as a flag rather than as behaviour.
The record's entry count is reported on every run, so growth stays visible.

### 3. A verdict recorded by a different model

The record names the provider and the model that answered. An earlier draft had
`check` ignore an entry whose model did not match the current config. That was
worse in both directions. A team that switches models would silently lose its
whole gate. A team with no `claims` config would lose it on a provider default
change.

**Changed as a result:** `check` honours every entry, whatever answered it, and
the pretty row names the model so a reviewer can see it. `claims --rejudge`
re-asks under the current provider. The same rule covers a `prompt` version
bump, which makes `claims` re-ask and leaves `check` reading what is there.

A verdict is a fact a person committed. Which model produced it is provenance,
not validity.

### 4. A page whose citations live in a sidecar

0044 lets a collection keep its citations in an external-metadata manifest.
Step 2 of `claims` has to drop covered lines, and those lines are named in a
file the page does not mention.

`claims` reads a page's citations exactly as `check` does, through meta's merge
over every collection in the config. So a page checked by path still finds its
sidecar, and its covered lines are dropped. `--no-config` reads frontmatter
only, and on a sidecar repository that would judge already-cited sentences as
uncovered.

**Changed as a result:** `claims` under `--no-config` warns once when the page
carries no `citations:` of its own. Its wording is the row for it in the
messages table above. The record is still written, because the verdicts are
correct about the text and only the coverage was narrow.

### 5. A run with no provider available

`auto` probes an Anthropic key, an OpenAI key, a `claude` CLI, then the local
runtime. On a machine with none of those the library refuses, and cite prints
the library's message verbatim at exit 2.

cite does not reword it and does not add advice. 0017 recorded that the
`claude-cli` probe is weaker than it reads, and a second tool paraphrasing a
detection message is a second thing to go stale. The message belongs to the
package that does the detecting.

**Changed as a result:** the refusal is passed through, as `fill` passes it
through today. Nothing is written, so a refused run leaves the record exactly
as it was.

### 6. `--local` on a machine with no weights

`--local` resolves to `llama-cpp`, and the first call fetches model weights,
under 10 GB and sized to the machine. On a laptop that is a long wait. On a CI
runner it is 0017's silent-download problem.

`claims` inherits `fill`'s answer rather than inventing one. The library warns
once before fetching, `INFERENCE_NO_AUTO_INSTALL=1` refuses the binding
install, and the guidance is to pin a provider in CI.

**Changed as a result:** `--dry-run` is documented as the first rung of the
ladder, before any provider flag. It prints the run count and the byte count
with no provider construction at all. So a person sees the size of the job
before a download starts.

### 7. A private repository that must never send text

The hardest case, and the one that decides whether the verb is safe to exist.

Three ways to turn it off, in increasing strength. Do not run `claims`, and
nothing is sent, because `check` never calls a provider. Set
`cite.severity.claim-uncovered: off`, and a record that appears anyway reports
nothing. Add `.manni-cite-claims.json` to `.gitignore` and the verb has nothing
to land in a diff, which makes an accidental run visible in `git status`.

The strong form is that `check` has no code path to a provider. It constructs no
`InferenceProvider`, imports no detection, and reads no API key. That is a
property a reviewer can grep for rather than a setting anyone can flip.

**Changed as a result:** the separation is a hard split between two commands
rather than a `--no-model` flag on one. A flag would have put the provider
construction inside `check` and left a wrong default one character away. The
`claims` page says all three of the above, in that order.

### 8. A CI job with no network

An air-gapped runner, and the case 0044's "no network, ever" was written for.

`check` runs. It reads pages, the record and git, and opens no socket. So the
gate works on a machine with no route out, and a team can adopt
`claim-uncovered` at `error` there.

`claims` does not run, unless the provider is `llama-cpp` with weights already
on disk. The failure is the library's refusal at exit 2, which is loud.

**Changed as a result:** nothing in the design, and the property is stated on
the page as a promise rather than left to be inferred. The published sentence
becomes "`manni cite check` runs from git alone", and the scope is the verb.

### 9. Should `claims` refuse to run in CI at all?

Considered seriously, and declined.

The argument for refusing is that a verb which spends money and sends prose has
no business inside an automated job. The record is the reviewable artefact, and
a CI job that writes it commits a verdict nobody read.

The argument against is stronger in two places. A scheduled job can run
`claims --since` on the default branch and open a pull request with the record.
That is a *good* use, and it is how a large docset gets covered without one
person running the verb for a week. And a refusal needs a CI detection, which
means reading `CI=true`. That is a switch for something the tool would be
guessing at. A developer with `CI` exported in their shell would be refused for
no reason.

**Changed as a result:** no refusal. Instead `claims` never fails a gate, since
it exits 0 or 1 on its own work and produces no findings. `check` is the only
verb with a `claim-uncovered` exit code, and it reads a file that arrived in a
diff. The CI page recommends the scheduled-job shape and says plainly that a
job which both judges and gates in one step reviews nothing.

### 10. Is a block the right unit, and what about a fragment?

A paragraph of three soft-wrapped lines where `claim.lines` covers the first
two. The third line is a run, and it holds the tail of the pinned sentence plus
the start of the next one. Judged alone it is a fragment.

That is why the prompt carries the block as well as the run. The model sees the
whole paragraph and is asked about the run's lines within it. The alternative
was to extend the run to the block boundary, which would send covered text and
break step 2's promise.

**Changed as a result:** the block goes in the prompt as context. The egress
table names it as its own row rather than folding it into the run's text. A
reader of that table should not have to work out that more than the run is
sent.

### 11. Does a recorded `false` become a silent allowlist?

Yes, and it is the sharpest cost of recording both answers.

A model that answers "not a claim" about a sentence that does assert behaviour
writes a `false` that nothing revisits. The sentence is then invisible to the
gate forever. That is worse than never having run the verb, because a team
believes the gate covers the page.

Three mitigations, none of them complete. The record is committed, so a `false`
arrives in a diff a person can read. `claims --rejudge` re-asks, and a prompt
version bump re-asks on the next run. And the verdict names the model, so a
sweep after a model change is one command.

**Changed as a result:** both answers are still recorded, because the
alternative is re-judging every heading on every run. The residue is stated
plainly on the page. `claim-uncovered` finds sentences nobody pinned. It does
not promise to find all of them, and a `false` verdict is the shape of that
limit.

### 12. `claim-uncovered` at `error` on a pull request that adds a paragraph

A contributor adds three paragraphs of prose. Two assert behaviour. With the
rule at `error` and no citation, the pull request is red, and the contributor
has to mint two citations to land a docs change.

For some teams that is the point, and it is why the level is configurable. For
most it is 0036's "seven rules" problem in reverse, which is a gate that blocks
work it cannot help with.

**Changed as a result:** the default is `notice`, the lowest level the family
has, and the baseline covers the rule like every other. The recommended shape
is the one 0044 recommends for `source-changed`, which is `--baseline` on the
pull request job and a scheduled sweep that escalates. The `claims` page leads
with `notice` and names `error` as the ratchet's end state.

### 13. Two branches run `claims` and the record conflicts

Two people judge different pages on two branches. Both write
`.manni-cite-claims.json`, and git sees one file changed twice.

Entries are sorted by `file` then `integrity`, and each is one JSON object on
its own lines. So two branches that touched different pages produce
non-overlapping hunks and merge cleanly. Two branches that judged the *same*
page conflict. The resolution is to take either side and run `claims` again,
which reuses whatever survived and judges the rest.

**Changed as a result:** the sort order and the one-entry-per-object layout
belong to the record's spec rather than to an implementation. A record written
in hash order, or as one line, would conflict on every parallel branch.

### 14. Why not report every changed line and let a person filter?

The deterministic alternative, and it needs no model, no record and no new
egress.

It was tried on this repository's own history. A docs pull request changes
between twenty and four hundred body lines. Reporting each one as a finding
gives a reviewer a list they read once and then turn off. The signal that
matters, which is the two sentences that assert behaviour, is buried in the
rewraps, the heading edits and the link updates.

A keyword list was tried as the middle path. It flags "the command reads the
config" and misses "nothing else touches it", and both are claims about
behaviour. Tuning it is a prose linter, which this project has already declined
to build.

**Changed as a result:** nothing in the design. The alternative is recorded so
the next person does not re-derive it. A model is here because the judgement is
a judgement. It sits outside the gate because a gate has to be reproducible.

### 15. A table row, a heading and a list item

Three block kinds that are not paragraphs, and all three carry claims. A
reference table's row says what a flag defaults to. A heading rarely asserts
anything. A list item often does.

An earlier draft judged paragraphs only, and it missed the whole of
`cli.mdx`, whose claims live almost entirely in tables. That is the file
pull request #54 corrected.

**Changed as a result:** a table row, a heading, a list item and a block
quote's paragraph are all blocks. A run sits inside one of them. A heading that
asserts nothing costs one `false` verdict, recorded once, and is never asked
about again.

### 16. A marker that 0054 calls misplaced

0054 shipped, so a marker line inside a paragraph is `marker-misplaced`, a
warning, and `cite update` moves it where `add --marker` writes markers. Step 2
of `claims` has to decide what such a marker covers before it has been moved.

It covers what 0044 says it covers. That is the rest of its own line when the
line is not blank, else the paragraph that follows. `claims` reads coverage from
the marker where it sits today rather than from where `update` would put it.
Predicting the repair would make coverage depend on a command nobody ran.

**Changed as a result:** step 2 reads the anchored unit as `check` reads it, and
nothing in `claims` knows about `marker-misplaced`. The cost is one wasted
verdict. An `update` that re-anchors a marker changes which lines are covered,
so the run beside it changes text and is judged again. The `claims` page says to
run `update` before `claims` on a page with a misplaced marker.

### 17. `cite remove` uncovers lines

`cite remove` takes an entry out and deletes its markers, so lines that were
covered stop being covered. Those lines become a run on the next `claims` run,
and they are judged for the first time.

That is correct rather than a defect. A sentence whose citation was removed is
exactly a sentence nobody pinned. The record holds no verdict for it, because it
was never a run, so nothing stale is reused.

**Changed as a result:** nothing in the design. It is recorded because the
sequence looks alarming in a diff. One `cite remove` can add several
`claim-uncovered` findings on the next `check`. A reviewer should read that as
the gate noticing rather than as the removal breaking something.

## Not breaking

Additive. A repository with no verdict file behaves exactly as it does today,
on every verb. `check` gains one optional file read and no provider code path.
The new rule defaults to `notice`, which never touches an exit code. The two new
config keys are optional, and the fifteen existing rule names still validate.

`feat(cite):` and a minor release. Three commits on one branch, each with its
tests and fixtures. The runs and the record, with `check` reading it. The
provider call and the `claims` verb. Then the docs, including the sentences in
`cite/index.mdx` and `cite/reference/cli.mdx` that this proposal supersedes.

The demo video is the house rule for a `feat:`. Its transcript is the Problem
section, which is `cite check` green on the `manni key` page, `cite claims`
naming two sentences, and `cite check` reporting them.

## Consequences

- `cite` gains a fifth verb, and the domain's reference page a fifth section.
  `add`, `update` and `remove` do not change. `cite/index.mdx`'s "Four
  commands" heading and its table become five.
- The one sentence 0044 owns about models and networks becomes a sentence about
  `check`. Three published pages carry it, and each is rewritten to name the
  verb rather than the tool.
- `cite/index.mdx`'s "It doesn't" card keeps "call a model" for `check` and
  gains a line pointing at the `claims` page for the verb that does.
- The `claims` page carries the egress tables above, the way
  `meta/set-up/fill-providers.mdx` carries `fill`'s. It links to that page,
  because a reader who has approved one has most of the answer for the other.
- `docs/content-strategy/cujs.md` gains a step to M5 and to D5. Neither gains a
  CUJ of its own, because the outcome is unchanged and only the coverage grew.
- `@hawkeyexl/inference` gains a second consumer in this repository, and the
  eslint rule that closes `../meta/core` to sibling domains keeps `claims` out
  of `fill`'s prompt builder. The two prompts are different questions and share
  no code.
- Open questions for the review, in the order debate is expected:
  1. Should `--prune` be the default, given that a stale verdict costs bytes and
     a pruned one costs a call?
  2. Is `notice` the right default, or should a rule a model produced start at
     `off` and be opted into?
  3. Should the record hold the judged text behind a flag, so a reviewer reading
     the diff sees the sentence rather than a hash?
  4. Should `claims` accept `--baseline`, so a first full pass can be recorded
     as forgiven without setting the rule to `off`?
  5. Is one call per run right, or should a page's runs be batched into one call
     with a run count in the answer?
