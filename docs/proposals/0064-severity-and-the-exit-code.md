# 0064: a11y's severity floor is also its exit-code gate

- **Status:** Implemented
- **Serves:** Devin · D7, "Gate accessibility in CI". He reads the exit code
  and decides whether a build is red. He is also the one who asks why a
  `warning` is fatal in one manni tool and harmless in another.
- **Depends on:** [0035](0035-a11y-domain.md), which added the `a11y` domain
  and the exit-code contract this proposal explains.
  [0034](0034-command-grammar.md), whose "shared concepts use shared values"
  is the rule the question was raised under.
- **Relates to:** [0044](0044-citations-and-drift.md), which gave `cite` a
  per-rule severity. That is what gave the family a second reading of the
  scale, and so raised the question.
- **Supersedes:** One paragraph of [0035](0035-a11y-domain.md), in stress test
  10. It reads "What replaced it is a report at `notice` and a gate at
  `error`". That describes a floor and a gate that can be set apart. No such
  split was built, and none should be. 0035 is otherwise correct and is left
  exactly as written. Its "Exit codes" section describes what shipped.
- **Touches:** `src/a11y/commands/check.ts`, `src/a11y/types.ts`,
  `test/a11y/check.test.ts`,
  `docs/src/content/docs/meta/reference/output-and-exit-codes.mdx`,
  `docs/src/content/docs/a11y/ci/index.mdx`,
  `docs/src/content/docs/a11y/reference/cli.mdx`
- **Verdict:** `manni a11y check` keeps failing on every violation the
  severity floor keeps, whatever its level. `manni meta validate` and
  `manni cite check` fail on error-severity findings alone. The difference is
  deliberate, and it is now written down in all three places a reader meets
  it. No behaviour changed.

## Problem

The family has one severity scale, `notice | warning | error`. It is defined
once, in `src/shared/severity.ts`. Three tools now read it, and two of them
read it the same way:

| Tool | What makes it exit `1` |
|---|---|
| `manni meta validate` | A file with at least one error-severity finding. |
| `manni cite check` | A file with at least one unbaselined error-severity finding. |
| `manni a11y check` | A page with any remaining violation, or one that failed to load. |

`summarize` in `src/a11y/commands/check.ts` counted a page as failed when
`page.violations.length > 0`. The level was never consulted there. So a site
whose worst finding is an axe `moderate`, a family `warning`, exits `1`. A
metadata warning does not.

Read against "a flag or config key two domains both have carries the same name
and the same values", that looks like a bug. The values *are* shared. What
differs is the consequence attached to them. Nothing in the repository said
whether that was decided or overlooked. The line itself read like an oversight,
being a summary loop that filters by severity one function earlier and then
ignores it.

That ambiguity is the whole problem. A reader who finds it has to guess, and
the two guesses lead to opposite changes.

## Decision

### The floor is the gate

`--severity` sets what a run reports. It also sets what fails the run. A
violation the floor keeps fails its page. A violation below the floor is not
there at all, for the report, the score, or the exit code.

The reason is what a user can do about a finding's level in each tool.

In `meta`, the tool fixes each finding's level, and what fails is whatever the
schema requires. A schema author who wants a finding fatal writes it as a
requirement. In `cite`, each rule has a
default level, and `cite.severity.<rule>` moves any of them. It can also set
one to `off`. In both tools, a team that wants a build to fail on some finding
has a way to say so, by making it an error. Pinning the exit code to
`error` there costs nothing. It buys the honest reading that a warning is a
warning.

a11y has no such control, and cannot grow one cheaply. The severity comes from
axe's `impact`. axe decides it per rule, and the analyzer folds it onto the
family scale when a page is read. There is no per-rule key and no schema to
write. Suppose the exit code were pinned to `error`. A team that wants to fail
on the `color-contrast` findings axe calls `moderate` would have no way to ask
for it. The flag would move what they see and never what they gate on. The
domain would be the only one in the family with no lever over its own exit
code.

So a11y spends its one lever on both jobs. That is the shape the family
reference already describes. A tool either fixes its levels, as `meta` does,
or exposes the one lever its shape allows. This proposal is the reasoning
behind that sentence.

### It is also what the neighbours do

The scale was borrowed from the tools this one sits beside. Both linters named
in `src/shared/severity.ts` read their own level exactly this way. Vale's
`MinAlertLevel` is the floor it reports at and the floor it fails at. pa11y's
`--level` is the same. A user arriving from either finds a11y's `--severity`
behaving as they expect. A fixed gate would surprise them.

### The ratchet is the practice this enables

The floor is meant to move, in one direction. Start at `severity: error`,
which counts axe's `critical` and `serious` and drops the rest. Fix what it
finds. Once errors have been at zero long enough to trust, lower the floor to
`warning`, then to `notice`. Each step locks in the level below it. A finding
that would have been tolerated yesterday now fails the build.

This repository runs its own docs site that way, and `manni.config.yaml` says
so in a comment. It sits at `notice` today, the strictest setting, because the
site carries no finding at any level.

A fixed gate at `error` would delete the ratchet. No setting would make a
`warning` fail, so there would be no way to hold a level after clearing it.

### What changed

The behaviour did not. What changed is that the rule is now stated as a
decision rather than implied by a loop:

- `summarize` calls a named `fails(page)`. Its docblock says the level is not
  read there, and why.
- `CheckSummary.failed` says "whatever its severity" and names this proposal.
- `test/a11y/check.test.ts` has a block named for the rule. It pins a
  warning-only page and a notice-only page as failures. It also pins that
  raising the floor above them clears the run.
- The family severity page, the a11y CI page and the a11y CLI reference each
  state the difference and the reason where a reader meets it.

## Alternatives

### Aligning a11y with the rest of the family

Only error-severity findings would fail. The change is one line. It buys the
property that a warning means the same thing everywhere, being reported rather
than fatal.

It was rejected for the reason above. It leaves a11y with no way to gate on
anything axe calls `moderate` or `minor`. It deletes the ratchet this
repository uses on its own site. And it departs from pa11y and Vale in the one
domain whose users know them.

It is also breaking, for the worst kind of consumer. A site whose worst
finding is a `warning` would go from red to green. There would be no diff and
no message. That is the failure mode a gate exists to prevent.

### Adding `--fail-on <level>` beside the report floor

This version gives every reading what it wants. Report at `notice`, gate at
`error`, both spelled out. It is what 0035's superseded paragraph was reaching
for.

Rejected on surface cost. It is a second flag naming the same scale, on one
domain. The family has neither `--fail-on` nor `--min-severity` anywhere. Two
levers where one will do is what "commands must have parallel behaviors"
exists to stop.

The gap it closes is seeing a `notice` without failing on it. That gap is real
but small. A run at `--severity notice` with `-f github` already puts every
level on screen as an annotation, and a job can ignore the exit code. If a
team asks for the flag, it is additive. This proposal is where it should be
argued against.

## Consequences

- `manni a11y check` behaves exactly as before. Nothing release-visible
  changed. The work lands as `docs:` and `test:` rather than `feat:` or
  `fix:`, and carries no demo video.
- The three docs pages answer the question in place. The next reader who
  notices the asymmetry finds the reason rather than the loop.
- A fourth domain that folds a foreign scale onto the family's inherits the
  test, not the answer. It must ask whether a user can move a finding's level.
  If yes, it pins the gate to `error`, as `meta` and `cite` do. If no, its
  floor is its gate, as a11y's is.
- 0035's stress test 10 keeps its last paragraph, wrong as it now reads. The
  `Status:` line is the only part of a superseded proposal this repository
  edits. 0035 is superseded only in part, so nothing in it changes at all.
