# 0092: How long a pin stood stale, and which releases shipped it

- **Status:** Proposed
- **Serves:** Two people.
  - Devin · D5, "Gate citations in CI without blocking on prose". His ramp-in
    runs the PR job with `--baseline`, so known stale pins stay on main by
    policy. Nothing tells him how old that debt is.
  - Maya · M5, "Pin a claim and catch it going stale". She catches a stale pin
    today. She cannot say how long readers saw it, or in which releases.
  - This proposal adds D18, "Put a number on how long the docs were wrong".
- **Depends on:** Three proposals.
  - [0044](0044-citations-and-drift.md) defined the pin and classifies it from
    git alone, with no model and no network.
  - [0055](0055-following-a-source.md) taught the classifier to follow a
    source across files. A moved pin is not a stale one.
  - [0034](0034-command-grammar.md) is the grammar a new verb has to fit.
- **Relates to:** [0093](0093-rot-forecast.md), the rot forecast. It reads the
  same pin history forward, to say which pins are likely to go stale next.
  This proposal reads it backward. The section on shared machinery names what
  the two build once.
- **Touches:** `src/cite/core/` (a new `timeline.ts`, `git.ts`, `classify.ts`,
  `sources.ts`), `src/cite/commands/history.ts`, `src/cite/cli.ts`,
  `src/cite/reporters/`, `test/cite/`, `scripts/check-cli-reference.mjs`,
  `docs/src/content/docs/cite/`, `docs/content-strategy/cujs.md`
- **Verdict:** `manni cite history` walks the git history and reports each
  stale window: the span of commits in which a pin no longer held anywhere.
  It names the releases that shipped inside each window and totals the time.
  It is a report, not a gate, so it exits `0` whatever it finds.

## Problem

`manni cite check` answers one question. Does each pin hold at `HEAD`? It
cannot say how long a pin had been failing, or what shipped meanwhile.

That second question is the one a docs owner gets asked. A reader filed a bug
against the 4.6.0 docs. Was the page already wrong in 4.2.0? How much of the
docset was unverified at the last release? Today the answer means bisecting by
hand, one `git checkout` and one `cite check` at a time.

Call the span the lie window. It opens at the first commit where a pin stops
holding anywhere in its source. It closes at the commit that re-pinned the
entry, restored the source, or removed the entry. The releases tagged inside
it shipped the stale page. The sum of all windows is the docset's truth debt,
as a number of pin-days.

"Lie" overstates it, and the proposal keeps the word out of the interface. A
pin that stops holding is unverified, not necessarily false. The window is an
upper bound on how long the page was wrong. Stress test 1 says why the bound
is the useful number.

## Evidence

This repository pins its own docs to its own sources. A throwaway script,
[`0092/lie-window.mjs`](0092/lie-window.mjs), walked that history to test the
core assumption. Run it from an empty directory as
`node lie-window.mjs <repo> ac22639ef`. It writes `windows.json`, `cf.json`
and `naive.json` there.

### Method

The walk read every first-parent commit of `main` from #59, which added the
first pins, to `HEAD`. That is 137 commits over 33 days, 2026-09-17 to
2026-10-20. At each commit it read the citation entries from where they lived
then. Before #118 that was one root `site.metadata.yaml`. After it, one
`{page}.citations.yaml` beside each page.

Each entry was classified against the source as it stood at that commit. The
rules were the classifier's own. A pin that hashes equal at its lines is
current. One that hashes equal elsewhere in the file has moved. One found
nowhere is stale. A pin is identified by its page and entry id. Its state is
the triple of file, lines and integrity. The recorded `commit-sha` was never
read.

### What shipped on main

| Measure | Value |
|---|---|
| Citations seen across the history | 4,549 |
| Distinct pin states | 8,667 |
| Stale windows on `main` | 11 |
| Windows that a naive rule would count, hash at the recorded lines only | 29, on 27 pins |
| Longest window | 44 minutes 35 seconds, 2 commits |
| Releases that shipped a stale pin | 1, v2.3.9 |
| Windows since the docs gate landed in #76 | 0, over 106 commits and 45 releases |

All 11 windows came from one event, a worked example below. The naive rule's
18 extra windows were moves. Each was a source that shifted lines and kept its
text, and a re-pin followed within two commits. Counting them would
treat a layout change as a lie.

### What the gate prevented

