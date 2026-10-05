---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl, Claude]
consulted: []
informed: []
---

# Capture a session manifest, and make staleness exact instead of a guess

## Context and Problem Statement

[ADR 01016](01016-read-the-availability-roster-and-check-the-artifact-that-never-fired.md)
settled what a session was *offered*. The roster is inside the transcript, so it is recoverable
retroactively, on any machine, with no adoption cost. It named the residual it could not reach, and
left it for a hook. The residual was "artifact *bodies* or their hashes at session time, and the git
SHA the session ran against".

That residual is what
[ADR 01021](01021-warn-when-an-artifact-changed-after-the-session.md) is standing in for. It compares
each artifact's **mtime** against `trace.endedAt` and warns. Its own text is blunt about the cost. A
fresh `git clone` or `git checkout` rewrites every mtime to now. **A CI job that checks out and then
evaluates an older trace therefore flags every artifact.** The heuristic is loudest in
exactly the environment that most wants it. A warning that fires on every row of every CI run is
one people learn to skip. Nothing anywhere proves *content* differs; mtime proves only that a file
was written.

The transcript cannot close this. Skill instructions are injected into the model's context and never
recorded as text, so there is no body in the trace to compare against. ADR 01021 already established
that point when it rejected the option. The evidence has to be recorded at the time, by the machine
the session ran on.

## Decision Drivers

- **Exactness is the whole value.** A sha256 recorded when the session started answers "did this
  SKILL.md say the same thing then?" outright. Anything short of that is another heuristic.
- **The trace has to travel with the evidence.** ADR 01016's roster works everywhere because it is
  *inside* the trace. A sidecar has to be somewhere a CI job already carries. `ci/index.mdx`
  documents evaluating in the same job, uploading the trace as an artifact, and committing a corpus.
  And `.moose-tracevals/`, where the judge cache already lives, is inside the project for all three.
- **`run` is read-only, and CLAUDE.md states that as an invariant.** A new write path has to be
  argued, not assumed.
- **A hook only helps sessions recorded after someone installs it.** Every existing session keeps the
  mtime heuristic, so the new path must slot in beside it rather than replace it.
- **A manifest is written by the evaluated machine and travels with the repository.** It is evidence
  about that device, and it must not be able to manufacture a clean answer.
- **The hook payload is another program's output.** Its documented common members are stable; the
  member naming *why* a session started is not. The reference has published it as `source`/`reason`
  and as `how`/`why`. Nothing load-bearing may depend on a spelling that moves.
- `judge.redact` ([ADR 01020](01020-redact-the-judge-digest-before-it-leaves-the-machine.md)) exists
  because a file leaving this machine needs scrubbing. A manifest is a second such file.

## Considered Options

Where the evidence comes from:

- A `SessionStart` hook writing a manifest of sha256 digests plus the git SHA
- Keep mtime and document its limits harder
- Have `run` reconstruct the artifacts from git history at `trace.endedAt`

What the manifest does to the mtime verdict:

- A hash **match** clears the mtime flag; a **mismatch** sets it; neither answer is available →
  mtime stands
- The manifest is reported alongside mtime and changes no flag
- The manifest replaces the mtime heuristic outright once one exists

Where `run` looks for it:

- Beside the trace, then under the trace's directory, then under the project, with first hit winning
- Only the canonical project location
- Only an explicit `--manifest`

What a manifest recorded for a different session does:

- It is refused, and the run proceeds as if there were none
- It is used, since it is the only evidence available
- It is an error

What a manifest the trace cannot verify at all does. The trace records no session id, so there is
nothing to compare it against:

- A discovered one is refused; an explicitly named one is honoured on the caller's assertion
- Both are refused, so the rule stays literally unconditional
- Both are used, as today

How `capture` behaves when wired to a hook:

- Report to stderr, write nothing to stdout
- Report to stdout like every other command

## Decision Outcome

The chosen option has four parts. **A `SessionStart` hook writes a manifest. An exact answer settles
the row in either direction, and an unavailable one leaves mtime exactly as it was. The manifest is
searched for most-specific-first. One that cannot be shown to belong to the trace is refused, with
`--manifest` the caller's own assertion of provenance. Nothing is written to stdout in hook mode.**

### `capture` is a separate command, and `run` never calls it

