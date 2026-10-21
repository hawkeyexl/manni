# 0093: Rot forecast, a review queue ordered by expected drift

- **Status:** Rejected
- **Recommendation:** Do not build. The backtest below found no lift over
  ordering by file churn, and the probabilities were worse than a constant.
- **Serves:** Two journeys, if it worked.
  - Maya · M5, "Pin a claim and catch it going stale". She would review the
    pins most likely to go stale first, before `check` fails on them.
  - Devin · D5, "Gate citations in CI without blocking on prose". His
    scheduled sweep would print a ranked queue beside the findings.
- **Depends on:** [0044](0044-citations-and-drift.md) for the pin and its
  classifier, and [0034](0034-command-grammar.md) for where a verb lives.
- **Related:** 0092, "the lie window", reads pin history in cite too. The
  machinery the two would share is named under "Shared with 0092". The two
  proposals stay separate.
- **Touches, if built:** `src/cite/core/git.ts`,
  `src/cite/core/range-history.ts`, `src/cite/commands/forecast.ts`,
  `src/cite/reporters/`, `src/cite/core/config.ts`, `src/cite/cli.ts`,
  `docs/src/content/docs/cite/reference/cli.mdx`,
  `docs/src/content/docs/cite/reference/configuration.mdx`
- **Backtest:** Run at `26dad159`. The method and the numbers are below.

## Problem

`manni cite check` says which pins drifted. It says nothing about which pins
will drift next. A reviewer with an hour and four thousand citations has no
order to work in.

The idea is to learn from git how often each pinned source range changes. Each
pin then gets a predicted half-life, or a probability of drifting within N
days. A reviewer works down that list.

The idea rests on one assumption. The past rate at which a range changed must
predict whether it changes next. It must do so better than something cheaper,
such as how busy the whole file is. This proposal tested that assumption
before designing anything around it.

## The backtest

### Method

This repository pins its own docs to its own sources. The first pins landed on
2026-09-17 in #59, so there are 33 days of pin history.

1. Cutoffs fall every 3 days from 2026-09-18 to 2026-10-12. Each cutoff is
   the last commit on main's first-parent line at or before that day.
2. At each cutoff, the backtest reads every pin from `site.metadata.yaml` and
   every `*.citations.yaml` as they stood then. Pins that share a file, a
   hash and a length count as one source range. A range enters the test only
   if its pin holds at the cutoff.
3. For each range it reads `git log -L <start>,<end>:<file>` at the cutoff,
   and `git log -- <file>`. Both give committer times.
4. A range **drifted** when its exact lines appear nowhere in the file N days
   later, or the file is gone. That is `check`'s `changed` or `missing`. A
   move within the file is not drift. N is 7 and 14 days.
5. Each ordering ranks the ranges at one cutoff. The score is computed per
   cutoff, then averaged with each cutoff weighted by its drift count. A
   pooled score would mix busy weeks with quiet ones and flatter every model.

The orderings tested:

| Ordering | Score per range |
|---|---|
| Range rate, 30-day decay (the idea) | Each commit that touched the range adds `exp(-age/30)`, ages in days from the cutoff, divided by 30. |
| Range rate, creation dropped | The same, without the commit that wrote the lines. |
| Range rate, 7-day and 90-day decay | The first row with another decay constant. |
| File rate, 30-day decay | The first row over every commit to the file. |
| File churn (the baseline) | Commits to the file in the 90 days before the cutoff. No decay. |
| Random | 50 shuffles per cutoff. |

Three measures were read.

- **AUC.** The chance that a range that drifted ranks above one that did not.
  Random scores 0.5.
- **Caught in the top 20%.** The share of drifted ranges in the first fifth of
  the queue. Ties are split evenly. Random scores 0.2.
- **Brier score.** The mean squared error of the probability `1 - exp(-rate·N)`
  against what happened. The bar is a constant forecast of the base rate.

### Numbers