The gate hides the rate at which pins break, because each pull request
re-pins before it merges. A second pass measured that rate. It asked when
each pin state, as first minted, would have stopped holding if nobody had
re-pinned it.

| Measure | Value |
|---|---|
| Pin states that would have gone stale | 1,202 of 8,667, or 13.9% |
| Source text changed | 1,171 |
| Whitespace-only change | 11 |
| Source file gone, not followed to another file | 20 |
| Time to stale, 10th percentile | 0.23 days |
| Time to stale, median | 7.42 days, 37 commits |
| Time to stale, 90th percentile | 30.33 days, 114 commits |
| Longest, censored by a 33-day history | 32.96 days |

| Time to stale | Pin states |
|---|---|
| Under 1 day | 259 |
| 1 to 7 days | 282 |
| 7 to 30 days | 492 |
| 30 days or more | 169 |

Three commits broke 552 of them. They were #206, 0089's findings work, with
266. Then #129, the vocabularies at 1.0.0, with 190, and #111, the
cross-file follow, with 96. Each re-pinned inside its own squash merge, so
none reached `main` stale.

### Is a hash change enough?

The script asked how many of the 1,202 breaks a filter could have excused. A
whitespace-blind comparison excused 11 of them, or 0.9%.

A comment-blind comparison needs to know where the old text sits now. The
test bracketed it by the old first and last line, each found exactly once.
That located 224 of the remaining 1,171. Of those, 6 changed only comments, 143 grew
around the cited text, and 75 were edited. The other 947 could not be located
at all. Most pins are one to three lines, and lines such as `}` repeat.

A deterministic filter therefore reaches about one break in five, and excuses
about one in a hundred. The sampled diffs showed why the rest resist it. A
message string gains a sentence the docs quote. A function gains an argument
the docs describe. A signature goes from `async` to sync. Each is a real change
to the cited behavior, and no rule short of reading the prose tells them apart.

### History rewrites and orphaned commits

The recorded `commit-sha` is unusable as a window's start. Across the history,
190 distinct commits were recorded. Of those, 149 are not reachable from
`HEAD`, and 7,466 of the 8,667 pin states recorded one. A squash merge does
this every time. The branch commit a pin was minted at is never on `main`.

#200 re-recorded 826 SHAs that a rewrite of `main` had orphaned, and #122 did
the same earlier. Neither changed a line or a hash, so the walk saw neither as
an event. It happens again at `HEAD` today. The pin on
`meta/reference/action.mdx` at `.github/workflows/release.yml:367-372`
records `d8a6f25`, which `main` never took.

### Worked examples

**#61, the one real window.** #61 changed `resolveCiteRun` in
`src/cite/core/config.ts`, at lines 308 to 313. It altered the rule for when a
run falls back to a collection's `paths:`. Eleven pins on seven pages cited
those lines, among them `named-paths-win` and `bare-check-covers-collections`
on the cite set-up page. The window opened at `541b63e`, 20:19:46 UTC. The
release job tagged v2.3.9 at 20:30:45. #75, "re-pin the citations that #60
and #61 moved", closed it at 21:04:21. So v2.3.9 shipped eleven stale pins for
44 minutes. That is 8.2 pin-hours of truth debt, the whole debt this history
holds. #76 gated the docs on `cite check` the same afternoon.

**A move, not a window.** The same #61 pushed 14 more pins on `config.ts` a
few lines down. Each hashed equal at its new place, so the classifier called
it moved. The release commits for 2.8.4 and 2.8.5 did the same to four pins on
`CHANGELOG.md`, by adding entries above them. The naive rule opened a window
for each of these 18. The walk opened none.

**A whitespace-only break.** #157 changed only whitespace in the lines of
`src/a11y/core/analyzer.ts` that four pins cite, among them
`tags-restrict-axe-rules` and `json-passes`. Each stopped hashing and kept
every word. In an ungated repo each would open a window. The proposal counts it, and
the section on cosmetic changes says why.

**A comment-only break.** #68 rewrote a comment inside
`src/cite/core/severity.ts:8-22`, which `marker-edit-claim-changed` cites on
the cite overview. The code it describes did not change.

### What the evidence says

The assumption holds where it matters, and the number is small where it is
gated. A gated repo with squash merges keeps its windows near zero. This one
held 8.2 pin-hours in 33 days, all before the gate. The number earns its keep
in three places. One is a repo that has not gated yet. Another is a repo
ramping in with `--baseline`, whose baselined pins are open windows by
policy. The last is a release branch nobody runs the gate on.

