# Critical User Journeys (CUJs)

A CUJ is a complete, end-to-end outcome a persona must be able to reach using manni meta and its documentation. The CUJs are the organizing principle for the IA. Each top-level nav section maps to one persona's set of journeys, and every page is justified by the CUJ it serves.

See `information-architecture.md` for the page-level content set and which pages carry each CUJ.

---

## Maya, Docs Engineer

### M1 · Stand up metadata validation for my repo

Maya needs to go from zero to a working CI gate. She evaluates whether manni meta fits her use case, installs it, then validates one file and reads the output. She adds a config file and a schema, and lands a passing CI step.

This is the anchor CUJ. It is the first thing the lead persona does, and it threads through install, config, schema, and CI in a single coherent journey.

On an existing docset the journey does not end at a green gate: the pages that predate the standard still lack the fields. `fill` covers that last stretch, which is where adoption otherwise stalls. It belongs at the end of the retrofit journey, after the ratchet, never as the entry point.

### M2 · Tighten the standard without breaking the build

Maya wants to add a new required field, or make an existing optional field required. She needs to do it without immediately failing every existing doc that doesn't have it yet. So she adds the field incrementally, stages the rollout across a large repo, and ratchets up strictness over time.

### M3 · Apply different rules to different areas

Maya's repo has heterogeneous content: `/api` docs need a `type: api-reference` field; `/guides` have different required fields. She needs to assign different schemas to different directory subtrees via config overrides, understand glob precedence, and handle a file that matches multiple schemas.

### M4 · Retrofit a docset that never had metadata, without breaking our data policy

Maya's older pages predate the standard, so the fields her gate now requires are missing from most of them. `fill` is what closes that backlog, and it is the only command that sends her documents to a third party. She needs to know what leaves on each call, how much of each document goes, and what the cache keeps afterwards. Then she pins a provider she chose, or keeps inference on her own hardware.

### M5 · Pin a claim and catch it going stale

**Outcome.** A sentence on one of Maya's pages rests on one line of code. She finds out when that line changes, before a reader does. The finding names the sentence, not the page.

**Steps.** The package is the one she already has. She runs `manni cite add <page> <path:line> --claim "…"` and the tool writes a `citations` entry (source range, hash, commit) plus a reference statement above the sentence. `manni cite check` on every push classifies each entry as `current`, `moved` or `changed`, from git alone, with no model and no network. When the source gains lines above the cited one, `manni cite update` rewrites the range. When the cited line itself changes, she reads the diff with `--show-diff` and decides whether the prose or the pin is wrong. Then she fixes the sentence and re-mints with `manni cite update --accept`. Once the frontmatter channel is familiar, she cites inline with `--inline`, in the format's comment syntax, and pins a fenced code block with `--quote`. Where the docs are public and the code is not, the family encryption key makes `add` write each source path encrypted. The page then cites the private file without naming it.

**What success looks like.** A `moved` is a warning, exit `0`, and one `update` clears it. A `changed` is a red check pointing at the line of the sentence, with the commits since. Nothing on the page has to be re-read that did not stop being true.

---

## Devin, Platform / CI Engineer

### D1 · Add the gate to our CI platform

Devin needs working recipes for every CI system his org uses: GitHub Actions, GitLab CI, Jenkins, and pre-commit. He also needs the exit-code contract documented precisely (0/1/2) and to understand the `--format github` inline annotation output for PR review.

### D2 · Govern one schema across many repos

Devin wants a single canonical schema stored in a central repo and referenced by URL from every consuming repo. He needs to understand how manni meta fetches remote `$schema` URIs, the 10-second fetch timeout, and per-run caching behavior. He also needs to know how to version the URL so consumers pin a stable release.

### D3 · Feed results into our tooling

Devin needs programmatic access to validation output. `--format json` gives him machine-readable results. The `get` command extracts metadata values from files in scripts, and the TypeScript API serves teams building tools on top of manni meta.

### D4 · Enforce rules that span files

