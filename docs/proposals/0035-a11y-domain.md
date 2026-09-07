# 0035: The `a11y` domain: `manni a11y check`

- **Status:** Implemented
- **Serves:** Devin · D1, D3. Devin wires the gate and reads the machine
  output; Maya runs it locally before she pushes. a11y has no persona of its
  own yet; see Consequences.
- **Depends on:** [0033](0033-manni-monorepo.md), the umbrella this domain
  mounts on and the folding-in recipe it is the first to follow.
  [0034](0034-command-grammar.md), the grammar it was planned under: a spelled
  verb, one separator per list, a full interface and an example ladder in the
  plan
- **Relates to:** [0001](0001-validation-baseline.md), whose ratchet is the
  shape an a11y baseline would take, deferred here.
  [0003](0003-sarif-and-junit-reporters.md), whose SARIF and JUnit output the
  a11y reporters do not yet have, also deferred
- **Touches:** `src/a11y/**` (new), `src/cli.ts` (one `addCommand`),
  `src/shared/color.ts` (moved out of meta's reporters, re-exported from the
  old path), `package.json` (`playwright-core`, `@axe-core/playwright`),
  `test/a11y/**`, `test/fixtures/a11y/site/`,
  `docs/src/content/docs/a11y/**`, `docs/astro.config.mjs`,
  `scripts/check-cli-reference.mjs`, `CLAUDE.md`
- **Verdict:** Add a second domain, `a11y`, with one verb.
  `manni a11y check [urls...]` crawls a site from its seeds and stays on their
  hosts. It uses the sitemap as the page list when there is one. It runs
  axe-core in a browser it finds rather than downloads. It scores every page,
  and exits `1` when any page keeps a violation at or above the impact floor.

## Problem

manni is one bin with one subcommand per tool, and since 0033 shipped the bin
has had exactly one. The folding-in recipe in `CLAUDE.md` has never been run, so
every sentence in it is untested. That covers the `src/<tool>/` layout, the
shared config loader with a second top-level key, and the `ToolError` base. It
covers the docs section per domain and the drift check that only knew one page.
The second domain is where those either hold or get rewritten, and it is cheaper
to find out with a small tool than with docevals.

Accessibility is the small tool. The check itself is a solved problem. axe-core
is the engine behind Lighthouse's accessibility audit, the browser extensions,
and most CI plugins. It produces a per-rule, per-element verdict with a
remediation sentence attached. What is not solved for a docs team is running it
over a *site* in CI. That takes writing a crawler, a sitemap reader, and a
reporter around it every time. Playwright's axe integration checks one page.
Lighthouse CI checks a list of URLs you maintain by hand. Neither fails a build
on a page that was published last week and linked from nowhere.

The team that owns a docs site already has manni in CI for metadata. A second
check that reads the same config file and follows the same exit-code contract
costs them one line in the workflow.

## Decision

### A domain, not a `meta` concern

`meta` reads files and validates their metadata. `a11y` loads URLs in a browser
and runs an engine over the rendered DOM. They share nothing below the shared
layer: no extractor, no schema, no file resolution. What they share is the
shared layer itself, which is what 0033 built it for. That is config discovery
(`a11y:` beside `meta:` in one `manni.config.yaml`), `ToolError` and the
exit-code contract in `run.ts`, `warn()`, and `programName()`. It is now also
`shouldColor`/`palette`, moved from `src/meta/reporters/color.ts` to
`src/shared/color.ts` with a re-export left behind so meta does not churn.

Under 0034 the verb is spelled. `manni a11y check <url>`, never
`manni a11y <url>`; `manni a11y` alone is a usage error with the help hint.
`meta`'s default subcommand is grandfathered and this domain does not copy it.

### The browser

axe needs a DOM with computed styles, because contrast, visibility, and
accessible-name computation are all style-dependent. Three ways to get one were
weighed:

- **jsdom.** No browser, no install step. Rejected: jsdom does not run layout,
  so every colour-contrast rule is `incomplete`. A site whose navigation is
  rendered by JavaScript is checked as an empty shell. The findings would be
  wrong in the direction that matters, passing pages that fail.
- **puppeteer.** Bundles a Chromium download in `postinstall`. Rejected: every
  `manni meta`-only user would pay a multi-hundred-megabyte download for a tool
  they never run. 0017 already treats an unrequested multi-gigabyte download
  as a defect; this is the same shape.