`moose-tracevals capture` reads the hook envelope on **stdin** and writes
`.moose-tracevals/sessions/<session-id>.json`. This is the same shape as `fill`
([ADR 01005](01005-fill-proposes-criteria-at-authoring-time.md)): an explicitly-invoked authoring
command that the evaluation path never reaches. `run` reads a manifest and writes nothing, so
CLAUDE.md's read-only invariant is intact rather than amended. Evaluation still mutates nothing,
and the one write happens before evaluation exists, on the other machine, by another command.

The payload's **four documented common members** are the only ones anything depends on:

| Member | Used for |
|---|---|
| `session_id` | the manifest's filename, and the key `run` joins on |
| `cwd` | the project root to scan and to relativize paths against |
| `transcript_path` | recorded as a correlation key, and **never read** |
| `hook_event_name` | recorded as provenance |

`transcript_path` is deliberately not opened. At `SessionStart` the file barely exists, and the
reference warns that it lags the conversation in any case. The start/end reason is read as `how`,
`why`, `source`, or `reason`, whichever arrived, and recorded rather than used. That is the same
tolerance `trace/detect.ts` already applies to `sessionId` versus `session_id`. Every member is
type-checked before it is believed, because this object is produced by another program.

### What goes in it, stated plainly

```jsonc
{
  "version": 1,
  "sessionId": "…",              // join key — never redacted
  "capturedAt": "…",
  "hookEvent": "SessionStart",
  "reason": "startup",           // provenance; spelled four ways upstream
  "transcriptPath": "…",         // correlation key; the file is never read
  "root": "/abs/path/to/project",
  "git": { "sha": "…", "branch": "…", "dirty": false },
  "device": { "id": "<16 hex>", "platform": "linux" },
  "tool": { "name": "moose-tracevals", "version": "…" },
  "artifacts": [
    { "name": "fix-bug", "type": "skill",
      "path": ".claude/skills/fix-bug/SKILL.md",   // project-relative, POSIX
      "sha256": "…", "bytes": 812 }
  ],
  "config": { /* the resolved `tracevals:` section, redacted */ }
}
```

The population is **`discoverArtifacts`'**, the same set `fill` authors against, so capture and
authoring can never disagree about what an instruction artifact is. That scope is project-only by
its own design note, and the consequence is worth stating rather than discovering. A **user-level or
plugin artifact is simply absent from the manifest**. Its check at run time reports `skipped` with
that reason, and keeps the mtime guess.

**The device id is a digest, not the hostname.** The question a reader has is "was this captured
here?". Answering it does not require shipping the name of a machine into a file that travels
with the repository.

**`judge.redact` applies to the free text, and deliberately not to the join keys.** `root`,
`transcriptPath`, `git.branch`, `reason` and the whole recorded `config` go through the redactor
built by ADR 01020, built-ins included. `sessionId`, an artifact's `name` and `path`, and every
`sha256` do not. This asymmetry is the point. **A redactor applied to a join key turns an exact
check into a silent `skipped`.** That is the exact failure this feature exists to remove. The keys
themselves are the project's own vocabulary and its repository-relative paths, not a place a
credential lives. A secret in an artifact path is a problem to fix in the path. That is the call
ADR 01020 already makes about a secret in a `SKILL.md`.

The `config` is recorded and **consumed by nothing**. It answers "what settings was this captured
under" for a person reading the file. Every member of the section is authored settings, and
`apiKeyEnv` holds a variable *name* by schema decree, never a key.

### How `run` consumes it, and the one thing it is allowed to change

Each coverage row that resolved to a file gets a three-valued `contentCheck`:

| `contentCheck.status` | Meaning | Effect on `stale` |
|---|---|---|
| `mismatch` | The digest differs from the one recorded. **Exact.** | `true`, whatever mtime says |
| `match` | The digest is identical. **Exact.** | `false`, whatever mtime says |
| `skipped` | No manifest, or none covering this artifact. | mtime decides, as ADR 01021 shipped it |

**A match is the one thing a manifest may quiet, and it is not a weakening.** mtime was only ever
asking "did the content change"; the manifest answers that question exactly, so the guess does not
run. The observation itself is never hidden, since `modifiedAt` is still reported on the row. Only
the conclusion drawn from it changes. This is what removes the CI false positive ADR 01021 accepted.
A checkout still rewrites every mtime, and every artifact the manifest recorded still reads clean.

