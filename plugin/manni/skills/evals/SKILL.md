---
name: evals
description: Author evals for docs pages or for agent artifacts such as CLAUDE.md, skills and subagents. Use when asked to add, propose or promote evals.
allowed-tools: Bash(npx manni *), Bash(npx --no @hawkeyexl/manni *)
---

# Author evals

Evals declare what a page or an agent artifact must satisfy. Propose them, show the diff, and let the user review.

## Pages

1. Run `npx --no @hawkeyexl/manni docevals list` to see the evals each page resolves.
2. Run `manni docevals fill <path>` to have the model propose frontmatter evals. It writes only proposals above the confidence threshold.
3. Run `manni docevals generate <path>` to write check scripts for command evals that have an assertion but no command.
4. Run `manni docevals promote` to find model-graded evals that a deterministic check can express. Add `--write` to convert them.
5. Run `manni docevals run --deterministic-only` to confirm the new evals pass.

## Agent artifacts

Run `manni tracevals fill <path>` over a skill, a subagent definition or a rules file. It proposes evals in the artifact's `metadata.evals` block.
`manni tracevals list` shows what the evals cover.

## Review

Show the user `git diff` of every file an authoring command wrote.
Do not weaken an assertion so that a page passes. A new eval should fail on the defect it describes.
