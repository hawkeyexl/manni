# 0081: The `test` domain runs Doc Detective

- **Status:** Proposed
- **Serves:** Two people.
  - Devin · D17, "Gate the docs' procedure tests with the same contract". He
    wires Doc Detective into CI today as a step that follows none of the
    family's rules.
  - Maya, who writes the inline tests and runs them on her own machine. She
    reads Doc Detective's raw log to find the step that broke.
- **Depends on:** Three proposals.
  - [0034](0034-command-grammar.md) is the grammar. A new domain spells its
    verb, even when it has only one.
  - [0050](0050-lint-domain.md) split the job from the tool. The verb names
    what is checked, and config names what answers it.
  - [0073](0073-docevals-grades-what-no-other-domain-owns.md) removed
    `tool:doc-detective` from docevals. Doc Detective had no home in the
    family after that, and this proposal gives it one.
- **Relates to:** Three more.
  - [0062](0062-dita-ot-answers-structure.md) is the precedent for running an
    outside tool and reading its log rather than its exit code.
  - [0045](0045-family-encryption-key.md) made a family resource a domain with
    verbs. A family `manni tools` command would be one, and this proposal
    defers it.
  - [0041](0041-collections.md) put document sets in `collections:`. This
    domain reads them only when asked.
- **Touches:** `src/test/**`, `src/shared/tools.ts`, `src/cli.ts`,
  `src/index.ts`, `test/test/**`, `scripts/check-cli-reference.mjs`,
  `.github/workflows/docs-as-tests.yml`, `docs/src/content/docs/test/**`,
  `docs/src/content/docs/meta/reference/configuration.mdx`,
  `docs/content-strategy/{cujs,information-architecture}.md`, `README.md`
- **Verdict:** `manni test run` runs Doc Detective and reports its results in
  the family's contract. Exit codes are `0`, `1` and `2`, and the formats are
  `pretty`, `json` and `github`. Doc Detective's own config supplies the
  default input.

## Problem

Every gate in this repository is a `manni` command except one. The
docs-as-tests workflow ran Doc Detective through its own GitHub Action. That
step followed Doc Detective's rules, and none of them are the family's.

- **Its exit code is not a verdict.** Doc Detective exits `0` when a test
  fails, unless the caller passes `-e`.
- **Its failures are log lines.** A broken step prints in the job output. It
  does not annotate the page that broke, so a reviewer scrolls to find it.
- **Its install is one more recipe.** Each CI system needs its own way to get
  Doc Detective, beside the one Devin already has for manni (D1, D10).

Devin pays for all three in every repository he gates. He has learned one exit
code contract and one annotation format already. A docs gate that ignores both
is the step he cannot route.

Maya pays locally. She writes `{/* step … */}` comments in a page, runs Doc
Detective, and reads a long log for the one failing line.

Two behaviours of Doc Detective 4.26 make a thin wrapper unsafe as well. Both
were found by running it.

- It ignores an input path that does not exist. A typo in a CI recipe tests
  nothing and passes.
- When it finds no tests, it exits `0` and writes a results file that holds
  `null`. A gate pointed at the wrong directory stays green forever.

## Decision

### 1. One verb, `manni test run`

```text
manni test run [paths...]
```

The job is *test*, and Doc Detective is the tool. That is 0050's split. The
verb names what a person means, so a second tool later changes config rather
than the command anyone types.

There is no `--tool` flag. One tool answers the job, and a flag with one legal
value is noise. The flag arrives with the second tool, and adding it then is
additive.

The domain spells its verb, as 0034 requires. `manni test docs/` is a usage
error, not a shortcut.

### 2. Its own domain, not a docevals grader

0073 took `tool:doc-detective` out of docevals for two reasons. The grader
gave Doc Detective a second home, and it was the only reason the
`page-embedded-steps` grant existed. Putting it back would undo both.

The questions differ as well. docevals asks whether a page says the right
thing. Doc Detective asks whether a procedure still works when someone follows
it. The second is a job of its own, so it gets a domain of its own.

