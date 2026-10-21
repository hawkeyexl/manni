# 0090: Served passages carry their proof

- **Status:** Implemented (#224, #225, #226, #227, #<this PR>)
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
  - Two new journeys: D19, "Serve the docs to an agent with their proof",
    and M29, "Ground a site's Ask AI in the docs' proof".
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
  `retrieve.ts` new, `chunks.ts` new), `src/graph/commands/`
  (`chunks.ts` new, `retrieve.ts` new, `serve.ts` new, `publish.ts` new,
  `llms.ts` new, `traverse.ts`, `export.ts`, `check.ts`, `questions.ts`),
  `src/graph/core/` (`config-schema.json`, `config.ts`),
  `src/site/core/detect.ts`, `src/docevals/core/engine.ts`,
  `src/meta/schemas/ai-context/1.2.0.json` new, `src/graph/reporters/`,
  `src/graph/cli.ts`, `package.json`, `.github/workflows/docs.yml`,
  `docs/src/content/docs/graph/`, `docs/src/components/` new,
  `docs/content-strategy/cujs.md`, `test/graph/`
- **Verdict:** Every passage manni serves carries a provenance record. The
  record holds its pin status, its merge-safe dates and its page's eval
  verdicts. `graph export chunks` writes every passage with its record, and
  every host serves those rows. `manni graph publish` writes them, with
  everything else serving needs, in one command. `lookup` is the one call.
  It takes a question and returns three full result sets with their proof:
  `graph lookup` on the CLI, a tool over `graph serve`, and
  `createRetriever().lookup()` in a script. The golden set becomes the retrieval suite inside
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

## Worked example

This repo, end to end. Maya maintains the docs, and Devin owns CI.

**One command in CI.** Maya runs the judged evals locally and commits the
report. `manni.config.yaml` names it once under
`graph.export.chunks.evals`. `docs.yml` then runs one line after the gate:

```text
$ manni graph check && manni graph publish --out docs/public/graph
build     graph.ttl: 142 pages, 611 nodes
embed     vectors.en.bin: 611 vectors, Xenova/bge-small-en-v1.5
export    graph.jsonld, search.en.json, chunks.json + chunks.en.jsonl (611 chunks, 0 withheld), llms.txt (142 pages)
skipped   iirds: no graph.export.iirds section
Published 7 files to docs/public/graph/.
```

One row of `chunks.en.jsonl`, abridged:

```json
{ "id": "https://hawkeyexl.github.io/manni/cite/#how-a-pin-is-classified",
  "page": "docs/src/content/docs/cite/index.mdx", "lines": "41-58", "language": "en",
  "title": "How a pin is classified", "text": "## How a pin is classified\n\nA pin is current when…",
  "vector": [0.0132, -0.0871, "…"],
  "metadata": { "title": "Check citations", "applies-to": ["cite"] },
  "provenance": { "commit": "26dad159…", "worktree": "clean",
    "pins": { "total": 4, "current": 3, "error": 1 },
    "dates": { "lastUpdated": { "day": "2026-10-17", "stamp": "current" }, "lastVerified": "2026-10-20" },
    "evals": { "current": true, "pass": 3, "fail": 0 } } }
```

**Maya's agent, over MCP.** `.mcp.json` registers `npx manni graph serve`.
The agent calls one tool with one argument: `lookup` with
`{ "question": "How does cite check decide a pin moved?" }`. The result has
three complete sections.

- **`matches`** holds the row above first, with its lexical, vector and
  fused scores, and the runner-up matches below it.
- **`traversal`** holds every node reached outward from those matches. Each
  carries the edge that reached it, such as
  `from cite/#how-a-pin-is-classified via graph:references`.
- **`impact`** holds every node that depends on the matches, such as
  `cite/reference/cli.mdx § update`, with its inbound edge.

Each passage carries its text and its record. The agent quotes the three
current sentences and flags line 47 as unverified. It also knows which pages
to update if it changes the classifier's behavior.

**An Ask AI built on the functions.** A team running a doc site on manni's
artifact writes a worker. manni retrieves, and their own model answers:

```ts
import { createRetriever, type LookupResult } from "@hawkeyexl/manni/graph/runtime";

const docs = await createRetriever({ manifest: "https://hawkeyexl.github.io/manni/graph/chunks.json" });

function passages(result: LookupResult, section: "matches" | "traversal" | "impact", role: string) {
  return result[section].passages.flatMap((p) =>
    p.text === null ? []
      : [{ id: p.iri, role, title: p.title, text: p.text, unverified: p.provenance.pins.error > 0 }]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { question } = (await request.json()) as { question: string };
    const result = await docs.lookup(question);
    if (result.refusal) return Response.json({ answer: null, refusal: result.refusal });
    const context = [...passages(result, "matches", "answer"),
      ...passages(result, "traversal", "background"), ...passages(result, "impact", "dependent")];
    const answer = await env.MODEL.answer({ question, context }); // their backend of choice
    return Response.json({ answer, citations: result.citations });
  },
};
```

They hold a hosted vector DB, so they ingest `chunks.en.jsonl` once and pass
`store: createHttpVectorStore({ url: env.VECTORS_URL })`. Every other line
stays the same.

**Devin raises the floor.** He sets `graph.retrieve.withhold: [drifted]`.
The next `graph publish` leaves `cite/#how-a-pin-is-classified` out of the
rows and lists it under `withheld`. Every host reads those rows, so none
holds that text, and each trace names it.

**The suite.** `manni graph check` prints
`cited    271 of 288 reviewed by graph retrieve (94%), 6 withheld`.

**The prototype.** The docs site's "Retrieve from a script" page carries a
small search box marked "Prototype". It is built from
`createRetriever().lookup()` in lexical mode and shows each passage's role
and pin badges. It is not part of the package.

## Design