- **`playwright-core` + `@axe-core/playwright`.** No download at install.
  Chosen. At run time the analyzer tries, in order, an installed Google Chrome
  (`channel: "chrome"`), Microsoft Edge (`channel: "msedge"`), and Playwright's
  own Chromium (`npx playwright install chromium`). The first that launches is
  used. None of the three is an `A11yError` naming the install command, exit
  `2`, before any URL is touched. GitHub-hosted runners on all three OSes ship
  Chrome, so CI needs no extra step.

One browser, one context, one page, reused across every URL in the run. The
browser launches lazily on the first `analyze` and is closed in a `finally`,
including when the crawl throws.

### The crawl

The seed's host is the scope. Two URLs are the same site when their hostnames
match case-insensitively and their non-default ports match. Scheme is ignored,
so `http://` and `https://` of one host are one site. Each seed adds its host,
so `manni a11y check https://docs.example.com/ https://blog.example.com/` checks
both hosts and nothing else.

The frontier is a FIFO. Seeds come first, then the sitemap's URLs, then each
page's same-host links in the order the page listed them. The sitemap is looked
up once per run, from the first seed. The candidates, in order, are the
`Sitemap:` lines of `<origin>/robots.txt`, as listed, followed by a walk of
directories. The walk goes from the seed's own directory up to the site root,
nearest directory first and the root last. In each directory it tries
`sitemap.xml`, `sitemap-index.xml` and `sitemap_index.xml`. The first candidate
that returns `2xx` and parses is used; a `<sitemapindex>` recurses (depth 3, 50
children). A missing or broken sitemap is "no sitemap", never an error. Stress
test 8 is why the walk exists. Links are the absolute `href` of every `a[href]`
in the live DOM after load, filtered to same-host page-like URLs. That means no
`mailto:`/`tel:`/`javascript:`/`data:`, and no path whose last segment ends in
an asset extension. Every URL is normalized (fragment dropped, host lowercased,
default port dropped) and enters the frontier once.

Pages run sequentially. `--max-pages` (default 100) stops the run; what is
still queued is `skipped`. `--no-crawl` checks exactly the seeds: no sitemap,
no links.

### The score

Per page, `round(100 × passes ÷ (passes + violations))`. `passes` is the count
of axe rules that ran and passed. `violations` is the count of rules that failed
at or above the `--impact` floor. It is the share of applicable rules that
passed after impact filtering, and the docs say so in those words. It is not a
Lighthouse score, and the reason is in the stress test below. The score is
`null` when a page did not load or no rule applied. axe's `incomplete` results
are counted and reported and never fail a page.

### Exit codes

The contract meta uses, applied to pages instead of files. `0`: every page
loaded and none has a remaining violation. `1`: at least one page has a
remaining violation, or a crawled page failed to load. `2`: `A11yError`, a bad
flag value, a seed that would not load, no browser. `summary.failed` is what
drives `1`, and a page contributes to it either by keeping a violation or by
carrying an `error`.

### The config key

```yaml
a11y:
  urls: ["https://docs.example.com/"]   # string[]
  crawl: true                            # boolean
  maxPages: 100                          # integer ≥ 1
  tags: ["wcag2a", "wcag2aa"]            # string[]
  impact: serious                        # minor | moderate | serious | critical
  timeout: 30000                         # integer ≥ 1, ms
```

Read through the shared family loader with `section: "a11y"` and no legacy
names, since nothing predates it. CLI flag > config key > default, the
precedence 0005 fixed for meta. `urls` is the fallback for `[urls...]`, and
neither is `A11yError`, exit `2`, the way an empty input set is for meta
(0014). Unknown keys, wrong types, and non-`http(s)` URLs are errors naming
the file and the key.

### The CLI surface

```
manni a11y check [urls...]
  -f, --format <format>    pretty | json | github          (pretty)
      --no-crawl           check exactly the given URLs
      --max-pages <n>      cap on pages checked            (100)
      --tags <list>        comma-separated axe tags, once
      --impact <level>     minor | moderate | serious | critical  (minor)
      --timeout <ms>       per-page navigation timeout    (30000)
  -q, --quiet              pretty: hide clean pages
  -c, --config <path>      explicit config file
      --no-config          ignore any discovered config
```

