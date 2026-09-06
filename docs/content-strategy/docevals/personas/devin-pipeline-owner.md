---
id: persona-pipeline-owner
type: persona
name: "Devin, Platform / CI Engineer"
audience: aud-platform-ci
role: Maintains CI/CD for dozens of repos across several platforms
shared_with: manni meta
proficiency:
  [github-actions, gitlab-ci, jenkins, pre-commit, shell, json-tooling, secret-management,
   ci-caching, supply-chain-hygiene]
prerequisites: [exit-code-conventions, ci-artifact-and-cache-model, fork-pr-security-model]
goals:
  - One parameterized recipe that behaves identically in every repo
  - A ceiling on inference calls the job cannot exceed
  - Machine-readable output that flows into existing dashboards without custom parsing
  - Certainty that a fork pull request cannot execute its author's code on a runner
pains:
  - A model in the critical path is slow, rate-limitable, nondeterministic, and metered
  - Content files drive code execution by two different paths, and one flag only covers one of them
  - Exit 1 and exit 2 route to different humans and must never be conflated
  - Secrets are unavailable on forks by design, so the fork path must work without a provider
content_types: [ci-recipe, exit-code-contract, security-guidance, json-output-reference]
journeys: [cuj-ci-wire, cuj-bound-cost-and-risk]
---

# Persona: Devin

**Scope:** the operator persona for [`aud-platform-ci`](../audiences/platform-ci.md). Devin installs
and runs the gate and authors no evals at all. Authoring belongs to
[Priya](priya-corpus-owner.md) and [Sara](sara-standard-owner.md).

**Deliberately the same Devin as manni meta's.** He is one engineer wiring one pipeline, and he does not
experience the two tools as separate adoptions. See
[`_overview.md`](_overview.md) for why the names are shared.

Devin maintains CI for dozens of repos on a mix of GitHub Actions, GitLab CI, Jenkins, and pre-commit.
He scripts everything and distrusts per-repo snowflakes. He knows from experience that any check which
is slow, flaky, or expensive gets disabled by the first team it inconveniences. He arrives because a
docs team asked for a step, or because a docs check started costing money and it landed on his desk.

He inherits two problems from manni docevals that manni meta never gave him. They are what make him a
first-class persona here rather than a footnote.

**A model is in the critical path.** Slow, rate-limitable, nondeterministic, and metered per call,
which is four novel failure modes for a CI step. He needs the ensemble, the response cache, `--max-turns`, and
`--deterministic-only` presented as *operational controls* he reaches for, not as quality features he
reads past. The cache in particular has to survive between runs or the economics collapse. Where
it lives and what belongs in a CI cache key is load-bearing reference material for him. He also needs
telling that `--max-turns` bounds *work*, not money. The tool counts inference calls and reports no
dollar figure, and a run that exhausts its budget skips the rest and still exits `0`. Devin is the
persona most likely to set that number once and never look at it again. That is exactly who a
silently degraded green run hurts.

**Content files drive arbitrary code execution, by two paths.** Page frontmatter can declare commands,
gated by `scripts.allow-frontmatter-commands` and `--no-frontmatter-commands`. Separately, the
`tool:doc-detective` grader executes steps embedded in page *bodies*, and the flag does **not** gate
that. On a fork pull request an attacker controls both. Devin is the only persona equipped to reason
about this, and the honest answer he needs is that the flag is not sufficient. The job itself must be
gated to same-repo pull requests. Any page that implies otherwise is actively dangerous. That makes
[`ci/untrusted-pull-requests.mdx`](../information-architecture/proposed-ia.md) the highest-stakes page
on the site, even though it is not the highest-traffic one.

He will notice an unpinned third-party action in a recipe, and he will not trust a page that has one.

Success for Devin is a recipe he pastes into four repos unchanged. It has never woken him up, its
usage he can point at on a graph, and he does not think about it again.
