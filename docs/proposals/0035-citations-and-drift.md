# 0035: citations and drift: pin a claim to the lines it rests on

- **Status:** Proposed
- **Serves:** Devin · D4 · Theo · T1 · Maya · M2 · Sara · S1
- **Depends on:** [0023](0023-metadata-vocabularies.md), the family this
  vocabulary joins as its tenth id, and whose `source-of-truth` is the
  page-grain anchor this refines to the line. [0033](0033-manni-monorepo.md),
  the umbrella a sibling domain mounts under, and the rule that siblings import
  the metadata tool as a library. 0034, the command grammar from the a11y
  session, on its own branch: `manni <domain> <subcommand>`, no default
  subcommand, one separator per list. [0026](0026-corpus-checks-are-findings.md),
  the precedent for a finding no Ajv keyword produced, with a rule id, riding
  meta's reporters and baseline
- **Relates to:** [0001](0001-validation-baseline.md), the baseline a new rule
  ramps in on. [0008](0008-remote-schema-durability.md), for the offline
  discipline: no network, ever. [0022](0022-sql-write-back.md) and
  [0025](0025-query-dry-run-polarity.md), the write-in-place and
  writes-by-default precedents `update` follows. [0020](0020-element-metadata.md),
  the both-channels-are-validated rule that decides how frontmatter entries and
  inline statements coexist. [0021](0021-frontmatter-as-a-database.md), for
  `lineFor`, which is how a frontmatter entry gets a line number
- **Touches (planned):** `src/cite/**` (new), `src/cli.ts`, `src/index.ts`,
  `src/meta/internal.ts` (new), `src/shared/{cli-options,color,warn}.ts`,
  `eslint.config.js`, `scripts/check-cli-reference.mjs`,
  `docs/proposals/0035/**`, `docs/src/content/docs/cite/**` (new),
  `docs/src/content/docs/meta/proposals/{citations,frontmatter-vocabularies}.mdx`,
  `docs/content-strategy/{cujs,information-architecture}.md`,
  `docs/astro.config.mjs`, `manni.config.yaml`, `test/cite/**`,
  `test/fixtures/cite/**`, `test/helpers/temp-repo.ts`
- **Verdict:** Add `manni:citations:1.0.0-proposal.1` to the 0023 family, and
  ship `manni cite` (`check`, `add`, `update`) as the sibling domain that
  implements it. A citation pins a sentence to source lines by a hash and a
  commit; the check classifies each pin as current, moved, changed, never true
  or missing, from git alone, with no model and no network. Citations live in
  frontmatter or inline in the body's comment syntax, and a private source can
  be cited by an obfuscated token with a keyed pin. One PR, three feature
  commits.

## Problem

`source-of-truth` (0023, stewardship) promises "the anchor a drift check
compares the page against", and nothing implements the check. It could not do
much if something did: the field names a file, and a page rests on sentences,
not files. When `lib/limits.ts` changes, the question is not whether the page
that names it should be re-read end to end. It is which sentence on that page
just stopped being true, and every sentence that did not.

Gleb Lukicov's "Your documentation is a build artifact" (2026-08-28) records
the answer generated docs already use: for each snippet, the source range, a
hash of those bytes and the commit. A check then sorts every citation into
CURRENT, MOVED or CHANGED at zero tokens, and only CHANGED costs a person or a
model. This family has the two halves of that and has never joined them. evals
carries `generated-assertion-hash`, a hash-as-lockfile over an assertion. The
config's schema entries carry `integrity:` pins. Neither reaches prose.

The transcript below is the intended one; the fixture is being built alongside
this record, and the verification pass makes it literally true. The page pins
one sentence to `src/limits.ts:2` and the source has since changed under it.
Metadata validation is the wrong tool and says so by passing:

```console
$ node dist/cli.js meta validate -s docs/proposals/0035/schemas/citations/1.0.0-proposal.1.json test/fixtures/cite/pages/stale-claim.md
✓ test/fixtures/cite/pages/stale-claim.md

1 file checked, 1 passed, 0 failed, 0 errors
# exit 0
```

