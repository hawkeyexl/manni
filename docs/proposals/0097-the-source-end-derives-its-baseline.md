# 0097: the source end derives its baseline

- **Status:** Implemented
- **Serves:** Two citation journeys in `../content-strategy/cujs.md`.
  - Theo · T2, "Read a citation failure and fix it". A finding names a commit
    main took, and its advice works.
  - Devin · D5, "Gate citations in CI". A squash merge stops turning a rename
    into a red build.
- **Depends on:** [0053](0053-claim-history.md), whose walk the claim end
  already runs and the source end now runs too.
- **Supersedes in part:** [0044](0044-citations-and-drift.md),
  [0053](0053-claim-history.md) and [0055](0055-following-a-source.md).
  [What this supersedes](#what-this-supersedes) names each section.
  - 0044 loses its `source-never-true` row, the meaning of
    `source.commit-sha`, and the one `git show` in Economics.
  - 0053 loses the last sentence of stress test 3's "Changed as a result".
  - 0055 loses where the cross-file follow's candidate list starts.
- **Touches:** `src/cite/core/classify.ts`, `src/cite/core/adapt.ts`,
  `src/cite/core/check-page.ts`, `src/cite/core/git.ts`,
  `src/cite/core/reencrypt.ts`, `src/cite/commands/update.ts`,
  `src/cite/reporters/json.ts`, and the cite pages under
  `docs/src/content/docs/cite/`

## Problem

`cite add` and `cite update` record `commit-sha: HEAD`. On a pull request
branch, HEAD is a branch commit. A squash or rebase merge leaves that commit
out of main.

Nothing shows while the source is current. `check` matches the working tree
before it reads the commit. Once the host deletes the branch, a fresh clone
lacks the object. The next edit to the pinned lines then does damage.

| What breaks | Why |
|---|---|
| A renamed source reads `missing`, not `moved`. | The cross-file follow of 0055 needs the old text, which came from the lost commit. |
| `never-true` disappears. | It falls to `changed (history unavailable: commit d8a6f25 not found; fetch-depth: 0)`. |
| `update --accept` loses its span. | The span comes from the old first and last line, read at the lost commit. |
| `key rotate` cannot re-key a pin that no longer holds. | It reads the old lines at the recorded commit. |
| The advice cannot work. | `fetch-depth: 0` never brings back a commit a squash deleted. |
| The wrong commit gets named. | While the branch exists, findings say "changed since d8a6f25", a commit main never took. They count the identical squash commit as a change. |
| `update --recommit` makes it worse. | It records HEAD, so a run on a branch makes the next orphan. |

This repo hit it in PR #213. `cite update` re-pinned
`action-major-tag-moves-on-each-release` at the branch tip `d8a6f25`. GitHub
squash-merged the PR as `26dad159`. `release.yml` is byte-identical at both.
Before #200, 847 entries carried 12 such orphans. #200 swept them up by hand
across 826 lines.

The claim end has not had this problem since 0053. It stores no commit. It
walks the page's history and takes the newest commit whose page held the pin.

## The rule

The source end derives its baseline the same way. The recorded commit becomes
a hint.

1. **The fast path stays.** The recorded `commit-sha` is read first when it is
   an ancestor of HEAD. If it holds the pin there, it is the baseline. That is
   one `git show`, as today.
2. **Otherwise, walk.** `check` reads `git log --topo-order HEAD -- <path>`,
   newest first, up to 256 commits. The newest commit that holds the pin is
   the baseline. A commit where the path is absent is walked past, so a rename
   or a deletion does not end the walk.
3. **One meaning for `never-true`.** It is reported when the walk reached the
   file's first commit and no commit held the pin. The clone must not be
   shallow and the cap must not be hit. What `commit-sha` says does not matter.
4. **Everything downstream reads the baseline.** That covers the cross-file
   follow, the `--accept` span, `commitsSince`, the diff and `key rotate`. A
   rename in a squashed clone reads `moved` again.
5. **`add` and `update` keep recording HEAD.** The schema does not change. On
   a branch nothing better exists yet, because the squash commit is made at
   merge. A stale value is harmless now.
6. **`update --recommit` inherits the squash commit.** It records the commit
   where the pinned lines arrived on HEAD's history. That is the oldest commit
   in the newest unbroken run that holds the pin. After a squash merge it is
   the squash commit. Run twice, it records the same value.
7. **`check` does not report an orphaned `commit-sha`.** It changes no
   verdict, and a notice would only push people to churn their manifests.
8. **No config key and no flag.** The baseline is detected from git, and exit
   codes do not change.

"Holds the pin" means what it meant at the recorded commit. The recorded lines
are tried first, then the rest of the file at that commit. `update` follows a
move inside a file without advancing `commit-sha`, so the pinned bytes may sit
elsewhere at an older commit.

## Interface

**Config.** No change. `source.commit-sha` keeps its name and type. Its
meaning moves from "the commit the pin was taken at" to "where the pin was
minted, a hint".

**CLI.** One help string changes.

| Option | Before | After |
|---|---|---|
| `cite update --recommit` | `re-record commit-sha where the recorded commit does not contain the pinned lines, or is outside HEAD's history` | `re-record commit-sha to the commit where the pinned lines arrived on HEAD's history, where the recorded commit does not contain them or is outside that history` |

**Messages.** Exit codes stay 0, 1 and 2. The remedies do not change.

| Where | Before | After |
|---|---|---|
| `source-changed`, history read | `changed since d8a6f25, 2 commits; now at lines 367-372` | `changed since 26dad15, 1 commit; now at lines 367-372` |
| `source-changed`, history ran out | `changed (history unavailable: commit d8a6f25 not found; fetch-depth: 0)` | `changed (history unavailable; fetch-depth: 0)` |
| `source-never-true` | `never true: the pin does not match at d8a6f25` | `never true: the pin held at no commit in the history of .github/workflows/release.yml` |
| `source-never-true` rule description | `The pin does not match even at the commit it records.` | `The pin held at no commit in the source's history.` |
| renamed source, fresh clone after a squash | `missing` | `moved -> <newSrc>` |
| stderr notice, unreachable commit | `commit d8a6f25 not found in history; use fetch-depth: 0 to enable never-true and diffs` | retired |
| stderr notice, shallow clone or the cap | none | `the source history ends before the pin held; use fetch-depth: 0 to tell never-true from changed` |
| `update --recommit` row | `source release.yml:367-372 commit d8a6f25 -> <HEAD7> (not in this branch's history)` | `source release.yml:367-372 commit d8a6f25 -> 26dad15 (not in this branch's history)` |

**Output.** `cite check -f json` gains one member on each `source`. Nothing is
renamed.

```jsonc
"source": {
  "status": "changed",
  "commitSha": "d8a6f253…",
  "baselineSha": "26dad159…",
  "historyAvailable": true
}
```

`commitSha` is what the entry says. `baselineSha` is the full hash the verdict
was read against. It is absent when the pin is current, when git is not
available, or when the walk ran out.

**Programmatic API.** `SourceEnd` gains `baselineSha?: string`.
`SOURCE_HISTORY_UNAVAILABLE` is exported beside `PAGE_HISTORY_UNAVAILABLE`.
The retired notice was an inline string, so nothing is removed.

## Stress test

### 1. A branch that still exists

Before the host deletes the branch, `d8a6f25` is in the clone. Today's check
reads it, finds the pin, and names it. That commit is not in main's history,
so the fast path now skips it. The walk finds `26dad159` and counts the
commits after it. So the squash commit with identical bytes is no longer
counted as a change.

### 2. A merge commit

A `--no-ff` merge keeps the branch commit in main's history. The fast path
takes it, with no walk. A test counts the git calls to hold that.

### 3. A shallow clone

A depth-1 clone lists one commit for the path. If it does not hold the pin,
the walk runs out in a shallow clone. That is `history unavailable`, never
`never-true`. The notice now says what `fetch-depth: 0` buys, which is telling
the two apart. It no longer promises to bring back a commit.

### 4. A long history

A file with more than 256 commits after the pin stops at the cap. It reads as
a shallow clone does. The claim end has the same cap and the same answer.

### 5. Cost

A pin that holds today reads no history. A changed pin usually finds its
baseline within a few commits. Only a pin that never held walks to the start.
`git show` is memoized per commit and path, so many pins on one file share
the reads. The 64 MiB hashing budget is one counter per citation, as before.

### 6. Why not stop recording HEAD?

A branch has nothing better to record. The squash commit does not exist until
the merge. A post-merge job could rewrite the manifests, but that needs a
write token, a bot commit after every merge and a second CI run. The read side
no longer needs it.

## What this supersedes

- **0053, stress test 3, "Changed as a result".** Its last sentence says the
  source end keeps `commit-sha` because a source may live in another checkout.
  The walk runs in that checkout too, so the reason no longer holds.
- **0044, the drift-check contract.** `source-never-true` meant the pin did
  not hold at `commit-sha`. It now means the pin held at no commit in the
  source's history. `source.commit-sha` is a hint, not the commit the pin was
  taken at. Economics said a non-match costs one `git show`. That is the fast
  path, and a walk costs one per commit read.
- **0055, the candidate list.** `git diff --name-only <commit> HEAD` now
  starts from the baseline, not from the recorded commit.

`--recommit` (#116, #122) had no proposal. Its new behavior is recorded here,
under rule 6.

## Verification

- A squash fixture in `test/cite/` is built at test time. The mint commit is
  pruned, and no `.git` is committed. An edited source reads
  `changed since <squash7>, 1 commit`, a rename reads `moved`, and a pin that
  never held reads `never-true`.
- A depth-1 clone reads `history unavailable` with the notice said once.
- A rebase merge and a cherry-pick each derive the new commit. A merge commit
  takes the fast path with no walk.
- `update --recommit` records the squash commit, and a second run rewrites
  nothing.
- On this repo, `cite update --recommit docs/` moves
  `action-major-tag-moves-on-each-release` from `d8a6f25` to `26dad159`.
