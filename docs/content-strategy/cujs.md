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

### M8 · See which lines a machine wrote, and catch them changing

**Outcome.** Maya reviews what agents wrote, not whole pages. She learns when a human edit replaces text a machine was credited with.

**Steps.** She adds `provenance` to `derive.fields`, plus `machines:` so that past agent commits count. She adds the `manni-meta-derive` hook ahead of `manni-meta` in `.pre-commit-config.yaml`, and both hooks are published in the repository's `.pre-commit-hooks.yaml`. With `MANNI_GENERATED_BY` exported, the hook stamps the lines an agent wrote with its name, a line range and an integrity hash. When it stamps, the commit stops once. She re-stages and commits, so the edit and its attribution land in one commit. CI runs `manni meta validate`, which compares each pin with the page and with git blame. She lists the machine-written ranges with `manni meta get provenance <path>`, or across the corpus with `manni meta query` over the `resolved` table. Fields that `manni meta fill` proposed wait in `meta-provenance` for the same review. Where the page is public, she keeps the record in a private manifest instead.

**What success looks like.** A changed range fails `validate` at the line of the prose, and one `derive` clears it. A range that only moved is not a finding.

---

### M9 · Stand up a first eval gate

**Outcome.** A pull request in Maya's own repo goes red because a page stopped meeting a named, written-down assertion. Its author can see which one and why.

**Steps.** She decides from the overview whether the tool fits. She installs the package she already has, runs `manni docevals init`, and gets a real finding on one of her own pages with `manni docevals run --deterministic-only`, no provider key needed. Only then does she read how an eval, a grader and a verdict fit together. She declares evals in page frontmatter, writes one assertion a judge can decide, and adds a deterministic check beside it, so not everything is judged. She reads the output and its exit code, then lands the CI step.

This is the backbone of the docevals section. It is the only journey that crosses every layer: the frontmatter contract, the grader hierarchy, the judge, the output and CI. The quickstart gets a reader to a finding with the minimum vocabulary, and the concepts page sits straight after it. Concepts first loses the reader with ten minutes; no concepts loses the one committing a team. The step that decides adoption is the deterministic check. A reader who leaves believing docevals means "a model grades my docs" will lose the cost and explicability arguments.

**What success looks like.** One page, one assertion, one run, one CI step, and a red check whose reason a person can read, argue with and fix.

---

### M10 · Keep one eval library the whole corpus shares

**Outcome.** Pages name a suite and a few evals, the assertions live once in `manni.config.yaml`, and changing one changes every page that uses it.

**Steps.** She moves a repeated assertion into a named eval under `docevals.evals`, and groups evals into a suite per page type. She learns what wins when a page and the config collide: on a name collision the page wins. She decides regression or capability per eval and gives each suite a `target-pass-rate`. Before running anything she confirms the resolved plan per page with `manni docevals list`.

**What success looks like.** Nobody asks "what do we actually check on a how-to?", because the suite answers it. A capability finding is not treated as a build break, because the suite's target says what it measures.

---

### M11 · Report the linters we already run through one gate

**Outcome.** Vale, markdownlint, manni meta and a structure linter report through one `manni docevals run`, as evals with names and severities in one output format. Their separate CI steps are gone.

**Steps.** She sees why code comes first in the grader hierarchy. She wraps each existing linter as a `tool:*` eval and looks up its options. She adds the native checks nothing else covers: freshness, reading level and cross-page differentiation. She runs any other CLI check as a `command` eval. She decides per eval what fails the build and what only reports, entering a newly wrapped linter at `warning`. Last, she makes the commands her pages present testable through `tool:doc-detective`.

The claim this journey carries is that docevals orchestrates and does not reimplement. A reader who expects it to replace Vale is judging it against the wrong tools.

**What success looks like.** One report, one exit code, and a pipeline where most evals are code and only a handful are judged.

---

### M12 · Propose evals for a corpus nobody annotated

**Outcome.** Every page in a directory carries evals nobody hand-wrote. Maya knew how much work the pass would do before it ran, and she reviewed what landed rather than assuming it is right.

**Steps.** She runs `manni docevals fill --dry-run` over one directory and reads the proposals. That dry run is where the inference calls are spent, and the write pass after it is a cache hit. Proposals are cached before the confidence gate, so re-running at a different `--confidence` costs nothing. `fill` spends one call per uncached page, so the page count of a batch is its size, and `--max-turns` caps it before the first call. She writes the proposals, reviews them like any other change, and converts the good ones into cheap deterministic checks (S9).

**What success looks like.** A directory covered in an afternoon, a call count she predicted, and a review step rather than a claim that the corpus is now covered.