A `mismatch` is the sharper direction, and catches what mtime cannot. A file edited and then
restored to an older timestamp is flagged, where ADR 01021 would have said nothing.

Three boundaries hold, and they are the same three ADR 01021 drew:

- **Never an eval outcome, never an exit code.** The artifact still resolves, still carries its
  content, and its evals are graded identically. A manifest cannot turn a `skipped` into a `pass`,
  because it is not consulted anywhere a verdict is formed. That is structural, not a rule anyone
  has to remember.
- **It cannot silence a row it has no entry for.** `skipped` is not a shade of `match`; an
  aggregated project-rules row where only *some* files were recorded reports `skipped`, because a
  partial answer is not a clean one.
- **A manifest that cannot be shown to belong to this trace is refused**, and the run proceeds as if
  there were none. Evidence about another session is not evidence about this one, and using it is
  the single way a manifest could produce a confidently wrong answer. The trace's own session id is
  what shows belonging. There are two ways to fail that test, and they are not the same failure:
  - The ids **disagree**, so the manifest is refused outright, however it was reached.
  - The trace records **no id at all**, so there is nothing to compare. A Claude Code session file
    whose records predate `sessionId` parses fine and arrives with nothing to check against. So does
    a `claude -p` stream-json transcript captured without its `system`/`init` record. A
    manifest reached **by convention** is refused there, because convention is not provenance: the
    file beside the trace could describe any session on the machine. The run says which file it
    ignored and why, since an unexplained fall back to the mtime guess is indistinguishable from
    never having captured anything.

**A manifest is also read strictly or not at all.** Version, `sessionId`, `capturedAt`, `root`, and
every artifact entry's `name`/`type`/`path`/`sha256`/`bytes` are type-checked before any of it is
believed; one malformed entry makes the whole file unusable. A half-read manifest is the worst
outcome available here, not a lenient one. An entry with no `path` or a non-string `sha256` compares
unequal to every real digest, so the row would report **`mismatch`**. That is the most alarming thing
this feature can say, and it would come off nothing but the file's own corruption.

The one place a manifest is allowed to be *loud* about its absence is when someone asked for it by
name. A `--manifest <file>` that cannot be used is an error, not a shrug. The caller asked for
exactness and did not get it, and the error says which of the ways it failed. It is refused against
a corpus, since one manifest cannot be evidence about more than one session. A batch still finds one
per trace by convention.

Naming a file is also the **one** assertion of provenance that outranks a missing session id.
`--manifest` against a trace that records none is honoured. The ids cannot disagree, and the caller
has said this file belongs to this trace. That is a deliberate narrowing of "refused,
unconditionally": for such a trace the guarantee is the caller's, not the tool's. The alternative
was to refuse it too. That buys no safety a discovered manifest does not already get, and leaves
`--manifest` structurally unusable for a whole trace format.

The search order is most-specific-first. That is `<trace>.manifest.json`, then
`<trace dir>/<capture.dir>/<id>.json`, then `<project>/<capture.dir>/<id>.json`. A file someone put
beside a trace is a stronger statement of intent than one found by convention. It is also the
easiest thing for a CI job that uploads a trace to also produce. Only the first is reachable without
a session id, and that is exactly the one the guard above now refuses. The other two are *keyed* on
the id, so they cannot be looked up at all.

### The hook must not talk to the model

Claude Code adds a `SessionStart` hook's **stdout to the model's context**. A report printed there
would be a side effect on the very session being observed, with the tool changing the thing it
measures. So `capture` writes **nothing to stdout when it read a payload from stdin**. The report
goes to stderr, where an exit-0 hook's output is a debug line. Run by hand it behaves like every
other command. This is not a stylistic choice and it is pinned by a test that drives the real binary.

### The plugin fires on `startup` only

`plugin/` ships `.claude-plugin/plugin.json` and `hooks/hooks.json`, so adoption is one install
rather than a hand-edited `settings.json`. The matcher is `startup`, not `startup|resume|compact`,
because a manifest describes what the artifacts said **when the session began**. That is precisely
the "then" that staleness compares against. `compact` and `clear` reset the model's context without
re-reading a single artifact. So a capture there would overwrite a snapshot with one answering no
new question. Someone who wants resume-time snapshots can widen the matcher; the policy lives in the
plugin, not in the command.

