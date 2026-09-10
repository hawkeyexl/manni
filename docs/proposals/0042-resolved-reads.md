# 0042: resolved reads, a third view that says which value you got

- **Status:** Implemented (#TBD)
- **Serves:** Maya · M1, M2 · Devin · D4 · Theo · T1
- **Depends on:** Two earlier proposals.
  - [0040](0040-derived-metadata.md) built the derived channel. It gave every
    managed field a second possible origin, and this proposal makes that
    origin visible on a read.
  - [0041](0041-command-source.md) added the `command` source. A configured
    argv is one more thing a value can come from, so it widens the same gap.
- **Relates to:** Two proposals this one touches without depending on them.
  - [0021](0021-frontmatter-as-a-database.md) is the query engine. `resolved`
    is a third table beside `docs` and `derived`, built by the same code.
  - [0027](0027-named-collections.md) made a collection a SQL view over
    `docs`. `resolved` is a view too, and inherits that read-only posture.
- **Touches (planned):** `src/meta/core/derive/resolve.ts` (new),
  `src/meta/core/query/{tables,derived}.ts`, `src/meta/commands/{get,query}.ts`,
  `src/meta/cli.ts`, `src/meta/index.ts`,
  `reference/{query,cli,configuration,output-and-exit-codes,api}.mdx`,
  `set-up/derived-metadata.mdx`, `test/resolved*.test.ts`,
  `test/fixtures/derive/resolved/`
- **Verdict:** Add a third read-only view, **`resolved`**, over `docs` and
  `derived`. It carries the asserted value when the document has the key and
  the derived one otherwise, plus an `_origin` object naming which. `get`
  derives by default and prints the origin on the line. Nothing new is
  writable, and `--no-derived` is the opt-out.

## Problem

0040 and 0041 gave manni a second place a value can come from. Before them,
every value a page had was in the page. Now `owner` may come from CODEOWNERS,
`last-updated` from a commit, and `verified-against` from a configured
command. The tool got worse at the question those features exist to answer.

Maya (M1, M2) opens a page with no `owner` and cannot tell what that means.
Is nobody responsible, or does CODEOWNERS cover the path with no one writing
it down? The answer is in the repository. Getting it means knowing
`--derived` exists and reading a two-part line.

The channel is invisible by default. `get` needs a flag. `query` needs the
statement to name a table most readers have never heard of. Evidence the last
two proposals worked to gather sits unread.

Devin's gate (D4) is a join he has to get right. "Pages with no owner from any
source" is `docs LEFT JOIN derived` plus `COALESCE`. It also takes knowing
that a NULL column means absent *or* null, and that `_data` tells them apart.
A corpus check written slightly wrong is a false green.

Theo (T1) lands on a `derived:stale` finding and asks the obvious follow-up.
What does the page claim, what is true, and which one is he looking at?

The through-line is that reading a value now has two possible origins and no
way to see which one came back. That ambiguity is one the derived channel
introduced, and this proposal pays it back.

Manny asked for it on 2026-09-10:

> I want get and query to derive but not stamp by default. Maybe have some
> way to distinguish between what's actually stored in the frontmatter vs
> what's derived from system resources? The cached derived content should be
> read-only.

## Decision

Ten decisions, then the columns, the SQL, and the `get` surface.

1. **Three tables, three meanings.** `docs` is what the file says. `derived`
   is what the evidence says. `resolved` is what to believe. None of the
   three changes meaning, and only `docs` was ever writable.
2. **`resolved` is a view, not a third copy.** The DDL is
   `CREATE VIEW resolved AS SELECT … FROM docs d LEFT JOIN _derived_rows r USING (_path)`.
   One CASE per column decides which side wins. It cannot drift from its
   inputs, and it costs no third load of the corpus. SQLite refuses a write
   to it for the same reason it refuses one to `derived`.
3. **Presence is decided by `_data`, not by NULL.** A column is NULL both
   when the key is absent and when its value is `null`. So the view tests
   `json_type(d._data, '$."<field>"') IS NOT NULL`. That is the same
   "told apart by `_data`" rule the query reference already states for `docs`.
4. **`_origin` says `asserted` or `derived` per field.** It is a JSON object
   carrying only the fields that resolved to something. `_sources` keeps the
   evidence, unchanged from `derived`.
5. **Drift stays visible.** When a document asserts a value and the evidence
   disagrees, `resolved` takes the asserted one, because that is what the
   file publishes. `get` says so on the same line, and `validate` still files
   `derived:stale`. `resolved` answers "what does this page say". The join
   against `derived` answers "is it true".
6. **A read derives every derivable field it names, and nothing else.** A
   field no source can state short-circuits before any process spawns.
   `get title docs/` spawns nothing. `get created docs/` spawns git.
   `SELECT * FROM resolved` derives everything, including `gh` or `glab`.
7. **Stdin derives nothing, and that is not an error.** A piped document has
   no path, so no source can speak for it. `get - --as markdown` keeps
   working, and resolves to its asserted values.
8. **`--no-derived` is the opt-out on `get`.** `query` opts out by not naming
   the table. `--no-cache` reaches both.
9. **Nothing new is writable and nothing outlives the run.** `resolved`
   joins `derived` and `_derived_rows` in the `--db` export's DROP list.
10. **The docs say "resolved value", never bare "resolved".** manni already
    spends that word on schema resolution, in `resolveSchemaSet`,
    `ResolvedSchemaSet`, the resolution chain, and
    `reference/schema-resolution.mdx`. Every sentence introducing the table
    says *resolved value* or *resolved frontmatter*. The `resolved` section
    in the query reference opens by naming the other meaning and linking its
    page. The two never appear unqualified in the same paragraph.

### The columns

`resolved` carries, in order, `_path`, every column `docs` has, every
derivable field `docs` lacks, then `_origin` and `_sources`. It is read-only.

| Column | Type | Value |
|---|---|---|
| `_path` | TEXT, primary key | The file's label, exactly as in `docs` and `derived`. |
| every `docs` column | as in `docs` | The asserted value when `_data` carries the key, else the derived one, else NULL. |
| every derivable field `docs` lacks | TEXT | The derived value, or NULL when no source answered. |
| `_origin` | TEXT | JSON, `{field: "asserted" \| "derived"}`, carrying only the fields that resolved to something. |
| `_sources` | TEXT | JSON, `{field: {source, evidence}}`, exactly as in `derived`. |

Three statements that were awkward before:

```sql
SELECT _path, owner, _origin ->> '$.owner' AS origin FROM resolved;
SELECT _path FROM resolved WHERE _origin ->> '$.owner' = 'derived';
SELECT d._path FROM docs d JOIN derived x USING (_path) WHERE d."last-updated" IS NOT x."last-updated";
```

The write refusal completes itself the way the `derived` one does:

```
$ manni meta query "UPDATE resolved SET owner = 'x'"
manni meta query: SQL error: cannot modify resolved because it is a view; the resolved table is read-only — it is `docs` and the evidence joined, so write to docs, or stamp the evidence with manni meta derive.
                                                                      exit 2
```

An override may not be named `resolved`, beside the existing refusal of
`derived` and `_derived_rows`.

### `manni meta get`

Derivation is on by default. `--no-derived` prints only what the document
stores, and consults no source. `--derived` is accepted and does nothing, so
an existing script keeps working. The pretty line becomes the resolved value
plus its origin.

| Option | Default | Meaning |
|---|---|---|
| `--no-derived` | off | Print only what the document stores. No source is consulted, and no origin is annotated. |
| `--derived` | off | Accepted and inert. It was the opt-in before this proposal, and a script that passes it still runs. |
| `--no-cache` | off | Ask GitHub or GitLab again rather than reading the review cache. |

Five cases, in `pretty`:

```
$ manni meta get title,owner,last-updated docs/install.md
docs/install.md: title=Install the operator  (asserted)
docs/install.md: owner=@platform-docs  (derived, codeowners: .github/CODEOWNERS:12)
docs/install.md: last-updated=2026-08-20  (asserted; git says 2026-09-07, body changed in 424f71a)

$ manni meta get title docs/install.md --no-derived
docs/install.md: title=Install the operator
```

A field neither side has prints `(unset)` with no annotation. Under
`--no-derived` there is no annotation at all. The old `(not derivable)`
marker is gone, because every field now resolves. JSON gains `resolved` and
`origin` records beside the existing `values` and `derived`. `--quiet` hides
a file when every requested field is unset *after* resolving.

## Stress test

1. **A third materialized table.** The first sketch loaded the corpus again
   and wrote a real `resolved` table. Rejected. Two copies of the same fact
   can disagree, and the one a reader hits would depend on build order. A
   view is computed at read time from the two tables that already exist, so
   there is nothing to keep in step. It also costs no third pass over the
   files.
2. **Why asserted wins over evidence.** The opposite rule is defensible.
   Evidence is checkable and a stamp is not, so the newest fact could win.
   Rejected, for what `resolved` is for. A reader asking `get owner` wants
   the value the page publishes, which is the one a search index and a
   catalog already carry. A rule where evidence won would make `resolved`
   disagree with the rendered page, and the disagreement would be silent.
   Decision 5 keeps the asserted value and annotates the conflict on the same
   line, so the drift is louder rather than quieter.
3. **The `SELECT *` cost.** `SELECT * FROM resolved` names every column, so
   decision 6 derives every field. On a repository with `github` in
   `sources`, that spawns `gh`. A reader exploring the table interactively
   pays for a source they did not think about. Accepted, and bounded the way
   `derived` already bounds it. The column set decides, so a named-column
   read pays only for that column, and `derive.sources` narrows the set a
   machine will ever consult. The alternative, deriving lazily per row, would
   spawn one process per file.
4. **`--no-derived` against `--sources` narrowing.** Two ways to consult
   fewer sources looks like two spellings for one thing. They are not.
   `--sources` is a config-level statement that a source is out of reach on
   this machine, and it makes a field derive null everywhere. `--no-derived`
   is a per-run statement that this read wants the document only. A script
   comparing what pages store against what they resolve to needs both
   readings, and needs them from the same binary.
5. **Why `(not derivable)` goes.** It was honest under 0040, where a read
   printed the derived value beside the asserted one and had nothing to show
   for `title`. Under this proposal every field resolves, because a field
   with no source resolves to its asserted value. Printing "not derivable"
   beside a real value would say the read failed when it succeeded. The
   marker is removed rather than reworded, and 0041's widening of
   `DerivableField` to `string` had already made the set config-dependent.
6. **Stdin.** A piped document has no path, so git, CODEOWNERS, the forges
   and a `{path}` command can none of them speak for it. 0040 made
   `get --derived` refuse stdin outright. That refusal cannot survive a
   default-on flag, because `get - --as markdown` is an ordinary read that
   worked before either proposal. Decision 7 resolves the piped document to
   its asserted values and derives nothing. The alternative, refusing stdin
   whenever `derive:` is configured, would break a working script on a config
   change it has nothing to do with.
7. **The name collision with schema resolution.** manni already uses
   "resolve" for picking a schema set, in `resolveSchemaSet`,
   `ResolvedSchemaSet` and a whole reference page. A second unqualified
   "resolved" in the same docs is a real cost, and the alternatives were
   worse. `effective` reads like a config-precedence term and belongs to
   overrides. `merged` is the sidecar's word and would suggest the schema
   sees the derived value, which decision 1 of 0040 forbids. `current` says
   nothing about origin. So the name stays and decision 10 pays for it in
   prose. The qualifier goes on every introduction, and the query reference
   links to the schema-resolution page.

## Consequences

- A read now spawns processes where it did not. `get owner docs/` consults
  CODEOWNERS by default, and `get created docs/` runs `git log`. A repository
  with no `derive:` in config spawns nothing new, and `--no-derived` restores
  the old behavior for one run.
- `get`'s pretty output changed shape for every user, not only for the ones
  who configured `derive:`. A field with no derived value now prints
  `(asserted)` after it. A script parsing the pretty line has to accept the
  suffix, and `-f json` was always the parseable surface.
- `--derived` is inert rather than removed. That is a second spelling for
  nothing, which the parallel-behaviors rule dislikes. It is kept because
  0040 and 0041 shipped the flag in worked examples on two published pages.
  A hard removal would break those transcripts for no gain.
- The `derived` table stays exactly as it was. A gate written against it
  keeps working, and the join in decision 5 is still how a corpus check asks
  whether a stamp is true.
- `resolved` is the table a new reader should reach for, so the query
  reference has to say when `derived` is still the right one. That is one
  more section to keep honest.

## Follow-ups recorded, not promised

- **An `_origin` filter on `get`.** Something like `--origin derived`, so a
  script can list the pages whose `owner` nobody wrote down. Today that
  answer needs the `query` spelling in decision 4's third example.
- **A `--explain` on `get`.** Every source's answer for a field, rather than
  the one that won. That covers the case where `reviewed-by` falls back from
  the forge to a `Reviewed-by` trailer, and the reader wants to know which
  one spoke.
