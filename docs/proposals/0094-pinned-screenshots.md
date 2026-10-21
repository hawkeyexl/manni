# 0094: A screenshot is pinned to the step that takes it

- **Status:** Rejected
- **Recommendation:** Do not build here. The user judged this a problem
  better solved in Doc Detective itself, on 2026-10-21.
- **Serves:** Three people.
  - Maya · a new M28, "Keep the screenshots true to the product". She ships
    pages with screenshots of a UI that changes under them.
  - Devin · D17, "Gate the docs' procedure tests with the same contract". A
    drifted screenshot passes his gate today.
  - Theo · a new T9, "Read a screenshot drift and decide". He needs to know
    whether to accept the new capture or fix something.
- **Depends on:** Three proposals.
  - [0085](0085-test-domain-runs-doc-detective.md) gave Doc Detective a home
    in `manni test run`. This proposal extends that verb and adds one more.
  - [0044](0044-citations-and-drift.md) is the pin and its accept flow.
    `cite update --accept` is the model for `test update --accept`.
  - [0058](0058-a-manifest-per-page.md) and
    [0060](0060-a-manifest-per-page-as-built.md) are the per-page manifest a
    screenshot's pin is written to.
- **Relates to:** Five more.
  - [0041](0041-collections.md) put document sets in `collections:`. An image
    joins one the way a page does.
  - [0047](0047-field-location.md) marks fields `external`. The new
    vocabulary's one field is.
  - [0089](0089-findings-say-what-to-do.md) is the finding contract the new
    rules follow.
  - [0078](0078-family-check-status-and-claude-code-plugin.md) keeps `test`
    out of `manni check`. This proposal does not change that.
  - [0090](0090-served-passages-carry-their-proof.md) gives each served
    passage a provenance record with its pins. A screenshot is not a passage,
    so this proposal adds nothing to that record.
- **Supersedes in part:** [0031](0031-input-formats-notebooks-and-markdoc.md),
  its "Standalone .json and .yaml" rejection, for collection membership only.
  Section 2 says what changes and what stands.
- **Touches:** `src/test/**`, `src/meta/core/load-files.ts`,
  `src/meta/extractors/index.ts`, `src/meta/schemas/screenshot/`,
  `src/meta/schemas/manifest.json`, `docs/public/schemas/screenshot/`,
  `src/shared/pin.ts`, `test/test/**`, `test/fixtures/`,
  `docs/src/content/docs/test/**`,
  `docs/src/content/docs/meta/reference/{configuration,formats}.mdx`,
  `docs/src/content/docs/meta/reference/schemas/`,
  `docs/content-strategy/{cujs,information-architecture}.md`
- **Verdict:** A screenshot carries a pin in its own manifest. The pin names
  the Doc Detective step that takes it, with an integrity hash at each end.
  `manni test run` reports a drifted capture as an error. `manni test update
  --accept` re-mints the pin. An image, a PDF or an OpenAPI file joins a
  collection as an asset, with metadata from its manifest alone.

## Problem

A screenshot in a page is a copy of the product's UI. "Pin, don't copy" says
to refer to content by lines and an integrity hash, and never to copy it. A
screenshot cannot be a reference, because a reader needs the picture. So the
next best thing is a copy that is retaken and checked on every run, with a
pin saying which procedure takes it.

Doc Detective already retakes and compares. Four gaps stay between that and a
pin.

- **Drift does not fail.** A capture past `maxVariation` is a `WARNING`.
  `manni test run` passes a warning, as 0085 decided for every Doc Detective
  warning. A UI change that makes every screenshot wrong exits `0`.
- **Drift is written over in silence.** The default `overwrite` is
  `aboveVariation`. A drifted capture replaces the reference image, and the
  run says only "warning". Nothing records which image the docs accepted.
- **Nothing links an image to its step.** The step names the image's path. The
  image names nothing. Delete the step, and the image becomes a plain copy
  that no run retakes, with no finding.
- **An image has no metadata in manni.** Every manifest entry must match a
  loaded document, and only files an extractor reads are loaded. A PNG, a PDF
  or an OpenAPI file can carry no owner, no review date and no pin.

