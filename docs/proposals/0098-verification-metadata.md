# 0098: Verification metadata, and how any tool writes manni metadata

- **Status:** Implemented
- **Serves:**
  - Maya · M5, and a new M30, "Show readers when a check last proved a
    page". A passing procedure test leaves nothing behind once the job ends.
  - Sara · S1, and a new S16, "Let another tool write metadata the family
    reads". A tool author has no page that says where a value goes.
- **Depends on:** [0047](0047-field-location.md) for `x-manni-location`,
  [0051](0051-graph-domain.md) for `x-manni-graph-output`, and
  [0085](0085-test-domain-runs-doc-detective.md), which runs Doc Detective.
- **Supersedes:** No proposal. Each decision here is new.
- **Touches:** `src/meta/schemas/` (four new versions),
  `src/meta/core/schema-registry.ts`, `src/meta/core/resolve-schema.ts`,
  `src/cite/core/page.ts`, the two vocabulary reference pages, a new
  `meta/integrate/` page, a new `test/` page, and the content strategy.

## Problem

`manni test run` proves a procedure works, and the proof is gone when the
job ends. A reader or an agent sees `last-updated`. That date says when the
text changed. It does not say whether the text still works.

Each verifying tool invents its own key. Doc Detective's unmerged #417
writes `doc-detective.verified.date`. A link checker or a sample runner would
write something else. manni cannot read any of them as one fact.

Nothing records who wrote a value. `meta-provenance` exists, and it means
that a model proposed a value no person has reviewed. A measured result is a
different thing, and that meaning is wrong for it.

A pin has nowhere to record a test either. A sentence pinned to source lines
can be proved by a test that runs that code. The citation entry has no field
for when that last happened.

## Decision

1. **Two fields with one meaning, at two levels.** `verified-by` lists the
   checks that verify a thing. `last-verified` is the date by which every
   listed check had passed. A page carries them in `manni:stewardship:1.2.0`.
   A citation entry carries them in `manni:citations:1.1.0`. The names and
   shapes match at both levels.
2. **An entry is `{ tool, check?, version?, passed? }`.** `tool` is required.
   It is the verifier's package name or a URL. `check` is the verifier's own
   id for the test, spec or rule. The author writes it, and a tool looks for
   it. A tool writes `version` and `passed` on a pass, and only then. An entry
   with no `check` means the tool verifies the whole thing however it does.
   The entry is closed, so a misspelt key fails.
3. **`last-verified` is the oldest `passed`.** It is set only once every
   entry has passed at least once. One lagging check holds it back, so it
   never claims more than every check proved. A tool writes it in the same
   write as its own entry.
4. **A date is a day or a timestamp.** That is `YYYY-MM-DD`, or RFC 3339 with
   seconds and a required timezone. A month alone fails. Doc Detective writes
   UTC days.
5. **The inputs are shared.** The author's declaration is a `verified-by`
   entry, not a key under the tool's name. A tool finds its work by the
   entries that name it, so a page carries no tool-specific keys.
6. **A measured fact is attributed in `verified-by`.** `meta-provenance` keeps
   its meaning: values a model proposed that no person has reviewed. The
   interop guide states the general rule. A proposal goes to
   `meta-provenance`. A measured fact goes to its field's companion, which is
   `verified-by` here and `reviewed-by` for a review. Derived and managed
   fields belong to manni.
7. **Both page fields are `x-manni-location: page`.** A badge and an agent
   read them there. Neither carries `x-manni-graph-output: false`, so a
   published graph carries both. The tool names are a fact an agent can
   weigh, and they name tools, not people. The fields inside a citation
   entry follow their vocabulary.
8. **manni writes none of these fields.** It defines them, validates their
   form and serves them. `meta derive` does not compute `last-verified`, and
   `test run` writes neither field. Doc Detective, which `test run` invokes,
   writes them.
9. **The defaults move.** The default set carries `manni:stewardship:1.2.0`
   in place of 1.1.0, and `manni:citations:1.1.0` in place of 1.0.0. Optional
   fields break no page that validated before, so this is a `feat`. Published
   versions stay immutable, and a config that pins an older version keeps it.
   `manni cite check` validates an entry against `manni:citations:1.1.0`, so a
   verified pin is not an `entry-invalid`.
10. **The strict overlays refuse a repeated entry.** `manni:stewardship-strict:1.2.0`
    and `manni:citations-strict:1.1.0` set `uniqueItems` on `verified-by`.
11. **No staleness rule and no consistency rule.** Nothing flags an old
    `last-verified`, or one that disagrees with its entries. The age is shown,
    not judged. Each rule would be a separate decision.

## The interop guide

A new page, `meta/integrate/write-metadata-from-a-tool.mdx`, tells a tool
author how to write any manni metadata so the family reads it. It has ten
rules.

1. Read the vocabulary first. `manni meta schemas show` prints each field's
   type and marks.
2. Write a field where it lives. A `page` field goes in front matter, and an
   `external` one in the manifest the collection names.
3. Attribute what you write. A measured fact goes in its companion field, and
   a proposal goes in `meta-provenance`. Never write `provenance`.
4. Never write a derived or managed field.
5. Write a date as a UTC day, or as RFC 3339 with a timezone.
6. Write on success only.
7. Write without churn. Change a value only when it differs, keep the
   block's style and key order, and make each write idempotent.
8. Validate after writing, and fail the job on exit 1.
9. Write a pin's fields on its citation entry, and never touch its hashes.
10. Doc Detective's write-back is the worked example.

## Consequences

- `manni meta schemas` lists four more built-ins. Each one's reference page
  documents it.
- A baseline entry recorded under `manni:stewardship:1.1.0` or
  `manni:citations:1.0.0` fingerprints under that id. The new versions add
  keys, so they are not annotation-only, and such an entry does not carry
  across the move. The same held when `manni:ai-context:1.1.0` became a
  default.
- Doc Detective changes its #417 to read and write this shape, and drops
  `doc-detective.verified.*`. That work is tracked in Doc Detective.
- The provenance record of a later proposal reads these fields, so an agent
  sees `verified 2026-10-21 (doc-detective)` beside `updated`.

## Stress test

1. **Two checks, one lagging.** Doc Detective passes on the 21st and a link
   checker on the 22nd. `last-verified` is the 21st, the day by which both
   had passed. The newest pass would let a link check vouch for a procedure
   that broke.
2. **A tool writes a local time.** `passed: 2026-10-21 14:02` has no `T` and
   no offset. Validation fails at that line, and the finding quotes the date
   rule.
3. **An entry with no `tool`.** Validation fails, and the guidance line says
   that each entry names the verifier in `tool`.
4. **A page with several tests.** Doc Detective's page specs can hold several
   tests, each with its own id. The plan required `tool` values to be unique
   under strict. JSON Schema cannot compare one member's key with another's,
   so that rule cannot ship as a schema. It would also refuse one tool with
   two checks, which a page with several tests needs. Strict refuses a
   repeated entry instead, the part of the rule a schema can state.
5. **A pinned config.** A config that lists `manni:stewardship:1.1.0` keeps
   it, and `verified-by` passes through that version unchecked.
