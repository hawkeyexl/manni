# 0096: Contradictions between pages, judged once and recorded

- **Status:** Rejected
- **Serves:** Three journeys.
  - Maya · M18, "See the docset as a graph". Two pages that disagree about
    one fact are a property of the set, and no page shows it alone.
  - Devin · D12, "Gate the graph in CI". A recorded contradiction is a
    finding `graph check` reports with no model and no network.
  - Theo · T7, who reads a graph finding. It names both pages and both
    values, so he knows which two lines to compare.
- **Depends on:** Four earlier proposals.
  - [0034](0034-command-grammar.md) is the grammar the new verb follows.
  - [0044](0044-citations-and-drift.md) is the hashing rule that pins each
    judged passage.
  - [0051](0051-graph-domain.md) is the `graph` domain and its `check`.
  - [0086](0086-one-concept-scheme-from-termbase-to-graph.md) resolves a label
    to a term, which this uses for subject identity.
- **Relates to:** Two records.
  - [0057](0057-uncovered-claims.md) proposes the same split for cite. A model
    judges once, the verdict is committed, and `check` reads only the record.
  - [0087](0087-a-golden-set-of-reader-questions.md) made `graph check` read
    page sources beside the built graph. This does the same.
- **Touches:** `src/graph/core/` (`claims.ts` and `contradictions.ts` new,
  `config-schema.json`, `config.ts`), `src/graph/commands/` (`contradictions.ts`
  new, `check.ts`), `src/graph/llm/` (`prompt.ts`, `provider.ts`),
  `src/graph/cli.ts`, `src/graph/reporters/`, `src/graph/CLAUDE.md`,
  `docs/src/content/docs/graph/`, `docs/content-strategy/cujs.md`,
  `test/graph/`
- **Verdict:** Add `manni graph contradictions`. It extracts typed value claims
  from every page and pairs claims about one subject that disagree. A model
  judges each pair, and the verdict goes into a committed record. `graph check`
  gains one rule, `contradiction`, which it reports from that record alone. An
  unjudged candidate is never a finding, because the test below found no true
  contradiction among 468 candidates.

## Problem

Two pages can state different values for one fact. A guide says
`--chunk-chars` defaults to 8000, and the reference says 12000. Each page is
valid on its own. Its frontmatter passes `meta validate`, and the graph passes
SHACL, because no shape compares prose across pages.

The reader who meets both pages cannot tell which one is right. The person who
changed one default updated the page in front of them, and nothing pointed at
the other.

`cite` catches a sentence that drifts from its source, but only a sentence
someone pinned. `docevals` judges a page against its own assertions, one page
at a time. Neither compares two pages.

## Testing the assumption

The idea rests on a claim. The repository's own docs should hold contradictions
a finder would catch, and the termbase should help pair the pages that hold
them. Both were tested on `docs/src/content/docs/` at `26dad159` with throwaway
scripts outside `src/`.

The corpus is 252 pages. 163 of them name at least one concept, and the
termbase holds 50 terms.

### Pass 1, subjects by name, pairs by concept

Claims were extracted from `Default` table columns and from prose cues such as
"defaults to", "at most" and "Node 24+". A subject was a code span, compared by
name alone.

| Measure | Count |
|---|---|
| Claims | 534, on 66 pages |
| Subjects stated on two or more pages | 66 |
| Pairs with different values | 405 |
| True contradictions | 0 |
| Pairs whose pages share a concept | 11, none true |

136 of the 405 pairs were `--format`, whose default differs by command.
`lint templates infer` writes `yaml` and every other verb prints `pretty`. The
next largest groups were `--provider`, `--config` and `--max-turns`, each
spelled differently on different commands.

Concept pairing removed 97% of the noise and none of the signal, because there
was no signal. It would also have removed the wrong pairs. The pages that
document one fact twice are a domain's `reference/cli.mdx` and its
`reference/configuration.mdx`, and those two share no concept. Concepts are
also broad. `schema` alone is named on 27 pages.

