# 0088: Findings say what the template asks for

- **Status:** Implemented (#205)
- **Serves:** Two journeys.
  - Theo · T5, "Read a structure failure and fix it". A finding names what
    failed, but not what the section is for, so he edits until the check
    goes green.
  - Sara · S7, "Describe a doctype as a template". She writes a
    `description` on every rule, and no command ever shows it to anyone.
- **Depends on:** [0050](0050-lint-domain.md) for the domain and its rule ids,
  and [0061](0061-lint-template-grammar.md) for the template format and the
  cost model.
- **Supersedes in part:** [0061](0061-lint-template-grammar.md). The cost of
  a skipped rule and the reach of coercion both change, as decisions 1 and 2
  say.
- **Touches:** `src/lint/core/match.ts`, `src/lint/core/validator.ts`,
  `src/lint/core/template.ts`, `src/lint/commands/`, `src/lint/reporters/`,
  `src/lint/cli.ts`, `schemas/lint/template.json`, `templates/lint/tgdp/`,
  `plugin/manni/skills/fix/SKILL.md`, `docs/src/content/docs/lint/**`
- **Issue:** #202

## Problem

`manni lint structure` tells an author that a page does not match its template.
It never says what the template wants, or why. Every built-in rule carries a
`description`, and the templates reference called it "never checked". No
command printed it.

So authors change a page until the check passes. A `type: reference` page
passes once every H2 after the first has a table. Restructuring a reference
page therefore tends to mean adding a table to each section. The plugin's
`fix` skill could do no better. Its advice was to run `--explain`, and
`--explain` shows routing, not intent.

Two findings were also wrong, and both came from one bug.

- A concept page with `## How it works` before `## Use cases` reported
  `Missing section "Use cases"`. The section was present.
- A how-to with `## See also` followed by `## Troubleshooting` reported
  `Missing section "See also"`. The section at fault was Troubleshooting.

0061 prices a skipped required rule at 2, the same as an unexpected section.
The code charged 2 in raw units on an edge whose neighbours were scaled by the
square of the lattice's radix. Skipping a required rule was cheaper than one
wildcard match. The alignment dropped the rule and let a wildcard swallow the
sections, and the report blamed the section that was present.

The descriptions had a problem of their own. They were written for the
template's maintainer. One explained what "the matcher cannot tell" and cited
a proposal number. Shown to an author as written, they would add noise to
every finding.

## Decision

### 1. Skipping a present section costs what 0061 says

A required rule's section is **present** when a sibling carries a heading that
this rule accepts and no other named rule does. Skipping a present section
costs `skipRule`, weighed in the same units as every other edit.

Skipping an absent section keeps the old weight, below any wildcard match. The
cheap skip was wrong only when the section was on the page. When it is not,
the cheap skip says the section is missing, and the wildcard keeps the section
it took. Charging the full weight there too was tried, and it turned 193
missing-section findings in this repository's fixtures into coercions. A page
with no `See also` then read `Expected title "See also", but found "Rotate the
key"`, which sends the author to rename a task.

This changes reports only where a present section was reported missing, and
only on pages that already fail.

### 2. Coercion is for a renamed heading

A required rule with `max: 1` may still claim a section whose heading it
rejects. It may not do so when its own section is present. Coercion exists so
a misspelt heading reads as one finding. When the real section is present, the
mismatch is about order, and a heading finding would send the author to
rename the wrong section.

Decisions 1 and 2 change the cost model and the coercion 0061 describes, which
is why this proposal supersedes it in part.

### 3. A section out of order is `section-order`

`manni:lint/structure/section-order` names a section the template accepts,
but not where it stands. It replaces a finding the alignment already made, so
it never fails a page that passed. A section is out of order in three cases.

- A named rule that matched nothing accepts the section's heading. The
  section was left unexpected, or a wildcard took it while that rule went
  missing.
- A required wildcard went missing, and it accepts a section left unexpected.
  A how-to with `See also` before its only task reads this way.
- The section was left unexpected, and a wildcard later in the rule list
  accepts it.

Otherwise a wildcard earlier in the list does not count. A section after the
template's last rule stays `unexpected-section` when every earlier slot is
filled. The alternative reading treats a stray `Troubleshooting` as one more
task section, which guesses at what the author meant.

The message names the neighbour to move past, for example
`Section "How it works" must come after "Use cases"`.

### 4. Every finding carries its rule

A finding about a section carries that section's rule, which means its `id`
and its `description`. It also carries the template's id and its guide. A
missing section carries the missing rule, a count finding the rule the section
matched, and an order finding the rule that accepts the section. An unexpected
section has no rule, so it carries the template alone.

JSON gains one `template` object per error and renames nothing, because
docevals parses that shape. Pretty and GitHub output append the same two
lines under the message. SARIF puts them in the result's message and its
property bag.

### 5. `guide` is a template key

A template may name the guide its authors should read. It sits beside
`title`, `types` and `extends`, and `extends` inherits it. Every finding from
the template carries the one link. The built-ins point at The Good Docs
Project's `guide_<doctype>.md` at the pinned release.

### 6. A description is written for the page's author

The templates reference now says a rule's `description` is shown to authors.
The built-ins were rewritten to match. Each says in one or two sentences what
the section is for, drawn from the upstream guide. The maintainer's reasoning
moved, unedited, into a YAML comment above the rule. Every built-in rule now
has a description, the trailing catch-alls included.

### 7. `manni lint templates show` prints the shape

`manni lint templates show <ref>` takes the refs `--template` takes. It prints
the template as an outline, with each section in order, how often it may
occur, its heading, its content minimums and its description. `-f json`
prints the resolved template in the format's own keys. `-f markdown` prints a
page skeleton for an author starting from scratch.

## What was rejected

- **The full skip weight everywhere.** It is what 0061 wrote down, and it
  breaks the report for a page that simply lacks a section. Decision 1 gives
  the reasoning.
- **A `guide` on every section rule.** The upstream guides have a heading per
  section, so per-section anchors were possible. One link per doctype is
  simpler to keep correct when the pin moves, and the description already
  carries the per-section intent.
- **`info.guide`.** `info` is file-level and free-form, and one file can hold
  several templates. A template key covers exactly one template.
- **A new key for author guidance beside `description`.** That would leave two
  keys for one concept, and the existing one was already the right name.
- **Rule descriptions in SARIF's `fullDescription`.** A SARIF rule is one per
  finding type, and one type spans many template rules. The description
  belongs on the result.
- **A `--verbose` flag for the new lines.** No lint verb has one. The lines are
  what an author needs, so they show by default.

## Consequences

- Good, because an author reads what a section is for beside the finding
  that names it.
- Good, because a misplaced section reads as one move, not as a missing
  section that is present.
- Good, because `templates show` answers "what does this doctype want"
  without opening a YAML file.
- Bad, because a page that already failed may now fail with a different rule
  id. A CI filter keyed on `missing-section` sees fewer of them.
- Bad, because a description is now interface. Rewriting one changes what
  every author of that doctype reads.