The counterfactual sizes the risk without the gate. One pin state in seven
broke within 33 days, and half of those within a week.

## Decision

### 1. What a window is

A **window** belongs to one citation, named by its page and entry id. It is a
run of consecutive first-parent commits at which the citation's source pin
does not hold.

| Event | Rule |
|---|---|
| Opens | The first commit at which the source end classifies as `source-changed`, `source-missing` or `source-never-true`. |
| Stays open | Every later commit where it still classifies so, whether or not the entry changed. |
| Closes, `re-pinned` | The first commit where the pin holds again because the entry's file, lines or integrity changed. |
| Closes, `source-restored` | The first commit where the pin holds again with the entry unchanged. |
| Closes, `removed` | The first commit where the entry, or its page, is gone. |
| Open | No closing commit before `HEAD`. |

The classification at a commit is the one `cite check` would have printed
there. That includes the move search and the cross-file follow from 0055. A
`source-moved` or `source-moved-ambiguous` pin is supported somewhere, so it
never opens a window.

The claim end never opens or closes one. A rewritten sentence over an
unrepinned source still fails `cite check`, so the window stays open until the
source end holds.

The `commit-sha` an entry records is never read. A change to it alone is no
event.

Each commit is read as it stood. Its `manni.config.yaml` decides where the
entries live, and its tree supplies the entries and the sources. The working
tree is never read.

**Duration** runs from the committer time of the opening commit to that of the
closing one. An open window runs to `HEAD`'s committer time, not the clock, so
two runs on one checkout print the same numbers.

**A release** is a tag reachable from `HEAD`. A release shipped the window
when its commit contains the opening commit and does not contain the closing
one. That is the ancestry test, so a tag on a merged side branch counts
correctly. Prerelease tags on branches `main` never merged are not reachable,
and drop out on their own. This repository has six.

### 2. No cosmetic filter

A hash change is enough. The window counts whitespace and comment changes
like any other.

- A whitespace-blind rule would excuse 11 breaks in 1,202, and add a second
  definition of "holds" beside the one `check` uses. Two commands would then
  disagree about the same pin at the same commit.
- A comment-blind rule could not even locate the old text for four breaks in
  five, as the evidence shows.
- A judged filter would put a model inside cite, which 0044 built to read git
  alone. It would also make a past window change when the model changes.

The window is defined as an upper bound, and the output says "stale", never
"wrong". `cite check --show-diff` remains the place a person decides whether
a change mattered.

### 3. A verb, `manni cite history`, not a flag on `check`

0034 makes each verb name one job. `check` answers "does each pin hold now?"
and its exit code gates a pull request. `history` answers "since when, and
what shipped?" Three things differ, and each is a reason for a verb.

| | `cite check` | `cite history` |
|---|---|---|
| Reads | the working tree, once | every commit's tree |
| Prints | findings, one per rule | windows, one per span |
| Exit `1` | an error-severity finding | never |

A `--history` flag on `check` would change all three. The flag would make
`check` a second command with one name, the thing "commands must have parallel
behaviors" exists to prevent. It would also make the gate's exit code depend
on a flag that has nothing to do with gating.

The verb keeps `check`'s input surface wherever that surface means something
for history. The parity table below lists each flag.

### 4. Config: unchanged

The verb reads what `check` reads and adds no key. Release tags are detected
by reachability, so nothing needs naming.

Before, and after:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    externalMetadata:
      - file: "{page}.citations.yaml"
        keys: [citations]

cite:
  root: .                              # string, optional. Where source paths resolve.
  baseline: .manni-cite-baseline.json  # string, optional. Ignored by history.
  severity:                            # map, optional. Read by history for each window.
    source-changed: error