### Pass 2, subjects scoped and fallbacks resolved

A flag was scoped to the command its heading names, such as `graph fill`. A
config key was scoped to its section, such as `fill.chunkChars`. A default
written as "config `fill.chunkChars`, else 12000" became `12000`, with a
reference to the key.

| Measure | Count | True |
|---|---|---|
| Table rows with a code subject | 940, 594 with a concrete value | n/a |
| Scoped subjects stated on two pages | 0 | 0 |
| Fallback references resolved to a config key | 71 of 87 | n/a |
| Fallbacks that disagree with the key's default | 6 | 0 |
| One flag, one domain, different commands | 9 groups | 0 |
| Prose sentences naming a documented subject near "default" | 100 | n/a |
| Of those, sentences whose values miss the documented one | 48 | 0 |
| Exit-code rows quoting a message | 75, one message on two pages | 0 |

The false positives fall into four kinds.

| Kind | Example |
|---|---|
| Synonyms | `graph fill --offline` says `off`, and `fill.offline` says `false`. |
| A default that means "use the fallback" | `--shapes` says bundled, and `check.shapes` says `[]`, which means the bundled set. |
| One name, two scopes | `graph search --limit` is 10, and `graph traverse --limit` is unbounded. |
| A sentence that names a key without stating its value | "`--no-config` skips discovery and runs on the defaults alone." |

### Planted contradictions

Four contradictions were planted in a copy of the docs. Pass 2 found three.

| Planted | Found |
|---|---|
| A guide says `--chunk-chars` defaults to 8000 | yes, from prose |
| `fill.chunkChars` changed to `16000` in the configuration table | yes, from the CLI fallback |
| A glossary says `judge.ensembleRuns` defaults to 5 | yes, from prose |
| A message given exit 1 on a second page | no |

The missed one has its other side in a Doc Detective step comment, which the
extractor does not read. The first plant also flagged a second key named in the
same sentence, which shows the noise a sentence-level extractor carries.

### What the evidence says

This docset has no contradiction of the kind the finder targets. It states
each fact once, in a reference table. `docs:check-cli` holds those tables to
the commander program, `cite check` pins prose restatements to source lines,
and `manni test run` executes the documented exit codes. Those three gates
already do the finder's job here.

The extractor can find a planted contradiction. Its precision without a judge
is zero on this corpus. So a deterministic candidate is never a finding.

A corpus without those gates is where the finder earns its keep. That is most
corpora, but it is not measured here. See open question 1.

## Design

### 1. Claims are data

A **claim** is a subject, an attribute, a value and the passage that states it.

- **Subject.** A code span that names a flag (`--chunk-chars`) or a config key
  (`fill.chunkChars`), or a term's label from the termbase.
- **Scope.** A flag is scoped by the nearest heading above it that names a
  command, such as `` `graph fill` ``. A bare key is scoped by the nearest
  heading that is a code span, so `chunkChars` under `` `fill` `` is
  `fill.chunkChars`.
- **Attribute.** One of `default`, `minimum`, `maximum`, `range`, `version` and
  `exit`.
- **Value.** Typed and normalized before any comparison.
- **Passage.** The block that holds the claim. That is a table row, a
  paragraph, a list item or a heading.

Claims come from three places.

- **A table row.** Its first cell holds the subject, and a column headed
  `Default`, `Minimum`, `Maximum` or `Exit` holds the value.
- **A prose sentence.** It holds a subject and a cue, such as "defaults to",
  "default", "at most", "between N and M", "or newer" and "exits N".
- **A fallback.** "config `fill.chunkChars`, else 12000" is a claim of `12000`
  and a reference to the key.

Values normalize by type.