The last gap is wider than screenshots. A team that owns an OpenAPI file
cannot record its owner where `manni meta` reads owners.

## What Doc Detective already does

Doc Detective 4.26.0 was run on a sample page to confirm its behavior. The
page was served on `localhost`, and one test held a `goTo` and a
`screenshot` step with `maxVariation: 0.05`.

| Run | The UI | `overwrite` | Step result | Exit | The image on disk |
|---|---|---|---|---|---|
| 1 | as authored | unset | `PASS`, "Saved screenshot." | 0 | written, `changed: true` |
| 2 | unchanged | unset | `PASS`, variation `0` | 0 | kept |
| 3 | new title and colors | unset | `WARNING`, variation `0.966` | 0 | replaced, `changed: true` |
| 4 | reverted | `"false"` | `SKIPPED`, "File already exists" | 0 | kept, never compared |

The source of `saveScreenshot` confirms the rest.

- `maxVariation` defaults to `0.05`, and `overwrite` defaults to
  `aboveVariation`.
- Within the tolerance, the new capture is deleted and the reference stays
  byte for byte.
- A changed aspect ratio is a `FAIL`, and the reference is kept.
- `overwrite: "true"` replaces the reference on every run with no comparison.
- An `http(s)` path is a read-only reference, and the capture goes to a run
  folder.
- The result's `outputs` carry `screenshotPath`, `changed`, `variation` and
  `aspectRatioMatch`.

So Doc Detective owns the capture, the crop, the pixel comparison and the
tolerance. manni adds what it lacks. That is the pin record, a gating
finding, and an accept flow.

## What this repository has today

No page under `docs/` embeds an image, and no file under `docs/` is one. All
561 inline steps are `runShell`, because manni is a CLI. The 94 PNG and 20 GIF
files under `media/` are demo-video assets. Remotion renders them from
terminal captures, and no Doc Detective step takes them.

So this repository is not the first user. The feature serves teams that
document a UI. It is tested here on fixtures under `test/test/fixtures/`.

## Decision

### 1. The pin lives in the image's manifest

Three homes were weighed.

| Home | Verdict |
|---|---|
| The image's own manifest | **Chosen.** The pin is a fact about the image. It holds however many pages embed it, and it is where the image's other metadata goes. |
| The manifest of the page that embeds it | Rejected. Two pages that embed one image would carry two pins for one fact, and an accept would have to find both. |
| The Doc Detective step | Rejected. Doc Detective validates its steps, so the pin would depend on its schema. An accept would rewrite JSON inside a comment in prose. |

The step already names the image by its `path`. That direction is a
reference, so the pin adds only the other direction and the two hashes.

### 2. An image joins a collection as an asset

An **asset** is a file no extractor reads that a run loads anyway. Its
metadata in the file is always empty. Every field it has comes from a
manifest. Schemas, `meta validate`, `meta get`, `meta query`, overrides and
`x-manni-location` treat it as any other document.

A file is an asset when both of these hold.

1. No extractor reads its extension.
2. The path or glob that found it names that extension.

A typed file path names its own extension. A glob names the extensions it
spells, so `**/*.png` and `**/*.{png,pdf}` load images, and `--ext png` names
`.png`. A directory names none. So `manni meta validate docs/` walks pages
only, as it does today.

A file the run reads as a manifest is never an asset. So `api/*.yaml` finds
`api/openapi.yaml` and skips `api/openapi.meta.yaml`.

`meta` and `test` read assets. lint, cite, term, graph, docevals and a11y load
only the files they read today, so an asset in their collection is skipped.

**What this does to 0031.** 0031 rejected standalone `.json` and `.yaml` as
documents, and `.txt` with them. Its reason was that a data file has no
extraction step, and its content is better validated by `check-jsonschema`.
That reason stands. An asset's content is never read, extracted or validated.
What changes is the verdict's reach. A data file can now be a collection
member, with metadata from its manifest. 0031's `Status:` line becomes
`Superseded in part by 0094` when this proposal is implemented.