```

`cite.severity` gives each window its `severity`. `cite.baseline` is not read,
because a baselined pin is still stale, and that is the point of the report.
`allowEmpty`, `respectGitignore` and `root` mean what they mean for `check`.

### 5. The command

```
manni cite history [paths...] [options]
```

| Argument or option | Type | Default | What it does |
|---|---|---|---|
| `[paths...]` | files, directories, globs | the selected collections' `paths:` | The pages whose citations are walked. |
| `--collection <name>` | repeatable | every collection | A configured collection to walk. Refused beside paths, as `check` refuses it. |
| `--ext <list>` | comma-separated | the extractors' own | Extensions for directory walks. |
| `--exclude <glob>` | repeatable | none | A glob to leave out. |
| `--as <format>` | format name | by extension | Force the page format for every input. |
| `-c, --config <path>` | path | discovered | The config file. |
| `--no-config` | flag | off | Ignore any discovered config. |
| `--allow-empty` | flag | off | Zero matched files is success. |
| `--no-gitignore` | flag | off | Walk pages `.gitignore` covers. |
| `--root <dir>` | path | `cite.root`, else the git root | Where source paths resolve. |
| `-f, --format <format>` | `pretty` or `json` | `pretty` | The output. |

The positional pages are matched in the working tree, as `check` matches
them. Their history is then read from git by path. A path argument cannot
reach a page deleted before `HEAD`. Its windows appear only in a run over a
collection whose `paths:` once matched it.

Parity with `check`, flag by flag:

| `check` flag | In `history` | Why |
|---|---|---|
| `[paths...]`, `--collection`, `--ext`, `--exclude`, `--as`, `-c`, `--no-config`, `--allow-empty`, `--no-gitignore`, `--root` | Same name, same meaning | Input parity. |
| `-` for stdin | Refused, exit `2` | A piped page has no git history to walk. |
| `-f` with `github`, `sarif`, `junit` | Left out | Each is a sink for findings. A window is not a finding. |
| `--baseline`, `--write-baseline`, `--no-baseline` | Left out | Nothing gates, so nothing ratchets. |
| `--no-check-sources` | Left out | A window is a fact about the source end. |
| `-q`, `--show-diff`, `--reveal` | Left out | `history` prints only windows, so there is nothing to hide. A diff belongs to `check`. |

The stdin refusal is the one break in input parity. A page read from stdin is
one more input to `check`. For `history` it is an input with no past, and
walking it would print a clean report that means nothing.

### 6. Output

#### pretty

Pages in path order. Under each, one row per window and one dim line under it.

```
docs/src/content/docs/cite/set-up/index.mdx
  error  pages-from-collections         src/cite/core/config.ts:308-313  stale 45 minutes  v2.3.9
         541b63e..bf8f986  source-changed, closed by a re-pin
  error  collection-paths-config-relative  src/cite/core/config.ts:308-313  stale 45 minutes  v2.3.9
         541b63e..bf8f986  source-changed, closed by a re-pin
  error  bare-check-covers-collections  src/cite/core/config.ts:311-312  stale 45 minutes  v2.3.9
         541b63e..bf8f986  source-changed, closed by a re-pin
  error  named-paths-win                src/cite/core/config.ts:311-313  stale 45 minutes  v2.3.9
         541b63e..bf8f986  source-changed, closed by a re-pin

