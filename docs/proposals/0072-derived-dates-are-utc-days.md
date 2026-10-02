# 0072: derived dates are UTC days

- **Status:** Implemented (#147)
- **Serves:** Devin · D4, whose gate compares the stamps, and Maya · M2, who
  reads `last-updated` to know when a page last changed.
- **Depends on:** [0040](0040-derived-metadata.md), which derives `created`,
  `last-updated` and `last-reviewed` from git. [0069](0069-merge-safe-stamps.md),
  which keeps those stamps current after a squash merge.
- **Supersedes, in part:** [0040](0040-derived-metadata.md), for the day a
  commit's date names, and for the day "today" is. The Status line is the
  only edit.
- **Touches:** `src/meta/core/derive/**`, `test/**`,
  `docs/src/content/docs/**`
- **Verdict:** A derived date is the commit's instant as a UTC day. Today is
  the UTC day too. A stamp derived the old way reads stale once, where the
  two days differ, and derive rewrites it.

## Problem

0040 dates a commit by its author date, in the author's own offset. One
instant then names two days. A commit made at 17:40 at -07:00 on 1 October
is 00:40 UTC on 2 October.

That held until two commits recorded the same body. On a pull request
branch, a merge of main dated the body 1 October, in its author's offset.
After the squash, main's history held the release commit instead, made at
00:40 UTC. The stamp said 1 October and git said 2 October, so
`meta validate` failed on main.

"Today" had the same flaw. A body change not yet committed was dated by the
machine's local clock. A page stamped in California in the evening read
stale on a CI runner, which keeps UTC, once UTC midnight had passed.

## Decision

1. **A commit's date is its UTC day.** `created`, `last-updated` and the
   trailer fallback of `last-reviewed` take the author date as an instant
   and name its day in UTC.
2. **Today is the UTC day.** An uncommitted body change is dated by the
   clock, read in UTC.
3. **A stamp derived the old way reads stale once.** Where the author's day
   and the UTC day differ, `validate` reports the stamp stale and `derive`
   rewrites it. Everywhere else the two agree, and nothing changes.

The rule holds wherever a derived date is computed or compared. That covers
`derive`, the stale check in `validate`, and the derived values `get` and
`query` read. A review date from GitHub or GitLab was already a UTC day, so
every derived date now uses one calendar.

## Stress test

1. **A commit in the evening, west of Greenwich.** 23:30 at -07:00 on 1
   January dates 2 January. That is the day the commit reached any machine in
   UTC.
2. **The squash on main.** A branch's merge commit and main's release commit
   record one body at nearly the same instant. Both now name the same day,
   unless the instants themselves straddle UTC midnight.
3. **A page edited after UTC midnight and before local midnight.** Its stamp
   now names tomorrow, as seen by its author. The stamp names the day the
   change reached the repository's calendar, and that calendar is UTC.
4. **This repository.** Its pages were stamped in the authors' offsets. The
   change re-dates 60 fields across 58 pages once, in the PR that makes it.
5. **A team that wants local days.** There is no switch. A stamp that names
   a different day on two machines cannot be checked in CI, and checking it
   in CI is what derive is for.

## Open questions

None.
