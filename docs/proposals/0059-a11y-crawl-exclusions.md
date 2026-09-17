# 0059: keeping the a11y crawl out of part of a site

- **Status:** Proposed
- **Serves:** One journey, twice.
  - Devin · D1, "Gate the docs in CI". His gate should cover the pages his
    team owns. A crawl that also walks a generated reference costs him minutes
    per pull request, for findings nobody will act on.
  - Devin · D3, "Report findings where the team already looks". A report whose
    annotations are mostly from a section the team does not maintain is a
    report people learn to skim.
- **Depends on:** Three earlier proposals.
  - [0035](0035-a11y-domain.md) is the domain. It defines the crawl this
    proposal narrows, and its scope filter is where the new filter belongs.
  - [0034](0034-command-grammar.md) is the one-separator rule, which decides
    that the new flag repeats rather than splitting on commas.
  - [0041](0041-collections.md) removed `meta.exclude` and narrowed a
    collection's `exclude:` to membership. That decision is the main objection
    to this one, and stress test 1 answers it.

## Problem

Once the crawl is on, it is all or nothing. `manni a11y check` walks every
same-host page it can reach, and there is no way to say "check the site but
not `/proposals/`".

The two levers that exist both miss.

`--no-crawl` swings to the other extreme. It checks exactly the URLs named, so
narrowing a run by one section means enumerating every page in all the others.
On a site that gains pages weekly, that list is wrong the day after it is
written.

`--max-pages` is a count, not a choice. It stops once that many pages are
checked, and whatever the cap cuts is whatever the frontier happened to reach
last. A run capped at 60 on a 101-page site tells you nothing about which 41
pages went unchecked.

This repository is the small end of the problem. Its docs site is 101 pages
and a full crawl is about three and a half minutes of real browser. A good
share of those pages are RFCs under `/**/proposals/`, which no one gates on. A
repository with a generated API reference has the same shape and worse numbers.

`manni meta validate`, `get` and `fill` all carry `--exclude <glob>`. The
crawl is the one thing in the family that walks a set and cannot be told to
skip part of it.

## Decision

### 1. `--exclude <glob>`, repeatable

One glob per occurrence. It never splits on commas, which is 0034's rule for a
repeatable option, and it is the spelling `meta` already uses.

```
manni a11y check --exclude "/proposals/**" --exclude "/reference/api/**"
```

### 2. `a11y.exclude:`, a list of globs

```yaml
a11y:
  exclude: ["/proposals/**"]
```

| Key | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `a11y.exclude` | `string[]` | no | `[]` | Globs matched against a URL's path. A match keeps the page out of the crawl. An explicit `[]` is accepted and means the same as the key being absent. |

It joins `urls`, `crawl`, `maxPages`, `tags`, `severity` and `timeout` as an
accepted key. Everything else about the loader is unchanged, including that an
unknown key is a hard error and that a wrong type is too.

- `manni.config.yaml: "a11y.exclude" must be a list of strings.`
- `manni.config.yaml: "a11y.exclude[2]" must be a non-empty string.`

The index is the entry's position in the list, so the second message names
whichever entry is wrong.

Both are exit 2, like every other config error in the section.

### 3. The flag replaces the config list

A typed `--exclude` wins over `a11y.exclude` entirely. The two do not merge.
That is how every other a11y option relates to its key, and stress test 5 says
why merging is worse here than it looks.

### 4. The glob matches the URL's path

The path only, always starting with `/`. Not the scheme, not the host, not the
port, not the query, not the fragment.

So `/proposals/**` matches `https://example.com/proposals/0035/` and
`http://127.0.0.1:4321/proposals/0035/` alike. That is what makes one pattern
work against a local preview and against production, which is the case this
repository is in.

A trailing slash is not part of the comparison. The path is matched with any
trailing slash removed, so `/proposals/` and `/proposals` are one thing. And a
pattern ending `/**` matches the directory itself as well as everything under
it, so `/proposals/**` covers the section index without a second pattern.

