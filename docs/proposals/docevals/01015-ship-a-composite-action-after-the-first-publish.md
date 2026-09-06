---
status: "accepted"
date: 2026-08-28
decision-makers: [hawkeyexl]
---

# Ship a composite GitHub Action and a pre-commit hook, after the first npm publish

**Nothing ships with this ADR.** It records a decision that is made and a prerequisite that is not met, so the next person does not re-derive either.

## Context and Problem Statement

Adopting moose-docevals in CI currently means writing the whole job. Check out, set up Node, install, build or install the CLI, invoke it, choose a format. docmeta's proposal 0002 packaged that into two artifacts, a GitHub Action and a `pre-commit` hook. It is the difference between a five-line `uses:` and a twenty-line job someone has to get right.

The blocker is concrete rather than a matter of taste: **`moose-docevals` is not published.** `npm view moose-docevals version` returns 404. The release workflow is gated behind a `RELEASE_ENABLED` repository variable that is not set. A first npm publish cannot be undone, so releases are opt-in (ADR 01006 and CLAUDE.md).

## Decision Drivers

- **An action that cannot resolve the package is a broken artifact.** Both distribution forms resolve `moose-docevals` from the registry; shipping either today gives every consumer a failed install.
- **The composite-vs-JS choice is worth deciding now**, because it is the decision that gets made badly under time pressure later.
- **A second CLI surface drifts.** Enumerating every flag as an action input creates a surface with nothing guarding it against the real CLI.

## Considered Options

- **A bundled JavaScript action.** Commits a built `dist/` that GitHub runs directly.
- **A composite action** that shells out to `npx moose-docevals@<major>`.
- **Ship neither, ever.**

## Decision Outcome

The chosen option is **a composite action, plus `.pre-commit-hooks.yaml`, both landing after the first publish.**

A JS action means committing compiled JavaScript and keeping it in step with every release. That is a second build pipeline, and the usual way an action ends up running last week's code. Shelling out to `npx moose-docevals@<major>` keeps the npm package as the single artifact, so there is exactly one thing to version.

The input list stays short, covering paths, config, format, version, and an `args` escape hatch, rather than mirroring every flag. `args` is the documented way to reach anything not listed, which keeps the action from becoming a second CLI surface that drifts from the first.

**What unblocks this**, in order:

1. Configure npm trusted publishing for the package (a trusted publisher on npmjs.com naming this repo and `release.yml`), so the publish authenticates via OIDC without an `NPM_TOKEN`.
2. `gh variable set RELEASE_ENABLED --body true --repo hawkeyexl/moose-docevals`.
3. Land a release-triggering commit, and confirm the package resolves.
4. Then add `action.yml` and `.pre-commit-hooks.yaml`, pinning the action's default `version` to the published major.

### Consequences

- **Good.** The design question is settled, and settled for the reason rather than the convenience.
- **Good.** Nothing broken ships. An action that 404s on install would be discovered by a user, not by us.
- **Bad, and accepted.** Adopting moose-docevals in CI stays a hand-written job until the package is published. That is true today regardless. An action would not change it, only hide it behind a failing `uses:`.
- **Neutral.** An `action-smoke.yml` workflow will be needed alongside the action. A composite action's failure mode is a shell error nobody sees until a consumer hits it.

### Confirmation

None yet, by design. When the action lands, its confirmation is a smoke workflow. That workflow runs the action against this repo's own fixture corpus and asserts the expected non-zero exit. It is the same gate `ci.yml` already applies to the CLI.

## Pros and Cons of the Options

### Bundled JavaScript action

- Good, because it starts fastest, with no `npx` resolution on every run.
- Good, because it works before the package is published, which is the whole appeal today.
- Bad, because it commits a build artifact that must be regenerated on every release, and silently runs stale code when it is not.
- Bad, because it makes the repo carry two build pipelines for one tool.

### Composite action shelling out to npx

- Good, because the npm package stays the single versioned artifact.
- Good, because `version` is an input, so a consumer can pin or float deliberately.
- Bad, because it cannot work until the package exists, which is why this is parked rather than built.

### Ship neither

- Good, because it is honest about the current state.
- Bad, because the adoption cost stays high permanently, and the decision gets re-litigated every time someone asks.
