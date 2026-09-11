# 0044: citations and drift: pin a claim to the lines it rests on

- **Status:** Implemented (#17)
- **Serves:** Devin · D4 · Theo · T1 · Maya · M2 · Sara · S1
- **Depends on:** [0023](0023-metadata-vocabularies.md), the family this
  vocabulary joins as its tenth id, and whose `source-of-truth` is the
  page-grain anchor this refines to the line. [0033](0033-manni-monorepo.md),
  the umbrella a sibling domain mounts under, and the rule that siblings import
  the metadata tool as a library. 0034, the command grammar from the a11y
  session, on its own branch: `manni <domain> <subcommand>`, no default
  subcommand, one separator per list. [0026](0026-corpus-checks-are-findings.md),
  the precedent for a finding no Ajv keyword produced, with a rule id, riding
  meta's reporters and baseline. [0041](0041-collections.md), the family-level
  `collections:` list this tool reads its document set from, and the
  `--collection` flag it shares; see stress test 21
- **Relates to:** [0001](0001-validation-baseline.md), the baseline a new rule
  ramps in on. [0008](0008-remote-schema-durability.md), for the offline
  discipline: no network, ever. [0022](0022-sql-write-back.md) and
  [0025](0025-query-dry-run-polarity.md), the write-in-place and
  writes-by-default precedents `update` follows. [0020](0020-element-metadata.md),
  the both-channels-are-validated rule that decides how frontmatter entries and
  inline statements coexist. [0021](0021-frontmatter-as-a-database.md), for
  `lineFor`, which is how a frontmatter entry gets a line number.
  [0045](0045-family-encryption-key.md), the family encryption key private
  sources are encrypted with, and the `manni key` domain that sets and
  rotates it; see stress test 23. [0037](0037-sidecar-metadata.md) and
  [0039](0039-sidecar-join.md), the external-metadata manifest a collection
  may keep its citations in, and the field it joins on; see stress test 25
- **Touches:** `src/cite/**` (new), `src/cli.ts`, `src/index.ts`,
  `src/meta/internal.ts` (new), `src/shared/{cli-options,color,warn}.ts`,
  `eslint.config.js`, `scripts/check-cli-reference.mjs`,
  `docs/proposals/0044/**`, `docs/src/content/docs/cite/**` (new),
  `docs/src/content/docs/meta/proposals/{citations,frontmatter-vocabularies}.mdx`,
  `docs/content-strategy/{cujs,information-architecture}.md`,
  `docs/astro.config.mjs`, `manni.config.yaml`, `test/cite/**`,
  `test/fixtures/cite/**`, `test/helpers/temp-repo.ts`
- **Verdict:** Add `manni:citations:1.0.0-proposal.1` to the 0023 family, and
  ship `manni cite` (`check`, `add`, `update`) as the sibling domain that
  implements it. A citation pins a sentence to source lines by a hash and a
  commit. The check classifies each pin as current, moved, changed, never true
  or missing, from git alone, with no model and no network. Citations live in
  frontmatter or inline in the body's comment syntax. A private source can be
  cited by its path encrypted under the family key of
  [0045](0045-family-encryption-key.md), with a keyed pin. One PR, three
  feature commits.

## Problem

`source-of-truth` (0023, stewardship) promises "the anchor a drift check
compares the page against", and nothing implements the check. It could not do
much if something did: the field names a file, and a page rests on sentences,
not files. When `lib/limits.ts` changes, the question is not whether the page
that names it should be re-read end to end. It is which sentence on that page
just stopped being true, and every sentence that did not.

Gleb Lukicov's "Your documentation is a build artifact" (2026-08-28) records
the answer generated docs already use. For each snippet, that is the source
range, a hash of those bytes and the commit. A check then sorts every citation into
CURRENT, MOVED or CHANGED at zero tokens, and only CHANGED costs a person or a
model. This family has the two halves of that and has never joined them. evals
carries `generated-assertion-hash`, a hash-as-lockfile over an assertion. The
config's schema entries carry `integrity:` pins. Neither reaches prose.

The transcript below is the intended one; the fixture is being built alongside
this record, and the verification pass makes it literally true. The page pins
one sentence to `src/limits.ts:2` and the source has since changed under it.
Metadata validation is the wrong tool and says so by passing:

```console
$ node dist/cli.js meta validate -s docs/proposals/0044/schemas/citations/1.0.0-proposal.3.json test/fixtures/cite/pages/source-changed.md
✓ test/fixtures/cite/pages/source-changed.md

1 file checked, 1 passed, 0 failed, 0 errors
# exit 0
```

Green is correct. The entry is well-formed, and well-formed is all a schema can
say about a hash. Whether the pin still holds is a comparison against the
source, and that is the check this proposal adds:

```console
$ node dist/cli.js cite check --root test/fixtures/cite test/fixtures/cite/pages/source-changed.md
✗ test/fixtures/cite/pages/source-changed.md
    ✗ fetch-timeout   :15 current   src/changed.ts:2 changed

1 file checked, 0 passed, 1 failed, 1 finding
# exit 1
```

Line 15 is the sentence. Not the page, not the file: the sentence. The claim
end is current, so the prose did not move. The source under it did.

## Summary

- **A vocabulary**, `manni:citations:1.0.0-proposal.3`, published by meta as the
  tenth member of the 0023 family. One page key, `citations`, and a closed
  entry of two blocks. `claim` and `source` are each a line range and a hash.
  The drafts live at `docs/proposals/0044/schemas/citations/`, with the example
  ladder beside them; `proposal.1` and `proposal.2` are kept.
- **Markers**: an entry's id, written in the body in the format's comment
  syntax. That is the way Doc Detective's inline statements are written. A
  marker anchors the rest of its own line, else the paragraph that follows it.
  It is the alternative to claim lines, never a second copy of the entry.
- **A sidecar**: a collection may keep its citations in an external-metadata
  manifest (0037, 0041) instead of frontmatter. Nothing on the page then
  repeats the entry, and a public page carries no YAML it did not ask for.
- **Encrypted sources**: `source.file` holds `~` and at least 82 base64url
  characters in place of a path. The path is encrypted under the family key of
  0045, as any other value is, and the pin over it is keyed and reads
  `hmac-sha256-`. A public docs repo can cite a private code repo without
  publishing its paths, and without publishing a verifier for its lines.
- **A tool**, `manni cite`, a sibling domain under the umbrella: `check`
  classifies, `add` mints, `update` rewrites moved pins in place. Findings ride
  meta's reporters and baseline under `manni:cite/<rule>`.
- **A contract**: the hashing rule, the search regimes, the statuses and their
  severities, and one output rule. The output rule is that output never says
  more than the page did.

The vocabulary is meta's; the behaviour is cite's. That split is 0033's:
meta publishes what a page may say, and a sibling implements what it means.
docevals is the first integration, as a `tool:cite` grader, and owes its own
record for that.

## The vocabulary

Draft 2020-12, root open, `citation-` prefix guarded exactly as evals guards
`eval-`. One page key, and an entry of two blocks that share one shape:

```yaml
citations:
  - id: fetch-timeout                # anchored by its claim lines
    claim:
      lines: 3                       # body lines, counted after the frontmatter
      integrity: sha256-c41f09aa…
    source:
      file: lib/limits.ts
      lines: 2
      integrity: sha256-78af1d33…
      commit-sha: 3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182
  - id: retries                      # anchored by a marker, which pins what it anchors
    claim:
      integrity: sha256-0b7e…
    source:
      file: ~AQx7Vb2…
      lines: 5
      integrity: hmac-sha256-5e0c…
  - source:                          # a bare pin: the page rests on this file
      file: lib/limits.ts
      integrity: sha256-aebba92f…
```

| Key / field | Type | Required | Meaning |
|---|---|---|---|
| `citations` | list of entries, `minItems: 1` | no | The page's citations. Omit the key rather than write `[]`. |
| `id` | `^[a-z0-9][a-z0-9-]*$` | no; yes when a marker names the entry | Unique per page, tool-enforced. What a marker names, and what a finding and `update --only` use. |
| `claim` | block | no | The page text the citation supports. Absent, the entry is a bare pin, or a marker with no drift check on its sentence. |
| `claim.lines` | `L` or `"L1-L2"` | yes, unless a marker names the entry | Lines of the page **body**, counted from the first line after the frontmatter. A page with no frontmatter counts from its first line. |
| `claim.integrity` | `^sha256-[0-9a-f]{64}$` | **yes**, inside `claim` | The claimed lines hashed under the rule below. Always plain, never keyed: the page is public. With a marker, it pins the lines the marker anchors. |
| `source` | block | **yes** | The lines the claim rests on. The only required member of an entry. |
| `source.file` | root-relative posix path, or `~` and at least 82 base64url characters | **yes** | The file. A `~` value is the path encrypted with the family key of 0045; draft `proposal.1` spelled it `~<16 hex>`. |
| `source.lines` | `L` or `"L1-L2"` | no | File lines. Absent pins the whole file. Readable even when `file` is encrypted. |
| `source.integrity` | `^(?:sha256\|hmac-sha256)-[0-9a-f]{64}$` | **yes**, inside `source` | The pin. It reads `hmac-sha256-` exactly when `file` is encrypted, so the page carries no verifier for a guessed private line. |
| `source.commit-sha` | `^[0-9a-f]{7,64}$` | no | The git commit hash the pin was taken at. Sixty-four covers a SHA-256 repository. The tool writes the full hash; a person may type seven. |
| `quote` | boolean, default false | no | The claim is a fenced block that reproduces the cited lines. |

The entry is closed, and so is each block. There is no `dependentRequired`: a
bare entry of `source` alone is legal, and stress test 13 says why. The
`source.file` grammar rejects a leading `/` or a drive letter, a backslash,
`.` and `..` segments, and an empty segment. It also rejects a URL, and an
encrypted path that is too short or leaves the base64url alphabet. It accepts
spaces and dots inside a segment, so `docs/release notes/v1.2.md` is a file.
Neither `lines` form has a line 0. `L2 >= L1` is the tool's rule, because a
pattern cannot compare two numbers. The ladder pins that the schema accepts
`"9-3"`, so nobody later "fixes" the regex into something unreadable.

**Removed** in `1.0.0-proposal.3`: the top-level `src` and `integrity`, the
entry `commit`, the page-level `citation-commit`, `claim` as a string, and the
inline JSON entry. The page root still rejects any other `citation-*` key, so
a typo fails loudly.

**Why the claim is pinned in body lines.** The entry usually lives in the file
it numbers. With file lines, adding a tag by hand or with `meta fill` would
move every claim on the page. Two branches adding citations to one page would
then conflict on every `lines:` value. Body lines never move for a frontmatter
edit. What people see stays file lines: the command line
(`cite add docs/limits.md:9`), every `(line N)`, and every report translate.
Only someone reading the YAML sees the difference.

**The hashing rule** is stated once here and once in the schema's `integrity`
description, and nowhere else. It is one rule for both ends. Decode UTF-8.
Strip one leading BOM. CRLF to LF. Split on LF. Drop the empty element a
trailing LF leaves. Take lines L1 to L2 inclusive, 1-based, or every line for
a bare file. Join with LF, no trailing LF. Keep trailing whitespace. A plain
`source.file`, and every `claim`: `sha256(text)`, prefixed `sha256-`. An
encrypted `source.file`: HMAC-SHA256 of the text under the pin subkey 0045
derives from the family key, prefixed `hmac-sha256-`. Hex either way. The
prefix follows `file`, and any other pairing is `entry-invalid`. The goldens
are verified with node and asserted by the drift ladder. Line 2 of the fixture
is `78af1d33…fe4b1f`, and lines 1-3 are `d2981e71…bed1d6`. The whole file and
lines 1-7 are both `aebba92f…86e023`, and the CRLF copy of line 2 hashes
identically.

**The encryption rule**: `source.file` is an ordinary encrypted value. The
path is spelled exactly as a plain path would be spelled, then encrypted under
the family key in the `cite-src` context. The token format is the one 0045
gives the family. `source.lines` stays readable beside it, so the ciphertext
covers a whole value rather than half a string. 0045 states the construction and the
format once, for every tool. The key comes from `MANNI_ENCRYPTION_KEY`, else a
top-level `encryptionKey:` in the config. With no key, `add` writes no
encrypted form, so stress test 22's empty-salt form is gone. `source.file`
never carries `x-manni-encrypt`, or every plain source would fail
`meta validate`. The encryption is deterministic, so a public site reveals how
often a private file is cited and when it moves. That is recorded as accepted:
the alternative is a per-page context, which makes `update` unable to
recognise one file across two pages.

**Why a pin is not a derivable fact.** Principle 4 of the family says a
derivable fact lies, and a hash of lines that sit right there looks derivable.
It is not. A pin is a record of the past: what the lines were when the
sentence was written. Recompute it on every run and there is nothing left to
compare against. The check *is* the comparison between the record and the
present. That is the same object as `generated-assertion-hash` and the
config's `integrity` pins, under the same spelling.

## Markers

A marker names an entry by its id. One keyword, `cite`, one payload, in the
format's own comment syntax, mirroring Doc Detective's `fileTypes.ts`, which
treats `.md` and `.mdx` alike:

| Format | Forms |
|---|---|
| markdown, mdx | `<!-- cite fetch-timeout -->`, `{/* cite fetch-timeout */}`, `[comment]: # (cite fetch-timeout)` |
| html, xml | `<!-- cite fetch-timeout -->` |
| asciidoc | `// (cite fetch-timeout)` |
| rst | `.. (cite fetch-timeout)` (manni's own form; Doc Detective has none) |

The payload must match the id grammar. `cite true` names the id `true`, so it
is `marker-orphan` when no entry has that id. A payload starting with `{` is
`marker-invalid`, and its message says where the entry belongs:
`A marker names an entry by id. Write the entry in frontmatter or the sidecar.`
Anything else is `marker-invalid` too.

The inline JSON entry is gone. An entry lives in frontmatter or in the
sidecar, so a source is never written into the body. That is what lets a
public page carry markers over a private code base with nothing to redact.

The scanner is `indexOf` over the open and close delimiters, never a regex over
the page, and it runs only over the body. `page.ts` slices from the end of the
frontmatter and passes the offset and line, so a `cite` inside YAML is never
matched.

**Anchor**: the rest of the marker's line if non-blank, else the paragraph
that follows, through the next blank line or fence. With `quote: true`, the
next fenced block (```` ``` ```` or `~~~`; `----` in asciidoc). html, xml and
rst have no fence locator in v1, so a `quote` there never finds its block:
`quote-drift` under a marker, `anchor-invalid` under claim lines. Text is
matched whitespace-normalized against the paragraph, so a soft-wrapped
sentence still matches; `add`, `check` and `update` share the one search.

**Rules**: a marker naming no entry is `marker-orphan`. Two markers naming one
id are `marker-repeated`, and the first anchors. A marker moves with the text
it anchors, so a marker-anchored claim is never `claim-moved`. When the
entry's `claim` carries an `integrity`, the marker's text is pinned, and an
edit to it is `claim-changed`. A marker and `claim.lines` on one entry are
`anchor-invalid`: keep one. Caps: 500 markers per page and 5,000 lines per
range; beyond those, `marker-invalid` and `entry-invalid`. Meta's `validate`
sees the frontmatter channel, and the manifest channel through external
metadata. cite validates the entries itself, with Ajv against a bundled copy
of the draft entry schema, and this record is where that is said.

## Citations in a sidecar manifest

An entry lives in the page's frontmatter, or in an external-metadata manifest
(0037, 0041) the collection declares. There is no new config key. A collection
that lists a manifest owning `citations` keeps its citations there:

```yaml
collections:
  - name: site
    paths: ["docs/**/*.{md,mdx}"]
    externalMetadata:
      - file: docs-citations.yaml   # relative to the config file; a local file, never a URL
        keys: [citations]
```

The manifest is keyed by page path, or by a page field under `join:`:

```yaml
docs/limits.md:
  citations:
    - id: fetch-timeout
      claim: { lines: 3, integrity: sha256-c41f09aa… }
      source: { file: lib/limits.ts, lines: 2, integrity: sha256-78af1d33… }
```

**Reading.** `check`, `update`, `add` and `manni key rotate` read a page's
citations from the manifest that owns them, through meta's existing merge.
Which manifest owns a page is decided by every collection in the config,
whatever `--collection` or the positional paths select. So a page checked by
path still finds its sidecar. `--no-config` reads frontmatter only.

**Writing.** `add`, `update` and `key rotate` edit the manifest in place. They
splice only that page's `citations` value, so every other byte of the file is
unchanged, and they read the file back to confirm it. `update` writes each
manifest once per run. These are the first writers of a manifest; `meta fill`
and `meta query` stay read-only.

**Where findings sit.** A claim or marker finding sits on the page line, where
a reviewer reads it. A finding about the entry itself sits on the manifest and
the entry's own line. That covers `entry-invalid`, and a bare pin whose source
changed. It needs meta's manifest loader to keep per-item lines, where today it
keeps only the owned key's line. SARIF drops a location outside the repository,
so a manifest outside it is reported on the page instead.

**Refused, following meta's rules**, each exit 2:

- A URL manifest that owns `citations`, since cite writes citations. It would
  also put private paths into public CI output.
- A page in two collections whose manifests both own `citations`.
- Two pages sharing one `join:` value, which is meta's duplicate rule.
- A manifest entry naming a page that is gone, such as after a `git mv`, which
  is meta's orphan rule on a whole-collection run.
- A page that still carries its own `citations:` while a manifest owns the key.
  That is meta's `external:owned` in `validate`, and `entry-invalid` here.

```
manni: A page read from stdin has no path, and its citations live in docs-citations.yaml, which is keyed by path.
manni: docs/limits.md is in collections site and api, and both keep citations in a manifest.
manni: manni.config.yaml: collection site: citations cannot come from a URL manifest, because cite writes them.
```

**Public docs over private code.** The sidecar sits in the docs repository with
`source.file` encrypted, as frontmatter does today. The public job runs
`--no-check-sources`, and now also checks the claim ends, since those are
page-side.

## The drift-check contract

**Statuses.** A citation has two ends, and each end carries a status.
`current` and `skipped` are statuses, not rules, so neither appears in
`severity:`. A source end is `skipped` when `--no-check-sources` or
`checkSources: false` turned that check off, and a skip is not a finding. The
claim end is page-side and runs either way. Every other status has a rule of
its own.

**Rules.** Fourteen, and `severity:` takes exactly these names:

| Rule | Was | Default | Meaning |
|---|---|---|---|
| `source-moved` | `moved` | warning | The pinned source text is found once at other lines. `update` rewrites `source.lines`. |
| `source-moved-ambiguous` | `moved-ambiguous` | error | Found at several places in the file. |
| `source-changed` | `changed` | error | Not found, and the pin held at `commit-sha`. |
| `source-never-true` | `never-true` | error | Not found, and it did not hold at `commit-sha` either. |
| `source-missing` | `missing` | error | The file is gone, or does not decrypt under the current key. |
| `claim-moved` | new | notice | The pinned page text is found verbatim at other lines, so nothing drifted. `update` rewrites `claim.lines`. |
| `claim-moved-ambiguous` | new | warning | The pinned page text is found verbatim at several places. `update` skips it. |
| `claim-changed` | replaces `claim-missing` | warning | The pinned page text is gone, so the sentence was edited. `update --accept` re-pins it. |
| `marker-orphan` | `statement-orphan` | error | A marker names an id no entry has. |
| `marker-invalid` | `statement-invalid` | error | A malformed marker, including one carrying a JSON payload. |
| `marker-repeated` | the second use of `claim-ambiguous` | warning | Two markers name one id; the first anchors it. |
| `anchor-invalid` | new | error | The anchor cannot work. Three cases, below. |
| `entry-invalid` | same | error | A schema failure, a pin prefix that does not match `file`, a duplicate id, or a page `citations:` a manifest owns. |
| `quote-drift` | same | error | The quoted block no longer reproduces the source. |

Config can move any rule to `error`, `warning`, `notice` or `off`: the family
scale, plus `off`. A warning or a notice never touches the exit code.

`anchor-invalid` has three reachable cases, and each names the entry:

- `fetch-timeout has claim lines and a marker. Keep one.`
- `fetch-timeout: quote needs a claim or a marker.`
- `fetch-timeout: the quote's claim lines 14-18 are no longer a fenced block.`

A fourth case was drafted, for claim lines that point into the frontmatter.
Body-relative lines cannot, so it survives only as an `add` refusal.

**`claim-changed` defaults to warning**, not error. It fires on any edit to a
pinned paragraph, including a typo fix beside the cited sentence, and that
would block prose work for nothing. A team that wants every edit to a cited
sentence reviewed sets it to `error`. `claim-ambiguous` is gone: a pinned range
cannot be ambiguous on the page it was taken from.

**Economics.** Two search regimes, and both are local. The claim end costs no
git at all: the page is right there, and its search is the move search over
the body. With git, a non-match on the source end with a `commit-sha` costs
one `git show` of the file at that commit, memoized per
commit and path. The original text then drives the move search
(candidate-by-first-line, then a lexical compare, then the hash). Without git,
or without a commit, the search is a window of 2,000 lines either side of the
pinned range. Then it is the rest of the file under a 64 MiB budget, past
which the result carries `truncatedSearch`. `git show` runs only on a
non-match, so a clean corpus costs one hash per citation. No model, no
network, ever.

**Output never says more than the page did.** A finding, in every format,
spells a source exactly as the page spelled it: `~AQm4…:4`, never the
decrypted path. Diffs, commit subjects and decrypted paths live on
`CitationResult` and reach output only through the pretty reporter under
`--show-diff` and `--reveal`. A sentinel test runs every reporter against a
fixture whose private path is `private/SECRET.ts`, and asserts that neither
the path nor the key appears.

**Repair is scoped by the finding.** A move on either end is mechanical, and
`update` rewrites `source.lines` or `claim.lines`. `source-changed` names the
sentence, the range and, with history, the commits since, and a person decides
whether the prose or the pin is wrong. `claim-changed` names what the page now
says, and `update --accept` re-pins it. A
`changed` finding that recurs is promotable by hand to an `ai` eval, whose
assertion is the claim. That is where the family's model spend belongs, on the
one sentence a zero-token check could not settle. The PR job runs
`--baseline`, report-only, and a scheduled sweep escalates. This is not a
pre-commit hook: a pin can go stale in a commit that touches no page.

**Identity.** `ruleId = "manni:cite/" + rule`. `manni:cite` matches
`BUILTIN_ID`, so `canonicalSchemaRef` leaves it alone. The fingerprint inputs
are `schema: "manni:cite"`, `keyword: rule`, `instancePath` (`/citations/N`
for an entry, `""` for a page-level finding) and
`subject: id ?? source.integrity`. The claim's pin is never the subject, or
accepting a claim would reopen every baselined finding on that citation.
Stress test 19 is why the subject is the integrity and not the source.

## The tool

`manni cite` is a sibling domain in `src/cite/`, config key `cite:`, mounted by
the umbrella with `addCommand`. No default subcommand. It imports
`../meta/index.js` and a new family-private barrel `../meta/internal.js`, and
an eslint rule stops it reaching into `../meta/{core,extractors,reporters}`.

| Command | Does | Exit |
|---|---|---|
| `check [paths...]` | classify every citation; report through `pretty`, `json`, `github`, `sarif`, `junit`; `--baseline` and `--write-baseline` as meta's, in `.manni-cite-baseline.json`; `--no-check-sources`, `--root <dir>`, `--show-diff`, `--reveal` | 0 clean, 1 an unbaselined error, 2 operational |
| `add <page>[:L\|:L1-L2] <src>` | mint an entry at HEAD and write it. The page lines are the claim, and `--marker` writes a marker above them instead. `--quote` says those lines are a fenced block reproducing the source. `--id <id>` names the entry, and is required with `--marker`. Whenever an encryption key is available it writes an encrypted `source.file` and a keyed pin. `--encrypt` asks for that form, and prompts for a key when none is available (0045). Also `--no-commit-sha` and `--dry-run` | 0 written, 2 refusal |
| `update [paths...]` | rewrite moved entries in place on either end. The edit is textual, so comments and quoting survive. `--accept` re-pins a changed claim, and re-mints `source-changed` and `source-never-true` at HEAD, printing both pins. Also `--only <id>` and `--dry-run` | 0, 1 when work is left undone, 2 under `--no-check-sources` |

Private sources are encrypted with the family's key, and its verbs are the
family's too. `manni key set` writes it, and `manni key rotate` re-encrypts
cite's sources beside meta's values (0045). `manni cite salt set|rotate` held those
verbs until stress test 23.

The input surface is meta's: positional paths, `-` with `--as`, the
configured collections as the fallback and `--collection <name>` to narrow to
one, `--ext`, `--exclude`, `-c`, `--no-config`, `--allow-empty`,
`--no-gitignore`. The document set is the family's top-level `collections:`
list (0041); `cite.paths` and `cite.exclude` are refused with a message saying
so. Config `cite:` holds the keys below. `obfuscate` was a key until stress
test 22, `salt` until stress test 23, and `git` and `sources` until stress
test 24. `cite.salt` is refused with a message naming `manni key set`.

| Key | Type | Default | Mirrors | Meaning |
|---|---|---|---|---|
| `root` | string | the git root, else cwd | `--root <dir>` | Where `source.file` paths resolve from, relative to the config file. |
| `baseline` | string | none | `--baseline [path]` | The citation baseline. Setting it turns `--baseline` on. |
| `checkSources` | boolean | `true` | `--no-check-sources` | Check citations against their sources. `false` runs the page-side rules only, every source status is `skipped`, and `update` refuses it. |
| `severity` | map, one of the 14 rule names to `error \| warning \| notice \| off` | the defaults above | none | Per-rule severity: the family scale, plus `off`. |
| `allowEmpty` | boolean | `false` | `--allow-empty` | As meta's. |
| `respectGitignore` | boolean | `true` | `--no-gitignore` | As meta's. |

There is no key or flag for git. It is used whenever it is available: git on
`PATH` and the root inside a work tree. Sources are then indexed by
`git ls-files`, else by a directory walk, and a run that would have used git
warns once (stress test 24). An unknown key, rule or level is a `CiteError`
that names what is supported and never echoes the value. `--root` defaults to
`cite.root` from the config, else the git root, else cwd, and may point at
another checkout.

The condensed ladder. A row is the claim end, then the source end, both in
file lines, and then the manifest when one owns the entry. A pin prints
abbreviated to eight hex characters, a commit to seven. The label is the
entry's `id`, and empty when it has none:

```console
$ manni cite check docs/limits.md
✓ docs/limits.md
    ✓ fetch-timeout   :9 current   lib/limits.ts:2 current
    ✓                              lib/limits.ts current
# exit 0

$ manni cite check                                      # lib/limits.ts gained two lines above
⚠ docs/limits.md
    ↕ fetch-timeout   :9 current   lib/limits.ts:2 moved -> lib/limits.ts:4
# exit 0

$ manni cite update
docs/limits.md: fetch-timeout source lib/limits.ts:2 -> lib/limits.ts:4 (moved)
# exit 0

$ manni cite check --show-diff                          # the line itself changed
✗ docs/limits.md
    ✗ fetch-timeout   :9 current   lib/limits.ts:4 changed since 3f9c2a1, 1 commit
        raise fetch timeout to 30s
        -export const FETCH_TIMEOUT_MS = 10_000;
        +export const FETCH_TIMEOUT_MS = 30_000;
# exit 1

$ manni cite check                                      # and the sentence was edited
⚠ docs/limits.md
    ↕ fetch-timeout   :9 changed   lib/limits.ts:4 current
# exit 0

$ manni cite check -f github
::warning file=docs/limits.md,line=9,title=manni:cite/claim-changed::fetch-timeout: the claim at line 9 has changed since it was pinned
# exit 0

$ manni cite check --no-check-sources docs/             # public docs repo: claim ends and markers
✓ docs/limits.md
    ✓ fetch-timeout   :9 current   ~AQm4…:2 skipped
# exit 0

$ MANNI_ENCRYPTION_KEY=… manni cite check --root ../code --reveal docs/
✓ docs/limits.md
    ✓ fetch-timeout   :9 current   ~AQm4…:2 (lib/limits.ts) current
# exit 0

$ manni cite add docs/limits.md:9 lib/limits.ts:2 --id fetch-timeout
docs/limits.md: added fetch-timeout to frontmatter (claim at line 9, sha256-c41f09aa…; source lib/limits.ts:2, sha256-78af1d33…, 3f9c2a1)
# exit 0

$ manni cite add docs/limits.md:30 lib/limits.ts:8-12 --id timeouts --marker
docs/limits.md: added timeouts to frontmatter; marker at line 30, claim pinned at line 31
# exit 0

$ manni cite add docs/limits.md lib/limits.ts                       # a bare pin
docs/limits.md: added a bare pin to frontmatter (source lib/limits.ts, sha256-aebba92f…, 3f9c2a1)
# exit 0

$ manni cite add docs/limits.md:2 lib/limits.ts:2
manni: docs/limits.md:2 is in the frontmatter. A claim is body text.
# exit 2

$ manni cite add docs/limits.md:9 lib/limits.ts:2 --claim "The fetch timeout is 10 seconds."
error: unknown option '--claim'
# exit 2
```

`--claim` and `--inline` are gone. The page lines replace the first, and
entries no longer live in the body, so nothing needs the second. Where an
entry is written, frontmatter or manifest, follows the config and not a flag.

The two-repo layout, which is the reason encrypted sources exist:

```yaml
# public docs repo: manni.config.yaml (public)
collections:
  - name: site
    paths: ["src/content/docs/**/*.{md,mdx}"]
    externalMetadata:
      - file: docs-citations.yaml   # the entries; the pages carry nothing
        keys: [citations]
# no encryptionKey here: MANNI_ENCRYPTION_KEY supplies it, and a key turns
# encryption on (stress tests 22 and 23; this example first carried
# `cite: {obfuscate: true}`, then relied on MANNI_CITE_SALT)
# public CI:   manni cite check --no-check-sources
# private CI:  check out docs and code side by side; from the docs checkout:
#              MANNI_ENCRYPTION_KEY=$SECRET manni cite check --root ../code -f sarif
```

The pages stay where the docs are so SARIF URIs resolve; the sources are
reached through `--root`. The public job is no longer page-side in name only.
The claim ends live on the page, so `--no-check-sources` still catches a
sentence edited out from under its citation.

## Stress test

What was tried against this design, and what each attempt changed.

### 1. The field was `sha256` before it was `integrity`

The first draft named the pin field after its algorithm, which is what
`generated-assertion-hash` does by implication. Then a second algorithm is a
second field, and a page with both is two facts about one range. The config's
schema entries already solved this with `integrity: sha256-…`, and so did
Subresource Integrity.

**Changed as a result:** the field is `integrity`, and its value carries a
`sha256-` prefix. The pattern closes the algorithm set at one, so a future
`sha512-` is a schema revision, not a silent acceptance.

### 2. `add --claim` with a sentence the page does not contain

The first `add` wrote the entry and let `check` report `claim-missing` on the
next run. That is a tool minting a pin it already knows is broken. The person
who typed the sentence with a typo learns about it from CI.

**Changed as a result:** `add` runs the same claim search `check` runs. It
refuses (exit 2) when the claim occurs zero times, naming the page and the
sentence. Two or more occurrences are a refusal too, naming the lines, and the
remedy is `--id` plus a reference statement above the intended paragraph.

### 3. A one-line pin over a repeated line

`export const RETRIES = 3;` appears twice in a real file more often than one
would like. A move search that returns the first equal window silently
rebinds the pin to whichever copy comes first, and `update` writes that in.

**Changed as a result:** two or more equal windows are `moved-ambiguous`, an
error, listing the candidates as `(:4, :11)` and telling the person to widen
the range. `update` never touches an ambiguous entry. The drift ladder pins
the case with two comment lines inserted above and a copy of lines 1-3
appended.

### 4. A whole-file pin that "moved"

The search treated a bare `path` as a range of 1-N and looked for that window
elsewhere in the same file. It can only ever find it at line 1.

**Changed as a result:** a whole-file entry has nowhere to move to and never
reports `moved`; it is `current`, `changed`, `never-true` or `missing`. The
ladder holds this against the MOVED variant.

### 5. `moved` at error severity blocked every PR that touched a source file

A two-line insert above a cited line turned every page citing anything below it
red, on a change that altered nothing the pages said.

**Changed as a result:** `moved` is a warning, `update` is its one-command fix,
and warnings never affect the exit code. The same goes for `claim-ambiguous`.
Meta's `FieldError` gains an optional `severity` in a preparatory commit, with
the invariant that a result is `ok` iff it holds no error-severity entry. The
reporters render `⚠`, `::warning` and SARIF `level` accordingly.

### 6. `path:1-7` and `path` are the same bytes and were two pins

The first hashing rule kept the trailing LF for a whole-file pin and dropped it
for a range. So pinning "the whole file" two ways gave two hashes.

**Changed as a result:** one rule. Lines are joined with LF and never
terminated, so `mint(SOURCE, 1, 7) === mint(SOURCE)`, and the ladder asserts
it. A file's trailing newline is not a line.

### 7. A URL, a drive letter, and a cross-repo path as `src`

`https://github.com/x/y/blob/main/lib/limits.ts#L2` is a tempting source, and so
is `../other-repo/lib/limits.ts`. The first cannot be hashed without a network
and the second walks out of the root.

**Changed as a result:** the `src` grammar fails both at the schema, plus
`C:/x`, `\`, `./`, `..`, an empty segment and line 0. The regex probes in the
citations ladder run it under node against every one. A source in another
checkout is reached by `--root`, not by a path that leaves the root.

### 8. Which directory is the root

`src:` is repo-root-relative, and the first implementation resolved it from
cwd, so `cd docs && manni cite check` broke every pin.

**Changed as a result:** the root is `--root`, else `cite.root` from the
config, resolved against the config file's directory, else the git root, else
cwd. Sources resolve through
`git ls-files` under a realpath containment check, so a symlink out of the root
is `missing`, not read. Without git, a walk that does not follow symlinks.

### 9. `actions/checkout` defaults to depth 1

A `changed` classification wants the file at `commit`, and a shallow clone does
not have it. The first draft treated an unknown commit as `never-true`, which
is a lie about the pin.

**Changed as a result:** an unknown commit degrades to `changed (history
unavailable: commit 3f9c2a1 not found; fetch-depth: 0)`, with one notice per
run. `never-true` is asserted only when git can actually show the range at
that commit and it does not hash to the pin.

### 10. CRLF and a BOM

A Windows checkout with `core.autocrlf` turned every pin `changed`. The
config's schema pins diagnose an encoding mismatch after the fact with a
message. A citation check runs on every push and cannot afford a page of false
`changed` findings on one platform.

**Changed as a result:** normalization is part of the hashing rule, up front:
one leading BOM stripped, CRLF to LF. The ladder asserts the CRLF copy of line 2
hashes to the plain one, and that a BOM does not enter the hash. Trailing
whitespace is deliberately kept: a trailing space is a change, and the ladder
holds that too.

### 11. Three markdown statement forms, and a JSON payload in parentheses

Doc Detective accepts `<!-- -->`, `{/* */}` and `[comment]: # ( )` in markdown,
and the first scanner accepted a JSON payload in all three. A JSON object ends
in `}` and the parenthesised form closes on `)`, so `{"a": ")"}` closed early
and anything with nested parentheses closed late.

**Changed as a result:** the parenthesised forms (`[comment]: # (…)`,
asciidoc's `// (…)`, rst's `.. (…)`) accept an id only; a `{` there is
`statement-invalid`. JSON lives in the two forms whose close delimiter cannot
occur inside a JSON string unescaped. The drift ladder holds every form.

### 12. `citation-commit` beside an entry `commit`

A page minted in one sitting carries one commit forty times, and the first
draft had only the entry field. Adding a page default raised the question of
which wins when both are present.

**Changed as a result:** both exist, the entry's wins for that entry, and the
rule is stated in both descriptions. The citations ladder holds a page with
both. There is no third place a commit can come from.

### 13. A bare `{src, integrity}` with no claim, id or quote

`dependentRequired` could force every entry to anchor something. Then
`source-of-truth` at line granularity, which is a legitimate thing to want
(this page rests on these lines; tell me when they change), has no spelling.

**Changed as a result:** the bare pin is legal, and it is checked source-side
only. The record says why both it and `source-of-truth` exist. They answer at
different grains, and a page can name its source long before anyone pins a
sentence. `add` refuses `--inline` and `--id` on a bare pin, since nothing
anchors it.

### 14. Seven hex digits was enough until it was not

The one-screen example wrote a seven-digit commit, and a seven-digit
abbreviation that is unique today is not guaranteed to be next year.

**Changed as a result:** the pattern accepts seven to forty, the tool writes
forty, and the pretty reporter shows seven. A person may type seven.

### 15. A renamed file

`git mv lib/limits.ts lib/config/limits.ts` leaves every pin pointing at a
path that no longer exists. Following renames through git history is possible,
costs a `git log --follow` per citation, and guesses.

**Changed as a result:** a rename is `missing`, an error, and `add` is the
remedy. The move search is within one file only. This is the honest answer: a
pin names a path, and the path is gone.

### 16. Public docs over private code

The user's case: a public docs site whose pages cite a private repository. The
first design was a manifest: a private file mapping tokens to paths, checked in
beside the code. It was rejected, because a manifest is a second thing to keep
in sync and a second thing to leak. Then four leaks in the design itself, each
closed:

- **The path.** `src` becomes `~<16 hex>`, derived from a salt and the path, so
  the page carries no path and no manifest.
- **The line.** A plain pin over a short private line is a verifier: a reader
  can hash guesses. The pin over an obfuscated source is keyed,
  `sha256(salt + "\n" + text)`, so the page carries nothing a reader can check
  without the salt.
- **The output.** A finding that printed the resolved path beside the token
  would put the path in the SARIF the public CI uploads. Every reporter spells
  the source as the page spelled it. The resolved path reaches only the pretty
  reporter, only under `--reveal`, and the sentinel test proves it across
  formats.
- **The resolver.** A token that resolves against an arbitrary directory walk
  is a probe: point `--root` at `/` and see what matches. Sources resolve
  through tracked files only, under realpath containment.

**Changed as a result:** all four, plus the accepted residue stated in the
vocabulary section. Tokens are stable, so a public site reveals how often a
private file is cited and when it moves.

### 17. A frontmatter entry and an inline statement for the same sentence

The first draft gave frontmatter precedence over inline. 0020 already decided
this for element metadata. Both channels are validated and neither wins,
because a precedence rule turns one channel into a silent override of the
other.

**Changed as a result:** both channels are validated, and a collision is a
finding (`claim-ambiguous` for two anchors on one id) rather than a tiebreak.
`add --inline` and `add` without it write to different channels and never both.

### 18. A soft-wrapped claim

Prose wraps at 80 columns. A `claim` matched line by line found nothing, and
every citation on a wrapped page was `claim-missing`.

**Changed as a result:** the search is paragraph-scoped and whitespace-
normalized, and the ladder holds a claim found across two lines. Punctuation is
not whitespace. The ladder also holds that a comma where the claim has a full
stop is a miss. That is what caught the plan's own example (item 20).

### 19. What the baseline fingerprint is made of

The first fingerprint included `src`. Then `update` rewriting a `moved` entry
from `:2` to `:4` changed the fingerprint, and a baselined `changed` finding on
that entry came back as new.

**Changed as a result:** the subject is `id ?? integrity`. Integrity survives a
move and a line shift; it changes only on re-mint, which is the act that
resolves the finding. The `adapt` test holds a fingerprint stable across a
move.

### 20. The ladders were run against the plan's own examples

Two examples in the plan this record was written from failed their own
ladders. The one-screen "40-hex" commit was 65 hex digits, and the schema
refused it. The one-screen page pinned `claim: The fetch timeout is 10
seconds.` above a body that reads `…10 seconds, and it is`, and the claim
search could not find it.

**Changed as a result:** the ladders carry the corrected examples, with a
comment at each saying what the plan had. Neither rule moved: forty means
forty, and verbatim means verbatim. A ladder that only held the cases the
design was written around would not have caught either.

### 21. 0041 landed while this branch was open

This record gave `cite:` its own `paths` and `exclude`, mirroring what
`meta:` had when it was written. Proposal 0041 then moved the document set
out of every tool's section and up to a top-level `collections:` list, read
by every tool. It added `--collection <name>` to narrow a run to one. It landed
on main while this branch was open. The merge kept a `cite:` section whose
`paths:` the metadata tool would have refused one key over, and a fixture
that spelled the same set twice.

**Changed as a result:** `cite.paths` and `cite.exclude` are removed, and
each is refused with meta's sentence saying where it went. A bare `check` or
`update` covers every declared collection, resolved from the config directory,
with the collections' `exclude:` globs applied. `--collection <name>` narrows
it, repeatable, one name per occurrence, and shares meta's three usage errors.
A typed path is still filtered by `--exclude` alone. The repo's own config
drops its `cite:` section: the `site` collection is the set, and every other
cite key is a default.

### 22. Obfuscation followed a flag, and the salt could not be changed

Obfuscation was a switch of its own: `--obfuscate` on the command line, or
`obfuscate: true` in config. The salt was a separate key that only keyed the
result. So a repository could carry a salt and still mint a plain path on the
one run where somebody forgot the flag. The page then published the path the
salt existed to hide. The failure was silent, because a plain citation is
valid. And the salt could be set but never changed. Editing the key by hand
turned every token and every keyed pin `missing`. The only repair was to add
each citation again.

Two things follow. First, the salt is the switch. A configured salt
obfuscates every source `add` writes. It can sit in `cite.salt` or in
`MANNI_CITE_SALT`. No flag has to be remembered. The `--obfuscate` flag stays
for a run with no salt at all. That keys under the empty string and is
documented as the weak form. Second,
the salt is a first-class setting with a lifecycle. The `set` verb writes it
into the config in place, generating 32 hex characters when given none. It
keeps the file's comments and refuses to overwrite a salt that exists. The
`rotate` verb re-keys every obfuscated citation under a new salt and then
writes it. Every
page is rewritten in memory first, and nothing reaches disk unless every entry
re-keyed. A salt written beside one citation still under the old key is
exactly the half-state that made hand edits unsafe. An entry whose pin no
longer holds is re-keyed from the lines at its commit, when git can show them.
That is the classifier's own search. So a `changed` citation stays `changed`
rather than becoming `never-true`. Otherwise it is skipped, with
`update --accept` named as the repair, and the run exits 1 with nothing
written.

**Changed as a result:** `cite.obfuscate` is removed and refused with a
message naming `salt set`. `add` obfuscates whenever a salt is configured.
`manni cite salt` is a third-level noun grouping `set` and `rotate`, as
`meta schemas` groups `vendor`, with no default subcommand. The `salt` row of
the configuration reference says it turns obfuscation on. The public-docs
layout keeps the key out of the file and the value in the secret. `set`
would otherwise write a secret into a public config. `rotate` writes the
new salt where the old one lives. A salt from `cite.salt` is replaced in
the config. A salt from `MANNI_CITE_SALT` rotates through the environment:
`--to` is required, the pages are re-keyed under it, and the config is never
touched. The run ends by saying the salt was not written and that the secret
is the operator's to update. An earlier draft wrote the config in both cases
and warned that the environment still wins. A flag to skip the write was the
open question. That put a secret into the public file of the
very layout the secret exists for. A flag to opt out of a wrong default is
the wrong shape. The source of the salt decides, and there is no flag.

### 23. 0045 replaced salted hashes with encryption under a family key

Items 16 and 22 designed a salted hash for paths, and it held for paths. Cite
recovers a path by hashing every tracked file, and the tracked files are a
finite list. Proposal 0045 then needed the same secret for metadata values,
which have no such list. A hashed value could not be validated, shown or
re-keyed. And a salt under `cite:` was one tool's secret, which no other tool
could read.

**Changed as a result:** 0045 replaced the salt with a family key and the hash
with encryption. Items 16 and 22 stay as written. `src` carries `~` and at
least 82 base64url characters: the path, encrypted in the `cite-src` context.
The pin over an encrypted source is an HMAC under a subkey of the family key.
The key is a top-level `encryptionKey:`, or `MANNI_ENCRYPTION_KEY`.
`cite.salt`, `MANNI_CITE_SALT` and `manni cite salt set|rotate` are removed
without aliases, since none was released. `cite.salt` is refused with a
message naming `manni key set`, and `--obfuscate` becomes `--encrypt`.
`manni key rotate` re-encrypts cite's sources and meta's values in one run. It
keeps item 22's rule that a key from the environment is never written. With an
encrypted citation and no key, `cite check` reports
`missing (no encryption key is available to decrypt it)`, an error, unless
`--no-sources` skips it. `--reveal` prints the decrypted path. The new `src`
grammar is in draft `1.0.0-proposal.2`, and `proposal.1` is kept.

### 24. Two switches for things the tool can tell, and a scale of its own

`cite:` had a `git` key, and `check`, `add`, `update` and `manni key rotate`
had `--no-git`. Both turned git off. Whether git is there is a fact the tool
can find out: git is on `PATH` and the root is inside a work tree, or not. A
switch for something the tool can detect is one more way to be wrong. Set off
where git was present, it threw away `never-true`, the diffs and the recorded
commit for nothing.

`sources`, with `--no-sources`, was a real choice, and the public docs job
needs it. But the name did not say what it switched. Read cold,
`sources: false` could mean that nothing here cites a source, or that sources
are not indexed. What it does is skip the check against the sources.

`severity` took `error`, `warning` or `off`. The family scale is
`notice | warning | error`, defined once in `src/shared/severity.ts`, and a
concept two domains share carries the same values. Cite spoke two thirds of
that scale. A team that wanted a rule reported, below a warning, had nowhere
to put it.

**Changed as a result:** `git` and `--no-git` are removed, with no alias,
since cite is unreleased. Git is used whenever it is available, and sources are
indexed by `git ls-files`, else by a directory walk. A run that would have used
git and cannot warns once. `check`, `update` and `key rotate` say
`git is not available here, so citations are checked without history: no never-true, no diffs, no commit subjects.`
when a citation carries a commit or `--show-diff` was given. `add` and
`update --accept` say `git is not available here, so the citation records no commit.`
when a commit would have been recorded. `sources` is renamed `checkSources`,
and `--no-sources` becomes `--no-check-sources`. `update` refuses it with
``update needs the sources: drop --no-check-sources (or `checkSources: false`).``
`severity` accepts `error | warning | notice | off`, the family scale with `off`
kept. A notice is reported and never fails a run. It is a `::notice` in GitHub
output, SARIF level `note`, and never a JUnit failure.

### 25. A copied claim, a keyed pin that read `sha256-`, and a page that carried it all

Four fields said something other than what they held, and a fifth problem was
where they all lived. Draft `1.0.0-proposal.3` closes the five together.

- **The keyed pin lied about its algorithm.** An encrypted source was pinned
  `sha256-`, and the value was an HMAC. A reader who hashed the line by hand
  got a mismatch and no reason for it. The pin now reads `hmac-sha256-`, and
  the prefix follows `file`. Either pairing the other way is `entry-invalid`.
- **The ciphertext covered half a string.** `src: ~AQm4…:5` encrypted the path
  and left the line number glued to it. That made a private source look like a
  scheme of its own. `source.file` is now an ordinary value, encrypted in the
  family's one token format, and `source.lines` sits readable beside it.
- **`commit` did not say what it held.** It could be read as a hash, a ref or
  an id. It is `source.commit-sha`, the name GitLab's `CI_COMMIT_SHA` and
  GitHub's `sha` already use, and it accepts up to 64 hex digits.
- **The claim was copied, not pinned.** `claim:` held the sentence verbatim, so
  every cited sentence was written twice. A copy edit beside it was
  `claim-missing`, and the repair was to retype the sentence in YAML. The claim
  is now pinned exactly as the source is, by lines and an integrity hash. A
  marker stays as the easier anchor for an author who prefers one.
- **Every entry lived on the page.** A page with twenty citations carried a
  hundred lines of YAML at the top, and a public page carried the ciphertexts
  too. Entries may now live in an external-metadata manifest a collection
  declares. Nothing on the page repeats the entry.

The adversarial review moved two things. First, claim lines were going to be
file lines, as a person counts them. The review showed three ways that breaks.
A hand-added frontmatter tag moves every claim on the page. So does a
`meta fill` run. And two branches adding citations to one page collide on
every `lines:` value, in a file where the entry usually sits above the text it
numbers. Second, the review proposed dropping cite's separate encryption
context label. Its argument was that `source.file` is now an ordinary
encrypted value and needs no special case. That was rejected. The label is
what keeps a meta tool from re-encrypting a source without re-keying its pin.
A rotation that did would leave every encrypted citation broken.

**Changed as a result:** claim lines are body-relative, counted from the first
line after the frontmatter. Every command argument, every `(line N)` and every
report translates back to file lines. The context label stays, and stays
internal: no user types it and no output shows it. The other four decisions
stand as the review found them.

## Verification

```bash
node docs/proposals/0044/ladders/citations-examples.cjs   # 52 cases + 31 regex probes, all OK, exit 0
node docs/proposals/0044/ladders/drift-examples.cjs       # golden hashes asserted, 100 checks, exit 0
npx vitest run test/cite                                  # unit suites agree with the ladders' fixtures
node dist/cli.js cite check                                # the repo's own config; exit 0
node dist/cli.js cite check --root test/fixtures/cite test/fixtures/cite/pages/source-changed.md   # exit 1
node dist/cli.js meta validate                             # the dogfood gate; exit 0
```

The two ladders run today, with no registration and no `src/cite/`. The rest
runs once the three feature commits land.

## Placement

`manni:citations:1.0.0-proposal.3` is intended as the tenth default when
0023's review concludes, on the same terms as the other nine. The family is the
default set, and an entry that is malformed fails a bare run. Until then it is
reachable by file ref only, and the site's proposals hub lists it as the tenth
row.

The drafts live under `docs/proposals/0044/schemas/`, not `0023/schemas/`.
0023's "Do not" forbids growing its set, and that rule is right: 0023 records
nine ids as reviewed, and this one has not been. The hub page and the README
row say where to find them. `proposal.1` and `proposal.2` are kept beside
`proposal.3`, since a draft that shipped is a record too. When both proposals
register, the two directories merge into `src/meta/schemas/` in the same PR.

## Not breaking

Additive. A new domain under the umbrella, a new config key, and a new draft
vocabulary that nothing resolves by default. Also an optional `severity` on
`FieldError` that every existing finding leaves unset. `feat(cite):`, a minor
release, in feature commits on one branch: the frontmatter channel with
`check` and `add`; the body channel and `update`; private sources. 0045
then moved private sources onto the family key. The redesign in stress
test 25 turned the body channel into markers and added the sidecar. Each
commit carries its own tests and fixtures, so the branch reviews commit by
commit and merges once. The same caveat as 0026: a shared `manni.config.yaml`
that adopts `cite:` needs every consumer of that config on a manni that knows
the key.

## Consequences

- docevals owes an ADR for `tool:cite`: a native grader, `mode: per-file`,
  options `root` and `checkSources`, mapping `report.findings` to its own
  finding shape by `ruleId`. It is the first integration and not part of this
  proposal.
- Three `feat:` commits ship one demo video, per the house rule. The demo is the
  transcript in the Problem section. It shows a page that validates green and
  cites a line that changed, then `cite check` naming the sentence, with a blue
  accent.
- `docs/proposals/0023/ladders/compat-check.cjs` is already broken, reading
  `src/schemas` and `docmeta:` ids that 0033 moved and renamed. It is a
  separate `fix(docs):` and not this proposal's to make.
- `docs/content-strategy/cujs.md` gains M5, D5 and T2, and the information
  architecture gains the `cite/` content set. The record for those edits is the
  docs pages themselves.
- Open questions for the review, in the order debate is expected:
  1. Is `moved` at warning severity right, or should a team be able to make it
     `off` and rely on a scheduled `update`?
  2. Is one algorithm in the `integrity` pattern too tight for a draft, given
     that a second one is a schema revision?
  3. Should the accepted residue of encryption, that a path's ciphertext is
     the same on every page, be closed with a per-page context? The cost is
     `update` losing the ability to recognise one file across pages.
  4. Are the parenthesised statement forms worth keeping at all, given they
     carry an id only?
