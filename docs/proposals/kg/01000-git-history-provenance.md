---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# One-pass git history as an opt-in provenance source

## Context and Problem Statement

PROV-O v1 derived provenance only from frontmatter. Most corpora carry richer,
already-authoritative provenance in git: creation/modification dates, authors,
and renames. How should dockg incorporate git history without breaking its
determinism contract or its performance profile?

## Decision Drivers

- Byte-identical output per corpus commit; the wall clock must never enter the graph.
- One `dockg build` must not spawn a subprocess per file.
- Frontmatter is the author's explicit statement, so it must win over inference.
- Author emails are personal data.

## Considered Options

1. Per-file `git log -- <path>` calls at derive time.
2. One `git log --name-status -M` pass parsed into a corpus-wide map (chosen).
3. Reading `.git` directly with a library (isomorphic-git).

## Decision Outcome

Chosen option 2. `collectGitHistory` (src/core/git.ts) runs a single
`git -c core.quotepath=off log --format=%x01%H%x09%an%x09%cI --name-status -M`.
It folds the stream newest→oldest into per-file `{created, modified, authors,
renamedFrom}`. Renames are followed backward, so history accrues to the current
path. It is gated by `provenance.git`, renamed from the unreleased `gitTime`
whose scope it absorbs. Frontmatter dates always win. Git fills only what is
absent. Author names are emitted through the same agent-node path as
frontmatter authors. Emails are never emitted.

### Consequences

- Good. Deterministic per commit, one subprocess regardless of corpus size,
  and it works for dates, authors, renames, and the build activity's
  `prov:endedAtTime` from a single pass.
- Bad. Whole-history parsing can be slow on very large repos, though it is
  opt-in and a bounded-depth knob is an easy later add. Shallow CI clones also
  yield partial facts silently.

### Confirmation

- Unit tests drive a scripted exec mock in `test/unit/git.test.ts`.
- A real tmp-repo integration test in `test/integration/git-history.test.ts` covers
  the rest.
- `test/integration/build.test.ts` gates byte stability at build level.

## Pros and Cons of the Options

- **Per-file git log.** Simple, but N subprocesses; rejected on performance.
- **One-pass parse.** One subprocess, and rename chains fall out naturally. It
  requires careful stream parsing, mitigated by the injectable exec seam.
- **Library (.git reader).** No subprocess, but a heavy dependency and a
  second implementation of git semantics; rejected for footprint.