The work lands as five stacked PRs, in this order.

| PR | What lands |
|---|---|
| 1 | The provenance record, `graph export chunks`, page `integrity` in `docevals run -f json`, the delivery rule, and the ai-context annotation-only version. |
| 2 | `graph lookup`, `graph retrieve`, `graph traverse --context`, the runtime's `retrieve()` and `lookup()`, `createRetriever()` and its seams. |
| 3 | `graph serve`, the MCP server, and its page for D19. |
| 4 | The golden set through `retrieve` in `graph check`, `graph export llms`, `graph publish`, and `docs.yml` publishing into the site. |
| 5 | The page for M29, the publish page led by `graph publish`, and a labelled prototype search box on this repo's site. |

manni ships no UI. The prototype is built from the public functions, is
labelled, and is not exported.

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
        "findings": [],
        "lastVerified": "2026-10-19",
        "verifiedBy": [{ "tool": "lychee", "passed": "2026-10-19" }]
      },
      {
        "id": null,
        "claim": "47",
        "source": "src/upload.ts:102-104",
        "commit": "4be07d19a3c5f8206b1d3e5a7c9f0b2d4e6a8c10",
        "findings": [{ "rule": "source-changed", "severity": "error" }],
        "lastVerified": null,
        "verifiedBy": []
      },
      {
        "id": "retry-backoff",
        "claim": "49-50",
        "source": "src/upload.ts:110-118",
        "commit": "9f3a1c7e5b2d4086a1c3e5f7092b4d6e8a0c2e41",
        "findings": [],
        "lastVerified": null,
        "verifiedBy": []
      }
    ]
  },
  "dates": {
    "created": { "day": "2025-03-14", "stamp": "current" },
    "lastUpdated": { "day": "2026-10-02", "stamp": "stale" },
    "lastVerified": "2026-10-20",
    "verifiedBy": [{ "tool": "doc-detective", "check": "retry-limits", "passed": "2026-10-20" }]
  },
  "evals": {
    "report": "sha256-5c1e…",
    "current": true,
    "pass": 4,
    "fail": 1,
    "needsReview": 0,
    "skipped": 0,
    "error": 0,
    "items": [
      { "name": "no-todo-markers", "suite": "graph", "grader": "command", "outcome": "pass" },
      { "name": "answers-the-question", "suite": "quality", "grader": "ai", "outcome": "fail", "confidence": 0.91 }
    ]
  },
  "statements": [
    { "lines": "45-46", "status": "current", "data": { "last-verified": "2026-10-21" } }
  ]
}
```

| field | type | meaning |
|---|---|---|
| `node` | IRI | The graph node the passage resolves from. |
| `page` | path | The page source, labelled as `graph build` labels it. |
| `lines` | `"N-M"` | The body lines the passage covers, counted as cite counts `claim.lines`. |
| `commit` | 40 hex, or `null` | The commit the record describes. `null` outside git. |
| `worktree` | `clean`, `modified`, or `null` | `modified` when any page differed from that commit at export. `null` outside git. |
| `pins` | object | The cite pins whose claim overlaps `lines`. Computed outside git too, as `cite check` classifies without history. |
| `pins.total` | integer | How many pins the passage holds. |
| `pins.current` | integer | Pins with no findings. |
| `pins.notice`, `.warning`, `.error` | integer | Pins counted once, at their worst finding's severity. |
| `pins.items[].id` | string, or `null` | The citation's `id`, when it has one. |
| `pins.items[].claim` | `N` or `"N-M"` | The body lines the claim occupies now. |
| `pins.items[].source` | string | `path:lines` as cite writes it. An encrypted path stays the ciphertext token. |
| `pins.items[].commit` | 40 hex, or `null` | The commit the citation's source end was recorded at, as cite recorded it. `null` for a pin minted without one. |
| `pins.items[].findings` | list | Each cite rule that fires, with the severity `cite.severity` resolves for it. Empty means current. |
| `pins.items[].lastVerified`, `.verifiedBy` | string or `null`, list | The entry's `last-verified` as written and its `verified-by` entries (0098), or `null` and `[]`. |
| `dates` | object | The two merge-safe dates of 0069, and the page's verification. |
| `dates.created`, `.lastUpdated` | object | Each holds a `day` and a `stamp`. |
| `dates.*.day` | `YYYY-MM-DD`, or `null` | The day meta's derive computes from git, as a UTC day under 0072. `null` outside git, for an uncommitted body change, and when git holds no evidence. |
| `dates.*.stamp` | `current`, `stale`, `absent`, or `null` | Whether the page's own field names that day, another day, or none. `null` exactly when `day` is, since nothing derived exists to compare against. |
| `dates.lastVerified`, `.verifiedBy` | string or `null`, list | The page's `last-verified` as written and its `verified-by` entries (0098), or `null` and `[]`. Read outside git too. |
| `evals` | object, or `null` | The page's verdicts from the docevals report. `null` when no report was given. |
| `evals.report` | `sha256-<64 hex>` | The digest of the report the verdicts came from. |
| `evals.current` | boolean | Whether the page still has the bytes the report's `integrity` names. A stale verdict never counts toward `failing`. |
| `evals.pass` … `.error` | integer | Results per docevals outcome. |
| `evals.items[]` | list | One entry per result: `name`, `suite`, `grader`, `outcome`, and `confidence` for an AI grader. Sorted by suite, then name. |
| `statements` | list | The block `meta` statements (0099) anchored inside `lines`: `lines`, `status` and the delivered `data`. Empty when none are. |

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
- **Verdicts are tied to the text they judged.** Each result of
  `docevals run -f json` gains `integrity`, the digest of the page as the run
  read it. The record's `evals.current` says whether the page still has those
  bytes. This resolves open question 1 without tying verdicts to a commit.
- **Outside git the record still says what it can.** A repository without
  git is a normal case. `commit`, `worktree` and every `day` are `null`, and
  `pins` and the verification fields are computed as usual. One notice says
  so, and the export succeeds.

### 2. `graph export chunks`

Provenance needs git, and the runtime cannot run git. So the record is built
on the compile side, as the search index is, and the runtime reads it.

`EXPORT_TARGETS` gains `chunks`. It writes two kinds of file into one
directory, beside the graph unless `-o` names another.

- **`chunks.json`, the manifest.** Its keys are `format`
  (`manni-graph-chunks`), `version` (1), `graph`, `graphFile`, `searchIndex`,
  `commit`, `worktree`, `retrieve`, `evals`, `languages`, `pages` and
  `withheld`. Each `languages` entry is `{ file, rows, model }`.
- **One `chunks.<tag>.jsonl` per localization.** Each line is one passage:
  `id` (the node IRI), `graph`, `page`, `lines`, `language`, `title`, `text`,
  `vector` when a sidecar holds one, `metadata`, and `provenance`, the record
  of section 1.

```json
{
  "format": "manni-graph-chunks",
  "version": 1,
  "graph": "sha256-…",
  "graphFile": "graph.jsonld",
  "searchIndex": "localizations.json",
  "commit": "26dad159c0f1e4a8b7d2c3e5f6a7b8c9d0e1f2a3",
  "worktree": "clean",
  "retrieve": { "seeds": 3, "depth": 1, "maxChars": 12000, "withhold": [] },
  "evals": { "report": ".manni/evals.json", "digest": "sha256-5c1e…" },
  "languages": {
    "en": {
      "file": "chunks.en.jsonl", "rows": 611,
      "model": { "id": "Xenova/bge-small-en-v1.5", "dimensions": 384 }
    }
  },
  "pages": {
    "docs/uploads/retry.md": {
      "metadata": { "title": "Retry an upload", "description": "…", "type": "how-to" }
    }
  },
  "withheld": []
}
```

- **Every row is self-contained.** A vector DB ingests the rows as they are,
  and every host reads the same rows, so none re-chunks the pages.
- **A row's `metadata` is its section's view.** It holds the page's
  delivered fields, overlaid by the delivered fields of every heading
  statement from the page down to the section. The nearest wins, field by
  field.
- **`graph` is the digest of the graph's JSON-LD.** It is the bytes
  `graph export jsonld` writes. Every row repeats it, and every host refuses
  a mismatch.
- **Vectors come from the sidecar.** A node `graph embed` embedded carries
  its vector. Each language's `model` names the model its own sidecar was
  embedded with, because `graph.embed.byLanguage` can embed each language
  with a different one. A language with no sidecar has `model: null`. With no
  sidecar at all, rows carry no vectors, and the export warns once.
- **Byte-stable.** Keys are sorted, rows are in id order, and nothing reads
  the wall clock. The same commit, report and config give the same bytes.
- **Eval verdicts come from a report, never a run.** Export never runs an
  eval. It reads the JSON that `manni docevals run -f json` prints. Judged
  evals run on a person's machine, and an export in CI must not need a model.
- **`metadata` is section 7's rule, applied once.** The runtime cannot
  resolve schemas, so export writes each page's delivered fields here.
- **The trust floor applies at export.** A passage `graph.retrieve.withhold`
  names is left out of the rows and listed under `withheld`, so no host
  holds its text.

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
    chunks:                        # new
      evals: .manni/evals.json     # new; path, or null
  retrieve:                        # new; section 3
    withhold: []
```