### 3. The `manni:screenshot` vocabulary

A new built-in vocabulary, `manni:screenshot:1.0.0`, defines one field. It is
not a default schema. A collection opts in through an override.

```yaml
# docs/src/assets/screenshots/settings.meta.yaml
docs/src/assets/screenshots/settings.png:
  screenshot:
    integrity: sha256-4a7912e873b9...       # the accepted capture's bytes
    step:
      file: docs/src/content/docs/guides/settings.mdx
      id: settings-page                      # the Doc Detective stepId
      integrity: sha256-0c1d77a9e4f2...     # the step's source lines
```

| Key | Type | Required | Effect |
|---|---|---|---|
| `screenshot` | object | no | Marks the asset as a capture that a Doc Detective step takes. `x-manni-location: external`. |
| `screenshot.integrity` | string, `sha256-` and 64 hex | no | The hash of the image's bytes at the last mint or accept. `test update` writes it. |
| `screenshot.step.file` | string, a path relative to the config file | yes | The page or spec file that holds the step. |
| `screenshot.step.id` | string | yes | The step's `stepId`. It locates the step wherever it moves in the file. |
| `screenshot.step.integrity` | string, `sha256-` and 64 hex | no | The hash of the lines that hold the step, joined with LF, as cite hashes a source range. `test update` writes it. |

Each end is a locator and a hash, which is the cite mechanism. cite's
locator is a line range, because source code has no ids. A step has an id, so
the id locates it and no line range is stored.

The author writes `step.file` and `step.id`, and `manni test update` mints the
two hashes. A pin with no hash yet is reported, as section 5 lists.

The page embeds the image as it does today, beside the step that takes it.

```mdx
{/* step {"stepId":"settings-page","screenshot":{"path":"docs/src/assets/screenshots/settings.png","maxVariation":0.05}} */}

![The Settings page, with Save at the bottom right.](../../../assets/screenshots/settings.png)
```

### 4. Config, before and after

No config key is added or changed. A collection of images and an override
naming the vocabulary are all a repository writes.

Before:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    externalMetadata:
      - file: "{page}.meta.yaml"

tools:
  doc-detective:
    config: .doc-detective.json
```

After:

```yaml
collections:
  - name: site
    paths:
      - "docs/src/content/docs/**/*.{md,mdx}"
    externalMetadata:
      - file: "{page}.meta.yaml"
  - name: screenshots                       # new: assets, by section 2
    paths:
      - "docs/src/assets/screenshots/**/*.png"
    externalMetadata:
      - file: "{page}.meta.yaml"            # settings.png -> settings.meta.yaml

tools:
  doc-detective:
    config: .doc-detective.json

meta:
  overrides:
    - collection: screenshots               # new
      schemas:
        - manni:screenshot:1.0.0
```

The override names no `defaults: true`. So an image needs no `title` or
`description`, which `manni:core` would require. A team that wants them
adds the defaults.

### 5. `manni test run` checks every pin

`manni test run` keeps its arguments, options and input precedence from 0085.
It gains no flag. When the configured collections hold an asset with a
`screenshot` field, the run checks that pin. That is detection, so a
repository with no pins sees no change.

Each pin is checked after Doc Detective has run. Every check but one needs
only the files.

| Rule | Severity | When |
|---|---|---|
| `screenshot-changed` | error | The image's bytes differ from `screenshot.integrity`. Doc Detective replaced it this run, or someone replaced it by hand. |
| `screenshot-not-compared` | error | The step sets `overwrite` to `"true"` or `"false"`. Neither compares within a tolerance, as run 4 and the source show. |
| `step-unresolved` | error | `step.file` does not exist, holds no step with `step.id`, holds more than one, or that step captures another image. |
| `pin-invalid` | error | The `screenshot` field does not match `manni:screenshot:1.0.0`. |
| `step-changed` | warning | The step's lines differ from `step.integrity`. The capture was accepted under another procedure. |
| `pin-unminted` | warning | `screenshot.integrity` or `step.integrity` is absent. |

The rule ids are `manni:test/<rule>`, as cite's are `manni:cite/<rule>`.
Each finding carries 0089's `guidance`, whose guide is
`https://hawkeyexl.github.io/manni/test/screenshots/#<rule>`.