The sample is smaller than the row count suggests. At N = 7 there are 22,922
range-cutoff rows and 787 drifted ones. Those 787 come from 178 drift events,
where an event is one file at one cutoff, across 76 files. One commit to
`src/shared/config-file.ts` drifts dozens of ranges at once. The cutoffs also
overlap, so the same week counts more than once. The rows marked
"non-overlapping" keep cutoffs whose windows do not share a day.

All cutoffs:

| Ordering | AUC, 7 days | Top 20%, 7 days | AUC, 14 days | Top 20%, 14 days | Beats file churn |
|---|---|---|---|---|---|
| Range rate, 30-day decay | 0.547 | 0.266 | 0.550 | 0.289 | 4 of 8, 1 of 7 |
| Range rate, creation dropped | 0.570 | 0.311 | 0.584 | 0.330 | 5 of 8, 4 of 7 |
| Range rate, 7-day decay | 0.543 | 0.205 | 0.541 | 0.213 | 4 of 8, 1 of 7 |
| Range rate, 90-day decay | 0.568 | 0.282 | 0.573 | 0.305 | 5 of 8, 4 of 7 |
| File rate, 30-day decay | 0.587 | 0.242 | 0.587 | 0.224 | 4 of 8, 2 of 7 |
| **File churn, 90 days** | **0.588** | **0.253** | **0.590** | **0.238** | baseline |
| Random | 0.500 | 0.199 | 0.500 | 0.202 | 0 of 8, 0 of 7 |

Non-overlapping cutoffs only, at 7 days (2026-09-18, 09-27 and 10-06, 64
drift events):

| Ordering | AUC | Top 20% |
|---|---|---|
| Range rate, 30-day decay | 0.514 | 0.235 |
| Range rate, creation dropped | 0.573 | 0.301 |
| File churn, 90 days | 0.615 | 0.286 |
| Random | 0.495 | 0.197 |

Calibration at 7 days, against an observed drift rate of 0.034:

| Forecast | Mean predicted | Brier | Constant base rate |
|---|---|---|---|
| Range rate, 30-day decay | 0.140 | 0.0484 | 0.0332 |
| Range rate, creation dropped | 0.040 | 0.0389 | 0.0332 |

At 14 days the pattern holds. The first forecast predicts 0.271 against an
observed 0.072, and both Brier scores lose to the constant.

Three quarters of the ranges, 75.2%, have no commit after the one that wrote
them. Their drift rate is 3.0%, against 4.7% for the rest. So the range's own
history is empty for most pins, and empty history does not mean safe.

### Verdict

**The forecast does not beat the naive baseline.** Ordering by how often the
whole file changed ranks drift better than any per-range model tested. At 7
days, file churn scores an AUC of 0.588. The range rate scores 0.547. The gap
widens on the independent cutoffs, where file churn scores 0.615 and the range
rate 0.514.

The best variant drops the commit that wrote the lines. It edges ahead on the
top 20% of the queue, 0.311 against 0.253. It still loses on AUC overall. It
was also picked after the results were in, so its edge is the one most likely
to be noise.

As a probability, the forecast is worse than no forecast. Every variant's Brier
score loses to a constant guess of the base rate. The 30-day model predicts
four times the drift that happened. Printing "41% within 30 days" would
mislead the reviewer it is meant to help.

File churn itself is weak. An AUC near 0.59 moves a reviewer little, and `git
log` already answers it. Neither ordering earns a verb.

The test has limits. The repository is four months old, its pins are 33 days
old, and it changes fast. A mature codebase with slow, uneven churn could
behave differently. "Revisit when" states what evidence would reopen this.

## Decision

**Recommendation: do not build.** Mark this proposal `Rejected` and keep the
backtest beside it.

The rest of this section records the design that would ship if the
recommendation is overruled. It shows the full interface, so a reviewer
overruling it knows exactly what they approve.

### The home is `manni cite`

The forecast belongs to cite, under 0034's rule that a verb lives in the
domain that owns its object. The object is a pin, and cite owns pins.