| key | type | default | required | meaning |
|---|---|---|---|---|
| `graph.export.chunks.evals` | path, or null | `null` | no | A docevals JSON report, relative to the config file. Its verdicts fill each record's `evals`. `null` leaves every `evals` null. |

`--evals <path>` on `graph export` overrides it. It is valid only with the
`chunks` target.

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
| `-i, --index <dir>` | Directory holding the indexes, the manifest and `chunks.json`. Default: beside the graph. |
| `--lang <tag>` | Which localization to search. Required when the corpus has more than one. |
| `--variant <variant>` | A scope filter, by product variant IRI, title or slug. |
| `--software-subject <subject>` | A scope filter, by software subject. |
| `--mode <mode>` | `lexical`, `vector` or `hybrid`. Default: hybrid when vectors exist. |
| `--seeds <n>` | How many entry matches seed the walk. Overrides `graph.retrieve.seeds`. |
| `-d, --depth <n>` | Hops from each seed. Overrides `graph.retrieve.depth`. |
| `--max-chars <n>` | Character budget across all passages. Overrides `graph.retrieve.maxChars`. |
| `--withhold <list>` | Comma-separated, given once: `drifted`, `failing`. Tightens `graph.retrieve.withhold` for this call. |
| `--where <field=value>` | Only passages whose metadata field holds the value. Repeatable, and every condition must hold. |
| `-f, --format <format>` | `pretty` or `json`. Default `pretty`. |

Every option but `--seeds`, `--max-chars`, `--withhold` and `--where`
already exists on `search` or `traverse`, with the same name and meaning.
Rows carry their vectors, so `retrieve` reads no sidecar and takes no
`--vectors`.

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
| `graph.retrieve.withhold` | list | `[]` | no | Passages to leave out, at export and again at query. `drifted` is a passage with a pin at error severity. `failing` is a passage whose page has a current eval verdict that failed or errored. |

- **The trust floor is the publisher's.** `withhold` is config and a CLI
  flag. An MCP caller cannot set it, so an agent cannot lower the floor a
  publisher set. A script's per-call `withhold` only tightens it, as section
  13 records.
- **A withheld passage is traced.** The trace gains `withheld`, one entry
  per passage with the node and its reasons. An agent sees what it lost.