Both rules exist because a crawl produces both spellings. A sitemap usually
lists `/proposals/`, and a bare link usually points at `/proposals`. A pattern
that caught one but not the other would fail silently, on whichever spelling
the site happened to emit.

Matching otherwise uses `picomatch`, already a dependency, with the same
options `meta` uses for file globs. A pattern that does not begin with `/` is
an error rather than a silent near-miss:

```
manni: --exclude "proposals/**" must start with "/": it matches a URL path.
```

Exit 2.

### 5. An excluded seed is an error

A seed is explicit. So is a pattern. When they contradict each other, that is a
mistake worth naming rather than a preference worth guessing at.

```
manni: --exclude "/proposals/**" excludes the seed https://example.com/proposals/.
```

Every excluded seed is named before the run exits, rather than the first one
ending it. A user who typed two wrong patterns should not need one run per fix:

```
manni: --exclude "/proposals/**" excludes the seed https://example.com/proposals/.
manni: --exclude "/blog/**" excludes the seed https://example.com/blog/.
```

Exit 2, and nothing is checked. Stress test 3 covers why this differs from the
asset-extension filter, which a seed bypasses.

### 6. The filter runs at enqueue

Next to the same-host check and the asset-extension check in `crawl()`. An
excluded URL is never fetched, never analyzed, and never counted in
`discovered`.

### 7. `summary.excluded`, and a footer that says so

A new integer on `summary`, counting URLs a pattern kept out. It is additive;
nothing else in the JSON moves.

```json
{
  "summary": {
    "discovered": 60,
    "checked": 60,
    "skipped": 0,
    "duplicates": 0,
    "excluded": 41,
    "failed": 0,
    "violations": 0,
    "bySeverity": { "notice": 0, "warning": 0, "error": 0 },
    "sitemap": "https://example.com/sitemap.xml",
    "crawl": true
  }
}
```

The existing identity `checked + skipped + duplicates === discovered` is
unchanged. `excluded` sits outside it, because an excluded URL never entered
the frontier. Stress test 4 argues that case.

The pretty footer gains a clause when the count is not zero, in the same shape
as the two clauses already there:

```
0 violations on 0 of 60 pages; 41 excluded
```

`-f github` is unchanged. An excluded page produces no annotation, which is
the point of excluding it.

### 8. What `--progress` says

No line per excluded URL. A pattern that removes four hundred pages would
otherwise bury the pages that were checked, which is what the progress output
is for.

One line instead, written once discovery settles, and only when something was
excluded:

```
manni: excluded 41 pages (2 patterns)
```

That is enough to see a pattern working, or to see one that matched far more
than intended. Which URLs went is a question for `-f json`, where every
checked page is listed and `summary.excluded` carries the count.

### The invocation ladder

**Bare.** Every page the crawl reaches, no exclusions. Unchanged from today.

```
$ manni a11y check https://example.com/
Checked 101 of 101 pages (sitemap: https://example.com/sitemap.xml)
...
0 violations on 0 of 101 pages
```

**One section out.**

```
$ manni a11y check https://example.com/ --exclude "/proposals/**"
Checked 60 of 60 pages (sitemap: https://example.com/sitemap.xml)
...
0 violations on 0 of 60 pages; 41 excluded
```

**From config,** with the key set and no flag typed.

```yaml
a11y:
  urls: ["https://example.com/"]
  exclude: ["/proposals/**"]
```

```
$ manni a11y check
Checked 60 of 60 pages (sitemap: https://example.com/sitemap.xml)
...
0 violations on 0 of 60 pages; 41 excluded
```

**Overriding the config for one run.** The flag replaces the list, so this
checks the proposals and skips the API reference instead.

```
$ manni a11y check --exclude "/reference/api/**"
Checked 92 of 92 pages (sitemap: https://example.com/sitemap.xml)
...
0 violations on 0 of 92 pages; 9 excluded
```

The proposals are checked again, because the flag replaced the config's list
rather than adding to it.

**The CI shape.**