4 stale windows on 4 citations in 1 page, none open. 3.0 stale pin-hours.
1 release shipped a stale pin: v2.3.9.
Walked 137 commits, 2026-09-17 to 2026-10-20.
```

The severity word is the rule's resolved severity, colored as `check` colors
it. Duration reads in minutes under an hour, hours under two days, and days
after that. An open window reads `stale 47 days, open`.

The release column lists up to three tags. More read as a range in tag order,
such as `v4.2.0 through v4.6.0 (5 releases)`. No release reads `-`.

The dim line names the opening and closing commits, the rule and the cause.
Causes print as `closed by a re-pin`, `closed when the source was restored`
and `closed when the entry was removed`. An open window prints `still open at
HEAD`.

A run with no windows prints one summary:

```
No stale windows on 52 citations in 1 page.
Walked 137 commits, 2026-09-17 to 2026-10-20.
```

#### json

`{ summary, pages }`, the shape `check` prints, with windows where `check` has
citations.

```json
{
  "summary": {
    "head": "26dad159…",
    "walked": {
      "commits": 137,
      "from": "2026-09-17T18:45:06Z",
      "to": "2026-10-20T20:35:47Z"
    },
    "files": 1,
    "citations": 52,
    "windows": 4,
    "open": 0,
    "staleSeconds": 10700,
    "bySeverity": { "notice": 0, "warning": 0, "error": 4 },
    "releases": ["v2.3.9"],
    "skipped": { "encrypted": 0 }
  },
  "pages": [
    {
      "file": "docs/src/content/docs/cite/set-up/index.mdx",
      "windows": [
        {
          "id": "named-paths-win",
          "source": "src/cite/core/config.ts:311-313",
          "rule": "source-changed",
          "severity": "error",
          "opened": {
            "commit": "541b63e5c…",
            "date": "2026-09-17T20:19:46Z",
            "subject": "fix(collections): honour --collection with stdin beside it (#61)",
            "bounded": false
          },
          "closed": {
            "commit": "bf8f98690…",
            "date": "2026-09-17T21:04:21Z",
            "subject": "docs(cite): re-pin the citations that #60 and #61 moved (#75)",
            "by": "re-pinned"
          },
          "seconds": 2675,
          "releases": ["v2.3.9"]
        }
      ]
    }
  ]
}
```

| Field | Values |
|---|---|
| `rule` | `source-changed`, `source-missing` or `source-never-true` |
| `severity` | `notice`, `warning` or `error`, from `src/shared/severity.ts`, resolved through `cite.severity` |
| `closed` | an object, or `null` while the window is open |
| `closed.by` | `re-pinned`, `source-restored` or `removed` |
| `opened.bounded` | `true` when the window was already open at the first commit the walk could read |
| `seconds` | whole seconds, committer time to committer time |
| `releases` | tag names, oldest first |
| `source` | the entry's source as it stood when the window opened, spelled as `check` spells it |

A page with no windows appears in `pages` with an empty `windows` list. An
encrypted source prints as its ciphertext, as in `check`. Without the key
its citation is skipped and counted in `summary.skipped.encrypted`.

### 7. Messages and exit codes

| Exit | When |
|---|---|
| `0` | The walk finished, whatever it found, open windows included. |
| `0` | `--allow-empty` and nothing matched. |
| `2` | Any message below. |

`history` never exits `1`. It measures, and `check` gates. A report that
fails on its own findings is one nobody runs in a scheduled job, which is the
reason `tracevals calibrate` gives for exiting `0`.

Messages on stderr, each prefixed `manni:` by the shared runner:

| Message | Exit |
|---|---|
| `cite history reads git, and <root> is not inside a git repository.` | 2 |
| `this clone is shallow, so cite history would start at its oldest commit. Fetch the full history with fetch-depth: 0, or git fetch --unshallow.` | 2 |
| `cite history reads each page's past from git, and stdin has none. Name the page's path instead of -.` | 2 |
| `No files to read. Pass paths/globs, or declare a collection under \`collections:\` in manni.config.yaml.` | 2 |
| `--collection selects a configured collection; it cannot be combined with paths.` | 2 |
| `Unknown --format "<format>". Use pretty or json.` | 2 |

Notices on stderr, said once, never changing the exit code:

| Notice | When |
|---|---|
| `history before <sha> is unread: its manni.config.yaml does not load under this version. Windows open there are marked bounded.` | An old commit's config fails today's loader. |
| `<n> encrypted citations were skipped: no encryption key. Set MANNI_ENCRYPTION_KEY or encryptionKey: to include them.` | Keyed pins and no key. |

### 8. From minimal to maximal

**One page.** The smallest useful run.

```
$ manni cite history docs/src/content/docs/cite/set-up/index.mdx
docs/src/content/docs/cite/set-up/index.mdx
  error  named-paths-win  src/cite/core/config.ts:311-313  stale 45 minutes  v2.3.9
         541b63e..bf8f986  source-changed, closed by a re-pin
  …
4 stale windows on 4 citations in 1 page, none open. 3.0 stale pin-hours.
1 release shipped a stale pin: v2.3.9.
Walked 137 commits, 2026-09-17 to 2026-10-20.
$ echo $?
0
```

**A clean page.**

```
$ manni cite history docs/src/content/docs/a11y/ci/index.mdx
No stale windows on 52 citations in 1 page.
Walked 137 commits, 2026-09-17 to 2026-10-20.
```

**Config fallback.** No paths, so every collection's `paths:`.

```
$ manni cite history
…
11 stale windows on 11 citations in 7 pages, none open. 8.2 stale pin-hours.
1 release shipped a stale pin: v2.3.9.
Walked 137 commits, 2026-09-17 to 2026-10-20.
```

**The number, for a dashboard.** The scripting form.

```
$ manni cite history --collection site -f json | jq '.summary.staleSeconds'
29425
```

**A scheduled job.** Full history, then the report as an artifact.

```yaml
- uses: actions/checkout@v7
  with: { fetch-depth: 0 }
- run: npx manni cite history -f json > cite-history.json
```

**Every option at once.**