- **Withholding needs records.** Every host reads the chunk rows, and every
  row carries its record. A host with no `chunks.json` is told to publish.

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
| `context[].provenance` | New. The record of section 1. |
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
| A refusal | 0 |
| A usage or operational error | 2 |

A refusal is an answer, so it exits 0, and a script reads `refusal`. This
resolves open question 2.

### 4. `graph traverse --context`

The MCP server exposes `traverse` and `impact` beside `retrieve`, and ADR
01018 says each returns a bundle. The CLI gets the same thing, so each MCP
tool has a command a person can run.

| option | meaning |
|---|---|
| `--context` | New. Resolve the walked nodes and print the bundle, records included. |
| `--max-chars <n>` | New. The budget. Valid only with `--context`. |
| `--withhold <list>` | New. The trust floor. Valid only with `--context`. |
| `--where <field=value>` | New. Only passages whose metadata field holds the value. Valid only with `--context`. |

Without `--context`, `traverse` prints what it prints today. With it, a
refusal exits 0, as `retrieve` does.

### 5. `graph serve`, the MCP server

```bash
manni graph serve [options]
```

| option | meaning |
|---|---|
| `-c, --config <path>` | Path to `manni.config.yaml`. |
| `--no-config` | Ignore any discovered config file. |
| `-g, --graph <path>` | Graph `.ttl` path. Default: config `out`. |
| `-i, --index <dir>` | Directory holding the indexes, the manifest and `chunks.json`. |
| `--withhold <list>` | Tightens `graph.retrieve.withhold` for every call. |

- **Transport is stdio.** The server reads JSON-RPC on stdin and writes it on
  stdout. Every diagnostic goes to stderr. It runs until stdin closes, then
  exits 0.
- **No auth.** A stdio server runs as the user who started it, over files
  that user can read. A network transport needs an auth decision, and is
  left to its own proposal.
- **Read once, at start.** The graph, the indexes and `chunks.json` load
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

`tools/list` returns four tools, in this order. Each is read-only and
closed-world, and every input schema has `additionalProperties: false`.

| Tool | Required | Optional | Description |
|---|---|---|---|
| `lookup` | `question` | none | "Start here. Pass the reader's question. You get three full result sets. Every match is ranked with its scores. Every passage reached by following links outward from the matches comes back, and so does every passage that depends on the matches. Each set has its edges, and each passage has its source and proof: pin status, dates and eval verdicts. A refusal means nothing in the docs answers it." |
| `retrieve` | `question` | `lang`, `variant`, `softwareSubject`, `depth`, `maxChars`, `where` | "Like lookup, with control over language, scope, depth and budget." |
| `traverse` | `node` | `depth`, `predicates`, `reverse`, `lang`, `variant`, `softwareSubject`, `limit`, `maxChars`, `where` | "Walk the graph from one node and return the passages it reaches." |
| `impact` | `node` | `depth` (default 3), `lang`, `variant`, `softwareSubject`, `limit`, `maxChars`, `where` | "List the passages that depend on a node. Use it before changing a page." |

`lookup`'s `outputSchema` is the lookup result of section 9, and the other
three return the bundle. No tool accepts `withhold`.

- **Two result forms.** Each tool returns its result as
  `structuredContent`. It also returns the same JSON as one text block, for
  clients that read only text.
- **`isError` is for faults.** A refusal is a result, `isError: false`. Only
  an unreadable source file or an internal fault sets `isError: true`.
- **Each tool has a CLI twin.** `lookup` is `graph lookup`. `retrieve` is `graph retrieve`. `traverse` is
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
- **Marks are read at every depth.** A mark on a nested property keeps that
  property out, so a `sample-questions` item keeps its question and drops
  its answer pins. `manni:ai-context:1.2.0` marks `answers` that way. It is
  an annotation-only version, a non-breaking `feat`, and the default set
  moves to it. This resolves open question 3. `graph check` and
  `graph export questions` read answer pins from the pages, not from the
  published graph, so the mark costs them nothing.

Applied to the built-in vocabularies, as marked today:

| vocabulary | delivered | kept out |
|---|---|---|
| `core` | title, description, id, type, keywords, language, locale | |
| `stewardship` | last-updated | authors, owner, stakeholders, reviewed-by, created, last-reviewed, review-interval, verified-against, source-of-truth |
| `audience` | audiences, intent | personas, journeys, visibility |
| `lifecycle` | lifecycle, replaced-by | supersedes, remove-by |
| `structure` | applies-to, not-applicable-to, concepts, prerequisites, next-steps, related-pages | |
| `ai-context` | risks, sample-questions (each without its `answers`) | provenance, meta-provenance |
| `evals`, `artifact-evals`, `citations` | | every field |
| `graph` | graph | |

- **The rule covers what this proposal adds.** That means the chunk
  manifest's `pages[].metadata`, each row's `metadata`, each statement's
  `data`, the bundle's `pages` and `graph export llms`. The jsonld, iiRDS and search
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

### 9. `lookup`, the one call

`lookup` takes only a question and runs three operations. It returns each in
full, in its own section of a `LookupResult`.

- **`matches`**: entry across every localization, keeping the language whose
  best match scores highest. Every ranked match comes back with its lexical,
  vector and fused scores.
- **`traversal`**: the outward walk from every match to
  `graph.retrieve.depth`, with every node reached and every edge followed.
- **`impact`**: the inward walk from every match, to the depth
  `graph traverse --impact` uses by default (3), with every dependent node
  and every edge.

```bash
manni graph lookup <question> [options]
```

It takes only plumbing options: `-c`, `--no-config`, `-g`, `-i` and `-f`.
Every retrieval setting comes from config.