| Type | Read as one value |
|---|---|
| Number | `12000`, `12,000`, `12 000` and `twelve thousand`; the words zero to twenty |
| Boolean | `on`, `true`, `yes` and `enabled`; `off`, `false`, `no` and `disabled` |
| Unset | `null`, `unbounded`, `unset` and `no limit` |
| Version | `24`, `24.0` and `24.0.0`; a trailing `+` or "or newer" makes a floor |
| Literal | A code span, compared as written |

`none`, `n/a`, a dash and "see below" are no value, so they make no claim.

Termbase labels are subjects through 0086's resolution. A label, an id or an
alt-label of one term is one subject. Concepts are not used to pair pages,
because pass 1 showed they would drop the pairs that matter.

### 2. Candidates pair on the subject

Two claims are a **candidate** when all of these hold.

- They have one subject and one attribute, after scoping.
- Their normalized values differ.
- They sit on different pages, or under different headings of one page.

An unscoped subject matches a scoped one only when exactly one scope of that
name exists in the document set. Otherwise it pairs with nothing. A fallback is
compared with the default the referenced key documents.

A candidate is never reported by `check`. It is a question for the judge.

### 3. The judge decides, once

`manni graph contradictions` sends each candidate to a model with both
passages. The model answers one of three verdicts.

| Verdict | Meaning |
|---|---|
| `contradiction` | Both passages state the same fact, and the values cannot both hold. |
| `consistent` | Both hold. One is a synonym, a fallback or a rounding of the other. |
| `unrelated` | The passages are about different things that share a name. |

The provider comes from `src/shared/providers.ts`, through `graph.provider` and
`graph.model`, exactly as `graph fill` takes it. `--local` and `--offline` mean
what they mean on `fill`. The budget is turns. One candidate is one turn.

Every verdict is recorded, so a second run asks only about new pairs.

### 4. The record is committed

The record is `.manni-graph-contradictions.json` at the config file's
directory by default. It is committed, for 0057's reason. A verdict is a
reviewable fact about the docs, and a reviewer sees it arrive in a diff.

Each side of a pair is pinned by its file and the hash of its passage, under
0044's hashing rule. Edit either passage and the hash changes. The verdict then
matches nothing, and the pair is a candidate again. That is how a fix clears a
finding, and how an edit that reintroduces one is caught.

The record holds hashes, never prose.

### 5. `check` reads only the record

`graph check` extracts claims, forms candidates and hashes both passages. It
looks each pair up in the record and reports a `contradiction` verdict as a
finding. Anything else is silence.

So `check` calls no model and opens no socket. With no record it behaves
exactly as it does today. `manni check`, which runs `graph check` when the
graph is in play, gains the rule and still calls no model.

The default severity is `warning`, so a finding never fails a run until a team
raises it to `error`.

### 6. Egress

Per candidate, `graph contradictions` sends what follows, and nothing else.

| What | Exactly what goes |
|---|---|
| Two page paths | As matched, in the prompt |
| Two passages | The blocks that hold the claims, verbatim after CRLF and BOM normalization |
| The subject and attribute | `graph fill --chunk-chars`, `default` |
| The question | One fixed instruction and the three-verdict answer shape |

No frontmatter, no other block of the page and no source file is read into a
prompt. `--dry-run` prints each candidate and the byte count of each prompt,
then stops. It calls nothing and writes nothing.

## Where it lives

Two homes were open, a `graph check` rule or a new graph verb. This proposal
takes both halves, split along the line 0034 and 0086 already draw.

**The finding is a `graph check` rule.** 0034 puts a verb in the domain that
owns its object. A contradiction is a property of the set, not of one page. The
`graph` domain owns the set. `meta`, `lint` and `docevals` judge one page at a
time, `term` owns the termbase, and `cite` owns a page against its source.
`graph check` already reports emergent findings, such as two spellings that
collide on one concept node. It already reads page sources for sample
questions, under 0087.