### 3. One config key, under `tools:`

Before:

```yaml
tools:
  vale:
    config: .vale.ini
```

After:

```yaml
tools:
  vale:
    config: .vale.ini
  doc-detective:
    config: .doc-detective.json   # optional
```

| Key | Type | Default | Required | Effect |
|---|---|---|---|---|
| `tools.doc-detective.config` | string, a path relative to the manni config file | unset | no | The Doc Detective config file, passed as its `--config` |

When the key is unset, Doc Detective finds its own `.doc-detective.json`,
`.yaml` or `.yml` in the working directory. The key exists for a run from a
subdirectory. Doc Detective searches only the working directory, while manni
walks up to find its config.

The key lives under `tools:` because Doc Detective is not this domain's. That
is the rule 0050 set for Vale. There is no `test:` section, because the domain
has no settings of its own. Everything Doc Detective reads stays in Doc
Detective's config, including `input`, `fileTypes`, `beforeAny` and
`loadVariables`.

`tools:` gains a third member. The unknown-key message now lists it:

```text
manni: manni.config.yaml: tools has unknown key "x". Supported keys: vale, dita-ot, doc-detective.
```

### 4. Input precedence

A run tests the first of these that is present.

1. **Positional paths.** Files and directories go to Doc Detective as typed,
   and it walks directories itself. manni expands globs. Each path must exist,
   because Doc Detective would skip a missing one in silence.
2. **`--collection <name>`.** Repeatable, one name per occurrence. It reads the
   named collections' `paths:` minus their `exclude:`, as lint does. The file
   list replaces Doc Detective's `input`, and every other Doc Detective key
   still applies. It cannot be combined with positional paths.
3. **Doc Detective's own `input`.** From its config, found as section 3
   describes.

A bare run does **not** read every collection. meta and lint do, and this is a
deliberate difference. A repository that tests its docs already has a Doc
Detective config, and that config already says what to test. Reading
collections by default would give one question two answers. It would also
change what an existing repository tests the day it adopts manni.

A collection is usually every page, and most pages carry no test. Passing all
of them also costs command-line length, which section 8 covers. `--collection`
is there for the repository that wants manni's document set to decide.

### 5. Parity breaks, on purpose

CLAUDE.md asks every command for the same input surface. Three parts of it do
not fit.

- **`-` for stdin.** Doc Detective reads files and has no stdin. `-` is a usage
  error that says so.
- **`--as` and `--ext`.** Doc Detective's `fileTypes` decides which files hold
  tests and how to read them. A second answer from manni would disagree with
  it.
- **`--exclude`.** The same reasoning applies. A collection's own `exclude:`
  still applies, because the collection is the list.

The shared flags that do apply keep their names: `-c/--config`, `-f/--format`,
`--collection`, `--allow-empty` and `--no-color`.

### 6. What manni passes Doc Detective

Doc Detective 4.26 has no `run` subcommand. manni invokes it with flags alone.

```text
doc-detective -i <a>,<b>,<c> [-c <config>] -r json -o <temp dir>
```

`-i` takes one comma-joined list. `-c` appears only when
`tools.doc-detective.config` is set. manni reads `testResults-*.json` from the
temporary directory and removes the directory afterwards.

manni never passes `-e`. The verdict comes from the results file, not from
Doc Detective's exit code. 0062 reached the same rule for DITA-OT, for a
similar reason.

### 7. Output

**pretty.** Only `FAIL` and `WARNING` steps are listed. They are grouped by
page, relative to the working directory, with the step's line when Doc
Detective reports one.

```text
docs/guide.md
  12  FAIL     Returned exit code 1. Expected one of [0]
  30  WARNING  Took 4100ms; the timeout is 3000ms.

2 tests: 1 passed, 1 failed, 0 warnings, 0 skipped
```

A clean run prints only the summary line. The counts are tests, from Doc
Detective's `summary.tests`.

