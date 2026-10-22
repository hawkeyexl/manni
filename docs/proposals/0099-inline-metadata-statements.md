# 0099: Inline metadata statements, pinned to the block they describe

- **Status:** Implemented
- **Serves:**
  - Maya · M30, and a new M31, "Pin a fact to the sentence it is about". A
    page with five procedures can only say the whole page was verified.
  - Sara · S16, "Let another tool write metadata the family reads". A tool
    that verifies one procedure has nowhere shared to say so.
- **Depends on:**
  - [0098](0098-verification-metadata.md) for `verified-by` and `last-verified`.
  - [0047](0047-field-location.md) for `x-manni-location`.
  - [0044](0044-citations-and-drift.md) for the hashing rule and the marker
    forms.
  - [0051](0051-graph-domain.md) for the section typing a heading statement
    reuses.
- **Supersedes:** No proposal. [0056](0056-several-ids-per-marker.md) governs
  the `cite` keyword's payload, and `meta` is a new keyword.
- **Touches:**
  - `src/shared/statements.ts`, the scanner, moved from `src/cite/core/`.
  - `src/meta/core/statements.ts`, and the `validate`, `derive` and `get`
    command cores and reporters.
  - `src/meta/index.ts`, the graph harvest, `ns/graph/ns-1.3.0.ttl` and
    `shapes/graph/shapes-1.2.0.ttl`.
  - A new `meta/set-up/` page, the interop guide, the CLI and API references,
    and the content strategy.

## Problem

Metadata stops at the page. Take a page with five procedures. Doc Detective
verified three, and two were never tested. The page can only say that it was
verified on 2026-10-21. The two untested procedures borrow a date they did not earn.

The finer-grained options are each worse. A writer can split the page. A
sidecar keyed by line numbers rots on the next edit. A tool-specific comment,
such as Doc Detective's `<!-- verified id=… date=… -->`, is read by one tool
and validated by none.

Inline facts also go stale without anyone noticing. A tool's comment carries
no hash. A sentence rewritten after its procedure passed keeps a date it no
longer earns.

cite already solved half of this. Its markers anchor to the next paragraph
with a line-exact hash, in six formats. A marker carries only ids, though, so
its data still lives in front matter or a manifest. The data belongs in the
sentence's own source.

## Decision

1. **The grammar is cite's, with a new keyword.** A statement is `meta`, then
   an optional pin token, then one JSON object, all on one line. It uses the
   comment forms cite already reads.

   | Format | Forms |
   |---|---|
   | Markdown | `<!-- meta … -->`, `[comment]: # (meta …)`, `{/* meta … */}` |
   | MDX | `{/* meta … */}`, and the two Markdown forms |
   | HTML | `<!-- meta … -->` |
   | XML and DITA (`.xml`, `.dita`, `.ditamap`) | `<?manni meta …?>`, preferred; `<!-- meta … -->` accepted |
   | DITA, natively | `<data name="manni-meta" value='…'/>` |
   | AsciiDoc | `// (meta …)` |
   | reStructuredText | `.. (meta …)` |

   The scanner moves from `src/cite/core/statements.ts` to
   `src/shared/statements.ts`, and cite and meta share it. A statement inside
   a code fence or a backtick span is not read.

   XML and DITA prefer the processing instruction. It is valid anywhere under
   any DTD, and it survives tools that strip comments. It can also hold `--`,
   which an XML comment cannot. A comment-form payload holding `--` is refused.
   The form matches Doc Detective's `<?doc-detective …?>` instructions.

   The `<data>` carrier is DITA's own metadata element. DITA-OT output and
   content management systems keep `<data>` and drop most comments and
   instructions. Its value holds the optional pin and the JSON object,
   single-quoted so the JSON needs no escaping. Each element's content model
   decides where it may sit. manni reads it wherever it appears, and DTD
   validation stays DITA-OT's job. It mirrors Doc Detective's
   `<data name="doc-detective" value="…"/>`.

   The content model shapes the examples. DITA refuses `<data>` as a
   `<step>`'s first child, and DITA-OT reports `DOTJ088E`. So `<data>` goes
   where the model allows it, such as the first child of `<cmd>`, and then
   anchors that `<cmd>`. A whole step takes the instruction as its first
   child.

2. **A statement anchors as a cite marker does,** in Markdown, MDX, HTML,
   AsciiDoc and reStructuredText. It anchors the rest of its own line when
   text follows on that line. Otherwise it anchors the next paragraph,
   skipping blank and marker-only lines, or a fenced block when one comes
   first. Stacked statements and cite markers therefore anchor the same
   block. A statement inside a paragraph is misplaced, as a cite marker would
   be.