A `screenshot-changed` finding says how far the capture moved when Doc
Detective measured it this run. Without a run, it says the file was replaced.

A pinned step's own variation `WARNING` from Doc Detective is not listed. The
`screenshot-changed` finding replaces it, so one drift is one finding. Every
other Doc Detective result is reported as 0085 describes.

The finding is filed against the step's page and line, where the author acts.
A rule about the pin itself, `pin-invalid` or `pin-unminted`, is filed against
the manifest entry.

The image a drifted run leaves on disk is the new capture. That is Doc
Detective's default, and it makes the change a visual diff in review.

### 6. `manni test update` mints and accepts

```text
manni test update [paths...]
```

It reads the pins from the configured collections and rewrites the hashes in
their manifests. It never runs Doc Detective. It hashes the files on disk,
which the last run wrote.

| Status | Without `--accept` | With `--accept` |
|---|---|---|
| `pin-unminted` | Both hashes minted. | The same. |
| `screenshot-changed` | Skipped, and reported. | `screenshot.integrity` re-minted. |
| `step-changed` | Skipped, and reported. | `step.integrity` re-minted. |
| `step-unresolved`, `pin-invalid` | Skipped. Fix the pin first. | The same. |
| current | Left alone. | Left alone. |

| Argument or option | Value | Default | Effect |
|---|---|---|---|
| `[paths...]` | files, directories, globs | every pinned image | Limits the run to the pinned images at or under these paths. Space-separated. |
| `--accept` | n/a | off | Re-mint the changed ends. Prints the old and the new pin for each. |
| `--dry-run` | n/a | off | Print what would change. Write nothing. |
| `--collection` | `<name>` | every collection | Read pins from this collection only. Repeatable, one name per occurrence. Cannot be combined with paths. |
| `-c, --config` | `<path>` | discovered | The manni config file. |
| `-f, --format` | `<pretty\|json>` | `pretty` | Output format. |
| `--allow-empty` | n/a | off | Treat zero pinned images as success. |
| `--no-color` | n/a | color on a TTY | Disable color. |

The paths select among pinned images rather than walking for files. A
directory names no extension, so a walk would find no asset in it. Matching
keeps `manni test update docs/src/assets/` useful.

There is no `-`, `--as`, `--ext` or `--exclude`. A pin is read from a
manifest, never from stdin. The collection's own globs already say which
files are images. That is the same reasoning 0085 gave for `test run`.

The name and the flag match cite's, because the act is the same. "Re-mint a
changed pin" is `update --accept` in both domains.

### 7. Output

**`test run`, pretty.** Pin findings group by page with Doc Detective's, and
a second summary line follows the first.

```text
docs/src/content/docs/guides/settings.mdx
  42  error    settings.png differs from its pin: 96.6% of pixels changed, over the step's maxVariation of 5%. Review the new capture, then run manni test update --accept docs/src/assets/screenshots/settings.png. Or restore the image and fix the product or the step.
               manni:test screenshot-changed: The pinned capture differs from what its step takes now.
               Guide: https://hawkeyexl.github.io/manni/test/screenshots/#screenshot-changed

2 tests: 2 passed, 0 failed, 0 warnings, 0 skipped
3 pinned screenshots: 2 current, 1 changed
```

A clean run prints the two summary lines only. With no pins, the second line
is not printed.

**`test run`, github.**

```text
::error file=docs/src/content/docs/guides/settings.mdx,line=42,title=manni%3Atest/screenshot-changed::settings.png differs from its pin: 96.6% of pixels changed, over the step's maxVariation of 5%. Review the new capture, then run manni test update --accept docs/src/assets/screenshots/settings.png. Or restore the image and fix the product or the step.%0Amanni:test screenshot-changed: The pinned capture differs from what its step takes now.%0AGuide: https://hawkeyexl.github.io/manni/test/screenshots/#screenshot-changed
2 tests: 2 passed, 0 failed, 0 warnings, 0 skipped
3 pinned screenshots: 2 current, 1 changed
```