```jsonc
{
  "question": "How does cite check decide a pin moved?",
  "language": "en",
  "matches": {
    "passages": [
      { "iri": "…/cite/#how-a-pin-is-classified", "title": "How a pin is classified",
        "page": "docs/src/content/docs/cite/index.mdx", "lines": "41-58", "rank": 1,
        "score": { "lexical": 12.4, "vector": 0.81, "fused": 0.033 },
        "text": "## How a pin is classified\n\n…", "truncated": false,
        "provenance": { /* the record */ } }
    ],
    "truncated": false
  },
  "traversal": { "passages": [ { "iri": "…", "depth": 1 } ], "edges": [ { "from": "…", "predicate": "graph:references", "to": "…" } ], "truncated": false },
  "impact": { "passages": [], "edges": [], "truncated": false },
  "pages": { "<page>": { "metadata": { } } },
  "citations": [ { "iri": "…", "title": "…", "sourceUrl": "…" } ],
  "trace": { "entry": { "languages": { "en": 0.033, "de": 0.004 }, "chosen": "en" }, "withheld": [] }
}
```

- **Nothing is dropped.** Every node keeps its place, edges and record. A
  node reached by both walks appears in both, and a match repeats in
  neither.
- **The budget trims text only.** `graph.retrieve.maxChars` applies to each
  section's passage text separately. A passage past it keeps everything but
  its text, which is `null` with `truncated: true`.
- **Its parts are the other verbs.** `matches` plus `traversal` equals
  `retrieve(question)` without a budget. `impact` equals the union of
  `impact(match)` over the matches.
- **It never refuses `lang-required`.** `language` names the language it
  chose, and `trace.entry.languages` says why.

### 10. The script surface

`createRetriever(options)`, from `@hawkeyexl/manni/graph/runtime`, is
platform-neutral. It returns data and calls no model besides the query
embedder.

| Option | Type | Default | Meaning |
|---|---|---|---|
| `manifest` | URL string or a parsed manifest | required | `chunks.json`. The graph, the search index and the rows resolve from its directory. |
| `store` | `VectorStore` | the static store over the rows' vectors | Pass `createHttpVectorStore(...)` for a hosted DB. |
| `chunks` | `ChunkSource` | the chunk files the manifest names | Pass your own to read rows from a vector DB by id. |
| `embed` | embedder or `false` | `graph/embed` with each language's model | `false` forces lexical entry. |
| `fetch` | function | the global `fetch` | For hosts without one, or tests. |

| Member | Same as | Returns |
|---|---|---|
| `lookup(question)` | MCP `lookup`, `graph lookup` | a `LookupResult` |
| `retrieve(question, { lang, variant, softwareSubject, depth, maxChars, mode, where, withhold })` | MCP `retrieve`, `graph retrieve` | a bundle |
| `traverse(node, { depth, predicates, reverse, lang, variant, softwareSubject, limit, maxChars, where, withhold })` | MCP `traverse`, `graph traverse --context` | a bundle |
| `impact(node, { depth, lang, variant, softwareSubject, limit, maxChars, where, withhold })` | MCP `impact`, `graph traverse --impact --context` | a bundle |
| `manifest` | n/a | the parsed manifest |

Rows load lazily, one language at a time. `StaleArtifactError` and
`ModelMismatchError` throw, and refusals come back in the result. A host
supplies two seams:

```ts
interface VectorStore {
  query(q: { text: string; vector: number[] | null; k: number;
             language: string | null; where: { field: string; value: string }[] }):
    Promise<Array<{ id: string; score: number; row?: ChunkRow }>>;
}
interface ChunkSource {
  get(ids: string[], language: string | null): Promise<ChunkRow[]>;
}
```

- **`createStaticVectorStore(rows)`** ranks by cosine in memory, among the
  rows that meet `where`. It needs no service.
- **`createHttpVectorStore({ url, fetch })`** speaks section 11's protocol.
- **`createChunkFileSource(textOrUrl, { fetch })`** reads one
  `chunks.<tag>.jsonl`. **`parseChunkRows(text)`** yields its rows, for
  ingestion.

manni ships no UI and no vendor SDK. The only UI is a prototype search box on
this repo's docs site. It is built from these functions, labelled
"Prototype", and not exported.

### 11. The HTTP store protocol

A site's server implements one endpoint over any vector DB. The store POSTs
one JSON object per query:

```json
{ "text": "How does cite check decide a pin moved?", "vector": [0.0132, -0.0871],
  "k": 3, "language": "en", "where": [] }
```

The server answers with the matches:

```json
{ "matches": [ { "id": "https://hawkeyexl.github.io/manni/cite/#how-a-pin-is-classified", "score": 0.81 } ] }
```

- **`vector` is `null`** when the host did not embed, so the server embeds
  instead and no model reaches the browser.
- **A match may carry its `row`,** which is then used as it is. Otherwise its
  id is read through the `ChunkSource`.
- **An unknown id is dropped and traced,** never served as an empty passage.
- **A non-2xx answer, or a body with no `matches` array, throws.**

### 12. `graph publish`

```bash
manni graph publish [options]
```

| Option | Meaning |
|---|---|
| `-c, --config <path>`, `--no-config` | As elsewhere. |
| `-o, --out <dir>` | The directory for every artifact. Default: the directory of `graph.out`. |
| `--evals <path>` | Overrides `graph.export.chunks.evals`. |
| `-f, --format <format>` | `pretty` or `json`. Default `pretty`. |

It runs `build`, then `embed` when `graph.embed` is configured. It exports
`jsonld`, `search` and `chunks` always, and `llms` and `iirds` when their
sections exist. Everything goes into one directory.

- **Each step is its own core.** It prints each step's own messages, and a
  step not set up prints `skipped` and never fails the run.
- **The first failing step stops it,** with exit 2 and
  `manni: graph publish stopped at <step>: <that step's own message>`.
- **It does not gate.** `graph check` gates, so CI runs
  `manni graph check && manni graph publish`. A team can still publish a
  known-imperfect build on purpose.