- Cite already reads each pin and finds its lines today. The forecast reads
  the history of those lines, and only a pin that is current has lines to
  read.
- Cite already reads history per pin. `historyOf` reads the file at the pin's
  commit, and `changed` carries the commits since.
- Graph's history is the wrong grain. `src/graph/core/git.ts` collects one
  record per page file. It holds creation and modification dates, authors and
  renames, with no per-commit times and no line ranges. Source files are not
  graph nodes at all.
- A graph property would also change a graph's meaning. Graph output is
  deterministic per commit and states facts. A forecast is a guess with a
  horizon.

### The forecast is its own verb

The forecast is `manni cite forecast`. It is not a field in `check -f json`,
and not a graph property.

- `check` is a gate with an exit-code contract. A forecast is never a
  finding, so it never fails a run. Mixing it into findings blurs what is
  with what might be.
- The forecast costs one `git log -L` per range. One call took about 90 ms
  here, so this repository's 2,917 ranges take minutes. `check` runs on every
  push, and should not pay that.
- A verb takes `-f json` like every other cite verb. A script that wants the
  queue reads it there.

### The model

The model is the one the backtest measured as "creation dropped".

1. Classify each citation as `check` does. Only a source that is `current`
   gets a forecast. Every other citation is listed as skipped, with its status.
2. Read `git log -L <start>,<end>:<path> HEAD` for the lines as they stand.
   Drop the oldest commit, the one that wrote the lines.
3. The rate is the sum of `exp(-age/30)` over the remaining commits, divided
   by 30. Age is in days from HEAD's committer time, never the wall clock. So
   one commit gives one forecast.
4. The probability of drifting within the horizon is `1 - exp(-rate·horizon)`.
   The half-life is `ln 2 / rate`, in days. A range with no touches has rate 0,
   probability 0 and no half-life.
5. The queue sorts by probability, highest first, then by `src`.

A whole-file pin reads `git log -- <path>` instead. An encrypted source is
decrypted with the family key to read its history, and printed as the page
wrote it.

### Shared with 0092

0092 asks how long a claim stayed false. It needs the first commit after a
pin's commit that changed the pinned lines. This proposal needs every commit
that changed them before HEAD. Both read the same thing, and would share
these pieces.

- **`rangeLog` on cite's `GitClient`.** One call,
  `git log -L <start>,<end>:<path> <rev> --format=%H %ct`, memoized per
  revision, path and range like every other client call. It returns commits
  newest first, each with its committer time.
- **`src/cite/core/range-history.ts`.** It turns a pin into the range to read,
  using the lines `check` resolved, and calls `rangeLog`. 0092 reads it forward
  from the pin's commit. 0093 reads it back from HEAD.
- **The shallow-clone rule.** Both need full history, and both stop with the
  same message when it is missing.

Whichever proposal lands first adds them. If this one is rejected, 0092 owns
them.

## Interface

### Configuration

Before:

```yaml
cite:
  root: ../code
  baseline: .manni-cite-baseline.json
  checkSources: true
  severity:
    source-moved: warning
```

After:

```yaml
cite:
  root: ../code
  baseline: .manni-cite-baseline.json
  checkSources: true
  severity:
    source-moved: warning
  forecastHorizon: 30
```

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `cite.forecastHorizon` | integer, 1 to 3650 | `30` | no | The days the probability looks ahead. `--horizon` overrides it. Only `forecast` reads it. |

The decay constant is fixed at 30 days and has no key. The backtest found no
constant that helped, so a knob would only invite tuning to noise.

### Command

`manni cite forecast [paths...]` prints every pinned source range as a review
queue, most likely to drift first.

