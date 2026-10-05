# 0075: Time windows and execution in the evals domains

- **Status:** Proposed
- **Serves:** Devin · D10, who gates evals in CI. Devin · D11, who bounds
  what the eval gate can execute. Maya · M11, who runs a first gate on her
  own machine.
- **Depends on:** [0048](0048-docevals-domain.md) and
  [0049](0049-tracevals-domain.md), the two evals domains this aligns.
- **Relates to:** [0034](0034-command-grammar.md), the rule that a shared
  concept has one name and one set of values.
  [0073](0073-docevals-grades-what-no-other-domain-owns.md), which left
  `frontmatter-commands` as the only execution grant.
- **Supersedes:**
  [ADR 01025](docevals/01025-an-operator-grant-replaces-the-frontmatter-commands-boolean.md)
  from the docevals log. Its Status line is the only edit.
- **Supersedes, in part:**
  [ADR 01019](tracevals/01019-add-an-opt-out-for-command-execution.md) from
  the tracevals log, for its config key and its flag pair. It is not edited.
- **Touches:** `src/shared/duration.ts`, `src/shared/execution.ts`,
  `src/shared/exec.ts`, `src/shared/color.ts`, `src/docevals/**`,
  `src/tracevals/**`, `test/docevals/**`, `test/tracevals/**`
- **Verdict:** Both evals domains select by age with `--newer-than
  <duration>`, and both run command evals by default. Config and flags only
  ever narrow what runs.

## Problem

The two evals domains spell the same ideas differently.

docevals has `--since <ref>`, a git ref. tracevals had `--since <duration>`,
a window of time. One flag name carried two meanings, and a CI recipe copied
from one domain broke in the other.

Execution diverged further. docevals denied command evals unless the operator
granted `frontmatter-commands`. tracevals ran them unless the operator turned
`graders.command.enabled` off. A command eval meant opposite things depending
on which domain read it.

The review gate had two names as well. docevals called it `--fail-on-review`,
and tracevals called it `--fail-on-needs-review`.

## Decision

### 1. `--newer-than <duration>` selects by age

One grammar, in `src/shared/duration.ts`. A duration is a count, which may
carry a fraction, then one unit: `m` minutes, `h` hours, `d` days or `w`
weeks.

| Domain | Verbs | Selects |
|---|---|---|
| tracevals | `run`, `calibrate`, `list` | traces whose file changed inside the window |
| docevals | `run` | pages whose file or eval manifest changed inside the window |

tracevals renames its `--since <duration>` to `--newer-than`, with no alias.
`list` gains the flag, so a reader sees what a run would evaluate.

docevals adds `--newer-than` beside its `--since <ref>`. A page must satisfy
both when both are given. The help says to prefer `--since` in CI, because a
ref names the change a pull request makes.

A value that is not a duration exits 2, in either domain:

```text
manni: --newer-than must be a duration such as 30m, 24h, 7d or 2w, got "7y"
```

### 2. A page's age is detected, not switched

docevals decides how old a page is from the working tree. No flag picks the
rule.

- A committed page is one git tracks, where neither it nor its eval manifests
  hold an uncommitted change. It takes the committer date of the last commit
  touching any of those files.
- Any other page takes the newest file mtime among them. That covers an
  untracked page, a modified one, and a directory outside a repository.

The committed case reads git because a fresh clone stamps every file with the
clone's time. CI runs on fresh clones, so mtime alone would select every page.
The modified case reads mtime because an uncommitted edit is newer than any
commit.

### 3. Command evals run by default, and the operator narrows

Everything available runs unless the operator narrows it. Both domains read
one grant, `frontmatter-commands`, from `src/shared/execution.ts`.

The config, before:

```yaml
docevals:
  execution:
    allow: [frontmatter-commands]   # optional, default []
tracevals:
  graders:
    command:
      enabled: false                # optional, default true
```

After:

```yaml
docevals:
  execution:
    allow: [frontmatter-commands]   # optional, default every grant
tracevals:
  execution:
    allow: []                       # optional, default every grant
```

| Key | Type | Default | Effect |
|---|---|---|---|
| `<domain>.execution.allow` | list of grants | every grant | the grants a run holds; `[]` runs no command eval |

