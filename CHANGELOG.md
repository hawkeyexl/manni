# Changelog

`manni` continues the history of `docmeta`, which it was published as up to
4.13.1. Entries below that version are docmeta releases; the repository
history is the same one.

# [2.0.0](https://github.com/hawkeyexl/manni/compare/v1.1.1...v2.0.0) (2026-09-12)


### Features

* citation tracking and a family encryption key (proposals 0044, 0045) ([#17](https://github.com/hawkeyexl/manni/issues/17)) ([fe9d7e8](https://github.com/hawkeyexl/manni/commit/fe9d7e89c078552621d9c5d8aaf71cc58483d4af)), closes [#78](https://github.com/hawkeyexl/manni/issues/78) [#18](https://github.com/hawkeyexl/manni/issues/18) [#19](https://github.com/hawkeyexl/manni/issues/19)


### BREAKING CHANGES

* `cite.paths` and `cite.exclude` are removed. Document
sets are declared once under the top-level `collections:` list.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>

* docs(meta): give the local-model fill steps three minutes

Doc Detective caps a shell step at 60 s. The two `fill --provider
llama-cpp` steps on the CLI reference run a 3B model on a CPU-only
runner, and a cold inference there has crossed that cap on two of five
runs of this branch, with the weights already cached and prefetched.
The step now allows 180 s, which is the inference's cost rather than a
download's.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>

* test: give three spawn-heavy tests a minute on slow runners

A Windows runner tipped three tests past vitest's 5 s default: the
cite --show-diff case that builds a two-commit repo and spawns the CLI,
and two meta cases that export a SQLite database. Each now carries the
60 s allowance the other timed tests in these files already have. The
previous run passed every matrix entry, so this is runner speed, not a
regression.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>

* feat(cite): a global, rotatable salt, and sources obfuscate whenever one is set

A token derived from a path alone is only as private as the path is
guessable, so the salt becomes a first-class setting rather than a flag
to remember. `manni cite salt set` writes `cite.salt` into the config,
generating 32 hex characters when none is given, and refuses to
overwrite one. `manni cite salt rotate` re-keys every obfuscated token
and pin under a new salt, atomically: pages and the salt are written
only when every entry could be re-keyed, and a changed entry is skipped
with the `update --accept` it needs first. A salt that comes from
MANNI_CITE_SALT rotates through the environment: `--to` is required and
the config is never written, so a public docs checkout never carries the
secret. With a salt configured, `add` obfuscates every source it writes;
the `obfuscate` config key is refused with a pointer to `salt set`.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>

* docs(cite): title the caution asides on the CLI reference

Starlight names an untitled aside by its type, so two untitled cautions
on one page are two landmarks called "Caution", which axe reports as
landmark-unique and the Docs a11y job fails at the notice floor. Each
* `cite.salt`, MANNI_CITE_SALT, `manni cite salt set` and
`manni cite salt rotate` are removed, and `--obfuscate` is `--encrypt`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(meta): fill --dry-run needs no encryption key

A dry run writes nothing and reports a marked value as "(encrypted)",
so it neither asks for a key nor refuses without one, as `query
--dry-run` already does. The citations proposal page presents the
proposal.2 draft, whose private sources are encrypted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* feat(key): manni key set and rotate manage the family encryption key

`manni key set` writes a generated or given key to the top of the
family config, and refuses to replace one. `manni key rotate`
re-encrypts every encrypted value in the family, metadata and
citations alike, found by its ciphertext rather than by schema marks,
and writes pages and the key only when every value could be
re-encrypted. It writes the new key first and keeps the old one as
`encryptionKeyPrevious` until the pages are written, so a rotation that
is interrupted is finished by running it again. A run over part of the
family needs --to and never writes the key; an environment key rotates
with --to and leaves the config alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(cite): --no-color turns colour off under the umbrella

Colour was resolved from the top-most program, which under `manni` is
the umbrella and never declares --no-color, so `manni cite --no-color
check` still printed colour on a terminal. It is now read from the
nearest command that declares the flag, the cite program wherever it
is mounted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* docs(cite): follow the CLI reference's own citation to its new lines

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* ci: exclude the encrypted-metadata fixtures from the SARIF fixture run

The pages under test/fixtures/encrypted exercise x-manni-encrypt, not
OKF, so each one would open a code-scanning alert for a missing type.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* ci: restore the line continuation in the SARIF fixture run

The previous commit's exclusion lost its trailing backslash, which ended
the validate command before --allow-empty and the redirect.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* docs(cite): a move then a change reads changed, not never-true

The get-started aside and the fix page still described the classifier
from before the history search was widened. A pin that update moved
is found at its old line in the recorded commit, so a later edit
reads changed; never-true is left for a pin that matches nowhere in
the file at that commit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(meta): report notice findings as notices in github, sarif and pretty

The family scale is notice | warning | error, but meta's reporters sent every
non-error to warning: `::warning` in GitHub output and level `warning` in
SARIF. A notice is now `::notice` and SARIF level `note`; JUnit already
treated it as a passing testcase and now has a test for it. The run summary
counts notices apart from warnings (`summary.notices`, omitted at zero), and
pretty prints the word `notice` dim. Meta's own validation emits neither, so
its output is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* feat(cite): use git when it is available, rename sources to checkSources, accept notice

Three changes to the cite: section and its flags, recorded as stress test 24
in proposal 0044. Cite is unreleased, so there are no aliases.

- `cite.git` and `--no-git` (check, add, update, key rotate) are removed. Git
  is used whenever it is on PATH and the root is inside a work tree; sources
  are indexed by `git ls-files`, else by a walk. A run that wanted git and
  cannot use it warns once: without history for check, update and key rotate,
  with no recorded commit for add and update --accept. Programmatic callers
  pass `gitClient: noGit()`.
- `cite.sources` / `--no-sources` become `checkSources` / `--no-check-sources`.
- `cite.severity` accepts `error | warning | notice | off`, the family scale
  plus `off`. A notice is reported and never fails a run; pretty marks it `ℹ`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* feat(meta): locate a manifest finding at the entry's own line

A value an external-metadata manifest supplies was located only at the owned
key's line, so a finding at /citations/3/source/file pointed at `citations:`.
The loader now records the line of every node inside an owned value, and
`locate` answers with the deepest node a pointer reaches, falling back to the
nearest ancestor. `additionalProperties` asks the stray key's own line first.

Adds `spliceManifestValue`, which rewrites one owned value for one entry of a
manifest and changes no other byte: it replaces a single text range, so
comments, key order, quoting and line endings survive, and it reads the result
back before returning it. Both are exported through the family-internal barrel
for `manni cite`, which keeps citations in a manifest. `meta fill` and
`meta query` stay read-only on manifests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* ci: exclude the manifest-line fixtures from the formats demo

test/fixtures/external-metadata-items/ carries its own config and schema, and
its two pages exist to be located: a finding on a manifest-supplied value must
report the manifest line of that list item, in block and in flow style. Judged
against this workflow's default set they are standing code-scanning alerts for
files doing their job, as every other fixture directory with its own contract
already is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* ci: give the review job 100 turns

The review ran out of turns on this pull request four times, twice on re-runs,
at 50. A review that cannot finish reports nothing, so the budget is the whole
check. 100 is the smallest raise that fits a change this size.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* feat(cite): pin the claim like the source, in two blocks

An entry no longer copies its sentence. It has two ends with one shape, and
each is a line range plus a hash:

  citations:
    - id: fetch-timeout
      claim:  { lines: 3, integrity: sha256-… }
      source: { file: lib/limits.ts, lines: 2, integrity: sha256-…,
                commit-sha: 3f9c2a1e… }

- The claim end is classified by the source's own machinery: `claim-moved`
  (notice), `claim-moved-ambiguous` (warning) and `claim-changed` (warning),
  which `update` repairs and `update --accept` re-pins. `claim-missing` and
  `claim-ambiguous` are gone.
- Claim lines count from the first line after the frontmatter, so writing an
  entry, or adding a tag by hand, never moves another claim. Commands and
  reports speak file lines.
- Markers stay as the easier anchor, id only, renamed to `marker-orphan`,
  `marker-invalid` and `marker-repeated`. A marker-anchored entry may carry a
  claim `integrity`, which pins the text the marker anchors. The inline JSON
  entry is gone: an entry is never written into the body.
- Source rules are renamed `source-*`, and anchors that cannot work are
  `anchor-invalid`.
- `source.file` is the path alone, encrypted as a value, and the keyed pin now
  reads `hmac-sha256-`. A prefix that does not match the file is a finding.
- `commit` becomes `source.commit-sha`, page-level `citation-commit` is gone,
  and `add --no-commit` is `--no-commit-sha`.
- `cite add <page>[:L|:L1-L2] <src>` takes the claim's lines where `--claim`
  took its text; `--marker` records a marker; `--inline` is gone. `-:L` is
  stdin with lines, normalized for the whole family in the bin runner.

The vocabulary draft is `manni:citations:1.0.0-proposal.3`; `proposal.1` and
`.2` are kept as written.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(key): rotate encrypted values in local manifests too

`key rotate` walked page files and nothing else. An external-metadata
manifest is not a page: it registers no extractor and appears in no
`docs` row. So a value marked `x-manni-encrypt` that a manifest supplied
stayed under the old key while every page moved, and it decrypted under
neither key afterwards. The next rotation could not repair it either: it
skipped the value and refused to write anything at all.

That is the likeliest place for the failure rather than an unlikely one.
A manifest is private by construction, which is the whole reason a value
would be encrypted rather than published.

A rotation now loads the local manifests of the collections it covers
and re-encrypts their values with the pages. Three things bound it.

- A URL manifest is read-only, so it is never loaded and a rotation
  reaches no network.
- The `citations` key is skipped, in a manifest as on a page. Cite
  re-keys a citation's source with its pin under its own context, and
  re-encrypting the source alone would break every encrypted citation.
- One value is spliced at a time by `spliceManifestValue`, which
  replaces that value's range, keeps every other byte, and reads the
  result back. A manifest's comments and key order survive.

Rotation stays atomic. Pages and manifests are re-encrypted in memory
first, one skip anywhere means nothing is written, and the key still
goes first with `encryptionKeyPrevious:` so an interrupted run resumes.
A narrowed run covers the manifests of the collections it selected:
`--collection` names them, and positional paths select the collections
those files belong to.

The result gains a `manifests` array beside `pages`, in the core and in
`-f json`. A manifest value is named by its entry and its pointer, so
`pretty` prints `private/site.yaml: docs/handbook.md/owner`.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(meta): read a manifest-supplied encrypted value, not its token

`encryptionView` skipped every pointer `locate()` answered for, and
`locate()` answers for every value an external-metadata manifest
supplied. A property marked `x-manni-encrypt` whose value lives in a
manifest was therefore validated as raw ciphertext: its `enum`,
`pattern` or `format` failed against the token, a stale token never
reported `encrypted:unreadable`, and a run with no key dropped nothing
and warned about nothing.

The exemption was only ever about `encrypted:plain`, which a manifest
value is exempt from because the manifest is private by construction.
Narrow it to that. A manifest-supplied ciphertext is decrypted,
validated as its plaintext against the property's full schema, and
reported under proposal 0045's rules.

`settleFindings` and `encryptionFindings` take the locator too, so an
encryption finding names the manifest and the entry's own line, the
way a schema finding on the same pointer already did.

The schema-resolution reference described the fixed behaviour already;
it gains one row saying the manifest exemption covers plain values
alone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* docs(cite): rewrite the citation docs and records for two-ended entries

The citations reference is rewritten around the two ends, body lines against
file lines, the file grammar that replaces the src grammar, markers, quotes,
the sidecar, and the statuses and the fourteen rules. The CLI reference gets
the new output shapes, the `add` ladder and the refusals. Get started, fix,
CI and the two-repository set-up follow, as do the key pages for rotation and
meta's configuration reference for a manifest that owns citations.

Records: 0044 gains the shipped entry shape, a sidecar section and stress
test 25, which records the five decisions and the adversarial review that
moved claim lines to the body and kept cite's own encryption context. 0045
covers the encrypted source value, the hmac-sha256- pin, and rotation
reaching citation manifests.

Both ladder scripts are rewritten for proposal.3 and run clean, and the one
real citation in these docs is re-pinned over the paragraph it anchors.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* feat(cite): keep citations in an external-metadata manifest

A collection that declares a manifest owning `citations` keeps its pages'
entries there, so a page carries no citation metadata at all, and a public
page need not carry encrypted tokens. The manifest is the family's existing
sidecar (0037, 0039, 0041), read through meta's merge.

- `check`, `update`, `add` and `manni key rotate` read a page's citations from
  the manifest that owns them. Membership comes from every declared
  collection, so a page named by path still finds its sidecar.
- `add`, `update` and `key rotate` write the manifest in place, splicing one
  value so no other byte moves, once per manifest per run. A page is left
  untouched unless a marker goes into it.
- A finding about an entry names the manifest and the entry's own line; one
  about a claim or a marker stays on the page. A manifest outside the tree
  falls back to the page, which is what SARIF can resolve.
- Refused: a URL manifest owning citations, a page whose two collections both
  keep citations in a manifest, `add` from stdin when a manifest is keyed by
  path, and two pages sharing one join value. A page that still carries its
  own `citations:` is `entry-invalid`, in meta's words.

The dogfood citation in the CLI reference is re-pinned, since these changes
moved its source.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* docs: rewrite five colon reveals the house voice refuses

Vale's Voices.ColonReveal fired on a heading, a glossary row, and the
claim-changed description in three places. Each is now a plain sentence.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* docs(cite): assert what pretty prints, not the message text

The docs-as-tests steps for claim-moved, claim-moved-ambiguous and
claim-changed expected a finding's message. Pretty prints one row per
citation and carries the message only in the github and json formats, so the
steps could not match. They now assert the row, with the line numbers the
fixtures really produce.

Three example blocks on the fix page showed that message as a second pretty
line, which the reporter never prints. Removed.

Verified by running Doc Detective over the cite pages against the local build.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* docs: give every persona a journey through every tool they touch

The docs grew tool by tool, so coverage was uneven per person rather than per
tool. Maya could pin a claim but not keep citations out of her pages, and had
no path to an accessible site. Devin had no rotation runbook and no CI page for
accessibility. Sara had no journey into either new tool. Theo had no way to fix
an accessibility failure.

Seven journeys are added to the content strategy (M6, M7, D6, D7, S4, S5, T3),
and nine pages carry them:

- cite: a set-up index for the single-repository path, keeping citations in a
  sidecar manifest, and requiring citations in the standard.
- key: where the key lives, and a six-step rotation runbook that keeps CI green.
- meta: requiring a field while keeping its value private, promoted out of the
  schema-authoring page.
- a11y: get started, gate it in CI, and fix one violation. The overview is
  trimmed back to an overview, with its two inbound links repointed.

Accessibility gets no fifth persona. Maya, Devin and Theo own it, as they own
the same work elsewhere.

Also: `## Severity across the family` in the output reference, the seam that had
no home; the citation journeys corrected to the shipped surface; the information
architecture corrected where it described the old entry shape, the superseded
schema draft, two domains instead of four, and pre-monorepo source paths.

Examples are captured from real runs. The cite, key and meta pages carry 45 Doc
Detective steps; the a11y pages carry none, because a crawl needs a browser and
a served site, and each says so.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* docs(cite): name the first column of the sidecar comparison table

axe reported `empty-table-header` on the frontmatter-against-sidecar table:
its first header cell was blank, so a screen reader announces a column with no
name. The column holds what differs between the two, and now says so.

Worth noting for the severity work already filed: this finding is a notice, and
it still failed the a11y run, which is the inconsistency with the family scale.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

## [1.1.1](https://github.com/hawkeyexl/manni/compare/v1.1.0...v1.1.1) (2026-09-11)


### Bug Fixes

* keep NaN and the infinities in errorMessage ([#28](https://github.com/hawkeyexl/manni/issues/28)) ([5e1e959](https://github.com/hawkeyexl/manni/commit/5e1e959b51ef3d0f3757bceff70030d9002440d7))

# [1.1.0](https://github.com/hawkeyexl/manni/compare/v1.0.1...v1.1.0) (2026-09-11)


### Features

* **meta:** derive managed metadata from git, CODEOWNERS, GitHub and GitLab ([#19](https://github.com/hawkeyexl/manni/issues/19)) ([19784e1](https://github.com/hawkeyexl/manni/commit/19784e191ef4b731d4c94d74691cd1e4eccb1b20)), closes [#21](https://github.com/hawkeyexl/manni/issues/21) [#22](https://github.com/hawkeyexl/manni/issues/22)

## [1.0.1](https://github.com/hawkeyexl/manni/compare/v1.0.0...v1.0.1) (2026-09-11)


### Bug Fixes

* **meta:** pass collection memberships through query's writes ([#26](https://github.com/hawkeyexl/manni/issues/26)) ([eb4a4e1](https://github.com/hawkeyexl/manni/commit/eb4a4e15b00933e889018662838654def4f00923))
* **meta:** prefix the override-collection error with its section ([#25](https://github.com/hawkeyexl/manni/issues/25)) ([272946a](https://github.com/hawkeyexl/manni/commit/272946a0d01fb76d7b567268b05d5534e0c39a66))
* say what was thrown, and close the docs table's transaction ([#27](https://github.com/hawkeyexl/manni/issues/27)) ([c6765d6](https://github.com/hawkeyexl/manni/commit/c6765d6bd58a77737cf79a47b2c7c0c7e659879e))

# [1.0.0](https://github.com/hawkeyexl/manni/compare/v0.3.0...v1.0.0) (2026-09-11)


* feat(meta)!: collections declare document sets for every tool ([#20](https://github.com/hawkeyexl/manni/issues/20)) ([3f559dc](https://github.com/hawkeyexl/manni/commit/3f559dc898ceacaae9e803d36968152df46968a1))


### BREAKING CHANGES

* `meta.paths`, `meta.exclude`, `meta.sidecars` and
`overrides[].name` are removed. Each is refused with a message naming where it
went: document sets go in the top-level `collections:` list, manifests become
`collections[].externalMetadata`, and an override points at a collection with
`collection:` instead of carrying a name of its own. There is no alias, because
an alias is a permanent second way to say one thing.

The two external-metadata finding identities are renamed, so the SARIF and JUnit
rule ids become `external:owned/external` and `external:duplicate/external`. A
baseline recorded before this stops matching those two findings: they reappear
and the run exits 1 until the baseline is regenerated.

Config `exclude:` no longer filters a path given on the command line. It shapes
the collection, so it applies when a run reads the collections; `--exclude` is
what filters a path you typed. With several collections there is no principled
way to choose whose exclusions apply to a directory someone named.

Every `Sidecar*` export is renamed to its `ExternalMetadata*` spelling, and
`SidecarConfig` moves to `src/shared/` as `ExternalMetadataConfig`.

Config discovery now stops at a family file carrying `collections:` even when it
has no section for the tool being run.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(meta): extended globs count as globs, and three messages say more

# [0.3.0](https://github.com/hawkeyexl/manni/compare/v0.2.0...v0.3.0) (2026-09-08)


### Features

* **meta:** sidecar manifests keep frontmatter values outside the document ([ec786d4](https://github.com/hawkeyexl/manni/commit/ec786d4cb125796696221d6684bc4e0277b69c92))

# [0.2.0](https://github.com/hawkeyexl/manni/compare/v0.1.0...v0.2.0) (2026-09-07)


### Features

* **a11y:** add manni a11y check, an axe-core crawl of a site ([#15](https://github.com/hawkeyexl/manni/issues/15)) ([6dd17aa](https://github.com/hawkeyexl/manni/commit/6dd17aa98c604205ff06b4f5112ff28d30711bbe))

# [0.1.0](https://github.com/hawkeyexl/manni/compare/v0.0.0...v0.1.0) (2026-09-06)


### Features

* publish as @hawkeyexl/manni, starting the 0.x line ([3ad7c6d](https://github.com/hawkeyexl/manni/commit/3ad7c6d034e3ac67fd1546ad1d17c322b7544fc1))

## [4.13.1](https://github.com/hawkeyexl/docmeta/compare/v4.13.0...v4.13.1) (2026-09-04)


### Bug Fixes

* **docs:** keep rewritten frontmatter descriptions on one line ([485f7a9](https://github.com/hawkeyexl/docmeta/commit/485f7a9bdea1803fa9f4e1ae30d6cbfa09e50e57))

# [4.13.0](https://github.com/hawkeyexl/docmeta/compare/v4.12.0...v4.13.0) (2026-09-01)


### Bug Fixes

* **0023:** constrain metadata.docmeta-vocabularies in artifact-evals ([f1004df](https://github.com/hawkeyexl/docmeta/commit/f1004df8a3565dbaeb06a62eca5f521668cf27de))


### Features

* **0023:** allow weight on the use: form, and floor the vocabulary map ([67e8475](https://github.com/hawkeyexl/docmeta/commit/67e8475c47793016a88a2ebc0030e83eb41296ac))

# [4.12.0](https://github.com/hawkeyexl/docmeta/compare/v4.11.0...v4.12.0) (2026-08-28)


### Features

* **config:** let an overrides entry carry a list of globs ([a556323](https://github.com/hawkeyexl/docmeta/commit/a556323746cc53e19d3165eada9d8c3fadb68840))

# [4.11.0](https://github.com/hawkeyexl/docmeta/compare/v4.10.0...v4.11.0) (2026-08-28)


### Bug Fixes

* **schemas:** accept a quoted effort integer and catch the whitespace-only drops ([2771d72](https://github.com/hawkeyexl/docmeta/commit/2771d720a118abbe944bb3b88c3a77685d4b7334))
* **schemas:** pin the effort/maxTurns asymmetry and split a misleading test ([9dcc362](https://github.com/hawkeyexl/docmeta/commit/9dcc362f46ea480f131c38ec08d99f827b81e8f8))


### Features

* **schemas:** add the Claude Code subagent definition schema ([2353511](https://github.com/hawkeyexl/docmeta/commit/23535113c89a22e2c333397929b826ef820de183))

# [4.10.0](https://github.com/hawkeyexl/docmeta/compare/v4.9.0...v4.10.0) (2026-08-28)


### Bug Fixes

* **cli:** say in --help that --offline is a no-op where it is one ([2b77f5e](https://github.com/hawkeyexl/docmeta/commit/2b77f5edfc7a005d69f1c9b10c4ff1f9361dc460))
* **get:** keep the parse diagnostic sound when a throw is not an Error ([87b9e97](https://github.com/hawkeyexl/docmeta/commit/87b9e971065c56bc7dc6efb9160d40105a49e54a))
* **get:** name the file when its frontmatter will not parse ([5458375](https://github.com/hawkeyexl/docmeta/commit/545837592e6a84f9bb2c8ae54dd1cd059334b181))
* **get:** report an unreadable metadata block per file, not as a run failure ([337fde8](https://github.com/hawkeyexl/docmeta/commit/337fde8a59cc651b5516103edd95dced87fbc6d6))
* **reporters:** name the .gitignore skip count on the infer headline ([434b7d6](https://github.com/hawkeyexl/docmeta/commit/434b7d688fdec323f0f3fe3f6d0b26c65270bd0d))


### Features

* **cli:** give schemas infer the shared input flags ([cdc0bd4](https://github.com/hawkeyexl/docmeta/commit/cdc0bd4cde0423fbb3ae7f0244383e954501a703))
* **schemas:** add the MkDocs Material front matter schema ([8c00731](https://github.com/hawkeyexl/docmeta/commit/8c0073178c4ae14a6161748426118736fb98b1ac))

# [4.9.0](https://github.com/hawkeyexl/docmeta/compare/v4.8.2...v4.9.0) (2026-08-28)


### Bug Fixes

* **query:** a cli-named builtin fork repoints by identity, or refuses as an orphan ([a5afe12](https://github.com/hawkeyexl/docmeta/commit/a5afe12e19259a56f0bf1d1052ff79d8dbe92cf3)), closes [#139](https://github.com/hawkeyexl/docmeta/issues/139)
* **query:** key schema-file identity and pins by resolved path ([e2438e5](https://github.com/hawkeyexl/docmeta/commit/e2438e5e60f6085851eee17613fff036c7c857cc)), closes [#139](https://github.com/hawkeyexl/docmeta/issues/139)
* **query:** name the --db residue in the orphan refusal ([3390b62](https://github.com/hawkeyexl/docmeta/commit/3390b623bfc71a10957739034baad516825c5f1e))
* **query:** refuse an ADD that cannot tell which builtin to fork ([d78c711](https://github.com/hawkeyexl/docmeta/commit/d78c71163cca19bf0a3adb852507c9c4898d370f)), closes [#139](https://github.com/hawkeyexl/docmeta/issues/139)
* **query:** refuse schemas and params on export-only runs in the core ([6edc774](https://github.com/hawkeyexl/docmeta/commit/6edc77474c96cc39e950b229a78714a9fa33f0cc)), closes [#139](https://github.com/hawkeyexl/docmeta/issues/139)
* **query:** scope the export-only -s gate's wording to what it guards ([926bb1d](https://github.com/hawkeyexl/docmeta/commit/926bb1df4fa5cf4956fa8fc5dc4facc09e619477))
* **query:** tell the truth in the -s refusals ([3169947](https://github.com/hawkeyexl/docmeta/commit/316994716b7969c782ce521b5386147909e446c2))


### Features

* **query:** -s/--schema names the DDL target set ([7fb87ab](https://github.com/hawkeyexl/docmeta/commit/7fb87ab6bbcce5c54e533533d1fa66fe41b55489))

## [4.8.2](https://github.com/hawkeyexl/docmeta/compare/v4.8.1...v4.8.2) (2026-08-28)


### Bug Fixes

* **query:** eager views for catalog observers; newline-safe retry; bracket-aware scan ([70753c1](https://github.com/hawkeyexl/docmeta/commit/70753c138ce9ecaf4ba20090da3ac27136ac521d))
* **query:** skip comments in the catalog CHECK scan ([35c0739](https://github.com/hawkeyexl/docmeta/commit/35c07395a77857898715db601a3b479c07c29909))
* **query:** skip comments in the SET-expression scan ([b2ae16b](https://github.com/hawkeyexl/docmeta/commit/b2ae16bbd87675011acfcd6a5ab9e75ae7a98344))
* **query:** skip comments when counting parens in the CHECK scan ([9af3bf1](https://github.com/hawkeyexl/docmeta/commit/9af3bf18d810d25a4c8954eb0bcbafa17b650a80))


### Performance Improvements

* **query:** build collection views lazily, on first reference ([b6c516b](https://github.com/hawkeyexl/docmeta/commit/b6c516bbf2acd38dce6548cad028f71448de22a4)), closes [UPDATE-throu#view](https://github.com/UPDATE-throu/issues/view)
* **query:** prepare before the baseline snapshots in runOnce ([544e0b0](https://github.com/hawkeyexl/docmeta/commit/544e0b0bb72e1554b5cdcf559aeabd32398be148))
* **validate:** reuse the per-file resolution walk for check collections ([1ba3a76](https://github.com/hawkeyexl/docmeta/commit/1ba3a761a5d4cf21c6bc4c902d7b608f44711c98))

## [4.8.1](https://github.com/hawkeyexl/docmeta/compare/v4.8.0...v4.8.1) (2026-08-27)


### Bug Fixes

* **deps:** clear the fast-uri advisory reaching users through ajv ([6299637](https://github.com/hawkeyexl/docmeta/commit/62996371ebe5cda6e2c30fd555e85552a8cfe54f))

# [4.8.0](https://github.com/hawkeyexl/docmeta/compare/v4.7.0...v4.8.0) (2026-08-27)


### Bug Fixes

* **checks:** make checks SELECT-only, parameterless, and identity-honest ([58ae47d](https://github.com/hawkeyexl/docmeta/commit/58ae47d4d3f6e598a9c9c5ae5c0c5abba4b4f699))
* **query:** close the parameter-identity and format-dispatch holes ([d7a6d7e](https://github.com/hawkeyexl/docmeta/commit/d7a6d7e28948f7ba37ff549fc1582157ea313190))
* **query:** un-gate the format DEFAULT guard from the broad type ([fcefb23](https://github.com/hawkeyexl/docmeta/commit/fcefb23386e51d416e1385458fea0a8355a4ddac))


### Features

* **query:** bridge formats, booleans, and enums into DDL (proposal 0028) ([9b5823a](https://github.com/hawkeyexl/docmeta/commit/9b5823a891a2950f8cfb2af5d5ec9fe8126f77b4))

# [4.7.0](https://github.com/hawkeyexl/docmeta/compare/v4.6.0...v4.7.0) (2026-08-27)


### Bug Fixes

* **query:** case-fold collection-name dedup, capture spaced view names ([7e16669](https://github.com/hawkeyexl/docmeta/commit/7e16669e85264079f81e538b79adb99dc3b4f750)), closes [write-throu#view](https://github.com/write-throu/issues/view)


### Features

* **query:** named collections — override groups as views (proposal 0027) ([0774c6e](https://github.com/hawkeyexl/docmeta/commit/0774c6ee9fd0ccea172fb71656b0e41e1043bf72)), closes [write-throu#docs](https://github.com/write-throu/issues/docs)

# [4.6.0](https://github.com/hawkeyexl/docmeta/compare/v4.5.1...v4.6.0) (2026-08-27)


### Bug Fixes

* **checks:** omit NULL cells from the synthesized message ([577b362](https://github.com/hawkeyexl/docmeta/commit/577b362d577e29c6fde7e8991905e185a2967d2f))
* **query:** refuse --param names outside the SQL token grammar ([ed96990](https://github.com/hawkeyexl/docmeta/commit/ed96990f68636f00eadf7b0f5aedb82c1d36bb00)), closes [false-green-throu#a-typo](https://github.com/false-green-throu/issues/a-typo)
* **query:** restore the exhaustiveness guard in the format switch ([a69bf0f](https://github.com/hawkeyexl/docmeta/commit/a69bf0fc18d17672c19c617bbd6bb9c7e8434eb7))


### Features

* corpus checks are findings (proposal 0026) ([a9e8d83](https://github.com/hawkeyexl/docmeta/commit/a9e8d83b88af42120a285014ff0c1bf390afb804))
* **query:** csv output and named bind parameters (proposal 0029) ([52d5c45](https://github.com/hawkeyexl/docmeta/commit/52d5c45fc5fda78120948dd5c14433a721c02ffb))

## [4.5.1](https://github.com/hawkeyexl/docmeta/compare/v4.5.0...v4.5.1) (2026-08-26)


### Bug Fixes

* **query:** apply by default and preview with --dry-run, matching fill ([a8e28f7](https://github.com/hawkeyexl/docmeta/commit/a8e28f729600fa8f710b4d9de5e6b6e46db853a1))

# [4.5.0](https://github.com/hawkeyexl/docmeta/compare/v4.4.0...v4.5.0) (2026-08-26)


### Features

* **schemas:** add the two Agent Skills SKILL.md schemas ([98f705b](https://github.com/hawkeyexl/docmeta/commit/98f705bc0115db2bc5387b577e71750acffd3124))

# [4.4.0](https://github.com/hawkeyexl/docmeta/compare/v4.3.0...v4.4.0) (2026-08-26)


### Bug Fixes

* **extractors:** normalize TOML's native dates to the strings they were written as ([1ac5162](https://github.com/hawkeyexl/docmeta/commit/1ac5162eef000d8b1425388cbb1c161c2d107e85))
* **schemas:** split Hugo's build flags, and give X Cards' pixel floor both channels ([de6379d](https://github.com/hawkeyexl/docmeta/commit/de6379dcf7caf3b0f17dd48a093faeb5dcc8b03f))


### Features

* **schemas:** add Hugo, Jekyll, VitePress and X Cards ([de1b8af](https://github.com/hawkeyexl/docmeta/commit/de1b8afbb98ce08a34ec39b2441be3859e907442))

# [4.3.0](https://github.com/hawkeyexl/docmeta/compare/v4.2.0...v4.3.0) (2026-08-26)


### Bug Fixes

* **query:** close the comment-prefix guard bypass, classify DML structurally ([8acb460](https://github.com/hawkeyexl/docmeta/commit/8acb460886dfba8bd51ac549d6f1243ae9126aab))
* **query:** compare schema sets order-insensitively in the split guard ([90d974e](https://github.com/hawkeyexl/docmeta/commit/90d974ed73138ccba3490017a4bb129f403694db))
* **query:** create the export's parent directories ([f269aa1](https://github.com/hawkeyexl/docmeta/commit/f269aa194e024838afc329b9784a2f9f541dc1bd))
* **query:** harden the DDL edges the folded review flagged ([44c8ba1](https://github.com/hawkeyexl/docmeta/commit/44c8ba1b6800ea46c8c6868bdd152fb6fc88bc4d))
* **query:** honest no-op for delete-only on a block-less document ([1685c2a](https://github.com/hawkeyexl/docmeta/commit/1685c2a81b85ed358cea367dbb487dce758cba82))
* **query:** judge DELETE's strippability per extraction, not per extractor ([e24b03f](https://github.com/hawkeyexl/docmeta/commit/e24b03f568bb0585149dfcd198f5fbc42ca80f9a))
* **query:** load the projection in one transaction, and answer the query_only question in place ([fa000f7](https://github.com/hawkeyexl/docmeta/commit/fa000f7c36a06a79e5033b6510a6ef850783145e))
* **query:** name the format when stdin has no extension to read as ([6cf6d8e](https://github.com/hawkeyexl/docmeta/commit/6cf6d8e99df8f35eb12dfc872211942838b5d031))
* **query:** narrow a schema's required list to its string entries ([50bc4ad](https://github.com/hawkeyexl/docmeta/commit/50bc4adf37c7ec1db2431efccd2e54b74970f95c))
* **query:** re-check the rename destination at apply time ([a80bcdd](https://github.com/hawkeyexl/docmeta/commit/a80bcddb7352cfb36a15b7eecec61a94d963f10e))
* **query:** refuse an element-backed DELETE at preview time ([3da692a](https://github.com/hawkeyexl/docmeta/commit/3da692ad6332b15c08530bd40564988bc0d0cbfe))
* **query:** route DDL through the trust, config, and pin machinery it bypassed ([020eb07](https://github.com/hawkeyexl/docmeta/commit/020eb07e1a0f9d8df6349d3c3d03215ba5ccc66a))
* **query:** strip the BOM before sniffing a schema's indent ([b56e04f](https://github.com/hawkeyexl/docmeta/commit/b56e04ffef594bb5ae10ce528d9ac18a9001fed9))
* **query:** surface the unwritable-INSERT refusal at preview time ([640c1af](https://github.com/hawkeyexl/docmeta/commit/640c1af8fd6a654aec2b3c819d6d9ca24b9a394e))
* **query:** write content before moving files, and let refusals name a bigint ([2bcee63](https://github.com/hawkeyexl/docmeta/commit/2bcee63764fffc6a279bce9ffd81d36c10d2c998))


### Features

* **query:** --db writes the corpus database for any SQLite front-end ([59ba86e](https://github.com/hawkeyexl/docmeta/commit/59ba86ec491e2aca71d578a8b72175c5deeec100))
* **query:** --write applies an UPDATE to the files, preview by default ([afdc74c](https://github.com/hawkeyexl/docmeta/commit/afdc74c132182ad2e251a9003d4d2d337cd507d5))
* **query:** full CRUD — corpus-new keys and key deletion ([fdd1167](https://github.com/hawkeyexl/docmeta/commit/fdd1167b66924c16efccde3a01399b4c3914d051))
* **query:** run SQL across the metadata corpus, --check as a CI gate ([8cd7624](https://github.com/hawkeyexl/docmeta/commit/8cd76243c113166432fb4f83688a51332d41ba91))
* **query:** schema DDL — fork builtins, edit local schemas in place ([53a23c2](https://github.com/hawkeyexl/docmeta/commit/53a23c2ef7afe515fc744c913e1a0f516ff4ba14))
* **query:** standard DML — DELETE strips, INSERT creates, _path moves, NULL deletes ([d794bd9](https://github.com/hawkeyexl/docmeta/commit/d794bd9ed3b543dfe47a31feb8b526611cc4e576))

# [4.2.0](https://github.com/hawkeyexl/docmeta/compare/v4.1.3...v4.2.0) (2026-08-24)


### Bug Fixes

* **extractors:** pair elements with values in HTML too, and share the helper ([cdfbbc8](https://github.com/hawkeyexl/docmeta/commit/cdfbbc8f56e70ff978901c73da2db2819d9c7a46))
* **extractors:** write element keys in HTML, and re-read with the same options ([4ef47f9](https://github.com/hawkeyexl/docmeta/commit/4ef47f99651ab54654b4ab9948b8d1d6452a64e2))


### Features

* **config:** add `elements:` for element paths the convention misses ([027bed4](https://github.com/hawkeyexl/docmeta/commit/027bed46f105dc107983d541a23b9b6fd9b324e3))
* **extractors:** create missing DITA metadata elements in content-model order ([0b72f4b](https://github.com/hawkeyexl/docmeta/commit/0b72f4b857b0ea3a0bf6ecc273523ef85ca09253))
* **extractors:** lift the rest of the DITA prolog, and check what the writer emits ([1273119](https://github.com/hawkeyexl/docmeta/commit/1273119b15b65ba67a7eab092a321c1895f00f6d))
* **extractors:** read DITA's typed prolog and topicmeta metadata ([997560a](https://github.com/hawkeyexl/docmeta/commit/997560a5bd495998a4c637b399a3844d2fd4ee23))
* **extractors:** read metadata from elements in XML and HTML ([0478d91](https://github.com/hawkeyexl/docmeta/commit/0478d91637a32cd829ec57bad932f1a354988322))
* **extractors:** write element-derived metadata back where it was read ([125524f](https://github.com/hawkeyexl/docmeta/commit/125524f7062e397ec344aab43496ae305183d67a))
* **schemas:** add oasis:dita-metadata:1.3, and document element metadata ([41a3177](https://github.com/hawkeyexl/docmeta/commit/41a3177866580fc2b4cbb5e126ef226374730772))
* **schemas:** add seven built-in schemas for platforms and vocabularies ([6f14fa3](https://github.com/hawkeyexl/docmeta/commit/6f14fa392c480b62566d9ce2b3840995b24683ce))

## [4.1.3](https://github.com/hawkeyexl/docmeta/compare/v4.1.2...v4.1.3) (2026-08-23)


### Bug Fixes

* **action:** stop the composite step aborting on bash 3.2 ([1885871](https://github.com/hawkeyexl/docmeta/commit/188587139b39f0bcb2b4c7f754765c50ba680a3f))
* **ci:** retry a transient HTTP status, not just a thrown fetch ([af45550](https://github.com/hawkeyexl/docmeta/commit/af45550ed319c4946d7a3d4ce23214f40831a25a))

## [4.1.2](https://github.com/hawkeyexl/docmeta/compare/v4.1.1...v4.1.2) (2026-08-22)


### Bug Fixes

* **deps:** require @hawkeyexl/inference 0.3.1 so --local works ([#107](https://github.com/hawkeyexl/docmeta/issues/107)) ([ad8db25](https://github.com/hawkeyexl/docmeta/commit/ad8db254cb76678f1b8ad713be0a384157860146)), closes [hawkeyexl/moose-inference#9](https://github.com/hawkeyexl/moose-inference/issues/9)

## [4.1.1](https://github.com/hawkeyexl/docmeta/compare/v4.1.0...v4.1.1) (2026-08-22)


### Bug Fixes

* **ci:** stop squash merges from skipping the release ([#106](https://github.com/hawkeyexl/docmeta/issues/106)) ([ea27022](https://github.com/hawkeyexl/docmeta/commit/ea27022adb218a217941320b96a146aff80e1523)), closes [#103](https://github.com/hawkeyexl/docmeta/issues/103)

# [4.1.0](https://github.com/hawkeyexl/docmeta/compare/v4.0.0...v4.1.0) (2026-08-22)


### Features

* ship a GitHub Action and a pre-commit hook ([#104](https://github.com/hawkeyexl/docmeta/issues/104)) ([6c5bc75](https://github.com/hawkeyexl/docmeta/commit/6c5bc75e568e6c280ea8c0150737d5bbcff7b666))

# [4.1.0-action-and-precommit-hook.4](https://github.com/hawkeyexl/docmeta/compare/v4.1.0-action-and-precommit-hook.3...v4.1.0-action-and-precommit-hook.4) (2026-08-22)


### Bug Fixes

* accept newline-separated paths and args, and warn on shell quotes ([9ed407d](https://github.com/hawkeyexl/docmeta/commit/9ed407daa4510edef599fb2a28f24bddcef480bf))

# [4.1.0-action-and-precommit-hook.3](https://github.com/hawkeyexl/docmeta/compare/v4.1.0-action-and-precommit-hook.2...v4.1.0-action-and-precommit-hook.3) (2026-08-22)


### Bug Fixes

* let a broken husky fail loudly in the prepare guard ([510121d](https://github.com/hawkeyexl/docmeta/commit/510121d9d5ab30f23f1e40459bc4bb5449197553)), closes [#104](https://github.com/hawkeyexl/docmeta/issues/104)

# [4.1.0-action-and-precommit-hook.2](https://github.com/hawkeyexl/docmeta/compare/v4.1.0-action-and-precommit-hook.1...v4.1.0-action-and-precommit-hook.2) (2026-08-22)


### Bug Fixes

* pin setup-node in the action, and locate the run block by id ([e39cff7](https://github.com/hawkeyexl/docmeta/commit/e39cff721baedaff627322abd098e9d3c8e30cb8)), closes [#104](https://github.com/hawkeyexl/docmeta/issues/104)

# [4.1.0-action-and-precommit-hook.1](https://github.com/hawkeyexl/docmeta/compare/v4.0.0...v4.1.0-action-and-precommit-hook.1) (2026-08-22)


### Bug Fixes

* write exit-code before the action's script aborts ([e7edb32](https://github.com/hawkeyexl/docmeta/commit/e7edb323433b63742d0f23e2dd1ae4018f632510))


### Features

* ship a GitHub Action and a pre-commit hook ([7ccab63](https://github.com/hawkeyexl/docmeta/commit/7ccab6302da9d0840b863c3d110fdce614057126))

# [4.0.0](https://github.com/hawkeyexl/docmeta/compare/v3.13.0...v4.0.0) (2026-08-22)


* feat(fill)!: send the whole document, and add --local ([#102](https://github.com/hawkeyexl/docmeta/issues/102)) ([37d19d3](https://github.com/hawkeyexl/docmeta/commit/37d19d34accb1651018f55d13106f0fcc0cbbd18)), closes [#74](https://github.com/hawkeyexl/docmeta/issues/74) [97-#99](https://github.com/97-/issues/99)


### Bug Fixes

* **extractors:** stop a BOM shifting the columns HTML reports ([#100](https://github.com/hawkeyexl/docmeta/issues/100)) ([e1a1483](https://github.com/hawkeyexl/docmeta/commit/e1a1483a2ad6595c5b5d3ce4301babf4d45bebde)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99)


### Features

* **extractors:** read and write DITA prolog metadata ([#99](https://github.com/hawkeyexl/docmeta/issues/99)) ([d56cc84](https://github.com/hawkeyexl/docmeta/commit/d56cc84c13a0069e232be4b210ce0e23f7a7ccdd))
* **extractors:** write metadata back to HTML ([#97](https://github.com/hawkeyexl/docmeta/issues/97)) ([43a9b0e](https://github.com/hawkeyexl/docmeta/commit/43a9b0e33aecbf6580732fe3ccfef84ed223f3db)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99) [#62](https://github.com/hawkeyexl/docmeta/issues/62)
* **extractors:** write metadata back to XML ([#98](https://github.com/hawkeyexl/docmeta/issues/98)) ([c2036e3](https://github.com/hawkeyexl/docmeta/commit/c2036e37b84f1acb4c0c45cc55118d2c7b0c79c1))


### BREAKING CHANGES

* `--max-cost-usd` and the `fill.maxCostUsd` config key are
removed. Use `--max-turns` / `fill.maxTurns` to bound a run, or `--local`, which
costs nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* chore(release): 4.0.0-fill-local-and-chunking.1 [skip ci]

# [4.0.0-fill-local-and-chunking.1](https://github.com/hawkeyexl/docmeta/compare/v3.13.0...v4.0.0-fill-local-and-chunking.1) (2026-08-22)

* feat(fill)!: send the whole document, and add --local ([a92953e](https://github.com/hawkeyexl/docmeta/commit/a92953e3c8d8e6ed1fae1fada47a2ca9c56247f2)), closes [97-#99](https://github.com/97-/issues/99)

### Bug Fixes

* **extractors:** stop a BOM shifting the columns HTML reports ([#100](https://github.com/hawkeyexl/docmeta/issues/100)) ([e1a1483](https://github.com/hawkeyexl/docmeta/commit/e1a1483a2ad6595c5b5d3ce4301babf4d45bebde)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99)

### Features

* **extractors:** read and write DITA prolog metadata ([#99](https://github.com/hawkeyexl/docmeta/issues/99)) ([d56cc84](https://github.com/hawkeyexl/docmeta/commit/d56cc84c13a0069e232be4b210ce0e23f7a7ccdd))
* **extractors:** write metadata back to HTML ([#97](https://github.com/hawkeyexl/docmeta/issues/97)) ([43a9b0e](https://github.com/hawkeyexl/docmeta/commit/43a9b0e33aecbf6580732fe3ccfef84ed223f3db)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99) [#62](https://github.com/hawkeyexl/docmeta/issues/62)
* **extractors:** write metadata back to XML ([#98](https://github.com/hawkeyexl/docmeta/issues/98)) ([c2036e3](https://github.com/hawkeyexl/docmeta/commit/c2036e37b84f1acb4c0c45cc55118d2c7b0c79c1))

### BREAKING CHANGES

* `--max-cost-usd` and the `fill.maxCostUsd` config key are
removed. Use `--max-turns` / `fill.maxTurns` to bound a run, or `--local`, which
costs nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(fill): refuse a document any failure cut short, not just the turn cap

Review found the same hole the turn-cap guard closed, reachable by a second
route. When a chunk failed part-way through a document, the guard only refused
if *nothing* had been collected — so one or more successful chunks were merged
and written as though they described the whole page.

Measured against a provider that succeeds twice then errors, on a file needing
seven chunks: the run reported no error and wrote a field inferred from two of
them. A transient upstream error on chunk three of a long reference page
therefore produced a `description` derived from its introduction, written into
the user's file, with nothing in the output saying the rest was never read.

The overflow path had it too: once the single halve-and-retry is spent, control
falls through and whatever chunks succeeded are accepted.

The guard is now "every chunk was read, or the document is refused", which
covers both routes and the turn cap, and a mutation test pins it.

Also sums token usage across chunks rather than caching the last call's, which
understated a chunked file by roughly its chunk count. Nothing reads it back
today — which is why it was worth correcting before something does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* chore(release): 4.0.0-fill-local-and-chunking.2 [skip ci]

# [4.0.0-fill-local-and-chunking.2](https://github.com/hawkeyexl/docmeta/compare/v4.0.0-fill-local-and-chunking.1...v4.0.0-fill-local-and-chunking.2) (2026-08-22)

### Bug Fixes

* **fill:** refuse a document any failure cut short, not just the turn cap ([787607f](https://github.com/hawkeyexl/docmeta/commit/787607ff11db786cf168e4c3d0c852c068cd55d8))

* refactor(fill): drop two casts the library already types

Both were unnecessary rather than merely noisy, which is the reason to remove
them: `ProviderName` includes `"llama-cpp"`, so the literal is assignable to
`ProviderSelector` on its own, and `LLAMA_MODELS` is exported as
`Record<string, LlamaModelEntry>` with `sizeBytes` and an optional `tier`. Each
cast asserted a shape the compiler could already prove — and would have gone on
asserting it after the library changed.

Also records why the halve-and-retry path does not roll back its turn count:
those calls were made and billed, so un-counting them would make `--max-turns`
describe something other than what happened. It does mean a document that
triggers the retry costs more turns than its final chunk count suggests, which
is worth saying where the retry happens rather than leaving to be rediscovered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* refactor(fill): drop dead billedCalls, and let the compiler find the next one

`billedCalls` was read only by `projectedCost()`, which computed the cost
reservation for `--max-cost-usd`. That function went with the priming machinery;
the declaration and the increment stayed, accumulating on every chunk call and
being discarded at the end of the run.

Enabling `noUnusedLocals` matters more than the deletion. `strict` does not
cover this class, so the only way to find it was to grep — which is not a check
anyone runs, and is exactly how it survived the removal that orphaned it. The
whole tree had two other violations, both unused imports (`ReportFormat` in
`cli.ts`, `Buffer` in `schemas.ts`), so the flag costs nothing and turns a
manual catch into a compiler guarantee. Verified against a deliberate write-only
local, which now fails the typecheck.

`noUnusedParameters` is left off: it still has one violation, and clearing it is
unrelated to this PR.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(fill): reset cached usage on retry, and pin the overflow matcher

Two review nits. One was right, one was not, and the second is the more useful
of the two to write down.

`usageTotal` accumulated across the halve-and-retry, so a document whose first
attempt overflowed part-way through had those chunks' tokens counted again by
the second attempt. Reset before the retry: the figure describes the document,
not the run, and nothing reads it back yet — which is the moment to make it
right rather than after something does.

The other nit proposed dropping bare `exceeds` from `looksLikeOverflow`, because
it would match "rate limit exceeded" and "quota exceeded". The consequence would
have been real: overflow triggers a halve-and-retry, and halving *doubles* the
call count, so answering a rate limit that way would send twice the requests
that provoked it.

It does not match them. "exceeded" does not contain "exceeds". Checked against
both, plus "429 Too Many Requests" — none match, before or after. Dropping it
cost a genuine overflow instead: "Your input exceeds the maximum allowed length"
matched before and would not after. So the change is reverted, and the one
letter now has a comment explaining why it is deliberate.

The regression test that came out of this is the part worth keeping. It asserts
both directions — a rate limit does not re-chunk, a real overflow does — because
the first assertion alone passed with the matcher broken, which is how the wrong
fix looked correct for a few minutes. Loosening `exceeds` to `exceed` now fails
it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* chore(release): 4.0.0-fill-local-and-chunking.3 [skip ci]

# [4.0.0-fill-local-and-chunking.3](https://github.com/hawkeyexl/docmeta/compare/v4.0.0-fill-local-and-chunking.2...v4.0.0-fill-local-and-chunking.3) (2026-08-22)

### Bug Fixes

* **fill:** reset cached usage on retry, and pin the overflow matcher ([e86767d](https://github.com/hawkeyexl/docmeta/commit/e86767da91eff25c75f04caabaa97d964b88c48a))

# [4.0.0-fill-local-and-chunking.3](https://github.com/hawkeyexl/docmeta/compare/v4.0.0-fill-local-and-chunking.2...v4.0.0-fill-local-and-chunking.3) (2026-08-22)


### Bug Fixes

* **fill:** reset cached usage on retry, and pin the overflow matcher ([e86767d](https://github.com/hawkeyexl/docmeta/commit/e86767da91eff25c75f04caabaa97d964b88c48a))

# [4.0.0-fill-local-and-chunking.2](https://github.com/hawkeyexl/docmeta/compare/v4.0.0-fill-local-and-chunking.1...v4.0.0-fill-local-and-chunking.2) (2026-08-22)


### Bug Fixes

* **fill:** refuse a document any failure cut short, not just the turn cap ([787607f](https://github.com/hawkeyexl/docmeta/commit/787607ff11db786cf168e4c3d0c852c068cd55d8))

# [4.0.0-fill-local-and-chunking.1](https://github.com/hawkeyexl/docmeta/compare/v3.13.0...v4.0.0-fill-local-and-chunking.1) (2026-08-22)


* feat(fill)!: send the whole document, and add --local ([a92953e](https://github.com/hawkeyexl/docmeta/commit/a92953e3c8d8e6ed1fae1fada47a2ca9c56247f2)), closes [97-#99](https://github.com/97-/issues/99)


### Bug Fixes

* **extractors:** stop a BOM shifting the columns HTML reports ([#100](https://github.com/hawkeyexl/docmeta/issues/100)) ([e1a1483](https://github.com/hawkeyexl/docmeta/commit/e1a1483a2ad6595c5b5d3ce4301babf4d45bebde)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99)


### Features

* **extractors:** read and write DITA prolog metadata ([#99](https://github.com/hawkeyexl/docmeta/issues/99)) ([d56cc84](https://github.com/hawkeyexl/docmeta/commit/d56cc84c13a0069e232be4b210ce0e23f7a7ccdd))
* **extractors:** write metadata back to HTML ([#97](https://github.com/hawkeyexl/docmeta/issues/97)) ([43a9b0e](https://github.com/hawkeyexl/docmeta/commit/43a9b0e33aecbf6580732fe3ccfef84ed223f3db)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99) [#62](https://github.com/hawkeyexl/docmeta/issues/62)
* **extractors:** write metadata back to XML ([#98](https://github.com/hawkeyexl/docmeta/issues/98)) ([c2036e3](https://github.com/hawkeyexl/docmeta/commit/c2036e37b84f1acb4c0c45cc55118d2c7b0c79c1))


### BREAKING CHANGES

* `--max-cost-usd` and the `fill.maxCostUsd` config key are
removed. Use `--max-turns` / `fill.maxTurns` to bound a run, or `--local`, which
costs nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

# [3.14.0-dita-write.1](https://github.com/hawkeyexl/docmeta/compare/v3.13.0...v3.14.0-dita-write.1) (2026-08-22)


### Features

* **extractors:** read and write DITA prolog metadata ([62ace6a](https://github.com/hawkeyexl/docmeta/commit/62ace6a2518c4c663b7a352f052e0ca123d0e4f0))
* **extractors:** write metadata back to HTML ([#97](https://github.com/hawkeyexl/docmeta/issues/97)) ([43a9b0e](https://github.com/hawkeyexl/docmeta/commit/43a9b0e33aecbf6580732fe3ccfef84ed223f3db)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99) [#62](https://github.com/hawkeyexl/docmeta/issues/62)
* **extractors:** write metadata back to XML ([#98](https://github.com/hawkeyexl/docmeta/issues/98)) ([c2036e3](https://github.com/hawkeyexl/docmeta/commit/c2036e37b84f1acb4c0c45cc55118d2c7b0c79c1))

# [3.14.0-xml-write.1](https://github.com/hawkeyexl/docmeta/compare/v3.13.0...v3.14.0-xml-write.1) (2026-08-22)


### Features

* **extractors:** write metadata back to HTML ([#97](https://github.com/hawkeyexl/docmeta/issues/97)) ([43a9b0e](https://github.com/hawkeyexl/docmeta/commit/43a9b0e33aecbf6580732fe3ccfef84ed223f3db)), closes [#99](https://github.com/hawkeyexl/docmeta/issues/99) [#62](https://github.com/hawkeyexl/docmeta/issues/62)
* **extractors:** write metadata back to XML ([8a1ba20](https://github.com/hawkeyexl/docmeta/commit/8a1ba20f7c40d1390a0a4325047abf736367b987))

# [3.14.0-html-write.1](https://github.com/hawkeyexl/docmeta/compare/v3.13.0...v3.14.0-html-write.1) (2026-08-21)


### Features

* **extractors:** write metadata back to HTML ([f085872](https://github.com/hawkeyexl/docmeta/commit/f0858726313359e6754fbb7f9d478c3ec5613326))

# [3.13.0](https://github.com/hawkeyexl/docmeta/compare/v3.12.1...v3.13.0) (2026-08-21)


### Features

* **schemas:** report metadata coverage with `docmeta schemas infer` ([#96](https://github.com/hawkeyexl/docmeta/issues/96)) ([88492bb](https://github.com/hawkeyexl/docmeta/commit/88492bb9b1e59c749c17b33569a8f3d34aae2f26))

## [3.12.1](https://github.com/hawkeyexl/docmeta/compare/v3.12.0...v3.12.1) (2026-08-20)


### Bug Fixes

* proposal 0013 cleanup — dead code, the unpopulated `col`, strict config keys ([#92](https://github.com/hawkeyexl/docmeta/issues/92)) ([1dde5b9](https://github.com/hawkeyexl/docmeta/commit/1dde5b9f54e1c1f938a86e4c7ea670554d96e832)), closes [#84](https://github.com/hawkeyexl/docmeta/issues/84)

# [3.12.0](https://github.com/hawkeyexl/docmeta/compare/v3.11.1...v3.12.0) (2026-08-20)


### Features

* **schemas:** publish the built-in schemas at stable URLs ([#91](https://github.com/hawkeyexl/docmeta/issues/91)) ([a9df163](https://github.com/hawkeyexl/docmeta/commit/a9df1632d9362f019dcfe14b7bc4f0a5a0033ef8))

## [3.11.1](https://github.com/hawkeyexl/docmeta/compare/v3.11.0...v3.11.1) (2026-08-20)


### Bug Fixes

* **schemas:** strip a leading BOM before parsing, never before hashing ([#94](https://github.com/hawkeyexl/docmeta/issues/94)) ([cde18dc](https://github.com/hawkeyexl/docmeta/commit/cde18dc7d3aef9d76ce77ce00388cc85f6b70d20))

# [3.11.0](https://github.com/hawkeyexl/docmeta/compare/v3.10.0...v3.11.0) (2026-08-20)


### Features

* **schemas:** let a repo constrain what a document's `$schema` may name ([#88](https://github.com/hawkeyexl/docmeta/issues/88)) ([214bbaa](https://github.com/hawkeyexl/docmeta/commit/214bbaa05498b4a802734c27d14d1677200b3242)), closes [#74](https://github.com/hawkeyexl/docmeta/issues/74) [#73](https://github.com/hawkeyexl/docmeta/issues/73)

# [3.10.0](https://github.com/hawkeyexl/docmeta/compare/v3.9.1...v3.10.0) (2026-08-20)


### Features

* **cli:** one input and output surface across validate, get, and fill ([#86](https://github.com/hawkeyexl/docmeta/issues/86)) ([7ecde9b](https://github.com/hawkeyexl/docmeta/commit/7ecde9bbf20c8154adebadb0565fd02c50cc24bd))

## [3.9.1](https://github.com/hawkeyexl/docmeta/compare/v3.9.0...v3.9.1) (2026-08-20)


### Bug Fixes

* **cli:** usage errors exit 2, and two adjacent output bugs ([#84](https://github.com/hawkeyexl/docmeta/issues/84)) ([6fed95a](https://github.com/hawkeyexl/docmeta/commit/6fed95af39c8cba6da249fc4a52c112981fb67b7))

# [3.9.0](https://github.com/hawkeyexl/docmeta/compare/v3.8.0...v3.9.0) (2026-08-20)


### Features

* **schemas:** vendor a remote schema into the repository and pin it ([#82](https://github.com/hawkeyexl/docmeta/issues/82)) ([ee70724](https://github.com/hawkeyexl/docmeta/commit/ee70724e9cb78c0b99b52baf499c019f2bd70d53))

# [3.8.0](https://github.com/hawkeyexl/docmeta/compare/v3.7.1...v3.8.0) (2026-08-20)


### Bug Fixes

* **schemas:** three schema-loading fixes — relative config refs, --offline dedup, future cache mtime ([#83](https://github.com/hawkeyexl/docmeta/issues/83)) ([92fc048](https://github.com/hawkeyexl/docmeta/commit/92fc048e39795a5f46d7df3f6635c208500127fa))


### Features

* **schemas:** cache fetched schemas across runs, and add --offline ([#81](https://github.com/hawkeyexl/docmeta/issues/81)) ([0b9a6d3](https://github.com/hawkeyexl/docmeta/commit/0b9a6d39bfc7aefca50e882cf038d2d4f552168f))

## [3.7.1](https://github.com/hawkeyexl/docmeta/compare/v3.7.0...v3.7.1) (2026-08-19)


### Bug Fixes

* **schemas:** reject a fetched payload that constrains nothing ([#80](https://github.com/hawkeyexl/docmeta/issues/80)) ([ad60b70](https://github.com/hawkeyexl/docmeta/commit/ad60b70b7add86f4be179d4e4abc443540e6a49e))

# [3.7.0](https://github.com/hawkeyexl/docmeta/compare/v3.6.0...v3.7.0) (2026-08-19)


### Features

* **reporters:** add SARIF and JUnit output ([#79](https://github.com/hawkeyexl/docmeta/issues/79)) ([bc01a59](https://github.com/hawkeyexl/docmeta/commit/bc01a59e737705b876bbbd2b155ba55179b1321f))

# [3.6.0](https://github.com/hawkeyexl/docmeta/compare/v3.5.0...v3.6.0) (2026-08-19)


### Features

* **cli:** honor .gitignore when walking directories and globs ([#77](https://github.com/hawkeyexl/docmeta/issues/77)) ([1f501ae](https://github.com/hawkeyexl/docmeta/commit/1f501aeee734384185f95fbd140a6ab8dd56953a))

# [3.5.0](https://github.com/hawkeyexl/docmeta/compare/v3.4.2...v3.5.0) (2026-08-19)


### Features

* **validate:** add a baseline so a standard can tighten today ([#76](https://github.com/hawkeyexl/docmeta/issues/76)) ([10421ac](https://github.com/hawkeyexl/docmeta/commit/10421ac7605208a4cb15e2933f50ed5abf7eb723))

## [3.4.2](https://github.com/hawkeyexl/docmeta/compare/v3.4.1...v3.4.2) (2026-08-19)


### Bug Fixes

* **config:** discover docmeta.config.yaml in ancestor directories ([#74](https://github.com/hawkeyexl/docmeta/issues/74)) ([8da9b0e](https://github.com/hawkeyexl/docmeta/commit/8da9b0e146aab3f08a9250e7d81835f55b552517))

## [3.4.1](https://github.com/hawkeyexl/docmeta/compare/v3.4.0...v3.4.1) (2026-08-18)


### Bug Fixes

* **cli:** treat an empty input set as an error, not success ([#73](https://github.com/hawkeyexl/docmeta/issues/73)) ([d448b81](https://github.com/hawkeyexl/docmeta/commit/d448b813d3df81d2d01233b474b4776be68ce149))

# [3.4.0](https://github.com/hawkeyexl/docmeta/compare/v3.3.0...v3.4.0) (2026-08-11)


### Features

* **schemas:** add built-in Docusaurus 3.10 front matter schemas ([#67](https://github.com/hawkeyexl/docmeta/issues/67)) ([2d308f1](https://github.com/hawkeyexl/docmeta/commit/2d308f15422e3fb37cacc8d4dc4b5c9295273c48))

# [3.3.0](https://github.com/hawkeyexl/docmeta/compare/v3.2.2...v3.3.0) (2026-08-11)


### Features

* **fill:** name the local model by its catalog alias ([#68](https://github.com/hawkeyexl/docmeta/issues/68)) ([cebded8](https://github.com/hawkeyexl/docmeta/commit/cebded8c686c04bdc0d17c9e998e4b50aa30f8d3))

## [3.2.2](https://github.com/hawkeyexl/docmeta/compare/v3.2.1...v3.2.2) (2026-08-10)


### Bug Fixes

* **validator:** compile each schema once, keyed by ref and by $id ([#65](https://github.com/hawkeyexl/docmeta/issues/65)) ([1462b6d](https://github.com/hawkeyexl/docmeta/commit/1462b6d921b029154ef96728dfec78f7c6c8a11b))

## [3.2.1](https://github.com/hawkeyexl/docmeta/compare/v3.2.0...v3.2.1) (2026-08-10)


### Bug Fixes

* **fill:** make schema-set order irrelevant to what `fill` proposes ([#64](https://github.com/hawkeyexl/docmeta/issues/64)) ([4c14a39](https://github.com/hawkeyexl/docmeta/commit/4c14a39e468abf5fab04a4e68154f093b65dddcd))

# [3.2.0](https://github.com/hawkeyexl/docmeta/compare/v3.1.0...v3.2.0) (2026-08-10)


### Features

* **fill:** detect an inference provider instead of assuming anthropic ([#62](https://github.com/hawkeyexl/docmeta/issues/62)) ([2f60978](https://github.com/hawkeyexl/docmeta/commit/2f60978e9ec3c5c872fd33d9714773f77ab6429f))

# [3.1.0](https://github.com/hawkeyexl/docmeta/compare/v3.0.1...v3.1.0) (2026-08-10)


### Features

* **extractors:** read .dita and .ditamap as XML ([#63](https://github.com/hawkeyexl/docmeta/issues/63)) ([09a8e22](https://github.com/hawkeyexl/docmeta/commit/09a8e22f71bc20938704474d9b5173d9e420732e))

## [3.0.1](https://github.com/hawkeyexl/docmeta/compare/v3.0.0...v3.0.1) (2026-08-10)


### Bug Fixes

* **schemas:** require `type` on the Diataxis vocabulary ([#61](https://github.com/hawkeyexl/docmeta/issues/61)) ([f7e611b](https://github.com/hawkeyexl/docmeta/commit/f7e611bafcdd6c9b3888a6a7f6e3cda5c9e7a115))

# [3.0.0](https://github.com/hawkeyexl/docmeta/compare/v2.0.0...v3.0.0) (2026-08-10)


### Features

* **schemas:** add a built-in Good Docs Project vocabulary ([#60](https://github.com/hawkeyexl/docmeta/issues/60)) ([4a3ea3b](https://github.com/hawkeyexl/docmeta/commit/4a3ea3b6b22c3706558268e66dc842a668817ede))


### BREAKING CHANGES

* **schemas:** `tgdp:templates:1.0` requires `type`. A document with no
`type` now fails against it where an earlier build of this branch passed.
Nothing released is affected, since the schema ships for the first time in
this change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

# [2.0.0](https://github.com/hawkeyexl/docmeta/compare/v1.4.1...v2.0.0) (2026-08-09)


* feat(schemas)!: add built-in Diataxis and Seven-Action vocabularies ([#56](https://github.com/hawkeyexl/docmeta/issues/56)) ([057f007](https://github.com/hawkeyexl/docmeta/commit/057f0078a466f7c381bd880f9bb3cde86aeeaa75))


### BREAKING CHANGES

* the `DEFAULT_SCHEMA` export is removed from the package
entry point. Use `DEFAULT_SCHEMAS`, which is a `readonly string[]` holding
the built-in default set rather than a single schema id.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

* fix(schemas): freeze the exported default set

`DEFAULT_SCHEMAS` is part of the package entry point, and `readonly
string[]` is a compile-time constraint only — a JS consumer, or a TS one
casting it, could push onto the shared array and change the default for
every later resolution in a long-lived process. Freeze it, and cover both
halves: the export throws on mutation, and `resolveSchemaSet` keeps
handing back a fresh array callers may edit freely.

Also names the default *set* where docs/schemas/index.mdx still read as
though the fallback were OKF alone.
* `docmeta fill` now proposes an `action` value for every
document by default. Seven-Action is in the built-in default set, and
`fill` treats any schema property a document lacks as fillable regardless
of whether it is required — so a bare `docmeta fill` makes an inference
call per file. A document that already has an `action` meaning something
else is worse off: an invalid value is a candidate for *replacement*, and
fill writes to disk unless `--dry-run` is passed. To opt out, list the
schemas you want under `schemas:` in docmeta.config.yaml; that replaces
the default set entirely.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

## [1.4.1](https://github.com/hawkeyexl/docmeta/compare/v1.4.0...v1.4.1) (2026-08-04)


### Bug Fixes

* **docs:** repair frontmatter broken by the em-dash cleanup ([#54](https://github.com/hawkeyexl/docmeta/issues/54)) ([b1219d4](https://github.com/hawkeyexl/docmeta/commit/b1219d40bee004d144f58edcbfcca1d9d0ed1840)), closes [#52](https://github.com/hawkeyexl/docmeta/issues/52)

# [1.4.0](https://github.com/hawkeyexl/docmeta/compare/v1.3.0...v1.4.0) (2026-08-04)


### Features

* **cli:** add a fill subcommand that infers metadata behind a confidence gate ([#52](https://github.com/hawkeyexl/docmeta/issues/52)) ([dc341ab](https://github.com/hawkeyexl/docmeta/commit/dc341ab547cb7ae455b6432233b79e647bad264f))

# [1.3.0](https://github.com/hawkeyexl/docmeta/compare/v1.2.0...v1.3.0) (2026-07-21)


### Features

* **api:** export the frontmatter extractor ([#42](https://github.com/hawkeyexl/docmeta/issues/42)) ([2d6d212](https://github.com/hawkeyexl/docmeta/commit/2d6d21265e71cd0caa675e401a41c3feadc9e662))

# [1.3.0-docevals-builtin-schema.2](https://github.com/hawkeyexl/docmeta/compare/v1.3.0-docevals-builtin-schema.1...v1.3.0-docevals-builtin-schema.2) (2026-07-21)


### Bug Fixes

* **schemas:** correct stale key name in docevals reference; tighten llm allOf guard ([d3151fc](https://github.com/hawkeyexl/docmeta/commit/d3151fc11385f47a8936fb51a769127b67e0d499)), closes [#42](https://github.com/hawkeyexl/docmeta/issues/42)

# [1.3.0-docevals-builtin-schema.1](https://github.com/hawkeyexl/docmeta/compare/v1.2.0...v1.3.0-docevals-builtin-schema.1) (2026-07-21)


### Features

* **schemas:** add docevals:frontmatter:0.1 built-in and export extractFrontmatter ([99f7b11](https://github.com/hawkeyexl/docmeta/commit/99f7b1148ce71914c6684acf6a6c89f2dc334f81))
* **schemas:** add dockg:frontmatter:0.1 built-in schema ([7259f2b](https://github.com/hawkeyexl/docmeta/commit/7259f2b4d083a114797f0236efbd8e60681255be))

# [1.2.0](https://github.com/hawkeyexl/docmeta/compare/v1.1.0...v1.2.0) (2026-07-07)


### Bug Fixes

* **extractors:** correct TOML nested-key line map and rst fence fallback ([c8cdcb5](https://github.com/hawkeyexl/docmeta/commit/c8cdcb59ab45b29e11f7a7b177978b9a05f94ad4))
* **extractors:** recover AsciiDoc title after an unterminated fence ([f3a8bc8](https://github.com/hawkeyexl/docmeta/commit/f3a8bc8956932d9c44ad4c6186fd19c795b4ffab))
* **extractors:** reject a non-object frontmatter root ([84f8366](https://github.com/hawkeyexl/docmeta/commit/84f8366427f0083086097ead418aa94a9bda09cf))


### Features

* **extractors:** add TOML and JSON frontmatter support ([9089ddc](https://github.com/hawkeyexl/docmeta/commit/9089ddc1e71edf2a583e96a200fbf1813a2475ca))

# [1.1.0](https://github.com/hawkeyexl/docmeta/compare/v1.0.0...v1.1.0) (2026-06-27)


### Bug Fixes

* **get:** guard nested lookups against inherited props; address review nits ([c0fb28f](https://github.com/hawkeyexl/docmeta/commit/c0fb28f0296a2f918c7f91fc7ec4dbeba257aeab))


### Features

* **get:** resolve nested fields via dot-notation and JSON Pointer ([ae16994](https://github.com/hawkeyexl/docmeta/commit/ae16994bd64bf1b648ab9ea08043a818aa5825f7))

# [1.0.0](https://github.com/hawkeyexl/docmeta/compare/v0.1.0...v1.0.0) (2026-06-27)


* feat!: raise minimum Node to 24 and restore commander 15 ([f62532a](https://github.com/hawkeyexl/docmeta/commit/f62532af74c384f1871ec8e0f315b0f775346092))


### Bug Fixes

* **deps:** keep Node 20 support and repair lockfile sync for CI ([fab363e](https://github.com/hawkeyexl/docmeta/commit/fab363e999347804fe6093161c719b57836605bf))
* **extractors:** don't annotate RST errors at line 1 when no docinfo ([c0fddc1](https://github.com/hawkeyexl/docmeta/commit/c0fddc104c15790267f4d675c06e3f61b4f806b1))
* **extractors:** harden AsciiDoc frontmatter fallback and line mapping ([c7a4193](https://github.com/hawkeyexl/docmeta/commit/c7a4193d5db2fae08b3a7c3cd0ae82926094dd92))
* **extractors:** honor bare top-level keys in lineFor ([#7](https://github.com/hawkeyexl/docmeta/issues/7)) ([43c7eb0](https://github.com/hawkeyexl/docmeta/commit/43c7eb0071fbf718b95833e887fe5dc88fa0eb4d))
* **extractors:** validate RST title adornment char and length ([846b8bd](https://github.com/hawkeyexl/docmeta/commit/846b8bdb9889219f7242a774fda153271b304cc4))


### Features

* **cli:** unify get input handling with validate ([755dbfe](https://github.com/hawkeyexl/docmeta/commit/755dbfe7470f0b83680b528484c18408fb6d71e7))
* **core:** fetch and use externally-specified $schema URIs across dialects ([#8](https://github.com/hawkeyexl/docmeta/issues/8)) ([e775712](https://github.com/hawkeyexl/docmeta/commit/e77571278598eebab6e54f1f454e5a3ebac3c118))
* expose programmatic API via package exports and add CLI-reference drift check ([c92ab88](https://github.com/hawkeyexl/docmeta/commit/c92ab88b834dde1ccb20bad5df93769f4355d185))
* **extractors:** add AsciiDoc metadata support ([261c69b](https://github.com/hawkeyexl/docmeta/commit/261c69bff417c7b49dc58d1c9cd9796eca692ebf))
* **extractors:** add reStructuredText metadata support ([55ebdba](https://github.com/hawkeyexl/docmeta/commit/55ebdbae877ce62445c1ba78b6d66ec23dee94ec))
* **extractors:** add XML and HTML metadata support ([#5](https://github.com/hawkeyexl/docmeta/issues/5)) ([349b179](https://github.com/hawkeyexl/docmeta/commit/349b179fc5dadb7b79b01a4b72f1121196f6996f))
* **extractors:** extract the RST document title into metadata ([6b9d2ce](https://github.com/hawkeyexl/docmeta/commit/6b9d2ce8b3c3848866b4819e7d4da9626f09d910))


### BREAKING CHANGES

* docmeta now requires Node.js 24 or newer.

Verified with `npm ci`: typecheck, build and 124/124 tests pass; the
docs CLI-reference sync check passes.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