- **`-f json`** prints `{ out, steps: [{ step, status, detail, files }] }`.

`graph build`, `graph embed` and `graph export <target>` stay for one step at
a time.

### 13. Three changes in the build

The build departed from the approved plan in three places, each decided in
review.

- **The model is per language.** `chunks.json` records
  `languages.<tag>.model`, `{ id, dimensions }` or `null`, and has no
  top-level `model`. A query embeds with its language's model.
  *Why:* `graph.embed.byLanguage` can embed each language with a different
  model. One top-level model could not describe those rows, and a German
  query embedded with the English model compares nothing.
- **`withhold` is open to scripts.** `createRetriever`'s `retrieve`,
  `traverse` and `impact` accept `withhold`, and it only tightens the floor.
  `lookup` stays question-only. *Why:* a script runs as the host, as the CLI
  does, and the CLI already takes `--withhold`. Rows withheld at export are
  not in the artifact, so no call can lower the floor. An MCP tool still
  takes no `withhold`, since an agent is not the host.
- **`traverse --context` takes `--where`.** *Why:* the MCP `traverse` tool and
  `createRetriever().traverse()` both filter on metadata. Each tool keeps a
  CLI twin that answers exactly as it does, so the flag joins its twin.

## The ladder

Minimal to maximal. Each rung shows what it prints, then the usage errors.

```text
# 1. Build and write everything serving reads.
$ manni graph publish
manni: no docevals report is configured, so records carry no eval verdicts.
build     graph.ttl: 142 pages, 611 nodes
…
Published 7 files to .manni/graph/.

# 2. The one call.
$ manni graph lookup "How does cite check decide a pin moved?"
Matches
1  cite/index.mdx § How a pin is classified        lexical 12.4, vector 0.81
   pins     3 current, 1 error: source-changed at line 47 (src/cite/core/classify.ts:128-139)
…
2 matches, 1 reached outward, 2 depend on them, in en. Pass -f json for the text, edges and trace.
exit 0

# 3. Steering.
$ manni graph retrieve "How do I resume an upload?" --lang en --depth 2 --max-chars 20000
1  docs/uploads/resume.md § Resume                 seed, lexical
…
exit 0

# 4. With eval verdicts, the CI form.
$ manni graph check && manni graph publish --out docs/public/graph --evals .manni/evals.json

# 5. The scripting form.
$ manni graph lookup "How do I resume an upload?" -f json | jq '.impact.passages[] | {iri, depth, err: .provenance.pins.error}'

# 6. A walk, or what a change here affects, with text.
$ manni graph traverse urn:manni:graph:docs/uploads/resume.md --context --depth 2 -f json
$ manni graph traverse urn:manni:graph:docs/uploads/resume.md --impact --context --where type=how-to

# 7. A trust floor that costs an answer.
$ manni graph retrieve "How many times does an upload retry by default?" --withhold drifted,failing
No passage is served: every match is withheld.
  docs/uploads/retry.md § Retry limits   drifted, failing
exit 0

# 8. Every option at once.
$ manni graph retrieve "Wie rotiere ich den Schlüssel?" -c manni.config.yaml \
    -g .manni/graph/graph.ttl -i .manni/graph --lang de --variant SP-X100 \
    --software-subject configuration --mode hybrid --seeds 5 -d 2 \
    --max-chars 20000 --withhold drifted --where type=how-to -f json
$ manni graph publish -c manni.config.yaml -o docs/public/graph --evals .manni/evals.json -f json

# 9. Serve it to an agent.
$ manni graph serve
manni: serving lookup, retrieve, traverse and impact over stdio from .manni/graph/chunks.json.

# 10. A script, the minimum, then a hosted DB with no model download.
const docs = await createRetriever({ manifest: "/graph/chunks.json" });
const result = await docs.lookup(question);
createRetriever({ manifest, store: createHttpVectorStore({ url: "/api/vectors" }), embed: false })

# 11. The suite in CI.
$ manni graph check
…
  cited    271 of 288 reviewed by graph retrieve (94%), 6 withheld
exit 1, when citedThreshold is 95

# 12. llms.txt alone.
$ manni graph export llms
Wrote .manni/graph/llms.txt (142 pages).
```

Usage and operational errors, each on stderr:

