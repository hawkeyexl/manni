---
status: "accepted"
date: 2026-08-04
decision-makers: [hawkeyexl]
---

# Publish the docs site to GitHub Pages, gated on moose-docevals evaluating itself

## Context and Problem Statement

ADRs 01003 and 01004 produced a 34-page documentation site that builds and is verified on every pull
request, and that **no reader could reach**. Deployment was deliberately deferred so that publishing
was its own decision rather than a side effect of writing the content.

There are two questions. Where is the site hosted, and what must hold before it ships?

## Decision Drivers

- The repo is public and already builds the site in CI; hosting should add no new service or account.
- A published page that lies is worse than no published page. Whatever gates the deploy has to cover
  the failure modes that actually exist.
- `main` has no ruleset requiring pull requests, so anything that assumes "it passed on the PR"
  is assuming something the repo does not enforce.
- ~1,350 internal links across 35 built pages, and **nothing checked them**. `moose-docevals run` verifies
  that a page's commands are true; links were an unguarded surface where the build succeeds either
  way.

## Considered Options

**Hosting**

1. **GitHub Pages via Actions**, mirroring the sibling docmeta repo.
2. A third-party host (Netlify, Vercel, Cloudflare Pages).
3. Keep the site unpublished and read it in-repo.

**Gating the deploy**

A. **Re-run the full docs verification inside the deploy workflow.**
B. Depend on `ci.yml`'s `verify-docs` via `workflow_run`.
C. Build and deploy without re-verifying.

## Decision Outcome

**Option 1** wins for hosting and **option A** for gating, plus a new link check.

`docs.yml` runs `verify-docs → build → deploy` on every push to `main` and on manual dispatch. Pages
is configured with `build_type: workflow`, publishing to `https://hawkeyexl.github.io/moose-docevals/`.
That is exactly what `docs/astro.config.mjs` already declared as `site` + `base`, so no config
changed to make this work.

**Why the verification is duplicated (option A over B).** `ci.yml` already runs `verify-docs`, and
repeating it costs about six minutes per push to `main`. It is still the right call: `main` accepts
direct pushes, so a commit can reach `deploy` having never been verified at all. Option B is
`workflow_run` chaining. It avoids the duplication but adds indirection, and it runs the workflow
definition from the default branch rather than the commit. It also makes "did the thing that gates
this actually pass for *this* SHA?" a question rather than a fact. For the job that publishes,
self-contained beats fast.

**A new gate: internal links.** Writing this ADR's companion workflow surfaced that no check covered
links. `scripts/check-docs-links.mjs` walks the built HTML, resolves every internal `href` against
`docs/dist`, and fails listing each broken target and the pages linking to it. It is wired into both
`docs.yml` (gating the deploy) and `ci.yml` (catching it on the pull request). Verified in both
directions: removing one built route makes it exit 1 and name all 33 pages that link there.

The `docs.yml` `verify-docs` job carries **no fork gate**, unlike its `ci.yml` twin. That is
deliberate and safe. This workflow triggers only on `push` to `main` and `workflow_dispatch`, never
on `pull_request`. The page-embedded commands it executes are always already in the repository.

### Consequences

- Good, because the content set is reachable. Everything before this was infrastructure nobody could
  read.
- Good, because a documented command that drifts from the code now blocks the deploy. So does a page
  whose frontmatter stops validating, and so does a renamed route.
- Good, because there is no new hosting dependency, and the URL was already assumed by the Astro
  config.
- Bad, because ~6 minutes of verification is duplicated per push to `main`. Revisit if `main` ever
  gains a ruleset requiring pull requests, which is the condition under which option B becomes safe.
- Bad, because the site ships from `main` immediately, so a bad merge is publicly visible until the
  next push. Acceptable for a project at this stage; a staging environment is the answer if it stops
  being.
- Neutral, because this publishes documentation, not the package. npm releases remain gated behind
  the unset `RELEASE_ENABLED` variable. Deploying docs and publishing a first npm version are
  separate irreversible decisions, and only the first is being made here.

### Confirmation

- `docs.yml` on push to `main`: `verify-docs` (including the step-validity guard from ADR 01005),
  then `build` + link check, then `deploy`. Any failure stops the deploy.
- `npm run docs:check-links` locally after `npm run build` in `docs/`.
- The built output was checked before enabling anything. The base prefix applied to all 1,354
  internal links and assets, the sitemap emitted absolute
  `https://hawkeyexl.github.io/moose-docevals/...` URLs, and deep routes were present.

## Pros and Cons of the Options

### Hosting, option 1, GitHub Pages via Actions

- Good, because it needs no account, no secret, and no third-party service; the artifact is already
  built in CI.
- Good, because the sibling repo uses the same shape, so the two are maintained the same way.
- Bad, because Pages offers no preview deployments. A change is verified, then live.

### Hosting, option 2, a third-party host

- Good, because per-PR preview deployments are genuinely useful for a docs site.
- Bad, because it adds an account, a token, and a second place where the build is configured. The
  project's docs currently ship from one branch.

### Hosting, option 3, leave it unpublished

- Good, because it is free and nothing can break.
- Bad, because it makes the whole content set inert. Documentation nobody can reach is not
  documentation.

### Gating, option A, re-verify in the deploy workflow

- Good, because it holds regardless of how the commit reached `main`.
- Bad, because it duplicates six minutes of work per push.

### Gating, option B, `workflow_run` chaining

- Good, because no duplicated runtime.
- Bad, because it evaluates the workflow file from the default branch, not the commit, and turns a
  direct-push bypass into a silent one.

### Gating, option C, deploy without verifying

- Good, because it is the fastest.
- Bad, because it removes the only thing that makes publishing safe. The point of this project is
  that documentation is testable; shipping it untested would be self-refuting.