`--no-color` sits on the `a11y` domain command, where `meta` has it. `--tags` is
a `<list>` option under 0034: one comma-separated value, given once, a second
occurrence replacing the first; it never accumulates. `[urls...]` is
space-separated because it is argv. The plan carried the full option table and
an eight-rung ladder, from `manni a11y check https://docs.example.com/` to the
every-flag invocation. It also carried six usage errors with their stderr lines.
The reference page carries the same ladder.

### Reporters

Three formats. `pretty` prints a header naming the sitemap used (or
`no sitemap; followed links`, or `no crawl` under `--no-crawl`). Then it prints
one line per page with its score and impact counts. Under each failing page it
prints one line per rule (impact, rule id, node count, help text, Deque
University URL). Under that come the first three failing elements as a selector
and axe's `failureSummary`. Last is a footer with totals and the `skipped`
count. Those element lines are the deterministic remediation the tool can
honestly offer: which element, which condition failed, in axe's own words.
`json` is the whole `CheckRun`: `results[]` (`url`, `source`, `violations[]`,
`passes`, `incomplete`, `score`, `error?`) and `summary` (`discovered`,
`checked`, `skipped`, `failed`, `violations`, `byImpact`, `sitemap`, `crawl`).
`github` is one `::error` workflow command per rule per page and per failed
load, empty when clean.

Colours keep meta's meanings, which `docs/content-strategy/design.md`
reserves: `✓` green, `✗` red, impact from dim through yellow to red, URLs cyan.

### Deferred, deliberately

- **SARIF and JUnit.** 0003 built them for meta around a file and a line. An
  a11y finding has a URL and a selector, and SARIF's `artifactLocation` wants a
  URI it can resolve to a file. The mapping is worth its own proposal rather
  than a guess here.
- **`robots.txt` `Disallow`.** The crawler reads `robots.txt` for `Sitemap:`
  lines and ignores `Disallow`. A team checks its own site; honouring
  `Disallow` would silently skip the admin pages that most need the check.
  Reconsider if the tool is ever pointed at sites its user does not own.
- **Gzipped sitemaps.** `.xml.gz` bodies are not decompressed. Large sites
  serve them; the fix is small and waits for someone to need it.
- **Concurrency.** One page at a time. A 100-page site takes a couple of
  minutes. Parallel contexts are a later change to `crawl()` behind the same
  signature.
- **A baseline.** 0001's ratchet, for a site with an existing backlog. The
  fingerprint would be `(url, rule, target)`, and the decision of whether a
  selector is stable enough to be an identity is the open question.
- **A programmatic export.** `src/index.ts` still re-exports only
  `src/meta/index.ts`. `src/a11y/index.ts` exists and is not published,
  because publishing it commits the `PageAnalyzer` seam to a public API before
  a second consumer has asked for it.

## Stress test

### 1. Why one sitemap, from the first seed?

Two seeds on two hosts could each have a sitemap, and reading both would find
more pages. The first-seed rule was kept for two reasons. A run with several
seeds is the unusual case, and the usual one, a single host, is unaffected. And
the alternative has an ordering question with no good answer. With two sitemaps,
whose pages go first in the frontier, and which URL does `summary.sitemap`
report? One sitemap keeps `summary.sitemap` a string rather than an array and
keeps the frontier order explainable. The second host is still crawled by links
from its seed. A later change to per-seed lookup is additive to the JSON shape
(`sitemap` becomes a list) and is a `feat`, not a `fix`.

### 2. Why is a seed failure exit 2 but a crawled page failure exit 1?

The seed is the user's input. If it does not load, nothing was checked, and the
honest answer is "the run could not happen". That is `2` everywhere in manni
(0014: an empty run is not success). A crawled page is the site's output. If the
site links to a page that 404s or times out, that is a defect on the site. It is
of the same kind as a missing alt attribute. It is recorded against that page
with `error` set and counted in `summary.failed`. Stopping the whole run for it
would hide every other finding behind the first broken link. The split is the
same one meta makes between a path that does not exist (`2`) and a file whose
metadata fails (`1`).

### 3. Why is `www.example.com` a different host from `example.com`?

Because it is one, and guessing otherwise is wrong often enough to matter.
Many sites serve the two as the same content with a redirect, and for those
the crawl reaches both through the redirect's final URL. But `blog.example.com`
and `example.com` are as related in DNS as `www.` and the bare host, and no
rule that strips `www.` can explain why it does not also strip `blog.`. A user
who wants both gives both as seeds, which is what multiple seeds are for. The
rule that is written down (hostname and port, case-insensitive, scheme
ignored) is one a reader can predict; a heuristic is not.

