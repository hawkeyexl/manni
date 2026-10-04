---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Clear inherited GIT_* variables before reading git history

## Context and Problem Statement

`collectGitHistory` shells out to `git log`, and the exec seam passed the
ambient environment straight through. git exports `GIT_DIR`, `GIT_INDEX_FILE`,
`GIT_WORK_TREE` and related variables to every subprocess it spawns. Most
notably to hooks, and to anything a hook runs.

So when dockg ran anywhere beneath a git invocation, `git log` read *that*
repository rather than the directory dockg was pointed at. Two failures follow:

- A build with `provenance.git: true` produced a **different graph** depending
  on who invoked it. Measured on a one-document fixture: 25 triples run
  directly, 18 with an ambient `GIT_DIR`.
- A build outside any repository **silently succeeded** against an unrelated
  one instead of erroring, contradicting the documented exit-2 contract.

The first is a direct breach of the product contract: same inputs, same commit,
different bytes. Determinism was being defined only up to the caller's
environment, which is not determinism.

This was found when the new husky `pre-push` hook ran the test suite and four
tests failed that pass under `npm test`. The hook was the first context that
ran the suite underneath git.

## Decision Drivers

- Determinism is the product contract; ambient state must not reach output.
- Failing loudly beats silently reading the wrong repository.
- git keeps adding variables to the `GIT_*` namespace.

## Considered Options

1. Leave it; document that dockg must not run from a git hook.
2. Unset a hand-picked list (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`).
3. Drop the whole `GIT_*` namespace for the git subprocess (chosen).
4. Pass `--git-dir`/`-C` explicitly instead of relying on `cwd`.

## Decision Outcome

Chosen option 3. `collectGitHistory` builds an override map setting every
ambient `GIT_*` key to `undefined`. The exec seam treats an explicit
`undefined` as "unset this variable" rather than "leave it alone". That is a
general mechanism, since the previous `{ ...process.env, ...opts.env }` merge
could add and replace variables but never remove one.

Enumerating a fixed list was rejected because it silently rots. git has added
variables to this namespace repeatedly, and each addition would reintroduce the
bug for whichever caller happened to export it.

The test fixtures had the same defect for the same reason. They spread
`process.env` into their own `git init`/`add`/`commit` calls. So a shared
`hermeticEnv` helper (`test/helpers/git-env.ts`) strips `GIT_*` there too,
applying deliberate `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE` overrides after the
strip.

### Consequences

- Good. Git provenance now depends only on `cwd` and the commit, as documented.
- Good. `npm test` passes identically whether or not it runs under a hook.
- Neutral. A caller that genuinely wanted to redirect dockg via `GIT_DIR` can
  no longer do so. `cwd` is the single supported control, which is what the
  documentation always claimed.
- Risk. The exec seam's `undefined`-means-unset rule is easy to misread as
  "no override". The behaviour is stated on the `ExecFn` type and exercised by
  a unit test.

### Confirmation

Both regression tests were confirmed red against the unfixed code and green
after. One is a unit test asserting the exec seam receives `GIT_*` keys with
`undefined` values. The other builds with `provenance.git` under an ambient
`GIT_DIR` and requires exit 2. That test points `GIT_DIR` at a throwaway decoy
repository with one commit, not at this repository. The decoy needs a commit,
or the build would fail for want of history and pass while broken. The full suite passes both normally and with a hostile `GIT_DIR`
exported (163/163 in both), and the determinism and golden gates are unchanged.
