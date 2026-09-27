# 0066: strict overlays for the proposed vocabularies

- **Status:** Proposed
- **Serves:** Sara · S1, "Define our metadata standard as a schema". She
  adopts the 0023 drafts for a corpus her team owns. She wants the standards
  the drafts only recommend to be enforced.
- **Depends on:** [0023](0023-metadata-vocabularies.md), whose drafts the
  overlays narrow. [0044](0044-citations-and-drift.md), for citations.
  [0063](0063-the-graph-vocabulary.md), for the `graph` draft.
- **Touches:** `docs/proposals/0023/schemas/*-strict/1.0.0-proposal.1.json`
  (new), `docs/proposals/0044/schemas/citations-strict/1.0.0-proposal.1.json`
  (new), `test/strict-schema.test.ts` (new),
  `test/fixtures/strict-schema/**` (new)
- **Verdict:** Every proposed vocabulary gets a strict overlay, a second
  schema that holds only the constraints strict adds. A team stacks it beside
  the open draft. The open drafts do not change.

## Problem

The drafts claim each key at the loosest lawful definition. That is the
composability law in 0023, and it is right for a shared default. A page
valid for its own generator has to stay valid when these schemas join it.

The cost is that the drafts recommend standards they never enforce. `language`
says BCP 47 and accepts `english_US`. `locale` accepts `en_US`. Dates accept
`2026` alone. `owner` accepts any string, though CODEOWNERS accepts three
forms. The review pages already ask about this one field at a time. The core
page asks whether `locale` should reject `en_US`.

A team that owns its whole corpus has no second claimant to stay compatible
with. For that team the loose floor is only a gap.

## Decision

### An overlay, stacked

Each vocabulary gets `manni:<family>-strict:1.0.0-proposal.1`, stored beside
its draft as `<family>-strict/1.0.0-proposal.1.json`. The overlay repeats
none of the draft. It holds only what strict adds.

A team adopts strict by listing both refs.

```yaml
meta:
  schemas:
    - docs/proposals/0023/schemas/core/1.0.0-proposal.4.json
    - docs/proposals/0023/schemas/core-strict/1.0.0-proposal.1.json
```

`validate` checks a page against each schema on its own, and a finding from
either fails the file. So an overlay can only narrow its draft, and the two
cannot drift apart. A full copy of each draft would need a test to prove that
much. A `$ref` from the overlay to its draft does not resolve, because only
bundled built-ins are registered for reference resolution.

A finding names the schema ref that produced it, so a strict-only failure
reads as one.

```text
✗ page.md
    /language  must match pattern "^(?:(?:[A-Za-z]{2,3}…)$"  (line 4)  [docs/proposals/0023/schemas/core-strict/1.0.0-proposal.1.json]
```

No flag, config key, message or exit code changes.

### Rules every overlay keeps

1. **Patterns, never `format`.** Three Ajv instances read these schemas.
   Only `validate`'s has ajv-formats, so a `format` would pass under `fill`
   and fail under `validate`. ajv-formats has no BCP 47 format in any case.
2. **No location marks.** The draft owns `x-manni-location`. An overlay that
   carries none cannot contest it.
3. **No new required keys at the root.** Strict constrains the form of a
   value that is present. Requiring a key stays the team's own decision.
   Nested entry objects may require their members.
4. **The root stays open.** A page stacks several vocabularies, so no overlay
   closes it.
5. **Only claimed keys.** An overlay constrains keys its draft claims and no
   others.

### What each overlay adds

Named patterns:

- **BCP47.** The RFC 5646 well-formed tag, plus a private-use `x-` tag. It
  accepts `zh-Hant-TW` and `th-TH-u-ca-buddhist`, and rejects `en_US`.
- **KEBAB.** `^[a-z0-9][a-z0-9-]*$`.
- **TRIM.** One line with no leading or trailing space.
- **REF.** A page id, path or URL on one line with no surrounding space. A
  path may contain spaces and backslashes, as `docs/Getting Started.md` and
  `docs\Operator Architecture.md` do.
- **DATE.** An RFC 3339 full date. **DATETIME** adds a time with seconds and
  an offset.
- **HANDLE.** A form a CODEOWNERS file accepts. That is `@user`,
  `@org/team`, a GitLab nested group, a GitLab `@@role`, or an email.
- **PTR.** An RFC 6901 JSON pointer.
- **MODEL.** A model id with no spaces,
  `^[A-Za-z0-9][A-Za-z0-9._:/\\@-]*$`. It keeps the case a provider
  publishes, so `GPT-4o` and `hf:unsloth/Qwen3.5-4B-GGUF` pass. It admits a
  backslash, so a Windows path to a local `.gguf` model passes too.