Green is correct. The entry is well-formed, and well-formed is all a schema can
say about a hash. Whether the pin still holds is a comparison against the
source, and that is the check this proposal adds:

```console
$ node dist/cli.js cite check --root test/fixtures/cite test/fixtures/cite/pages/stale-claim.md
✗ test/fixtures/cite/pages/stale-claim.md
    ✗ fetch-timeout   src/limits.ts:2   changed   (line 9)

1 file checked, 0 passed, 1 failed, 1 finding
# exit 1
```

Line 9 is the sentence. Not the page, not the file: the sentence.

## Summary

- **A vocabulary**, `manni:citations:1.0.0-proposal.1`, published by meta as the
  tenth member of the 0023 family. Two page keys, `citations` and
  `citation-commit`, and a closed entry shape: `src`, `integrity`, `commit`,
  `id`, `claim`, `quote`. The draft is at
  `docs/proposals/0035/schemas/citations/`, with its example ladder beside it.
- **Inline statements**: the same entry, or a reference to one by id, written in
  the body in the format's comment syntax, the way Doc Detective's inline
  statements are. It anchors the paragraph or fenced block that follows it.
- **Obfuscated sources**: `~<16 hex>` in place of a path, with a pin keyed by a
  salt. A public docs repo can cite a private code repo without publishing its
  paths, and without publishing a verifier for its lines.
- **A tool**, `manni cite`, a sibling domain under the umbrella: `check`
  classifies, `add` mints, `update` rewrites moved pins in place. Findings ride
  meta's reporters and baseline under `manni:cite/<rule>`.
- **A contract**: the hashing rule, the search regimes, the statuses and their
  severities, and one output rule, which is that output never says more than
  the page did.

The vocabulary is meta's; the behaviour is cite's. That split is 0033's:
meta publishes what a page may say, and a sibling implements what it means.
docevals is the first integration, as a `tool:cite` grader, and owes its own
record for that.

## The vocabulary

Draft 2020-12, root open, `citation-` prefix guarded exactly as evals guards
`eval-`:

| Key / field | Type | Required | Meaning |
|---|---|---|---|
| `citations` | list of entries, `minItems: 1` | no | The page's citations. Omit the key rather than write `[]`. |
| `citation-commit` | commit | no | Default `commit` for every entry that omits its own. |
| `src` | source reference | **yes** | `path`, `path:L`, `path:L1-L2`, or `~<16 hex>` with the same line forms. Repo-root-relative posix path. `path:L` is canonical for one line. |
| `integrity` | `^sha256-[0-9a-f]{64}$` | **yes** | The pin: the cited lines hashed under the rule below, keyed when `src` is obfuscated. |
| `commit` | `^[0-9a-f]{7,40}$` | no | The commit the pin was minted at. The tool writes forty; a person may type seven. |
| `id` | `^[a-z0-9][a-z0-9-]*$` | no | Unique per page, tool-enforced. What an inline reference names. |
| `claim` | string, `minLength: 1` | no | The sentence the citation supports, verbatim. |
| `quote` | boolean, default false | no | The anchored fenced block reproduces the cited lines. |

The entry is closed. There is no `dependentRequired`: a bare `{src, integrity}`
is legal, and stress test 13 says why. The `src` grammar rejects a leading `/`
or a drive letter, a backslash, `.` and `..` segments, an empty segment, line
0, a URL, and a token of the wrong length or case; it accepts spaces and dots
inside a segment, so `docs/release notes/v1.2.md:4-9` is a source. `L2 >= L1`
is the tool's rule, because a pattern cannot compare two numbers; the ladder
pins that the schema accepts `:9-3` so nobody later "fixes" the regex into
something unreadable.

