# Personas

Four concrete personas, one per audience. Each writing task should be anchored to the persona(s) it serves. See `cujs.md` for the end-to-end journeys each persona must complete.

---

## Maya, Documentation Engineer (LEAD persona)

Maya owns a 2,000-page docs-as-code repo for a platform product. She is comfortable with Markdown, YAML, Git, and reading a CI config. She is not a JSON Schema expert.

**Goal:** every doc has correct, complete frontmatter so the search index and the content catalog stay trustworthy.

**Pains:**
- Contributors omit required fields like `type`.
- Values are fat-fingered, with `date-time` formatted incorrectly or enum values misspelled.
- Metadata drifts as the team grows, and she has no enforcement mechanism. All she has is review fatigue.

**How she uses manni meta.** She installs it, writes or adopts a schema, adds a CI step, then mostly operates it hands-off. She returns when the standard needs tightening.

**Which tools she owns work in.** She owns work in meta, cite, a11y and docevals. She stands up the metadata gate, pins claims on her pages and checks the published site. She also holds pages to the quality bar her team wrote down.

**What docevals adds to her job.** The rules that matter most on her pages cannot be written as lint rules or schemas. Two examples are "this page promises nothing unshipped" and "it says why before how". docevals is where she encodes them, as named assertions in config that pages and suites reference. Her constraint there is explicability. She will be asked why a build is red, and "a model said so" ends the pilot. So she reaches for `command` and `tool:*` graders first and treats an `ai` eval as the last resort. She also wants the linters already in her pipeline (Vale, markdownlint, meta itself) reporting through one gate with one output format.

She meets docevals in two situations that change the journey, not the person:

- **When she is the only one writing the docs**, alongside another job. She reads `--help` before a guide and gives the tool ten minutes. The first run has to find something real on one of her own pages, with no provider key (`--deterministic-only`). Writing an assertion per page is arithmetically out of reach, so `fill` is the entry point rather than a convenience. She has to learn early that proposals are cached before the confidence gate, so re-gating costs nothing. Budgets are counted in inference calls, never dollars, and converting them is her provider's rate card.
- **When she is handed a corpus she did not write.** The first honest run on thousands of unmeasured pages fails nearly everything. The instinct it produces is to weaken the assertions until the build is green, and that destroys the standard for good. The inversion she needs is to keep the assertions honest, turn them on at `error`, and record today's findings in a committed baseline. CI then fails only on new findings, and the backlog is a number that falls. `fill` proposes and she triages, one directory at a time, because nobody can review a 3,000-page pull request. The first pass is the largest spend she will ever see, and it arrives before any value has shown.

The docevals strategy imported with the tool called these three situations Priya (the docs platform lead), Nate (the solo owner) and Iris (the retrofitter). They are the same job at different team sizes and corpus states, so they are Maya here.

**The one decision she is not equipped for.** `fill` is the only part of manni meta that sends her documents to a third party. Clearing the retrofit backlog (M4) therefore makes her choose a provider, or refuse hosted inference entirely and run it on her own hardware. She does not own her organization's data-egress policy, but she is the one who has to answer to it. And the default is detected from her environment rather than chosen.

**Why she is the lead persona.** She is the primary adopter. She touches installation, config, schema selection, and CI wiring, which is every layer of the stack. Her journey (M1) is the anchor.

---

## Devin, Platform / CI Engineer

Devin maintains CI/CD infrastructure for dozens of repos on a mix of GitHub Actions, GitLab CI, Jenkins, and pre-commit. He scripts everything and has high technical proficiency.

**Goal:** drop in a metadata gate that is identical everywhere, cheap to run, and feeds results into existing tooling without custom glue per repo.

**Pains:**
- Per-tool config sprawl: different CI recipe for every linter/checker.
- Needs stable, documented exit codes and machine-readable output (JSON, annotation format) so results flow into dashboards and PR bots without fragile parsing.
- Wants one canonical schema shared across repos rather than copies that drift.

**How he uses manni meta.** He installs via a CI step, sets flags, and plugs the exit code into a pipeline gate. He can also pass JSON output to a dashboard. He returns when a new CI platform is added or the output format changes.

**Which tools he owns work in.** He owns work in all five tools, and the key rotation runbook is his, so one pipeline gates metadata, citations, accessibility and evals.

**The two problems docevals gives him that no other tool does.** He installs and operates the eval gate and authors no evals.

