---
status: "accepted"
date: 2026-08-29
decision-makers: [hawkeyexl]
consulted: []
informed: [docevals]
---

# Load grader plugins named in the config, and append `--require` to that list

## Context and Problem Statement

`registerGrader` is exported from [src/index.ts](../src/index.ts) and documented in
[extend/custom-graders.mdx](../docs/src/content/docs/extend/custom-graders.mdx), but nothing in the
CLI ever called it. A team could write a custom grader, declare `grader: my-custom-check` in a
SKILL.md, and run `npx moose-tracevals run`. They would get `unknown grader kind`, with no flag and
no config key that would have changed the answer. Extension was library-only, so the two journeys that should
compose (`cuj-extend`, build on the tool; `cuj-gate-ci`, run it in CI) did not.

The registry already accepts registration at any point
([src/graders/registry.ts](../src/graders/registry.ts)). What was missing was a way to name a module
and a place to do the importing.

## Decision Drivers

- A grader the user asked for and did not get must never leave a run looking clean. The existing
  invariant, applied to a new case.
- A plugin failure and a typo'd grader kind produce the same *symptom*, and demand opposite fixes.
  One is in the config, the other in an artifact. The messages have to separate them.
- The config is committed and shared. A specifier in it has to mean the same thing from any working
  directory. That includes a CI step that runs the CLI from the repository root.
- This loads code named in a file. The surface must be stated rather than assumed.
- CLAUDE.md's config↔CLI contract: schema first, default in `parseConfig()`, flag in `src/cli.ts`,
  overlay at the read site. Runtime code never reads argv.

## Considered Options

- **`tracevals.plugins` plus a `--require` flag that appends to it**
- `--require` only, with no config key
- A config key only, with no flag
- `--require` replacing `config.plugins`, matching the `??` overlay every scalar knob uses

## Decision Outcome

Chosen option: **`tracevals.plugins` plus `--require`, appending.**

A list of module specifiers, imported before `planEvals` reads the registry, from both `run` and
`fill`.

### `--require` appends; it does not replace

Every other flag in this tool replaces its configured value with `??`, and this one deliberately
does not. A `plugins` list is not a setting, it is a set of capability registrations, and the two
failure modes are not symmetric:

- **Appending** costs the ability to *exclude* a configured plugin from one run. That is
  recoverable, by editing the config or running somewhere else, and wanting to exclude one is
  usually a sign the config is wrong.
- **Replacing** means `--require ./one-off.mjs` silently unregisters a repo's house graders, and
  every eval declaring one flips to `unknown grader kind`. Loud, but it names an artifact nobody
  touched and sends the reader to the wrong file. The flag reached for to *add* a grader would be
  the thing that removed five.

Load order is config first, then flags, so a deliberate `--require` still wins a colliding kind.
The read site is a concatenation rather than a `??`, and that is the one place this change departs
from the repo's pattern. It is a set-valued knob, and the pattern is written for scalars.

### Specifiers resolve against the config file's directory

Not `process.cwd()`. A committed `plugins: [./tracevals/graders.mjs]` has to survive being run from
the repository root against a project one directory down. That is the shape every CI example in
these docs already uses. Three forms, all resolved the same way:

| Specifier | Resolved |
|---|---|
| `./x.mjs`, `../x.mjs` | against the config file's directory |
| `/abs/x.mjs`, `C:\abs\x.mjs` | as written |
| `my-graders`, `@scope/graders` | Node's own algorithm, rooted at the config file's directory. A plugin installed beside the config therefore beats one installed beside this package. If nothing resolves there the bare specifier is passed through, which still finds one sitting next to moose-tracevals |

### Two plugin shapes, both supported

- `export function register({ registerGrader })` hands the registrar in. This is the documented
  default, because it needs no import of this package and therefore cannot bind to the wrong copy
  of it. It is also what lets one committed fixture serve both this repo's source tests and its
  built-CLI tests.
- Calling `registerGrader` at import time, having imported it from `moose-tracevals`. This is what
  the extend guide has always shown, and it keeps working. `dist/cli.js` and `dist/index.js` are
  separate bundle entries that share the chunk holding the registry, so the specifier resolves to
  the same Map the CLI is reading. That is a fact about the build, so a test pins it.

A plugin is imported **once per process**, tracked by resolved location. ESM already guarantees that
for the side-effect shape. Without the tracking, `register` would be re-invoked on every load and
the two shapes would disagree. A batch evaluating N traces in one process would re-register on each,
and report N−1 spurious "replaced the grader" warnings.

### The four failure modes

| State | Result | Why |
|---|---|---|
| The specifier will not import | `TracevalsError`, exit 2 | A run that went ahead without the plugin reports `unknown grader kind`, which reads as a typo in an artifact. The message says `could not load grader plugin "<specifier>" (resolved to <path>)`. It names the file the loader actually looked for, and shares no wording with the registry's error. |
| The module throws while registering | `TracevalsError`, exit 2 | Same reasoning; a distinct message, `threw while registering`. |
| It imports and registers nothing | warning in the report | Not fatal, since the module may be doing something else legitimately. It is the quiet failure, so it is named, and the warning quotes the `unknown grader kind` the user is about to see. |
| It claims a kind that already exists | allowed, warning in the report | Argued below. |

Warnings reach `RunReport.warnings` and `FillReport.warnings`, which is where every other
degradation in this tool already surfaces.