3. **In XML and DITA, a statement anchors an element.** cite's line rule
   treats a tag alone on its line as a one-line unit. Above a multi-line
   `<step>` it would pin the `<step>` line and miss an edit to its `<cmd>`.
   So a statement that is an element's first child anchors that element,
   start tag to end tag. That placement is preferred, because the statement
   moves with the element when the element is moved or reused. Any other
   statement anchors the next element after it, start tag to end tag. The
   positions come from the XML extractor's reconstructed element positions.
   cite markers in XML keep their line rule.

4. **A statement on a heading describes a section.** The heading is an ATX
   heading in Markdown or MDX, a title in AsciiDoc, or a section title in
   reStructuredText. In XML and DITA it is the first child of an element with
   a `<title>`, or a statement placed just before that `<title>`.
   - **Scope.** It covers the whole section, down to the next heading of the
     same or a higher level.
   - **Pin.** It pins the heading line only, or in XML the `<title>` element's
     lines. A section's facts go stale when its title changes. Verification
     belongs on the blocks it verifies.
   - **`graph`.** Only a heading statement may set `graph`. It validates
     against `$defs/sectionMetadata` in `manni:graph:1.0.0`, the shape a
     `graph.sections` entry takes. A block statement that sets it is refused.
   - **One spelling per section.** A field set for one section by both a
     heading statement and `graph.sections` is an error naming both lines.

5. **The pin is the anchored lines' hash, by the citations hashing rule.** The
   lines are joined with LF, one byte-order mark is dropped, CRLF becomes LF,
   and there is no trailing LF. The pin is written `sha256-<64 hex>`. It is
   the same mechanism at every end, and `pinOf` exports it so a writer in Node
   computes the same value.

   A statement can sit inside the lines it anchors. It may share a line with
   its text, or be an element's first child on the start tag's line. Its own
   text is then cut out of that line before hashing, so writing the pin never
   changes what the pin covers. Every other line is hashed as it is. A writer
   makes the same cut.

6. **The pin is optional, and its absence is visible.** An unpinned statement
   is a notice. A pinned one whose block changed is a warning. `meta derive`
   pins every unpinned statement that anchors something, and never rewrites a
   pin that differs. Removing the token and running `derive` is how a person
   accepts an edit. A verifying tool re-pins on its next pass.

7. **The payload is one JSON object.** One syntax keeps every writer and
   reader in agreement. Doc Detective's XML-attribute and YAML fallbacks are
   not carried over. A line comment form ends at `)`, so a payload holding one
   must use `<!-- -->` or `{/* */}`.

8. **Fields validate against the page's own schemas.** There is no new
   vocabulary. Each field is checked alone against the schema set that
   already resolves for the page.
   - A key no schema in that set defines is refused. It is a typo, or a field
     the repository has not adopted.
   - A value checks against its own definition, so `last-verified` means the
     same in a statement as in front matter.
   - `required` does not apply. A statement describes part of a page, so it
     never needs a `title`.
   - A field marked `x-manni-location: external` is refused. By 0047's rule it
     lives in the manifest.

   An override that adds a vocabulary reaches statements the same way.

9. **No new verbs.** `meta validate` reads statements wherever it reads a
   page. `meta derive` pins them, and `meta get` shows them. `cite`, `lint`
   and `term` ignore them. `graph build` reads them through meta's
   extraction.

10. **Statements are not front matter.** They never merge into the page's
    metadata, and page schemas never see them. `meta get` lists them apart,
    and `--fields` selects page fields only.

11. **cite markers are unchanged.** A `cite` marker carries ids, and its data
    lives in a manifest. A `meta` statement carries its data inline. A small
    fact about one block goes in a statement. Bookkeeping, or anything large,
    goes in a manifest.

12. **Statements need no git.** A pin hashes the file's own lines, never a
    commit. No statement finding depends on git, so each one is fixed by
    editing the file or by running `derive`. `meta derive` now runs outside
    any git repository. Its git-derived fields go unanswered, with one notice
    line, `git: no git repository contains the documents`, and it still pins
    statements.