**The hashing rule**, stated once here and once in the schema's `integrity`
description, and nowhere else: decode UTF-8; strip one leading BOM; CRLF to
LF; split on LF; drop the empty element a trailing LF leaves; take lines L1
to L2 inclusive, 1-based, or every line for a bare path; join with LF, no
trailing LF; keep trailing whitespace. Plain `src`: `sha256(text)`.
Obfuscated `src`: `sha256(salt + "\n" + text)`. Hex, `sha256-` prefix. The
goldens, verified with node and asserted by the drift ladder: line 2 of the
fixture is `78af1d33…fe4b1f`, lines 1-3 are `d2981e71…bed1d6`, the whole
file and lines 1-7 are both `aebba92f…86e023`, and the CRLF copy of line 2
hashes identically.

**The obfuscation rule**: `"~" + sha256(salt + "\n" + path).hex.slice(0, 16)`,
with `path` spelled exactly as a plain `src` would spell it. The salt comes
from `MANNI_CITE_SALT`, else `cite.salt` in config, else `""`. Without a salt
a guessable path is brute-forceable, and the docs say so. Tokens are stable
across pages, so a public site reveals how often a private file is cited and
when it moves. That is recorded as accepted: the alternative is a per-page
salt, which makes `update` unable to recognise one file across two pages.

**Why a pin is not a derivable fact.** Principle 4 of the family says a
derivable fact lies, and a hash of lines that sit right there looks derivable.
It is not. A pin is a record of the past: what the lines were when the
sentence was written. Recompute it on every run and there is nothing left to
compare against. The check *is* the comparison between the record and the
present, and that is the same object as `generated-assertion-hash` and the
config's `integrity` pins, under the same spelling.

## Inline statements

One keyword, `cite`, two payloads, in the format's own comment syntax,
mirroring Doc Detective's `fileTypes.ts`, which treats `.md` and `.mdx` alike:

