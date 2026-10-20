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