| case | stderr | exit |
|---|---|---|
| several localizations, no `--lang` | `search`'s message today, unchanged | 2 |
| unknown variant or software subject | `traverse`'s message today, unchanged | 2 |
| `--withhold` names an unknown value | `manni: --withhold takes drifted or failing, and got stale.` | 2 |
| no chunk artifact | `manni: .manni/graph/chunks.json does not exist; run manni graph publish.` | 2 |
| `chunks.json` from another graph | `manni: .manni/graph/chunks.json was built from another graph; run manni graph publish.` | 2 |
| no vector sidecar at export | `manni: no vector sidecar, so chunks carry no vectors and retrieval is lexical only; configure graph.embed to add them.` | warning, exit unaffected |
| passages withheld at export | `manni: 6 chunks withheld by graph.retrieve.withhold (drifted); chunks.json lists them.` | notice, exit unaffected |
| `--max-chars`, `--withhold` or `--where` without `--context` on `traverse` | `manni: --max-chars needs --context.` | 2 |
| a `graph publish` step fails | `manni: graph publish stopped at <step>: <that step's own message>` | 2 |
| `chunks.json` embedded with another model than the query's | `manni: chunks.json was embedded with Xenova/bge-small-en-v1.5, and this run loads <id>; run manni graph publish again.` | 2 |
| `--evals` with a target other than `chunks` | `manni: --evals applies only to graph export chunks.` | 2 |
| no evals report is configured | `manni: no docevals report is configured, so records carry no eval verdicts.` | warning, exit unaffected |
| the evals report is missing | `manni: graph.export.chunks.evals names .manni/evals.json, which does not exist.` | 2 |
| the evals report is not one | `manni: .manni/evals.json is not a docevals JSON report; write one with manni docevals run -f json.` | 2 |
| the report records no page integrity | `manni: .manni/evals.json records no page integrity, so every verdict reads stale; write it again with manni docevals run -f json.` | warning, exit unaffected |
| pages changed since the report | `manni: 4 pages changed since .manni/evals.json was written, so their verdicts read stale.` | warning, exit unaffected |
| the report names pages the graph lacks | `manni: 3 pages in .manni/evals.json are not in the graph, so their verdicts are left out.` | warning, exit unaffected |
| git cannot run | `manni: git cannot read this directory (<git's reason>), so records carry no commit and no derived dates.` | notice, said once, exit unaffected |
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
| `createRetriever(options)` | The script surface of section 10. |
| `retrieve({ … })`, `lookup({ … })` | The cores every host calls, over a `RetrieverContext`. |
| `VectorStore`, `ChunkSource`, `createStaticVectorStore`, `createHttpVectorStore`, `createChunkFileSource` | The seams, and the three manni ships. |
| `parseChunksManifest(input)`, `parseChunkRows(text)` | Read `chunks.json` and a `chunks.<tag>.jsonl`, refusing an unknown `format` or `version`. |
| `ChunkRow`, `ChunksManifest`, `ProvenanceRecord`, `LookupResult` | The types of sections 1, 2 and 9. |
| `StaleArtifactError`, `ModelMismatchError` | The two errors that throw. |
| `AssembleOptions.provenance`, `.withhold` | The artifact and the trust floor, for callers that assemble by hand. |
| `ContextBlock.page`, `.provenance` | Additive fields. |
| `RetrievalBundle.question`, `.language`, `.pages` | Additive fields. |
| `QueryTrace.withheld` | Additive. Always present, often empty. |
| `RefusalReason` | Gains `withheld`, `lang-required`, `unknown-node` and `unknown-scope`. |

The browser example DESIGN.md Phase 9 asks for is the prototype on the
"Retrieve from a script" page. It calls `createRetriever().lookup()` and
renders each passage with its role and pin badges. It is site code, labelled
"Prototype", and not exported.

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
   pins would ship too, hashes included. ai-context 1.2.0 marks `answers`,
   and the delivery rule reads marks at every depth, so the question ships
   without them.
10. **A corpus with no citations and no evals.** Every record has
    `pins.total: 0` and `evals: null`. The bundle still works. The record
    says what was not checked, rather than implying it passed.

## Open questions

1. **Tie verdicts to a commit.** The docevals JSON report carries no commit,
   so a record cannot prove its verdicts describe the text it serves. Should
   `docevals run -f json` gain `commit` and `worktree`, and export refuse a
   report from another commit? *Resolved:* each result carries the page's
   `integrity` instead, and `evals.current` compares it (section 1).
2. **Exit 1 on refusal.** It follows grep, where no match is 1, and lets a
   script branch. The family reserves 1 for findings. Is a refusal close
   enough? *Resolved:* no. A refusal is an answer and exits 0 (section 3).
3. **Delivered `sample-questions`.** Should delivery reduce each item to its
   `question` text, or should ai-context mark the pins some other way?
   *Resolved:* ai-context 1.2.0 marks `answers`, and delivery reads marks at
   every depth (section 7).
4. **The trailing slash in `llms.txt` links.** Starlight and most
   frameworks serve `/path/`. Is a fixed trailing slash right, or should a
   route say? *Resolved:* links take the detected framework's URL style, and
   with no framework a route ends in `/`.
5. **The SDK as an optional peer.** It keeps installs small, and costs a
   second install step for anyone who serves. Would a plain dependency be
   the better trade? *Resolved:* an optional peer, with stdio only and no
   auth.

## Acceptance checklist

### PR 1, the record and the artifact

- [ ] `src/graph/commands/chunks.ts` builds the artifact on the Node side from cite's check, meta's derive and a docevals report.
- [ ] `manni graph export chunks` writes `chunks.json` and one `chunks.<tag>.jsonl` per language, and exits 0.
- [ ] The manifest's keys are `format`, `version`, `graph`, `graphFile`, `searchIndex`, `commit`, `worktree`, `retrieve`, `evals`, `languages`, `pages` and `withheld`. Each `languages` entry is `{ file, rows, model }`, and `model` is `null` for a language with no vector sidecar.
- [ ] Two exports over the same commit, report and config are byte-identical.
- [ ] Each section's `lines` and `text` match what `sliceSection` returns, and a document's cover its whole body.
- [ ] A pin whose claim overlaps a passage appears in its `pins.items`, with cite's rule, resolved severity, recorded `commit`, `lastVerified` and `verifiedBy`.
- [ ] `dates.created` and `dates.lastUpdated` equal what `manni meta derive` would stamp, and `stamp` reads `current`, `stale` or `absent`, or `null` when `day` is `null`.
- [ ] `dates.lastVerified` and `dates.verifiedBy` hold the page's verification fields.
- [ ] `docevals run -f json` carries `integrity` on each result, and `evals.current` compares it.
- [ ] `graph.export.chunks.evals` and `--evals` fill `evals`. Without either, every `evals` is `null`, with one warning.
- [ ] Each row carries `metadata`, overlaid by its heading statements, and its record carries `statements`.
- [ ] `graph.retrieve.withhold` leaves matching passages out of the rows and lists them under `withheld`.
- [ ] Rows carry vectors when a sidecar holds them, and the export warns when none does.
- [ ] Page `metadata` holds exactly the delivered fields, tested against each built-in vocabulary, and a delivered `sample-questions` item carries no `answers`.
- [ ] `manni:ai-context:1.2.0` is registered as annotation-only, the default set uses it, and `npm run schemas:check` passes.
- [ ] Outside git, `commit` and `worktree` are `null`, `pins` is computed, every `day` is `null`, and one notice prints.
- [ ] Every PR 1 message prints with its exit code.
- [ ] `test/graph/fixtures/provenance/` holds the minimal corpus the tests commit, drift and edit.
- [ ] `test/graph/integration/runtime-bundle.test.ts` still passes over the built bundle.

