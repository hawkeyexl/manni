# 0130: Resolve includes before assessing prose

- **Status:** Implemented (#302)
- **Serves:** Two journeys, each for a docset that keeps shared text in
  partials.
  - Maya · M10, "Hold every page to the shape its doctype promises".
  - Maya · M12, "Keep one eval library the whole corpus shares".
- **Depends on:** Two earlier proposals.
  - [0125](0125-madcap-flare-projects.md) decision 12 resolves a Flare topic's
    snippets before lint reads it, and decision 14 reports a snippet's fault
    at the snippet reference.
  - [0129](0129-evals-on-lint-templates.md) grades a template's evals on every
    page lint routes to it, so a partial that routes gets graded too.
- **Extends:** [0125](0125-madcap-flare-projects.md) decisions 12 and 14, from
  Flare to every format with an include syntax. 0125 stays as written.
- **Touches:** A new `src/shared/includes.ts`, `src/lint/commands/lint.ts`,
  lint's five reporters, `src/docevals/core/discover.ts`,
  `src/docevals/graders/native/regex.ts`, `src/docevals/judge/page-text.ts`,
  docevals' reporters, fixtures under `test/fixtures/includes/`, and the lint
  and docevals reference pages.
- **Verdict:** lint and docevals expand a page's includes before they assess
  it. A partial another page includes is assessed there, not alone. A finding
  in included text reports at the directive and names the file it came from.

## Problem

Maya writes a how-to whose "Before you begin" section lives in a shared
partial. Each format spells the include its own way.

- MDX imports `./_partials/prereqs.mdx` and renders `<Prereqs />`.
- mdBook writes `{{#include prereqs.md}}`, and MkDocs writes `--8<-- "prereqs.md"`.
- AsciiDoc writes `include::prereqs.adoc[]`, and rST writes
  `.. include:: prereqs.rst`.

`manni lint structure` reads only the page's own file. The template's required
section is missing, so lint fails a page a reader sees as complete. It also
lints the partial alone, where a fragment never matches a page template, and
fails that too.

docevals has the reverse gap. A judge asked "does the page say which Node.js
version it needs?" never sees the partial that says it. A regex eval looking
for the same text fails.

Flare already works the way a reader sees it, since 0125 decision 12. Every
other format ignores includes on purpose. AsciiDoc runs in `secure` mode, rST
leaves `include` unresolved, and MDX drops imports. Those choices kept the
parsers safe, and they also kept them blind.

Doc Detective solved the same problem for test detection, in its
`core/includes.js` and its ADR 01212. It expands each include into the page and
keeps an offset map back to the file each span came from. A file another input
includes runs only as part of that input.

## Decision

1. **What a reader sees is assessed.** Before `lint structure` and
   `docevals run` read a page, its includes are expanded in place. It is on by
   default with no switch. The directive is the signal.
2. **Built-in syntaxes only,** the same set as Doc Detective 5.6.3.
   - Markdown reads mdBook `{{#include path}}`, with `:N`, `:N:M` and `:anchor`
     selectors. It also reads MkDocs `--8<-- "path"`, with `:section`, and
     `<Markdown src="path" />`.
   - MDX also reads `import X from "./x.mdx"` (or `.md`), rendered where `<X />`
     appears. `* as X` renders at `<X.Content />`.
   - AsciiDoc reads `include::path[]` with `tag=`, `tags=` and `lines=`.
     Attribute entries apply in reading order.
   - rST reads `.. include:: path` with `:start-line:`, `:end-line:`,
     `:start-after:` and `:end-before:`. A docutils standard include and a
     `:literal:` or `:code:` include add no prose, and stay as written.
   - Flare and DITA are unchanged. `resolveFlare` and DITA-OT already expand
     them.
3. **Paths resolve** against the including file, then the root. MkDocs tries
   the root first, as MkDocs does. MDX `@site/` resolves from the nearest
   `docusaurus.config.*`, and an rST `/` from the nearest `conf.py`. A package
   import, such as a Starlight component, is a component and not a page.
4. **Guards.** Each guard warns once and leaves the directive as written.
   - A URL target is not fetched.
   - A target outside the root is not read. The root is the config file's
     directory, or the working directory when no config file governs the run.
   - A cycle stops at the file that repeats.
   - Nesting stops past 64 levels, Asciidoctor's own default.
   - A missing target, or a selector that selects nothing, is left alone.
   - A component in a code fence, inline code or a comment is an example, so
     it is not expanded. Neither is an mdBook include in inline code or a
     comment, or an rST include in a literal block or a comment.
5. **A partial is assessed through its includer.** A file another page in the
   same run includes is not linted or evaluated alone. Pages are taken in
   order, so one page of an include cycle is still assessed. Named alone, a
   partial is linted alone, as before. `meta`, `cite`, `term` and `graph`
   still read it as a file.
6. **Where a finding reports.** A finding in included text reports at the line
   of the top-level directive in the page, as 0125 decision 14 does for Flare.
   It also names the file and line the text came from. A fixer then has both:
   where the page breaks, and which file to edit.
7. **Scope.** `lint structure` covers every parser that reads Markdown, MDX,
   AsciiDoc or rST. `docevals run` covers the judge's text and the
   deterministic graders that read the body. `cite` stays on raw file lines,
   because it pins source bytes. `target: raw` stays the file as written.
   graph's sections and search index are a separate change.

The expander is a port of Doc Detective's, not a dependency. It lives in
`src/shared/includes.ts`, which both domains import. Each expanded span also
carries the page offset of the directive that brought it in, which is where
manni reports. The AsciiDoc parser keeps `safe: "secure"`, because expansion
happens before Asciidoctor sees the text.

## Worked example

Maya keeps the MDX fixture repository at `test/fixtures/includes/mdx/`.

```text
docs/install.mdx            # a how-to; imports ./_partials/prereqs.mdx and renders <Prereqs /> on line 7
docs/_partials/prereqs.mdx  # "## Before you begin" and two bullets
templates.yaml              # a how-to needs "Before you begin" and "Steps"
```

Before this change, both files fail. The page lacks a section its partial
holds, and the partial lacks every section a page should hold.

After it, the page passes and the partial is assessed through it.

```text
$ manni lint structure docs/
Using manni.config.yaml (.)
✓ docs/install.mdx

1 file checked, 1 passed, 0 failed, 0 skipped, 1 partial assessed through its includer
exit 0
```

Then Maya renames the partial's heading to `## Before you start`.

```text
$ manni lint structure docs/
Using manni.config.yaml (.)
✗ docs/install.mdx
    7:1  manni:lint/structure/missing-section  Before you start: Missing section "Before you begin"
         (included from docs/_partials/prereqs.mdx:1)
         ./templates.yaml#how-to before-you-begin
    7:1  manni:lint/structure/unexpected-section  Before you start: Unexpected section "Before you start". …
         (included from docs/_partials/prereqs.mdx:1)
         ./templates.yaml#how-to

1 file checked, 0 passed, 1 failed, 0 skipped, 1 partial assessed through its includer
exit 1
```

Line 7 is the `<Prereqs />` line in `install.mdx`. The second line names the
file to edit, and its line. The run prints the template file as an absolute
path, shortened here.

## Interface

### Config, before and after

No new keys. The document before and after is the same.

### Commands

No new flags on `lint structure`, `lint check`, `docevals run` or
`manni check`.

```text
manni lint structure docs/                 # includes expanded, partials assessed through their includers
manni lint structure docs/_partials/x.mdx  # a partial named alone is linted alone
manni lint check -f json                   # findings in included text carry includedFrom
manni docevals run docs/install.mdx        # graders read the expanded body
```

### Messages

Each goes to stderr through `warn()`, once per text, and leaves the exit code
unchanged. The prefix is `programName()`, which is `manni`.

```text
manni: docs/install.mdx:3: include "./_partials/missing.mdx" not found; left unexpanded.
manni: docs/a.adoc:4: include "../../etc/x.adoc" is outside /repo; left unexpanded.
manni: docs/a.adoc:4: include "https://example.com/x.adoc" is a URL; left unexpanded.
manni: docs/a.md:3: include "b.md" selects "intro", which is not found; left unexpanded.
manni: docs/a.md includes itself: docs/a.md → docs/b.md → docs/a.md; stopped expanding.
manni: docs/a.md: includes nest deeper than 64; stopped expanding.
```

The pretty summary gains one clause when any partial was assessed through its
includer: `, 1 partial assessed through its includer`, or
`, N partials assessed through their includers`.

### Output shapes

- **lint `-f json`.** A finding in included text gains
  `"includedFrom": { "file": "docs/_partials/prereqs.mdx", "line": 1 }`. It is
  absent for the page's own text. A partial is an entry with
  `"skipped": "partial"`, because the shape is a bare array with no run object.
- **lint `-f sarif`.** The result keeps its location at the directive and
  adds a `relatedLocations` entry for the source file and line. A partial is a
  `toolExecutionNotification` with the id `partial`.
- **lint `-f github`, `-f junit` and pretty.** The message ends
  `(included from <file>:<line>)`.
- **docevals.** A finding gains the same `includedFrom` in `-f json`. Pretty,
  github, junit and sarif end its message with the same suffix.

### Programmatic API

`src/index.ts` does not change. lint's `Finding` gains an optional
`includedFrom`, `SkipReason` gains `"partial"`, and `LintSummary` gains an
optional `partials` count.

## Known limits

- **Custom include statements** are not read. Doc Detective's
  `includeStatements` covers Jekyll's `include_relative` and Hugo shortcodes.
  A shared key can come when a corpus needs one.
- **A partial with frontmatter** is inlined with it. Astro and Docusaurus
  partials carry none, so this has not come up.
- **AsciiDoc tag markers** stay in a whole-file include, as comments. They add
  no prose.
- **mdBook and MkDocs** include inside code fences, because their
  preprocessors do. A reader sees the included code. An mdBook include in
  inline code or a comment stays as written. A page that names the syntax in
  prose means it as an example.

## Rejected

- **A switch to turn it off.** The directive is the signal, and a page with no
  includes reads exactly as before.
- **Doc Detective as a dependency.** It would bring a browser automation stack
  for one module of string handling.
- **Reporting at the partial's own lines.** A fixer reading a page's report
  would find no such line in the page. The page line plus `includedFrom`
  gives both places.

## Verification

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass.
`test/shared/includes.test.ts` covers each syntax, each guard and the offset
map. `test/lint/includes.test.ts` covers the skipped partial and a finding at
the directive, in every report format. `test/docevals/includes.test.ts` covers a regex
eval matching text that lives only in a partial.

### Dogfood

`node dist/cli.js lint check` and `node dist/cli.js docevals run` run over this
repository. The site imports Starlight components as packages, which are not
expanded. The output goes in the pull request description.

## Acceptance checklist

- [ ] `src/shared/includes.ts` expands each listed syntax, and its header cites
      doc-detective 5.6.3 `dist/core/includes.js`.
- [ ] `manni lint structure docs/` on the MDX fixture prints `1 partial
      assessed through its includer` and exits 0.
- [ ] A broken partial reports at line 7 with `(included from
      docs/_partials/prereqs.mdx:1)` in pretty, `includedFrom` in json and
      `relatedLocations` in sarif, and exits 1.
- [ ] Missing, outside-root, URL, cycle and depth cases each warn once with the
      text above and leave the exit code unchanged.
- [ ] A docevals regex eval matches text that lives only in a partial.
- [ ] `cite check` still pins raw file lines, and its tests are unchanged.
- [ ] Fixtures under `test/fixtures/includes/`, and tests in `test/shared/`,
      `test/lint/` and `test/docevals/`.
- [ ] The lint overview has an "Includes and partials" section, and the lint
      and docevals references list the new output fields.
- [ ] The dogfood output is in the pull request description.
