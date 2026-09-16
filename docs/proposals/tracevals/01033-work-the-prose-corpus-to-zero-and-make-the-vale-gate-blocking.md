---
status: "accepted"
date: 2026-09-04
decision-makers: [hawkeyexl, Claude]
consulted: []
informed: []
---

# Work the prose corpus to zero, and make the Vale gate blocking

## Context and Problem Statement

The Moose Vale package arrived with a check that could not fail. `.github/workflows/vale.yml`
shipped with `filter_mode: added` and `fail_on_error: false`, and its own comment named the
condition for changing that. Flip it once the existing corpus is worked down.

The corpus was the reason. Measured against `origin/main` with the config as it now stands, the
repository carried **1,755 alerts across 89 of the 126 files Vale read there**. A blocking gate over a
corpus that size fails every pull request on prose nobody in that pull request wrote. So the check
annotated and moved on, which means it changed nothing anyone had to answer for.

`.vale.ini` states the scope in its own header. README, ADRs, CLAUDE.md, and the docs site are all
held to the same voice, with no section exemptions. That leaves one question with two halves. What
does the corpus have to reach, and what does the gate then read?

## Decision Drivers

- An advisory lint is a suggestion, and a suggestion that survives a year becomes the house style by
  default. Only a check that fails changes what lands.
- `.vale.ini` claims every document in the repository. A gate that quietly skips sections would make
  that header false, and the header is the thing contributors read.
- Fixture prose is test input. CI asserts on its bytes and runs `git diff --quiet` over the corpus,
  so rewriting a fixture for voice would break the assertion it exists to make.
- **`Direct.Length` reports a long sentence at the line it starts on.** An edit that lengthens a
  sentence often lands on a later line, so the alert can surface on a line the diff never touched.
- The package is fetched from `releases/latest/download/Moose.zip`, so the rule set can move without
  a commit in this repository.
- The package sets a severity per rule. `Moose.EmDash` is an error and `Voices.ColonReveal` is a
  warning, and those levels are part of the voice rather than an accident of packaging.
- Documented CLI output is captured, never composed (CLAUDE.md). The real reporters emit em dashes,
  and a sample rewritten to please a linter would stop being a sample.

## Considered Options

How far the remediation goes:

- Every file the config covers, then flip the gate
- Flip the gate now, and exempt the files that fail
- Leave the check advisory and document the voice instead

What the gate reads:

- The whole tree, on every pull request
- Only the lines a pull request added
- Only the files a pull request touched

Which severities block:

- Errors block, and warnings annotate
- Every alert blocks, warnings included

## Decision Outcome

The chosen option has three parts. **Remediate every file the config covers. Lint the whole tree on
every pull request. Fail on errors, and let warnings annotate.**

### One exemption, and it is about test input rather than about voice

`test/fixtures/**` is excluded with an empty `BasedOnStyles`, and the reason is written into
`.vale.ini` beside it. Fixture prose is the input a test asserts against, so its bytes are load
bearing. The exemption is also small. It silences six of the 1,761 alerts the tree carried, which
means the remediation was almost entirely real prose rather than test data.

No other **prose** is exempt. The docs site, the ADRs, `README.md`, `CLAUDE.md`, and everything
under `docs/content_strategy/` were rewritten to zero alerts.

Two more sections exclude generated text, and they are a different thing. **Vale does not read
`.gitignore`**, so `.tmp/**` and `moose-tracevals-*.txt` are named in `.vale.ini` directly. The
first is the scratch directory CLAUDE.md tells you to redirect test output into. The second is
dogfood output written to the repo root. Without them, `npm test > .tmp/output.txt` followed by
`vale .` fails on the test log. That papercut is aimed squarely at anyone following the
instructions.

### Captured output was left alone, because fences are skipped

Vale skips fenced code blocks, and every sample of CLI output in the docs sits in one. The reporters
in `src/reporters/` genuinely print em dashes, so the samples keep them. This is the one place where
the repository's prose rules and its own output disagree, and the disagreement is correct. A sample
is evidence about the tool, not a paragraph in the house voice.

The same reasoning moved one verbatim quotation in ADR 01016 into a code span. The quoted Claude
Code scope note contains an em dash. Rewriting a quotation to satisfy a linter would make it a
paraphrase wearing quotation marks.

### The gate reads the whole tree, not the diff

`filter_mode` moves from `added` to `nofilter`. Three cases decide it, and `added` misses all three.

| Case | What `added` does |
|---|---|
| An edit lengthens a sentence that begins on an untouched line | Reports nothing, because the alert anchors to the earlier line |
| A file is moved or renamed | Reports nothing about content that has not changed |
| A package release adds a rule | Applies the new rule only to lines added after it landed |

