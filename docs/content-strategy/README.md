# Content strategy

This directory holds the durable content strategy for the manni meta documentation site. It is the reference every writing task should consult before drafting a page.

These files live inside `docs/` but outside `docs/src/content/docs/**`, so they are not published as end-user pages. They are internal working documents for agents and contributors.

## Layout

| Path | Contents |
|---|---|
| `audiences/` | One record per target audience, the four audiences and why each matters. |
| `personas/` | One record per persona, the full profiles for Maya, Devin, Sara, and Theo. |
| `journeys/` | One record per Critical User Journey, the end-to-end outcomes the docs must support. Each sits under one persona. |
| `information-architecture.md` | The journey-based IA and nav tree, plus the full content-set map (the pages, with ★ launch markers). |
| `design.md` | The visual rules the docs site and the demo videos both follow: palette, type, capture geometry, composition, and the measurements behind them. |
| `OWNERS` | Who owns each published docs page, in CODEOWNERS format. `manni meta derive` reads it for the `owner` field. |

## The records

Each audience, persona and journey is a page of its own. A record is front matter followed by the prose that describes it.

```yaml
---
type: journey
id: m5
title: Pin a claim and catch it going stale
description: A sentence on one of Maya's pages rests on a few lines of code.
persona: maya
---
```

| Field | On | What it holds |
|---|---|---|
| `type` | every record | `audience`, `persona` or `journey`. |
| `id` | every record | A stable id, unique across all records. The file name is the id. |
| `title` | every record | What the record is called. |
| `description` | every record | One sentence saying what the record is for. |
| `audience` | a persona | The id of the audience the persona belongs to. |
| `persona` | a journey | The id of the persona the journey belongs to. |

Pages name the records they serve in their own `audiences:`, `personas:` and `journeys:` fields. A page can hold them in its front matter or in its `{page}.meta.yaml` sidecar.

Three commands read the records.

- `manni strategy list` lists them as a tree, audience then persona then journey, with the number of pages that name each.
- `manni strategy get <id>` shows one record and the pages that name it.
- `manni strategy check` checks every page's `audiences:`, `personas:` and `journeys:` against the records.

The ids are stable. A new journey takes the next free id in its persona's series.

### Audiences

manni meta serves four distinct audiences. The **lead audience** drives the primary IA track and gets the deepest coverage. Secondary audiences have dedicated tracks, but are scoped to what they actually need from the tool.

### Personas

Four concrete personas, one per audience. Each writing task should be anchored to the persona(s) it serves. The journeys in `journeys/` are the end-to-end outcomes each persona must complete.

### Journeys

A CUJ is a complete, end-to-end outcome a persona must be able to reach using manni meta and its documentation. The CUJs are the organizing principle for the IA. Each top-level nav section maps to one persona's set of journeys, and every page is justified by the CUJ it serves.

`manni strategy get <id>` lists the pages that carry a journey.

## How to use this during writing tasks

Before drafting or editing any user-facing documentation:

1. **Identify the relevant persona.** Is this page for Maya (docs engineer), Devin (CI engineer), Sara (schema author), or Theo (contributor hitting a red check)? A page may serve more than one, but there is usually a primary. Each has a record in `personas/`.

2. **Find the matching journey.** `manni strategy list` prints every journey under its persona, and `manni strategy get <id>` shows one in full. Each persona has a series of journeys across the tools. Understand the end-to-end outcome the persona needs to reach.

3. **Structure content around that journey, not by document type.** Do not impose a Diátaxis-style tutorial/how-to/explanation/reference split as the organizing principle. Ask: "What does this persona need to know, and in what order, to reach the outcome?" Let the journey sequence the content.

4. **Link into the Reference shelf for lookups.** Detailed flag tables, full config-key lists, and the precedence chain belong in `reference/`. Journey pages explain the path and link into reference for exhaustive detail. They do not duplicate it.

5. **Check the IA map.** `information-architecture.md` lists every planned page and whether it is a ★ launch priority. If you are adding a new page, record it there, and name the journeys it serves in the page's `journeys:` field.

6. **Frontmatter.** Every page in `docs/src/content/docs/**` must have `title` and `description` in its frontmatter. No exceptions.

7. **Anything visual goes through `design.md`.** A page that adds a screenshot, a diagram, a code-block style, or a demo video is both a design change and a content one. The palette is not decorative. manni meta's own output already assigns meaning to red, green, yellow and cyan. Chrome that reuses one of them makes a reader see a relationship that is not there.

## Verifying technical claims

manni meta docs document a real CLI. Every flag, exit code, output string, and schema rule must match the code, never the writer's assumption.

- **Source files are the contract for behavior** (`src/cli.ts` for flags, `src/core/` for config and schema resolution, `src/extractors/` for formats).
- **The test suite is the contract for *exact emitted strings*.** Type definitions in `src/types.ts` describe the *shape* of output, but they over-promise. An optional field is declared once on the shape, and populated by only some of the paths that produce it. `col` is on every `FieldError`, but only the `html` and `xml` extractors supply one. Even they omit it for a `required` violation. So "the type has `col`" and "this annotation shows a column" are different claims, and only the second is what a reader will see. The same asymmetry runs the other way in SARIF, where the format defines `region.startColumn` and manni meta never emits it. Before documenting concrete output, verify the literal strings against the assertions in `test/*.test.ts`. That covers pretty lines, JSON values, and `github` annotations, and the files to start from are `test/reporters.test.ts`, `test/commands.test.ts`, and `test/cli.integration.test.ts`, among others. The tests encode what the tool actually prints.
- **To capture real sample output**, build once (`npm run build` at the repo root). Then run the built binary against a fixture, rather than hand-writing output. One example is `node dist/cli.js validate test/fixtures/missing-type.md`. Reuse `test/fixtures/` as worked examples so docs and CI stay in lockstep.

## Per-tool strategy

The records above are the whole family's. A tool that joins the family does not
bring a strategy directory of its own. Its readers are these four personas. Its
journeys take the next free id in their persona's series under `journeys/`. Its
pages get a content set in `information-architecture.md`. A persona is added
only when no existing one does the job. a11y added none, and neither did
docevals, whose six imported personas were three of these four by name, plus
three situations of Maya's.

docevals arrived with an ID-linked strategy directory (audiences, personas,
journeys and IA). What was strategy moved into the records above. Its IA gap
analysis, a delivery record of how the section was built, moved to
`docs/proposals/docevals/ia-gap-analysis.md` beside the tool's ADRs. Like
every persona here, docevals's were reasoned from the tool's own surface and a
sibling's adopters rather than from call evidence. The tool had no users yet. Treat its pains as claims to re-test when it does. `design.md` is
shared: one site, one palette, one set of capture rules.

### The same four, for docevals

docevals segmented its adopters on who owns the docs and how mature the company is, and arrived at six segments. They land on these four. A docs platform team, a solo owner and a brownfield corpus are all docs-as-code teams. The solo owner differs by hours available, and the brownfield corpus is a lens on the state of the pages, not a different owner. The other three segments are the platform engineers, the owners of the quality standard (the schema authors' job, in prose), and the contributors.

Three concerns cut across every segment for docevals, which is why they get sections of their own rather than footnotes. Can a model be trusted to gate a build (`judge/`)? Can the cost surprise anyone (`ci/cost-and-caching.mdx`, counted in calls, never dollars)? And what executes when the gate runs on a stranger's pull request (`ci/untrusted-pull-requests.mdx`)? Framework was deliberately not a segment, because docevals reads frontmatter and never touches the site build.