| Flag | Effect |
|---|---|
| `--allow-execution <kind>` | repeatable; keeps only the named grants the config holds |
| `--no-execution` | runs no command eval for this run |

No flag widens what the config narrowed. A config of `allow: []` with
`--allow-execution frontmatter-commands` still runs nothing. An ungranted eval
reports `skipped`, never `pass`, with this reason:

```text
frontmatter commands not granted (execution.allow: [frontmatter-commands])
```

An unknown grant exits 2. On the command line it reads:

```text
manni: --allow-execution must be one of frontmatter-commands, got "x"
```

In config, each domain prefixes the message as it prefixes its other config
errors:

```text
Invalid config in manni.config.yaml: unknown execution grant "x"; expected one of frontmatter-commands
manni.config.yaml: unknown execution grant "x"; expected one of frontmatter-commands
```

The first line is docevals and the second is tracevals. Two unknown grants
read `unknown execution grants "a", "b"`.

### 4. The untrusted pull request passes `--no-execution`

ADR 01025 guarded a fork's pull request with a default of deny. That risk does
not go away. It moves to one explicit step in the untrusted-PR recipe:

```bash
manni docevals run --since origin/main --no-execution
manni tracevals run --newer-than 7d --no-execution
```

The same-repo restriction on the docs-as-tests job stays the complete
control. A grant was always defense in depth, and so is `--no-execution`.

### 5. The review gate has one name

tracevals renames `--fail-on-needs-review` and its negation to
`--fail-on-review` and `--no-fail-on-review`. The config key
`failOnNeedsReview` becomes `failOnReview`, and it still defaults to `true`.

### 6. Output

The docevals JSON report gains one block when `--newer-than` is given:

```json
"newerThan": { "duration": "7d", "pagesSelected": 2, "pagesTotal": 40 }
```

With `--since` as well, both blocks carry the one combined count. Every
reporter prints one scope line:

```text
Scoped to 2 of 40 page(s) changed since origin/main and in the last 7d.
No pages changed in the last 7d — nothing was evaluated.
```

`--write-baseline` refuses `--newer-than` as it refuses `--since`. Both
narrow the corpus a re-record would rebuild.

tracevals declares `--no-color` on its program, the way docevals does. Its
`command` grader spawns through `src/shared/exec.ts`, the wrapper docevals
uses.

### 7. The programmatic API

| Before | After |
|---|---|
| tracevals `since` | `newerThan` |
| tracevals `parseSince` | `parseNewerThan` |
| tracevals `commands: false` | `allowExecution: []` |
| tracevals `failOnNeedsReview` | `failOnReview` |
| docevals `allowExecution` (adds grants) | `allowExecution` (keeps only these) |
| none | docevals `newerThan` |

## Why ADR 01025 is superseded

ADR 01025 chose default deny as the correct posture for content-driven
execution. The maintainer decided otherwise. Everything available runs unless the
operator narrows it.

Three things changed since 01025. 0073 removed `page-embedded-steps`, so one
grant is left and it covers one path. tracevals had run commands by default
all along, so the family held both postures at once. And the risk 01025
guarded, a fork's pages, has a narrower control than a global default.

## Stress test

### 1. Does a fork's pull request now run its author's code?

Only in a recipe that leaves out `--no-execution`. The same-repo restriction
on the docs-as-tests job is unchanged. This repository's own config keeps
`docevals.execution.allow: []`, so its CI runs nothing either way.

### 2. Why may `--allow-execution` not widen the config?

A flag that widened would let a command line override a repository's decision
to run nothing. The config is the operator's standing choice. A flag is one
run's narrowing of it.

### 3. Why mtime at all, if CI reads git?

A page someone is editing has no commit yet. Reading only git would leave a
local `--newer-than 1h` blind to the page on screen.

### 4. Why keep `--since` in docevals?

A ref names exactly what a pull request changed, and it does not drift with
the clock. A window is the local and scheduled question.

## Consequences

- Good, because one flag name means one thing across the family.
- Good, because a command eval means the same in both domains.
- Bad, because a docevals corpus that relied on the default of deny now runs
  its command evals. It must write `allow: []` to keep the old behaviour.
- Bad, because tracevals scripts using `--since <duration>`, `--no-commands`
  or `--fail-on-needs-review` must be rewritten. tracevals is unreleased, so
  no published version breaks.