The command is `npx --no moose-tracevals capture`: it uses a locally installed copy and fails fast
rather than reaching the network at session start.

### Consequences

- Good, because staleness becomes **content identity** for every artifact a manifest recorded, which
  is what ADR 01021 said it wanted and could not have.
- Good, because it removes the CI false positive that made the mtime warning close to useless there.
  A checkout no longer flags a repository whose sessions were captured.
- Good, because it catches the case mtime structurally cannot: an edit whose timestamp was restored.
- Good, because the git SHA is recorded. So "check out the commit the session ran on and re-run",
  the fix `declare/coverage.mdx` already recommends, stops being a guess about which commit.
- Good, because nothing about it is required. An absent manifest is the default and leaves ADR 01021
  untouched, so no existing user, corpus, or CI job changes behaviour.
- Bad, because it only helps sessions recorded *after* someone installs the hook. Every trace already
  on disk keeps the guess, which is why ADR 01021 was built first and stays.
- Bad, because it introduces a second file to correlate. A manifest that does not travel with its
  trace is silently absent, and indistinguishable from never having been captured.
- Bad, because `discoverArtifacts` is project-scoped, so user-level and plugin skills are outside the
  manifest entirely and keep the heuristic. The report says which, but a reader has to notice.
- Bad, because a long session that resumes days later is described by one snapshot taken at its
  start. That is the honest meaning of the file, and it is what the name says. But it is a partial
  answer for the turns after a resume.
- Bad, because a manifest can be hand-edited to make hashes agree. It is evidence about a device,
  stated as such; the same person could edit the `SKILL.md`, and ADR 01011 already executes that
  project's code.
- Bad, because a trace that records no session id cannot use a manifest found by convention at all.
  Such a trace has to name one with `--manifest`, and there the provenance guarantee is the caller's
  assertion rather than a check the tool made. That is the narrowing this decision accepts, and it
  is narrower than it sounds. The two conventional locations are *keyed* on the session id, so only
  the file beside the trace was ever reachable without one.
- Neutral, because the JSON report gains `manifest` and each coverage row gains `contentCheck`.
  Existing consumers read neither and are unaffected; the human and markdown reports say nothing
  extra when there is no manifest.
- Neutral, because the judge digest is untouched: no manifest data is rendered into a prompt, so no
  cache entry moves and `PROMPT_VERSION` does not change.

### Confirmation

- `test/unit/capture.test.ts` pins the hook envelope against the documented shape. That covers all
  four spellings of the start/end reason, and a payload with nothing optional. It also covers a
  member of the wrong type being ignored rather than trusted, and text that is not a JSON object
  being refused. It then pins the manifest itself: POSIX-relative paths, the opaque device id, the
  git block, and a corrupt or future-versioned file reading as `null`. It pins **that a redaction
  pattern matching everything leaves `path`, `sha256`, and `sessionId` untouched while scrubbing the
  config and `root`**. And it pins a malformed artifact entry making the whole file read as `null`
  rather than as evidence of change. That covers an entry missing a `path`, one whose `sha256` is
  not a string, and one that is not an object at all.
  `checkContent` is pinned on reporting the **manifest's** digest as `expected` on a match, against a
  map view that answers a second traversal differently. A plain `Map` keeps the two values
  equal and would never catch it. `findManifest` is pinned on all three locations, and on preferring
  the one beside the trace. It is pinned on refusing a foreign session id, and on refusing a
  *discovered* manifest when the trace records no id. It is pinned on naming the file and reason it
  refused, and on honouring an explicitly named one in that same case.
- `test/unit/artifacts.test.ts` pins the run side against a temp directory with a pinned mtime. No
  manifest reports `skipped` with a reason, and a match clears a deliberately future-dated mtime. A
  mismatch fires even when mtime says the file is *older*, and a comparison happens with no
  `endedAt` at all. An unrecorded file falls back to the heuristic, and a mismatched artifact still
  resolves with its content intact.
- `test/unit/engine.test.ts` pins that the fixture corpus reports no manifest and a `skipped` check
  on every row. It pins that `--manifest` naming an unusable file throws. It pins that a real
  manifest clears the checkout's flags for the project's artifacts. That manifest leaves the
  out-of-project plugin skill on the guess with its reason, and moves **no** verdict, summary, or
  exit code. A stream-json trace stripped of its `system`/`init` record parses with no session id.
  Against that trace it pins that the sibling manifest is refused with a warning naming it, while
  `--manifest` still consumes one.