**github.** One workflow command per listed step, then the summary line.

```text
::error file=docs/guide.md,line=12,title=Doc Detective::Returned exit code 1. Expected one of [0]
::warning file=docs/guide.md,line=30,title=Doc Detective::Took 4100ms; the timeout is 3000ms.
2 tests: 1 passed, 1 failed, 0 warnings, 0 skipped
```

**json.** Doc Detective's results object, verbatim. It carries `summary` and
`specs[].tests[].contexts[].steps[]`. A script written against Doc Detective's
report already reads it. A manni envelope would make that script learn a
second shape for the same data.

**Progress.** `--progress` streams Doc Detective's own log to stderr as it
runs. That is the default on a terminal. `--no-progress` captures the log and
shows its tail only on exit `2`. Either way stdout stays clean for `-f json`.

### 8. Exit codes and messages

`0` means nothing failed. `WARNING` and `SKIPPED` pass, as they do in Doc
Detective. `1` means a spec, test, context or step failed, and the findings go
to stdout.
Every case below is `2`, on stderr, prefixed `manni: `.

| When | Message |
|---|---|
| `doc-detective` is not on PATH | `doc-detective is not on PATH. Install Doc Detective (npm install -g doc-detective) to run doc tests.` |
| no paths and no Doc Detective config | `test run needs paths or a Doc Detective config. Pass paths, or add .doc-detective.json.` |
| a positional path does not exist | meta's `File not found: "<path>".` |
| the positional paths match no files | `No files matched. Patterns tried: "<path>". Pass --allow-empty if that is expected.` |
| `-` given | `test run reads files; Doc Detective has no stdin. Pass a path.` |
| `--collection` with paths | `--collection selects a configured collection; it cannot be combined with paths.` |
| `--collection` with no manni config | `--collection needs a config file to select from.` |
| an unknown collection | the shared `no collection named "x" in <source>. Configured: site.` |
| collections match no files | `--collection matched no files. Pass --allow-empty if that is expected.` |
| the configured file is missing | `<source>: tools.doc-detective.config "<path>" does not exist.` |
| a bad key shape | `tools.doc-detective.config must be a non-empty string.` |
| Doc Detective exits non-zero | `Doc Detective failed (exit <n>):`, then the tail of its output |
| no results file, or one that does not parse | `Doc Detective wrote no results to read. Run doc-detective directly to see why.` |
| the results hold `null`, or zero tests | `Doc Detective found no tests in the inputs. Pass --allow-empty if that is expected.` |
| the inputs pass the command-line ceiling | `the selected inputs exceed the command-line limit. Narrow the collection, or set input in the Doc Detective config.` |
| a bad `--format` | `Unknown --format "x". Use pretty \| json \| github.` |

`--allow-empty` turns both "no tests" and "no files" into exit `0`.

### 9. The Windows command-line ceiling

A collection can expand to many files, and every file is one more input on
Doc Detective's command line. On Windows, `cmd.exe` caps a `.cmd` shim's
command line at 8191 characters. That is about 150 paths relative to the
working directory, which is roughly this repository's `site` collection.

So on Windows manni runs Doc Detective's bin script with `node` directly,
bypassing the shim. That raises the cap to the process limit of about 32,000
characters. Past it, the run stops with the message in section 8. Running in
batches and merging the results files would remove the cap, and nothing needs
that yet.

### 10. The docs-as-tests workflow runs the command

`.github/workflows/docs-as-tests.yml` drops the `doc-detective/github-action`
step. In its place:

```yaml
- run: npm install -g doc-detective
- name: Run the docs' tests
  run: manni test run -f github --progress
```

The run reads `.doc-detective.json` at the repository root. A failing step now
annotates its page, and the job log still streams live.

The supply-chain cost is real. The Action was pinned to a full commit SHA, and
dependabot proposed each bump as a reviewable diff. That review is gone. A
new Doc Detective release now reaches the runner on the next run, with no diff
for anyone to read.

The cost is smaller than it looks, for three reasons.

