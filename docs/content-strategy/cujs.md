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

**Outcome.** A sentence on one of Maya's pages rests on a few lines of code. She finds out when either end changes, before a reader does. The finding names the sentence, not the page.

**Steps.** The package is the one she already has. She runs `manni cite add docs/limits.md:9 lib/limits.ts:2 --id fetch-timeout`, naming the page lines her sentence occupies and the source lines it rests on. The tool writes one entry with two ends. Each end is a line range and an integrity hash, and the source end also records the commit it was taken at. `manni cite check` on every push classifies both ends from git alone, with no model and no network. A `claim-moved` or a `source-moved` is repaired by `manni cite update`. A `source-changed` is read with `--show-diff`, and she decides whether the prose or the pin is wrong. Then `manni cite update --accept` re-pins what she accepted. Where she would rather see the citation in the page source, `--marker` writes one comment naming the entry. `--quote` pins a fenced block to the lines it reproduces. Where the docs are public and the code is not, the family encryption key makes `add` encrypt the source file. The page then cites a private file without naming it.

**What success looks like.** A `claim-moved` is a notice, exit `0`, and one `update` clears it. A `source-changed` is a red check pointing at the line of the sentence, with the commits since. Nothing on the page has to be re-read that did not stop being true.

---

### M6 · Keep citations out of the page

**Outcome.** Maya's pages carry prose, not bookkeeping. Every citation lives in one manifest her collection declares, and the check reads it as though the entries sat on the page.

**Steps.** She adds an `externalMetadata:` entry to the collection, with `keys: [citations]`, naming a file in the repository. She moves one page's `citations` block into that manifest, under the page's path. `manni cite check` finds it, because membership comes from every collection in the config, whatever the run selects. From then on `manni cite add` writes the manifest and leaves the page untouched, and `manni cite update` repairs the manifest in place, one value at a time. A finding about an entry names the manifest and the entry's own line. A finding about the sentence still names the page.

**What success looks like.** A reviewer reading the page sees prose alone. A page that still carries its own `citations:` is reported, so the two channels cannot drift apart.

---

### M7 · Make the published site pass its accessibility check

**Outcome.** The site Maya publishes carries no accessibility violation she could have caught before a reader met it.

**Steps.** She installs a browser once, then runs `manni a11y check` against her local build. The crawl stays on the host, starting from the sitemap where there is one. She reads the score, then the findings, each naming the axe rule, the element it fired on, and what to change. She fixes what her templates own, such as a missing document language or a link with no accessible name. She re-runs until the command exits `0`, and hands anything else to the team that owns the component.

**What success looks like.** A run she can repeat in a minute, a number she can watch move, and the same command in CI.

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

### D6 · Rotate the family key without breaking CI

**Outcome.** Devin replaces the encryption key across the whole family, and nothing fails on the next push.

**Steps.** He generates the new key and runs `manni key rotate`. It finds every value by its ciphertext, in pages and in the local manifests of the collections it covers. Each citation's source is rewritten together with its keyed pin. Nothing is written unless every value could be re-encrypted. The new key reaches the config before the first page, so an interrupted run finishes when he runs it again. He updates the CI secret to the new value and re-records the citation baseline. Then he verifies with `manni meta validate` and `manni cite check` under the new key. A narrowed run covers one area and never writes the key.

**What success looks like.** One command, one secret update, one green pipeline. Nothing in the repository still decrypts under the old key.

---

### D7 · Gate accessibility in CI

**Outcome.** Every pull request hears about an accessibility regression, and the live site is watched on a schedule.

**Steps.** For a pull request he builds the site, serves it, and waits for the port. Then he runs `manni a11y check` against it with `-f github`, so each violation is annotated on the diff. For the live site he schedules the same command against the public URL. He reads the exit code the way the family defines it, `0` clean, `1` violations, `2` something could not run. A crawl that takes too long is narrowed by the page limit and the scope in the `a11y:` config.

**What success looks like.** The same command locally and in CI, one annotation per violation, and no second tool to configure.

---

## Sara, Schema Author

### S1 · Define our metadata standard as a schema

Sara needs to encode her metadata standard as a JSON Schema. That means defining required and recommended fields, and specifying value formats such as `uri`, `date-time`, and enum. She also needs to understand what the built-in OKF schema already provides, so she can start from it or deviate deliberately.