13. **The graph carries statements.**
    - A heading statement's fields go onto its section node. Its `graph`
      field goes through the code `graph.sections` uses, and its other fields
      through the mapping the document node uses. A section node carries only
      what was said about it, as ADR 01013 requires. A query walks
      `dcterms:isPartOf` upward for the inherited view.
    - That mapping is the document's front-matter mapping, field for field:
      title, description, authors, dates, language, sample questions, tags,
      concepts, typing, `translation-of`, `supersedes`, `provenance` and
      verification. A section keeps its heading as its title, so a heading
      statement's `title` derives nothing. A statement's language is its own
      `lang`, never the page's, though its labels are read in the page's
      language when it sets none. A broken `translation-of` or `supersedes`
      target is flagged on the page.
    - Every statement triple comes from the `sections` derive source. A
      config that leaves `sections` out of `graph.derive` drops them all. The
      `frontmatter`, `tags` and `provenance` sources gate their fields at
      every level, as they do for the document.
    - Each block statement mints a `graph:Block` node,
      `<docIri>#<sectionSlug>.<n>`, where `n` counts statements within the
      section from 1. Before the first heading the slug is empty. Its section
      points to it with `dcterms:hasPart`.
    - A block node carries `graph:lines`, `graph:pin` when pinned, and
      `graph:pinStatus`, as `meta validate` computes it. Its fields go through
      the same mapping as the other levels.
    - Documents, sections and blocks share `graph:lastVerified` and
      `graph:verifiedBy`. Each entry is a `graph:Verification` with
      `graph:tool`, `graph:check`, `graph:version` and `graph:passed`.
    - Block nodes are graph data, not retrieval passages. Chunks stay one per
      section, and traversal never steps into a block.
    - `ns/graph/ns-1.3.0.ttl` adds the terms, and `shapes/graph/shapes-1.2.0.ttl`
      adds their shapes. Earlier versions stay immutable.
    - `verified-by` loses `x-manni-graph-output: false`, so a published graph
      carries it beside `last-verified`.

## What the user sees

`meta validate` reports each statement finding under the rule id
`manni:meta/<rule>`. Each one carries 0089's guidance, and its guide is the
new set-up page. Only an error moves the exit code to `1`.

| Rule | Severity | Message, for a statement at line 52 |
|---|---|---|
| `statement-invalid` | error | `the meta statement at line 52 is not one JSON object: <the JSON parser's reason>.` |
| `statement-unknown-field` | error | `the meta statement at line 52 sets "verifed-by", which none of this page's schemas define.` |
| `statement-external-field` | error | `the meta statement at line 52 sets "personas", which lives in the manifest (x-manni-location: external); set it there.` |
| `statement-orphan` | error | `the meta statement at line 52 anchors nothing: no paragraph or block follows it.` |
| `statement-orphan`, XML and DITA | error | `the meta statement at line 52 anchors nothing: no element follows it, and it is not an element's first child.` |
| `statement-misplaced` | warning | `the meta statement at line 52 sits inside a paragraph; move it above the paragraph's first line.` |
| `statement-changed` | warning | `the block under the meta statement at line 52 changed since it was pinned, so its last-verified may no longer hold. Run its checks again, or remove the pin and run manni meta derive.` |
| `statement-unpinned` | notice | `the meta statement at line 52 has no pin; run manni meta derive to pin it to the block below.` |
| `statement-line-form-paren` | error | `the meta statement at line 52 uses a line comment form, and its payload contains ")"; use <!-- --> or {/* */}.` |
| `statement-graph-not-section` | error | `the meta statement at line 52 sets "graph", which only a statement on a heading may set; move it above the section's heading.` |
| `statement-conflicts-sections` | error | `the statement on heading "Install on Windows" (line 30) and graph.sections.install-on-windows (line 6) both set graph.type; keep one.` |
| `statement-xml-comment-dashes` | error | `the meta statement at line 52 is an XML comment, and its payload contains "--", which XML forbids in a comment; use <?manni meta …?>.` |

The `statement-changed` clause about `last-verified` appears only when the
statement sets it. A value its schema refuses is an ordinary schema finding,
marked `(line 52, statement)`. In JSON each statement finding carries
`statement: { line, anchor }`, and `anchor` is `null` on an orphan.

`meta derive` prints `pinned 10 statements in 1 page.` above its usual
footer. Under `--check`, each unpinned statement is a `statement-unpinned`
finding and the run exits `1`. Its JSON summary gains
`statements: { pinned, pages }` when it pinned any.