The third case is the one that decides the trigger as well. The `paths:` filter is dropped, so the
job runs on every pull request rather than only on those touching `.md`, `.mdx`, or `.vale.ini`. A
whole-tree lint should not depend on which files a pull request happens to change. A path-filtered
job also cannot be made a required check without blocking every pull request that skips it.

### Errors block, and warnings annotate

`fail_on_error: true` blocks on Vale's `error` level. `Voices.ColonReveal` is a `warning` upstream,
so it annotates without failing, and `Moose.EmDash`, `Direct.Length`, `Voices.Banned`,
`Voices.InflatedWords`, `Voices.BinaryContrast`, and `Direct.Preamble` block.

Escalating a warning to an error here would fork the voice definition, which is the thing
`.vale.ini` points at a package to avoid. The tree is at zero on warnings too, so the distinction
costs nothing today. It matters the first time a colon genuinely reads better than a full stop.

### Consequences

- Good, because the rule is now enforced rather than described. A pull request that adds an em dash
  or a 30-word sentence fails, and the annotation names the line.
- Good, because the whole tree is checked, so an edit cannot push a neighbouring sentence over the
  limit unseen.
- Good, because the corpus is at zero, so the first failure a contributor sees is their own.
- Good, because no code, no fixture, no schema, and no CLI output moved. The change is prose and one
  workflow file, and the test suite is untouched.
- Bad, because the package is fetched from `latest`, so an upstream release can turn a green
  repository red with no commit here. Pinning the package to a tag is the remedy if that ever bites,
  and it is deliberately not done pre-emptively.
- Bad, because remediation touched almost every document in the repository. A `git blame` on a
  paragraph now leads to a lint commit rather than to the decision that wrote it.
- Bad, because a 25-word ceiling pushes some technical sentences into two. A list of five clauses
  reads better as one sentence than as three. The trade is accepted, and the sentences that
  suffered are mostly in the Confirmation sections of older ADRs.
- Neutral, because warnings stay visible without blocking, so the gate can grow stricter later
  without a second remediation.
- Neutral, because the package scopes itself to `*.{md,mdx,txt}`. Comments in workflows, scripts,
  and TypeScript sources are outside the gate, and several still carry em dashes. Widening the
  scope to source comments would be its own decision, with its own corpus to work down.

### Confirmation

- `vale .` at the repository root reports `0 errors, 0 warnings and 0 suggestions in 127 files`.
  The count is one higher than the 126 measured on `main`, because this ADR is itself a file Vale
  reads. Run it on a clean tree, because Vale does not read `.gitignore`. A stray `.tmp/` left by an
  earlier test run inflates the total, even though the exclusions keep it at zero alerts.
- [vale.yml](../.github/workflows/vale.yml) is the gate. It runs on every pull request, reads the
  whole tree, and fails the check on any error.
- The remediation is a commit per area, so a reviewer can read the docs rewrite apart from the ADR
  rewrite.

## Pros and Cons of the Options

### Remediate everything, then flip the gate

- Good, because it is the only order that leaves the gate meaningful on the day it lands.
- Good, because it makes the first failure after the flip a genuine finding.
- Bad, because it is a large change to review, and the review is 89 files of prose.

### Flip the gate now, and exempt what fails

- Good, because new prose would be held to the voice immediately.
- Bad, because the exemption list is the corpus, so the gate would cover almost nothing.
- Bad, because it makes `.vale.ini`'s "no section exemptions" header untrue, and a stale header is
  worse than an absent one.

### Leave the check advisory

- Good, because it costs nothing and never blocks anyone.
- Bad, because an annotation nobody has to answer for is a suggestion. The corpus that motivated the
  advisory setting is proof of what happens next.

### Lint only the lines a pull request added

- Good, because every finding is unambiguously the author's own.
- Bad, because `Direct.Length` anchors to the line a sentence starts on, so the common case of
  lengthening an existing sentence goes unreported.
- Bad, because a new rule in a package release would apply only to lines added after it. The
  corpus would rot one rule at a time.

### Lint only the files a pull request touched

- Good, because it catches the lengthened-sentence case that `added` misses.
- Bad, because it still leaves package drift invisible until someone happens to edit the file.
- Neutral, because with the tree at zero it behaves identically to `nofilter` on almost every pull
  request. It buys nothing for the cases where they differ.

### Block on every alert, warnings included

- Good, because there would be one severity to reason about.
- Bad, because it re-grades the package's own levels in this repository, which is the fork
  `.vale.ini` exists to prevent. A change of severity belongs upstream in `moose-vale`.
