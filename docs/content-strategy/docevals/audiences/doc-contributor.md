---
id: aud-doc-contributor
type: audience
segment: Opened a pull request, hit a red manni docevals check
maturity: cross-cutting
docs_owner: Nobody, passing through
firmographics: [any-size, occasional-contributor, engineer-or-writer, no-tool-context]
relationship_stages: [customer]
personas: [persona-contributor]
features_emphasized:
  [format-github-annotations, finding-messages, judge-rationale, assertion-hash, review-command,
   deterministic-only]
evidence_basis: [docmeta-content-strategy, docevals-surface]
---

# Audience: Doc contributor

**Scope:** the highest-traffic and shallowest audience, someone whose pull request went red and who
wants it green. They did not install manni docevals, did not write the eval, and will not read the rest of
the site. Everyone else here configures the tool; this segment only ever *encounters* it.

## Who they are

An engineer shipping a feature and updating a page alongside it, or a writer making a routine edit.
They may be a frequent contributor to the repo and a first-time reader of this site. Their context on
manni docevals is whatever fit in the CI annotation.

By page views this will be the largest audience the site has, because every contributor who trips a
check lands on one page. By depth it is the shallowest: a single well-built page serves the entire
journey.

## What they're trying to do

Understand which check failed and why, make the smallest correct change, confirm it locally, and get
back to the work they were actually doing.

## Defining pains

- **They cannot tell which kind of failure they are looking at.** manni docevals has several with different
  remedies. There is a deterministic tool finding pinned to a line, and an AI verdict with a rationale
  but no line. There is an eval sitting in the human-review zone that they cannot resolve themselves.
  There is a stale `assertion-hash` meaning the generated script no longer matches its assertion. And
  there is an operational error that is not their fault at all. Sorting these is step one and nothing
  else works until it is done.
- **A judge rationale is not a remediation.** "The page promises unreleased functionality" identifies
  the problem without pointing at the sentence. The gap between rationale and edit is where this
  audience stalls.
- **Some failures are not theirs to fix.** A needs-review verdict requires `manni docevals review` from
  someone with standing; a stale hash may want regeneration rather than an edit. Being told to escalate, and to whom, is a real, correct outcome that the page must offer without
  shame.
- **Reproducing locally is not obvious.** The CI run had a provider key and a warm cache; their laptop
  has neither. `--deterministic-only` on a single file is usually the right local check, and they will
  not guess that.
- **They will not read the concept pages.** Any remediation that requires first understanding the
  grader hierarchy has failed this audience by construction.

## Buying constraints

Not a buying audience, but they are the segment most able to *kill* adoption. A contributor who is
blocked, confused, and unable to self-serve escalates to the docs team, and enough of that gets the
check removed. Serving this audience well is how the gate survives its first month.

## Qualified reader (for docs targeting)

- **Prerequisites they bring.** Git and pull requests; editing a Markdown file; reading a CI log.
- **Prerequisites they do not bring.** Anything about manni docevals. Assume zero. Every term used on their
  page must be defined inline or linked. The page must be reachable and useful from a cold start
  with no prior reading.
- **Subject dependencies.** None, deliberately. `fix/index.mdx` is the one page in the site that may
  not depend on any other page having been read. That is a hard constraint on how it is written, not a
  stylistic preference.
