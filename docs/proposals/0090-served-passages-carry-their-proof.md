# 0090: Served passages carry their proof

- **Status:** Proposed
- **Serves:** Four groups of readers.
  - Devin · D13, "Publish the graph for retrieval". He publishes a search
    index today, and no reader of it learns which passages passed the gate.
  - Maya · M24 and M27. Her agent reads the docs while it writes them, and
    her golden questions only test search, never what an agent receives.
  - Sara · S1. Her standard marks which fields a page delivers, and no
    manni output honors the mark.
  - Agent builders outside the repo, the reader of
    [issue #36](https://github.com/hawkeyexl/manni/issues/36). They ingest
    served docs, and every field costs them budget.
- **Depends on:** Six earlier records.
  - [ADR 01018](graph/01018-graphrag-runtime-architecture.md) is the runtime
    seam. Compile in Node, serve from a browser-safe bundle, and refuse
    rather than return empty context.
  - [0044](0044-citations-and-drift.md) is cite's pin and its classifier.
  - [0069](0069-merge-safe-stamps.md) and
    [0072](0072-derived-dates-are-utc-days.md) say which derived dates
    survive a squash merge, and on which calendar.
  - [0087](0087-a-golden-set-of-reader-questions.md) is the golden set of
    reader questions, pinned to their answers.
  - [0047](0047-field-location.md) and
    [0051](0051-graph-domain.md) § 5 are the two field marks this proposal
    combines.
- **Relates to:** [DESIGN.md](graph/DESIGN.md) Phases 9 and 10. This
  proposal makes the decisions those phases list.
- **Supersedes:** Nothing.
- **Touches:** `src/graph/runtime/` (`assemble.ts`, `trace.ts`, `index.ts`,
  `retrieve.ts` new, `provenance.ts` new), `src/graph/commands/`
  (`retrieve.ts` new, `serve.ts` new, `traverse.ts`, `export.ts`,
  `check.ts`, `questions.ts`), `src/graph/core/` (`config-schema.json`,
  `config.ts`, `provenance.ts` new, `llms.ts` new), `src/graph/reporters/`,
  `src/graph/cli.ts`, `package.json`, `docs/src/content/docs/graph/`,
  `docs/content-strategy/cujs.md`, `test/graph/`
- **Verdict:** Every passage manni serves carries a provenance record. The
  record holds its pin status, its merge-safe dates and its page's eval
  verdicts. `manni graph retrieve` and `manni graph serve` hand that to a
  person or an agent. The golden set becomes the retrieval suite inside
  `graph check`. A field reaches agent-facing output unless one of its two
  existing marks keeps it out. `graph export llms` writes `llms.txt` from
  the frontmatter, so the two descriptions cannot drift.

## Problem

### The proof stops at the gate

manni proves a lot about a page. cite says whether each pinned sentence
still matches its source. meta derives the day the page last changed. The
evals say whether a judge or a script passed it. Every one of those verdicts
lands in a CI log and ends there.

A reader on the site sees none of it. Neither does an agent. A sentence whose
source changed last week reads exactly like one checked this morning.

### The runtime stops one call short

The runtime already walks the graph, resolves text and assembles a bundle.
No command calls `assemble`. A person who wants the bundle has to write
JavaScript. An agent has no way to call it at all.

### The golden set tests the wrong thing

0087's `graph check` asks each question of search, and counts a hit in the
top five. An agent never sees that ranking. It sees a bundle, after
traversal, scope and a character budget. A question can rank first and still
fall out of the bundle. `graph export questions` hands the set to Ragas or
DeepEval, which judge an answer manni never produced.

### Delivery has no field rule

Issue #36 asks which vocabulary fields belong in delivered, agent-facing
output. 0047 marks where a field is written. 0051 § 5 marks whether the
graph publishes it, and says plainly that location alone is not a publishing
decision. No manni output delivers page metadata to an agent yet, so neither
mark has been tested against that question.

### Two descriptions, two update paths

An `llms.txt` entry repeats a page's `description`. One is in frontmatter,
the other is typed by hand into a file at the site root. Each is edited on
its own schedule, and they drift. 0047 named the problem and left it open.

## Design

The work lands as four PRs, in this order.

| PR | What lands |
|---|---|
| 1 | The provenance record, `graph export provenance`, and the runtime's `retrieve()`. |
| 2 | `graph retrieve`, `graph traverse --context`, and `graph.retrieve` config. |
| 3 | `graph serve`, the MCP server. |
| 4 | The golden set through `retrieve` in `graph check`, and `graph export llms`. |

### 1. The provenance record

A provenance record describes one served passage. A passage is the text one
context block carries. For a section node that is its heading through to the
next heading of the same or higher rank, as `sliceSection` returns it. For a
document node it is the whole body.

```json
{
  "node": "https://example.com/docs/uploads/retry.md#retry-limits",
  "page": "docs/uploads/retry.md",
  "lines": "38-52",
  "commit": "26dad159c0f1e4a8b7d2c3e5f6a7b8c9d0e1f2a3",
  "worktree": "clean",
  "pins": {
    "total": 3,
    "current": 2,
    "notice": 0,
    "warning": 0,
    "error": 1,
    "items": [
      {
        "id": "retry-default",
        "claim": "41-43",
        "source": "src/upload.ts:88-90",
        "commit": "9f3a1c7e5b2d4086a1c3e5f7092b4d6e8a0c2e41",
        "findings": []
      },
      {
        "id": null,
        "claim": "47",
        "source": "src/upload.ts:102-104",
        "commit": "4be07d19a3c5f8206b1d3e5a7c9f0b2d4e6a8c10",
        "findings": [{ "rule": "source-changed", "severity": "error" }]
      },
      {
        "id": "retry-backoff",
        "claim": "49-50",
        "source": "src/upload.ts:110-118",
        "commit": "9f3a1c7e5b2d4086a1c3e5f7092b4d6e8a0c2e41",
        "findings": []
      }
    ]
  },
  "dates": {
    "created": { "day": "2025-03-14", "stamp": "current" },
    "lastUpdated": { "day": "2026-10-02", "stamp": "stale" }
  },
  "evals": {
    "report": "sha256-5c1e…",
    "pass": 4,
    "fail": 1,
    "needsReview": 0,
    "skipped": 0,
    "error": 0,
    "items": [
      { "name": "no-todo-markers", "suite": "graph", "grader": "command", "outcome": "pass" },
      { "name": "answers-the-question", "suite": "quality", "grader": "ai", "outcome": "fail", "confidence": 0.91 }
    ]
  }
}
```

| field | type | meaning |
|---|---|---|
| `node` | IRI | The graph node the passage resolves from. |
| `page` | path | The page source, labelled as `graph build` labels it. |
| `lines` | `"N-M"` | The body lines the passage covers, counted as cite counts `claim.lines`. |
| `commit` | 40 hex, or `null` | The commit the record describes. `null` outside git. |
| `worktree` | `clean` or `modified` | `modified` when any page differed from that commit at export. |
| `pins` | object, or `null` | The cite pins whose claim overlaps `lines`. `null` outside git, since cite reads sources through git. |
| `pins.total` | integer | How many pins the passage holds. |
| `pins.current` | integer | Pins with no findings. |
| `pins.notice`, `.warning`, `.error` | integer | Pins counted once, at their worst finding's severity. |
| `pins.items[].id` | string, or `null` | The citation's `id`, when it has one. |
| `pins.items[].claim` | `N` or `"N-M"` | The body lines the claim occupies now. |
| `pins.items[].source` | string | `path:lines` as cite writes it. An encrypted path stays the ciphertext token. |
| `pins.items[].commit` | 40 hex | The commit the citation's source end was recorded at, as cite recorded it. |
| `pins.items[].findings` | list | Each cite rule that fires, with the severity `cite.severity` resolves for it. Empty means current. |
| `dates` | object, or `null` | The two merge-safe dates of 0069. `null` outside git. |
| `dates.*.day` | `YYYY-MM-DD`, or `null` | The day meta's derive computes from git, as a UTC day under 0072. `null` when git holds no evidence. |
| `dates.*.stamp` | `current`, `stale` or `absent` | Whether the page's own field names that day, another day, or none. |
| `evals` | object, or `null` | The page's verdicts from the docevals report. `null` when no report was given. |
| `evals.report` | `sha256-<64 hex>` | The digest of the report the verdicts came from. |
| `evals.pass` … `.error` | integer | Results per docevals outcome. |
| `evals.items[]` | list | One entry per result: `name`, `suite`, `grader`, `outcome`, and `confidence` for an AI grader. Sorted by suite, then name. |

- **The record is self-contained.** `commit` and `worktree` repeat in every
  record, so a record copied out of a bundle still says what it describes.
  0095 reuses this shape for live-site provenance, unchanged.
- **A pin carries its own commit.** The record's top-level `commit` is the
  docs checkout. It is wrong for a source in another repository, and for a pin
  that has drifted. A recorded commit can be unreachable after a squash merge,
  and the field carries it as recorded.
- **Dates are the two merge-safe ones.** `created` and `last-updated` hold
  after a squash, by 0069. `last-reviewed` comes from merged pull requests,
  which needs the network. An export stays hermetic, so it is left out.
- **Dates are computed for every page.** A page whose schemas never claim
  `last-updated` still gets the derived day, with `stamp: "absent"`. The
  record reports evidence, and the stamp field says whether the page agrees.
- **Pins are counted, never judged here.** The findings and their severity
  are cite's own, through `cite:` config. The record adds no rule of its
  own.
- **A failing eval does not hide a passage.** The record reports. Section 3
  is where a publisher chooses to withhold.

### 2. `graph export provenance`

Provenance needs git, and the runtime cannot run git. So the record is built
on the compile side, as the search index is, and the runtime reads it.

`EXPORT_TARGETS` gains `provenance`. It writes `provenance.json` beside the
graph, and `-o` overrides the path.

```json
{
  "format": "manni-graph-provenance",
  "version": 1,
  "graph": "sha256-…",
  "commit": "26dad159c0f1e4a8b7d2c3e5f6a7b8c9d0e1f2a3",
  "worktree": "clean",
  "evals": { "report": ".manni/evals.json", "digest": "sha256-5c1e…" },
  "pages": {
    "docs/uploads/retry.md": {
      "metadata": { "title": "Retry an upload", "description": "…", "type": "how-to" },
      "dates": { "created": { "…": "…" }, "lastUpdated": { "…": "…" } },
      "evals": { "…": "…" }
    }
  },
  "nodes": {
    "https://example.com/docs/uploads/retry.md#retry-limits": {
      "page": "docs/uploads/retry.md",
      "lines": "38-52",
      "pins": { "…": "…" }
    }
  }
}
```

- **Normalized on disk, joined when served.** Page facts sit once under
  `pages`, and passage facts under `nodes`. The runtime joins a node, its
  page and the header into one record.
- **`graph` is the digest of the graph file it was built from.** A rebuilt
  graph makes the artifact stale. `retrieve` refuses a stale artifact, as
  `search` refuses a stale vector sidecar.
- **Byte-stable.** Keys are sorted, and nothing reads the wall clock. The
  same commit, report and config give the same bytes.
- **Eval verdicts come from a report, never a run.** Export never runs an
  eval. It reads the JSON that `manni docevals run -f json` prints. Judged
  evals run on a person's machine, and an export in CI must not need a model.
- **`metadata` is section 7's rule, applied once.** The runtime cannot
  resolve schemas, so export writes each page's delivered fields here.

```yaml
# before
graph:
  export:
    iirds:
      title: manni docs

# after
graph:
  export:
    iirds:
      title: manni docs
    provenance:                    # new
      evals: .manni/evals.json     # new; path, or null
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| `graph.export.provenance.evals` | path, or null | `null` | no | A docevals JSON report, relative to the config file. Its verdicts fill each record's `evals`. `null` leaves every `evals` null. |

`--evals <path>` on `graph export` overrides it. It is valid only with the
`provenance` target.

### 3. `retrieve`, in the runtime and on the CLI

`retrieve()` runs the pipeline ADR 01018 describes. Entry ranks the seeds,
traversal walks from them with scope honored, the resolver reads their text,
and assembly applies the budget. It adds two steps. Each block gains its
record, and the trust floor runs before the budget.

```bash
manni graph retrieve <question> [options]
```

| option | meaning |
|---|---|
| `<question>` | The question, in quotes. |
| `-c, --config <path>` | Path to `manni.config.yaml`. |
| `--no-config` | Ignore any discovered config file. |
| `-g, --graph <path>` | Graph `.ttl` path. Default: config `out`. |
| `-i, --index <dir>` | Directory holding the indexes, the manifest and `provenance.json`. Default: beside the graph. |
| `--lang <tag>` | Which localization to search. Required when the corpus has more than one. |
| `--variant <variant>` | A scope filter, by product variant IRI, title or slug. |
| `--software-subject <subject>` | A scope filter, by software subject. |
| `--mode <mode>` | `lexical`, `vector` or `hybrid`. Default: hybrid when vectors exist. |
| `--vectors <path>` | Vector sidecar path. Default: from the manifest. |
| `--seeds <n>` | How many entry matches seed the walk. Overrides `graph.retrieve.seeds`. |
| `-d, --depth <n>` | Hops from each seed. Overrides `graph.retrieve.depth`. |
| `--max-chars <n>` | Character budget across all passages. Overrides `graph.retrieve.maxChars`. |
| `--withhold <list>` | Comma-separated, given once: `drifted`, `failing`. Overrides `graph.retrieve.withhold`. |
| `-f, --format <format>` | `pretty` or `json`. Default `pretty`. |

Every option but `--seeds`, `--max-chars` and `--withhold` already exists on
`search` or `traverse`, with the same name and meaning.

```yaml
# before: no graph.retrieve section

# after
graph:
  retrieve:              # new
    seeds: 3             # integer >= 1
    depth: 1             # integer >= 0
    maxChars: 12000      # integer >= 1
    withhold: []         # list of: drifted, failing
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| `graph.retrieve.seeds` | integer ≥ 1 | `3` | no | How many fused entry matches seed traversal. |
| `graph.retrieve.depth` | integer ≥ 0 | `1` | no | Hops from each seed. `0` serves the matches alone. |
| `graph.retrieve.maxChars` | integer ≥ 1 | `12000` | no | Character budget across every passage in one bundle. |
| `graph.retrieve.withhold` | list | `[]` | no | Passages to leave out. `drifted` is a passage with a pin at error severity. `failing` is a passage whose page has an eval that failed or errored. |

- **The trust floor is the publisher's.** `withhold` is config and a CLI
  flag. An MCP caller cannot set it, so an agent cannot lower the floor a
  publisher set.
- **A withheld passage is traced.** The trace gains `withheld`, one entry
  per passage with the node and its reasons. An agent sees what it lost.
- **Withholding needs records.** A non-empty `withhold` with no
  `provenance.json` is a usage error. An empty one with no file serves
  passages with `"provenance": null`, and warns once.

The bundle, from `-f json` and from every MCP tool, extends ADR 01018's.

```json
{
  "question": "How many times does an upload retry by default?",
  "language": "en",
  "context": [
    {
      "iri": "https://example.com/docs/uploads/retry.md#retry-limits",
      "title": "Retry limits",
      "page": "docs/uploads/retry.md",
      "sourceUrl": "docs/uploads/retry.md",
      "depth": 0,
      "text": "## Retry limits\n\nUploads retry three times…",
      "provenance": { "node": "…", "pins": { "…": "…" }, "dates": { "…": "…" }, "evals": { "…": "…" } }
    }
  ],
  "pages": {
    "docs/uploads/retry.md": {
      "metadata": { "title": "Retry an upload", "description": "…", "type": "how-to" }
    }
  },
  "citations": [
    { "iri": "https://example.com/docs/uploads/retry.md#retry-limits", "title": "Retry limits", "sourceUrl": "docs/uploads/retry.md" }
  ],
  "entry": { "lexical": [], "vector": [], "merged": [] },
  "trace": { "entry": [], "hops": [], "exclusions": [], "resolutions": [], "withheld": [] },
  "truncated": false
}
```

| key | change |
|---|---|
| `question` | New. The question asked. `traverse` and `impact` carry `node` instead. |
| `language` | New. The localization searched, or `null` for a walk with no `--lang`. |
| `context[].page` | New. The page the passage comes from. |
| `context[].provenance` | New. The record of section 1, or `null` with no `provenance.json`. |
| `pages` | New. Each cited page's delivered fields, by section 7's rule, once per page. |
| `trace.withheld` | New. `[{ "node": "<iri>", "because": ["drifted"] }]`. |
| `refusal.reason` | Gains four values, below. |

Metadata sits in `pages` because it is the same for every passage of a page.
The record repeats per passage, because 0095 copies one record on its own.

#### Structured refusal

A refusal is an answer, not an error. The bundle holds no context and a
`refusal` object.

| reason | when | extra key |
|---|---|---|
| `no-route` | No node is reachable under the scope filter. Unchanged. | |
| `no-content` | Nodes were reached, and none resolved within the budget. Unchanged. | |
| `withheld` | Passages matched, and the trust floor withheld every one. | `withheld`, as in the trace |
| `lang-required` | The corpus has several localizations, and the call named none. | `languages`, the tags that exist |
| `unknown-node` | `traverse` or `impact` named a node the graph does not hold. | |
| `unknown-scope` | A variant or software subject matched nothing. | |

The last three are usage errors on the CLI, exit 2, with the messages
`search` and `traverse` print today. Over MCP there is no exit code, so they
come back as refusals with the same text in `detail`. The rule is one
sentence. A usage error on the CLI is a refusal over MCP.

#### Pretty output

```text
$ manni graph retrieve "How many times does an upload retry by default?"
1  docs/uploads/retry.md § Retry limits            seed, lexical
   pins     2 current, 1 error: source-changed at line 47 (src/upload.ts:102-104)
   dates    updated 2026-10-02 (stamp stale), created 2025-03-14
   evals    4 pass, 1 fail: answers-the-question
2  docs/uploads/limits.md § Quotas                 1 hop, graph:references
   pins     none
   dates    updated 2026-09-11, created 2025-03-14
   evals    3 pass

2 passages, 2,310 of 12,000 characters. Pass -f json for the text and the trace.
```

```text
$ manni graph retrieve "How many times does an upload retry by default?" --withhold drifted,failing
No passage is served: every match is withheld.
  docs/uploads/retry.md § Retry limits   drifted, failing
  docs/uploads/retry.md                  failing
```

| result | exit |
|---|---|
| A bundle with context | 0 |
| A refusal | 1 |
| A usage or operational error | 2 |

### 4. `graph traverse --context`

The MCP server exposes `traverse` and `impact` beside `retrieve`, and ADR
01018 says each returns a bundle. The CLI gets the same thing, so each MCP
tool has a command a person can run.

| option | meaning |
|---|---|
| `--context` | New. Resolve the walked nodes and print the bundle, records included. |
| `--max-chars <n>` | New. The budget. Valid only with `--context`. |
| `--withhold <list>` | New. The trust floor. Valid only with `--context`. |

Without `--context`, `traverse` prints what it prints today. With it, a
refusal exits 1, as `retrieve` does.

### 5. `graph serve`, the MCP server

```bash
manni graph serve [options]
```

| option | meaning |
|---|---|
| `-c, --config <path>` | Path to `manni.config.yaml`. |
| `--no-config` | Ignore any discovered config file. |
| `-g, --graph <path>` | Graph `.ttl` path. Default: config `out`. |
| `-i, --index <dir>` | Directory holding the indexes, the manifest and `provenance.json`. |
| `--vectors <path>` | Vector sidecar path. Default: from the manifest. |
| `--withhold <list>` | The trust floor for every call. Overrides `graph.retrieve.withhold`. |

- **Transport is stdio.** The server reads JSON-RPC on stdin and writes it on
  stdout. Every diagnostic goes to stderr. It runs until stdin closes, then
  exits 0.
- **No auth.** A stdio server runs as the user who started it, over files
  that user can read. A network transport needs an auth decision, and is
  left to its own proposal.
- **Read once, at start.** The graph, the indexes and `provenance.json` load
  at start and stay fixed. A rebuild needs a restart. A stale artifact stops
  the start with exit 2, so a server never serves a mismatch.
- **The SDK is an optional peer.** `@modelcontextprotocol/sdk` joins
  `peerDependenciesMeta` as optional, as `@huggingface/transformers` did for
  `embed`. It loads on the Node side only, and never reaches the runtime
  bundle.

A client registers it as any stdio server.

```json
{
  "mcpServers": {
    "docs": { "command": "npx", "args": ["manni", "graph", "serve"] }
  }
}
```

#### The tools, as an agent sees them

`tools/list` returns three tools. Each is read-only and closed-world. The
server writes its resolved defaults into each description, so the numbers an
agent reads are the ones in force.

```json
{
  "name": "retrieve",
  "title": "Retrieve documentation",
  "description": "Find the documentation passages that answer a question. Each passage carries its source, the status of its citation pins, its dates and its eval verdicts. A refusal means no passage answers it.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["question"],
    "properties": {
      "question": { "type": "string", "minLength": 1, "description": "The question, as a reader would ask it." },
      "lang": { "type": "string", "description": "BCP-47 tag of the localization to search. Required when the docs have more than one: en, de." },
      "variant": { "type": "string", "description": "Product variant IRI, title or slug. Passages scoped to other variants are left out." },
      "softwareSubject": { "type": "string", "description": "Software subject. Passages scoped to other subjects are left out." },
      "depth": { "type": "integer", "minimum": 0, "description": "Hops to follow from each match. Default 1." },
      "maxChars": { "type": "integer", "minimum": 1, "description": "Character budget across all passages. Default 12000." }
    }
  },
  "outputSchema": { "$ref": "#/$defs/bundle" },
  "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false }
}
```

```json
{
  "name": "traverse",
  "title": "Walk the documentation graph",
  "description": "Walk the graph from one node and return the passages it reaches. Use it to follow links, prerequisites and sections from a passage retrieve returned.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["node"],
    "properties": {
      "node": { "type": "string", "minLength": 1, "description": "A node IRI from a retrieve result, or a prefix:local CURIE." },
      "depth": { "type": "integer", "minimum": 0, "description": "Maximum hops from the node. Default 1." },
      "predicates": { "type": "array", "items": { "type": "string" }, "description": "Only follow these predicates, as IRIs or CURIEs." },
      "reverse": { "type": "boolean", "description": "Follow inbound edges: what points at this node. Default false." },
      "lang": { "type": "string", "description": "Scope filter: BCP-47 language tag." },
      "variant": { "type": "string", "description": "Scope filter: product variant IRI, title or slug." },
      "softwareSubject": { "type": "string", "description": "Scope filter: software subject." },
      "limit": { "type": "integer", "minimum": 1, "description": "Stop after this many nodes." },
      "maxChars": { "type": "integer", "minimum": 1, "description": "Character budget across all passages. Default 12000." }
    }
  },
  "outputSchema": { "$ref": "#/$defs/bundle" },
  "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false }
}
```

```json
{
  "name": "impact",
  "title": "Find what a change affects",
  "description": "List the passages that depend on a node, following inbound edges transitively. Use it before changing a page, to see what else may need the same change.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["node"],
    "properties": {
      "node": { "type": "string", "minLength": 1, "description": "A node IRI, or a prefix:local CURIE." },
      "depth": { "type": "integer", "minimum": 0, "description": "Maximum inbound hops. Default 3." },
      "lang": { "type": "string", "description": "Scope filter: BCP-47 language tag." },
      "variant": { "type": "string", "description": "Scope filter: product variant IRI, title or slug." },
      "softwareSubject": { "type": "string", "description": "Scope filter: software subject." },
      "limit": { "type": "integer", "minimum": 1, "description": "Stop after this many nodes." },
      "maxChars": { "type": "integer", "minimum": 1, "description": "Character budget across all passages. Default 12000." }
    }
  },
  "outputSchema": { "$ref": "#/$defs/bundle" },
  "annotations": { "readOnlyHint": true, "idempotentHint": true, "openWorldHint": false }
}
```

- **One result shape.** Each tool returns the section 3 bundle as
  `structuredContent`. It also returns the same JSON as one text block, for
  clients that read only text.
- **`isError` is for faults.** A refusal is a result, `isError: false`. Only
  an unreadable source file or an internal fault sets `isError: true`.
- **Each tool has a CLI twin.** `retrieve` is `graph retrieve`. `traverse` is
  `graph traverse --context`. `impact` is `graph traverse --impact --context`.
  A list is a JSON array over MCP, and comma-separated on the CLI.

### 6. The golden set is the retrieval suite

DESIGN.md Phase 10 wants retrieval held to a regression contract, with no
model involved. 0087's golden set is that contract already, asked of the
wrong layer. So `graph check` asks every question of `retrieve` too, with the
same index, the same config and the same trust floor an agent gets.

A question is **cited** when the bundle's `citations` hold its answer.

- **Pinned.** A cited node's passage covers every pinned line. A parent
  section counts, since its passage holds its subsections.
- **Unpinned.** Any cited node is on the question's page.
- **Several answers.** Each must be cited.
- **Scope.** The question's language is the `--lang` of its call.

```yaml
# before (0087)
graph:
  check:
    questions:
      top: 5
      severity: warning
      foundThreshold: 95

# after
graph:
  check:
    questions:
      top: 5
      severity: warning
      foundThreshold: 95
      citedThreshold: 90     # new; percent 0-100, or null
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| `graph.check.questions.citedThreshold` | number 0-100, or null | `null` | no | `check` exits 1 when the share of reviewed questions cited falls below this. `null` sets no gate. |

The summary gains a `cited` row. The JSON report's `questions` object gains
`cited` and `withheld` counts beside `found`.

```text
questions  431: 288 reviewed, 143 drafted, on 142 pages and in docs/questions.yaml
  found    280 of 288 reviewed in the top 5 (97%), 204 first (71%)
  cited    271 of 288 reviewed by graph retrieve (94%), 6 withheld
  drafted  121 of 143 in the top 5, not counted until reviewed
  answers  296 pinned, 40 not reviewed: 282 current, 9 moved, 5 changed; 131 not pinned
  gaps     4 questions the docs don't answer, 1 refused by graph retrieve
```

| finding | severity | message |
|---|---|---|
| not cited | `questions.severity` | `"How many times does an upload retry by default?" is not cited by graph retrieve, which cites docs/uploads/limits.md § Quotas first.` |
| not cited, withheld | `questions.severity` | `"How many times does an upload retry by default?" is not cited by graph retrieve, because graph.retrieve.withhold left out § Retry limits as drifted.` |
| cited outside its language | error | `"Wie rotiere ich den Schlüssel?" asks in de, and graph retrieve cites docs/key/rotate.md, which is en.` |
| cited rate under `citedThreshold` | error | `271 of 288 reviewed questions are cited by graph retrieve (94%), under the 95% that graph.check.questions.citedThreshold asks for.` |

- **A miss in both layers is one finding.** A question not found in the top
  five reports 0087's finding alone. The not-cited finding is for a question
  search finds and the bundle drops.
- **The withheld message is the point.** A trust floor costs answers. The
  run says which, so a publisher sees the price of `withhold`.
- **A language leak is always an error.** The scope filter exists to prevent
  it, so a leak is a runtime bug. `questions.severity` does not soften it.
- **Gaps are counted, not gated.** Entry has no score floor, so lexical
  search matches something for almost any question. A refusal on a gap means
  little, and a missing one means less. The row is information.
- **Precision is not measured.** A bundle carries neighbors on purpose.
  Scoring it against one pinned answer would punish traversal for working.
- **`graph export questions` is unchanged.** It still hands the set to tools
  that judge answers, which manni does not.

### 7. Which fields reach agent-facing output

Issue #36 asks which fields survive into delivered output. The answer
combines the two marks that already exist, and adds none.

**A field reaches agent-facing output unless its schema marks it
`x-manni-graph-output: false` or `x-manni-location: external`.**

- **`x-manni-graph-output: false` keeps it out of anything published.** 0051
  § 5 made that mark the publishing decision. An agent bundle is published.
- **`x-manni-location: external` keeps it out of the page.** A served
  markdown variant ships the page's frontmatter, and an external field is
  not in it. The bundle matches what a served page already carries.
- **Both marks are needed.** 0051's stress test 3 is right that location
  alone is not a publishing decision. `authors` is external and published in
  the graph, and a delivered page still does not carry it.
- **Unmarked means delivered.** Both marks read absent as yes, and so does
  the rule.

Applied to the built-in vocabularies, as marked today:

| vocabulary | delivered | kept out |
|---|---|---|
| `core` | title, description, id, type, keywords, language, locale | |
| `stewardship` | last-updated | authors, owner, stakeholders, reviewed-by, created, last-reviewed, review-interval, verified-against, source-of-truth |
| `audience` | audiences, intent | personas, journeys, visibility |
| `lifecycle` | lifecycle, replaced-by | supersedes, remove-by |
| `structure` | applies-to, not-applicable-to, concepts, prerequisites, next-steps, related-pages | |
| `ai-context` | risks, sample-questions | provenance, meta-provenance |
| `evals`, `artifact-evals`, `citations` | | every field |
| `graph` | graph | |

- **The rule covers what this proposal adds.** That means the bundle's
  `pages[].metadata` and `graph export llms`. The jsonld, iiRDS and search
  targets keep 0051's rule unchanged, because they are linked data, not
  agent context.
- **The record carries the proof the kept-out fields stood for.**
  `created` is kept out as a field and served as evidence in `dates`. The
  `citations` field is kept out too, and its verdict is served in `pins`.
- **Delivery tools outside manni read the same marks.** They are plain
  schema annotations. The docs page for this rule is the statement issue
  #36 asked for.

### 8. `graph export llms`

The two descriptions drift because there are two. The fix is to keep one.
`graph export llms` writes `llms.txt` from the graph, so each entry's
description is the page's `description`, byte for byte. That follows the
family's pin-don't-copy rule. A generated file is a derived artifact, like
the search index, and nobody edits it.

It belongs under `graph export` because the graph already holds every input.
It holds each page's title, description, language and published path, after
the output filter. `site` runs a framework and owns no page data.

```yaml
# after
graph:
  export:
    llms:                                 # new
      title: manni                        # required for this target
      summary: One CLI for docs-as-code.  # optional
      origin: https://hawkeyexl.github.io # required for this target
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| `graph.export.llms.title` | string | none | for `llms` | The file's H1. |
| `graph.export.llms.summary` | string | none | no | The blockquote under the H1. |
| `graph.export.llms.origin` | URL | none | for `llms` | The site's scheme and host. A page's link is this, then its route's `basePath`, then its path without the extension, ending `/`. |

```markdown
# manni

> One CLI for docs-as-code.

## Docs

- [Publish the graph](https://hawkeyexl.github.io/manni/graph/publish/): Export the built graph as linked data, an iiRDS package, or a browser search index, on the run that already gated it.
```

- **One section per language.** A corpus with one localization gets
  `## Docs`. A corpus with several gets one section per BCP-47 tag, sorted.
- **Order is path order,** compared with `byCodeUnit`.
- **A page under no route is left out,** with one warning, because it has no
  published URL.
- **A page with no delivered description** gets a bare link, with no colon.
- **No `llms-full.txt`.** Full text is what `retrieve` serves, with the proof
  attached.

## The ladder

Minimal to maximal. Each rung shows what it prints, then the usage errors.

```text
# 1. Build what serving reads. Provenance is optional; search is not.
$ manni graph build && manni graph export search && manni graph export provenance
manni: no docevals report is configured, so records carry no eval verdicts.
Wrote .manni/graph/provenance.json (142 pages, 611 nodes).

# 2. The bare minimum that answers a question.
$ manni graph retrieve "How do I resume an upload?"
1  docs/uploads/resume.md § Resume                 seed, lexical
   pins     none
   dates    updated 2026-10-02, created 2025-03-14
   evals    not reported
…
3 passages, 4,102 of 12,000 characters. Pass -f json for the text and the trace.
exit 0

# 3. With eval verdicts, the CI form.
$ manni docevals run -f json > .manni/evals.json; manni graph export provenance --evals .manni/evals.json
Wrote .manni/graph/provenance.json (142 pages, 611 nodes, verdicts from .manni/evals.json).

# 4. The scripting form.
$ manni graph retrieve "How do I resume an upload?" -f json | jq '.context[].provenance.pins.error'
0
0
1

# 5. A walk, resolved into a bundle.
$ manni graph traverse urn:manni:graph:docs/uploads/resume.md --context --depth 2 -f json

# 6. What a change here affects, with text.
$ manni graph traverse urn:manni:graph:docs/uploads/resume.md --impact --context

# 7. A trust floor that costs an answer.
$ manni graph retrieve "How many times does an upload retry by default?" --withhold drifted,failing
No passage is served: every match is withheld.
  docs/uploads/retry.md § Retry limits   drifted, failing
exit 1

# 8. Every option at once.
$ manni graph retrieve "Wie rotiere ich den Schlüssel?" -c manni.config.yaml \
    -g .manni/graph/graph.ttl -i .manni/graph --lang de --variant SP-X100 \
    --software-subject configuration --mode hybrid --vectors .manni/graph/vectors.de.bin \
    --seeds 5 -d 2 --max-chars 20000 --withhold drifted -f json

# 9. Serve it to an agent.
$ manni graph serve
manni: serving retrieve, traverse and impact over stdio from .manni/graph/graph.ttl.

# 10. The suite in CI.
$ manni graph check
…
  cited    271 of 288 reviewed by graph retrieve (94%), 6 withheld
exit 1, when citedThreshold is 95

# 11. llms.txt.
$ manni graph export llms
Wrote .manni/graph/llms.txt (142 pages).
```

Usage and operational errors, each on stderr:

| case | stderr | exit |
|---|---|---|
| several localizations, no `--lang` | `search`'s message today, unchanged | 2 |
| unknown variant or software subject | `traverse`'s message today, unchanged | 2 |
| `--withhold` names an unknown value | `manni: --withhold takes drifted or failing, and got stale.` | 2 |
| `withhold` set, no `provenance.json` | `manni: graph.retrieve.withhold needs .manni/graph/provenance.json, which does not exist; run manni graph export provenance.` | 2 |
| `provenance.json` from another graph | `manni: .manni/graph/provenance.json was built from another graph; run manni graph export provenance.` | 2 |
| `provenance.json` absent, no `withhold` | `manni: .manni/graph/provenance.json does not exist, so passages carry no provenance; run manni graph export provenance.` | warning, exit unaffected |
| `--max-chars` or `--withhold` without `--context` on `traverse` | `manni: --max-chars needs --context.` | 2 |
| `--evals` with a target other than `provenance` | `manni: --evals applies only to graph export provenance.` | 2 |
| no evals report is configured | `manni: no docevals report is configured, so records carry no eval verdicts.` | warning, exit unaffected |
| the evals report is missing | `manni: graph.export.provenance.evals names .manni/evals.json, which does not exist.` | 2 |
| the evals report is not one | `manni: .manni/evals.json is not a docevals JSON report; write one with manni docevals run -f json.` | 2 |
| the report names pages the graph lacks | `manni: 3 pages in .manni/evals.json are not in the graph, so their verdicts are left out.` | warning, exit unaffected |
| git cannot run | `manni: git cannot read this directory (<git's reason>), so records carry no pins and no dates.` | warning, exit unaffected |
| the working tree differs from the commit | `manni: 2 pages differ from 26dad159, so their records describe uncommitted text.` | warning, exit unaffected |
| `serve` without the SDK | `manni: graph serve needs the optional @modelcontextprotocol/sdk package; run npm install @modelcontextprotocol/sdk.` | 2 |
| `llms` with no title | `manni: graph export llms needs graph.export.llms.title.` | 2 |
| `llms` with no origin | `manni: graph export llms needs graph.export.llms.origin, the site's scheme and host.` | 2 |
| a page under no route | `manni: 2 pages are under no route, so llms.txt leaves them out.` | warning, exit unaffected |

## The runtime API

`src/index.ts` does not change. The `@hawkeyexl/manni/graph/runtime` subpath
gains what the browser needs to serve the same bundle. It still imports
nothing from `node:`.

| addition | what it is |
|---|---|
| `retrieve(graph, lexical, options)` | Entry, traversal, resolution, records and assembly, in one call. |
| `parseProvenance(text)` | Reads `provenance.json`, refusing an unknown `format` or `version`. |
| `provenanceFor(doc, iri)` | Joins one node's record from the parsed artifact. |
| `ProvenanceRecord`, `ProvenanceDoc` | The types of sections 1 and 2. |
| `AssembleOptions.provenance`, `.withhold` | The artifact and the trust floor, for callers that assemble by hand. |
| `ContextBlock.page`, `.provenance` | Additive fields. |
| `RetrievalBundle.question`, `.language`, `.pages` | Additive fields. |
| `QueryTrace.withheld` | Additive. Always present, often empty. |
| `RefusalReason` | Gains `withheld`, `lang-required`, `unknown-node` and `unknown-scope`. |

The graph publish page gains the browser example DESIGN.md Phase 9 asks for.
It loads `graph.jsonld`, the search index and `provenance.json`, and renders
each passage with its pin and eval badges.

## What this does not do

- **Generate an answer.** ADR 01018 holds. manni returns the bundle and the
  agent reasons over it.
- **Serve over a network.** HTTP needs auth, origin and rate decisions that
  stdio does not. That is its own proposal.
- **Register the server in the plugin.** Most repos the plugin runs in have
  no built graph. Gate only what is set up.
- **Run an eval at export.** Verdicts come from a report a person or CI
  wrote.
- **Check a hand-written `llms.txt`.** The fix for two copies is one copy.
- **Add a schema keyword for delivery.** Two marks already answer it.

## Stress test

1. **A passage with a drifted pin, and no floor set.** It is served, with
   `pins.error: 1` and the finding named. The agent sees the drift and
   decides. Defaults never block.
2. **The same passage, with `withhold: [drifted]`.** It is withheld and
   traced. If nothing else matched, the bundle refuses with `withheld`. The
   golden set reports the questions the floor cost.
3. **An evals report from last week.** The verdicts are last week's. The
   record names the report by digest, but nothing ties it to a commit. See
   open question 1.
4. **A squash merge after export.** `dates` hold, by 0069. The `commit`
   names the branch commit, so a publisher exports again on the base branch.
5. **A page edited and not committed.** cite and derive read the working
   tree, and the record says `worktree: modified`. A publisher who exports
   from a dirty tree is told once.
6. **An agent that asks for a lower floor.** It cannot. `withhold` is not a
   tool parameter.
7. **A German question on a corpus with no German.** The CLI exits 2 with
   `search`'s message. Over MCP the agent gets `lang-required` with the tags
   that exist, and retries.
8. **A graph rebuilt while the server runs.** The server keeps serving the
   graph it loaded, and its artifacts stay consistent with it. A restart
   picks up the new one.
9. **`sample-questions` with pins, delivered.** The field is `page`, so its
   pins ship too, hashes included. They cost bytes and help no agent. See
   open question 3.
10. **A corpus with no citations and no evals.** Every record has
    `pins.total: 0` and `evals: null`. The bundle still works. The record
    says what was not checked, rather than implying it passed.

## Open questions

1. **Tie verdicts to a commit.** The docevals JSON report carries no commit,
   so a record cannot prove its verdicts describe the text it serves. Should
   `docevals run -f json` gain `commit` and `worktree`, and export refuse a
   report from another commit?
2. **Exit 1 on refusal.** It follows grep, where no match is 1, and lets a
   script branch. The family reserves 1 for findings. Is a refusal close
   enough?
3. **Delivered `sample-questions`.** Should delivery reduce each item to its
   `question` text, or should ai-context mark the pins some other way?
4. **The trailing slash in `llms.txt` links.** Starlight and most
   frameworks serve `/path/`. Is a fixed trailing slash right, or should a
   route say?
5. **The SDK as an optional peer.** It keeps installs small, and costs a
   second install step for anyone who serves. Would a plain dependency be
   the better trade?

## Acceptance checklist

### PR 1, the record and the artifact

- [ ] `src/graph/runtime/provenance.ts` exists, with `parseProvenance` and `provenanceFor`, and imports nothing from `node:`.
- [ ] `src/graph/core/provenance.ts` builds the artifact on the Node side from cite's classifier, meta's derive and a docevals report.
- [ ] `manni graph export provenance` writes `provenance.json` beside the graph, and exits 0.
- [ ] The artifact's top-level keys are `format`, `version`, `graph`, `commit`, `worktree`, `evals`, `pages` and `nodes`.
- [ ] Two exports over the same commit, report and config are byte-identical.
- [ ] Each node's `lines` match what `sliceSection` returns for a section, and the whole body for a document.
- [ ] A pin whose claim overlaps a node's lines appears in that node's `pins.items`, with cite's rule and resolved severity.
- [ ] Each `pins.items[]` entry carries `commit`, equal to cite's recorded commit for that citation, reachable or not.
- [ ] `dates.created` and `dates.lastUpdated` equal what `manni meta derive` would stamp, as UTC days.
- [ ] `stamp` reads `current`, `stale` or `absent` against the page's own field.
- [ ] `graph.export.provenance.evals` and `--evals` fill `evals`. Without either, every `evals` is `null`.
- [ ] `--evals` with another target exits 2 with the message above.
- [ ] A missing report, a non-report and unknown pages print the messages above, with the exit codes above.
- [ ] Outside git, `pins`, `dates` and `commit` are `null`, with one warning.
- [ ] `pages[].metadata` holds exactly the fields section 7 delivers, tested against each built-in vocabulary.
- [ ] `test/graph/fixtures/provenance/` holds a minimal corpus with one drifted pin, one stale stamp and one evals report.
- [ ] `test/graph/integration/runtime-bundle.test.ts` still passes over the built bundle.

### PR 2, retrieve and traverse

- [ ] `manni graph retrieve "<question>"` prints the pretty output above, and exits 0 with context.
- [ ] `-f json` prints the bundle of section 3, with `question`, `language`, `context[].page`, `context[].provenance`, `pages` and `trace.withheld`.
- [ ] A refusal exits 1, and its JSON carries `refusal.reason` and the extra key for that reason.
- [ ] `--withhold drifted,failing` withholds by the record, and traces each withheld node.
- [ ] Every usage error in the ladder's table prints its message and exits 2.
- [ ] `graph.retrieve.seeds`, `depth`, `maxChars` and `withhold` validate in `config-schema.json`, with a positive and a negative case each.
- [ ] Each flag overrides its key, and the flag-free run reads the key.
- [ ] `manni graph traverse <node> --context` prints the bundle. Without `--context` its output is byte-identical to today's.
- [ ] `--max-chars` or `--withhold` without `--context` exits 2.
- [ ] `docs/src/content/docs/graph/reference/cli.mdx` documents `retrieve`, the new `traverse` flags and the new export targets, and `npm run docs:check-cli` passes.
- [ ] `docs/src/content/docs/graph/reference/configuration.mdx` documents every new key.
- [ ] `docs/src/content/docs/graph/reference/library-api.mdx` lists every runtime addition above.

### PR 3, serve

- [ ] `manni graph serve` answers `tools/list` with exactly `retrieve`, `traverse` and `impact`, with the schemas above.
- [ ] Each tool returns the bundle as `structuredContent` and as one text block.
- [ ] A refusal returns `isError: false`. A usage error over MCP returns the matching refusal reason, with the CLI's text in `detail`.
- [ ] No tool accepts `withhold`.
- [ ] A stale artifact stops the start with exit 2.
- [ ] Without `@modelcontextprotocol/sdk`, `serve` exits 2 with the message above.
- [ ] `package.json` lists `@modelcontextprotocol/sdk` as an optional peer, and the lockfile diff adds only it and its own tree.
- [ ] A test drives the server over stdio with the SDK's client, hermetically.
- [ ] `test/graph/real/` drives the real SDK, and `npm run test:graph:real` runs it.
- [ ] A new page, `docs/src/content/docs/graph/serve/index.mdx`, shows a client registration and one tool call, with `title` and `description`.

### PR 4, the suite and llms.txt

- [ ] `graph check` asks every question of `retrieve`, and prints the `cited` row and the `gaps` refusal count above.
- [ ] The JSON report's `questions` object carries `cited` and `withheld`.
- [ ] The not-cited, withheld, language-leak and threshold findings print the messages above, at the severities above.
- [ ] A question missed by search reports 0087's finding alone.
- [ ] `graph.check.questions.citedThreshold` gates the run at exit 1, and `null` sets no gate.
- [ ] `manni graph export llms` writes `llms.txt` with one entry per routed page, whose description equals its frontmatter `description`.
- [ ] A multi-language corpus gets one section per tag, and a page under no route warns once.
- [ ] A missing `title` or `origin` exits 2 with the messages above.
- [ ] `docs/src/content/docs/graph/publish/index.mdx` covers `provenance` and `llms`, and carries the browser example.
- [ ] A docs page states section 7's delivery rule, and issue #36 links to it.
- [ ] `docs/content-strategy/cujs.md` gains D18, "Serve the docs to an agent with their proof".
- [ ] `node dist/cli.js meta validate`, `cite check`, `term check` and Vale pass over the changed docs.
- [ ] A demo video under `media/graph-serve/` shows an agent's bundle with a drifted pin, then the same call withheld.
- [ ] This proposal's `Status:` line reads `Implemented` with the PR numbers.
