# 0047: a field's preferred location, `x-manni-location`, and `manni meta relocate`

- **Status:** Implemented (#37)
- **Serves:** Two journeys.
  - Sara · S1, "Define our metadata standard as a schema". Her standard says
    which fields a page carries into delivered output and which it keeps
    elsewhere.
  - Maya · M4, "Retrofit a docset that never had metadata, without breaking our
    data policy". Moving maintainer metadata out of the pages is one command,
    and no writer puts it back.
- **Depends on:** Four earlier proposals.
  - [0023](0023-metadata-vocabularies.md) is the vocabulary family whose every
    field this proposal marks, as new drafts beside the old.
  - [0041](0041-collections.md) is where external metadata lives: a manifest
    on a collection, owning a list of keys. Every move here edits that list.
  - [0045](0045-family-encryption-key.md) is the precedent for a schema
    keyword Ajv evaluates, and for the one prompt the family already asks.
  - [0046](0046-provenance-pins.md) let `derive` store one managed field,
    `provenance`, in a manifest. This proposal generalizes that exception.
- **Supersedes, in part:** Three rules, each of which stays in its own record.
  - [0037](0037-sidecar-metadata.md) rule 6, that `query` refuses every write
    to a key a manifest owns.
  - [0040](0040-derived-metadata.md) and [0042](0042-command-source.md), that a
    managed field may not be owned by a manifest.
  - [0045](0045-family-encryption-key.md), that `validate` never prompts.
- **Relates to:** Issue [#36](https://github.com/hawkeyexl/manni/issues/36),
  which asked which vocabulary fields are meant to survive into delivered,
  agent-facing output.
- **Touches:** `src/meta/core/{validator,location,location-writes,relocation,external-metadata-write,config}.ts`,
  `src/meta/core/derive/types.ts`,
  `src/meta/commands/{validate,validate-offer,derive,fill,fill-types,query,relocate}.ts`,
  `src/meta/reporters/**`, `src/meta/cli.ts`, `src/index.ts`,
  `docs/proposals/0023/schemas/**` and `docs/proposals/0044/schemas/citations/**` (new drafts),
  `docs/src/content/docs/meta/**`, `test/**`
- **Verdict:** A schema marks each property `"x-manni-location": "page"` or
  `"external"`. `page` means the field is meant for whoever fetches the page,
  agents included. `external` means it serves authoring and CI, and belongs in
  the collection's manifest. Every writer follows the manifest. A new verb,
  `manni meta relocate`, puts every value where its mark says, in both
  directions, creating the collection, the manifest and the config entry it
  needs. `validate` reports a misplaced value as a warning, and on a terminal
  offers the move.

## Problem

A page's metadata serves two readers, and the schema cannot say which is which.

**The delivered page pays for maintainer fields.** Some docs platforms serve
frontmatter unchanged in the markdown variant that coding agents and RAG
ingesters fetch. #36 observed it on Fern-hosted properties. On that surface
every field costs characters against an agent's truncation budget. `type`,
`description` and `sample-questions` earn their bytes there. `owner`,
`stakeholders`, `review-interval` and `evals` do not: they serve the people who
maintain the page. A delivery-side tool that wants to trim the overhead has no
statement to read, so it either ships everything or invents its own allowlist.
Every tool inventing one fragments the thing a shared vocabulary exists to
prevent.

**The other place exists, and nothing uses it.** A collection's
`externalMetadata` manifest (0041) already holds metadata outside the page.
Using it for maintainer fields is manual, and every writer works against it.

1. Maya adds the key to the manifest's `keys:`.
2. Every page carrying the key now fails `external:owned`, so she copies each
   value into the manifest by hand.
3. `manni meta derive` refuses the config: a managed field such as `owner` may
   not be owned by a manifest (0040, 0042). Only `provenance` may (0046).
4. `manni meta fill` fails the whole file: it cannot write a manifest key.
5. `manni meta query` refuses the write (0037 rule 6).

So the only writers that work put the value back into the page, the one place
she is trying to keep clean.

## Decision

### 1. The keyword

```json
"owner": { "type": "string", "x-manni-location": "external" }
```

| Value | Meaning |
|---|---|
| `"page"` | Store in the document's own metadata: frontmatter, HTML `<meta>`, a DITA `<prolog>`. Meant to reach delivered output. |
| `"external"` | Store in the collection's external-metadata manifest. |
| absent | No preference. Every command behaves as before this proposal. |

The keyword follows `x-manni-encrypt` (0045).

- **Where a mark counts.** Wherever the validator evaluates it: a `$ref`, an
  `allOf`, a built-in, and the branches Ajv takes. Only a top-level property's
  mark has an effect, because a manifest owns top-level keys. A nested mark is
  accepted and ignored.
- **Shape.** A value other than `"page"` or `"external"` is a compile error,
  exit 2. So is `external` on `$schema`, which a manifest may not hold.
- **Two schemas disagree.** The later schema in the file's resolved set wins,
  so a house schema listed after a vocabulary refines it. One schema can also
  mark one key both ways. Through `properties`, `allOf` and local `$ref`
  alone, that is a compile error, exit 2. Across `anyOf`, `oneOf`, `if` or
  `not` branches it is not an error. Ajv evaluates failing branches too, so
  a schema whose evaluated branches say both has no preference for that key.
- **A field join's own field stays in the page.** Under `join: id` the
  manifest's entries are keyed by `id` values, and the page's `id` is the only
  thing that says which entry is its. The glob says which collection a page is
  in, not which entry. That one field is never treated as external. A path
  join, the default, has no such field.
- **Encrypted and external.** The manifest receives the ciphertext, which
  `manni key rotate` already re-encrypts.

### 2. The vocabularies, marked

Every top-level property of every draft carries a mark, in a new revision
beside the old one. The test for `page` is whether a third-party or user-owned
agent fetching the page would act on the field.

| Draft | `page` | `external` |
|---|---|---|
| `manni:core:1.0.0-proposal.4` | title, description, id, type, keywords, language, locale | |
| `manni:stewardship:1.0.0-proposal.3` | last-updated | authors, owner, stakeholders, reviewed-by, created, last-reviewed, review-interval, verified-against, source-of-truth |
| `manni:audience:1.0.0-proposal.2` | audiences, intent | personas, journeys, visibility |
| `manni:lifecycle:1.0.0-proposal.2` | lifecycle, replaced-by | supersedes, remove-by |
| `manni:structure:1.0.0-proposal.2` | applies-to, not-applicable-to, concepts, prerequisites, next-steps, related-pages | |
| `manni:ai-context:1.0.0-proposal.3` | risks, sample-questions | provenance, meta-provenance |
| `manni:evals:1.0.0-proposal.4` | | evals, eval-suite, eval-skip |
| `manni:kg:1.0.0-proposal.3` | kg | |
| `manni:artifact-evals:1.0.0-proposal.4` | | metadata |
| `manni:citations:1.0.0-proposal.4` | | citations |

The reasons, row by row:
- `last-updated` is the one stewardship field an agent uses, to judge whether
  a page is fresh enough to trust. The rest name people and review cadence.
- `audiences` and `intent` are what an ingester filters and routes on.
  `personas` and `journeys` are internal names that mean nothing outside, and
  `visibility` is a build-time switch; delivered output is public by
  definition.
- An agent must see `lifecycle: deprecated` and follow `replaced-by`.
  `supersedes` and `remove-by` are the maintainers' side of the same record.
- Every structure field is context an agent assembles, or a link it follows,
  from one page to the next.
- `risks` and `sample-questions` are addressed to an agent at read time.
  Provenance records how a page was made.
- Evals, artifact evals and citations are CI's.
- `kg` is the categorization #36's consumer asked for.

This is a diff between drafts. Nothing registers a vocabulary, so no page
depends on the older revisions.

### 3. What a write does

A **change to a manifest's `keys:`** moves that key for every page in the
collection. Adding a key moves it out of every member page, or each would fail
`external:owned`. Removing a key moves it back into every member page, or the
manifest's values would stop being read. That is why creating a location and
migrating to it are one operation, `relocate`, and why every offer runs it.

| Situation | derive, fill, query |
|---|---|
| The key is owned by a local manifest | Written into the manifest. The page is untouched. |
| The key is owned by a URL manifest | Refused. A fetched file cannot be written. |
| `external`, no manifest owns it, on a terminal | Asks. On yes, `relocate` runs for the collection, then the write lands in the manifest. |
| `external`, no manifest owns it, otherwise | Written to the page as before, and one warning names the fields and `manni meta relocate`. |
| `page`, owned by a manifest | Written into the manifest, because ownership decides a write. `validate` reports the misplacement. |
| `page` or no mark, not owned | Unchanged. |

`fill` asks before its first model request, as the key prompt does. `query`
plans manifest edits in the same phase as page edits, so a refusal still
leaves nothing written.

For `query`, each DML statement now has a manifest meaning.
- `SET k = v` sets `k` in the document's entry, creating the entry.
- `SET k = NULL` removes `k`, and the entry once it is empty.
- A key rename carries the value across page and manifest.
- `SET _path` renames a path-joined entry.
- `INSERT` sends owned keys to a new entry.
- `DELETE` strips the block and removes the entry.
- `ALTER TABLE … DROP COLUMN` also removes the key from every entry.

Three writes stay refused. Changing a field join's value that matched an
entry is an identity change. `RENAME COLUMN` of an owned key would need
`keys:` renamed. A URL manifest cannot be written.

### 4. Where a missing location comes from

1. If the page is in a collection, use it, or the first in `collections:` order.
2. If no collections are defined, create one named `default`, whose `paths:`
   are the run's targets as typed.
3. If exactly one collection exists and the page is outside it, add the run's
   target to that collection's `paths:`.
4. If several collections exist and the page is in none, there is no home. The
   value stays and the run says why.

The keys go to the collection's first local manifest. With none, the run
creates `<collection>.metadata.yaml` beside the config file. With no config
file, it creates `manni.config.yaml` where the key prompt would (0045).
`--no-config` creates nothing. A manifest whose `keys:` empties is undeclared
and left on disk, and the run says so rather than deleting a file.

### 5. `validate`

Two findings, both at severity `warning`, so neither moves the exit code.

- `location:external`: a key stored in the page whose schema prefers
  `external`, at the page line. A key a manifest owns is skipped, because
  `external:owned` already fails there.
- `location:page`: a key a manifest supplies whose schema prefers `page`, at
  the manifest line.

On a terminal, after the report, `validate` asks once per collection whether
to move them, and on yes runs `relocate`. Its output goes to stderr, so a
report piped to a file stays machine-readable. The exit code is the report's.
Off a terminal the finding is the warning, in every reporter.

This supersedes 0045's "validate never prompts". The rule that survives is the
one 0045 was protecting: nothing waits for input off a terminal.

### 6. `manni meta relocate`

A prompt cannot be the only way to do something (0010 §7), and CI never sees
one. `relocate` is the non-interactive path, and every offer is a call to it.

```
manni meta relocate [paths...] [--fields <list>] [--collection <name>]...
    [-s <ref>]... [--dry-run] [-f pretty|json] [--ext <list>] [--exclude <glob>]...
    [--as <format>] [-c <path>] [--no-config] [--allow-empty] [--no-gitignore]
```

It moves page values its schemas prefer `external` into a manifest, and
manifest values its schemas prefer `page` back into the pages. It also settles
`external:owned` collisions, since those values belong in the manifest
whatever the mark says. Exit 0 means every value is where it belongs, exit 1
names each one that stayed, and exit 2 is operational. `-` is refused, since
stdin is not a document on disk.

A value stays when:
- the page has no home;
- its format cannot be written;
- a field-join page lacks its join value;
- the page and the manifest disagree on the value;
- the manifest is a URL.

## Stress test

1. **A house schema wants `owner` in the page.** It lists the vocabulary first
   and its own schema second, with `"x-manni-location": "page"`. The later
   schema wins. Listing them the other way round is the vocabulary winning,
   which is what the order says.
2. **A nested mark** under `kg` is ignored. A manifest cannot own a nested key,
   so honouring it would promise a move no writer can make.
3. **A join field marked external.** With `join: id` it stays, silently: the
   page cannot be found without it. With a path join, it moves.
4. **Encrypted and external.** The ciphertext moves. `validate` decrypts it
   from the manifest as it already does (0045), and `key rotate` re-encrypts
   it there.
5. **A URL manifest owns the key.** Every writer refuses. `relocate` reports
   the value as stayed in both directions, because nothing can remove a value
   from a file this run only fetched.
6. **A page in two collections** that both have manifests. The first in
   `collections:` order is the home. Two manifests supplying the same key
   remain the exit-2 error 0041 made them.
7. **A narrowed relocate widens.** `manni meta relocate docs/install.md
   --fields owner` adds `owner` to `keys:`, which moves it out of every member
   page. The run says how many were beyond the paths named. The alternative,
   leaving them, fails each on `external:owned`.
8. **No collections.** `default` takes the run's targets. A run over `-` plus
   paths takes the paths only.
9. **One collection, a target outside it.** `paths:` grows, and so does what
   `manni a11y` and `manni cite` see for that collection. The prompt names the
   path it adds, so the change is never silent.
10. **A reverse move empties `keys:`.** The entry is undeclared and the file is
    left on disk with a line saying so. A tool that deletes a file the user
    may have committed history in is a worse surprise than an idle file.
11. **`metadata` is external.** A mark applies to a whole top-level key, so the
    Agent Skills `metadata` map moves entire, not only its evals.
12. **`page`, but a manifest owns it.** Writers still write the manifest,
    because the config's ownership is what a reader of that config expects.
    `validate` flags it, and `relocate` moves it back.
13. **The two sides disagree.** The page's value wins at merge (0037). Moving
    either copy would silently change what validation sees, so the value
    stays and is named.
14. **A read-only format** stays and is named, as `fill` already refuses it.
15. **`fill -`** never asks, as with the key prompt. It writes the filled
    document to stdout and warns.
16. **Someone declines every time.** A baseline suppresses the findings, and a
    suppressed finding is never offered. That is the answer 0010 §7's `--yes`
    would otherwise have been.
17. **The pre-commit hook and the Action** are never a terminal. Both see
    warnings and unchanged exit codes.
18. **One page blocks a removal.** Removing a key from `keys:` moves it into
    every member page. So a single page that cannot take the value back
    (different values, a read-only format) cancels that removal for the whole
    collection. Only the blocking pages are named as stayed. The alternative,
    removing the key anyway, would silently stop reading the values of the
    pages that could not be written.
19. **Some pages cannot give a value up when a key is added.** The key is still
    added and those pages are named as stayed, exit 1. They fail
    `external:owned` until someone settles which value is right, which is the
    finding that says so.
20. **An `INSERT` creates a page that prefers external metadata.** `relocate`
    reads pages from disk, and the new page is not there yet. So it gets the
    warning rather than the offer, unless another page in the same statement
    triggers the relocation.
21. **`DROP COLUMN` on an owned key** removes it from the manifest entries of
    the documents the statement loaded. An entry for a page outside the run
    keeps its value, as the page outside the run keeps its own.
22. **A collection named `docs`.** The config parser already refuses it,
    because `docs` is the query table. The offers never create one: the
    created collection is `default`.
23. **A writer's offer for pages that do not hold the value yet.** It asks only
    to create the manifest or add the key, without "move them out of N pages".
    Nothing moves.
24. **A write fails halfway through a relocation.** A move into a page removes
    the value from the manifest first. So every write keeps the file's
    original text, and a failed write restores the files already written and
    deletes the ones the run created. A file that cannot be restored is named.
25. **A file changes between planning and writing.** The run refuses and
    writes nothing, rather than overwrite an edit it never saw.
26. **A key leaves `keys:` while another page carries a colliding copy.** The
    copy stays in its page, whatever order the pages are planned in. Moving it
    into a manifest that no longer owns the key would lose it.
27. **A sibling page cannot be parsed.** A `keys:` change reaches pages the run
    never named. One that cannot be parsed stays, with the reason
    `unreadable`, instead of aborting the run or a writer's offer.
28. **`--as` and sibling pages.** The forced format applies only to the pages
    the run named. Siblings are read by their extension.
29. **Marks that differ across `anyOf` branches.** Only a contradiction on
    paths every document takes is a compile error. Marks that differ across
    conditional branches give that schema no preference for the key.
30. **A `--collection` run and a manifest outside it.** `fill` reads every
    declared local manifest, so it cannot overwrite a value it never saw.
    `query` refuses the write instead, because reading those manifests would
    change what a narrowed `SELECT` returns. It also refuses a `_path` move or
    a `DELETE` of a page such a manifest names, which would orphan the entry.
31. **A join value that names another document's entry.** `query` refuses it.
    Taking over the entry would silently overwrite another page's values.

## Verification

- `test/location.test.ts` covers the keyword: a `$ref`, an `allOf`, a branch,
  a nested mark, a bad value, `$schema`, and two schemas disagreeing.
- `test/relocate.test.ts` covers each move, each reason a value stays, and each
  config case, over fixtures under `test/fixtures/location/`.
- The derive, fill, query and validate suites gain a manifest-owned field and
  an unowned external one.
- Prompts are tested in process with an injected confirm, and the built bin is
  tested off a terminal.
- `default-schema.test.ts` validates against the new drafts.
- `node dist/cli.js meta validate` stays silent on the repo's own docs, which
  carry no marks.

## Not breaking

- A schema with no marks behaves exactly as before.
- The new findings are warnings, so no exit code moves.
- Each writer change turns a refusal into a write the user asked for.
- A prompt appears only on a terminal.
- The drafts are unregistered.

## Consequences

- Delivery-side tools have one statement to read. A served variant can keep
  the `page` fields and drop the rest without a private allowlist.
- #36's second point, a `description` that also appears in an `llms.txt`
  entry, is not addressed. That is a pin between two locations of one fact
  (0044), not a choice of one location.
- A `--no-input` flag is not added. Terminal detection and baselines cover
  every case found.
