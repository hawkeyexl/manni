---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
consulted: []
informed: []
---

# Warn when an artifact changed after the session ended

## Context and Problem Statement

Evals are read from the artifact **as it is now**; the session followed it **as it was then**.
Nothing in `src/artifacts/` compares the two. Editing a `SKILL.md` after a session silently grades
that session against instructions it never saw. That covers tightening a rule, adding an eval, and
fixing a typo.

The failure is quiet and confident. It is a `fail` on an assertion that did not exist at the time,
or a `pass` on one whose wording changed. There is no signal anywhere in the report that the artifact
moved.

## Decision Drivers

- The report already carries an artifact-coverage table whose job is exactly this, saying what was
  resolved and how much to trust it.
- The evidence needed is one `stat` per resolved artifact, and `src/artifacts/discover.ts` already
  calls `stat` in its own path. The cost is negligible.
- It has to work on **sessions already on disk**. A capture-time hook only helps sessions recorded
  after someone installs it.
- Trust in this tool comes from its verdicts being defensible. A verdict that cannot be defended
  must say so rather than be withheld. Degrading to a warning is this repo's existing shape
  ([ADR 01003](01003-claude-code-traces-first-with-an-adapter-seam.md)).
- mtime is a weak signal. Whatever is built must be honest about that in the wording it prints.

## Considered Options

- Warn from mtime, in the coverage table
- Make staleness an eval outcome (`skipped` or `error`) for the affected artifact
- Do nothing until a capture-time hash manifest exists
- Compare artifact content against text quoted in the trace

## Decision Outcome

The chosen option is to **warn from mtime, in the coverage table.**

`resolveArtifacts` stats every resolved artifact and compares its mtime with `trace.endedAt`. Each
`CoverageEntry` gains `stale?: boolean` and `modifiedAt?: string`. The human and markdown reporters
mark the row (`⚠ modified after the session ended (<iso>)`) while keeping the path, because a flagged
row is exactly the one a reader wants to open. One consolidated warning names the count and the
refs, rather than one line per artifact. A fresh checkout flags everything, and a wall of identical
lines is how a real signal gets tuned out.

Three boundaries, all deliberate:

- **Never an eval outcome, never an exit code.** The artifact still resolves, still carries its
  content, and its evals are still graded exactly as before. Staleness changes what the report
  *says*, not what gets *run*. Turning a weak heuristic into a failing gate would make CI red on
  every fresh clone.
- **Absent `endedAt` means silence.** A trace with no end timestamp has no ground to compare
  against, and inferring one would manufacture a warning out of no evidence. `stale` is left
  `undefined`, not `false`.
- **An unreadable mtime is silence too.** Consistent with everything else in `artifacts/fs.ts`: a
  path that cannot be stat'd is a thing the report says nothing about, never a crash.

The project-rules row aggregates several files under one entry, so it takes the newest mtime among
the files that actually resolved.

### It is a heuristic, stated plainly

**mtime is not content identity.** It moves for reasons that have nothing to do with the file's
text, and it fails to move for reasons that do:

- A fresh `git clone` or `git checkout` rewrites every mtime to "now", so **a CI job that checks out
  and then evaluates an older trace flags every artifact.** That is the expected behavior of this
  heuristic, not a bug, and it is the main reason this is a warning rather than a gate.
- A file touched and reverted looks changed; a file restored from backup with preserved timestamps
  looks unchanged.
- Nothing here proves the *content* differs. It proves the file was written.

The exact version of this is a capture-time manifest. That is sha256 of each instruction artifact
plus the git SHA, written by a `SessionStart` hook and correlated with the trace. It is a separate
decision with its own adoption cost and its own write path, and it is deliberately not this one.
Until it exists, this heuristic costs nothing, needs no adoption, and works retroactively on every
session already recorded.

### Consequences

- Good, because a whole class of confident-but-wrong verdicts becomes visible, on traces that were
  already on disk.
- Good, because it is free: one `stat` per resolved artifact, on a path that already touches the
  filesystem for every one of them.
- Bad, because a fresh checkout flags everything, so in CI the signal is close to useless until a
  manifest exists. The consolidated single warning limits the noise; it does not remove it.
- Bad, because a reader may read "stale" as "wrong". The printed wording says *may not be* the
  instructions the session followed, and names mtime as a heuristic, for that reason.
- Neutral, because the JSON report gains two optional fields; existing consumers are unaffected.

### Confirmation

- `test/unit/artifacts.test.ts` pins all four cases against a temp directory with a pinned mtime.
  Newer than the session flags and warns, and older does not. A trace with no `endedAt` stays
  silent, and a flagged artifact still resolves with its content intact.
- `test/unit/reporters.test.ts` pins the human and markdown rendering, including that the markdown
  row keeps its column count and its path.
- [ci.yml](../.github/workflows/ci.yml) asserts three things on the checked-out fixture corpus,
  where every artifact is newer than the trace by construction. The coverage entries are flagged
  and the warning is present. **The exit code and every eval outcome are unchanged.**

## Pros and Cons of the Options

### Warn from mtime, in the coverage table

- Good, because it works today, on every existing session, at no cost.
- Good, because the coverage table is already where "how much should I trust this row" lives.
- Bad, because checkout mtimes make it noisy in exactly the environment (CI) that most wants it.

### Make it an eval outcome

- Good, because it would be impossible to ignore.
- Bad, because a fresh clone would then skip or fail every eval in CI, which makes the tool unusable
  where it is most used.
- Bad, because it would let a filesystem timestamp override a real, correctly-computed verdict.

### Wait for a hash manifest

- Good, because the manifest is the correct answer and would make this exact.
- Bad, because it only helps sessions recorded after someone installs a hook. It also introduces a
  write path into an otherwise read-only tool. That is a bigger decision, and should not be a
  prerequisite for a warning.

### Compare content against the trace

- Good, because it would be evidence from inside the trace rather than from the filesystem.
- Bad, because the transcript does not carry artifact bodies. Skill instructions are injected into
  the model's context, not recorded as text in the session file, so there is nothing to compare.
