---
type: persona
id: devin
title: Devin, Platform / CI Engineer
description: Devin maintains CI/CD infrastructure for dozens of repos on a mix of GitHub Actions, GitLab CI, Jenkins, and pre-commit.
audience: ci-engineers
---

Devin maintains CI/CD infrastructure for dozens of repos on a mix of GitHub Actions, GitLab CI, Jenkins, and pre-commit. He scripts everything and has high technical proficiency.

**Goal:** drop in a metadata gate that is identical everywhere, cheap to run, and feeds results into existing tooling without custom glue per repo.

**Pains:**
- Per-tool config sprawl: different CI recipe for every linter/checker.
- Needs stable, documented exit codes and machine-readable output (JSON, annotation format) so results flow into dashboards and PR bots without fragile parsing.
- Wants one canonical schema shared across repos rather than copies that drift.

**How he uses manni meta.** He installs via a CI step, sets flags, and plugs the exit code into a pipeline gate. He can also pass JSON output to a dashboard. He returns when a new CI platform is added or the output format changes.

**Which tools he owns work in.** He owns work in every tool, and the key rotation runbook is his. So one pipeline gates metadata, structure, citations, accessibility, page evals and session evals.

**The two problems docevals gives him that no other tool does.** He installs and operates the eval gate and authors no evals.

- **A model is in the critical path.** It is slow, rate-limitable, nondeterministic and metered, which is four new failure modes for a CI step. He needs the ensemble, the response cache, `--max-turns` and `--deterministic-only` presented as operational controls. The cache has to survive between runs, or every push re-judges the corpus. `--max-turns` bounds uncached inference calls, not money, and a run that exhausts it skips the rest and still exits `0`. He is the persona most likely to set that number once and never look again, which is exactly who a silently thinner green run hurts.
- **Content files drive code execution, by one path.** Page frontmatter can declare `command` evals, which run only under `execution.allow: [frontmatter-commands]`. No grant makes a run over a fork safe. So the job itself is gated to same-repo pull requests, and forks get a `--deterministic-only --no-execution` job with no secret. He will notice an unpinned third-party action in a recipe and stop trusting the page.

Exit `1` (findings, the author's problem) and exit `2` (operational, his) route to different people. A recipe that treats any non-zero exit as "the docs are bad" is wrong.

**The one command that breaks his model of the tool.** Every other part of manni meta reads files and stays on the box, so `fill` is the exception he has to make a call on. It is the one thing that transmits repo content off-site. Provider detection also means an unpinned runner picks one from whatever environment variable happens to be set. Failing that, it falls through to a multi-gigabyte local-model download on every fresh agent. He pins it in config rather than leaving it to the environment.