- The pin fixed only the Action's wrapper. The Action's `version` input
  defaults to `latest`, so Doc Detective itself was never pinned.
- The job runs only for same-repository pull requests and manual dispatch. It
  holds `contents: read` and no secret.
- The repository's own rule is to default to latest and not to hand-pin a
  version. An unpinned install is that rule applied.

## Known limits

- **A path containing a comma breaks the input list.** `-i` takes one
  comma-joined list, and Doc Detective splits it with no escape. Such a path
  is rare in a docs tree, and nothing guards against it yet.
- **The json format moves with Doc Detective.** It is Doc Detective's report
  verbatim, and CI installs the latest release. A major release that reshapes
  the report reshapes `manni test run -f json` with it.
- **One run is one Doc Detective invocation.** The command-line ceiling in
  section 9 is the limit, not the size of the docset.

## What was rejected

| Option | Verdict |
|---|---|
| A manni JSON envelope | Rejected. It renames data a script can already read, and every Doc Detective release would need a matching manni change. |
| `junit` and `sarif` now | Deferred. Doc Detective has its own `junit` reporter, and no one has asked for either through manni. |
| An `npx doc-detective` fallback | Rejected. A run that silently downloads a tool makes the install step invisible, which is the pain this proposal removes. |
| Passing Doc Detective's flags through | Rejected for now. `--test`, `--spec` and `--logLevel` would make Doc Detective's CLI part of manni's. Each is easy to add when asked. |
| Reading every collection on a bare run | Rejected. Section 4 gives the reasons. |
| A `test:` config section | Rejected. The domain has no settings of its own to put there. |
| A family `manni tools` command now | Deferred until a fourth outside tool lands. Three tools under `tools:` do not yet need an inventory verb. |

## Stress test

### 1. Why not trust Doc Detective's exit code with `-e`?

`-e` makes a failing test exit non-zero, and a crash exits non-zero too. The
two would share one code. The family separates them, because exit `1` is the
author's problem and exit `2` is Devin's. Only the results file tells them
apart.

### 2. Why is a results file holding `null` an error?

Because it means nothing ran. A gate that passes when it tested nothing is
worse than no gate, since it reads as coverage. `--allow-empty` exists for the
repository that expects an empty run.

### 3. D14 pins every third-party action. Does this break that promise?

D14 is about the tracevals recipe, and its rule covers actions. This workflow
now uses no third-party action for Doc Detective. The package itself was never
pinned, as section 10 records. A team that wants it pinned can install
`doc-detective@<version>` in its own recipe.

### 4. Why `test` and not `docs-as-tests` or `doc-detective`?

A domain named after the tool would need renaming when a second tool arrives.
That is 0050's argument against `manni lint vale`. *test* is the job, and it is
the word a person reaches for.

### 5. Does `manni test run` with no config fail in a repository that has tests?

Only if Doc Detective's config is absent too. Doc Detective's own discovery
still runs, so a repository with `.doc-detective.json` in the working
directory needs no manni config at all.

## Open questions

- Should a run guard against a comma in an input path, or batch such paths
  into their own invocation?
- Should the json format record the Doc Detective version that wrote it, so a
  consumer can tell a reshaped report from a broken one?
- When does batching past the command-line ceiling earn its code?
- What is the second test tool, and does its arrival bring `--tool` to `run`?
- When a fourth outside tool lands, does `manni tools` inventory all of them,
  as `manni lint tools` does for one domain?

## Consequences

- Good, because every gate in this repository is now a `manni` command, with
  one exit code contract and one annotation format.
- Good, because a missing input path and an empty run both fail loudly.
- Good, because Maya sees the failing page and line instead of a log.
- Bad, because the docs-as-tests workflow loses the dependabot review of its
  Doc Detective step.
- Bad, because `-f json` inherits Doc Detective's schema and its changes.
- CUJ D17 joins Devin's journeys, and the site gains a `test/` section with an
  overview and a CLI reference.