| Format | Forms | Payload allowed |
|---|---|---|
| markdown, mdx | `<!-- cite PAYLOAD -->`, `{/* cite PAYLOAD */}`, `[comment]: # (cite PAYLOAD)` | id in all three; JSON only in the first two |
| html, xml | `<!-- cite PAYLOAD -->` | id, JSON |
| asciidoc | `// (cite PAYLOAD)` | id only |
| rst | `.. (cite PAYLOAD)` (manni's own form; Doc Detective has none) | id only |

A payload starting with `{` is JSON: a full entry, validated against the same
`citationEntry` the frontmatter uses, with `claim` optional because position
is the anchor. Anything else must match the id grammar and is a *reference* to
the frontmatter entry with that id. `cite true` is a reference to the id
`true`, so it is `statement-orphan`, never JSON. Anything else is
`statement-invalid`.

The scanner is `indexOf` over the open and close delimiters, never a regex over
the page, and it runs only over the body: `page.ts` slices from the end of the
frontmatter and passes the offset and line, so a `cite` inside YAML is never
matched.

**Anchor**: the rest of the statement's line if non-blank, else the paragraph
that follows, through the next blank line or fence. With `quote: true`, the
next fenced block (```` ``` ```` or `~~~`; `----` in asciidoc). html, xml and
rst have no fence locator in v1, and `quote` there is `statement-invalid`.
Claims are matched whitespace-normalized against the paragraph, so a
soft-wrapped sentence still matches; `add`, `check` and `update` share the one
search.

**Rules**: a reference naming no frontmatter id is `statement-orphan`. Two
statements naming one id are `claim-ambiguous`. A frontmatter entry with a
`claim` and a reference statement must find the claim in the anchored
paragraph, else `claim-missing`. Caps: 500 statements per page and 5,000 lines
per range; beyond those, `statement-invalid` and `entry-invalid`. Meta's
`validate` sees only the frontmatter channel. cite validates inline payloads
itself, with Ajv against a bundled copy of the draft entry schema, and this
record is where that is said.

## The drift-check contract

**Statuses and rules.** A citation is `current`, `moved` (one equal window
elsewhere in the file), `moved-ambiguous` (two or more), `changed` (no equal
window), `never-true` (the range at `commit` does not hash to `integrity`, or
the path was absent there), `missing` (no tracked file, or a token that
resolves to nothing), or `skipped` (`--no-sources`; not a finding). The page-side
rules are `claim-missing`, `claim-ambiguous`, `statement-orphan`,
`statement-invalid`, `entry-invalid` and `quote-drift`. Every rule has a
default severity: `current` is `off`, `moved` and `claim-ambiguous` are
`warning`, everything else is `error`, and config can move any of them. A
warning never touches the exit code.

**Economics.** Two search regimes, and both are local. With git, a non-match
with a `commit` costs one `git show` of the file at that commit, memoized per
commit and path; the original text then drives the move search
(candidate-by-first-line, then a lexical compare, then the hash). Without git,
or without a commit, the search is a window of 2,000 lines either side of the
pinned range, then the rest of the file under a 64 MiB budget, past which the
result carries `truncatedSearch`. `git show` runs only on a non-match, so a
clean corpus costs one hash per citation. No model, no network, ever.

**Output never says more than the page did.** A finding, in every format,
spells a source exactly as the page spelled it: `~9c1f0e2b7a3d4c5e:4`, never
the resolved path. Diffs, commit subjects and resolved paths live on
`CitationResult` and reach output only through the pretty reporter under
`--show-diff` and `--reveal`. A sentinel test runs every reporter against a
fixture whose salt is `SALT-SENTINEL` and whose private path is
`private/SECRET.ts`, and asserts neither string appears.

**Repair is scoped by the finding.** `moved` is mechanical and `update`
rewrites it. `changed` names the sentence, the range and, with history, the
commits since, and a person decides whether the prose or the pin is wrong. A
`changed` finding that recurs is promotable by hand to an `ai` eval, whose
assertion is the claim: that is where the family's model spend belongs, on the
one sentence a zero-token check could not settle. The PR job runs
`--baseline`, report-only, and a scheduled sweep escalates. This is not a
pre-commit hook: a pin can go stale in a commit that touches no page.

**Identity.** `ruleId = "manni:cite/" + rule`. `manni:cite` matches
`BUILTIN_ID`, so `canonicalSchemaRef` leaves it alone. The fingerprint inputs
are `schema: "manni:cite"`, `keyword: rule`, `instancePath` (`/citations/N`
for frontmatter, `""` for inline) and `subject: id ?? integrity`. Stress test
19 is why the subject is the integrity and not the source.

## The tool

`manni cite` is a sibling domain in `src/cite/`, config key `cite:`, mounted by
the umbrella with `addCommand`. No default subcommand. It imports
`../meta/index.js` and a new family-private barrel `../meta/internal.js`, and
an eslint rule stops it reaching into `../meta/{core,extractors,reporters}`.

| Command | Does | Exit |
|---|---|---|
| `check [paths...]` | classify every citation; report through `pretty`, `json`, `github`, `sarif`, `junit`; `--baseline` and `--write-baseline` as meta's, in `.manni-cite-baseline.json`; `--no-git`, `--no-sources`, `--root <dir>`, `--show-diff`, `--reveal` | 0 clean, 1 an unbaselined error, 2 operational |
| `add <page> <src>` | mint an entry at HEAD and write it: `--claim` anchors a sentence, `--quote` a fenced block, `--inline` writes a JSON statement instead of a frontmatter entry, `--obfuscate` writes a token and a keyed pin, `--no-commit`, `--dry-run` | 0 written, 2 refusal |
| `update [paths...]` | rewrite `moved` entries' `src` in place, textually, comments and quoting untouched; `--accept` re-mints `changed` and `never-true` at HEAD and prints both pins; `--only <id>`; `--dry-run` | 0, 1 when work is left undone, 2 under `--no-sources` |

The input surface is meta's: positional paths, `-` with `--as`, `paths:`
fallback, `--ext`, `--exclude`, `-c`, `--no-config`, `--allow-empty`,
`--no-gitignore`. Config `cite:` mirrors the flags, plus `salt`, `obfuscate`,
`root` and a `severity` map; an unknown key, rule or level is a `CiteError`
that names what is supported and never echoes the value. `--root` defaults to
`cite.root` from the config, else the git root, else cwd, and may point at
another checkout.

The condensed ladder. The fixture page cites `lib/limits.ts:2`:

```console
$ manni cite check docs/limits.md
✓ docs/limits.md
    ✓ fetch-timeout   lib/limits.ts:2   current
# exit 0

$ manni cite check                                      # lib/limits.ts gained two lines above
⚠ docs/limits.md
    ↕ fetch-timeout   lib/limits.ts:2   moved -> lib/limits.ts:4   (line 9)
# exit 0

$ manni cite update
docs/limits.md: fetch-timeout  lib/limits.ts:2 -> lib/limits.ts:4  (moved)
# exit 0

$ manni cite check --show-diff                          # the line itself changed
✗ docs/limits.md
    ✗ fetch-timeout   lib/limits.ts:4   changed since 3f9c2a1, 1 commit   (line 9)
        raise fetch timeout to 30s
        -export const FETCH_TIMEOUT_MS = 10_000;
        +export const FETCH_TIMEOUT_MS = 30_000;
# exit 1

$ manni cite check -f github
::error file=docs/limits.md,line=9,title=manni:cite/changed::fetch-timeout (lib/limits.ts:4): changed since 3f9c2a1, 1 commit
# exit 1

$ manni cite check --no-sources docs/                   # public docs repo: page-side only
✓ docs/limits.md
    · fetch-timeout   ~9c1f0e2b7a3d4c5e:2   skipped
# exit 0

$ MANNI_CITE_SALT=… manni cite check --root ../code --reveal docs/
✓ docs/limits.md
    ✓ fetch-timeout   ~9c1f0e2b7a3d4c5e:2 (lib/limits.ts)   current
# exit 0

$ manni cite add docs/limits.md lib/limits.ts:2 --claim "The fetch timeout is 10 seconds." --id fetch-timeout
docs/limits.md: added fetch-timeout (lib/limits.ts:2, sha256-78af1d33…, 3f9c2a1) to frontmatter; reference at line 8, claim at line 9
# exit 0

$ manni cite add docs/limits.md lib/limits.ts:2 --claim "The fetch timeout is 9 seconds."
manni: Claim not found in docs/limits.md: "The fetch timeout is 9 seconds.". Add the sentence first, or omit --claim.
# exit 2
```

The two-repo layout, which is the reason obfuscation exists:

```yaml
# public docs repo: manni.config.yaml (public)
cite:
  paths: ["src/content/docs/**/*.{md,mdx}"]
  obfuscate: true
# public CI:   manni cite check --no-sources
# private CI:  check out docs and code side by side; from the docs checkout:
#              MANNI_CITE_SALT=$SECRET manni cite check --root ../code -f sarif
```

The pages stay where the docs are so SARIF URIs resolve; the sources are
reached through `--root`.

## Stress test

What was tried against this design, and what each attempt changed.

### 1. The field was `sha256` before it was `integrity`

The first draft named the pin field after its algorithm, which is what
`generated-assertion-hash` does by implication. Then a second algorithm is a
second field, and a page with both is two facts about one range. The config's
schema entries already solved this with `integrity: sha256-…`, and so did
Subresource Integrity.

**Changed as a result:** the field is `integrity`, its value carries a
`sha256-` prefix, and the pattern closes the algorithm set at one so a future
`sha512-` is a schema revision, not a silent acceptance.

### 2. `add --claim` with a sentence the page does not contain

The first `add` wrote the entry and let `check` report `claim-missing` on the
next run. That is a tool minting a pin it already knows is broken, and the
person who typed the sentence with a typo learns about it from CI.

**Changed as a result:** `add` runs the same claim search `check` runs, and
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
the invariant that a result is `ok` iff it holds no error-severity entry, and
the reporters render `⚠`, `::warning` and SARIF `level` accordingly.

### 6. `path:1-7` and `path` are the same bytes and were two pins

The first hashing rule kept the trailing LF for a whole-file pin and dropped it
for a range, so pinning "the whole file" two ways gave two hashes.

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
run, and `never-true` is asserted only when git can actually show the range at
that commit and it does not hash to the pin.

### 10. CRLF and a BOM

A Windows checkout with `core.autocrlf` turned every pin `changed`. The
config's schema pins diagnose an encoding mismatch after the fact with a
message; a citation check runs on every push and cannot afford a page of false
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

**Changed as a result:** the bare pin is legal, checked source-side only, and
the record says why both it and `source-of-truth` exist: they answer at
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
  the source as the page spelled it; the resolved path reaches only the pretty
  reporter, only under `--reveal`, and the sentinel test proves it across
  formats.
- **The resolver.** A token that resolves against an arbitrary directory walk
  is a probe: point `--root` at `/` and see what matches. Sources resolve
  through tracked files only, under realpath containment.

**Changed as a result:** all four, plus the accepted residue stated in the
vocabulary section: tokens are stable, so a public site reveals how often a
private file is cited and when it moves.

### 17. A frontmatter entry and an inline statement for the same sentence

The first draft gave frontmatter precedence over inline. 0020 already decided
this for element metadata: both channels are validated and neither wins,
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
not whitespace: the ladder also holds that a comma where the claim has a full
stop is a miss, which is what caught the plan's own example (item 20).

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

## Verification

```bash
node docs/proposals/0035/ladders/citations-examples.cjs   # 36 cases + 35 regex probes, all OK, exit 0
node docs/proposals/0035/ladders/drift-examples.cjs       # golden hashes asserted, 19 verdicts + 22 claim/statement cases, exit 0
npx vitest run test/cite                                  # unit suites agree with the ladders' fixtures
node dist/cli.js cite check                                # the repo's own config; exit 0
node dist/cli.js cite check --root test/fixtures/cite test/fixtures/cite/pages/stale-claim.md   # exit 1
node dist/cli.js meta validate                             # the dogfood gate; exit 0
```

The two ladders run today, with no registration and no `src/cite/`. The rest
runs once the three feature commits land.

## Placement

`manni:citations:1.0.0-proposal.1` is intended as the tenth default when
0023's review concludes, on the same terms as the other nine: the family is the
default set, and an entry that is malformed fails a bare run. Until then it is
reachable by file ref only, and the site's proposals hub lists it as the tenth
row.

The draft lives under `docs/proposals/0035/schemas/`, not `0023/schemas/`.
0023's "Do not" forbids growing its set, and that rule is right: 0023 records
nine ids as reviewed, and this one has not been. The hub page and the README
row say where to find it. When both proposals register, the two directories
merge into `src/meta/schemas/` in the same PR.

## Not breaking

Additive. A new domain under the umbrella, a new config key, a new draft
vocabulary that nothing resolves by default, and an optional `severity` on
`FieldError` that every existing finding leaves unset. `feat(cite):`, a minor
release, in three feature commits on one branch: the frontmatter channel with
`check` and `add`; inline statements and `update`; obfuscated sources. Each
commit carries its own tests and fixtures, so the branch reviews commit by
commit and merges once. The same caveat as 0026: a shared `manni.config.yaml`
that adopts `cite:` needs every consumer of that config on a manni that knows
the key.

## Consequences

- docevals owes an ADR for `tool:cite`: a native grader, `mode: per-file`,
  options `root`, `git` and `sources`, mapping `report.findings` to its own
  finding shape by `ruleId`. It is the first integration and not part of this
  proposal.
- Three `feat:` commits ship one demo video, per the house rule. The demo is the
  transcript in the Problem section: a page that validates green and cites a
  line that changed, then `cite check` naming the sentence, with a blue accent.
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
  3. Should the accepted residue of obfuscation, that tokens are stable across
     pages, be closed with a per-page salt at the cost of `update` losing the
     ability to recognise one file across pages?
  4. Are the parenthesised statement forms worth keeping at all, given they
     carry an id only?
