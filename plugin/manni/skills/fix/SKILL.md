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

A shape failed. The finding names the node and the property. Fix the frontmatter, the link or the heading it points at.

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