### A plugin replacing a built-in is allowed, and said out loud

Rejecting it was considered and refused. `registerGrader` is public API whose documented behavior is
"registering a `kind` that already exists replaces it, which is how you would override a built-in".
Refusing the same call when it arrives through the loader would give one function two contracts
depending on who invoked it. It would also block a legitimate use, a house `file-access` stricter
than the shipped one.

But an override silently changes what *every* eval declaring that kind means, including evals in
artifacts the plugin's author does not own. So it goes in the report:
`replaced the built-in grader "file-access"; every eval declaring that kind now runs the plugin's
implementation`. Taking a kind from an earlier *plugin* warns too, in its own words.

### The security surface, measured against `command`

This imports code named in `moose.config.yaml`. That is a **strictly smaller** surface than the one
[ADR 01011](01011-execute-command-graded-evals.md) already accepted, and the difference is whose
file names the code:

- `command` executes a program named in the **evaluated** repository's artifacts. Point `run` at
  someone else's trace and their project's `tracevals/check.mjs` runs.
- `plugins` imports a module named in the **evaluating** repository's config, the file the person
  running the command owns and commits. Evaluating a hostile trace does not add a plugin, and a
  plugin cannot be introduced by the artifacts under evaluation.

That is exactly the asymmetry 01011 named when it rejected a config opt-in for `command`. The
opt-in would live in the *evaluating* repo's config while the risk came from the *evaluated* repo's
artifacts, gating the wrong side. Here the risk and the config are on the same side. That is what
makes a config key the right instrument for this, and the wrong one for that.

It is not *zero*, and two things are worth stating plainly. A plugin runs with the CLI's full
privileges, with no sandbox and none claimed. And `--require` on a shared CI runner is a
command-line argument like any other. Whoever can edit the workflow can already run code there.
Anyone unwilling to accept the surface simply declares no plugins, which is the default. The
list is empty unless someone writes one.

### Consequences

- Good, because `cuj-extend` and `cuj-gate-ci` compose: a custom grader written against the
  documented contract is now reachable from `npx moose-tracevals run`.
- Good, because the loud failures are loud and the quiet one is named. None of the four states can
  be mistaken for a passing run.
- Good, because a config carrying relative specifiers is portable, so the CI examples in these docs
  keep working unchanged.
- Bad, because `moose-tracevals` now imports code named in a file rather than only reading files.
  Smaller than the surface already accepted, but not nothing.
- Neutral for `fill`. `ALLOWED_GRADERS` ([src/fill/gate.ts](../src/fill/gate.ts)) still refuses to
  *propose* a custom kind, so loading there changes one thing only. A plugin that replaces a
  built-in replaces the `validateOptions` the gate ground-checks proposals with (ADR 01004). It is
  wired anyway, because a repo's config must not mean different things to different commands.
- Neutral, because `runEvals` does not load plugins. It receives a config but not the directory that
  config came from, and a library consumer calling it directly is already holding `registerGrader`.

### Confirmation

- [test/unit/graders/plugins.test.ts](../test/unit/graders/plugins.test.ts) covers each resolution
  form, per-process idempotence, and all four failure modes. That includes the load error carrying
  the resolved path and **not** matching `/unknown grader kind/`.
- [test/unit/run-command.test.ts](../test/unit/run-command.test.ts) pins the overlay. One call
  carrying both a config plugin and a `--require` plugin must grade with the config's, which is the
  assertion a replacing implementation fails.
- [test/unit/config.test.ts](../test/unit/config.test.ts) covers the schema in both directions.
  That is the default, order preservation, a bare string, a non-string entry, and an empty
  specifier.
- [test/integration/cli.test.ts](../test/integration/cli.test.ts) runs the built CLI, which is the
  only place the side-effect shape can be proven. It is a claim about bundling, not about source.
- [ci.yml](../.github/workflows/ci.yml)'s plugin dogfood runs
  [test/fixtures/plugin-project](../test/fixtures/plugin-project) three ways on both OS legs.
  Those are without a plugin (`error`), with `--require` (`pass`), and with the same plugin named
  by that project's own config from its own directory (`pass`). A `--require` that silently did
  nothing would still look green against a corpus that passed either way, so the corpus is built to
  fail without it.

## Pros and Cons of the Options

### `tracevals.plugins` plus an appending `--require`

- Good, because the durable case (a repo's own graders) is committed and the one-off case is a flag.
- Good, because CI needs no flag at all once the config names the plugin.
- Bad, because there is no way to run *without* a configured plugin short of editing the config.

### `--require` only, no config key

- Good, because nothing new is committed and the surface is per-invocation.
- Bad, because every developer and every CI step must remember the flag. The one that forgets gets
  `unknown grader kind` and no hint that a flag was the answer.
- Bad, because it breaks the config↔CLI contract in the other direction: a flag with nothing behind it.

### A config key only, no flag

- Good, because it is the smallest addition.
- Bad, because trying a grader out means editing a committed file, which is exactly the friction
  that stops people trying.

### `--require` replacing `config.plugins`

- Good, because it matches the `??` overlay every scalar knob uses, with no special case to explain.
- Bad, because adding one plugin would remove all the others, and the resulting error names an
  artifact nobody edited.
- Bad, because the recovery is to retype the whole list on the command line, which nobody will do
  correctly under CI pressure.
