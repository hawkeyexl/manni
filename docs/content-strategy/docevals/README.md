# Content strategy

This directory holds the durable content strategy for the manni docevals documentation site. It covers who
the docs are for, what those people are trying to accomplish, and what the site's structure must
therefore be.
It is the reference every writing task consults before drafting a page.

These files live inside `docs/` but outside `docs/src/content/docs/docevals/**`, so they are never built into
the published site. They are internal working documents for agents and contributors.

## Layout

| Path | Contents |
|---|---|
| `audiences/` | Six target segments (`aud-*`), plus `_overview.md` stating the segmentation axis. |
| `personas/` | One minimal persona per audience (`persona-*`), plus a persona → audience table. |
| `journeys/` | Twelve critical user journeys (`cuj-*`), plus the persona → CUJ coverage matrix. |
| `information-architecture/` | The CUJ-driven site structure and the gap analysis behind it. |

## The ID-linking model

```
audience ──< persona ──< journey ──> doc touchpoint
 aud-*        persona-*    cuj-*        docs/src/content/docs/docevals/**
```

Every artifact declares an `id:` and references others by ID. The invariants:

- Every `aud-*`, `persona-*`, and `cuj-*` reference resolves to a defined `id:`, with no danglers.
- Every persona has at least one CUJ; every CUJ has at least one persona.
- IDs are **stable once published**. They are referenced across files and from `CLAUDE.md`.

A CUJ step's `doc:` field holds a **repo-relative source path**, not a published URL, precisely so
`exists:` is mechanically checkable with a file test:

| `exists` | Meaning |
|---|---|
| `true` | The route resolves to a real page that serves this step. **All 82 steps are currently `true`.** |
| `partial` | A file exists at that path but does not yet serve the step. Carries a `[GAP]` note. |
| `false` | The page does not exist and the journey needs it. Carries a `[GAP]` note. |

The published route is the path minus its `docs/src/content/docs/docevals/` prefix.

The content set is written, so the check has inverted: it is no longer "is the backlog complete?" but
**"has a journey drifted ahead of the docs?"** A step whose `doc` stops resolving, or a new step added
without a page behind it, is the signal. `information-architecture/ia-gap-analysis.md` records what
is still outstanding.

## Evidence basis, and its limits

**This strategy is a reasoned hypothesis, not validated research.** manni docevals is unpublished and has no
users, so there were no customer or prospect calls to segment from. The audiences are synthesized
bottom-up from four named sources, and each audience file records which ones it leans on in its
`evidence_basis:` field:

| Source | What it supports |
|---|---|
| The [manni meta](https://github.com/hawkeyexl/manni meta) content strategy | Its four audiences were derived for a near-identical adopter base, a docs-as-code team wiring a metadata gate into CI. Three personas are deliberately shared. |
| Doc Detective's user base | `test/docevals/fixtures/pages/` *is* its documentation, which makes it a concrete worked example of the corpus manni docevals is aimed at. |
| The *Docs as Tests with AI* manuscript (draft 4) | The grader hierarchy, ensemble size, confidence zones, the 70% calibration threshold, and the 15% false-positive alert. |
| manni docevals' own surface | `src/cli.ts`, `src/core/config-schema.json`, and `src/graders/registry.ts` bound what any persona can actually do. |

Treat the audiences and pains as **falsifiable claims**. When there are real users, re-derive this
directory from call evidence and expect it to change. Segments will merge, pains will be wrong, and
at least one journey is one nobody actually takes.

## How to use this during writing tasks

Before drafting or editing any page under `docs/src/content/docs/docevals/**`:

1. **Identify the persona.** Priya (corpus owner), Nate (solo owner), Devin (pipeline owner), Sara
   (standard owner), Theo (contributor), or Iris (retrofitter). A page may serve more than one, but
   there is usually a primary. See `personas/_overview.md`.
2. **Find the matching CUJ** in `journeys/`. Structure the page around reaching that outcome, not by
   document type. Do not impose a Diátaxis tutorial/how-to/explanation/reference split as the
   organizing principle; let the journey sequence the content.
3. **Link into the Reference shelf** for exhaustive detail. Flag tables, full config-key lists, and
   grader option tables belong in `reference/`. Journey pages explain the path and link into
   reference; they do not duplicate it.
4. **Check the IA map.** `information-architecture/proposed-ia.md` lists every planned page, the CUJ
   it serves, and its P0/P1/P2 priority. Adding a page means recording it there.
5. **Frontmatter.** Every page needs `title` and `description`. Pages that present commands also need
   an `evals:` block and inline Doc Detective steps. See below.

## Verifying technical claims

manni docevals docs document a real CLI. Every flag, exit code, output string, and config key must match
the code, never the writer's assumption.

- **Source files are the contract for behavior.** `src/cli.ts` for commands and flags,
  `src/core/config-schema.json` for config keys, `src/core/resolve.ts` for how frontmatter merges with
  config, `src/graders/registry.ts` for the grader set.
- **The test suite is the contract for exact emitted strings.** Type definitions describe the *shape*
  of output and over-promise; the assertions in `test/unit/` and `test/integration/` encode what the
  tool actually prints. Verify literal output there before documenting it.
- **Capture real sample output** rather than hand-writing it: `npm run build`, then run
  `node dist/cli.js …` against `test/docevals/fixtures/pages/`.
- **Every page presenting a command carries inline Doc Detective steps** that run it, and an `evals:`
  block whose `tool:doc-detective` eval executes them. `manni docevals run` over this site is a CI gate, so
  a command that drifts from the code fails the build. See
  `information-architecture/proposed-ia.md` for the authoring convention.