**`test run`, json.** Doc Detective's results object stays verbatim, as 0085
requires. One top-level key is added, `screenshots`, present when the config
holds a pin. A script that reads Doc Detective's shape is unaffected.

```json
{
  "summary": { "...": "Doc Detective's, verbatim" },
  "specs": [],
  "screenshots": [
    {
      "image": "docs/src/assets/screenshots/settings.png",
      "manifest": { "file": "docs/src/assets/screenshots/settings.meta.yaml", "line": 2 },
      "step": { "file": "docs/src/content/docs/guides/settings.mdx", "id": "settings-page", "line": 42 },
      "ran": true,
      "variation": 0.966,
      "status": "changed",
      "findings": [
        {
          "rule": "screenshot-changed",
          "ruleId": "manni:test/screenshot-changed",
          "severity": "error",
          "message": "settings.png differs from its pin: ...",
          "guidance": { "id": "manni:test", "rule": "screenshot-changed", "description": "...", "guide": "..." }
        }
      ]
    }
  ]
}
```

`status` is `current` with no finding, `changed` with any `error`, and
`stale` with warnings alone. `ran` says whether Doc Detective ran the step in
this run. `variation` is Doc Detective's measure, or `null` when the step did
not run or matched.

**`test update`, pretty.**

```text
docs/src/assets/screenshots/settings.png
  image  sha256-b6b2f6f0d70e... -> sha256-4a7912e873b9...  accepted
docs/src/assets/screenshots/profile.png
  image  minted sha256-91ce04b7a2d8...
  step   minted sha256-5f0a13c6e9b1...
2 pins written in 2 manifests.
```

A skipped pin prints its finding as `test run` does. Pretty abbreviates
hashes to 12 hex characters, and json carries them whole.

**`test update`, json.**

```json
{
  "pins": [
    {
      "image": "docs/src/assets/screenshots/settings.png",
      "manifest": "docs/src/assets/screenshots/settings.meta.yaml",
      "end": "image",
      "reason": "accepted",
      "fromPin": "sha256-b6b2f6f0d70e...",
      "toPin": "sha256-4a7912e873b9..."
    }
  ],
  "skipped": [],
  "manifests": [{ "file": "docs/src/assets/screenshots/settings.meta.yaml", "written": true }],
  "exitCode": 0
}
```

`end` is `image` or `step`. `reason` is `minted` or `accepted`, and a minted
pin's `fromPin` is `null`. `skipped` holds the findings of section 5.

### 8. Messages and exit codes

`manni test run` keeps 0085's codes. A pin finding at `error` exits `1`. A
warning leaves the code at `0`.

`manni test update` exits `0` when everything it could write was written, or
previewed under `--dry-run`. It exits `1` when a pin was skipped with an error
finding, such as `screenshot-changed` without `--accept`. It exits `2` on an
operational or usage error.

Each finding message names the action.

| Rule | Message |
|---|---|
| `screenshot-changed`, after a run | `settings.png differs from its pin: 96.6% of pixels changed, over the step's maxVariation of 5%. Review the new capture, then run manni test update --accept <image>. Or restore the image and fix the product or the step.` |
| `screenshot-changed`, no run | `settings.png differs from its pin, and its step did not run. The file was replaced. Run its step, or restore the image.` |
| `screenshot-not-compared` | `settings-page sets overwrite to "false", so Doc Detective never compares settings.png. Remove overwrite, or set it to "aboveVariation".` |
| `step-unresolved`, no file | `the pin names docs/guides/settings.mdx, which does not exist. Fix step.file.` |
| `step-unresolved`, no step | `docs/guides/settings.mdx holds no step with id settings-page. Fix step.id, or restore the step.` |
| `step-unresolved`, two steps | `docs/guides/settings.mdx holds 2 steps with id settings-page. Give the step a unique id.` |
| `step-unresolved`, other image | `settings-page captures docs/img/other.png, not settings.png. Fix the pin or the step's path.` |
| `pin-invalid` | `the screenshot entry does not match manni:screenshot:1.0.0. Run manni meta validate for the details.` |
| `step-changed` | `settings-page changed since settings.png was accepted. Check the capture, then run manni test update --accept <image>.` |
| `pin-unminted` | `settings.png has no pin yet. Run manni test update <image>.` |