### S2 · Wire schemas to the right documents

Sara needs to understand how manni meta resolves which schema(s) apply to any given file. The full precedence chain: CLI `--schema` flag → file `$schema` field → config `overrides` → config `schemas` → built-in default. She also needs to know the three ref kinds: builtin, file path, and URL.

### S3 · Version and evolve the schema safely

Sara needs to ship a stricter version of the schema without immediately breaking CI in every consuming repo. She needs to understand: JSON Schema dialects (2020-12 through draft-04), manni meta's dialect detection, the versioning policy, and a migration path for consumers.

---

### S4 · Require a field and keep its value private

**Outcome.** Sara's standard requires `owner` on every page, and no page publishes who the owner is.

**Steps.** She marks the property `x-manni-encrypt: true` in the schema. A page carrying a plain value then fails validation, and the finding names the property without printing it. Where a key is available, the tool decrypts the value first. It is then validated against the property's full schema, so an owner outside her enum still fails. Where no key is available, findings under that property are dropped and the run says how many values it could not verify. The writers follow the same rule, so `manni meta fill` and `manni meta query` write the value encrypted, and the model never sees it. A value a private manifest supplies is decrypted the same way.

**What success looks like.** A required field whose value CI checks, and whose plaintext nobody without the key can read.

---

### S5 · Make citations part of the standard

**Outcome.** Pages of a given kind have to cite their sources, and the rules say how strict that is.

**Steps.** She composes the citations vocabulary into the house schema, so an entry's shape is validated wherever it lives. She requires `citations` on the class of pages that need it, through the same override she uses for any other rule. She sets `cite.severity` per rule, deciding whether an edited sentence blocks a merge or only reports. She chooses where entries live, on the page or in a manifest, and records that choice beside the schema.

**What success looks like.** A page of that kind cannot merge without a citation, and every team reads one set of rules.

---

## Theo, Contributor

### T1 · Fix a failing metadata check fast

Theo lands on the docs via a red CI check or a search. He needs a clear map from the error message to the specific field or line in his file. He needs remediation steps for the most common failures. Those are a missing `type`, a bad `date-time` format, a schema not found, and a parse error. He also needs a way to validate locally before re-pushing, and confirmation that the fix worked.

This is the highest-traffic page in the docs. Every contributor who hits a failing check arrives here. It is cross-cutting: the same page serves regardless of which persona configured manni meta.

Theo's failure is usually a *missing* field rather than a malformed one, so `fill` is a genuine shortcut for him. Lead with `--dry-run`; he is fixing someone else's repo and needs to see the proposal before it lands in his PR.

### T2 · Read a citation failure and fix it

**Outcome.** Theo's PR carries a `manni:cite/source-changed` annotation on a sentence he may not have written, and he gets the check green without learning how citations work.

**Steps.** He reads the one line: a mark, the entry's id, the claim end, and the source end. He finds the status on the fix page. A `claim-moved` is a notice and `manni cite update` clears it. A `claim-changed` means the sentence was edited after it was pinned, and `manni cite update --accept` re-pins it once he has confirmed the citation still holds. A `source-changed` means the cited lines are not what they were, and `--show-diff` shows him the commits since. A `source-missing` means the file is gone or renamed, so the citation has to be added again. On an encrypted source the finding names the reason, whether no key, the wrong key, or the wrong `--root`. The page-side rules, `marker-orphan`, `anchor-invalid` and `entry-invalid`, are mistakes in the page or the manifest, and each says what to change. He reproduces locally with `npx @hawkeyexl/manni cite check <page>`, sees green, and pushes.

**What success looks like.** One status, one action, one re-run. He never has to know what a pin is.

---

### T3 · Fix an accessibility failure

**Outcome.** Theo's pull request carries one accessibility annotation, and he clears it without learning axe.

**Steps.** He reads the annotation, which names the rule, the element it fired on, and one sentence saying what to change. The fix page maps the rule to the change, and the help URL explains the rule itself. He edits the template or the page, rebuilds, and runs the same command locally until it exits `0`. There is no `--fix`, because no tool can know the words that belong in an alt attribute.

**What success looks like.** A rule id he can act on, and a local run that proves it before he pushes.