---

### M13 · Get a legacy corpus onto the eval ratchet without a wall of red

**Outcome.** Every eval is on at `error` from day one. Today's findings are recorded in a committed baseline, and CI fails only on new ones. The recorded count is falling, and no assertion was weakened to get there.

**Steps.** First she decides what should not be evaluated at all, and excludes it from the collection before anything is recorded. Narrowing scope afterwards produces an alarming `removed` count. She sets `baseline:` in the config so a recorded file is actually read. She records today's findings with `manni docevals run --write-baseline` and commits the file. She gates CI on new findings only. On every re-record she reads the `(+added, -removed)` line, `removed` above all. A baseline forgives silently by construction. She learns what it does not cover. A finding's identity is per rule per file, not per occurrence, and it holds deterministic findings only, not judged verdicts. She proposes evals one directory at a time (M12). Judged evals go in a capability suite with a target below 1.0. She burns down one section and re-records so the baseline shrinks. `severity: warning` is kept for a finding class the team will never gate on.

**What success looks like.** At the end of a quarter, one section is gated at `error` with no baseline entries. The burn-down is going the right way, and nobody weakened the standard.

---

### M18 · See the docset as a graph, and find what nothing links to

**Outcome.** Maya has a graph of her docset and can ask it questions prose cannot answer: which pages nothing links to, which concepts have no page, which page owns a term.

**Steps.** She runs `manni kg build` over a collection she already declared for `meta validate`, and gets one Turtle file plus a count of documents and triples. `manni kg stats` tells her how much of the vocabulary the corpus actually fills, per field, and `--check` turns a coverage floor into an exit code. `manni kg query --p dct:subject` lists what the corpus says about a predicate, and `manni kg search` finds pages by words or, once she has run `manni kg embed`, by meaning. Nothing is inferred from prose: a triple exists because frontmatter, a link, a heading or a code block put it there.

**What success looks like.** A question that used to mean reading forty pages is a one-line command, and the answer is the same on her machine and in CI.

---

### M19 · See what a change to one page affects before making it

**Outcome.** Before editing a page, Maya knows what depends on it: the pages that link to it, the concepts it carries, and what a rename would orphan.

**Steps.** `manni kg traverse <page> --impact` walks the graph outward from that node and reports what it reaches, `--reverse` for what reaches it, `--depth` for how far, and `--predicates` to follow only the edges she cares about. The answer is a graph walk rather than a text search, so a page reached through a concept rather than a hyperlink still shows up.

**What success looks like.** The review comment "this breaks the install tutorial" arrives before the change, from her own terminal.

---

### M20 · Fill the categorization nobody wrote, and review what a model proposed

**Outcome.** Pages that predate the vocabulary carry a `kg` block, and every value a model proposed is attributed and reviewable rather than silently merged into the corpus.

**Steps.** She runs `manni kg fill --dry-run` over one directory and reads the proposals. `--confidence` sets the bar a value must clear to be written, `--fields` narrows what is proposed at all, and `--max-turns` caps the inference calls before the first one. `--local` runs the pass on her machine. Every written value is recorded in `meta-provenance` naming the model and the field, so a surviving entry means unreviewed machine metadata and deleting it is how she signs off. A field the schema marks `x-manni-kg-output: false` never reaches the published graph, whatever fills it.

**What success looks like.** A directory categorized in an afternoon, a review step rather than a claim, and a record of which values a machine wrote.

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

### D8 · Gate evals in CI

**Outcome.** One parameterized job, identical across repos, blocks a pull request on findings, annotates the offending lines, and routes operational failures somewhere other than the author.

**Steps.** Devin adds the job on his platform, then takes the same recipe for GitLab CI, Jenkins and pre-commit. He routes on the exit code. `0` passes, and `1` is findings and blocks the author. `2` is operational, such as a missing credential, an unreachable provider or a malformed config, and it is his. He runs `-f github` so each finding annotates its line. He supplies the provider credential from a secret, naming `provider` in config rather than leaving it to whatever the runner's environment detects. He persists the response cache between runs, keyed on what invalidates it. A cold cache re-judges the corpus on every push and spends turns a warm one would not. He feeds `-f json` into the tooling he already has. The fork problem first appears at the credential step, and this journey hands it to D9 rather than half-answering it.

**What success looks like.** A recipe he pastes into four repos unchanged, which never wakes him up, and whose inference calls he can point at on a graph.

---

### D9 · Bound what the eval gate can spend and what it can execute

**Outcome.** A fork pull request cannot execute its author's code on a runner or reach a provider credential. No run makes more inference calls than a budget set in config.