| Vocabulary | Field | Strict adds |
|---|---|---|
| core | `language`, `locale` | BCP47 |
| core | `title` | TRIM |
| core | `description` | no leading or trailing space |
| core | `id`, `type` | KEBAB |
| core | `keywords` | a list only, at least one item, unique, each TRIM |
| audience | `audiences`, `personas`, `journeys` | KEBAB |
| audience | `intent` | one line |
| lifecycle | `replaced-by`, `supersedes` | REF |
| lifecycle | `remove-by` | DATE |
| stewardship | `authors` | a unique list of TRIM names or objects that carry `name` |
| stewardship | `owner` | HANDLE |
| stewardship | `stakeholders`, `reviewed-by` | TRIM |
| stewardship | `created`, `last-updated`, `last-reviewed` | DATE or DATETIME |
| stewardship | `verified-against` | an object entry carries `name` and `version` |
| stewardship | `source-of-truth` | an object entry carries `path` or `url`; a string is REF |
| structure | `applies-to`, `not-applicable-to` | a label with an optional `prefix:` |
| structure | `prerequisites`, `next-steps`, `related-pages` | REF |
| terminology | `label`, `see` | TRIM |
| terminology | the entry | `definition` and `see` never together |
| ai-context, artifact-evals | `meta-provenance[].generated-by` | MODEL |
| ai-context, artifact-evals | `meta-provenance[].fields`, `confidence` keys | PTR |
| ai-context | `risks` | the seven advisory values, closed |
| evals, artifact-evals | `model` | MODEL |
| evals, artifact-evals | `provider` | KEBAB |
| evals | `eval-suite`, `use` | KEBAB |
| evals, artifact-evals | `success-exit-codes` | unique, 0 to 255 |
| evals, artifact-evals | `target.path` | relative, with no leading `/`, `\` or `~`, drive letter or scheme |
| evals, artifact-evals | `generated-assertion-hash` | `sha256-` and 64 hex digits |
| artifact-evals | `grader` | the ten named graders, or `tool:<name>` |
| graph | `sections` keys | a heading slug, with no uppercase letter or space |
| graph | `revision-of`, `derived-from` | REF |
| citations | `source.commit-sha` | a full 40 or 64 digit hash |
| citations | `source.integrity` | `hmac-sha256-` exactly when `file` is encrypted |

### Identical in both

- **`provenance[].generated-by`.** derive writes a commit trailer's name, such
  as `Claude Opus 5.5` or `dependabot[bot]`. MODEL would reject what the tool
  writes.
- **Hashes stay hex.** Every pin the family writes is `sha256-` and lowercase
  hex, not SRI base64.
- **Closed enums stay as they are.** `visibility`, `lifecycle` and the iiRDS
  values in `graph` are closed in the drafts already.
- **`concepts`.** A concept is a term label, and labels contain spaces.
- **`review-interval`.** Its ISO 8601 pattern is already strict.
- **What JSON Schema cannot say.** A date against today, the order of two
  dates, and disjoint `applies-to` lists stay the tools' checks.
- **No length limits.** No overlay invents a `maxLength`.

## Stress test

1. **An `en_US` locale.** Open passes it. Strict reports `/locale` from the
   core-strict overlay, and nothing from core.
2. **A string that the open draft allows as a list.** `keywords: a, b` passes
   open. Strict reports `/keywords`, because strict takes the list form only.
3. **derive's own output.** derive writes `YYYY-MM-DD` dates and copies
   CODEOWNERS entries into `owner`, which DATE and HANDLE accept. It also
   fills `reviewed-by` from two sources. One is a review API's bare login,
   such as `maya` or `claude[bot]`. The other is a commit trailer's name, such
   as `Jane Reviewer`. HANDLE rejects both, so `reviewed-by` takes TRIM, and
   `stakeholders` matches it. A strict schema that fails the tool's own
   output would teach teams to drop it.
4. **A key the overlay constrains but the page omits.** Nothing fires. The
   overlay adds no root `required`.
5. **The composability ladder.** `compat-check.cjs` pins each draft at its
   loosest lawful claim. Strict breaks that law on purpose, and the ladder
   stays about the open drafts.
6. **A heading in a script without case.** A slug such as `安装` has no
   lowercase letter. The `sections` key pattern admits caseless letters and
   combining marks, so Han, Arabic and Devanagari headings pass. It spells
   them as Unicode property escapes such as `p{Lo}`, which need the
   ECMA-262 `u` flag. Ajv sets that flag for a 2020-12 schema. A validator
   that does not reads `p` as a literal `p`, so the pattern's
   description names the requirement.
7. **A pin recorded by `manni cite`.** `add` and `update` record
   `git rev-parse HEAD`, a full hash. All 4,173 `commit-sha` values in this
   site's manifests are 40 digits long.
8. **A model id in mixed case.** The llama-cpp provider takes an `hf:`
   reference or a `.gguf` path as its model, and `fill` writes it into
   `generated-by` as given. Providers publish ids such as `GPT-4o` too.
   MODEL accepts either case and a Windows path separator, so it rejects only
   whitespace and stray punctuation. A narrower rule would fail the tool's
   own output.
9. **A path with a space in it.** A URL never holds a raw space, but a file
   path can. REF therefore rejects only a value that spans lines or carries
   surrounding space. `target.path` rejects a leading `~` as well, because a
   shell expands it to the home directory.
10. **`english` as a language.** It passes. RFC 5646 allows a language subtag
   of four to eight letters, so the tag is well formed. Rejecting it would
   check the registry, which a pattern cannot do.

## Open questions

1. **Promotion.** Should an overlay register as a built-in id with its draft,
   so a team names `manni:core-strict:1` instead of a path?
2. **Review pages.** Each family's page under `meta/proposals/` could list
   its strict rows beside the open ones.