Per-file schema validation cannot see a dangling cross-reference, a duplicate slug, or a taxonomy drifting across the corpus. Devin needs to phrase those rules as SQL over the metadata table `manni meta query` builds, one row per file. He then wires `--check` in beside the validate gate, where rows are findings and the exit code is 1. The same journey covers feeding that table onward, through `-f json` and the `--db` SQLite export. It also covers knowing the write surface exists: a mutating statement applies by default, `--dry-run` previews, and `--check` never mutates. This page does not become the write surface's manual, because the CLI reference owns the vocabulary.

### D5 · Gate citations in CI without blocking on prose

**Outcome.** Every pull request reports which cited sentences its source changes made stale, as annotations on the sentence line. A citation that went stale in a commit that touched no page does not block an unrelated PR.

**Steps.** Devin adds `manni cite check` beside the metadata gate. He picks the output his tooling reads: `-f github` for inline PR annotations, `-f sarif` for code scanning, `-f junit` for the test tab. He learns the contract: exit `0` clean, `1` an error-severity finding, `2` operational; `moved` and `claim-ambiguous` are warnings and never fail the job. He sets `fetch-depth: 0` on the checkout, because a shallow clone cannot show the file at the commit a pin was minted at. Without it, `never-true` and the diff degrade to a notice. For the ramp-in he runs the PR job with `--baseline`, report-only, and a scheduled sweep without it that fails. Where the docs are public and the code is not, the public job runs `--no-check-sources`. The private job runs from the docs checkout with `--root ../code`, and reads the family encryption key, `MANNI_ENCRYPTION_KEY`, from a secret.

**What success looks like.** A source change that makes a sentence stale annotates that sentence in the PR. A pin that drifted elsewhere shows up in the sweep, not in someone else's PR. No path from the private repo appears in any public log or SARIF upload.

---

## Sara, Schema Author

### S1 · Define our metadata standard as a schema

Sara needs to encode her metadata standard as a JSON Schema. That means defining required and recommended fields, and specifying value formats such as `uri`, `date-time`, and enum. She also needs to understand what the built-in OKF schema already provides, so she can start from it or deviate deliberately.

### S2 · Wire schemas to the right documents

Sara needs to understand how manni meta resolves which schema(s) apply to any given file. The full precedence chain: CLI `--schema` flag → file `$schema` field → config `overrides` → config `schemas` → built-in default. She also needs to know the three ref kinds: builtin, file path, and URL.

### S3 · Version and evolve the schema safely

Sara needs to ship a stricter version of the schema without immediately breaking CI in every consuming repo. She needs to understand: JSON Schema dialects (2020-12 through draft-04), manni meta's dialect detection, the versioning policy, and a migration path for consumers.

---

## Theo, Contributor

### T1 · Fix a failing metadata check fast

Theo lands on the docs via a red CI check or a search. He needs a clear map from the error message to the specific field or line in his file. He needs remediation steps for the most common failures. Those are a missing `type`, a bad `date-time` format, a schema not found, and a parse error. He also needs a way to validate locally before re-pushing, and confirmation that the fix worked.

This is the highest-traffic page in the docs. Every contributor who hits a failing check arrives here. It is cross-cutting: the same page serves regardless of which persona configured manni meta.

Theo's failure is usually a *missing* field rather than a malformed one, so `fill` is a genuine shortcut for him. Lead with `--dry-run`; he is fixing someone else's repo and needs to see the proposal before it lands in his PR.

### T2 · Read a citation failure and fix it

**Outcome.** Theo's PR carries a `manni:cite/changed` annotation on a sentence he may not have written, and he gets the check green without learning how citations work.

**Steps.** He reads the one line: a mark, a label, the source range, a status, and the line of the sentence. He finds the status on the fix page. `moved` is a warning and `manni cite update` clears it. `changed` means the cited line is not what it was. `--show-diff` shows him the commits since, he fixes the sentence or confirms it, then `manni cite update --accept` re-mints the pin. `missing` means the file is gone or renamed and the citation has to be added again. On an encrypted source, `missing` says why: no key, the wrong key, or the wrong `--root`. The page-side statuses (`claim-missing`, `statement-orphan`, `entry-invalid` and the rest) are typos in the page, and each says what to change. He reproduces locally with `npx @hawkeyexl/manni cite check <page>`, sees green, and pushes.

**What success looks like.** One status, one action, one re-run. He never has to know what a pin is.