**Steps.** He learns the two paths from a content file to code on the runner. Frontmatter-declared commands are granted by `execution.allow: [frontmatter-commands]`, and steps embedded in page bodies, run by `tool:doc-detective`, by `page-embedded-steps`. He learns that no grant makes a run over a fork safe. So he gates the job that executes anything to same-repo pull requests, and gives forks a separate `--deterministic-only --no-execution` job with no secret. He sets `judge.maxTurns` and `fill.maxTurns`. A turn is an uncached call, one ai eval spends `judge.ensembleRuns` of them, and a cache hit spends none. He knows that exhausting the budget skips the remaining evals and still exits `0`. The tool reports no dollar figure, so the conversion is his provider's rate card. He looks up the flags and keys on the reference shelf.

This is the highest-stakes journey in the section. It is the only one where a plausible wrong answer causes real harm. Any page presenting a grant as sufficient is worse than no page.

**What success looks like.** A fork gets freshness, lint and frontmatter checks with nothing executed. A finance question gets answered with a call count.

---

### D12 · Gate the graph in CI

**Outcome.** A pull request that breaks the docset's structure is red before review: a concept split across two spellings, a link to a page that does not exist, coverage falling below the floor.

**Steps.** He adds one step that runs `manni kg build` and `manni kg check` over the same collection the metadata gate already uses. `check` validates the built graph against SHACL shapes, which is where the emergent failures live: they exist only after N documents merge into shared nodes, so no per-file check can see them. Findings come back on the family scale, `notice | warning | error`, and `-f github` annotates the diff. `manni kg stats --check --coverage-threshold` gates the vocabulary coverage. The exit codes are the family's: 0, 1 for findings, 2 for an operational error.

**What success looks like.** A structural regression is caught by the same pipeline that already checks metadata, reported in the same words, with no second tool to install.

---

### D13 · Publish the graph for retrieval

**Outcome.** The graph leaves CI as an artifact other systems consume: linked data for an ingester, iiRDS for a content delivery portal, or a search index the docs site loads in the browser.

**Steps.** `manni kg export jsonld` writes linked data, `export iirds` writes a conformant package, and `export search` writes the index the `@hawkeyexl/manni/kg/runtime` bundle reads client-side. `manni kg embed` adds vector sidecars for semantic search, per language. He pins what the artifact carries by marking fields in the schema rather than post-processing the output, and publishes on the same run that gated it, so what ships is what passed.

**What success looks like.** A RAG ingester and the docs site's own search read one artifact, produced by the build that already ran.

---

## Sara, Schema Author

### S1 · Define our metadata standard as a schema

Sara needs to encode her metadata standard as a JSON Schema. That means defining required and recommended fields, and specifying value formats such as `uri`, `date-time`, and enum. She also needs to understand what the built-in OKF schema already provides, so she can start from it or deviate deliberately.

Her standard also says where each field lives. A field an agent fetching the page would act on stays in the page. A field that only serves maintainers and CI goes to the collection's external-metadata manifest. She marks each property `x-manni-location` (proposal 0047), and `manni meta relocate` moves the values to match.

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

### S6 · Write assertions the judge can decide

**Outcome.** Two people reading the same page agree on the assertion, and so does the judge. Its failure tells the author which sentence to change.

**Steps.** Sara's trigger is an eval that flips between pass and fail, or fails pages that are obviously fine. Her first hypothesis is a broken grader, and it is usually a vague assertion. She rewrites `assertion` as a claim that is true or false, scopes what the judge reads with `evidence`, and pins the boundary with `examples.pass` and `examples.fail`. She decides whether the eval guards behaviour (regression, the default) or measures reach (capability), because that changes how strictly it is worded. She asks whether it should be an `ai` eval at all. The cheapest moment to notice an assertion is really a grep is while writing it. She checks the wording against how it is judged: the ensemble, consensus where `partial` counts as a fail, and the confidence zones.

**What success looks like.** An eval that stops landing in human review, and a failure Theo can act on from the assertion and its failing example.

---

### S7 · Prove the judge is trustworthy enough to gate a build

**Outcome.** A calibration report shows agreement above the threshold and a false-positive rate below the alert. Sara can hand it to a skeptic and be believed.

**Steps.** She learns what makes a verdict reproducible: temperature 0, a pinned model, structured verdicts and a content-addressed cache. She learns how an ensemble becomes one verdict, and that an errored run counts against consensus. Variance can therefore only push an eval toward human review, never toward a silent pass. She learns where auto-pass and auto-fail end and review begins. She builds a golden set of twenty to fifty human-verified cases under `.manni/docevals/golden/`, seeded from recorded reviews with `calibrate --seed`. She runs `manni docevals calibrate`. Below 70% agreement it exits `1`, and the right response is to refine the assertions, not the grader. She watches the false-positive rate against `judge.falsePositiveAlert`. She chooses a provider and pins a model, including a self-hosted OpenAI-compatible endpoint or `claude-cli` with no key.