Every operational case is exit `2`, on stderr, prefixed `manni: `.

| When | Message |
|---|---|
| `test update -` | `test update reads pinned images, and has no stdin. Pass a path.` |
| `--collection` with paths | 0085's `--collection selects a configured collection; it cannot be combined with paths.` |
| no manni config | `test update reads pins from the configured collections, and no config file was found.` |
| no pins in the config | `No pinned screenshots in the configured collections. Pass --allow-empty if that is expected.` |
| paths match no pinned image | `No pinned screenshot matched. Patterns tried: "<path>". Pass --allow-empty if that is expected.` |
| a bad `--format` | `Unknown --format "x". Use pretty \| json.` |
| a write fails | cite's form, `<manifest> could not be written (EACCES). <file> was restored.` |

### 9. Alt text stays on the page

Alt text describes an image in one context. The same screenshot on two pages
can need two alt texts, so alt text is a property of the embedding, not of
the image. It stays in the page's markup.

The family already checks it there.

- `manni a11y check` runs axe, whose `image-alt` rule reports an image with no
  alt text on the rendered page.
- A lint template's `images:` matcher can require an `alt` on an image in the
  source.

The asset manifest carries no alt field. A stored alt copied into each page
would be the copy this proposal removes. One link remains. An accepted capture
can make the alt text wrong. So the guidance of `screenshot-changed` and
`step-changed` says to re-read the alt text where the image is embedded.

### 10. From minimal to maximal

The bare run, with pins configured and the UI unchanged.

```text
$ manni test run
2 tests: 2 passed, 0 failed, 0 warnings, 0 skipped
3 pinned screenshots: 3 current
$ echo $?
0
```

The UI changed. The run is section 7's pretty output, and it exits `1`.

The CI form, as `docs-as-tests.yml` runs it.

```text
$ manni test run -f github --progress
::error file=docs/src/content/docs/guides/settings.mdx,line=42,title=manni%3Atest/screenshot-changed::settings.png differs from its pin: ...
2 tests: 2 passed, 0 failed, 0 warnings, 0 skipped
3 pinned screenshots: 2 current, 1 changed
```

The scripting form.

```text
$ manni test run -f json | jq -r '.screenshots[] | select(.status != "current") | .image'
docs/src/assets/screenshots/settings.png
```

Mint a new pin, after writing `step.file` and `step.id` by hand.

```text
$ manni test update docs/src/assets/screenshots/profile.png
docs/src/assets/screenshots/profile.png
  image  minted sha256-91ce04b7a2d8...
  step   minted sha256-5f0a13c6e9b1...
1 pin written in 1 manifest.
```

Preview an accept, then accept.

```text
$ manni test update --accept --dry-run docs/src/assets/screenshots/settings.png
docs/src/assets/screenshots/settings.png
  image  sha256-b6b2f6f0d70e... -> sha256-4a7912e873b9...  accepted (dry run)
1 pin would be written in 1 manifest.
$ manni test update --accept docs/src/assets/screenshots/settings.png
```

Without `--accept`, a changed image is skipped and the run exits `1`.

```text
$ manni test update
docs/src/content/docs/guides/settings.mdx
  42  error    settings.png differs from its pin: ...
0 pins written. 1 skipped.
```

The pin's shape, through `meta`.

```text
$ manni meta validate --collection screenshots
```

Every option at once.

```text
$ manni test update --accept --dry-run --collection screenshots -c manni.config.yaml -f json --allow-empty --no-color
```

The usage errors, each exit `2`.