**The judging is a new verb.** 0086 § 7 keeps `graph check` deterministic, and
`manni check` runs it in every hook and CI job. A flag that let `check` call a
model would put a model inside the family's gate. So the model call lives in a
verb a person or a job runs on purpose. Nothing in CI calls a model unless a
workflow runs that verb.

`graph fill` was considered and declined. It proposes frontmatter fields for
review, and a verdict is not a field. Folding it in would give one verb two
outputs and two review paths.

The new verb ends one invariant. `src/graph/CLAUDE.md` says `graph fill` is the
one verb that reaches a model. It becomes two verbs, with the same provider
seam and the same turn budget.

## The interface

### Config

Before, this repository's `graph:` section, abridged:

```yaml
graph:
  baseIri: https://example.com/manni-docs/
  out: .manni/graph/graph.ttl
  build:
    derive: [frontmatter, sections, links, tags, images, code, terms]
  check:
    shapes: []
```

After, for a repository that adopts the verb and gates on it:

```yaml
graph:
  baseIri: https://example.com/manni-docs/
  out: .manni/graph/graph.ttl
  provider: anthropic
  model: claude-sonnet-4-6
  build:
    derive: [frontmatter, sections, links, tags, images, code, terms]
  check:
    shapes: []
    contradictions:
      severity: error
  contradictions:
    record: .manni-graph-contradictions.json
    maxTurns: 200
```

A repository that never wants the verb writes none of that. This repository
keeps its config as it is. The new keys, with `additionalProperties` false at
each level:

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `graph.contradictions.record` | path | `.manni-graph-contradictions.json` | no | The verdict record, relative to the config file. `contradictions` writes it, and `check` reads it. |
| `graph.contradictions.maxTurns` | integer ≥ 1, or `null` | `null` | no | Stop after this many judged pairs. `null` is unbounded. `--max-turns` overrides it. |
| `graph.check.contradictions.severity` | `notice`, `warning`, `error` or `off` | `warning` | no | The severity of a recorded contradiction. `error` fails `check`. `off` reports none. |

`graph.provider` and `graph.model` already exist. Their descriptions change to
name both verbs that read them. There is no key that turns the verb on. The
verb is the switch.

### `manni graph contradictions`

```
manni graph contradictions [paths...] [options]
```

| Option | Argument | Default | Description |
|---|---|---|---|
| `[paths...]` | files, directories, globs | config `collections:` | Judge only pairs with at least one side in these pages. The other side comes from the whole document set. |
| `--collection` | `<name>` | every collection | Read only this collection. Repeatable, one name per occurrence. |
| `--exclude` | `<glob>` | none | Leave matching files out. Repeatable, never split on commas. |
| `--as` | `<format>` | by extension | Parse every input as one format. |
| `--ext` | `<list>` | supported extensions | Comma-separated extensions for directory walks, given once. |
| `--allow-empty` | n/a | off | Treat zero matched files as success. |
| `--since` | `<ref>` | none | Judge only pairs with a side in lines changed since this git ref. |
| `--rejudge` | n/a | off | Ask again about pairs the record already holds. |
| `--prune` | n/a | off | Drop recorded pairs that match no candidate today. |
| `--dry-run` | n/a | off | Print each candidate and its prompt size, then stop. Calls nothing and writes nothing. |
| `--max-turns` | `<n>` | config, else unbounded | Stop after this many judged pairs. |
| `--provider` | `<name>` | config, else `auto` | `auto`, `anthropic`, `openai`, `claude-cli` or `llama-cpp`. |
| `--model` | `<model>` | the provider's default | Needs a named provider, from here or config. |
| `--local` | n/a | off | Run inference on this machine with `llama-cpp`. |
| `--offline` | n/a | off | Use only a model already downloaded, and never a remote provider. |
| `-f, --format` | `<format>` | `pretty` | `pretty` or `json`. |
| `-c, --config` | `<path>` | discovered | The config file. |
| `--no-config` | n/a | off | Ignore any discovered config. |