| Argument or option | What it does |
|---|---|
| `[paths...]` | Files, directories and globs, space-separated. `-` reads stdin, beside any paths. With none, the configured collections are the fallback. |
| `--collection <name>` | A configured collection to forecast. Repeatable, one name per occurrence. |
| `--ext <list>` | Extensions for directory walks, comma-separated, given once. |
| `--exclude <glob>` | A glob to exclude. Repeatable, one glob per occurrence. |
| `--as <format>` | Forces an input format for every input. Required with `-`. |
| `--horizon <days>` | Days the probability looks ahead, 1 to 3650. Default `cite.forecastHorizon`, else 30. |
| `-f, --format <format>` | `pretty` (default) or `json`. |
| `-c, --config <path>` | A manni config file. |
| `--no-config` | Ignores any discovered config file. |
| `--allow-empty` | Treats zero matched files as success. |
| `--no-gitignore` | Forecasts files `.gitignore` covers. |
| `--root <dir>` | The directory source paths resolve from, as `check` has it. |

Exit codes: `0` when the forecast ran, whatever it predicts. `2` for an
operational or usage error. There is no `1`, because a forecast is not a
finding.

### Ladder

The output below is illustrative. Its numbers show the shape, not a run.

1. The minimum, with the collections from config.

   ```console
   $ manni cite forecast
   Rot forecast at 26dad159, 30 days ahead. 2,917 ranges from 4,188 citations.

     P(30d)  half-life  touches  last touched  source
     0.62    22d        3        2026-10-11    src/shared/config-file.ts:120-131
             docs/src/content/docs/meta/reference/configuration.mdx  config-one-file
     0.48    32d        2        2026-10-08    src/cite/schema/citations.json:14-30
             docs/src/content/docs/cite/reference/citations.mdx  entry-shape
     ...
     0.00    none       0        2026-09-17    src/a11y/core/crawl.ts:204-205
             docs/src/content/docs/a11y/ci/index.mdx  unready-seed-exit-2

   2,190 ranges have not changed since their lines were written.
   $ echo $?
   0
   ```

2. One page, a shorter horizon.

   ```console
   $ manni cite forecast docs/src/content/docs/a11y/ci/index.mdx --horizon 7
   Rot forecast at 26dad159, 7 days ahead. 9 ranges from 11 citations.
   ...
   ```

3. One collection, for a script.

   ```console
   $ manni cite forecast --collection guides -f json | jq '.ranges[:5]'
   ```

4. With citations that are not current. The skipped ones go to stderr once.

   ```console
   $ manni cite forecast docs/
   ...
   manni: 3 citations have no forecast because their source is not current. Run manni cite check.
   $ echo $?
   0
   ```

5. Everything at once.

   ```console
   $ cat page.md | manni cite forecast docs/ - --as markdown --ext md,mdx \
       --exclude 'docs/**/drafts/**' --exclude 'docs/archive/**' --horizon 90 \
       -f json -c ci/manni.config.yaml --no-gitignore --allow-empty --root ../code
   ```

6. Usage errors, each on stderr with exit `2`.

   ```console
   $ manni cite forecast --horizon soon
   manni: --horizon must be a whole number of days from 1 to 3650; got "soon".
   $ manni cite forecast -f sarif
   manni: Unknown --format "sarif". Use pretty or json.
   $ manni cite forecast --collection guides docs/
   manni: --collection selects a configured collection; it cannot be combined with paths.
   $ manni cite forecast --no-config
   manni: No files to forecast. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.
   $ manni cite forecast -
   manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.
   ```

### Messages

| Message on stderr, after `manni: ` | Exit |
|---|---|
| `--horizon must be a whole number of days from 1 to 3650; got "<value>".` | 2 |
| `cite.forecastHorizon in <config> must be a whole number of days from 1 to 3650.` | 2 |
| `Unknown --format "<value>". Use pretty or json.` | 2 |
| `git is not available here; a forecast reads the history of each source.` | 2 |
| `this clone is shallow, so the history a forecast reads is cut short. Fetch full history, for example with fetch-depth: 0.` | 2 |
| `forecast needs the sources: drop --no-check-sources (or `checkSources: false`).` | 2 |
| `No files to forecast. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.` | 2 |
| `No files matched. Patterns tried: <patterns>.` | 2 |
| `--collection selects a configured collection; it cannot be combined with paths.` | 2 |
| `Reading from stdin (`-`) requires --as <format> to choose an extractor.` | 2 |
| `<n> citations have no forecast because their source is not current. Run manni cite check.` | 0, a notice |
| `<n> citations have no forecast because their source is encrypted and no key is set. Run manni key set.` | 0, a notice |
| `<n> citations have no forecast because their source has uncommitted changes.` | 0, a notice |