```text
$ manni test update -
manni: test update reads pinned images, and has no stdin. Pass a path.
$ manni test update --collection screenshots docs/
manni: --collection selects a configured collection; it cannot be combined with paths.
$ manni test update -f sarif
manni: Unknown --format "sarif". Use pretty | json.
$ manni test update docs/missing/
manni: No pinned screenshot matched. Patterns tried: "docs/missing/". Pass --allow-empty if that is expected.
```

## Known limits

- **A changed aspect ratio is not drift.** Doc Detective fails the step and
  keeps the old image, so the pin still matches. Delete the image, run again,
  then accept.
- **A pin covers a local file.** A step whose `path` is an `http(s)` URL
  writes its capture to a run folder, so there is no file to pin.
- **The run rewrites a tracked image.** That is Doc Detective's default. A
  local run leaves the new capture in the working tree until it is accepted
  or restored.
- **Two images can resolve one manifest.** `settings.png` and `settings.svg`
  in one collection both map to `settings.meta.yaml`. 0058's misrouted-entry
  error reports it. Name the manifest `{page}.png.meta.yaml` in a collection
  of one extension to avoid it.
- **Rendering differs across machines.** A capture taken on Windows can vary
  from one on Linux. The tolerance is the step's `maxVariation`, which this
  proposal leaves to Doc Detective.

## What was rejected

| Option | Verdict |
|---|---|
| A `maxVariation` in the pin | Rejected. The step owns the tolerance. A second copy would disagree with it. |
| An `assets:` key on a collection | Rejected. A glob that spells `.png` already says the set holds images, and two lists for one set is a second spelling. |
| A new `manni test accept` verb | Rejected. cite spells the same act `update --accept`, and two spellings for one act break parity. |
| Running Doc Detective inside `test update` | Rejected. The run that found the drift already wrote the capture, and a second capture could differ from the one reviewed. |
| An alt field in the asset manifest | Rejected. Section 9 gives the reasons. |
| Pins for `runShell` output | Deferred. Doc Detective saves command output with the same `maxVariation` and `overwrite` fields. It is the same pin, and it waits for a team that asks. |

## Stress test

### 1. Why pin at all, when git already tracks the image?

Git records that the bytes changed, not why. The pin says which step takes
the image, so a deleted step is a finding instead of an orphaned copy. The
hash also makes a hand-replaced image a finding, which git shows only as a
diff nobody is told to read.

### 2. Does making images loadable flood `meta validate` with failures?

No. A directory walk names no extension, so `manni meta validate docs/` loads
the same files as today. An image loads only when a glob, a typed path or
`--ext` asks for its extension.

### 3. A named `.png` used to exit `2`. Is that a breaking change?

`manni meta validate settings.png` exited `2` with "Unsupported file type".
It now validates an asset, and exits `1` when the default schemas want a
`title`. That is a behavior change on an input that was an error. The commit
is `feat:`, and the reference pages say what a named asset does.

### 4. Why is `screenshot-changed` an error when Doc Detective calls it a warning?

Doc Detective cannot know a capture is published. The pin says it is, so a
drift is a page that shows the wrong UI. A team that wants a warning can
leave the image unpinned, and Doc Detective's warning remains.

### 5. Why does `test update` not need Doc Detective installed?

It hashes files. The run that found the drift wrote the capture, and the
author reviews that file before accepting it. An accept re-pins what was
reviewed, nothing newer.

## Open questions

- Should `manni check` run the checks that need no Doc Detective? Five of the
  six rules are file checks, and `check` runs from hooks.
- Should `manni status` count pinned screenshots and those not current?
- Should an accept list the pages that embed the image, so the alt text is
  re-read where it lives?
- Should `test` gain a `severity:` map, as cite has, before any team asks to
  move `step-changed`?
- Should the graph link a page to the images it embeds and the steps that take
  them?

## Consequences

- Good, because a screenshot is retaken and checked on every run, with a
  record of which capture the docs accepted.
- Good, because a deleted or edited step is a finding, not a silent copy.
- Good, because an image, a PDF or an OpenAPI file gets metadata where every
  other document gets it, with no new config key.
- Good, because accepting a capture is one command with a reviewable diff.
- Bad, because a run still writes over a tracked image, as Doc Detective
  does by default.