- **A model is in the critical path.** It is slow, rate-limitable, nondeterministic and metered, which is four new failure modes for a CI step. He needs the ensemble, the response cache, `--max-turns` and `--deterministic-only` presented as operational controls. The cache has to survive between runs, or every push re-judges the corpus. `--max-turns` bounds uncached inference calls, not money, and a run that exhausts it skips the rest and still exits `0`. He is the persona most likely to set that number once and never look again, which is exactly who a silently thinner green run hurts.
- **Content files drive code execution, by two paths.** Frontmatter can declare commands (`execution.allow: [frontmatter-commands]`), and the `tool:doc-detective` grader runs steps embedded in page bodies (`page-embedded-steps`). The two grants are separate. No grant makes a run over a fork safe. So the job itself is gated to same-repo pull requests, and forks get a `--deterministic-only --no-execution` job with no secret. He will notice an unpinned third-party action in a recipe and stop trusting the page.

Exit `1` (findings, the author's problem) and exit `2` (operational, his) route to different people. A recipe that treats any non-zero exit as "the docs are bad" is wrong.

**The one command that breaks his model of the tool.** Every other part of manni meta reads files and stays on the box, so `fill` is the exception he has to make a call on. It is the one thing that transmits repo content off-site. Provider detection also means an unpinned runner picks one from whatever environment variable happens to be set. Failing that, it falls through to a multi-gigabyte local-model download on every fresh agent. He pins it in config rather than leaving it to the environment.

---

## Sara, Schema Author / Information Architect

Sara defines what the metadata *means*. That covers which fields are required and which are recommended, what value formats are acceptable, and the versioning policy for the standard. She has medium-to-high proficiency and understands data modeling, and she is actively learning JSON Schema's finer points.

**Goal:** encode the metadata standard as a JSON Schema, wire it to the right documents, and evolve it safely as requirements change.

**Pains:**
- Dialect confusion. The differences between draft-07 and 2020-12 trip her up.
- Precedence uncertainty. She isn't sure whether `$schema` in a file overrides the config, or the other way around.
- Shipping a stricter required field without breaking every existing repo overnight.

**How she uses manni meta.** She authors schemas, starting from the OKF built-in or from scratch. She wires them to directories via config overrides, tests resolution, and manages upgrades with versioned URLs.

**Which tools she owns work in.** She owns work in meta and key, and in the citation standard and the eval library. The required field, its encrypted value, its citations and the assertions a page is judged against are hers.

**The same instinct, in prose.** In docevals she encodes a prose quality standard as assertions rather than a metadata standard as JSON Schema. Three problems are hers there:

- **Most assertions people write are unjudgeable.** "The page is well-written" cannot be decided by anything. "The page states its prerequisites before the first command" can. `evidence` and `examples.pass` / `examples.fail` are the mechanism that closes that gap, not optional fields. The test is whether two reviewers reading the same page would reach the same verdict.
- **Proof.** A standard resting on trust does not survive a skeptical engineering org. She needs a golden set, `manni docevals calibrate`, the 70% agreement floor and the false-positive alert (`judge.falsePositiveAlert`) as artifacts to take into that conversation. She cares more about false positives than raw accuracy, because a check that fails good pages is disabled within a week.
- **Cost that grows with the corpus.** Left alone, every eval stays an `ai` eval. `promote` and `generate` are the discipline that moves them down the grader hierarchy, and applying it is hers.

Two reframes have to land for her. Binary verdicts are not crude, because the nuance lives in the suite pass rate (regression suites near 100%, capability suites near 70%). And the human-review zone is not a failure of the design, it is what makes a binary verdict acceptable. She usually owns the review queue too.

---

## Theo, Doc Contributor (high-volume, secondary)

Theo is a developer or technical writer who opened a PR. The manni meta check is red. He has low context on the tool and is not interested in learning it. He wants to fix the one thing blocking his PR.

**Goal:** understand the specific error, find the offending field and line in his file, fix it, confirm locally, and move on.

**Pains:**
- Error messages are terse with no obvious remediation hint.
- He doesn't know which schema fired or why that rule exists.
- He doesn't want to read the full documentation. He wants a targeted answer.

**How he uses manni meta.** He follows the error link, or searches, to reach the fix-it page. He maps the error to a field and file location, then applies the fix. He runs `npx @hawkeyexl/manni meta validate <file>` locally to confirm green, and he is done.

**Which tools he owns work in.** He owns work in none of them, and reaches meta, cite, a11y or docevals only to fix the check that turned his pull request red.

**A red eval is harder to read than a red schema check.** docevals produces at least five failures that look alike in a CI log and have unrelated remedies. There is a deterministic finding pinned to a line, and an AI verdict with a rationale and no line. There is an eval parked in human review, which he has no standing to resolve. There is a generated script that no longer matches its assertion, and an operational exit `2` that is not his fault at all. Triage is the first screen. A rationale is not a remediation, so he reads the assertion and its `examples.fail` beside it to find the sentence. Being told to escalate, and to whom, is a correct outcome. His laptop has neither CI's key nor its warm cache, so the local check is `manni docevals run --deterministic-only` on one file.

The eval fix page has no subject dependencies. It is reached cold from an annotation and must be fully useful to someone who has read nothing else. A change that gives it a prerequisite is a defect.
