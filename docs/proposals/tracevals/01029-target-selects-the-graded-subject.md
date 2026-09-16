---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# `target` selects the graded subject, alongside the narrowing options graders already have

## Context and Problem Statement

Every grader saw one thing. The judge always received the artifact plus the whole rendered
transcript; `regex` always searched session messages. An assertion about the session's *final
answer*, about *which files it wrote*, or about a file it *produced* could not be written at all.

`docmeta:artifact-evals:1.0.0-proposal.2` adds `target` for exactly this. The question this ADR
settles is how it relates to the options graders already carry. Two of them look like
they overlap and do not.

## Decision Drivers

- The selector is cross-grader by nature. If each grader invents its own spelling in `options`,
  two graders pointed at "the final message" have no common way to say so.
- `regex` already has `on: assistant | user | all`, and `tool-usage` has `includeSidechains`.
  Whatever `target` means must not make either ambiguous.
- A target that cannot be served must not silently become a different one.

## Considered Options

- Treat `target` as replacing the graders' own options.
- Treat `target` as a third, orthogonal axis.
- Skip `target`; let each grader keep improvising in `options`.

## Decision Outcome

Chosen option: **`target` is the *subject* axis, and it composes with the others.**

Three distinct questions, three fields:

| Field | Question | Example |
|---|---|---|
| `target` | Which **subject**? | `transcript`, `last-message`, `files`, `artifact`, `{source: file, path}` |
| `regex.on` | Which **speaker**, within a transcript? | `assistant`, `user`, `all` |
| `tool-usage.includeSidechains` | Which **scope**? | main thread, or subagent branches too |

`on` therefore applies when `target` is the transcript and nowhere else. The file list has no
speakers. An earlier draft of the sibling repo's ADR described `includeSidechains` as
improvisation that `target` would replace; that was wrong, and this records the correction.

## Consequences

- Good, because the judge and `regex` now name the same subjects with the same words.
- Good, because `last-message` makes "did it report cleanly" expressible, and `files` makes
  "did it write where it said" expressible, neither of which any speaker filter could reach.
- Good, because an unreadable target is an explicit error, not a fall back to the transcript. A
  verdict about the wrong bytes is worse than no verdict.
- Good, because a `{source: file}` target refuses absolute paths and paths that climb out of the
  project root. An artifact is content, and content naming an arbitrary path on the machine
  running the eval is the same hazard class as a command.
- Neutral, because a judge run given no parsed trace can still serve `transcript` and `artifact`.
  It says so plainly for the rest, rather than quietly grading the transcript instead.
- Bad, because three axes is more to learn than one. The table above exists because the
  alternative, collapsing them, makes each answer the others' question.

### Confirmation

`test/unit/weight-target-runs.test.ts` covers each subject, the empty-final-message case, and path
refusal in both forms. It covers the composition case too. `on: all` cannot find a pattern that
appears only in the file list, and `target: files` can. It also covers the seam between
selection and the prompt. A `last-message` target with a trace supplied puts the final message
in front of the judge, and keeps the rendered transcript out.

**The system prompt names the subject rather than assuming a transcript.** It originally said
"Ground every judgment in the transcript", which is wrong for every target this ADR adds. The
heading in the user content was already accurate, but the instruction above it told the judge it
held something it did not. It now grounds judgments in "the graded content" and lists what that
may be. `PROMPT_VERSION` bumps with it, so verdicts cached under the transcript-only wording are
not replayed.
