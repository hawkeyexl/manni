# 0095: Provenance on the live site, with `manni site annotate`

- **Status:** Implemented (#229)
- **Serves:** Two people, three journeys, and one reader no persona covers.
  - Maya · M5, "Pin a claim and catch it going stale". Her pins stop at CI
    today. With this change the built page says which sentences rest on code.
  - Maya · M26, "Run the docs site locally". She previews the annotated
    build on the same site she already serves.
  - Devin · D13, "Publish the graph for retrieval". What ships is what passed,
    and now the page says so.
  - The reader of the published site. No persona in
    `docs/content-strategy/personas.md` is a reader. The acceptance checklist
    adds journey M32 for Maya, written from the reader's side.
- **Depends on:** Seven earlier proposals.
  - [0090](0090-served-passages-carry-their-proof.md) is the chunk artifact.
    `manni graph publish` writes `chunks.json`, and each of its rows carries
    the passage's provenance record. This proposal reads those records. It
    defines no record of its own.
  - [0098](0098-verification-metadata.md) is `last-verified` and
    `verified-by`, which a record carries for its page and its statements.
  - [0099](0099-inline-metadata-statements.md) is the inline statement, on a
    block or on a heading, which a record carries with its status.
  - [0044](0044-citations-and-drift.md) is the pin. A claim is page lines
    and a hash, and a source is file lines, a hash and a commit.
  - [0082](0082-a-site-domain-runs-the-docs-site.md) is the site domain this
    adds a verb to, with its framework table.
  - [0069](0069-merge-safe-stamps.md) and
    [0072](0072-derived-dates-are-utc-days.md) are the two dates a record
    carries, as UTC days.
  - [0045](0045-family-encryption-key.md) is why an encrypted source never
    reaches a reader as a path.
- **Relates to:** [0051](0051-graph-domain.md), the graph. Stress test 4
  says why the browser does not load the graph runtime.
- **Supersedes in part:** 0082's known limit "Default output directories
  only". The new `site.out` key names the output, and the built-in server
  reads it too.
- **Changes:** 0090's record. A heading statement now joins `statements` at
  its heading's lines, beside the block statements. Decision 6 says why.
- **Touches:** `src/site/` (a verb, the join, and the framework table's
  `out` and route columns), a package export `@hawkeyexl/manni/site/rehype`,
  `src/graph/commands/chunks.ts`, the site domain's pages and
  `docs/content-strategy/cujs.md`

## Problem

manni makes a page trustworthy in CI. `cite check` proves each pinned
sentence against its source. `meta derive` stamps when a page was created and
updated. `docevals run` grades the page against its assertions. None of that
reaches the person reading the published page.

0090 gathers those facts into one record per passage, for an agent that
retrieves the passage. A person reading the page in a browser still gets
nothing.

This repository's own site shows the gap. Its 252 pages carry 4,199 pins, and
every one was current at commit `26dad159`. A reader of
`hawkeyexl.github.io/manni/cite/` sees the same prose as a page with no pins at
all. Nothing tells a proven sentence from the rest.

The hard part is the join. Every passage's proof is in `chunks.json`. A theme
that wants to show any of it must still find which rendered `<p>` holds which
pinned lines. Only the build knows the line positions, so a theme author
cannot do that step.

| Who | What they hit today | Cost |
|---|---|---|
| A reader | No sign of which sentences rest on code, or when anyone checked. | They trust every sentence equally, or none. |
| Maya · M5 | Her pins are invisible past CI. | The work has no reader-facing payoff. |
| Devin · D13 | The site ships with no record of which checks it passed. | An auditor has to rerun the checks to know. |

## Decision

### 1. Everything is computed at build, and the page carries it as data

Two steps run in CI, after the checks that gate.

1. `manni graph publish` (0090) writes `chunks.json` and its rows. Each row
   carries its passage's record: pins, dates, eval verdicts and statements.
2. `manni site annotate`, the new verb, runs after the framework's build. It
   reads `chunks.json` and the built HTML. It changes nothing in the sources.

Annotate does three things.

1. It joins each pin's claim, and each statement, to the blocks of the built
   HTML (decisions 2 and 6).
2. It writes `data-manni-*` attributes on each joined block (decision 7).
3. It writes each page's records into the page as one JSON island
   (decision 5).

It writes no visible mark, stylesheet, script or popover. The page looks
exactly as it did. A theme decides the look, from the attributes with CSS
alone, or from the island with a script. The browser loads no data and runs
no check.

### 2. A claim joins its passage by source lines first, then by text

A 0090 record covers a section, which is too coarse for a block. Each pin item
inside it names the body lines its claim occupies now. Annotate adds the
page's frontmatter length to get file lines, as cite's `toFileLines` does.
The join then carries those lines to the built HTML in two steps.

| Step | How a block is found | When it applies |
|---|---|---|
| Lines | The block carries a `data-manni-src` stamp whose range overlaps the claim's file lines. The innermost stamped blocks win. | The framework renders through unified and loads `@hawkeyexl/manni/site/rehype`. |
| Text | The claim's lines, rendered to plain text, are held by one block, or make up one run of adjacent blocks. | No stamped block overlaps the claim. Only a single candidate counts. |

Texts are compared without whitespace, with the typography a renderer adds
undone. A block inside a longer claim counts only at 12 characters or more.
A claim found by neither step, or by text in two places, is **not placed**.
Annotate lists it in its report, and it stays in the page's island. Annotate
never places a pin on a block it cannot tie to the claim.

The stamp is `data-manni-src="<page file>:<start>-<end>"`. A small rehype
plugin writes it, from the line positions every unified pipeline already
carries. It names the file, so a partial imported into a page joins to its
own pins. Annotate removes every stamp after the join, from every page, so no
`data-manni-src` reaches the deployed site.

The prototype under stress test 1 measured both steps on this repository's
site.

| Join | Claims placed | Agreement with the line stamps |
|---|---|---|
| Lines alone | 3,960 of 4,199 (94.3%) | by definition |
| Lines, then a single text run | 4,126 of 4,199 (98.3%) | 99.4% for single runs |
| Text alone, single runs only | about 3,316 of 4,199 (79%) | 99.4% |
| Text alone, document order breaking ties | 4,124 of 4,199 (98.2%) | 91.5% where it broke a tie |

The fourth row is why ties are never broken. One reader in twelve would see a
wrong proof on those passages, and a wrong proof is worse than none.

### 3. Sites other than Starlight

Every framework 0082 detects either builds static HTML or has no local build.

| Framework | Output (`out`) | Route for an unstamped page | Lines step |
|---|---|---|---|
| Starlight | `dist` | `<path>/index.html` | rehype plugin |
| Docusaurus | `build` | `docs/<path>/index.html` | rehype plugin |
| Nextra | `out` | `<path>.html` | rehype plugin |
| Fumadocs | `out` | `docs/<path>.html` | rehype plugin |
| Rspress | `doc_build` | `<path>.html` | rehype plugin |
| VitePress | `.vitepress/dist` | `<path>.html` | none, text only |
| MkDocs, Zensical | `site` | `<path>/index.html` | none, text only |
| Sphinx | `<src>/_build/html` | `<path>.html` | none, text only |
| Hugo | `public` | `<path>/index.html` | none, text only |
| Jekyll | `_site` | `<path>.html` | none, text only |
| Mintlify, Fern | none | none | none |

`<path>` is the page's path below the framework's content directory, without
its extension. An `index` page maps to its directory. A stamped page needs no
route, because the stamp names its file.

Nextra and Fumadocs write static pages only under `output: "export"`. A
server build has no HTML to annotate, and annotate says so. Mintlify and Fern
build on their own hosts, so there is nothing local to annotate.

A text-only framework gets the second step alone, which placed 79% of claims
here. Stress test 6 records what that costs.

### 4. What a reader sees is the theme's

Annotate draws nothing. Three lines of CSS turn `data-manni-state` into a
mark, and a script can read the island for detail. manni ships neither.

This repository's docs site carries one example rendering, labelled
"Prototype", on the annotate page only. It is site code, and the package does
not export it. The marks, popovers and palette below are that prototype's.

Each placed block gets one inline mark after its last word. The glyph carries
the meaning, and the colour repeats it.

| Mark | When | Popover heading |
|---|---|---|
| `✓` green | No pin on the block has an `error` finding. | `Pinned to source. Current. Checked at build 26dad15.` |
| `✗` red | At least one pin on the block has an `error` finding. | `A source changed after it was pinned. Checked at build 26dad15.` |
| none | The block has no pin. | none |

A popover lists one line per pin. A pin with no findings reads `current`, and
a pin with findings names each rule. The path links to the source lines at
the pin's commit. An encrypted source shows as `a private source`, with no
path, lines or link.

```text
✓ src/cite/core/classify.ts:128-139 · current
✗ src/upload.ts:102-104 · source-changed
```

The palette follows `docs/content-strategy/design.md`. Green and red here are
the product's own meaning, as in the terminal, not chrome. The accent blue
draws the popover border and the links.

| Pair | Ratio | WCAG 2.2 AA |
|---|---|---|
| `#3fb950` on `#171717` | 7.06 | passes |
| `#f85149` on `#171717` | 5.35 | passes |
| `#1a7f37` on `#ffffff` | 5.08 | passes |
| `#cf222e` on `#ffffff` | 5.36 | passes |
| `#1a7f37` on `#f6f8fa` | 4.77 | passes |

The mark sits inline rather than in the margin. The prototype hung it in the
left gutter first. At 1024px Starlight's gutter is 12px, which clipped the
mark. An inline mark needs no gutter on any theme.

![The cite overview page, annotated by the prototype. The second paragraph's popover lists six source pins, each current at build.](0095/prototype-hover.jpg)

### 5. The record is 0090's, and the island holds it unchanged

Annotate defines no record. Each page carries its records in one island, so a
machine reading the page gets the same record an agent gets over MCP.

```html
<script type="application/json" id="manni-provenance">{ "page": "…", "commit": "…", "worktree": "clean", "dates": { … }, "records": [ … ] }</script>
```

`records` are the chunk rows' provenance records whose `page` is this page,
unchanged and in `lines` order. `page`, `commit`, `worktree` and `dates`
repeat the page's own, for a script that wants only those.
`<script type="application/json">` never runs, so a strict content security
policy allows it. An encrypted source stays its ciphertext token, as in cite.

The live site needs one fact the record first lacked. 0090 now carries it:
each `pins.items[]` entry has `commit`.

| field | type | meaning |
|---|---|---|
| `pins.items[].commit` | 40 hex | The source end's recorded `commit-sha`, as the citation entry holds it. |

The record's top-level `commit` is the docs checkout. It is the wrong commit
for a link in two cases. A source under `cite.root` in another repository has
no lines at that commit. And a pin with a `source-changed` finding should link
the lines the sentence was pinned to, which only the pin's own commit has.

The record leaves out `last-reviewed`, because computing it needs the network.
That follows 0090's rule, and this proposal asks no change to it.

Outside git, the record's `commit` is `null` (0090). Annotate still runs. It
writes no `data-manni-commit`, and one notice says so.

### 6. Statements join by their lines

A 0099 statement names the lines it anchors, so the lines step places it, and
the text step never does. A block statement lands on its block. A heading
statement lands on its heading's element.

The record carried only block statements at first. A heading statement
overlaid the section's delivered fields and left no lines behind, so a host
could not place it. 0090's record now carries a heading statement in
`statements` too, at its heading's lines, with its status and its delivered
fields. It still overlays the section's fields, as before.

A placed statement's element gains `data-manni-statement`, and the
verification fields its statement sets (decision 7). A heading also gains its
section's effective `applies-to`. Its node is the section's. A block
statement's node is the `graph:Block` 0099 mints, `<section>.<n>`.

### 7. The attributes are a small, stable interface

Values are plain strings, and lists are space-separated, so a theme can select
any of them with CSS alone.

| Attribute | On | Value |
|---|---|---|
| `data-manni-node` | a placed block, or a heading | The graph node IRI of the section, or of the `graph:Block` a block statement mints. |
| `data-manni-pins` | a block with placed pins | Space-separated citation ids. An entry with no id appears as `#<n>`, its place in the page's citations. |
| `data-manni-state` | a block with placed pins | `current` when no pin has an error-severity finding, otherwise `drifted`. |
| `data-manni-verified` | a block or heading whose statement has `last-verified` | The day or timestamp, as written. |
| `data-manni-verified-by` | a block or heading whose statement has `verified-by` | Space-separated `verified-by[].tool` values. |
| `data-manni-statement` | a block or heading with a statement | `current`, `changed` or `unpinned`. |
| `data-manni-applies-to` | a heading whose section's effective metadata sets it | Space-separated values. |
| `data-manni-commit` | `<main>`, or `<body>` when there is no `<main>` | The docs commit. Absent outside git. |
| `data-manni-last-verified` | `<main>`, or `<body>` when there is no `<main>` | The page's `last-verified` (0098), when set. |

### 8. The command line

```text
manni site annotate [options] [dir]

Arguments:
  dir                    the site's directory (default: site.dir, else found by search)

Options:
  --out <dir>            the built site to annotate (default: site.out, else the framework's output)
  --chunks <file>        the chunk manifest graph publish writes (default: chunks.json beside graph.out)
  -f, --format <format>  output: pretty | json (default: "pretty")
  -c, --config <file>    path to a manni config file
  -h, --help             display help for command
```

`[dir]`, `-c` and the search follow `site build` exactly. The pages annotated
are the pages the chunk rows name. Eval verdicts come in through `graph
publish`, so annotate takes no evals flag.

`site build` and `site preview` run annotate after a successful build when
`site.annotate.after-build` is `true`. `preview` serves the annotated output.
`site start` never annotates, because a dev server writes no output.

### 9. Config

Before, `site:` has `dir` and `commands`. After, two keys join, and every key
stays optional.

```yaml
# Before
site:
  dir: docs
  commands:
    build: pnpm build
```

```yaml
# After
site:
  dir: docs
  commands:
    build: pnpm build

  # string. The built site, relative to dir. Default: the framework's output
  # (decision 3). Read by annotate and by preview's built-in server.
  out: dist

  annotate:
    # boolean. Default: false. When true, `site build` and `site preview`
    # run `site annotate` after a successful build.
    after-build: true
```

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `site.out` | string | the framework's output | no | The built site, relative to `site.dir`. |
| `site.annotate.after-build` | boolean | `false` | no | `build` and `preview` annotate after the build. |

The framework's own config needs one line for the lines step. In this
repository that line is in `docs/astro.config.mjs`.

```js
import manniLines from "@hawkeyexl/manni/site/rehype";
// ...
markdown: { rehypePlugins: [rehypeFocusableTables, manniLines] },
```

### 10. Messages and exit codes

Annotate is not a gate. `cite check` is. So annotate exits `0` whatever the
pins say, and `2` when it cannot run. It never exits `1`.

| When | Stream | Line | Exit |
|---|---|---|---|
| Before the join | stderr | `manni: Starlight in docs/. Annotating docs/dist from docs/public/graph/chunks.json.` | n/a |
| Success | stdout | `docs/dist: 252 pages annotated. 4126 of 4199 pins placed, 73 listed on their page only. 3 blocks carry a verification.` | 0 |
| Repeated text | stdout | `  cite/reference/citations/index.html: 3 pins not placed, because their text appears twice: a, b, c.` | 0 |
| No block holds the text | stdout | `  cite/fix/index.html: 1 pin not placed, because no block holds its text: d.` | 0 |
| A statement not placed | stdout | `  cite/set-up/index.html: 1 statement not placed, because no block holds lines 53-54.` | 0 |
| A page with no built page | stdout | `  docs/src/content/docs/x.mdx: no built page at docs/dist/x/index.html.` | 0 |
| A drifted block | stdout | `  cite/index.html: 1 block drifted, because a source changed: fetch-timeout.` | 0 |
| A unified framework with no stamps | stderr | `manni: docs/dist carries no line stamps, so blocks are placed by text alone. Add @hawkeyexl/manni/site/rehype to the framework's rehype plugins.` | n/a |
| Outside git | stderr, once | `manni: chunks.json carries no commit, so pages get no data-manni-commit.` | n/a |
| No built site | stderr | `manni: no built site at docs/dist. Run manni site build first, or pass --out.` | 2 |
| No chunk artifact | stderr | `manni: docs/public/graph/chunks.json does not exist; run manni graph publish.` | 2 |
| Not a chunk manifest | stderr | `manni: notes.json is not a chunk manifest; run manni graph publish.` | 2 |
| An artifact from another graph | stderr | `manni: docs/public/graph/chunks.json was built from another graph; run manni graph publish.` | 2 |
| Nextra or Fumadocs server build | stderr | `manni: docs/out does not exist. Nextra writes static pages only with output: "export" in next.config.` | 2 |
| Mintlify or Fern | stderr | `manni: Mintlify builds on its own host, so there is no local site to annotate.` | 2 |
| A build failed under `after-build` | stderr | `manni: npm run build exited with code 1.` This is 0082's line, and annotate does not run. | 2 |
| An unknown key | stderr | ``manni.config.yaml: `site.annotate:` has unknown key "marks". Supported keys: after-build.`` | 2 |
| A wrong type | stderr | `manni.config.yaml: site.annotate.after-build must be a boolean.` | 2 |

### 11. Output shapes

`-f json` prints one object.

```json
{
  "out": "docs/dist",
  "pages": 252,
  "pins": { "total": 4199, "placed": 4126 },
  "statements": { "total": 3, "placed": 3 },
  "unplaced": [
    { "page": "cite/reference/citations/index.html", "kind": "pin", "ids": ["a", "b", "c"], "reason": "repeated-text" }
  ],
  "drifted": [{ "page": "cite/index.html", "ids": ["fetch-timeout"] }]
}
```

`reason` is `repeated-text`, `no-block` or `no-page`. A statement's `ids` are
its lines. A pin with no `id` is named `#<n>`, as on the page.

Each annotated HTML page changes in three ways. Each joined block gains the
attributes of decision 7. `<main>` gains the commit and the page's
`last-verified`. The island is appended before `</body>`. Every other byte is
the framework's.

### 12. The ladder

In this repository unless noted.

```text
# 1. Minimal: publish the records, build however you build, then annotate
$ manni graph publish
$ (cd docs && npm run build)
$ manni site annotate
manni: Starlight in docs/. Annotating docs/dist from docs/public/graph/chunks.json.
docs/dist: 252 pages annotated. 4126 of 4199 pins placed, 73 listed on their page only. 3 blocks carry a verification.
                                                        # exit 0

# 2. From config: site.annotate.after-build: true
$ manni site build
manni: Starlight in docs/. Running npm run build
manni: Starlight in docs/. Annotating docs/dist from docs/public/graph/chunks.json.
docs/dist: 252 pages annotated. 4126 of 4199 pins placed, 73 listed on their page only. 3 blocks carry a verification.

# 3. See it before it ships
$ manni site preview                                    # builds, annotates, serves

# 4. A custom output and artifact
$ manni site annotate docs --out docs/build --chunks .manni/graph/chunks.json

# 5. Scripting
$ manni site annotate -f json | jq '.unplaced[] | select(.reason == "repeated-text")'

# 6. CI: gate, publish, then build and annotate what passed, then deploy
- run: npx @hawkeyexl/manni cite check -f github
- run: npx @hawkeyexl/manni graph publish
- run: npx @hawkeyexl/manni site build                  # after-build: true
- uses: actions/upload-pages-artifact@v3
  with: { path: docs/dist }

# 7. An MkDocs repository, text join only, and no rehype hint
$ manni site annotate
manni: MkDocs in docs/. Annotating docs/site from .manni/graph/chunks.json.
docs/site: 40 pages annotated. 246 of 310 pins placed, 64 listed on their page only. 0 blocks carry a verification.

# 8. Everything at once
$ manni site annotate docs --out docs/dist --chunks docs/public/graph/chunks.json -f json -c manni.config.yaml

# 9. Usage errors, all exit 2
$ manni site annotate                                   # before any build
manni: no built site at docs/dist. Run manni site build first, or pass --out.
$ manni site annotate                                   # before graph publish
manni: docs/public/graph/chunks.json does not exist; run manni graph publish.
$ manni site annotate                                   # after a new graph build
manni: docs/public/graph/chunks.json was built from another graph; run manni graph publish.
$ manni site annotate                                   # a Mintlify repository
manni: Mintlify builds on its own host, so there is no local site to annotate.
```

The MkDocs numbers in rung 7 are illustrative.

### 13. Programmatic API

| Change | Export |
|---|---|
| addition | `@hawkeyexl/manni/site/rehype`. Its default export is the rehype plugin that writes `data-manni-src` stamps. It imports nothing, and is built `platform: "neutral"`. |
| addition | The `site` namespace of `@hawkeyexl/manni`: `runAnnotate`, `renderAnnotate`, `ANNOTATE_FORMATS`, `AnnotateOptions`, `AnnotateReport`, `AnnotateNote`, `AnnotateFormat` and `SiteError`. |

## Known limits

- **The graph must be set up.** The records come from `graph publish`, so a
  site with pins and no `graph:` section gets no attributes. Annotate says
  which command to run.
- **Routes follow conventions.** A page with a custom slug or permalink has
  no route in decision 3. It is placed only when stamped, and is otherwise
  listed as having no built page.
- **Text-only frameworks place fewer claims.** VitePress, MkDocs, Zensical,
  Sphinx, Hugo and Jekyll place about four claims in five on a site like this
  one.
- **Code blocks need the text step.** Expressive Code renders its own `<pre>`
  and drops the line positions. 156 of the 166 claims the text step placed
  here were code blocks.
- **A second run places by text.** The first run removes the stamps, so a
  second run over the same build finds none. Rebuild before annotating again.

## Stress test

### 1. Can this repository's site join paragraphs to pins at build?

Yes. A throwaway prototype outside `src/` ran at `26dad159`, before 0090 had
a draft. It read claim lines from `cite check -f json`, which are the same
lines a 0090 pin item carries, shifted by the frontmatter. It covered 252
pages and 4,199 claims. It parsed the built `docs/dist` with parse5, and
rendered each claim's lines to text with `mdast-util-from-markdown`. A
ten-line rehype plugin stamped block elements with their source lines.

Lines alone placed 94.3% of claims. Lines with a single text run placed
98.3%. The text step agreed with the line stamps on 99.4% of single runs.
Where text had to break a tie by document order, it agreed on only 91.5%.
Those ties are left unplaced (decision 2).

The misses fall into three groups. One is code blocks, whose positions
Expressive Code drops. Another is table rows, whose cell text repeats across
tables. The last is claims that start or end mid-paragraph, whose text is no
block's text.

### 2. Why not run the join in the browser?

The join needs the page source, which the browser does not have. It is also
the step that can be wrong. Running it in CI puts its count in a log a
maintainer reads, and not in a reader's console.

### 3. Why data rather than marks?

The first draft wrote marks, popovers, a stylesheet and a script. A mark is a
design, and every theme has its own. Shipping one would make manni a UI
package with a palette to maintain, for a look most sites would override.
The join is the part a theme cannot do, so annotate does only that. The
attributes work with scripts off, and CSS alone shows them. The island stays,
for machines and for a script that wants detail.

### 4. Why not load the graph runtime?

`@hawkeyexl/manni/graph/runtime` reads a whole graph and `chunks.json`. A
theme needs one page's records, which the page already carries. Loading the
runtime adds a download that answers nothing the island does not. A site that
wants search already loads the runtime, and the records it serves are the
same ones.

### 5. Why a new verb rather than a flag on `site build`?

Many sites never build through manni. A verb that takes the output directory
works after any build. `site.annotate.after-build` covers the sites that do
build through manni, with no second command.

### 6. Is text alone worth shipping for MkDocs, Hugo and the rest?

Yes, with the tie rule. It places four claims in five, and 99.4% of those are
right. A missing attribute costs a reader nothing they have today. A wrong one
costs the trust the feature exists to build. The unplaced claims stay in the
page's island.

### 7. Should an `error` finding stop annotate?

No. A repository that gates runs `cite check` first, and an `error` never
reaches annotate. A repository that does not gate still gets an honest page.
The block says `drifted` where a source changed, which is the truth at build.

### 8. Does a record leak what encryption hides?

No more than the repository already does. 0090 keeps an encrypted source as
its ciphertext token, which the public citation manifest already holds.
Annotate copies that token unchanged.

### 9. Do the stamps leak repository paths?

Only if annotate does not run. Annotate strips every `data-manni-src`. A site
that loads the plugin and never annotates ships stamps naming page files.
Those names are already public in a public docs repository. The reference
page says to load the plugin only where annotate runs.

### 10. Why refuse an artifact from another graph?

The attributes would describe text that may no longer be on the page. A
reader cannot tell, and the build can. Publishing again costs one command.

## Rejected

- **A record of this proposal's own.** The first draft defined one, before
  0090 existed. Two shapes for one fact is the parity break CLAUDE.md
  forbids, so the site reads 0090's.
- **Marks, a stylesheet and a script in the package.** Decision 1 and stress
  test 3. They are this repository's prototype, not manni's interface.
- **Running cite in process.** 0090's export already runs cite's classifier
  once per build. Running it twice could give two answers for one commit.
- **Marks in the left margin.** At 1024px Starlight leaves a 12px gutter, and
  the prototype's margin mark was clipped. Other themes vary more.
- **Document order to break text ties.** It placed 91.5% correctly, which is
  one wrong proof in twelve.

## Open questions

1. **The pin commit.** Answered: 0090 now takes `pins.items[].commit`
   (decision 5). Without it, a link goes to the docs checkout's commit,
   which is wrong for a cross-repository source.
2. **Authorship.** 0046's `provenance` pins the lines a model wrote. Should
   0090's record carry that too, so a reader sees which passages a model
   drafted?
3. **Route overrides.** Is a custom slug common enough to warrant a route
   map, or does the rehype stamp cover the frameworks that need one?
4. **VitePress.** It renders through markdown-it, whose tokens carry line
   maps. A markdown-it stamp plugin would give it the lines step. Is that
   worth a second export?
5. **A `moved` state.** Should `data-manni-state` have a third value for a
   `source-moved` warning? A moved pin still holds, and the island carries
   the rule for a theme that wants it.

## Acceptance checklist

- [x] `manni site annotate` reads `chunks.json`, writes `data-manni-*`
      attributes per decision 7 and one `#manni-provenance` island per page,
      removes every `data-manni-src`, and exits 0.
- [x] Annotated pages add no stylesheet, script file or visible mark. Their
      prose is byte-identical apart from the attributes and the island.
- [x] The join places by lines first, then by a single text run, and never
      breaks a tie. Unplaced pins and statements are reported with their
      reason.
- [x] Block and heading statements are placed by lines, with
      `data-manni-verified`, `data-manni-verified-by` and
      `data-manni-statement`. A heading carries `data-manni-applies-to` when
      its section sets it.
- [x] Outside git, no `data-manni-commit` is written, records carry
      `commit: null`, and one notice prints.
- [x] `site.out` and `site.annotate.after-build` validate. `site build` and
      `site preview` annotate when `after-build` is true, `preview`'s
      built-in server reads `site.out`, and `site start` never annotates.
- [x] Every decision 10 message prints with its exit code, and `-f json`
      prints decision 11's shape.
- [x] `@hawkeyexl/manni/site/rehype` is exported, imports nothing, and
      stamps the file and lines.
- [x] `site/annotate/index.mdx`, the CLI reference's `annotate` section and
      config keys, and the labelled prototype component exist.
      `npm run docs:check-cli` passes, and `cujs.md` has M32.
- [x] This proposal's Status line reads `Implemented`, and 0082 reads
      `Superseded in part by 0095`.
- [x] The Docs workflow publishes the graph, then builds and annotates the
      site with `manni site build`.
- [x] A `feat(site):` demo script is at `media/site-annotate-1x1.script.md`.

## Consequences

- Good, because a theme can tell a proven sentence from the rest with CSS
  alone.
- Good, because the check that ran in CI is what the page says. Nothing is
  rerun in a browser.
- Good, because an agent over MCP and a reader in a browser get one record.
- Bad, because the site's HTML changes after its framework built it. A
  framework that hashes its own output for caching sees new bytes.
- Bad, because a site needs the graph set up before it gets attributes.
- Bad, because a text-only framework places fewer pins than a unified one.
