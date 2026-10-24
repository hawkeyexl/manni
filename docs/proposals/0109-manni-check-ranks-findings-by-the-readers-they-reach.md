# 0109: `manni check` ranks findings by the readers they reach

- **Status:** Implemented (#243)
- **Serves:**
  - Maya · M33, "Fix a red run in the order its readers feel it". A run
    that fails several checks says which journeys it breaks, worst first.
  - Devin · D16, "Gate every check a repo has set up, with one command". The
    pull request opens with the same ranking.
- **Relates to:** Three earlier proposals.
  - [0078](0078-family-check-status-and-claude-code-plugin.md) is
    `manni check`, its formats and its hook replies.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    is the strategy domain, its records, its per-field gate and its live
    rule for a journey's `lifecycle`.
  - [0105](0105-a-citation-finding-names-the-readers-of-its-page.md) rolls
    cite's own findings up by persona and journey. This proposal calls the
    same module over every check's findings.
- **Supersedes:** [0078](0078-family-check-status-and-claude-code-plugin.md)
  in part. Its `-f github` is each domain's own output, concatenated. That
  output now opens with one notice.
- **Touches:** `src/family/commands/check.ts`, `src/family/cli.ts`,
  `src/strategy/core/serving.ts`, `src/strategy/index.ts`, the family check
  and CLI reference pages, the strategy overview, journeys M33 and D16.

## Problem

`manni check` runs every check a repository has set up. Its report is each
domain's own report in domain order, then a count of checks. A big change
turns it into a wall, sorted by domain and then by file.

Every page in this repository says in data which personas and journeys it
serves. Nothing in the family report reads it. cite's report rolls its own
findings up since 0105. A run whose findings come from meta, docevals, term,
strategy and cite together still has no single answer.

This repository shows it. A refactor of `resolveSchemaSetWithSource`, the
schema precedence chain, stales 47 pins on 16 pages. A
stray to-do marker on `meta/set-up/config.mdx` fails docevals and meta.
`manni check` prints the page blocks under three checks, then `3 failed`.

Which journey breaks worst is all data in the repository. Learning it means
`manni strategy get` once per journey, or a script that joins two JSON
reports. Nobody does either. So the journey a reader hits first waits behind a
reference page that sorts first.

On a pull request it is worse. GitHub shows ten annotations of each level per
step. Most of the findings never reach the pull request, and none says whom it
hurts.

## Worked example

Maya owns the docs-as-code repository. Her branch rewrites
`resolveSchemaSetWithSource` and leaves a to-do marker in `meta/set-up/config.mdx`.
She runs `manni check`. Each domain prints its own report, as before. After
the skipped lines and before the summary, one block ranks the readers:

```text
The pages with findings serve 4 personas and 48 journeys.
  maya    Maya, Documentation Engineer                  28 errors, 151 warnings and 58 notices on 101 pages
  sara    Sara, Schema Author / Information Architect   22 errors, 124 warnings and 62 notices on 100 pages
  devin   Devin, Platform / CI Engineer                 20 errors, 172 warnings and 63 notices on 87 pages
  theo    Theo, Doc Contributor                         3 errors, 95 warnings and 31 notices on 61 pages
  m1      Stand up metadata validation for my repo      15 errors, 9 warnings and 3 notices on 6 pages
  s2      Wire schemas to the right documents           14 errors, 2 warnings and 4 notices on 3 pages
  d2      Govern one schema across many repos           12 errors, 3 warnings and 3 notices on 2 pages
  …
```

cite's own block gives M1 13 errors. The family's gives 15. The marker fails
docevals, and the edit leaves the page's `last-updated` stale for meta.

She asks for the pages of the journey at the top:

```console
$ manni check -f json | jq -r '.impact[] | select(.id == "m1") | .pages[]'
docs/src/content/docs/meta/get-started/index.mdx
docs/src/content/docs/meta/reference/configuration.mdx
docs/src/content/docs/meta/reference/schemas/index.mdx
docs/src/content/docs/meta/set-up/config.mdx
docs/src/content/docs/meta/set-up/index.mdx
docs/src/content/docs/meta/set-up/retrofit.mdx
```

She fixes those pages and runs the check again. That journey leaves the list,
and so does every journey that shared only those pages. On the pull request,
`manni check -f github` opens with the same ranking as one notice, before any
domain's annotations.

## Decision

### 1. The family verb rolls up every check

Each domain's case in `manni check` already holds its report. It now also
hands back where each reported finding sits, as an absolute file and a
severity. The family joins those to the pages' personas and journeys through
0105's module. It owns no check, so 0078's rule holds.

### 2. Each finding is placed from its own report

Seven reports label files from different bases. meta, cite, term and strategy
label from their run's base, and lint from its root. docevals labels from the
working directory, and graph from its report's root. Each case resolves its
own labels.
SARIF uris are not used, since their bases differ again.

### 3. A manifest finding counts on its page

A finding in a page's `{page}` manifest counts on that page. The strategy
module maps each named page's manifests through the collections'
`externalMetadata` patterns and 0058's `pageManifestPath`. A finding on a file
that is no page counts nowhere. A baselined finding is not reported, so it
counts nowhere either.

### 4. A finding counts under every record its page names

A page that names six journeys puts its finding under all six. The rows add up
to more than the run's findings. A fraction would hide the hub pages that
matter most.

### 5. Detected, never switched

The roll-up appears when a check reports a finding on a page that names a
persona or journey record. With no records, every format prints what it
printed before. There is no flag and no config key. The records come from
every collection, whatever paths the run names.

### 6. Never under a hook

The agent fixes the file it edited, and triage is a person's job. A hook's
reply carries no family roll-up. cite's own block from 0105 still reaches it,
inside cite's report.

### 7. One notice first in `github`

A family run spans every domain, and the cap on annotations hides most of
them. So the roll-up prints first, as one `::notice`, before every check's own
lines. 0105 rejected a notice for cite alone, where a pull request carries a
handful of annotations.

### 8. It never moves a verdict

No finding, rule, severity or exit code changes. When the strategy set cannot
be read, the report prints without the roll-up. stderr says so once, though
cite's report meets the same error.

## Interface

No key, flag or rule is added. These are the output changes.

- **`pretty`.** One block, after the lines for checks that did not run and
  before the summary line. Its heading is 0105's, bold on a TTY. Each row is
  0105's row, in 0105's order.
- **`json`.** A top-level `impact` list after `checks`, omitted when empty.
  Each entry is 0105's entry. Its `pages` are relative to the working
  directory and sorted.
- **`github`.** One `::notice` first. Its title is the heading. Each line of
  its message is `<id> <title>: <counts>`.
- **`sarif`.** The last run, `manni-check`, gains `properties.impact`, the
  array `json` prints.

```text
manni: personas and journeys left out of the report. manni.config.yaml: strategy does not carry "paths". Name a collection under collections:.
```

## Known limits

- A red run reads every collection's strategy set once more. A bare run reads
  it twice, once for `strategy check` and once for the roll-up. Handing the
  first set to the second is the upgrade path.
- Only a page that names a record is ranked. A red page that names nothing is
  in no row, though its check's report still lists it.
- When cite is the only red check, cite's block and the family's agree, about
  a dozen lines twice.
- A clean tree with warnings and notices still prints a roll-up of them. It
  ranks what the run reported, at every severity.

## Rejected

| Option | Why not |
|---|---|
| 0105's pattern in every domain, and nothing in the family | No cross-domain total, which is the triage. Strategy imports meta, so meta calling strategy is a cycle. |
| `manni strategy impact <report>` over a domain's JSON | A verb whose input is a report breaks strategy's input parity. It is a second CI step for a join `check` can do. |
| `--by journey`, or a config key | The tool can detect records. A switch for a detectable fact is one more way to be wrong. |
| The `Serves` sentence on every annotation, from the family | cite's lines would say it twice. It is text surgery on other domains' workflow commands. |
| `properties.journeys` on each SARIF result | A second key for one fact. `impact[].pages` inverts to it. |
| Placing findings from each domain's SARIF | The uris have different bases. Below the repository root, docevals' findings would land on no page. |
| A share of each finding per journey | A finding hurts every reader the page serves. |
| A roll-up in hook replies | The agent fixes the file it edited. |
| Only bare runs | `manni check docs/` is a triage run too. |

## Verification

The strategy unit tests cover the manifest map and the notice lines. The
family unit tests cover the `impact` fixture, the order, the counting rule,
the four formats and the broken section. Each of seven domains is placed on a
page one directory below the repository root. The built-bin tests cover the
four formats, the fallback, the notice said once and the unknown flag. Run on
this repository, the refactor above ranks M1 first among the journeys.