The verb takes no `-`. A verdict is keyed by a page path, and stdin has none.

Exit `0` when every pair in scope was judged and the record was written,
whatever the verdicts. Exit `1` when some pairs were left unjudged. Exit `2` for
a usage or operational error. Reporting a contradiction is `check`'s job.

### `manni graph check`, the one addition

`check` gains the `contradiction` rule and no flag. It reads the record that
`graph.contradictions.record` names, and passes over a missing record in
silence. Every other flag, format and exit code is unchanged.

### The record

```json
{
  "version": 1,
  "verdicts": [
    {
      "subject": "graph fill --chunk-chars",
      "attribute": "default",
      "a": {
        "file": "docs/guides/long-pages.md",
        "lines": "42",
        "integrity": "sha256-4f0c9e1a7b2d3c5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6"
      },
      "b": {
        "file": "docs/reference/cli.md",
        "lines": "788",
        "integrity": "sha256-9a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"
      },
      "verdict": "contradiction",
      "prompt": "contradictions-1",
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "judged": "2026-10-20T09:12:44Z"
    }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | number | The record format. This build reads and writes `1`. |
| `subject` | string | The scoped subject, as the candidate named it. |
| `attribute` | string | `default`, `minimum`, `maximum`, `range`, `version` or `exit`. |
| `a`, `b` | object | The two sides, sorted by `file` then `lines`. |
| `a.file` | path | The page, relative to the config file. |
| `a.lines` | string | `"L"` or `"L1-L2"`. Advisory and refreshed when text moves. Never used for lookup. |
| `a.integrity` | `^sha256-[0-9a-f]{64}$` | The passage under 0044's hashing rule. |
| `verdict` | string | `contradiction`, `consistent` or `unrelated`. |
| `prompt` | string | The prompt's version. A bump makes the verb ask again, and `check` keeps reading the entry. |
| `provider`, `model` | string | What answered. |
| `judged` | ISO 8601 timestamp | When it answered. |

Lookup is by subject, attribute and both sides' file and integrity. Entries
are sorted by `a.file`, then `b.file`, then subject, so two branches merge by
line.

### What `check` prints

`pretty`:

```
warning: docs/guides/long-pages.md, docs/reference/cli.md: graph fill --chunk-chars defaults to 8000 on line 42 of docs/guides/long-pages.md and 12000 on line 788 of docs/reference/cli.md.
  at docs/guides/long-pages.md:42, docs/reference/cli.md:788
  manni:graph-contradictions contradiction: Two pages state different values for one fact. Fix the one that is wrong. The finding clears when either passage changes.
  https://hawkeyexl.github.io/manni/graph/fix/#contradiction

0 errors, 1 warning, 0 notices
```

`json` adds one field to the finding, `contradiction`. Every other field keeps
its meaning, and `focusNode` is the first page's document IRI.

```json
{
  "severity": "warning",
  "message": "graph fill --chunk-chars defaults to 8000 on line 42 of docs/guides/long-pages.md and 12000 on line 788 of docs/reference/cli.md.",
  "focusNode": "https://example.com/docs/doc/guides/long-pages",
  "docs": ["docs/guides/long-pages.md", "docs/reference/cli.md"],
  "guidance": {
    "id": "manni:graph-contradictions",
    "rule": "contradiction",
    "description": "Two pages state different values for one fact. Fix the one that is wrong. The finding clears when either passage changes.",
    "guide": "https://hawkeyexl.github.io/manni/graph/fix/#contradiction"
  },
  "contradiction": {
    "subject": "graph fill --chunk-chars",
    "attribute": "default",
    "sides": [
      { "file": "docs/guides/long-pages.md", "lines": "42", "value": "8000" },
      { "file": "docs/reference/cli.md", "lines": "788", "value": "12000" }
    ],
    "provider": "anthropic",
    "model": "claude-sonnet-4-6"
  }
}
```

`github` prints one annotation on each side, each naming the other.
`sarif` gives the result two locations, one per side. The values come from the
extraction on this commit, so the record never has to hold them.

### What `contradictions` prints

`pretty`:

```
docs/guides/long-pages.md:42 and docs/reference/cli.md:788
  graph fill --chunk-chars, default: 8000 and 12000
  contradiction
