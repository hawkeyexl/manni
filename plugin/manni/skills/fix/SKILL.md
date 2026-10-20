---
name: fix
description: Repair manni findings in docs. Use after manni check or a hook reports errors in metadata, citations, terms, structure, evals or the graph.
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

The finding names a field path, such as `/description`. Edit the page frontmatter so the field is present and valid.

Some fields are managed. Stamp them from history with `node "${CLAUDE_PLUGIN_ROOT}/hooks/manni.mjs" meta derive <path>`. Add `--check` to see which are stale without writing.
Do not hand-edit a managed field. `derive` writes it.

## cite check

Each finding has a rule id.

| Rule | Repair |
|---|---|
| `source-moved` | The cited lines moved. Run `manni cite update <path>`. |
| `claim-moved`, `claim-reanchored` | The sentence moved. Run `manni cite update <path>`. |
| `source-changed` | The cited source changed since the pin. Read the lines at the current commit. If the sentence is still true, run `manni cite update --accept --only <id> <path>`. If it is not, rewrite the sentence first, then accept. |
| `source-never-true`, `source-missing`, `source-moved-ambiguous` | Open the source and find the lines the sentence rests on. Fix the pin or the sentence. |
| `marker-orphan`, `marker-invalid`, `anchor-invalid`, `entry-invalid` | Fix the marker or the entry the finding names. |

Preview any rewrite with `--dry-run`. It prints the diffs and writes nothing.

## term check

The glossary and the `concepts:` pages disagree. Fix the term page or the concept name.
After you change a term page, run `manni term write` to regenerate any rendered output the repository commits. Add `--check` to see whether it is stale.

## lint check

Each structure finding names its template and rule, says what that section is for, and links the guide. Read those lines before editing.
Run `manni lint templates show <template>` to see the whole shape in order.
Write what the section asks for. Never add a heading, table or list only to satisfy a count.
Run `manni lint structure <path> --explain` only when the template looks wrong for the page. Change the page `type` only if the routing is wrong.

## docevals run

An eval failed. Read the eval assertion and the evidence it cites. Fix the page so the assertion holds.
Do not edit the eval to pass. To change an eval on purpose, use the `evals` skill.

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