```
$ manni cite history --collection site --ext md,mdx --exclude "**/proposals/**" \
    --as mdx -c manni.config.yaml --no-gitignore --allow-empty --root . -f json
```

**Usage errors.**

```
$ git show HEAD:docs/src/content/docs/cite/index.mdx | manni cite history - --as mdx
manni: cite history reads each page's past from git, and stdin has none. Name the page's path instead of -.
$ echo $?
2

$ manni cite history docs/ --collection site
manni: --collection selects a configured collection; it cannot be combined with paths.
$ echo $?
2

$ manni cite history -f sarif
manni: Unknown --format "sarif". Use pretty or json.
$ echo $?
2

$ git clone --depth 1 … && cd … && manni cite history
manni: this clone is shallow, so cite history would start at its oldest commit. Fetch the full history with fetch-depth: 0, or git fetch --unshallow.
$ echo $?
2

$ cd /tmp/not-a-repo && manni cite history page.md
manni: cite history reads git, and /tmp/not-a-repo is not inside a git repository.
$ echo $?
2
```

### 9. Machinery shared with 0093

0093 forecasts which pins will go stale. Its input is the counterfactual pass
above, read per source file: how soon pins on that file broke in the past.
Both proposals need the same three pieces, built once in cite's core.

| Piece | What it is | Where |
|---|---|---|
| The pin timeline | For each citation, the commits at which its state or its source changed, and its classification at each. Read first-parent, from each commit's own config, entries and tree. | `src/cite/core/timeline.ts` |
| A tree-backed source reader | The classifier's source read, from a commit's tree rather than the working tree, so `classifyCitation` answers "as of commit C". | `src/cite/core/sources.ts`, `classify.ts` |
| Git calls | A first-parent log over a set of paths, a tree listing at a commit, and tags reachable from `HEAD` with their commits. | `src/cite/core/git.ts` |

The timeline visits only the commits that touched an entry's home or a cited
source. On this repository the throwaway script, which visits all 137 and
caches nothing across runs, takes 34 seconds.

Neither proposal depends on the other's verb. 0092 turns the timeline into
windows. 0093 turns it into rates. Whichever lands first builds the timeline,
and the second reuses it.

### 10. `manni check` and `manni status` do not run it

`manni check` runs gates, and `history` is not one. `manni status` lists
domains, not verbs, so cite's row is unchanged.

## What was rejected

- **`cite check --history`.** It changes what `check` reads, prints and exits
  with. Section 3 has the table.
- **A cosmetic filter.** Deterministic, it excuses about 1% of breaks and
  disagrees with `check`. Judged, it puts a model into a tool that reads git
  alone. Section 2 has the numbers.
- **Opening the window at the recorded `commit-sha`.** 86% of this repo's pin
  states recorded a commit `main` never kept. The walk would fail for most of
  them in a fresh clone.
- **The naive rule, hash at the recorded lines.** It counts moves as windows.
  On this history it would have reported 29 windows where 11 were real.
- **Closing a window on a claim edit.** A typo fix in the sentence would close
  it while the source still fails. The window closes when the source holds.
- **A config key naming release tags.** Reachability already separates
  releases from prerelease tags in this repo. A key would name something the
  tool detects.
- **A `--since <rev>` bound.** The walk is cheap at this scale, and docevals
  already gives `--since` another meaning. A second meaning would break the
  rule that shared names carry shared values.
- **Wall-clock time for open windows.** Two runs would disagree. `HEAD`'s
  committer time keeps a report reproducible from its commit.

## Stress test

### 1. A window is an upper bound. Is the bound worth printing?

Yes, for two reasons. The bound is exact about what is knowable without
reading prose: the page cited something the source no longer said. And the
bound is the quantity the gate controls. A team that gates sees it go to zero,
as this repo's did after #76. A team that does not gate sees it grow at about
the counterfactual rate.

### 2. The citations moved house in #118. Does the walk lose them?

No, because each commit is read with its own config. Before #118 the entries
lived in one root `site.metadata.yaml` of 35,780 lines. After it, each page's
sidecar held them. A walk that read today's paths would see 4,173 entries
born on 2026-09-24, and lose seven days.

### 3. An old commit's config does not load today

The walk stops reading there and says so once. Windows already open at the
first readable commit carry `bounded: true`. Their true start is earlier and
unknown, and the output does not guess.

### 4. A squash merge, or a rewrite of `main`