docs/reference/cli.md:432 and docs/reference/configuration.md:191
  graph check --shapes, default: bundled and []
  consistent

2 pairs judged: 1 contradiction, 1 consistent, 0 unrelated. 14 already recorded. Wrote .manni-graph-contradictions.json.
```

`--dry-run` prints the same pairs with `would ask, 1,204 bytes` in place of a
verdict, and ends `16 candidates, 2 to judge, 2,388 bytes. Nothing was sent.`

`json` prints this shape.

```json
{
  "candidates": 16,
  "pairs": [
    {
      "subject": "graph fill --chunk-chars",
      "attribute": "default",
      "sides": [
        { "file": "docs/guides/long-pages.md", "lines": "42", "value": "8000" },
        { "file": "docs/reference/cli.md", "lines": "788", "value": "12000" }
      ],
      "verdict": "contradiction"
    }
  ],
  "recorded": 14,
  "unjudged": 0,
  "turns": 2,
  "record": ".manni-graph-contradictions.json"
}
```

`candidates` counts every candidate in the document set. `pairs` holds the ones
this run asked about. Under `--dry-run`, `verdict` is absent and each pair
carries `bytes`.

### Messages and exit codes

| Situation | Message | Exit |
|---|---|---|
| No provider is available under `auto` | The library's own message, verbatim, prefixed `manni: ` | 2 |
| `--local` with a hosted provider named | `manni: --local and --provider anthropic contradict each other: --local runs inference on this machine with llama-cpp. Drop one of them.` | 2 |
| `--model` with no named provider | `fill`'s message today, with the verb's name | 2 |
| An unknown format | `manni: Unknown --format "sarif". Use pretty \| json.` | 2 |
| `-` among the paths | `manni: graph contradictions reads no stdin, because a verdict is keyed by a page path. Name the file instead.` | 2 |
| An unresolvable `--since` | `manni: --since main~400 names no commit.` | 2 |
| `--since` with no git | `manni: --since needs git, and git is not available here.` | 2 |
| A record from a newer manni | `manni: .manni-graph-contradictions.json was written by a newer manni (version 2). This build reads 1. Upgrade manni.` | 2 |
| A record that does not parse | `manni: .manni-graph-contradictions.json is not a verdict record. Delete it and run manni graph contradictions.` | 2 |
| The turn budget ran out | `manni: 3 of 41 pairs were not judged. The record holds the other 38. Run manni graph contradictions again.` | 1 |
| A recorded contradiction, from `check` | The finding above | `0` at `warning`, `1` at `error` |

`check` raises the two record messages too, with the same exit. No message
quotes a passage, so prose never reaches a CI log through a diagnostic.

### The ladder

The bare minimum, with a provider detected:

```
$ manni graph contradictions
2 pairs judged: 1 contradiction, 1 consistent, 0 unrelated. 0 already recorded. Wrote .manni-graph-contradictions.json.
# exit 0
```

See what would be sent, with no model:

```
$ manni graph contradictions --dry-run
16 candidates, 16 to judge, 19,410 bytes. Nothing was sent.
# exit 0
```

Report it, offline, as any CI job does:

```
$ manni graph check
warning: docs/guides/long-pages.md, docs/reference/cli.md: graph fill --chunk-chars defaults to 8000 ...
0 errors, 1 warning, 0 notices
# exit 0
```

The pull-request form, judging only what the branch touched, on this machine:

```
$ manni graph contradictions --since origin/main --local
1 pair judged: 0 contradictions, 1 consistent, 0 unrelated. 15 already recorded. Wrote .manni-graph-contradictions.json.
# exit 0
```

The scripting form:

```
$ manni graph contradictions --dry-run -f json | jq '.pairs | length'
16
# exit 0
```

The gate, after `graph.check.contradictions.severity: error`:

```
$ manni graph check -f github
::error file=docs/guides/long-pages.md,line=42::graph fill --chunk-chars defaults to 8000 here and 12000 in docs/reference/cli.md:788.
::error file=docs/reference/cli.md,line=788::graph fill --chunk-chars defaults to 12000 here and 8000 in docs/guides/long-pages.md:42.
# exit 1
```

Every option that composes. `--local` and `--offline` refuse a hosted
provider, so the local form swaps them in for `--provider` and `--model`.

```
$ manni graph contradictions docs/guides --collection site --exclude "**/drafts/**" \
    --as markdown --ext md,mdx --allow-empty --since origin/main --rejudge --prune \
    --max-turns 50 --provider anthropic --model claude-sonnet-4-6 -f json -c manni.config.yaml
{ "candidates": 16, "pairs": [ ... ], "recorded": 12, "unjudged": 0, "turns": 4, ... }
# exit 0