**What success looks like.** A report showing 88% agreement and a 6% false-positive rate, and an engineering director who stops asking whether the check is trustworthy.

---

### S8 · Clear the human-review queue

**Outcome.** A recorded verdict with a reviewer and a note unblocks the pull request. It persists for later runs and expires on its own when the page changes.

**Steps.** She lists what is waiting with `manni docevals review`, no arguments. She reads why this eval landed in the review zone. She records a verdict with `manni docevals review <file> <eval> pass|fail --reviewer <name>`. She knows the verdict holds only while the reviewed page body is unchanged, which is what makes persistence safe. She decides, as a policy question rather than a default, whether `--fail-on-review` blocks the build. The deciding question is whether someone owns the queue. An eval that lands in review every run is a diagnosis, and its repair is S6, not answering it faster forever.

**What success looks like.** A queue somebody clears, a review zone nobody wants turned off, and Theo told to escalate rather than left to guess.

---

### S9 · Move evals down the grader hierarchy

**Outcome.** Evals that could always have been code are `command` evals with committed, reviewable scripts. The next run makes measurably fewer inference calls with no loss of coverage.

**Steps.** She runs `manni docevals promote` to find the `ai` evals whose criterion can be expressed as code. It reports by default, and converting with `--write` is a deliberate act, because it changes what is checked. For a plain-language `command` eval with no command, `manni docevals generate` writes a script to a file beside the page, never inline in frontmatter. She reviews that script like any other source, because one that passes for the wrong reason is worse than the judged eval it replaced. She learns that editing the assertion makes the script stale, so it regenerates rather than quietly checking the old thing. She confirms the saving from the run's judged and cached counts, never from a dollar figure.

**What success looks like.** A corpus whose run time and call count stopped growing with it.

---

### S12 · Extend what the graph is checked against

**Outcome.** Sara's house rules about structure hold in the graph, not only in review: a concept with two labels, a page with no owning section, a required relationship nobody filled.

**Steps.** She writes SHACL shapes and points `kg.check.shapes` at them, or passes `--shapes` per run; the bundled shapes are the floor, not the ceiling. She marks the vocabulary fields the published graph should carry with `x-manni-kg-output`, which is the same file where she already marks `x-manni-location`, so what a page stores and what a delivered artifact says are two decisions in one place. A shape's own `sh:severity` maps onto the family scale, and the source value stays in `shaclSeverity` for anyone who needs it.

**What success looks like.** Her standard is enforced twice: per page by `meta validate`, and across the corpus by `kg check`, with no third vocabulary to learn.

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

---

### T4 · Fix a failing eval

**Outcome.** Theo's pull request is red on an eval he did not write. He identifies which check failed, makes the smallest correct change or escalates to the right person, and confirms locally, having read one page.

**Steps.** He works out which kind of failure it is from the triage table on the fix page's first screen. A finding with a file and line is a deterministic check, and he fixes the line. A rationale with no line is an AI verdict, and he reads the assertion and its `examples.fail` beside the rationale to find the sentence. A needs-review verdict is not his to resolve, so he escalates to whoever owns the queue. A generated script that no longer matches its assertion wants regeneration, not an edit. An exit `2` is operational and goes to the platform team. He reproduces locally with `npx @hawkeyexl/manni docevals run --deterministic-only <file>`, which needs neither the key nor the cache CI had. The FAQ answers the recurring questions.

This is the highest-traffic journey in the section and the shallowest. The fix page has no subject dependencies, because it is reached cold from an annotation.

**What success looks like.** Four minutes from annotation to green, and he never learns what a capability suite is.

---

### T6 · Fix a red `kg check`

**Outcome.** Theo's pull request is red on a graph finding he did not cause directly. He works out which of his pages produced it, makes the smallest correct change, and confirms locally.

**Steps.** He reads the finding's focus node, which is the graph's name for the thing that failed, and the documents listed beside it, which is where it came from. A graph finding is emergent by nature: two pages spelling one concept differently collide on a single node, so the fix is usually in one of them and the report names both. He reproduces with `npx @hawkeyexl/manni kg build && npx @hawkeyexl/manni kg check`, which needs no key and no network. An exit 2 is operational and goes to the platform team.

**What success looks like.** He fixes a corpus-level failure from a page-level edit, and never opens a Turtle file.