Neither matters. The walk never reads `commit-sha`. Commits are named by their
SHA in the output, so a report saved before a rewrite names commits that no
longer exist. Its dates, durations and tags still hold.

### 5. A merge commit with a long side branch

The walk is first-parent, so it reads the states `main` actually had. A side
branch's interim states never shipped, so they are not windows. Releases use
ancestry, so a tag on a merged branch still lands in the right window.

### 6. A page renamed

A window belongs to a page path and an id. A rename closes the old window as
`removed`, and the new path starts fresh. Following renames is an open
question.

### 7. Does it agree with `check` at `HEAD`?

It must. A window open at `HEAD` is exactly a `source-changed`,
`source-missing` or `source-never-true` finding from `check` on the same
checkout, before any baseline. The acceptance checklist pins that equality.

## Open questions

1. Should a repository that tags non-releases get a tag pattern? This repo
   needs none, because reachability already excludes its prerelease tags.
2. Should a page rename carry its windows across, through git's rename
   detection?
3. Should `manni status` show the open-window count beside cite's row?
4. Should the walk have a ceiling, as the claim end's 256-commit cap does? A
   repo with years of history and thousands of pins may need one.
5. Is `history` the right verb? `windows` and `debt` were the alternatives.
   `history` reads as what it prints, and the others need explaining.

## Consequences

- A docs owner can answer "how long, and in which releases" with one command.
- A repo ramping in with `--baseline` sees the age of its debt.
- The pin timeline exists once, in cite's core, for 0093 to reuse.
- `cite` gains a fifth verb, and its reference page a section.
- The CUJ list gains D18.

## Acceptance checklist

- [ ] `src/cite/core/timeline.ts` exists and builds each citation's timeline
      from each commit's own config, entries and tree.
- [ ] `src/cite/core/git.ts` gains a first-parent log over paths, a tree
      listing at a commit, and reachable tags with their commits.
- [ ] `classifyCitation` classifies against a commit's tree, and `check`'s
      output is unchanged.
- [ ] `src/cite/commands/history.ts` holds the command core, free of CLI and
      IO plumbing.
- [ ] `manni cite history <page>` prints the pretty report of section 6 and
      exits `0`, with or without windows.
- [ ] `manni cite history` with no paths walks every collection's `paths:`.
- [ ] `manni cite history -f json` prints `{ summary, pages }` with every field
      in section 6's table, and exits `0`.
- [ ] A window's `severity` follows `cite.severity`, and uses only `notice`,
      `warning` and `error`.
- [ ] A moved pin opens no window. A whitespace-only change opens one.
- [ ] A change to `commit-sha` alone opens and closes nothing.
- [ ] A release counts in a window exactly when its commit contains the
      opening commit and not the closing one.
- [ ] An open window's duration runs to `HEAD`'s committer time, so two runs
      print the same JSON.
- [ ] Windows open at `HEAD` equal `check`'s `source-changed`,
      `source-missing` and `source-never-true` findings on the same checkout.
- [ ] `-` exits `2` with the stdin message. A shallow clone exits `2` with the
      shallow message. No git repository exits `2` with its message.
- [ ] No inputs and no config exits `2` with the "No files to read" message.
- [ ] `-f sarif`, `-f github` and `-f junit` exit `2` with the unknown-format
      message.
- [ ] `--collection` beside paths exits `2` with `check`'s message.
- [ ] An old config that fails to load prints the notice once and marks open
      windows `bounded: true`.
- [ ] Encrypted citations without a key are skipped, counted in
      `summary.skipped.encrypted`, and noticed once.
- [ ] `test/cite/timeline.test.ts` builds a temporary repository that mints a
      pin, moves it, changes it, tags a release, re-pins it and removes it. It
      asserts each window and cause.
- [ ] `test/cite/cli.integration.test.ts` covers the ladder's rungs and every
      exit-`2` message against `dist/cli.js`.
- [ ] `docs/src/content/docs/cite/reference/cli.mdx` documents `history`, and
      `npm run docs:check-cli` verifies it.
- [ ] A cite journey page under `docs/src/content/docs/cite/` shows the D18
      path, from the scheduled job to the number.
- [ ] `docs/content-strategy/cujs.md` carries D18.
- [ ] `docs/proposals/README.md` lists 0092, and this file's `Status:` line
      names the implementing PR.
- [ ] A demo video under `media/` shows a stale window, the release it
      shipped in and the total, per the `feat:` rule.