The five rows above the notices are `check`'s messages today, with
`forecast` as the verb where the verb appears.

### Output shapes

Pretty output goes to stdout. A header line names the commit, the horizon and
the counts. Each range takes one line, with its citations indented below by
page and id. A closing line counts the ranges with no touches. Color follows
the family rule, and only the probability column is colored.

JSON output is one object.

```json
{
  "summary": {
    "commitSha": "26dad1590c8d1f4b2a6e0e7d9b1c3f5a7e9d2b4c",
    "asOf": "2026-10-20T20:35:47Z",
    "horizonDays": 30,
    "ranges": 2917,
    "citations": 4188,
    "untouched": 2190,
    "skipped": 3
  },
  "ranges": [
    {
      "src": "src/shared/config-file.ts:120-131",
      "probability": 0.62,
      "halfLifeDays": 22.4,
      "touches": 3,
      "lastTouched": "2026-10-11T17:02:11Z",
      "citations": [
        {
          "id": "config-one-file",
          "origin": { "kind": "manifest", "file": "docs/src/content/docs/meta/reference/configuration.citations.yaml", "line": 12 }
        }
      ]
    }
  ],
  "skipped": [
    {
      "src": "src/cite/core/sidecar.ts:40-52",
      "reason": "source-changed",
      "citations": [
        {
          "id": "sidecar-one-value",
          "origin": { "kind": "manifest", "file": "docs/src/content/docs/cite/set-up/citations-in-a-sidecar.citations.yaml", "line": 4 }
        }
      ]
    }
  ]
}
```

- `src` is the source as the page wrote it. An encrypted path stays encrypted.
- `probability` is rounded to two places. `halfLifeDays` is rounded to one,
  and is `null` when `touches` is 0.
- `touches` counts the commits after the one that wrote the lines.
  `lastTouched` is the newest of all of them, the writing commit included.
- `reason` is a source status from `check`, or `encrypted` or `uncommitted`.
- `origin` has the shape `check -f json` prints.

### Programmatic API

| Export | Change |
|---|---|
| `forecastCitations` | Added. The command core behind `manni cite forecast`. |
| `ForecastRun`, `ForecastRange` | Added. The JSON shape above, as types. |

## What was rejected

- **Building it anyway, as a ranking without probabilities.** The ranking lost
  to file churn too. Dropping the numbers would hide the miscalibration, but
  not fix the order.
- **Shipping file churn as the queue.** It won the backtest, with an AUC near
  0.59. That is too weak to steer a reviewer, and `git log --since` answers it
  already.
- **A field in `check -f json`.** `check` is the gate. It would pay the cost
  of history on every push for a number no gate reads.
- **A graph property.** Graph's history is per page file and holds no line
  ranges. A forecast is a guess, and graph output states facts.
- **A configurable decay constant.** No constant from 7 to 90 days beat the
  baseline. A key would invite tuning to noise.
- **A fitted model, such as logistic regression on range and file features.**
  The brief ruled out ML dependencies. With 64 independent drift events, a
  fitted model would overfit this repository anyway.

## Stress test

### 1. Is the drift label what `check` reports? (nearly)

The label is "the exact lines appear nowhere in the file". That matches
`changed` and `missing`. A rename that 0055 follows across files counts as
drift here, which overstates drift slightly. The backtest did not separate
renames out, and they count against every ordering alike.

### 2. Does the docs gate hide drift? (no)