```
$ manni a11y check --exclude "/proposals/**" -f github --progress
::warning title=a11y/region::All page content should be contained by landmarks — 1 node on https://example.com/about/ (https://dequeuniversity.com/rules/axe/4.13/region?application=playwright)
```

**Everything at once.**

```
$ manni a11y check https://example.com/ \
    --exclude "/proposals/**" --exclude "/reference/api/**" \
    --max-pages 200 --tags wcag2a,wcag2aa,wcag21aa \
    --severity error --timeout 45000 -f json --progress
```

**The usage errors.**

```
$ manni a11y check https://example.com/ --exclude "proposals/**"
manni: --exclude "proposals/**" must start with "/": it matches a URL path.
$ echo $?
2
```

```
$ manni a11y check https://example.com/proposals/ --exclude "/proposals/**"
manni: --exclude "/proposals/**" excludes the seed https://example.com/proposals/.
$ echo $?
2
```

```
$ manni a11y check --exclude
error: option '--exclude <glob>' argument missing
$ echo $?
2
```

### Programmatic API

None. `src/a11y/index.ts` is still unpublished, for the reason 0035 gives.

## Stress test

### 1. Why a config key, when 0041 removed `meta.exclude`?

This is the strongest objection, and it dissolves on inspection.

0041 removed `meta.exclude` because a collection's `exclude:` had become the
place a document set says what belongs to it. Two things then claimed the same
job. The tool had no basis for choosing which collection's exclusions to apply
to a path someone typed. That is 0041 rule 3, and it is a statement about
**membership of a document set**.

a11y has no such overlap. A collection gives it one thing, a `url:` to seed
from. There is no URL-level membership anywhere in the model, so nothing else
is already claiming this job.

The positive case is a11y's own convention. Every run-shaping option on
`a11y check` has a config key today, which the CI page states as a promise:
every flag has one except `-f`, `--progress` and `--collection`. Shipping
`--exclude` with no key would make it the first exception, and the first one a
reader has to discover by trying.

### 2. Why the path and not the whole URL?

Because the pattern has to survive moving between environments, and the host is
exactly the part that changes.

This repository's CI checks `http://127.0.0.1:4321/manni/` on a pull request
and would check `https://hawkeyexl.github.io/manni/` on a schedule. A pattern
matched against the whole URL would need two spellings for one intention, kept
in step by hand.

The cost is that a pattern cannot distinguish two hosts. Crawl scope is already
one host per seed. So the case where that matters is a run with several seeds on
several hosts. That is rare, and `--collection` already addresses it by running
them separately.

Note the base path is part of the path. On this site a pattern is
`/manni/proposals/**`, not `/proposals/**`. That is a real papercut. Matching
relative to the seed is worse. It makes a pattern's meaning depend on which
seed reached the page, so a page reached from two seeds has two answers.

The trailing-slash rule in decision 4 exists to stop a second papercut joining
it. Without it, `/proposals/**` would cover every page in the section and
silently miss the section index, depending on which spelling the site emitted.

### 3. Why is an excluded seed an error, when a seed bypasses the asset filter?

Because the two filters answer different questions.

`isPageLink` asks what kind of URL this is. A seed bypasses it because naming a
URL is a statement that it is worth loading. The tool should not second-guess a
person who points it at a `.txt` endpoint that serves HTML.

`--exclude` asks what the user wants checked. Both the seed and the pattern are
the user's statement, so a contradiction is not the tool's to resolve. Silently
preferring either one produces a run the user did not ask for. The two possible
silences are equally defensible, which is the signal to refuse.

The rejected alternative is to let the seed win and print a warning. A warning
on stderr in CI is a line in a log nobody reads. The run that follows it is
wrong in a way the exit code does not show.

### 4. Why does `excluded` sit outside the `discovered` identity?

`discovered` means URLs that entered the frontier. An excluded URL is dropped
at the same point an off-host URL and a `.png` link are dropped. Neither of
those is counted anywhere today.

The alternative is to count exclusions in `discovered` and add `excluded` to
the identity. That reads well in the summary and badly everywhere else. It would
make `discovered` mean "URLs seen". The number would then depend on how many
times a page is linked, since dedupe happens after scope filtering.