### PR 2, lookup, retrieve and the script surface

- [ ] `manni graph lookup "<question>"` takes only plumbing options, prints the three sections, picks the best language and exits 0.
- [ ] `graph lookup -f json` prints section 9's result. Budget-trimmed passages keep their node and record, with `text: null` and `truncated: true`.
- [ ] `createRetriever()` returns `lookup`, `retrieve`, `traverse`, `impact` and `manifest`, and matches the CLI over the same artifact.
- [ ] `retrieve`, `traverse` and `impact` in a script accept `withhold`, which only tightens the floor.
- [ ] `chunks.json` names each language's model, and a query embeds with its language's.
- [ ] The stores, the chunk source and the parsers are exported, and the bundle-purity test passes.
- [ ] `manni graph retrieve "<question>"` prints the pretty output above, and exits 0 with context.
- [ ] `-f json` prints the bundle of section 3, with `question`, `language`, `context[].page`, `context[].provenance`, `pages` and `trace.withheld`.
- [ ] A refusal exits 0, and its JSON carries `refusal.reason` and the extra key for that reason.
- [ ] `--withhold drifted,failing` withholds by the record, and traces each withheld node.
- [ ] Every usage error in the ladder's table prints its message and exits 2.
- [ ] `graph.retrieve.seeds`, `depth`, `maxChars` and `withhold` validate in `config-schema.json`, with a positive and a negative case each.
- [ ] Each flag overrides its key, and the flag-free run reads the key.
- [ ] `manni graph traverse <node> --context` prints the bundle. Without `--context` its output is byte-identical to today's.
- [ ] `--max-chars`, `--withhold` or `--where` without `--context` exits 2.
- [ ] `docs/src/content/docs/graph/reference/cli.mdx` documents `retrieve`, the new `traverse` flags and the new export targets, and `npm run docs:check-cli` passes.
- [ ] `docs/src/content/docs/graph/reference/configuration.mdx` documents every new key.
- [ ] `docs/src/content/docs/graph/reference/library-api.mdx` lists every runtime addition above.

### PR 3, serve

- [ ] `manni graph serve` answers `tools/list` with exactly `lookup`, `retrieve`, `traverse` and `impact`, in that order, with the schemas above. `lookup` takes only `question`.
- [ ] Each tool returns the bundle as `structuredContent` and as one text block.
- [ ] A refusal returns `isError: false`. A usage error over MCP returns the matching refusal reason, with the CLI's text in `detail`.
- [ ] No tool accepts `withhold`.
- [ ] A stale artifact stops the start with exit 2.
- [ ] Without `@modelcontextprotocol/sdk`, `serve` exits 2 with the message above.
- [ ] `package.json` lists `@modelcontextprotocol/sdk` as an optional peer, and the lockfile diff adds only it and its own tree.
- [ ] A test drives the server over stdio with the SDK's client, hermetically.
- [ ] `test/graph/real/` drives the real SDK, and `npm run test:graph:real` runs it.
- [ ] A new page, `docs/src/content/docs/graph/serve/index.mdx`, shows a client registration and one tool call, with `title` and `description`.

### PR 4, the suite, publish and llms.txt

- [ ] `graph check` asks every question of `retrieve`, and prints the `cited` row and the `gaps` refusal count above.
- [ ] The JSON report's `questions` object carries `cited` and `withheld`.
- [ ] The not-cited, withheld, language-leak and threshold findings print the messages above, at the severities above.
- [ ] A question missed by search reports 0087's finding alone.
- [ ] `graph.check.questions.citedThreshold` gates the run at exit 1, and `null` sets no gate.
- [ ] `manni graph export llms` writes `llms.txt` with one entry per routed page, whose description equals its frontmatter `description`.
- [ ] A multi-language corpus gets one section per tag, and a page under no route warns once.
- [ ] A missing `title` or `origin` exits 2 with the messages above.
- [ ] `manni graph publish` builds, embeds when configured, and exports `jsonld`, `search`, `chunks`, plus `llms` and `iirds` when configured, all into `--out`. A failing step exits 2 with `graph publish stopped at <step>: …`.
- [ ] `docs.yml` runs `graph publish --out docs/public/graph` after `graph check`.
- [ ] `docs/content-strategy/cujs.md` gains D19, "Serve the docs to an agent with their proof".

### PR 5, the docs and the prototype

- [ ] `docs/src/content/docs/graph/retrieve-from-a-script/index.mdx` documents section 10, the worked example's worker, ingestion, section 11's protocol and the model download.
- [ ] The worker is `test/graph/fixtures/ask-worker/worker.ts`, which `tsc` type-checks, and a test holds the page's block to it.
- [ ] The page's search box, `docs/src/components/RetrievePrototype.astro`, is labelled "Prototype" and is not a package export.
- [ ] `docs/src/content/docs/graph/publish/index.mdx` leads with `graph publish` and states section 7's delivery rule, which issue #36 can link to.
- [ ] `docs/content-strategy/cujs.md` gains M29, "Ground a site's Ask AI in the docs' proof", and `information-architecture.md` places the page.
- [ ] `node dist/cli.js meta validate`, `cite check`, `term check`, the docs build, `docs:check-links` and the site's a11y check pass, and Vale reports nothing on the changed prose.
- [ ] The demo script is `media/graph-serve-1x1.script.md`. The MP4 is handed over, not committed.
- [ ] This proposal's `Status:` line reads `Implemented` with the five PRs.
