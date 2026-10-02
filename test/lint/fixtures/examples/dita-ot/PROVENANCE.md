# DITA-OT documentation, vendored

Real DITA, so `manni lint structure` is exercised against a shipping docset
rather than against fixtures written to pass. It is the corpus that caught the
`<glossref>` gap in the map vocabulary before any of it was implemented.

| | |
|---|---|
| Source | <https://github.com/dita-ot/docs> |
| Branch | `develop` |
| Commit | `ac13c45fbd04afe9bb0800d8ade51e217386dc75` |
| Date | 2026-08-21 |
| Licence | Apache-2.0, in `LICENSE.md` beside this file |

## Vendored verbatim

Not rewritten, reformatted or trimmed, under the same standing rule the rest of
`test/lint/fixtures/` carries. A fixture edited to pass proves nothing about the
documents this tool is pointed at. Refresh by re-fetching at a newer commit and
updating the table above, never by hand.

## What each file is here for

| Path | What it exercises |
|---|---|
| `reference/glossary.ditamap` | `<glossref>`, a `topicref` specialization. Thirteen entries that are skipped entirely by any vocabulary listing only `topicref`. |
| `reference/gloss-*.dita` | `<glossentry>` topics, the targets of that map. Thirteen files, the smallest real topics in the docset. |
| `resources/common-toc.ditamap` | Every entry titled by `keyref` alone, with no `navtitle` anywhere. The case that must parse to untitled sections rather than failing. Also `<topicgroup processing-role="resource-only">` and a title holding `<keyword keyref="release"/>`, a key reference with no text of its own. |
| `resources/reltable.ditamap` | A real `<reltable>` of `<relrow>`/`<relcell>`/`<topicref>`. Proves the skip decision: none of its topicrefs may appear as sections. |
| `topics/intro.ditamap` | Nested `topicref`s and `<mapref>` children. |
| `topics/installing.ditamap` | `@keys` with a `<topicmeta><navtitle>`, plus `<ditavalref>`/`<ditavalmeta>`, which are filtering rather than navigation and must be skipped. |

## Scope

This is a **subset**, so cross-document references leave the vendored tree:
`common-toc.ditamap` maprefs seven maps that are not here, and
`installing.ditamap` names `using-dita-command.dita` and
`../resources/novice.ditaval`, neither of which is here.

That is fine for what the corpus is for. `manni`'s engine parses each file on its
own and resolves nothing across files, so the dangling references cost nothing
and the corpus reports the shape of every map truthfully.

It does mean **this tree is not a valid DITA-OT build input** and must not be
used as one. A `dita-ot` run over it would report the missing targets, which says
something about this subset and nothing about the tool. The end-to-end check
against DITA-OT uses the synthetic maps in `test/lint/fixtures/dita-ot/`, whose
references all resolve, and a full clone when a real corpus is wanted.