- `test/unit/reporters.test.ts` pins that the human and markdown reports name content identity rather
  than mtime for an exact mismatch. They keep the markdown column count, print nothing at all with no
  manifest, and say how many rows still rest on the guess.
- `test/integration/cli.test.ts` drives the built binary with a payload on real stdin. The manifest is
  written, **stdout is empty**, and a payload with no session id exits 2. `--manifest` against a
  corpus is refused, and `capture` followed by `run` demonstrably reduces the stale set while leaving
  the summary and exit code identical.
- [ci.yml](../.github/workflows/ci.yml) runs `capture` over the fixture corpus and asserts the
  manifest's shape. It then runs `run` three ways over one trace, with no manifest, a fresh
  manifest, and a manifest invalidated by an edited artifact. Those three assert `skipped` / `match`
  / `mismatch` and the warning wording in each case. They also assert that the eval outcomes and
  exit code are byte-identical across all three. A fourth step drives the real binary against a
  stream-json trace whose `system`/`init` record has lost its session id. A manifest sits beside it.
  The discovered one is refused and named in a warning, `--manifest` still consumes it, and neither
  the summary nor the exit code moves.

## Pros and Cons of the Options

### A `SessionStart` hook writing a manifest

- Good, because a sha256 is content identity, which is the only thing that actually answers the
  question.
- Good, because the git SHA turns "re-run against the commit the session ran on" into an instruction
  rather than an archaeology exercise.
- Bad, because it needs adoption, and it is worth nothing for sessions already recorded.
- Bad, because it is a write path, and a second file that has to travel with the trace.

### Keep mtime and document harder

- Good, because it is free and already shipped.
- Bad, because the documentation would be explaining why the signal is unreliable rather than making
  it reliable. `declare/coverage.mdx` already does that as well as it can be done.

### Reconstruct artifacts from git history

- Good, because it needs no hook and no adoption: the repository already holds every past version.
- Bad, because nothing records **which commit** the session ran against, so it would have to be
  inferred from `trace.endedAt`. That is a guess layered on the guess it was replacing.
- Bad, because it is wrong whenever the working tree was dirty, which during agent work it usually is.

### The manifest changes no flag

- Good, because the manifest could then never affect anything, which is the most conservative reading
  of "a claim, not proof".
- Bad, because it declines the entire benefit. The CI false positive survives. And a report carrying
  both an mtime warning and a contradicting hash match asks the reader to arbitrate evidence the tool
  already weighed.

### The manifest replaces mtime outright

- Good, because one mechanism instead of two.
- Bad, because an artifact the manifest never recorded would silently lose a signal it has today.
  That means every user-level and plugin one, and it is a regression disguised as a simplification.

### Only the canonical project location

- Good, because one place to look and nothing to explain.
- Bad, because the CI pattern that uploads a trace as a build artifact has nowhere to put the
  manifest. That is one of the three patterns the docs recommend.

### Only an explicit `--manifest`

- Good, because it is unambiguous.
- Bad, because it makes the feature opt-in twice: install the hook, then remember the flag on every
  invocation. A gate configured in CI months ago is exactly where it would be forgotten.

### Use a manifest recorded for a different session

- Good, because some evidence beats none.
- Bad, because it is the one input that could make the tool confidently wrong. It would report a
  hash mismatch as this session's staleness when it is a fact about a different one.

### Refuse an explicitly named manifest the trace cannot verify

- Good, because "refused, unconditionally" would then be literally true, with no caller-supplied
  exception to explain.
- Good, because it needs no argument about who is responsible for provenance.
- Bad, because it buys nothing. The danger is a *foreign* manifest being picked up silently, and
  discovery is where that happens. A path typed on the command line is not picked up silently.
- Bad, because it leaves `--manifest` structurally unusable for any trace that records no session
  id, which is the whole legacy stream-json shape. A flag that can only ever error is worse than
  one whose guarantee is stated honestly.

### Report to stdout in hook mode

- Good, because it is consistent with every other command.
- Bad, because Claude Code feeds a `SessionStart` hook's stdout to the model, so the observer would
  be writing into the session it observes. And it would do that on every single session start.
