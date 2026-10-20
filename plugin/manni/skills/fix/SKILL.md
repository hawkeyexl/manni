---
name: fix
description: Repair manni findings in docs. Use after manni check or a hook reports errors in metadata, citations, terms, structure, evals or the graph, or after manni a11y check or manni test run fails.
allowed-tools: Bash(npx manni *), Bash(node "${CLAUDE_PLUGIN_ROOT}/hooks/manni.mjs" *)
---

# Repair manni findings

Start from the report of `node "${CLAUDE_PLUGIN_ROOT}/hooks/manni.mjs" check`. Each section names the check. Match it to a repair below.

## Guardrails

- Never loosen a schema, a config key or an eval to make a check pass. Fix the page.
- Never run `manni cite update --accept` before you read the changed source lines.
- Run `manni check` after every repair. A fix in one domain can break another.
- If a finding is wrong, stop and tell the user why. Do not hide it.

## meta validate

Each finding names a field path, such as `/description`, and its schema in brackets. A dim line under it names the schema and the property, and says what the property is for. A `Guide:` line links the schema's page when it has one. Read both lines before you edit.
Run `manni meta schemas show <schema>` to see every property, which are required, and what each accepts.
Edit the page frontmatter so the field is present and holds a value the message allows. `must be one of:` lists every value that passes.
Never edit a schema or the config to make a finding pass. Never change a page's `$schema` to escape a finding about a field.
A finding about `$schema` itself means the page names a schema this repository does not accept. Use an id `manni meta schemas` lists, or remove `$schema`.

Some fields are managed. Stamp them from history with `node "${CLAUDE_PLUGIN_ROOT}/hooks/manni.mjs" meta derive <path>`. Add `--check` to see which are stale without writing.
Do not hand-edit a managed field. `derive` writes it.

## cite check

Each finding ends with what to do. Under it, the report names the rule, says what it means and links its guide. Read those lines before you edit.

| Rule | Repair |
|---|---|
| `source-moved`, `claim-moved`, `claim-reanchored`, `marker-misplaced` | Run `manni cite update <path>`. |
| `source-changed`, `source-never-true`, `claim-changed` | Read the source with `manni cite check --show-diff <path>`. Rewrite the sentence if it no longer holds. Then run `manni cite update --accept --only <id> <path>`. |
| `source-moved-ambiguous` | Widen `source.lines` until the range occurs once, then run `manni cite update --accept --only <id> <path>`. |
| `claim-moved-ambiguous` | Re-add the citation over a range that occurs once, or with `--marker`. |
| `source-missing` | Find where the lines live now. Run `manni cite remove --only <id> <path>`, then `manni cite add` against the new path. If the message names a key or `--root`, stop and tell the user. |
| `marker-orphan`, `marker-invalid`, `marker-repeated`, `anchor-invalid`, `entry-invalid`, `quote-drift` | Do what the message says to the marker, entry or block it names. |

Never edit `integrity` or `commit-sha` by hand. `update` writes them. Change `source.lines` only to widen an ambiguous range. Preview any rewrite with `--dry-run`.

## term check and term lint

Each finding names the field and the value, then says what to do. Under it, the report names the rule, says what it means and links the rules page. A `prose/` finding links Vale's own rule page when Vale gives one. Read those lines before you edit.

| Rule | Repair |
|---|---|
| `undefined-term`, `dangling-reference` | Use the name the message suggests, or fix the typo. If the value names a new concept, ask the user before adding a term. |
| `alt-label-reference` | Write the label the message names. |
| `duplicate-id`, `label-collision`, `alt-label-collision`, `ambiguous-alt-label` | Two entries claim one name. Ask the user which keeps it before you rename or merge. |
| `asymmetric-hierarchy`, `asymmetric-related` | Add the missing value on the entry the finding sits on. |
| `broader-cycle` | Remove the one `broader` value that is wrong. Ask if you cannot tell which. |
| `missing-definition` | Run `manni term fill <path>`. It records the draft for review. |
| Any other error or warning | Do what the message says on the field it names. |
| A notice | Notices never fail. Fix one only when the user asks. |
| `prose/<Style.Rule>` | Rewrite the sentence. Never add a Vale exception. |

