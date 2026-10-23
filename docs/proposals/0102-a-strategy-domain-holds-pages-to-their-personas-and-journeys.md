# 0102: A strategy domain holds pages to their personas and journeys

- **Status:** Implemented (#232); superseded in part by 0108
- **Serves:** Two people.
  - Sara · S17, "Hold the pages to the strategy they were written for", a new
    journey. She owns `docs/content-strategy/`, and nothing holds the pages to
    it.
  - Theo · T1, "Fix a failing metadata check fast", for the rules page. A
    finding names its rule, and the rule's section says what fixes it.
- **Depends on:** Eight proposals.
  - [0034](0034-command-grammar.md) is the grammar. The domain spells all
    three verbs, and there is no default subcommand.
  - [0041](0041-collections.md) put document sets in `collections:`. The
    records and the pages both come from there.
  - [0047](0047-field-location.md) gave each field a preferred location.
    `personas` and `journeys` live in the sidecar, and stress test 2 turns on
    that.
  - [0052](0052-term-domain.md) is the model. Records kept as pages, a set
    read from the collections, the `check` layout and the config keys all
    follow `term`.
  - [0078](0078-family-check-status-and-claude-code-plugin.md) gave the family
    `check` and `status`. Both gain a strategy row.
  - [0023](0023-metadata-vocabularies.md),
    [0067](0067-registering-the-vocabularies.md) and
    [0070](0070-defaults-register-strict.md) are the audience vocabulary.
    0023 drafted `audiences`, `personas` and `journeys`. 0067 registered them
    at 1.0.0, and 0070 put the vocabulary in the default set.
- **Relates to:** Three documents.
  - [0068](0068-a-manifest-owns-what-the-marks-say.md) lets a
    `{page}.meta.yaml` own every external field. Most `personas:` and
    `journeys:` values in this repository live there.
  - [0099](0099-inline-metadata-statements.md) already treats `personas` as an
    external field in its `statement-external-field` rule. This proposal
    relies on that reading.
  - [`docevals/ia-gap-analysis.md`](docevals/ia-gap-analysis.md) found the
    unserved journeys by hand, once. `strategy check` finds them on every
    push.
- **Supersedes:** No proposal.
- **Touches:** `src/strategy/**` (new), `src/shared/cli-options.ts`,
  `src/term/cli.ts`, `src/cli.ts`, `src/graph/{cli.ts,commands/publish.ts}`,
  `src/family/core/in-play.ts`, `src/family/commands/{check,status}.ts`,
  `plugin/manni/skills/{fix,setup}/SKILL.md`, `test/strategy/**` (new),
  `test/fixtures/strategy/**` (new), `test/family/**`, `test/config.test.ts`,
  `scripts/check-cli-reference.mjs`, `docs/content-strategy/**`,
  `docs/content-strategy/schemas/{audience,persona,journey}.schema.json`
  (new), `docs/src/content/docs/strategy/**` (new),
  `docs/src/content/docs/family/reference/cli.mdx`,
  `docs/src/content/docs/index.mdx`, the pages and sidecars the IA's map
  moves into, `docs/astro.config.mjs`, `manni.config.yaml`,
  `.github/workflows/docs.yml`, `CLAUDE.md`, `src/docevals/CLAUDE.md`,
  `src/tracevals/CLAUDE.md`
- **Verdict:** A new domain, `manni strategy`, with three verbs. A record is a
  page that declares `type: audience`, `type: persona` or `type: journey`, one
  per file. `list` prints the records as a tree, and `get` shows one with the
  pages that name it. `check` holds every page's `audiences:`, `personas:` and
  `journeys:` to the records, under six rules. A persona names its audience in
  `audience:`, and a journey names the personas it serves in `personas:`.
  Each record type has its own schema, applied through meta's existing
  `overrides`, and no built-in schema is added. This repository's strategy
  becomes 82 records, and the IA stops keeping a second copy of the
  page-to-journey map.

## Problem

Pages here already say whom they serve. Measured against `origin/main` at
6a890ff3, 173 pages carry `audiences:`. 198 sidecars carry `personas:`, such
as `[maya, devin]`, and 140 carry `journeys:`, such as `[m1, m5]`. The fields
come from the default vocabulary `manni:audience:1.0.0`. It says `personas`
"may dangle if you keep no personas", and nothing points the values anywhere.

- **The strategy is prose no tool reads.** `audiences.md`, `personas.md` and
  `cujs.md` describe 4 audiences, 4 personas and 73 journeys. A page naming
  `journeys: [m55]` passes every check, and no M55 exists.
- **A third of the journeys have no page.** 24 of the 73 are named by no
  page. They are M10–M12, M14–M16, M18–M20, M29, D9–D12, D19, S7–S12 and
  T5–T7. Nobody can see that without a script, and
  `docs/proposals/docevals/ia-gap-analysis.md` did it by hand once.
- **Personas lose their audiences.** 25 tracevals pages name personas but no
  audiences. That leaves 44 persona-to-audience gaps.
- **The page-to-journey map is kept twice.** It lives in 177 IA table rows and
  again in the sidecars. 53 rows disagree with their sidecar, and nothing
  reconciles them.
- **The id ranges drift.** The hand-written ranges in `CLAUDE.md` and
  `content-strategy/README.md` disagree with each other and with `cujs.md`.

Sara pays for all of it. She can add a journey to `cujs.md`, and nothing tells
her whether any page serves it. A typo in `personas:` reaches the published
site, and the gap analysis goes stale the day after it is written.

## Worked example

Sara is the information architect who owns `docs/content-strategy/`. Her new
journey is S17, "Hold the pages to the strategy they were written for." She
starts from this repository as it is on `main`.

1. `manni status` prints this row, and exits `0`:

   ```text
   strategy   not set up   no strategy records in any collection
              Add a page with type: journey to a collection.
   ```

2. She converts the folder, as decision 6 describes. `journeys/m5.md` now
   opens with this frontmatter, and the old CUJ prose follows it unchanged:

   ```yaml
   ---
   type: journey
   id: m5
   title: Pin a claim and catch it going stale
   description: A sentence on one of Maya's pages rests on a few lines of code.
   personas: [maya]
   ---
   ```

   She writes one schema per record type, as decision 2 describes. Then she
   adds a `strategy` collection and an override per record type to
   `manni.config.yaml`, as the Config section shows.

3. `manni strategy list` prints the tree. It ends with
   `4 audiences, 4 personas, 73 journeys` and exits `0`.

4. `manni strategy check` exits `0`, because every finding is a warning. The
   layout is term's, with the rule's guidance dim under each finding:

   ```text
   docs/content-strategy/journeys/m10.md:3
     warning manni:strategy/unserved-journey     no page names this journey in journeys:.
                                                 Name it on the pages that serve it.
                                                 manni:strategy unserved-journey: No page names the journey in journeys:. Records do not count, and a draft or archived journey is exempt.
                                                 Guide: https://hawkeyexl.github.io/manni/strategy/reference/rules/#unserved-journey
   …
   docs/src/content/docs/tracevals/index.meta.yaml:2
     warning manni:strategy/missing-parent       audiences: does not name "schema-authors", the audience of persona "sara".
                                                 Add it, or drop "sara" from personas:.
                                                 …
   …

   68 warnings in 81 records
   ```

   That is 24 `unserved-journey` and 44 `missing-parent`.

5. `manni strategy get m10` shows `pages  none`. The IA's lint table names M10
   against `lint/get-started/index.mdx`, so the page serves it. The claim
   lives only in the IA's copy and never reached the page.

6. She moves every IA cell into its page's own fields, as decision 7
   describes. `manni strategy check` then prints this, and exits `0`:

   ```text
   ✓ 81 records, 1461 references, no findings
   ```

7. She writes `journeys/s17.md` for this feature. `check` warns
   `unserved-journey` on `docs/content-strategy/journeys/s17.md:3` until
   `strategy/index.meta.yaml` names `s17`. Then she sets
   `strategy.severity.unserved-journey: error`, so no journey can land without
   a page unless it lands as a draft.

8. Theo later tags a page `personas: [s17]`. `check` exits `1`:

   ```text
     error   manni:strategy/undefined-reference  personas: "s17" is a journey, not a persona.
                                                 Did you mean its persona, "sara"?
   ```

**Outcome.** The journeys and the pages agree, and `check` says so on every
push. "Which pages serve M5?" is `manni strategy get m5`. The IA keeps no
second copy of the map, and no hand-written id range is left to drift.
`manni status` now prints `strategy   in play   4 audiences, 4 personas, 74 journeys`.

## Decision

### 1. A record is a page that declares its type

A record is any page `manni meta` reads that declares `type: audience`,
`type: persona` or `type: journey`. Records come from the run's inputs, and
the default inputs are every collection. There is one record per file, in any
format meta extracts: Markdown, MDX, AsciiDoc, reStructuredText, HTML or XML.

These are the fields `manni strategy` reads.

| Field | On | Type | Required by `strategy` |
|---|---|---|---|
| `type` | every record | `audience`, `persona` or `journey` | yes |
| `id` | every record | string, unique across all records, compared ignoring case | no, it defaults to the file name without its extension |
| `title` | every record | string | no, `list` and `get` fall back to the id |
| `description` | every record | string | no |
| `audience` | a persona | the id of its audience | no, `orphan-record` reports a missing one |
| `personas` | a journey | a list of the ids of the personas it serves | no, `orphan-record` reports a missing one |

The prose after the frontmatter is the record's body, and no rule reads it.

`strategy` requires only `type`. What a repository requires beyond that is its
schemas' job, as decision 2 describes. This repository's schemas require `id`,
so no record here leans on the file-name default. They leave `title` and
`description` optional.

On a page, `audiences`, `personas` and `journeys` keep the meaning
`manni:audience:1.0.0` gives them, which is who the page serves. They are the
references. A persona names its one parent in `audience:`. A journey names its
parents in `personas:`, a list, because a journey can serve several personas.
Stress test 9 gives the reasons.

A value counts when it is a string or a list of strings. A page's values are
read through meta's merged view, so a value its `{page}.meta.yaml` sidecar
holds counts. A finding about such a value sits at the sidecar's line.

A journey record's `personas:` is read once, as its parents. It is not also
read as a reference, so nothing is reported twice. Every other `audiences:`,
`personas:` and `journeys:` on a record is checked like a page's. An
audience's `personas:` and a persona's `journeys:` list its children, and they
are read as ordinary references. A value on a record counts as a record naming
its target, never as a page naming it, because a record serves no reader.

### 2. Each record type has its own schema

No built-in schema is added. The registry keeps its 65 built-ins and its
eleven vocabulary families. Meta validates a record as it validates any
document, against the schema an override names. The site's override names the
house schema `./docs/doc-frontmatter.schema.json` the same way.

This repository ships three schemas, in
`docs/content-strategy/schemas/{audience,persona,journey}.schema.json`.

- Each is a JSON Schema 2020-12 document with `additionalProperties: true`.
- Each requires `type`, as a `const`, and `id`, in kebab case. A persona also
  requires `audience`, and a journey a non-empty `personas` list.
- Everything else is optional, `title` and `description` included.
- The descriptive fields are every field in the content-strategy records of
  [Promptless/promptless.ai](https://github.com/Promptless/promptless.ai),
  under `docs/content_strategy/`. Their keys are kebab-cased to match this
  repository's, so `docs_owner` becomes `docs-owner`. The types follow their
  examples.

| Schema | Required | Optional |
|---|---|---|
| audience | `type: audience`, `id` | `title`, `description`, `segment`, `maturity`, `docs-owner` (strings); `firmographics`, `relationship-stages`, `features-emphasized` (string lists); `personas` (kebab list); `underrepresented` (boolean) |
| persona | `type: persona`, `id`, `audience` (kebab) | `title`, `description`, `name`, `role`, `team-context` (strings); `proficiency`, `prerequisites`, `goals`, `pains`, `content-types` (string lists); `journeys` (kebab list) |
| journey | `type: journey`, `id`, `personas` (non-empty kebab list) | `title`, `description`, `trigger`, `entry-point`, `success-criteria` (strings); `steps`, a list of `{stage (required), doc, exists: true \| false \| "partial", note}` |

- `strategy` builds its tree from the parent fields, a persona's `audience`
  and a journey's `personas`.
- The children lists, an audience's `personas` and a persona's `journeys`, are
  read as ordinary references. They are checked for resolving, as every
  reference is.
- Each record type gets an override by path that names its schema. The
  journeys override also names `manni:lifecycle:1.0.0`, which gives a journey
  `lifecycle`. An override's `defaults` is `false` unless set, so a record
  takes what its override names and none of the defaults.

There are three reasons, and stress test 2 weighs them.

- Normal docs pages keep the baked-in schemas. Nothing in the default set
  changes.
- A record is not a docs page. It serves no reader, so the page vocabularies
  have no claim on it.
- Meta already validates any document against a schema an override names. The
  records need no new key, no registry row and no reference page.

### 3. A field is checked only when its records exist

A field is checked only when the set holds at least one record of that field's
type. A repository with persona records and no audience records keeps a
free-form `audiences:`. So the audience vocabulary's "may dangle" promise holds
until a repository keeps the records.

The record fields follow the same gate. `orphan-record` fires only while the
set holds records of the parent type, so a set with no audience records has no
orphan personas.

### 4. Six rules

Each rule id is `manni:strategy/<rule>`. The levels are the family scale from
`src/shared/severity.ts`, and `strategy.severity` moves any of them.

| Rule | Default | Fires when |
|---|---|---|
| `undefined-reference` | error | A page's `audiences:`, `personas:` or `journeys:`, or a persona's `audience:`, names no record of that type. A journey record's `personas:` counts as well. |
| `duplicate-id` | error | Two records share an id, ignoring case. |
| `missing-parent` | warning | A page names a journey but none of its personas in `personas:`, or a persona whose audience its `audiences:` lacks. |
| `orphan-record` | warning | A persona names no audience, or a journey names no persona, while the set holds records of the parent type. |
| `unserved-journey` | warning | No page names the journey in `journeys:`. Records do not count, and a draft or archived journey is exempt. |
| `unused-record` | notice | No page and no record names an audience or a persona. |

A finding about a value sits on the value's line. A finding about a whole
record sits on its `id:` line, or on its first line when it declares no `id`.

- `undefined-reference` adds a did-you-mean through the shared `closestName`.
  When the value is the id of a record of another type, the message says so.
  It then suggests that record's own persona or audience when it has one.
- A persona named in `journeys:` has no journey above it. The message then
  says which field it belongs in.
- `duplicate-id` is reported on every record that shares the id. Each finding
  names the others by file and line.
- `missing-parent` reports each missing parent once per page. It sits at the
  line of the first value that implies it. A page that names any one of a
  journey's personas passes for that journey.

Requirements traceability tools such as Doorstop and sphinx-needs are the
prior art for the coverage and dangling-link rules. Whether every page must
carry `journeys` is a question of presence, so it stays meta's job. A schema
override with `required: [journeys]` answers it.

### 5. The family verbs run it

`manni strategy` is mounted after `term`, in `src/cli.ts` and in the `DOMAINS`
of `src/family/core/in-play.ts`. The domain is in play when the collections
hold a record.

- `manni status` prints a strategy row. In play, it reads
  `strategy   in play   4 audiences, 4 personas, 74 journeys`. Not set up, it
  prints the two lines in step 1 of the worked example.
- `manni check` runs `strategy check` as a set-wide domain:
  - in the `all` scope it runs bare;
  - in the `changed` scope it runs whenever the tree has changes, as cite does;
  - in the `paths` scope it does not run;
  - its SARIF category is `manni/strategy/`, derived from `COMMANDS`.
- The SessionStart briefing names strategy beside cite, in the sentence about
  what runs whenever anything changed. It does not join term in the
  `PAGE_WIDE` sentence about a changed page.

Stress test 4 says why the `changed` scope does not follow term's trigger.

### 6. This repository converts in place

`docs/content-strategy/` keeps its place. Each audience, persona and journey
becomes one file, and its prose becomes the record's body.

| Before | After |
|---|---|
| `audiences.md` | `audiences/{docs-engineers,ci-engineers,schema-authors,contributors}.md` |
| `personas.md` | `personas/{maya,devin,sara,theo}.md` |
| `cujs.md` | `journeys/<id>.md`, 73 files, plus `s17.md` for this proposal |

- The bodies move verbatim, split on the `### ` headings.
- An audience's `title` is its heading without the number and qualifier, as
  in `Docs-as-code teams`. A persona's is its heading without the
  parenthetical, as in `Maya, Documentation Engineer`. A journey's is its
  heading after the id, so `M5 · Pin a claim…` gives `Pin a claim…`.
- `description` is the first sentence of the record's prose. For a journey
  that is the first sentence of `**Outcome.**`, or of the body for the 12
  freeform journeys. For an audience it is the paragraph's first sentence,
  and for a persona the profile's.
- A sentence that does not stand alone, or that Vale flags, is edited by hand.
  The pull request lists each edit.
- A journey names its persona as `personas: [maya]`, a list of one.
- The records carry only `type`, `id`, `title`, `description` and the parent
  field. Nothing copies their prose into the schemas' descriptive fields.
- The intros move into `README.md`, which gains the layout and the three
  commands. Its hand-written id ranges go.
- `CLAUDE.md`, `src/docevals/CLAUDE.md` and `src/tracevals/CLAUDE.md` point to
  the folders and to `manni strategy list` and `get`. Their id ranges go too.
- Proposals and the `media/` scripts keep their references to the old files,
  because they are the record.

### 7. The IA's journey column moves into the sidecars

`information-architecture.md` stops keeping the page-to-journey map. Each page
keeps its own.

- Each CUJ cell in the IA is unioned into its page's fields. `journeys:` and
  `personas:` go in the sidecar, and `audiences:` in the page. That covers 50
  untagged lint, docevals and graph pages, and the 3 conflicts.
- The 25 tracevals pages gain the audiences of their personas.
- A cell that is not an id, such as `All`, moves into the row's Notes.
- The CUJ column leaves all 19 tables. The prose that described it now points
  to the page fields and to `manni strategy get`, so no third copy survives.
- A journey still unserved after the union is tagged by hand on the page that
  serves it, and the pull request lists it.
- Once `check` is clean, this repository sets
  `strategy.severity.unserved-journey: error`.

## The interface

### Config

This is this repository's `manni.config.yaml`, abbreviated.

Before:

```yaml
collections:
  - name: site
    paths: ["docs/src/content/docs/**/*.{md,mdx}"]
    …
meta:
  overrides:
    - files: "docs/src/content/docs/meta/reference/glossary/!(index).mdx"
      …
    - collection: site
      …
```

After. Only the `strategy` lines are new.

```yaml
collections:
  - name: site
    …                                     # unchanged
  - name: strategy
    paths:
      - "docs/content-strategy/{audiences,personas,journeys}/*.md"

meta:
  overrides:
    - files: …glossary…                   # unchanged
    - files: "docs/content-strategy/audiences/*.md"
      schemas: [./docs/content-strategy/schemas/audience.schema.json]
    - files: "docs/content-strategy/personas/*.md"
      schemas: [./docs/content-strategy/schemas/persona.schema.json]
    - files: "docs/content-strategy/journeys/*.md"
      schemas:
        - ./docs/content-strategy/schemas/journey.schema.json
        - manni:lifecycle:1.0.0
    - collection: site                    # unchanged
      …

strategy:
  severity:
    unserved-journey: error               # this repository's ratchet

graph: …                                  # unchanged
```

The three overrides use meta's existing `files:` and `schemas:` keys, so no
meta key is new. None sets `defaults:`, so each record takes only the
schemas its override lists.

The `strategy:` section is optional, and every key has a default. Its keys
mirror `term:`'s.

| Key | Type | Default | Required | What it does |
|---|---|---|---|---|
| `strategy.severity.<rule>` | `notice`, `warning`, `error` or `off` | the table in decision 4 | no | Moves one rule's level. `off` drops its findings. |
| `strategy.baseline` | string, a path from the config file's directory | none | no | Compares against this baseline on every run, without the flag. |
| `strategy.allowEmpty` | boolean | `false` | no | Treats a run that finds no records as success. |
| `strategy.respectGitignore` | boolean | `true` | no | Skips files `.gitignore` covers. |

`--baseline` with no configured path uses `.manni-strategy-baseline.json`.
`strategy.paths` and `strategy.exclude` are refused by name, as `term` refuses
them. The document set is the family `collections:`.

**A new collection widens every bare run.** Graph reads every collection. A
bare `graph publish` would put the 82 internal records into the graph, the
chunks and the `llms.txt` the public site serves. So `graph publish` gains
`--collection <name>`, the repeatable flag `graph build` already takes, and
the publish steps in `docs.yml` pass `--collection site`. `graph check` reads
the graph `publish` built, so it needs no flag. Bare docevals, cite and term
runs read the records too:

- docevals grades them under the `site` suite, whose only check is
  `no-todo-markers`;
- cite finds no pins in them;
- term finds no `concepts:` in them.

Verification checks that each of these stays clean.

### Commands

`manni strategy` has three verbs, each spelled out. A bare `manni strategy`
prints the full help to stderr and exits `2`.

```text
manni strategy list  [paths...] [options]
manni strategy get   <id> [paths...] [options]
manni strategy check [paths...] [options]
```

Every verb takes the same inputs:

| Argument or option | Default | What it does |
|---|---|---|
| `[paths...]` | every collection | Files, directories or globs to read, space-separated. `-` reads stdin, beside any named paths. |
| `--as <format>` | none | Input format for stdin. Required with `-`. |
| `--ext <list>` | meta's extensions | Comma-separated extensions kept in directory and glob walks. Given once. |
| `--exclude <glob>` | none | Glob to exclude. Repeatable, one glob per occurrence, never split on commas. |
| `--collection <name>` | every collection | A configured collection to read. Repeatable, one name per occurrence. It cannot be combined with paths. |
| `--allow-empty` | off | Treats a missing path, no matched files or no records as success. It wins over `strategy.allowEmpty`. |
| `--no-gitignore` | `.gitignore` respected | Reads files `.gitignore` covers. It wins over `strategy.respectGitignore`. |
| `-c, --config <path>` | discovered | Path to a manni config file, which must exist. |
| `--no-color` | color on a TTY | Disables colored output. There is no color under `NO_COLOR` either. |

These are term's flags, lifted into `src/shared/cli-options.ts` as
`withInputs`. It takes the noun an empty set lacks as a parameter. So term's
`--allow-empty` help still says "no terms", and strategy's says "no records".
The stdin error is the shared `STDIN_REQUIRES_AS`, as meta, cite and graph
print it. Term's own wording is left as it is.

| Verb | Arguments | Own options | `-f, --format` |
|---|---|---|---|
| `list` | `[paths...]` | none | `pretty` or `json`, default `pretty` |
| `get` | `<id>`, in any case, then `[paths...]` | none | `pretty` or `json`, default `pretty` |
| `check` | `[paths...]` | `--baseline`, which records the findings on the first run and then fails only on new ones | `pretty`, `json`, `github`, `sarif` or `junit`, default `pretty` |

Records and pages are read together, from the same inputs. A positional run
has to name the records too, as in
`manni strategy check docs/content-strategy/ docs/src/content/docs/cite/`.
That is how term reads its set.

The exit codes follow the family contract.

- `0` means clean, or warnings and notices only, or a run that recorded a
  baseline.
- `1` means at least one error-severity finding the baseline does not hold.
  Only `check` exits `1`.
- `2` means an operational or usage error.

**Programmatic API.** No change. `src/index.ts` exports meta only, and term is
not exported either.

### Output shapes

**`list -f pretty`** prints a tree, audience then persona then journey.
Siblings sort by id with numeric collation, so `m2` comes before `m10`. A
journey with several personas is listed under each of them. A record whose
parent is not in the set sits at depth 0. The number is how many pages name
the record directly. These rows are this branch's:

```text
record            pages  title
ci-engineers        129  Platform / CI engineers
  devin             128  Devin, Platform / CI Engineer
    d1                8  Add the gate to our CI platform
    d2                2  Govern one schema across many repos
…
4 audiences, 4 personas, 74 journeys
```

**`get -f pretty`** prints the title and where the record was read, then one
row per field. A journey shows its `personas`. A persona shows its `audience`
and its `journeys`, and an audience its `personas`. A record that sets
`lifecycle` shows it in a row after `description`. The `pages` row prints
`none` when no page names the record.

```text
Maya, Documentation Engineer                  docs/content-strategy/personas/maya.md:1
  type          persona
  id            maya
  description   Maya owns a 2,000-page docs-as-code repo for a platform product.
  audience      docs-engineers  Docs-as-code teams
  journeys      m1   Stand up metadata validation for my repo
                m2   Tighten the standard without breaking the build
                …
  pages         docs/src/content/docs/a11y/get-started/index.mdx
                …
```

**`list -f json`** prints `{ "records": [Record…] }` in the tree's order.
**`get -f json`** prints one Record:

```json
{
  "id": "m5",
  "type": "journey",
  "title": "Pin a claim and catch it going stale",
  "description": "A sentence on one of Maya's pages rests on a few lines of code.",
  "file": "docs/content-strategy/journeys/m5.md",
  "line": 1,
  "personas": ["maya"],
  "namedBy": { "pages": ["docs/src/content/docs/cite/ci/stale-windows.mdx", "…"] }
}
```

`title` falls back to the id. `description` and `lifecycle` are there when the
record has them. A persona carries `audience`, a string, and a journey carries `personas`, a
list. `namedBy`
holds `personas` on an audience, `journeys` on a persona, and `pages` always.
Paths are relative to the working directory.

**`check -f json`** prints term's shape:

```text
{ findings: [ { rule, ruleId, severity, message, guidance, file, line?, id?, field? } ],
  summary: { records, references, errors, warnings, notices, baseline? } }
```

`message` carries the fix. The text before the fix stays internal as the
baseline's key, so a reworded fix moves no baseline. `guidance` holds the
rule's `id`, `rule`, `description` and `guide`. `references` counts every
value of `audiences:`, `personas:`, `journeys:` and `audience:` the run read. A
journey record's `personas:` counts once.

**`github`, `sarif` and `junit`** go through the adapter term uses onto meta's
renderers. `github` prints one workflow command per finding, with the title
`manni%3Astrategy/<rule>` and the guidance after `%0A`. A clean run prints
nothing. SARIF rule ids are `manni:strategy/<rule>`, and the JUnit classname
is `manni.strategy`. Guidance links point to
`https://hawkeyexl.github.io/manni/strategy/reference/rules/#<rule>`.

**`check -f pretty`** uses term's layout.

- Findings are grouped under a bold `file:line`.
- Each row is the severity, the rule id and the message. The message wraps by
  sentence under its own column, as term's does, and the rule's guidance
  follows it, dim.
- The summary reads `1 error, 2 warnings, 1 notice in 82 records`. It adds
  `, N baselined` when a baseline is in use.
- A clean run prints one line, such as
  `✓ 81 records, 1461 references, no findings`.
- An `--allow-empty` run with no records prints
  `✓ 0 records, 0 references, no findings` and exits `0`.
- A recording run prints `✓ 68 findings recorded in .manni-strategy-baseline.json`.

### Rule messages

| Rule | Message (exact) |
|---|---|
| `undefined-reference` | `journeys: "s-17" names no journey. Did you mean "s17"? Correct the value, or add a record with type: journey and id: s-17.` |
| `undefined-reference`, no near id | `journeys: "zzzz" names no journey. Correct the value, or add a record with type: journey and id: zzzz.` |
| `undefined-reference`, another type with a parent | `personas: "s17" is a journey, not a persona. Did you mean its persona, "sara"?` |
| `undefined-reference`, a persona in `journeys:` | `journeys: "maya" is a persona, not a journey. Move it to personas:.` |
| `undefined-reference`, on a record | `personas: "mya" names no persona. Did you mean "maya"?` |
| `undefined-reference`, another type on a record | `personas: "docs-engineers" is an audience, not a persona. Correct the value.` |
| `duplicate-id` | `id: "m5" is also the id of docs/content-strategy/journeys/m5-old.md:3. Give each record its own id.` |
| `missing-parent`, a persona | `audiences: does not name "schema-authors", the audience of persona "sara". Add it, or drop "sara" from personas:.` |
| `missing-parent`, a journey with one persona | `personas: does not name "maya", the persona of journey "m5". Add it, or drop "m5" from journeys:.` |
| `missing-parent`, a journey with several | `personas: names none of "maya", "sara", the personas of journey "m5". Add one, or drop "m5" from journeys:.` |
| `orphan-record`, a persona | `audience: missing, so this persona belongs to no audience. Name one with audience:.` |
| `orphan-record`, a journey | `personas: missing, so this journey belongs to no persona. Name one with personas:.` |
| `unserved-journey` | `no page names this journey in journeys:. Name it on the pages that serve it.` |
| `unused-record` | `no page and no record names this persona.`, or `this audience.` |

### The ladder

Run from this repository's root after the conversion and the IA move. The
config raises `unserved-journey` to `error`, which decides the exit of a run
that names only some pages.

```text
# 1. Minimal: the whole set, from the collections
$ manni strategy check
✓ 82 records, … references, no findings                     # exit 0

# 2. The tree
$ manni strategy list
…
4 audiences, 4 personas, 74 journeys                         # exit 0

# 3. One record, matched in any case
$ manni strategy get M5
Pin a claim and catch it going stale          docs/content-strategy/journeys/m5.md:1
…                                                            # exit 0

# 4. CI annotations; nothing when clean, exit 1 only on an error
$ manni strategy check -f github
::warning file=…,line=…,title=manni%3Astrategy/unserved-journey::…

# 5. The scripting form
$ manni strategy check -f json | jq '.summary'

# 6. The ratchet, on the tree of worked-example step 4
$ manni strategy check --baseline
✓ 68 findings recorded in .manni-strategy-baseline.json      # exit 0
$ manni strategy check --baseline
✓ 81 records, … references, no findings, 68 baselined        # exit 0

# 7. Positional: the records and the cite pages only
$ manni strategy check docs/content-strategy/ docs/src/content/docs/cite/
# unserved-journey for every journey the other pages serve   # exit 1

# 8. Stdin as one more input
$ cat page.md | manni strategy check docs/content-strategy/ - --as markdown

# 9. Every option at once, positional and then by collection
$ manni strategy check docs/content-strategy/ docs/src/content/docs/ --ext md,mdx --exclude "**/glossary/**" --no-gitignore --baseline -c manni.config.yaml -f sarif --no-color
$ manni strategy check --collection site --collection strategy --allow-empty --baseline -f junit
```

10. The usage errors. Each goes to stderr and exits `2`.

| Invocation | stderr |
|---|---|
| `manni strategy` | the full help |
| `manni strategy get` | `error: missing required argument 'id'`, then `(add --help for usage)` |
| `manni strategy get m55` | `manni: no record "m55". 82 records; did you mean "m15"?` |
| `manni strategy get zzzz` | `manni: no record "zzzz". 82 records.` |
| `manni strategy check -f xml` | `manni: unknown format "xml". Expected pretty \| json \| github \| sarif \| junit.` |
| `manni strategy check docs/src/content/docs/cite/` | `manni: no strategy records found. A record is a page declaring type: audience, type: persona or type: journey.` |
| `manni strategy check -` | ``manni: Reading from stdin (`-`) requires --as <format> to choose an extractor.`` |
| `manni strategy check --collection site docs/` | `manni: --collection selects a configured collection; it cannot be combined with paths.` |
| `manni strategy check --collection site`, with no config | `manni: --collection needs a config file to select from.` |
| `manni strategy check --collection nope` | `manni: no collection named "nope" in manni.config.yaml. Configured: site, strategy.` |
| `manni strategy check nowhere/` | `manni: File not found: "nowhere/". Check the path. Named paths resolve from the working directory.` |
| a run with no inputs and no collections | ``manni: No files to read. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.`` |
| `strategy: { paths: [x] }` in config | `manni: manni.config.yaml: strategy does not carry "paths". Name a collection under collections:.` |
| `strategy: { exclude: [x] }` in config | `manni: manni.config.yaml: strategy does not carry "exclude". Name a collection under collections:.` |
| `strategy: [1]` in config | `manni: strategy: in manni.config.yaml must be a mapping.` |
| an unknown key under `strategy:` | `manni: Unknown key "rules" under strategy: in manni.config.yaml. Supported keys: severity, baseline, allowEmpty, respectGitignore.` |
| an unknown rule under `strategy.severity` | `manni: Unknown key "unserved" under strategy.severity: in manni.config.yaml. Supported keys: undefined-reference, duplicate-id, missing-parent, orphan-record, unserved-journey, unused-record.` |
| `strategy: { allowEmpty: "yes" }` | `manni: strategy.allowEmpty in manni.config.yaml must be a boolean.` |
| a severity that is not a level | `manni: manni.config.yaml: strategy.severity.unserved-journey "fatal" is not a level. Expected notice \| warning \| error \| off.` |
| the configured baseline file is missing | ``manni: Baseline ".manni-strategy-baseline.json" not found. Record one with `manni strategy check --baseline`.`` |

A type error never quotes the value back, because a value can be a secret
pasted under the wrong key. A severity level is quoted, since it cannot be one.

## Known limits

- **A tie in a did-you-mean goes to the id read first.** In this repository
  `get m55` suggests `m15`. `m5` is one edit away too, and it is read later.
- **One record per file.** A file that lists several personas is one page,
  and no rule reads it as several records.
- **Only strings count.** A value that is neither a string nor a list of
  strings adds no reference. The audience vocabulary validates a page's
  shape, and the record schemas validate a record's.
- **No registered id names the record format.** Each repository that keeps
  records writes its own schemas, or starts from this repository's three.
- **Presence is meta's.** No rule requires a page to name a journey. A schema
  override with `required: [journeys]` does that.
- **The body is never read.** A record's prose can drift from its `title` and
  `description`, and no rule notices.
- **The graph does not type journeys.** A record is an ordinary page to
  `manni graph`, and `graph fill` drafts no journeys.

## What was rejected

| Option | Verdict |
|---|---|
| Keeping the records in the termbase | Rejected. Stress test 1 gives the reasons. |
| A built-in `manni:content-strategy:1.0.0` vocabulary, with a strict overlay, for the parent fields | Rejected. A record is not a docs page, and meta already validates any document against a schema an override names. Stress test 2 covers it. |
| Applying the page vocabulary `manni:audience:1.0.0` to records | Rejected. A record serves no reader, and its own `personas:` would draw a `location:external` warning. Records take their own schema. Stress test 2 covers it. |
| A singular `persona:` on a journey | Rejected. A journey can serve several personas. Stress test 9 covers it. |
| A `strategy write` that regenerates the IA tables | Rejected. `get <id>` answers which pages serve a journey. Stress test 3 covers it. |
| Several records per file, as `type: persona-set` | Deferred until someone asks for it. |
| A rule requiring every page to carry `journeys` | Rejected. That is presence, which is meta's job. |
| Graph typing for journeys, and `graph fill` drafting them | Out of scope. |
| A `--type` filter on `list` | Rejected. The tree groups by type already. |
| `strategy.paths` and `strategy.exclude` | Rejected. The set is the family `collections:`, as it is for term. |

## Stress test

### 1. Why not the termbase?

The termbase holds `type: term` records, and its rules are about vocabulary. A
persona is not a term, and a journey is not a definition. `unused-term` counts
only `concepts:`, so it could never see a journey no page serves. The user
decided on 2026-10-21 that the strategy gets a domain of its own.

**Changed as a result:** `manni strategy` borrows term's shape and none of its
data. The config keys, the `check` layout, the findings adapter and the input
flags follow term.

### 2. Why a schema per record type, not a built-in vocabulary?

The first draft of this decision registered `manni:content-strategy:1.0.0`, a
built-in vocabulary with a strict overlay, to declare the parent fields. The
user decided on 2026-10-22 that each record type gets a schema of its own.

Normal docs pages keep the baked-in schemas. The default set describes pages,
and nothing in it changes for the records.

A record is not a docs page. It serves no reader, so `manni:audience:1.0.0`
has no claim on it. The location shows why. That vocabulary puts `personas`
at `x-manni-location: external`. A journey record that took it would draw a
`location:external` warning on its own `personas:`. A record's parents belong
in its own file, beside its `type` and `id`.

Meta already validates any document against a schema an override names. The
house schema `./docs/doc-frontmatter.schema.json` reaches the site's pages that
way. Three more overrides need no new key, no registry row and no reference
page. Each schema can also require what its own type needs, with no condition
on `type`.

**Changed as a result:** no built-in schema is added, and the registry keeps
65 built-ins in eleven families. This repository ships three schemas, and its
config names each one by path. Their fields are the ones Promptless keeps.

### 3. Why no `write`?

A `strategy write` was floated to regenerate the IA tables from the records.
`get <id>` already answers "which pages serve this". Once the CUJ column is
gone, nothing generated is left to keep in sync. A writer would bring back the
second copy decision 7 removes.

### 4. Why does the `changed` scope run on any dirty tree?

Term runs in that scope when a collection document changed. That trigger would
miss most strategy edits. Almost every `personas:` and `journeys:` value lives
in a `.meta.yaml`, which is neither a document nor a collection member. An
agent that retags a sidecar would never see the check run.

**Changed as a result:** strategy runs whenever the tree has changes, as cite
does. The briefing names it beside cite.

### 5. Why `--collection site` on `graph publish`?

Graph reads every collection when no collection is named. The `strategy`
collection holds 82 internal records. A bare `graph publish` would put them
into the graph, the chunks and the `llms.txt` the public site serves. Those
records describe who the docs are for, and they are not docs a reader asked
for.

**Changed as a result:** `graph publish` takes `--collection`, as `graph
build` does. Only its build step reads documents, and every later step reads
the graph that step built. The publish steps in `docs.yml` run with
`--collection site`. Verification checks that their output holds no
`docs/content-strategy/` path.

### 6. Why must a positional run name the records too?

Records and pages come from the same inputs. Positional paths replace the
collections, as they do for `meta` and `term`. A run that kept
reading the `strategy` collection behind the typed paths would make the
positional form depend on config. That is the fallback positional paths exist
to replace.

A run that names only pages finds no record. It exits `2` and says what a
record is, so the missing half is named rather than guessed.

**Changed as a result:** nothing in the input model. The reference page and
the ladder show the two-path form.

### 7. Why is `unserved-journey` a warning by default?

A repository that adopts records starts with gaps, as this one had 24. An
error by default would turn its first run red for work the docs owe. The
ratchet goes the other way. Once `check` is clean, `strategy.severity` raises
the rule, and a new journey cannot land without a page.

A raised rule also turns a journey red before its pages exist, which pushes
authors to write journeys late. So the rule skips a journey whose `lifecycle`
is `draft` or `archived`. That field is meta's `manni:lifecycle:1.0.0` rather
than a new key, because its ladder already says whether something is live.

**Changed as a result:** the journeys override lists `manni:lifecycle:1.0.0`,
so `meta validate` checks the value against its enum.

### 8. Why are references gated on the records that exist?

`manni:audience:1.0.0` promises that `personas` may dangle in a repository
that keeps no personas. Checking every field from the first record would break
that promise for a repository that keeps only journeys. The gate keeps it,
field by field, until the records of that type exist.

### 9. Why may a journey name several personas?

A journey is an outcome, and more than one kind of reader can reach for it. A
singular `persona:` would make the author pick one persona, or copy the
journey once per persona. Either way the record says less than the author
knows. Promptless's records list a journey's personas for the same reason.

A persona keeps a singular `audience:`. An audience is a segment of readers,
and a persona is one reader inside one segment.

`missing-parent` follows the list. A page that names the journey passes when
its `personas:` holds any one of them. Asking for all of them would make every
page that serves the journey name every persona, whoever its readers are.

**Changed as a result:** a journey names its parents in `personas:`, a list.
The field is read once, as the parents, and not also as a reference. `list`
puts the journey under each of its personas, and the JSON key is `"personas"`.
Every journey in this repository names one persona today, as
`personas: [maya]`.

## Verification

```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build
npm run docs:check-cli && npm run schemas:check && npm run docs:check-tables && npm run docs:check-versions
cd docs && npm run build && cd .. && npm run docs:check-links
node dist/cli.js meta validate && node dist/cli.js term check && node dist/cli.js cite check
node dist/cli.js term write -f vale -o .vale/styles --check
npm run docs:check-docevals && npm run docs:check-graph
node dist/cli.js graph publish --collection site && node dist/cli.js graph check
vale docs/proposals/0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md docs/content-strategy docs/src/content/docs/strategy
```

`schemas:check` still counts 65 built-ins, because no built-in is added.
`meta validate` checks each record against its own schema, through the three
overrides, with 0 errors. `docs:check-docevals` grades the records under the
`site` suite. The `llms.txt` and chunks from `graph publish` hold no
`docs/content-strategy/` path.

The dogfood step runs the finished change on this repository, and its output
goes in the pull request.

1. After the conversion, `node dist/cli.js strategy check` shows 24
   `unserved-journey` and 44 `missing-parent` warnings, and exits `0`.
2. After the IA move, it prints `✓ … no findings` and exits `0`. Then
   `strategy list | tail -3`, `strategy get m5` and `strategy get maya` show
   the tree and the pages. `strategy get m5 -f json` shows
   `"personas": ["maya"]`.
3. `node dist/cli.js status` shows the strategy row in play.
4. `node dist/cli.js check` exits `0` with strategy run.
5. With a page tagged `personas: [s17]`, `strategy check` exits `1` with the
   did-you-mean. The tag is then reverted.

## Not breaking

- **A new domain.** `manni strategy` was an unknown command before, so no
  script ran it.
- **A new optional key.** A config without `strategy:` reads exactly as before.
- **No built-in schema.** The registry and the default set are unchanged. The
  record schemas live in this repository, and only its overrides name them.
- **The audience vocabulary is unchanged.** `manni:audience:1.0.0` keeps its
  fields and their meaning. A repository with no records keeps free-form
  values, and no rule reads them.
- **term's flags are unchanged.** `withInputs` moves to
  `src/shared/cli-options.ts`, and term passes its own noun. Its
  `--allow-empty` help still says "no terms", as
  `test/term/cli.integration.test.ts` pins. Its stdin wording stays.
- **Bare runs see the new collection.** docevals, cite and term stay clean over
  the records, and the publish steps in `docs.yml` name `--collection site`.
- **`graph publish` gains an optional flag.** A bare run reads every
  collection, as it did.

## Consequences

- Good, because the journeys and the pages agree, and `check` says so on
  every push.
- Good, because "which pages serve M5?" is one command, `manni strategy get m5`.
- Good, because the IA no longer keeps a second copy of the map, and no
  hand-written id range is left to drift.
- Good, because a typo in `personas:` fails with the name the author meant.
- Good, because the "may dangle" promise holds for any repository that keeps
  no records.
- Good, because the records add no built-in. Meta validates them through the
  overrides it already has, and normal pages keep the baked-in schemas.
- Good, because a journey can serve several personas, and a page that names
  any one of them passes.
- Bad, because each repository that keeps records writes its own schemas. No
  registered id names the format, so two repositories' schemas can drift
  apart.
- Bad, because the strategy is now 82 small files rather than three documents.
  Reading it end to end takes `manni strategy list` or a folder walk.
- Bad, because the new collection widens every bare run in this repository. A
  future graph step that forgets `--collection site` publishes the records.
- Bad, because `manni check` runs strategy on every dirty tree, even when the
  change touched no page.
- Bad, because a positional run must name the records, so
  `manni strategy check docs/` alone finds none.
- S17 joins Sara's journeys. The site gains a `strategy/` section with an
  overview, `reference/cli.mdx` and `reference/rules.mdx`, verified by
  `docs:check-cli`.
- The `feat` ships a demo video. `check` catches `personas: [s17]` with the
  did-you-mean, `get s17` prints `pages  none`, and the fix runs green.