`cite check` gates the docs, so a pull request that changes cited lines
re-mints the pin in the same change. The backtest reads source content, not
pins. A range counts as drifted when its lines changed, whether or not someone
re-minted it later.

### 3. Do the overlapping windows inflate the result? (they flatter the idea)

They count busy weeks more than once. The non-overlapping rows remove that,
and the range rate does worse there, 0.514 against 0.615. The overlap helped
the idea, not the baseline.

### 4. Was the baseline chosen to win? (no)

File churn over 90 days was named before any run. The variant that came
closest to it was found afterwards, and is labelled as such.

### 5. Would a longer history change the verdict? (possibly)

Three quarters of the ranges had no history beyond their creation. A range
needs past changes before its own rate means anything. An older repository
gives the range model more to read. That is the one real reason to revisit.

## Consequences

- Good, because no verb ships that would rank pins worse than `git log`
  ranks files.
- Good, because the method and the numbers are written down here. The question
  can be asked again on another repository by repeating the backtest.
- Good, because the machinery 0092 needs is named, and 0092 is not blocked on
  this proposal.
- Bad, because a reviewer facing thousands of pins still has no order to work
  in. `check` failing remains the only signal.

## Revisit when

Repeat the backtest on a repository with at least six months of pin history.
Write down the model before the run. Build it only if all three hold.

- Its drift-weighted AUC beats file churn on at least two thirds of the
  non-overlapping cutoffs.
- Its top 20% catches more drift than file churn's does.
- Its Brier score beats a constant forecast of the base rate.

## Acceptance checklist

This list applies only if the recommendation is overruled and the design is
built.

- [ ] `src/cite/core/range-history.ts` exists, and `GitClient` has a memoized
      `rangeLog` that returns commits newest first with committer times.
- [ ] `src/cite/commands/forecast.ts` holds the command core, free of CLI and
      IO plumbing, and `src/index.ts` exports `forecastCitations`,
      `ForecastRun` and `ForecastRange`.
- [ ] `manni cite forecast` with a configured collection prints the pretty
      queue, sorted by probability then `src`, and exits 0.
- [ ] `manni cite forecast -f json` prints the object under "Output shapes"
      and exits 0.
- [ ] `--horizon 7` changes every `probability` and leaves the order alone.
      `cite.forecastHorizon` sets the default, and the flag overrides it.
- [ ] `--horizon soon`, `--horizon 0` and `--horizon 3651` each exit 2 with the
      message in the table.
- [ ] `-f sarif` exits 2 with `Unknown --format "sarif". Use pretty or json.`
- [ ] A clone without git, and a shallow clone, each exit 2 with their message.
- [ ] A citation whose source is not current is listed under `skipped` with
      its status, the notice prints once, and the exit stays 0.
- [ ] An encrypted source without a key is skipped as `encrypted`, and its
      path never appears decrypted in any output.
- [ ] A range with no touches after its creation prints probability 0 and
      `halfLifeDays: null`.
- [ ] Two runs at the same commit print identical output, whatever the wall
      clock says.
- [ ] Positional paths, `-` with `--as`, `--collection`, `--ext`, `--exclude`,
      `-c`, `--no-config`, `--allow-empty`, `--no-gitignore` and `--root`
      behave as they do on `check`.
- [ ] Fixtures under `test/fixtures/cite/forecast/` hold a small git history.
      Unit tests pin the rate, the probability, the half-life and the sort.
- [ ] `test/cli.integration.test.ts` runs `forecast` against the built bin.
- [ ] `docs/src/content/docs/cite/reference/cli.mdx` documents `forecast`,
      and `npm run docs:check-cli` verifies it.
- [ ] `docs/src/content/docs/cite/reference/configuration.mdx` lists
      `forecastHorizon`.
- [ ] This proposal's `Status:` reads `Implemented (#NNN)`, and the README
      row matches.
- [ ] A demo video for the `feat:` is in `media/`, per CLAUDE.md.