Never delete a term, a label or an alt-label, and never set a rule `off`, to make a finding go away. After you change a term page, run `manni term write`. Add `--check` to see whether the committed output is stale.

## lint check

Each structure finding names its template and rule, says what that section is for, and links the guide. Read those lines before editing.
Run `manni lint templates show <template>` to see the whole shape in order.
Write what the section asks for. Never add a heading, table or list only to satisfy a count.
Run `manni lint structure <path> --explain` only when the template looks wrong for the page. Change the page `type` only if the routing is wrong.

## docevals run

Each failing eval prints its finding, then what the eval asks for, then a guide link. Read all three before you edit.

- A finding with a line comes from a script check. Change that line as the message says.
- `AI judge: fail` prints what the judge observed and why. Edit the page so the assertion holds.
- `AI judge: no confident verdict` is not yours to settle. Tell the user. They run `manni docevals review` or `manni docevals calibrate`.
- An eval that cannot run, or an assertion no page could meet, is a broken eval. Stop and tell the user which eval and why.

Run `manni docevals list <path> --eval <name>` to see one eval in full.
Never edit an eval to pass. To change one on purpose, use the `evals` skill.

## tracevals

The Stop hook reports the rules your last turn broke. Each entry names the source file, the rule and its text, then what the judge observed.

- Redo the work so the rule holds. Or say in your reply why the rule does not apply to this turn.
- Never edit `CLAUDE.md`, a skill or another rule source to make the check pass.
- An entry marked `?` needs review and never blocks. Mention it to the user.
- The hook blocks once. If rules stay broken, tell the user to run `manni tracevals check <trace>`.

A `manni tracevals run` failure names the artifact, the eval and its assertion.

- A finding or `AI judge: fail` means the session broke the eval. Redo the work, or report it to the user.
- An eval no session could meet is a defect in the artifact. Tell its owner. Do not edit the eval.
- ERROR means the eval itself broke. REVIEW and SKIP are not failures of the work.

## graph check

Each finding names the pages behind it first. Edit one of those pages, never the graph or the shapes.
The lines under the finding name the shape that judged it, say what that property is for, and link the guide. Read them before editing.
Run `manni graph shapes show <shape>` to see every property a shape checks and the frontmatter key that feeds it.

| The finding says | Repair |
|---|---|
| set `lang` to a language tag | Write a tag such as `de` or `pt-BR`. |
| lists a variant or an aspect in both lists | Decide which is true for that page or section. Delete the value from the other list. |
| spell this concept or variant two ways | Use the glossary's spelling, or the most common one, on every page it names. |
| form a broader cycle | Remove the one `broader` or `narrower` value that is wrong, usually the newest. |
| related to a broader concept or an ancestor | Remove either the related link or the hierarchy link, not both. |
| names a concept in this glossary | Move the value from the `*-matches` key to `broader`, `narrower` or `related-terms`. |
| `meta-provenance` credits a model | Stop and tell the user. Deleting the entry signs off the value, and that is their call. |
| a property this shape does not list | Stop. The page is not at fault. Tell the user the shapes need updating. |
| a sample question does not find its page | Make the page answer the question in the words a reader uses. Never reword the question only to pass. |

Run `manni check`. It rebuilds the graph before it checks.

## a11y check

`manni check` does not run this. Start from a report the user gives you, or run `manni a11y check <url>` against a site the user serves.
Each finding names the axe rule, the element and what to change. Its last lines link the rule's guide. Read them before editing.
Fix the element in the page or in the layout that renders it. When one element fails on several pages, fix the shared template.
Never invent alt text, a label or a name the page does not justify. Ask the user for the words.
Rebuild the site and run the same command again until it exits `0`.

## test run

`manni check` does not run this. Do not run `manni test run` unless the user asks, because it runs the shell steps in the pages.
Each failure names the page, the step's line and what the step expected. Its last lines name the action and link its guide.
Decide whether the step, the procedure it documents, or the product is wrong. Change the step and its prose together.
If the product regressed, stop and tell the user. Never change an expectation only to match broken output.
