---
status: "accepted"
date: 2026-08-03
decision-makers: [hawkeyexl]
---

# A CUJ-first documentation site, driven by a co-located content strategy

## Context and Problem Statement

moose-docevals ships eight commands, nine grader kinds, three judge providers, a confidence-zone judging
model, and a `fill → promote → generate` ratchet. It has exactly one user-facing surface: the README.
CLAUDE.md said so outright:

> moose-docevals has no docs site, so the README is the only user-facing surface and there is
> nothing to gate.

A README is a features tour; it cannot sequence a reader from "docs quality is slipping" to "the
pipeline tells us."

Two questions had to be answered together. The first is **what structure should the docs have**. The
second is **what governs that structure**, so it survives contact with many small future changes.

## Decision Drivers

- Structure must be derivable and defensible, not a matter of taste per pull request.
- Agents write most of the pages here; the governing artifact must be machine-readable and pointed
  at from `CLAUDE.md`, not tribal.
- The sibling repo `docmeta` already solved this and shares most of its adopter base. Divergence
  costs comprehension for anyone working across both.
- moose-docevals has **no users**, so no call evidence exists to segment audiences from. Whatever is
  written must be honest about that rather than presenting inference as research.
- The docs backlog needs to be an enumerated, prioritized artifact. The gaps are the deliverable.

## Considered Options

1. **CUJ-first IA governed by a co-located content strategy** (audiences → personas → journeys → IA),
   with skill-canonical directory structure and machine-checkable ID anchors.
2. **Diátaxis.** Tutorial, how-to, reference and explanation as the top-level split.
3. **Command-per-section.** A section for `run`, `fill`, `promote`, `calibrate`, and so on.
4. **Port docmeta's flat prose files verbatim.** Four markdown files, no frontmatter, no IDs.

## Decision Outcome

**Option 1 wins**, with docmeta's *location and spirit* and the skill's *structure*.

- Strategy lives at `docs/content-strategy/`, inside `docs/` but outside `docs/src/content/docs/**`,
  so it is version-controlled and never built into the site. Hyphenated to match docmeta and this
  repo's kebab-case conventions, with the skill's subdirectory layout (`audiences/`, `personas/`,
  `journeys/`, `information-architecture/`) inside it.
- Six audiences on a **who owns the docs × company maturity** axis, plus one cross-cutting
  *brownfield* lens. One minimal persona each, on a **qualified-reader** model rather than
  beginner/intermediate/advanced labels. Twelve CUJs, and a seven-section CUJ-first IA covering
  34 pages.
- Three persona names (Devin, Sara, Theo) are **deliberately shared with docmeta**. One reader, one
  pipeline, two tools.
- The evidence basis is **adjacent synthesis, and says so**. It draws on docmeta's validated
  strategy, Doc Detective's user base, the *Docs as Tests with AI* manuscript, and moose-docevals'
  own surface. Every audience file carries an `evidence_basis:` field. The README labels the whole
  set a falsifiable hypothesis to re-derive from call evidence once there are users.
- Astro + Starlight, matching docmeta's stack and version range.

### Consequences

- Good, because every future page has a persona, a journey, and a slot in the content set before it
  is written. Structure stops being re-litigated per pull request.
- Good, because the gap analysis is a prioritized backlog (18 P0 / 11 P1 / 5 P2) and a **surface
  coverage check**. Every command, config key, and grader kind maps to a page, so a new capability
  with no page becomes visible immediately.
- Good, because `steps[].doc` holds repo-relative source paths, so `exists:` is checkable with a
  file test rather than by reading.
- Bad, because the strategy is inference, and some of it will be wrong. Labelling it rather than
  hiding it mitigates that, but a reader who skips the caveat may over-trust the personas.
- Bad, because six personas and twelve CUJs is more surface to maintain than docmeta's four and
  ten. An unmaintained strategy is worse than none.
- Neutral, because 34 pages is a large backlog. It is a backlog, not a commitment; P0 is 18.

### Confirmation

- `CLAUDE.md` § "Content & documentation work (required)" makes consulting the strategy a
  precondition for docs work, and the pointer block is compressed (point, don't inline).
- Anchor integrity is greppable. Every `aud-*`/`persona-*`/`cuj-*` reference must resolve to a
  defined `id:`, every persona needs ≥1 CUJ, and every CUJ needs ≥1 persona.
- The route invariant is testable. No `exists: true` while the site is greenfield. Every `partial`
  route resolves to a real file and every `false` route does not. The union of both equals the
  `[NEW]` backlog in `ia-gap-analysis.md`.
- `cd docs && npm run build` must exit 0, enforced by the `verify-docs` job (ADR 01004).

## Pros and Cons of the Options

### Option 1, CUJ-first with a co-located strategy

- Good, because structure follows what readers must accomplish, so gaps surface as missing journey
  steps rather than as missing topics.
- Good, because IDs and frontmatter make the artifact checkable, which is what keeps it true.
- Bad, because it is more artifact than docmeta's four prose files, and it can rot.

### Option 2, Diátaxis

- Good, because it is well-known and needs no local explanation.
- Bad, because it splits a single journey across four sections. Standing up a first gate becomes a
  tutorial *and* a how-to *and* an explanation *and* three reference pages. Every persona here has a
  job, not a document-type preference.
- Bad, because it gives no signal about what is missing. Every quadrant can look full while a
  journey is unwalkable.

### Option 3, Command-per-section

- Good, because it maps mechanically to `src/cli.ts` and is impossible to get wrong.
- Bad, because nobody's job is "use the `promote` command." It optimizes for the author's model of
  the tool over the reader's model of their problem. It also buries `fill` behind a command name
  they have no reason to look up. `fill` is the feature that decides whether the solo owner adopts
  at all.

### Option 4, Port docmeta's flat files verbatim

- Good, because it is the smallest change and maximally consistent with the sibling repo.
- Good, because prose files are faster to read end-to-end.
- Bad, because nothing is machine-checkable. No IDs, so dangling references are invisible. No route
  assertions, so the backlog and the journeys drift apart silently.
- Bad, because moose-docevals has more personas and more journeys than docmeta. Four flat files
  would each become long enough that nobody reads to the bottom.