### 4. Why is the score not weighted?

Lighthouse weights each axe rule by an estimate of user impact and reports a
single number people put in dashboards. The weights are Lighthouse's editorial
judgment, they change between versions, and a weighted score invites the reading
"92 is fine". This tool has an exit code for "fine", and the score is a per-page
trend indicator, not the verdict. An unweighted share of passing rules has one
property the weighted one lacks. A reader can recompute it from `passes` and
`violations.length` in the JSON, and see exactly what `--impact` changed. The
reference page says "not a Lighthouse score" in those words, because the first
question every reader will ask is why the numbers differ.

### 5. Why does `--tags` not also repeat?

0034 § stress test 4, verbatim. The plan for this domain originally had `--tags`
both comma-separated and repeatable. That plan is the one 0034 cites as the
reason the separator rule was written down. It is a `<list>` option like meta's
`--ext`; the config key `tags:` is a YAML list and mirrors the one spelling.

### 6. Why does `incomplete` never count?

axe marks a rule `incomplete` when it could not decide: contrast over a
background image, an ARIA reference it could not resolve. Counting those as
failures would fail pages for things a person has to look at, and counting
them as passes would inflate the score. They are reported as a number per page
and left out of both `score` and the exit code. A `--strict` that promotes them
is a later flag if anyone asks for it.

### 7. Does the folding-in recipe hold?

Mostly. Three things were not in it and are now. `shouldColor`/`palette` lived
in meta's reporters and every domain needs them, so they moved to
`src/shared/color.ts`. The drift check knew one page and now takes a domain →
page map. And the recipe said nothing about the docs section a domain ships
with, which 0034 added before this landed. The rest (`src/<tool>/`,
`ToolError`, the shared config loader with a new section, `programName()`,
`addCommand`) held without change.

### 8. Why walk the seed's path and not just the origin?

Because real sites keep the sitemap where the site is, and the site is not
always the origin. A GitHub Pages project site lives under a path.
`https://hawkeyexl.github.io/manni/` is this tool's own docs. Astro's sitemap
integration, which Starlight turns on by default, writes
`/manni/sitemap-index.xml` there and nothing at the origin. The origin belongs
to the account rather than the project. The first real run of `manni a11y check`
against those docs reported `no sitemap; followed links`: the tool was wrong
about the one site its authors could vouch for. The original rule, `robots.txt`
then `/sitemap.xml`, was written for a site rooted at `/`, and a docs site is
often not.

`robots.txt` keeps first place, because a `Sitemap:` line is the site's own
declaration and needs no guessing. After it the walk starts at the seed's own
directory and ends at the root, three names per directory. Nearest first means
the project site finds its file on the first or second try (`/manni/sitemap.xml`
404s, `/manni/sitemap-index.xml` answers). A site rooted at the origin still
finds `/sitemap.xml` where it always did, one directory later than before at
most. The cost is a few extra 404s per run, each a small GET before the first
page loads. Only on a site that has no sitemap at all does the walk run to the
end.

## Consequences

- `manni --help` lists two domains. `manni a11y check <url>` is the first
  command outside `meta`, and the grammar in 0034 has a second speaker.
- `package.json` gains `playwright-core` and `@axe-core/playwright` as
  dependencies. Neither downloads a browser at install; the lockfile diff is
  those two and their transitive `axe-core`.
- The site gains `a11y/` beside `meta/`: an overview and a CLI reference,
  drift-checked. `docs/content-strategy/information-architecture.md` gains a
  "Domains" note.
- **No persona.** The pages serve Devin (D1, D3) with Maya as the local runner.
  That is a borrowing. An accessibility owner is a different person from a docs
  engineer. They have a different vocabulary (WCAG success criteria rather than
  schema fields) and different pains (an audit finding rather than a red PR).
  Their journey starts with "which pages are worst" rather than "add a gate".
  The content strategy needs a fifth persona and its CUJs before `a11y/` grows
  journey pages. This proposal records the gap rather than inventing the persona
  in passing.
- The deferred list above is the backlog: SARIF/JUnit, `Disallow`, gzipped
  sitemaps, concurrency, a baseline, the programmatic export. Each is a small
  proposal or a `feat` commit on its own; none blocks the gate working today.
- `check` does not fix anything, and the reason is structural rather than
  scope: it sees a rendered URL, not the source. What a fixer would look like,
  and which rules it could honestly fix, is [0036](0036-a11y-fix.md).
