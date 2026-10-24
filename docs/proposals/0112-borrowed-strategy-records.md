# 0112: Borrowed strategy records

- **Status:** Proposed
- **Serves:** Sara · S21, "Share one strategy across docs sets". Several
  repositories read one set of records, and each check reports only what its
  own repository can fix.
- **Depends on:** Four earlier proposals.
  - [0041](0041-collections.md) draws the boundary. A path outside the config
    directory is a member of nothing.
  - [0058](0058-a-manifest-per-page.md) keeps every `{page}` sidecar inside the
    config directory.
  - [0100](0100-citations-from-more-than-one-checkout.md) set up side by side
    checkouts, relative to the config file.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    is the strategy domain and its six rules.
- **Extends:** 0102 decision 4, the six rules, and
  [0106](0106-a-journeys-steps-name-the-pages-that-carry-it.md)'s step states.
- **Supersedes in part:** [0107](0107-a-page-read-brings-the-records-it-names.md).
  [What this supersedes](#what-this-supersedes) names the passage.
- **Touches:** `src/strategy/core/check.ts`, `src/strategy/core/steps.ts`,
  `src/strategy/commands/`, `src/strategy/reporters/`,
  `src/meta/commands/fill-hints.ts`, `src/meta/commands/get.ts`, and the
  strategy pages.

## Problem

Several docsets serve the same readers. The plugin's docs, a second product
and a team handbook all write for Maya, Devin, Sara and Theo. Each repository
keeps its own copy of the records, so "Maya" drifts per repository. Nobody
can say which journeys any product serves.

A collection can already reach another checkout. A `../manni/` path or glob
walks, and `manni strategy` reads a collection's paths without filtering to
members. So this config works on 4.20.0:

```yaml
collections:
  - name: strategy
    paths: ["../manni/docs/content-strategy/{audiences,personas,journeys}/*.md"]
```

What breaks is the rules. `strategy check` treats every record it reads as
its own.

- **Someone else's debt reports here.** A journey only manni serves is an
  `unserved-journey` in every other product. Copying manni's
  `unserved-journey: error` turns the consumer red for good.
- **The findings point outside the repository.** `-f github` annotates
  `file=../manni/…`, which no pull request diff holds. JUnit gets a testcase
  for every borrowed file.
- **The owner's mistakes fail every consumer.** A typo in a shared journey's
  `personas:` is an error in every repository that reads it, and none can fix
  it.
- **The advice for a stale copy keeps the copy.** A kept `personas/maya.md`
  gets `Give each record its own id.` Renaming it gives two Mayas.

## Worked example

Sara owns `docs/content-strategy/` in this repository. The plugin's docs move
to `manni-plugin`, checked out beside `manni`. It has three pages serving
`m1`, `t1` with its own `p1`, and `d16`. It kept a copy of `maya.md` from last
spring.

She points the plugin's `strategy` collection at manni's three folders, as
directories, and at its own `strategy/`. `check` names the copy, and only the
copy:

```console
$ manni strategy check
strategy/personas/maya.md:3
  error   manni:strategy/duplicate-id         id: "maya" is also the id of ../manni/docs/content-strategy/personas/maya.md:3.
                                              That record is borrowed from outside this repository.
                                              Remove this copy, or give it its own id.
                                              manni:strategy duplicate-id: Two records share an id, ignoring case.
                                              Guide: https://hawkeyexl.github.io/manni/strategy/reference/rules/#duplicate-id

1 error in 85 records (83 borrowed)
```

It exits `1`. The twin finding on manni's `maya.md` is not reported. Neither
are the 72 manni journeys the plugin does not serve. She removes the copy:

```console
$ git rm -q strategy/personas/maya.md
$ manni strategy check
✓ 84 records (83 borrowed), 90 references, no findings
```

`p1` is owned, so its rules still run. Had no page named it, `check` would
report `unserved-journey` on `strategy/journeys/p1.md:3`. `manni strategy get
maya` prints manni's record, read from
`../manni/docs/content-strategy/personas/maya.md:1`. Its `pages` row lists
`docs/setup.md`, the plugin page that names her.

Coverage across both is data. Each repository's `strategy list -f json` lists
every record with the pages that name it, and one `jq` joins them by id:

```text
{"id":"d16","pages":{"manni":3,"manni-plugin":1}}
{"id":"m1","pages":{"manni":10,"manni-plugin":1}}
{"id":"p1","pages":{"manni-plugin":1}}
{"id":"t1","pages":{"manni":4,"manni-plugin":1}}
```

"Maya" is one record, read by both repositories. Each `check` reports only
what its own repository can fix.

## Decision

### 0. Only where a record is borrowed

Nothing switches it on, and the file's location is the whole test. Where
every file a run reads is inside the run's directory, `manni strategy` prints
what it printed before, byte for byte, in every format. That covers this
repository and every repository today.

### 1. A file outside the run's directory is borrowed

The run's directory is the config file's directory, or the working directory
when no config file governs the run. A file whose path from there starts with
a `..` segment, or sits on another drive, is borrowed. That is the boundary
`isMember` draws in 0041. No key says a file is borrowed.

A path typed on the command line resolves from the working directory. So a
run over typed paths also owns the working directory. Without that, `-c`
naming a config file in a subdirectory would borrow every typed path.

### 2. `check` files no finding in a borrowed file

A finding whose file is borrowed is dropped before its level applies. So no
baseline, annotation, SARIF result or JUnit testcase names a borrowed file.

| Rule | On owned pages and records | In a borrowed file |
|---|---|---|
| `undefined-reference` | Reported. Values resolve against owned and borrowed records alike. | Not reported. Its owner's check reports it. |
| `duplicate-id` | Reported on each owned record. When every other record with the id is borrowed, the fix says to remove the copy. | Not reported. |
| `missing-parent` | Reported. Parents come from borrowed records too. | Records are not pages, so it never applies. |
| `orphan-record` | Reported. An owned journey under borrowed personas is checked. | Not reported. |
| `unserved-journey` | Reported for owned journeys. A borrowed page that names one counts. | Not reported. |
| `unused-record` | Reported for owned records. | Not reported. |
| the four step rules | As 0106 says. | No step fires, because each step is `unchecked`. |

The `duplicate-id` fix for a copy of a borrowed record:

```text
id: "maya" is also the id of ../manni/docs/content-strategy/personas/maya.md:3. That record is borrowed from outside this repository. Remove this copy, or give it its own id.
```

When another owned record shares the id too, each owned record keeps the old
fix. The text before the fix is the baseline key, so it does not change.

### 3. The summary counts the borrowed records

Pretty adds ` (N borrowed)` after the record count, on the clean line and on
the summary line. JSON adds `summary.borrowed` after `records`. Both appear
only when N is above zero. `records` and `references` still count borrowed
ones. `steps` counts the owned journeys' steps only, since only they are held
to their pages.

### 4. A borrowed journey's steps are `unchecked`

A borrowed journey's steps name its owner's pages, which this run does not
hold. Each step's state is `unchecked`, with no `page`. `get` shows the steps
with no coverage line, its JSON carries no `coverage`, and `list` leaves the
`steps` cell blank.

### 5. `meta get` names borrowed records

`meta get`'s record walk reads each collection's paths as strategy does. It
keeps a file above the config directory, and still drops a collection's
`exclude:`. A consumer page's `personas: [maya]` names
`persona maya ../manni/docs/content-strategy/personas/maya.md`. `meta fill`'s
page-id walk keeps members only.

### 6. No new surface

No key, flag, verb or schema is added. Borrowed folders are ordinary
`collections[].paths` entries. Positional paths override them per run. A
records-only shared repository sets `unserved-journey: off`. A consumer
validates its own records against the owner's schema by path, through the
sibling checkout.

## Known limits

- A checkout nested inside the run's directory reads as owned, and so does a
  symlink into another checkout. The docs say to check out side by side.
- Two borrowed records that share an id resolve to the first one read, and
  nothing reports it.
- A glob over a missing checkout matches nothing, which is not an error. The
  docs and examples use directories, which stop the run with exit `2`.
- An owned journey id can collide across consumers in the join. The docs
  suggest a product prefix.
- An upstream rename lands in every consumer at once. Pin the second checkout
  with `ref:`.
- Meta's not-found message says named paths resolve from the working
  directory. A collection path resolves from the config file.

## Rejected

- **`strategy.repos` or `--repo name=dir`, after `cite.repos`.** A cite entry
  records its repository because a pin must survive another layout. A
  strategy reference is an id, and nothing persisted names a checkout.
- **A URL source for records.** A fetch path would land in every tool that
  reads collections. A CI checkout does the job.
- **Records shipped as an npm package.** Every walk prunes `node_modules`.
- **A switch marking a collection borrowed.** The location already says it.
- **Turning `unserved-journey` and `unused-record` off in consumers.** It
  hides the consumer's own journeys, and still fails on the owner's errors.
- **The owner checks every product's pages.** Sidecars never resolve above
  the config directory, so coverage would undercount.
- **A `strategy coverage` verb.** One `jq` over existing JSON does the join.
- **A per-record `borrowed` flag in `list` and `get` JSON.** `file` already
  says where the record came from.
- **Detecting a nested git checkout as borrowed.** It fixes one layout at the
  cost of a second rule.

## What this supersedes

- In 0107's decision 1, "A record is a member of a declared collection". A
  record is now any file a collection's paths reach, borrowed ones included.

## Verification

- From `test/fixtures/strategy/shared/consumer/`, `manni strategy check`
  exits `0`, and its line counts the owner's record files as borrowed.
- There, `-f json` carries `summary.borrowed`, and no finding, annotation or
  testcase names `../owner`.
- A kept copy of a borrowed record draws the borrowed `duplicate-id` fix and
  exits `1`. An owned duplicate keeps the old fix.
- `manni strategy get j1` there shows each step `unchecked`, with no coverage
  line. `manni meta get personas docs/page.md` names the borrowed `maya`.
- This repository's `manni strategy check` prints what it printed before, in
  every format.