Keeping `excluded` as a separate observation costs one sentence in the
reference and keeps an invariant that is currently true.

### 5. Why replace rather than merge the flag and the key?

Merging looks friendlier and removes the ability to check less.

If the flag added to the config list, then a run could only ever exclude more
than the repository's default. Checking one excluded section on purpose, which
is what someone does when fixing it, would need `--no-config`, and that also
drops `collections:`. That is issue #79's shape exactly, one release after
fixing it.

Replacing keeps both directions available and matches every other a11y option.

### 6. Why not use `robots.txt` `Disallow`?

0035 defers reading `Disallow`, and that remains the right call, but it is a
different mechanism either way. `Disallow` is the site's declaration to
crawlers. `--exclude` is the operator's choice about a gate. A team that wants
its drafts out of its own accessibility report has no business editing
`robots.txt` to get it. A site that disallows a path may still be one whose
accessibility its owner wants measured.

### 7. Why not `--include` as well?

Because `--no-crawl` plus explicit URLs already is the include case, and a
second way to spell it would be a second surface to document and test.

The case `--include` would serve and `--no-crawl` does not is "crawl, but only
under this prefix". That is worth its own proposal if anyone asks for it, and
it is not what the issue that prompted this one describes.

### 8. Does this change what `--max-pages` means?

No. The cap still counts pages checked, and exclusions are applied before the
cap sees anything. So `--exclude "/proposals/**" --max-pages 50` checks up to 50
pages from the 60 that survive exclusion, and reports the rest as skipped. The
two clauses in the footer are independent, and a run can carry both.

## Verification

- `test/a11y/exclude.test.ts` covers the matcher: a prefix pattern, a `**`, a
  pattern with no leading `/`, an empty list, and a pattern that matches
  nothing. Trailing slashes get their own cases, since they are the rule most
  likely to be got wrong. `/proposals/**` matches `/proposals/`, `/proposals`
  and `/proposals/0035/`. It does not match `/proposals-archive/`.
- `test/a11y/crawl.test.ts` gains cases for a link excluded, a sitemap URL
  excluded, one seed excluded, two seeds excluded and both named, and
  exclusion interacting with the `--max-pages` cap.
- `test/a11y/config.test.ts` covers the key: a list, a wrong type, a non-string
  entry, and an explicit `[]`.
- `test/a11y/cli.integration.test.ts` covers the flag against the built bin.
  Repeated occurrences, the flag replacing the key, both usage errors with
  their exit codes, and a comma-containing value read as one pattern.
- `test/a11y/reporters.test.ts` covers the footer clause at zero and non-zero,
  and that `-f github` emits nothing for an excluded page.
- The progress line is covered both ways. It is absent when nothing was
  excluded, and names the count and the pattern total when something was. No
  per-URL line appears in either case.
- `npm run docs:check-cli` covers the reference page against the commander
  program.
- Fixtures go under `test/fixtures/a11y/`, per the repository's rule that a
  feature needing sample input gets its own.

## Not breaking

- A run with no `--exclude` and no `a11y.exclude` behaves exactly as today.
- `summary.excluded` is additive, and is `0` on every run that excludes
  nothing. No existing key changes type or meaning.
- The `checked + skipped + duplicates === discovered` identity is preserved.
- No exit code moves for a run that excludes nothing.
- The pretty footer gains a clause only when the count is not zero, so existing
  output is byte-identical on a run with no exclusions.

## Consequences

- This repository can drop `/manni/proposals/**` and the per-domain proposal
  pages from its own gate, which is about 40 of 101 pages. Whether it should is
  a separate call, and is not made here.
- 0035's deferred `robots.txt` `Disallow` stays deferred, and stress test 6
  records that this does not substitute for it.
- A `--include` is not added, and stress test 7 records what would justify one.
- The crawl gains its first user-supplied filter. If a second one ever follows,
  the enqueue site is now the obvious place for it. `summary` also has a
  precedent for reporting what a filter removed.