$ manni graph contradictions --since origin/main --local --offline --no-config
0 pairs judged: 0 contradictions, 0 consistent, 0 unrelated. 0 already recorded. Wrote .manni-graph-contradictions.json.
# exit 0
```

The usage errors:

```
$ manni graph contradictions -
manni: graph contradictions reads no stdin, because a verdict is keyed by a page path. Name the file instead.
# exit 2

$ manni graph contradictions --local --provider openai
manni: --local and --provider openai contradict each other: --local runs inference on this machine with llama-cpp. Drop one of them.
# exit 2

$ manni graph contradictions -f sarif
manni: Unknown --format "sarif". Use pretty | json.
# exit 2

$ manni graph contradictions --max-turns 0
manni: --max-turns expects a whole number of at least 1.
# exit 2
```

### The programmatic API

`src/index.ts` does not change. It re-exports the metadata tool, and the graph
cores are not part of it.

## Stress test

### 1. A pair whose values agree after normalization

`off` and `false` are one boolean, so the pair is never a candidate. Pass 2's
two synonym pairs vanish here without a model call.

### 2. A default that means "use the fallback"

`check.shapes: []` and "`--shapes`, else bundled" are not synonyms by type.
They form a candidate, and the judge answers `consistent`. The record keeps
that answer, so the pair costs one turn ever, until one passage changes.

### 3. A flag that two commands share

`--limit` on `graph search` and on `graph traverse` scope to different
commands, so they never pair. A guide that writes `--limit` under no command
heading pairs with neither, because two scopes exist.

### 4. A finder that is wrong

A `contradiction` verdict that a person disagrees with is fixed by rewording
one passage, which changes its hash. A record entry can also be edited to
`consistent` by hand, and the diff shows who did it. The default severity is
`warning`, so a wrong verdict never blocks a merge unasked.

### 5. A CI job with no network

`check` reads a file. A record committed on a developer's machine gates CI
with no provider, no key and no socket.

### 6. A stale record

A pair whose passage changed matches no entry, so `check` is silent about it
until the verb runs again. The gap is visible, because `contradictions
--dry-run` names every unjudged candidate. A `check` that reported unjudged
candidates would be noise. Pass 2 found 63 of them and no contradiction.

### 7. Two branches judge and the record conflicts

Entries are sorted, one per pair, so two branches that judge different pairs
merge by line. A pair judged on both branches conflicts on one entry, and
either side is right.

### 8. Should concepts pair the pages?

The idea started there. Pass 1 shows it would discard the pages most likely to
disagree, a domain's CLI and configuration references, which share no concept.
The termbase earns its place on the subject side instead. A term's label,
id and alt-labels name one subject.

## What this does not do

- **Report an unjudged candidate.** The evidence says one is noise.
- **Fix a page.** Which side is right is a fact about the product, and the
  tool does not know it.
- **Compare a page with code.** `cite` and `docs:check-cli` do that.
- **Read code blocks or test comments.** The planted exit-code contradiction
  was missed for that reason, and `manni test run` covers documented exit codes.

## Consequences

- `src/graph/CLAUDE.md` says two verbs reach a model, `fill` and
  `contradictions`.
- `docs/content-strategy/cujs.md` gains M28, "Find two pages that disagree
  about one fact".
- The graph reference pages document the verb, the rule, the three keys and
  the record. `docs:check-cli` covers the verb.
- `graph check`'s `json` finding gains an optional `contradiction` field.
- 0051 and 0086 are left as written. This adds a verb and a rule, and changes
  no decision either recorded.

## Open questions

1. **Is there a corpus to measure on?** This docset has three gates that do the
   finder's job. A docset without them, such as an imported legacy corpus, would
   say whether the judged layer earns its turns. Build only after that measure?
2. **Should `check` say how many candidates are unjudged?** A count on the
   summary line nudges a team to run the verb. It also puts a number in every
   report that is mostly noise.
3. **Should term labels be subjects from the first release?** Pass 1 and pass 2
   used code spans only, so term subjects are unmeasured.
4. **Is `warning` the right default?** 0057 chose `notice` for a judged rule.

## Acceptance checklist

- [ ] `docs/proposals/0096-contradictions-between-pages.md` carries
      `Status: Implemented` and the PR numbers.
- [ ] `src/graph/core/claims.ts` extracts claims from table rows, prose cues
      and fallbacks, scoped and normalized as § 1 says.
- [ ] `src/graph/core/contradictions.ts` forms candidates as § 2 says, and reads
      and writes the record.
- [ ] `manni graph contradictions` exists with every option in the table, and
      `--help` lists them.
- [ ] `manni graph contradictions` with a mock provider judges each candidate,
      writes `.manni-graph-contradictions.json`, and exits 0.
- [ ] `manni graph contradictions --dry-run` prints candidates and byte counts,
      sends nothing, writes nothing, and exits 0.
- [ ] A run stopped by `--max-turns` prints the unjudged message and exits 1.
- [ ] Every message in the table prints as written, with its exit code.
- [ ] `manni graph contradictions -` exits 2 with the stdin message.
- [ ] A second run with an unchanged corpus judges nothing and spends no turn.
- [ ] Editing one passage of a recorded pair makes it a candidate again.
- [ ] `manni graph check` reports a recorded `contradiction` at `warning` and
      exits 0.
- [ ] With `graph.check.contradictions.severity: error`, `manni graph check`
      exits 1 on it, in `pretty`, `json`, `github` and `sarif`.
- [ ] `manni graph check` with no record behaves exactly as before.
- [ ] `manni graph check` opens no socket and calls no provider, pinned by a test.
- [ ] `manni check` reports the rule through `graph check` and calls no model.
- [ ] The three config keys validate, with `additionalProperties` false, and
      an unknown key exits 2.
- [ ] `graph.provider` and `graph.model` descriptions name both verbs.
- [ ] Fixtures under `test/graph/fixtures/contradictions/` hold a contradiction,
      a synonym pair, a fallback pair and a two-scope flag, each pinned by a test.
- [ ] `docs/src/content/docs/graph/reference/cli.mdx` documents the verb, and
      `npm run docs:check-cli` verifies it.
- [ ] `docs/src/content/docs/graph/reference/configuration.mdx` documents the
      three keys.
- [ ] `docs/src/content/docs/graph/fix/` has a `#contradiction` section, which
      the finding's guide URL resolves to.
- [ ] `docs/content-strategy/cujs.md` carries M28.
- [ ] `src/graph/CLAUDE.md` names two verbs that reach a model.
- [ ] A demo video for the `feat:` is in `media/`, MP4 excluded.
