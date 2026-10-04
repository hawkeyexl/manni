---
status: accepted
date: 2026-09-04
decision-makers: [hawkeyexl]
supersedes: 01007 (one consequence, "engine-strict applies to dependencies too", only)
---

# The npm floor, and the return to `npm ci`

## Context and Problem Statement

This repo banned `npm ci` for a while. `CONTRIBUTING.md` and the CI comments both gave the same
reason. The committed lock was said to be generated on Windows, and to omit the Linux-side
optional dependencies of rolldown's wasm binding. A strict lock check could not pass on both
platforms.

That was a misdiagnosis, twice over. The lock records all fourteen `@rolldown/binding-*`
packages, every Linux one included, each with its `os`, `cpu`, `resolved` and `integrity`.
Nothing platform-specific is missing. And rolldown no longer ships a `wasm32-wasi` binding at
all, so `@emnapi/core` and `@emnapi/runtime` are not reachable in this tree and cannot have been
dropped from it.

The real variable was **npm's own version**, not the contributor's operating system. npm 11.6.2
and older drop the top-level entries for optional platform packages when they write a lockfile.
That happens on Linux, macOS and Windows alike, and 11.6.3 keeps them everywhere. docmeta reached
the same finding independently, through the identical dependency path.

So the ban was working around a real failure with the wrong cause named. `npm ci` was rejecting a
lockfile that a too-old npm had written, and the fix belonged at the npm version rather than at
the install command.

There is a second problem, and it is what makes this a decision rather than a bug report. The
Node floor does not imply the npm floor. Node 24.11.0 satisfies `engines.node` `>=24` and bundles
npm **11.6.1**, below the floor. A contributor on a fully compliant Node can regenerate a broken
lockfile and turn CI red with nothing naming the cause.

## Decision Drivers

- The lockfile should be authoritative. An install that is free to resolve around it makes CI a
  weaker check than it looks.
- A constraint that matters has to be enforced, not documented. `CONTRIBUTING.md` asked for npm
  11.6.3 and nothing checked.
- The failure has to name itself. A lockfile silently missing entries surfaces later, somewhere
  else, as a red build with no pointer back.
- Two floors that are not in step are a trap, so the weaker one must not be allowed to imply the
  stronger.

## Considered Options

1. **Restore `npm ci`, and enforce the npm floor through `engines.npm` plus `engine-strict`.**
2. **Restore `npm ci`, and document the npm floor without enforcing it.**
3. **Keep the ban on `npm ci`, and go on installing loosely everywhere.**
4. **Pin an exact npm version** rather than a floor.

## Decision Outcome

**Option 1 was chosen.** `engines.npm` is `>=11.6.3`, [.npmrc](../.npmrc) sets
`engine-strict=true`, and every CI job runs `npm ci`.

`engine-strict` is what turns the declaration into a gate. Without it npm treats `engines` as
advisory and installs anyway, which is the same as option 2. With it, a too-old npm fails at
install with `EBADENGINE` rather than quietly writing a lockfile CI will reject later.

The runners get the floor pinned explicitly, with `npm install -g npm@^11.6.3` before the
install step, because a runner image's bundled npm is not something this repo controls.

Option 4 was rejected because the failure has a floor and not a version. Pinning exactly would
mean a maintenance task every npm release, to no benefit.

### What this changes about ADR 01007

[ADR 01007](01007-quality-gate-enforcement.md) introduced `engine-strict=true`, and recorded a
consequence that no longer holds:

> Bad. `engine-strict` applies to dependencies too, so a transitive package declaring an engines
> range that excludes Node 24 will hard-fail `npm install`. Since CI and release both use
> `npm install` rather than `npm ci`, that can appear without any change to this repo.

The first sentence stands. The second does not, because CI and release both use `npm ci` now. The
exposure is smaller than 01007 described: a lockfile install resolves nothing, so a transitive
package cannot arrive without a lockfile change, which is reviewable. That bullet is struck
through in place there rather than deleted, matching how
[ADR 01020](01020-local-embeddings.md) handles the same situation. Every other part of 01007
stands.

### Consequences

- Good. The lockfile is authoritative in CI, so what CI installs is what the lock says.
- Good. A contributor below the floor is told at install time, by name, instead of through a red
  build somewhere downstream.
- Good. The trap is closed. Satisfying `engines.node` no longer implies satisfying `engines.npm`,
  and the tooling says so rather than the documentation alone.
- Bad. A contributor on Node 24.11.0 out of the box cannot install until they upgrade npm. That
  is the intended behavior, and the error names the fix.
- Bad. `engine-strict` still applies to dependencies, so a transitive package declaring a range
  that excludes Node 24 hard-fails the install. Reaching this now requires a lockfile change.
- Neutral. `docs/package-lock.json` stays on `npm install`, because that lock has not been
  verified against a strict install the way the root one was. See
  [docs.yml](../.github/workflows/docs.yml).
- Good. Every job that installs the root project pins the floor before doing it, so none of them
  rely on the runner image's bundled npm. The first draft of this decision left `docs.yml`'s
  `validate` and `release.yml`'s `release` unpinned. It reasoned that closing the gap belonged in
  a change that owned the release path. The maintainer decided otherwise before this shipped, so
  the gap never reached `main`.

### Confirmation

- An unsatisfiable floor fails with `EBADENGINE` at install time, and `>=11.6.3` installs clean
  on npm 11.19.0. Both were checked when the floor landed.
- Six jobs install the root project, and all six run `npm ci`. Three are in
  [ci.yml](../.github/workflows/ci.yml), namely `build-test`, `embed-real` and `fill-live`. The
  others are `inline-tests` in [doc-detective.yml](../.github/workflows/doc-detective.yml),
  `validate` in [docs.yml](../.github/workflows/docs.yml), and `release` in
  [release.yml](../.github/workflows/release.yml).
- All six pin the floor explicitly, running `npm install -g npm@^11.6.3` ahead of the install.
  The pin sites were counted with `grep -rn "npm install -g npm@" .github/workflows/` rather than
  read off this list.
- CI's Node 24.19.0 bundles npm 11.17.0, which is above the floor. The pin is therefore a guard
  rather than a fix for anything failing today. `release.yml`'s copy stays unexercised until a
  release runs, because that workflow does not fire on a pull request.

## Pros and Cons of the Options

### 1. Restore `npm ci`, and enforce the floor (chosen)

- Good. The lock is authoritative, and the constraint that makes it work is checked.
- Good. The failure names itself, at the moment it is caused.
- Bad. Blocks an install on an otherwise compliant Node, until npm is upgraded.

### 2. Restore `npm ci`, document the floor only

- Good. No install ever fails on an engines check.
- Bad. This is the state that produced the problem. `CONTRIBUTING.md` asked for the floor and
  nothing enforced it, so a broken lockfile was one `npm install` away.

### 3. Keep the ban on `npm ci`

- Good. Nothing to change.
- Bad. Keeps a workaround whose stated cause is false, so nobody can reason about when it stops
  being needed.
- Bad. A loose install can resolve around the lockfile, which makes CI weaker than it reads.

### 4. Pin an exact npm version

- Good. Fully determined, with no range to reason about.
- Bad. The constraint is a floor. Pinning adds a recurring bump for no gain.
