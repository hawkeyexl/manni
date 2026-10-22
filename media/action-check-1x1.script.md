# Video script: One Action step gates every check (`uses: hawkeyexl/manni@v4`)

**Objective:** Show the GitHub Action running `manni check` by default. A
workflow that carried one hand-written `npx` step per domain becomes one bare
`uses:` line. The run over a page missing its `description` fails the step
with the annotation on the page.
**Format:** 1080x1080, 30 fps, silent, captions burned in (LinkedIn autoplays muted).
**Duration:** 32 s planned (spec: 20-45 s).
**Audience:** CI engineers who own the docs pipeline (Devin, CUJ D16).
**Feature:** the `command` input of `action.yml`, default `check`.
`command: meta validate` restores the Action's old run.

Visual spec: `docs/content-strategy/design.md`. Accent `#58a6ff` (blue), the
series accent. Never red, green, yellow or cyan: manni's own rows use all
four, and the `::error` line in beat 3 is the subject of the frame. Terminal
`#171717`, bands `#0d0d0d`, JetBrains Mono throughout. Title band 112 px,
2 px accent rules, caption band 86 px.

## Beats (storyboard)

Three static full-frame shots, each on a cleared terminal, cut with no
transitions.

| # | Title (band) | Terminal | Caption (band) | Time |
|---|---|---|---|---|
| 1 | Three steps, one per tool | `cat .github/workflows/docs.yml` (the before file) | Every manni tool had its own CI step. A tool set up later had none. | 0:00-0:09 |
| 2 | One step | `git diff --stat HEAD~1` then `cat .github/workflows/docs.yml` (the after file) | One bare `uses:` line. The Action runs `manni check`: every check this repo set up. | 0:09-0:19 |
| 3 | The page that fails | `gh run view --log-failed \| grep -E 'manni check\|::error\|exit code'` | `docs/limits.md` lacks a description. The step fails, and the PR shows the line. | 0:19-0:32 |

Beat 1 highlights the three `run: npx` lines. Beat 2 highlights the single
`- uses: hawkeyexl/manni@v4`. Beat 3 highlights `manni check --format github`
and `file=docs/limits.md,line=1`.

Thumbnail (`.thumb.png`): beat 2, the one-line workflow.

## The two workflow files

Beat 1, `.github/workflows/docs.yml` before:

```yaml
name: Docs
on: [pull_request]
jobs:
  manni:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - run: npx -y @hawkeyexl/manni meta validate --format github
      - run: npx -y @hawkeyexl/manni lint check --format github
      - run: npx -y @hawkeyexl/manni cite check --format github
```

Beat 2, the same file after:

```yaml
name: Docs
on: [pull_request]
jobs:
  manni:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: hawkeyexl/manni@v4
```

## Real output quoted

Beat 3 is the job log of a real run. It can only be captured once the branch
is pushed and the Action sits on a ref a workflow can use. Until then, the
lines below stand in. They are what the built CLI prints over a copy of
`test/family/fixtures/meta-and-lint/`, from
`node dist/cli.js check --format github` (exit 1). The runner's log adds
timestamps and a `Process completed with exit code 1.` line. Replace these
lines with the captured log once it exists.

```
manni check --format github
::error file=docs/limits.md,line=1::[manni:core:1.0.0] (root) must have required property 'description'%0Amanni:core:1.0.0 description: One full non-empty sentence saying what the page is for.%0AGuide: https://hawkeyexl.github.io/manni/meta/reference/schemas/manni-core/
::error file=docs/limits.md,line=8,col=1,title=manni%3Alint/structure/missing-section::Raise a limit: Missing section "Steps"%0A…/templates.yaml#how-to steps
```

The fixture sets up meta and lint, and no page carries a citation. So add one
to the demo repo with `manni cite add` before filming, and cite is in play too.
Otherwise drop the cite line from beat 1. Nothing on screen may claim a check
the run never made.

## Capture, once the branch is pushed

The demo repo is a scratch copy of the fixture, published to a throwaway
GitHub repository so `gh run view` has a real run to show. It lives under
`media/scratch-action-check/` and carries its own `.git`, so it stays out of
this repository's history.

```bash
# 1. The demo repo: the meta-and-lint fixture, with the before workflow.
cp -r test/family/fixtures/meta-and-lint media/scratch-action-check
cd media/scratch-action-check
mkdir -p .github/workflows
# write the beat 1 file above to .github/workflows/docs.yml
git init -q && git add -A && git commit -qm "docs: three manni steps"

# 2. The after workflow. Until this branch is released, point the step at it:
#    uses: hawkeyexl/manni@claude/action-runs-check
#    with: { version: "<tarball URL or a published prerelease>" }
#    Film the bare `uses: hawkeyexl/manni@v4` form once the release moves @v4.
# write the beat 2 file above to .github/workflows/docs.yml
git commit -qam "ci: one manni step"

# 3. Publish and run (a private throwaway repository is enough).
gh repo create manni-action-demo --private --source . --push
gh run watch --exit-status || true
gh run view --log-failed | grep -E 'manni check|::error|exit code'

# 4. Record the three beats with VHS, measuring FontSize from the longest
#    line of beat 3 (design.md, Capture geometry).
```

Beat 3's log line is long. Crop the capture to the used rows. If the
`::error` line runs past the column count, pipe it through `cut -c1-<cols>`.
Say so in the caption, rather than orphaning a character onto the next row.

## Suggested post text

> One CI step for every docs check. The manni GitHub Action now runs
> `manni check` by default, so `uses: hawkeyexl/manni@v4` gates everything
> a repository has set up. Add a tool later and the gate picks it up.
> `command: meta validate` runs the metadata check alone.

Posting is a human action. This file suggests text; it never posts.
