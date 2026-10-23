# 0107: A page read brings the records it names

- **Status:** Proposed; superseded in part by [0112](0112-borrowed-strategy-records.md)
- **Serves:** Maya · M24, "Let an agent keep the docs green while it writes
  them". The agent learns whom a page serves before it edits the page.
- **Depends on:** Two earlier proposals.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    is the strategy domain, its records and its id rule.
  - [0103](0103-the-plugin-serves-the-graph-and-keeps-page-metadata-current.md)
    is the plugin's Read hook and `meta get --all-fields`.
- **Supersedes in part:** [0103](0103-the-plugin-serves-the-graph-and-keeps-page-metadata-current.md).
  [What this supersedes](#what-this-supersedes) names the passage.
- **Touches:** `src/shared/reference-fields.ts`, `src/meta/commands/get.ts`,
  `src/meta/commands/fill-hints.ts`, `src/meta/reporters/get.ts`,
  `src/strategy/`, `src/family/commands/status.ts`,
  `plugin/manni/hooks/page-metadata.mjs`, and the plugin, meta and strategy
  pages.

## Problem

An agent that reads a page here gets the page and, since 0103, every field it
stores. Among them are `audiences:`, `personas:` and `journeys:`. They are ids.
Nothing in the agent's context says that `devin` is a CI engineer, or what
`d18` asks for. That lives in `docs/content-strategy/`, in 82 record files the
agent never opens unless told to. So it writes for a generic reader.

On the biggest pages it does not even get the ids. Claude Code caps each
`additionalContext` string at 10,000 characters. Past that, it saves the
string to a file and gives the model a path and a 2,000-character preview. On
`main` at 544bb2af, 73 replies pass the cap on the page's metadata alone.
`citations` and `provenance` cause it. No other field passes 712 characters.

## Worked example

Maya owns this repository, and the plugin is on. She asks the agent to add a
scheduled-job example to the stale-windows page.

At session start the briefing has one more line, because strategy is in play.

```text
Pages name their readers and jobs in audiences:, personas: and journeys:. Write each page for the ones it names; manni strategy list prints every record.
```

The agent reads `cite/ci/stale-windows.mdx`. Beside the file, the Read hook
hands it the page's fields, key fields first, and then six references.

```text
Metadata for docs/src/content/docs/cite/ci/stale-windows.mdx, from the page and its sidecars:
{"title":"Measure how long pins stood stale",…,"personas":["devin","maya"],"journeys":["d18","m5"],…}
The page names these records. Read a record's file for its details, or run manni strategy get <id>, which also lists the pages that name it:
audience ci-engineers docs/content-strategy/audiences/ci-engineers.md
audience docs-engineers docs/content-strategy/audiences/docs-engineers.md
persona devin docs/content-strategy/personas/devin.md
persona maya docs/content-strategy/personas/maya.md
journey d18 docs/content-strategy/journeys/d18.md
journey m5 docs/content-strategy/journeys/m5.md
```

It reads Devin's file, as the lead says, and writes the example for his
dashboard job. Later it reads the cite CLI reference. That reply used to pass
the cap. Now it holds every key field and 14 references, and ends on one line.

```text
This leaves out citations and provenance to stay under Claude Code's limit of 10,000 characters. manni meta get citations,provenance --no-derived docs/src/content/docs/cite/reference/cli.mdx prints them.
```

Maya checks what the agent was given with the same primitive.

```text
$ manni meta get personas docs/src/content/docs/cite/ci/stale-windows.mdx
docs/src/content/docs/cite/ci/stale-windows.mdx: personas=["devin","maya"] (asserted)
docs/src/content/docs/cite/ci/stale-windows.mdx: record persona devin docs/content-strategy/personas/devin.md
docs/src/content/docs/cite/ci/stale-windows.mdx: record persona maya docs/content-strategy/personas/maya.md
```

## Decision

### 0. Only where a record is named

A page is in scope when one of its `audiences`, `personas`, `journeys` or
`audience` values names a record that exists. Nothing switches it on. Every
other page, and every repository with no records, gets the output it gets
today, byte for byte.

### 1. `meta get` names the records

No option is added. When a requested record field names a record, the entry
gains `records: [{ type, id, file }]`. Pretty output prints one
`<file>: record <type> <id> <record file>` line per record.

- A record is a member of a declared collection whose own `type:` is
  `audience`, `persona` or `journey`. Its id is `id:`, else its file stem.
- A value names a record of its field's type when the ids match, ignoring
  case. `audiences` and `audience` name audiences.
- References follow the page's field order, each record once. A value that
  names nothing is left out, since `strategy check` reports it.
- The collections are walked once per run, and only when a file holds a value
  in a requested record field.

`RECORD_FIELDS`, the record types and `readRecord` move to
`src/shared/reference-fields.ts`, beside `CONCEPT_FIELDS` and `PAGE_FIELDS`.
Strategy reads them from there, so the two domains hold one rule.

### 2. The Read hook keeps a record-naming reply under the limit

For an entry that carries `records`, the hook builds a new reply.

- The page JSON lists key fields first. They are `manni:core`'s and
  `manni:lifecycle`'s properties, plus the four record fields.
- The references follow, under one lead that says how to fetch a record.
- While the reply passes 10,000 characters, the largest non-key field leaves
  the JSON. A tie goes to the later field. Values are never cut.
- When a field was left out, a closing line names it and the command that
  prints it.

The hook pins `KEY_FIELDS` as a constant, and a test holds it to the
vocabularies. The plugin ships as plain files, so it cannot import manni. The
marker hashes the reply after its lead, so a record edit re-sends nothing.

An entry with no `records` takes 0103's path unchanged. An older manni prints
no `records`, so it gets 0103's reply with the same one spawn.

### 3. The briefing gains one line

With strategy in play, `manni status` adds the line from the worked example
before the fix sentence. It is the one thing that reaches a `Write` of a new
page, which has no Read.

## Known limits

- A record whose `type:` lives only in a sidecar is not found. The walk reads
  each member's own frontmatter.
- A page that names no record still passes the cap when its fields do. Two
  pages here do that, `graph/reference/cli.mdx` and
  `docevals/reference/cli.mdx`.
- The limit is Claude Code's number, copied. `.length` counts UTF-16 units, so
  it errs short.
- The walk reads every collection member on each `get` that asks for a record
  field holding a value.

## Rejected

- **A `--records` flag on `get`.** A file that names no record already prints
  today's output, so the flag only saved the walk on calls that name records.
- **Record content inline.** It cost 1,009 characters a page against 404 for
  references, and went stale on every record edit.
- **A pointer to `manni strategy list` alone.** The agent cannot tell which
  ids resolve, and it gets no file to read.
- **A new `x-manni-key` annotation.** It needs a new version of each
  vocabulary and its strict overlay, for a fact one pinned constant states.
- **Packing every reply.** It changes the reply for pages that name no record,
  in every repository without records.
- **Filling fields in page order.** It kept a large `provenance` and then
  dropped small fields after it, on three pages.

## Open questions

- Should the two over-cap pages that name no record come under the packing?
  That needs `get` to say whether any record exists.

## What this supersedes

- In 0103's known limits, "Context over Claude Code's limit of 10,000
  characters goes to a file." For a page that names a record, the reply now
  stays under the limit. It still holds for every other page.

## Verification

- `manni meta get personas,journeys` on the stale-windows page prints two
  field lines and four `record` lines, and exits `0`. `meta get title` prints
  what it printed before.
- The Read hook replayed on the stale-windows page gives the page block and
  six references, whole. On the cite and meta CLI references, each reply is at
  most 10,000 characters and ends on the closing line.
- Replayed over every collection member, no reply that names a record passes
  10,000 characters. Every reply that names none equals `main`'s hook output.
