# 0127: `cite add` adopts a marker written ahead of its entry

- **Status:** Implemented (#276)
- **Serves:** Two journeys.
  - Maya · M5, "Pin a claim and catch it going stale". She can name the claim
    in the page before the code it rests on exists.
  - Theo · T2, "Read a citation failure and fix it". The `marker-orphan` he
    reads has one command that clears it.
- **Depends on:** [0044](0044-citations-and-drift.md), which defines the marker
  and the anchor rule. [0056](0056-several-ids-per-marker.md), whose join this
  sits beside. [0054](0054-marker-reanchoring.md), which moves a misplaced
  marker once it names an entry.
- **Touches:** `src/cite/commands/add.ts`, `src/cite/cli.ts`,
  `src/cite/types.ts`, `docs/src/content/docs/cite/{reference/cli,reference/citations,fix/index,get-started/index}.mdx`,
  `test/cite/{add,per-page,cli.integration}.test.ts`
- **Verdict:** When a marker already names `--id` and no entry has that id, `add`
  adopts the marker, with or without `--marker`. The entry pins the text the
  marker anchors, and the page body does not change. Lines outside that text
  are refused, and the refusal names the marker's line and the lines it
  anchors. A `feat(cite):` minor release, with no new flag and no config key.

## Problem

A team can write a spec page first. Each checkable sentence gets a marker before
the code exists, and `manni cite check` reports a `marker-orphan` for each one.
That list blocks the merge, which is the point. Once a verifier confirms a claim
against the built code, the author pins it. That last step fails on 4.27.2:

```md
---
title: Retry spec
---
# Retry spec

<!-- cite retry-default retry-default-test -->
Failed requests retry 3 times by default.
```

```console
$ manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default --marker
manni: docs/design/retry.md already has a marker retry-default at line 6.
# exit 2
```

Dropping the flag is worse, because it succeeds. `add` writes an entry with claim
lines beside the marker, and the next check rejects what `add` just wrote:

```console
$ manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default
docs/design/retry.md: added retry-default to frontmatter (claim at line 17, sha256-615b564b…; source lib/limits.ts:2 "export const RETRIES = 3;", sha256-e9f5bdf9…, b1345c7)
$ manni cite check docs/design/retry.md
✗ docs/design/retry.md
    ✗ retry-default   :17 skipped   lib/limits.ts:2 current
      ✗ retry-default has claim lines and a marker. Keep one.   (line 16)
# exit 1
```

The way through today is to delete the marker, run `add --marker`, and let the
second id join what the first run wrote. So the tool can reach this exact page.
It only refuses to start from it.

The refusal guarded a real problem. Joining an id a marker already names would
write it twice into one list, which is `marker-invalid`. Adoption writes no word
at all, so that problem never comes up.

## Worked example

Maya documents this very behaviour on this repository's own site, in
`docs/src/content/docs/cite/reference/cli.mdx`. She writes the section first,
with a marker above each claim, and the check lists what she still owes:

```console
$ manni cite check docs/src/content/docs/cite/reference/cli.mdx
    ✗ add-adopts-marker   no entry has id "add-adopts-marker". Fix the marker's id, or add the entry with manni cite add.   (line 682)
    ✗ add-adopts-with-no-flag   no entry has id "add-adopts-with-no-flag". Fix the marker's id, or add the entry with manni cite add.   (line 688)
    ✗ add-adopts-refusals   no entry has id "add-adopts-refusals". Fix the marker's id, or add the entry with manni cite add.   (line 693)
1 file checked, 0 passed, 1 failed, 3 findings
# exit 1
```

The code lands, and a reviewer confirms each sentence against it. She pins them
one at a time, naming a line each marker anchors:

```console
$ manni cite add docs/src/content/docs/cite/reference/cli.mdx:683 src/cite/commands/add.ts:549-554 --id add-adopts-marker
docs/src/content/docs/cite/reference/cli.mdx: added add-adopts-marker to docs/src/content/docs/cite/reference/cli.citations.yaml:989; adopted the marker at line 682, claim pinned at lines 683-686 (sha256-9693e9c6…; source src/cite/commands/add.ts:549-554 "if (waiting !== undefined) {", sha256-…, 34c7c94)
# exit 0
```

The page's bytes do not change, because the entry goes to its manifest. After the
third add the check she started from is clean. Her to-do list has become three
pins that will catch these sentences going stale:

```console
$ manni cite check
353 files checked, 353 passed, 0 failed, 0 findings
# exit 0
```

## Decision

### 1. Adoption

`add <page>:L <src> --id X`, where a marker names `X` and no entry does. The marker
counts when the lines sit inside the text it anchors, as `check` computes that
text. The entry stores no claim lines, and its pin covers everything the marker
anchors, not only the lines named. A marker pins its whole paragraph, so this
matches what `--marker` writes everywhere else.

Nothing in the body changes, so no claim on the page moves and no line needs
shifting. A marker naming other ids still waiting is fine, and they each get a run
of their own. Every comment form in every format works alike, because this path
reads a parsed marker and writes none.

With several markers naming `X`, the first is the one that counts. That is the one
`check` anchors the id to, and the other stays a `marker-repeated` warning.

### 2. With no flag, `add` adopts

The other choice was to refuse with a message naming `--marker`. Adoption wins, for
three reasons.

- **The page has already answered the question.** The flag asks for a marker
  anchor, and the marker is there. A refusal would make someone retype a command
  to confirm what the tool can read. A switch is for what a tool cannot see.
- **Only one entry is valid.** Claim lines beside a marker are `anchor-invalid`,
  so a marker's entry is the only thing this run can write. The two spellings
  produce the same bytes, and a test holds them to that.
- **It closes the bug without a new message.** A refusal adds a sentence to learn.
  Adoption removes the failing path, and the report line says what happened.

The cost is that `add page:7` can pin more than line 7. The report line names the
lines it pinned, so that is visible at write time. It is also what the marker on
the page already says.

### 3. What is refused, and what is left alone

**Lines outside the anchored text** are refused either way. The message names the
marker's line and the lines it anchors. A person who typed a line number from
before the frontmatter grew reads the right one straight off the refusal.

**A pointer** is refused too. A pointer claim beside a marker is `anchor-invalid`,
so that entry would fail the next check.

**A quote beside a plain entry on one marker** is refused. A check calls that mix
`anchor-invalid`, and `add` has what it needs to say so first.

**A bare pin is left alone.** `add page src --id X`, with no lines, asks for no
claim. `citations.mdx` documents a marker over an entry with no `claim` as legal,
and `check` passes it. So this path still writes a source-only entry. It does
clear the orphan without pinning the sentence, which § Consequences records.

**An existing entry** keeps its refusal, `already has an entry X`.

### 4. A misplaced marker can be adopted

`add` refuses to write into a paragraph a misplaced marker splits, and tells the
reader to run `update` first. For an orphan that is a dead end, because `update`
says the marker "names no entry update can check". So the marker being adopted is
exempt. The entry pins the text below the marker, `check` reports
`marker-misplaced`, and `update` moves it and re-pins, as [0054](0054-marker-reanchoring.md)
describes.

## The interface

### Config

No key changes. The before and after config document is the same document:

```yaml
# manni.config.yaml, before and after this proposal
collections:
  - name: site
    paths: ["docs/**/*.md"]
    externalMetadata:
      - file: "{page}.citations.yaml"
        keys: [citations]
```

### Arguments and options

No argument or option is added or removed. The `--marker` help text gains one
clause, shown here whole:

```
--marker  write a cite <id> marker above the paragraph holding the page lines and pin the text it anchors; a marker already naming the id is adopted without this flag
```

### The report line

One new variant. It reads the same with and without the flag:

```
docs/design/retry.md: added retry-default to frontmatter; adopted the marker at line 15, claim pinned at line 16 (sha256-615b564b…; source lib/limits.ts:2 "export const RETRIES = 3;", sha256-e9f5bdf9…, 3f89089)
```

The manifest form varies only where the entry went, as 0056's does:

```
docs/design/retry.mdx: added retry-default to docs/design/retry.citations.yaml:3; adopted the marker at line 6, claim pinned at line 7 (…)
```

Under `--dry-run` the diff holds the entry's hunk and no body hunk, and nothing is
written. With a manifest that file is not created either.

### The messages

| Case | stderr | Exit |
|---|---|---|
| lines outside what the marker anchors, or a pointer | `manni: docs/design/retry.md already has a marker retry-default at line 6, which anchors line 7. Cite a line there, or move the marker.` | 2 |
| a marker with nothing after it | `manni: docs/design/retry.md already has a marker retry-default at line 8, which anchors nothing. Move it above the text it cites.` | 2 |
| a quote beside a plain entry on one marker | `manni: The marker at line 6 also names retry-default, and a quote entry cannot share a marker with a non-quote entry. Give the quote its own marker.` | 2 |

The refusal this removes is `manni: docs/design/retry.md already has a marker
retry-default at line 6.` Every other `add` message is unchanged. `check` output
does not change at all.

### The programmatic API

`src/index.ts` is unchanged. `src/cite/` gains one optional field.

| Export | Change |
|---|---|
| `AddResult` | gains `markerAdopted?: boolean`, set when a marker already named the id |

### The ladder

**1. The bare minimum.** The sentence is on line 7 and the marker on line 6.

```console
$ manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default
docs/design/retry.md: added retry-default to frontmatter; adopted the marker at line 15, claim pinned at line 16 (…)
# exit 0
```

**2. Naming the flag.** It prints the same line and writes the same bytes.

```console
$ manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default --marker
docs/design/retry.md: added retry-default to frontmatter; adopted the marker at line 15, claim pinned at line 16 (…)
# exit 0
```

**3. Preview it.** The diff goes to stdout, the line to stderr, and nothing is
written.

```console
$ manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default --dry-run
--- docs/design/retry.md
+++ docs/design/retry.md
@@ -2,2 +2,11 @@
 title: Retry spec
+citations:
+  - id: retry-default
+    claim:
+      integrity: sha256-615b564b23c2318e86241a652d1c2466d2efc16db9f15b798a236cd08d33a80e
+    source:
+      file: lib/limits.ts
+      lines: 2
+      integrity: sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3
+      commit-sha: 3f890897ec7b7313c81e585293d68eff3bcfd5ca
 ---
docs/design/retry.md: added retry-default to frontmatter; adopted the marker at line 15, claim pinned at line 16 (…)
# exit 0
```

**4. The second id of the list.** The frontmatter grew, so the sentence is on line 16 now.

```console
$ manni cite add docs/design/retry.md:16 lib/limits.test.ts:1 --id retry-default-test
docs/design/retry.md: added retry-default-test to frontmatter; adopted the marker at line 23, claim pinned at line 24 (…)
$ manni cite check docs/design/retry.md
✓ docs/design/retry.md
    ✓ retry-default        marker :23 current   lib/limits.ts:2 current
    ✓ retry-default-test   marker :23 current   lib/limits.test.ts:1 current

1 file checked, 1 passed, 0 failed, 0 findings
# exit 0
```

**5. The config fallback.** A collection whose manifest owns `citations` takes the
entry, and the page stays byte for byte.

```console
$ manni cite add docs/design/retry.mdx:7 lib/limits.ts:2 --id retry-default
docs/design/retry.mdx: added retry-default to docs/design/retry.citations.yaml:3; adopted the marker at line 6, claim pinned at line 7 (…)
# exit 0
```

**6. Every option at once.**

```console
$ MANNI_ENCRYPTION_KEY=$KEY manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default --marker \
    --encrypt --no-commit-sha --dry-run --as markdown --root . --repo sdk=../sdk --no-config
--- docs/design/retry.md
+++ docs/design/retry.md
@@ -2,2 +2,10 @@
 title: Retry spec
+citations:
+  - id: retry-default
+    claim:
+      integrity: sha256-615b564b23c2318e86241a652d1c2466d2efc16db9f15b798a236cd08d33a80e
+    source:
+      file: ~AbUZSpEGchJnLh1tA_VRdx1HcO7K3gQx0iHlmqfFmTkjXn5w2QL1_AhDwe-pvFo6jnwExfI_FtGFyr11Rg
+      lines: 2
+      integrity: hmac-sha256-3861135272121da43514dc0f8439c2ce477195834bd798ef821fdfc86f6ba6f4
 ---
docs/design/retry.md: added retry-default to frontmatter; adopted the marker at line 14, claim pinned at line 15 (sha256-615b564b…; source ~AbUZ…:2, hmac-sha256-38611352…, no commit)
# exit 0
```

**7. The usage errors.**

```console
$ manni cite add docs/design/retry.md:4 lib/limits.ts:2 --id retry-default
manni: docs/design/retry.md already has a marker retry-default at line 6, which anchors line 7. Cite a line there, or move the marker.
# exit 2
```

The rest are in § The messages, and each exits `2`.

## Stress test

**1. A list, pinned one id at a time.** The first run must not disturb the second
id, and the second must find the marker the first left. Both runs read the same
line and write no word of it. The orphans clear one by one.

**2. A stale line number.** After the first run the frontmatter has grown, so `add
page:7` names a frontmatter line. The frontmatter refusal would say nothing useful
about the marker. So the marker check runs before it, and the refusal gives the
line the marker anchors today.

**3. A marker on the text's own line.** `<!-- cite x --> Some claim.` anchors that
line only, and a following line of the paragraph is refused. The pin covers the
whole line, marker included, as `check` reads it.

**4. A marker whose delimiters span lines.** Joining refuses to touch this, because
respelling folds it onto one line. Adoption writes nothing there, so it is safe,
and a test holds the marker's lines unchanged.

**5. A misplaced orphan.** Keeping the misplaced-marker refusal would send the
reader to `update`, and `update` then declines. § 4 is the result, and a test runs
add, check and update through to a clean page.

**6. A bare pin.** The first draft refused it, reasoning that it clears an orphan
and pins nothing. `citations.mdx` documents that entry as legal, so a refusal would
break a page shape the tool already accepts.

**Changed as a result:** a bare pin writes what it always wrote.

**7. Two writes, one failing.** Adoption reuses the same mint, so a refused source
writes nothing. A manifest entry goes in under the same compare-and-swap as any
other `add`.

## Verification

```bash
npx vitest run test/cite                 # the adoption cases, in frontmatter and in a manifest
npm run docs:check-cli                   # cite's reference page against its program
node dist/cli.js cite check              # this repo's citations; 0 findings, exit 0
node dist/cli.js meta validate           # the dogfood gate; exit 0
vale docs/proposals/0127-add-adopts-a-marker-written-first.md   # 0 alerts
```

**Dogfood.** The new doc sentences were written with their markers first. On this
repository's docs, `manni cite check` listed six `marker-orphan` findings, and six
runs of `manni cite add` adopted them with each page's checksum unchanged. A full
check then reported 353 files and 0 findings. The transcript is in the PR
description.

## Not breaking

A `feat(cite):` minor release, in the sense 0056 was. One refusal becomes a success.
One exit-0 path becomes correct, since the entry it wrote failed the next check.

Two paths change from exit 0 to exit 2, and both wrote an entry the next check
rejected with `anchor-invalid`. They are lines outside what the marker anchors,
and a pointer. No page that passes `check` today reads differently.

## Consequences

- A bare `add page src --id X` still clears a `marker-orphan` without pinning the
  sentence, and `check` passes. A team using orphans as a gate could miss that. A
  later proposal can decide whether a bare pin beside a marker deserves a finding.
- `add --marker --quote` joining a plain marker writes the same mix this proposal
  refuses on adoption, and the next check reports `anchor-invalid`. That is 0056's
  join path, and it is left as it was here.
- One `feat:` commit ships one demo video, per the house rule. It shows the repro
  above, then the two adoptions and the clean check.

## Acceptance checklist

- [ ] `manni cite add docs/design/retry.md:7 lib/limits.ts:2 --id retry-default --marker` on the page in § Problem exits 0, prints `adopted the marker at line 15`, and leaves the page body unchanged.
- [ ] The same command with no `--marker` writes the same bytes.
- [ ] A second `add` for `retry-default-test` exits 0, and `manni cite check` then exits 0 with both rows `current`.
- [ ] Lines outside the anchored text exit 2 with `already has a marker retry-default at line 6, which anchors line 7. Cite a line there, or move the marker.`, and nothing is written.
- [ ] A marker with nothing after it exits 2 with `which anchors nothing. Move it above the text it cites.`
- [ ] A quote beside a plain entry on one marker exits 2 with `also names`, and nothing is written.
- [ ] A pointer add naming a marker's id exits 2 with the anchors refusal.
- [ ] A bare `add page src --id X` beside a marker still exits 0 and writes a source-only entry.
- [ ] `already has an entry X` is unchanged.
- [ ] `--dry-run` writes nothing, in frontmatter and in a manifest, and creates no manifest.
- [ ] In a `{page}.citations.yaml` collection the entry goes to the manifest and the page stays byte for byte.
- [ ] `<!-- cite x -->`, `[comment]: # (cite x)`, `{/* cite x */}`, `// (cite x)` and `.. (cite x)` are all adopted.
- [ ] A misplaced orphan is adopted, and `manni cite update` then moves it to a clean check.
- [ ] `AddResult.markerAdopted` is set on adoption and absent otherwise.
- [ ] `test/cite/add.test.ts`, `test/cite/per-page.test.ts` and `test/cite/cli.integration.test.ts` pin the above.
- [ ] `docs/src/content/docs/cite/reference/cli.mdx`, `reference/citations.mdx`, `fix/index.mdx` and `get-started/index.mdx` describe it, and `npm run docs:check-cli` passes.
- [ ] `docs/proposals/README.md` carries this proposal's row.
- [ ] The dogfood transcript is pasted into the PR description, ending in `0 findings`.
- [ ] The demo video's sources are under `media/`, and the MP4 is handed over outside git.
