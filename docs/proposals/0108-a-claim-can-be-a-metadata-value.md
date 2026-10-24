# 0108: A claim can be a metadata value

- **Status:** Implemented (#242)
- **Serves:** Two people.
  - Sara · S20, "Rest each persona on evidence that still holds", a new
    journey. She owns `docs/content-strategy/`, and nothing ties a persona's
    pains to what they rest on.
  - Maya · M5, "Pin a claim and catch it going stale". A pin now reaches a
    claim that lives in a field.
- **Depends on:** Seven proposals.
  - [0044](0044-citations-and-drift.md) is the pin: an entry with a claim end
    and a source end, each placed and hashed.
  - [0046](0046-provenance-pins.md) names a metadata value by JSON Pointer, as
    `meta-provenance` spells it.
  - [0058](0058-a-manifest-per-page.md) and
    [0060](0060-a-manifest-per-page-as-built.md) keep pins in a sidecar beside the
    page.
  - [0098](0098-verification-metadata.md) is the versioning path an optional
    field takes, with a predecessor map so baselines carry across.
  - [0100](0100-citations-from-more-than-one-checkout.md) cites a file in another
    checkout through `cite.repos`.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    made audiences, personas and journeys records.
- **Supersedes in part:** [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md),
  its line "Nothing copies their prose into the schemas' descriptive fields",
  for a persona's goals and pains.

## Problem

The four personas and four audiences under `docs/content-strategy/` are
claims, and nothing ties any of them to what they rest on. `theo.md` says
error messages give no remediation hint. `contributors.md` said its audience
is the highest-traffic one by page visits. Neither named a source.

This repository holds its own record of measured friction. 0089's Problem
table shows the exact unhelpful output Theo met. 0041 shows one glob spelled
three ways, and 0001 shows the hand-kept ratchet. Every check was green over
the records all the same, because none of them looked.

The persona schema already has `goals` and `pains` lists, one claim per item.
But `manni cite` pinned body lines only, and refused a frontmatter line with
"A claim is body text." So the one structured place for a claim was the one
place it could not be pinned.

meta already addresses a value without copying it. `meta-provenance` names
each value by JSON Pointer, and `meta get` reads one. What was missing was
cite taking a pointer as a claim's place, with a hash of the value as its pin.

## Worked example

Sara moves Theo's goal and pains out of the body into `goals:` and `pains:`.
She gives the `strategy` collection a `{page}.citations.yaml` manifest and
names `manni:citations:1.3.0` on the persona override. She adds `citations` to
the persona schema's `required`, so a record with no pin fails.

```text
$ manni cite add docs/content-strategy/personas/theo.md:10 docs/proposals/0089-findings-say-what-to-do.md:35
manni: docs/content-strategy/personas/theo.md:10 is in the frontmatter. Cite the value there as docs/content-strategy/personas/theo.md#/pains/0.

$ manni cite add docs/content-strategy/personas/theo.md#/pains/0 docs/proposals/0089-findings-say-what-to-do.md:35 --id terse-messages
docs/content-strategy/personas/theo.md: added terse-messages to docs/content-strategy/personas/theo.citations.yaml:3 (claim at /pains/0, sha256-fc979f4d…; source docs/proposals/0089-findings-say-what-to-do.md:35 "| Theo · T2 (cite) | …", sha256-3361f9a5…, 74e30a3)

$ manni cite check docs/content-strategy/personas/theo.md
✓ docs/content-strategy/personas/theo.md   docs/content-strategy/personas/theo.citations.yaml
    ✓ terse-messages   #/pains/0 current   docs/proposals/0089-findings-say-what-to-do.md:35 current
```

She reorders the pains, and the pin reads `claim-moved`, a notice. `manni
cite update` rewrites the pointer. An edit to the cited proposal line reads
`source-changed` and fails the run.

## Decision

1. **A claim's place is lines or a pointer, never both.** On a record, a
   citation's `claim` takes `pointer` in place of `lines`. It is an RFC 6901
   pointer into the page's own metadata, escaped as `meta-provenance`
   escapes it. The root and anything under `/citations` are refused.
2. **The pin is the value's canonical JSON.** It is the SHA-256 of the
   value's RFC 8785 JSON, as UTF-8. Every object's keys sort by code unit, and
   a string is hashed with its quotes. One rule covers a string, a list and a
   mapping, whatever format wrote the value.
3. **The command line spells it `record#/pointer`.** `#` and a pointer is RFC
   6901's fragment form, which `$ref` uses too. The split happens only when
   no file has the whole name and the file before `#/` is a record.
4. **`check` reads it in four steps.** The value at the pointer holds the pin:
   `current`. The pin sits at one other pointer: `moved`, a notice. It sits
   at several: `moved-ambiguous`, a warning. The pointer names no value, or
   another entry's pinned value: `missing`, under the new rule
   `claim-missing`, a warning. Anything else is `changed`, a warning.
5. **Findings sit on the value's line.** The extractor maps each pointer to
   its line. A missing value's finding sits on its nearest parent.
6. **`update` repairs what it can.** A moved pointer is rewritten in place.
   `--accept` re-pins a changed value, judged by word overlap against the
   value at its baseline commit. `--only` overrides that refusal. Missing and
   moved-ambiguous are skipped, each with its remedy.
7. **The vocabulary gains a version.** `manni:citations:1.3.0` adds
   `claim.pointer`, with `manni:citations-strict:1.3.0` in lockstep. 1.2.0
   stays in the default set. A finding under 1.3.0 hashes as 1.2.0's, so a
   baseline carries across.
8. **This repository's records rest on evidence.** Each persona's goals and
   pains move into `goals:` and `pains:`. Every persona and audience pins
   what it has evidence for, and both schemas require `citations`.

## Records only

The feature runs only where personas and journeys are defined. A record is a
page whose own metadata declares `type: audience`, `type: persona` or `type:
journey`. The test is per page, so a repository with records keeps every
other page's behaviour.

On every other page, each command prints what 4.20.0 printed, byte for byte.
`cite add <page>#/<x>` reads the whole argument as a path and reports the
file missing. A frontmatter line keeps "A claim is body text." A pointer
entry is `entry-invalid` under 1.2.0's words. A body-line finding keeps its
rule descriptions.

Three surfaces describe the tool rather than run over content, and they
change everywhere. They are `cite add --help`, the registry's list of
built-ins, and the cite and vocabulary reference pages.

## Known limits

- **Private evidence needs the key and the checkout.** A declared checkout
  that is absent stops a bare `cite check`. A missing key makes every
  encrypted pin `source-missing`. The public job runs `--no-check-sources`.
- **A pointer reads the page's own metadata.** A value a `{page}.meta.yaml`
  manifest owns is out of reach.
- **An encrypted value is refused.** A claim's pin is public.
- **Without git, `--accept` has no baseline.** It re-pins whatever the
  pointer holds. The `missing` guard still catches the common shift.
- **Page grain.** One pin satisfies `required: [citations]`. A never-pinned
  pain is not reported.
- **No evidence age check.** cite judges drift, not age.
- **Pointers on records only.** A site page cannot pin its own
  `description`.
- **A record's `type` must be on the page.** A `type` held only in a manifest
  does not make a record.
- **cite reads 1.3.0 on records only.** An override naming 1.3.0 on a site
  page lets `meta validate` accept a pointer entry there. `cite check` still
  reports it `entry-invalid`.
- **No stdin pointer form.** `-#/pains/0` would need the bin's argv rewrite,
  which changes what `-#…` does in every repository.

## What was rejected

| Option | Verdict |
|---|---|
| Body-only claims, with goals and pains as body bullets | Rejected. The structured place for a claim is where a reader and an agent read one claim at a time. |
| Claim lines into the frontmatter, counted as file lines | Rejected. Any frontmatter edit, the pin's own stamp included, would move every claim. |
| `page.md:/pains/0` | Rejected. After `:` the `/` reads as a path segment. |
| A `--pointer` option | Rejected. A claim's place rides on the page operand in every form. |
| Hashing a string as text and other values as JSON | Rejected. Two rules where one covers every value. |
| `missing` folded into `changed` | Rejected. `--accept` can re-pin a changed value and cannot re-pin a missing one. |
| A new `anchor: "pointer"` value in JSON | Rejected. The entry's own claim end anchors it, which `"claim"` already says. |
| Recording evidence in `meta-provenance` | Rejected. `meta-provenance` means values a model proposed that nobody reviewed. |
| A strategy rule, `unevidenced-record` | Rejected. It is presence, and 0102 gave presence to meta. |
| 1.3.0 in the default set | Rejected. It would change the schema label every repository's citations run under. |
| Pointer claims on every page | Not under this proposal. The scope rule limits the feature to records. |
| Gating on the repository having records | Rejected. Its site pages would change. The page test keeps them byte for byte. |

## Not breaking

1.2.0 is unchanged and stays the default. A document with no `pointer` gets
the same findings under 1.2.0 and 1.3.0, and the predecessor maps carry every
baseline across. `test/cite/fallback.test.ts` runs the built bin over pages
that are not records. It compares the output with snapshots captured from the
4.20.0 build before any source edit. The new rule `claim-missing` fires only
on a pointer claim.

## Verification

- `test/cite/pointer.test.ts` covers the add refusals, each classification,
  the history baseline and diff, the reporters and `update`.
- `test/strategy/evidence.integration.test.ts` runs the whole path over a
  fixture with a research folder and no git.
- The dogfood runs this repository's own records. Bare `manni meta validate`
  and `manni cite check --collection strategy` are clean.