- Bad, because `test run -f json` gains a key beside Doc Detective's object.
- Bad, because 0031's verdict narrows, and readers of 0031 must follow its
  `Status:` line here.
- Maya gains M28 and Theo gains T9. The site's `test/` section gains a
  screenshots page.

## Acceptance checklist

- [ ] `docs/proposals/0094-pinned-screenshots.md` reads `Implemented (#N)`.
- [ ] `docs/proposals/0031-input-formats-notebooks-and-markdoc.md` reads
  `Superseded in part by 0094`, with no other change.
- [ ] `docs/proposals/README.md` lists 0094 in its index.
- [ ] `src/meta/schemas/screenshot/1.0.0.json` defines `screenshot` with the
  keys and types of section 3, marked `x-manni-location: external`.
- [ ] `manni:screenshot:1.0.0` is registered in
  `src/meta/schemas/manifest.json` and published under
  `docs/public/schemas/screenshot/`, and `npm run schemas:check` passes.
- [ ] `manni meta validate` on a collection whose glob is
  `**/*.png` loads each PNG as an asset with empty in-file metadata.
- [ ] `manni meta validate docs/` loads no image, as before.
- [ ] `manni meta validate --ext png docs/` loads the images under `docs/`.
- [ ] A manifest under an `api/*.yaml` glob is not loaded as an asset.
- [ ] `manni meta get` on an asset prints the fields of its manifest.
- [ ] `manni lint check --collection screenshots` loads no image.
- [ ] `manni test run` with no pins prints the same output as before.
- [ ] `manni test run` with a current pin prints
  `N pinned screenshots: N current` and exits `0`.
- [ ] `manni test run` after a UI change reports `screenshot-changed` with the
  variation, and exits `1`.
- [ ] A pinned step's Doc Detective variation `WARNING` is not listed beside
  `screenshot-changed`.
- [ ] A pinned step with `overwrite: "false"` reports
  `screenshot-not-compared` and exits `1`.
- [ ] Each `step-unresolved` case of section 8 prints its message and exits
  `1`.
- [ ] `step-changed` and `pin-unminted` print their messages and leave the
  exit code at `0`.
- [ ] `pin-invalid` is reported against the manifest entry and exits `1`.
- [ ] `manni test run -f github` prints `title=manni%3Atest/<rule>` with 0089's
  guidance lines.
- [ ] `manni test run -f json` holds Doc Detective's object verbatim plus
  `screenshots`, in the shape of section 7.
- [ ] `manni test update` mints an unminted pin and exits `0`.
- [ ] `manni test update` skips a changed image, prints its finding and exits
  `1`.
- [ ] `manni test update --accept` re-mints a changed image and a changed
  step, and prints the old and new pins.
- [ ] `manni test update --dry-run` writes nothing.
- [ ] `manni test update -f json` prints `{ pins, skipped, manifests, exitCode }`.
- [ ] Each usage error of section 8 prints its message and exits `2`.
- [ ] A failed write restores every file the run wrote, and names them.
- [ ] `test/test/` covers each rule, the accept flow and the json shape, on
  fixtures under `test/test/fixtures/screenshots/`.
- [ ] `test/fixtures/` holds a PNG asset with a manifest for the meta loading
  tests.
- [ ] `docs/src/content/docs/test/screenshots.mdx` exists, with `title`,
  `description` and an anchor per rule.
- [ ] `docs/src/content/docs/test/reference/cli.mdx` documents
  `test update`, and `npm run docs:check-cli` passes.
- [ ] `docs/src/content/docs/meta/reference/formats.mdx` and
  `configuration.mdx` describe assets.
- [ ] `docs/src/content/docs/meta/reference/schemas/manni-screenshot.mdx`
  documents the vocabulary.
- [ ] `docs/content-strategy/cujs.md` holds M28 and T9, and
  `information-architecture.md` places the screenshots page.
- [ ] `node dist/cli.js meta validate`, `cite check` and `term check` pass on
  the branch.
- [ ] A demo video for the `feat:` is under `media/`, MP4 excluded.