`meta get -f json` gains `statements` per page when the page has any. Each
entry has `line`, `anchor`, `scope` (`block` or `section`), `section`, `pin`
when pinned, `status` (`current`, `changed` or `unpinned`) and `data`. `data`
is `null` when the payload is not one JSON object. Pretty output prints one
line per statement under the page's fields.

## Settled questions

1. **No field is barred from a statement for being page-only.** A statement
   that sets `title` on a paragraph is odd and harmless, and it validates. An
   annotation marking fields page-only can follow if one causes confusion.
2. **`applies-to` in a block statement does not narrow retrieval yet.** The
   served record carries it, so an agent can filter. A runtime filter by block
   is a retrieval change to make on evidence.
3. **Citations stay out of statements.** 0056 and 0058 keep a pin's
   bookkeeping out of the prose on purpose. A statement pins only the block it
   sits on, never another file.
4. **cite markers in XML and DITA keep their line rule.** They share the
   multi-line `<step>` blind spot. Moving them changes existing pins' anchors,
   so it needs its own proposal superseding 0054 and a re-pin story.
5. **`graph.sections` stays.** Both spellings work, a conflict is an error,
   and the docs lead with the heading statement. Retiring the front matter
   form is a breaking change with its own proposal.
6. **`lookup` takes no filter.** Its contract is the question alone. A caller
   who needs a filter has `retrieve`.
7. **No YAML flow syntax.** One syntax keeps every writer and reader in
   agreement. Most statements are written by tools, and hand-written ones are
   short.

## Carried by the served graph

Two decisions amend the proposal that serves the graph to agents. That work
carries them when it lands.

- **A chunk carries its section's effective metadata.** A chunk row's
  `metadata` is the page's delivered fields, overlaid by each heading
  statement from the page down to the section. The nearest wins, field by
  field. `graph retrieve --where <field>=<value>` filters on it. It is
  repeatable, one condition per occurrence, and conditions combine with AND.
  A filtered-out node is traced under `trace.filtered`, never dropped
  silently.
- **A record without git is normal.** `commit` and `worktree` are `null`,
  and pins are still classified by hash. The git-derived dates have
  `day: null`, while `lastVerified` and `verifiedBy` come from the page.
  The record carries `statements` per passage, for those whose anchored lines
  fall inside it.

## Consequences

- One grammar serves every writer. Doc Detective replaces its own inline
  `verified` marker with a `meta` statement, and records that in its ADR
  01140. On a pass it fills its `verified-by` entry, sets `last-verified`,
  pins the block, and keeps the comment form. It writes nothing on a failure.
- The interop guide gains rule 11, and its worked example becomes a
  statement.
- A section can be typed on its heading, so a page's per-section typing sits
  beside the section it types.
- Five deviations from the plan, each accepted in review:
  - Each `graph:Verification` node gets an IRI, the subject's IRI with
    `/verified-by/<n>` added to its fragment. The plan said blank node, and
    the graph tool forbids blank nodes.
  - DITA's `<step>` content model refuses `<data>`, and DITA-OT reports
    DOTJ088E. The `<data>` carrier goes first in `<cmd>` instead, and
    anchors that `<cmd>`.
  - A statement inside the lines it anchors is cut out of its line before
    hashing. Otherwise writing its own pin would change what the pin covers.
  - A section's type is a `graph.type` value such as `task`. The plan's
    `iirds:Task` fails the schema's enum.
  - `meta derive` used to stop outside a git repository. It now pins
    statements there, and prints one notice for the git fields it leaves
    unanswered.

## Stress test

1. **A step is reworded after it passed.** The pin no longer matches, so
   `validate` warns `statement-changed`, and says that `last-verified` may no
   longer hold. The next passing run re-pins it.
2. **A statement sits on a multi-line `<step>`.** As its first child it
   anchors the whole step. An edit to the `<cmd>` inside changes the pin.
   Under cite's line rule it would not have.
3. **A statement sets a field the repository has not adopted.** It is
   `statement-unknown-field`, not a silent pass. A typo such as `verifed-by`
   fails the same way.
4. **A statement sets `personas`.** The field is `external`, so it belongs in
   the manifest and the statement is refused.
5. **A statement with `)` in a line form.** `[comment]: # (meta …)` ends at
   the first `)`, so the payload would be cut short. It is refused, and the
   message names the two block forms.
6. **The last line of a page is a statement.** It anchors nothing, and
   `statement-orphan` says so. `derive` never pins it.
7. **A heading statement and `graph.sections` both type one section.** The
   two would disagree silently on the next edit, so one run names both lines.
