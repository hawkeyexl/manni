# Releasing

Releases are automated by
[semantic-release](https://semantic-release.gitbook.io/) via
[`.github/workflows/release.yml`](../../.github/workflows/release.yml). On a
push to a release branch it reads the conventional commits since the last tag
and computes the next version. It then updates `CHANGELOG.md`/`package.json`,
tags, creates a GitHub Release, and publishes to npm.

| Branch    | npm dist-tag            |
| --------- | ----------------------- |
| `main`    | `latest`                |
| `next`    | `next` (prerelease)     |
| `feat/**` | per-branch prerelease   |

You don't run anything by hand for a normal release. Merge a PR with the right
commit types, and the workflow does the rest. The two pieces below are
**one-time infrastructure setup** that's already configured. This page documents
it so it can be recreated or audited.

## The three jobs

The workflow runs three jobs:

| Job | What it does |
|---|---|
| `test` | runs the suite in three shards side by side, with `vitest --shard` |
| `release` | builds and runs semantic-release, once every shard passes |
| `major-tag` | moves the `vN` tag once npm serves the release, as [described below](#the-moving-major-tag) |

The shards are the only run of the suite against the merged tree. The `main`
ruleset requires no status checks, so a PR's CI result says nothing about what
landed.

They used to be one job. The 4.14.0 release finished it 34 seconds inside its
20-minute timeout. Nine minutes went to tests and eight and a half to waiting
for npm. Split up, neither wait sits between the merge and the publish.

`release` has a concurrency group of its own, so a release waits only for the
previous one to publish. `major-tag` has another, so tag moves land in order.

## npm publishing: OIDC trusted publishing

The workflow publishes to npm with **no `NPM_TOKEN`**. It uses
[trusted publishing](https://docs.npmjs.com/trusted-publishers): npm exchanges
the workflow's OIDC token (the `id-token: write` permission) for a short-lived,
scoped publish credential, and mints provenance automatically.

Configured on npmjs.com under the package's **Settings → Trusted Publisher**:

- Provider: **GitHub Actions**
- Repository: `hawkeyexl/manni`
- Workflow filename: **`release.yml`** (exact, case-sensitive)

The workflow bakes in four requirements. It needs a GitHub-hosted runner, npm
CLI ≥ 11.5.1 (Node 24 bundles a new enough npm), and `@semantic-release/npm`
≥ 13. It also needs `repository.url` in `package.json` to match the repo.
Do **not** add `registry-url` to `setup-node`, or any
`NPM_TOKEN`/`NODE_AUTH_TOKEN`. A written-out auth token in `.npmrc` shadows OIDC
and breaks the publish.

## The moving major tag

`uses: hawkeyexl/manni@vN` works because the `major-tag` job force-updates the
`vN` tag on each stable release. semantic-release creates immutable `vX.Y.Z` tags
and nothing else, so without that job the reference resolves to nothing.

The job runs unless the run was cancelled, including after the `release` job
fails. The 2.0.0 release published to npm, pushed `v2.0.0` and created the
GitHub release, then failed in a post-publish step of `@semantic-release/github`.
The tag step was gated on success, so it was skipped and `v2` was never created.
Running after a failure means the job cannot assume a release happened. So it
checks, and each gate closes a distinct way of aiming the tag at something
nobody can install:

| Gate | Without it |
|---|---|
| `github.ref == 'refs/heads/main'` | a `next` or `feat/**` prerelease claims the major tag |
| `release` recorded the version before and after | a failure before the `before` step reads as a changed version |
| the version changed during the run | a push of only `chore:`/`docs:` commits releases nothing, and the tag moves to an unpublished tree |
| the version has no `-` suffix | belt and braces on the first, since prerelease identifiers come from the branch name |
| npm serves exactly that version | a publish that failed after `prepare` bumped `package.json` moves the tag to an unpublished tree |
| the `vX.Y.Z` tag is on the remote | the major tag is aimed at a tag that was never pushed |

The npm check waits about twenty minutes, backing off from 5 to 60 seconds. The
registry lags the publish, and that lag has no documented bound. npm accepts a
publish and processes it later, and it recorded 4.14.0 seven minutes after
accepting it. The check reads two ways, the exact-version document and the
package's version list, and takes either one.

Failing either of the last two gates leaves the tag where it was, so the step
exits non-zero with an `::error::` annotation. The two messages stay apart. npm
not serving the version inside the budget is nearly always propagation, and
that message names which tag does exist. npm serving it while the remote has no
version tag is a genuinely half-published release. Both print the command that
finishes the job by hand, version already substituted.

Propagation is the likely story only when the `release` job succeeded. When it
failed and npm never serves the version, the publish most likely failed too,
and the message says so. 4.17.0 is the example. Its tag was pushed, then
`npm publish` failed with `ENEEDAUTH` during an npm outage. That message prints
no tag command, because the version will never appear. The next `feat:` or
`fix:` merge releases the version after it, and the job moves the major tag
then. The wait still runs in full, because 2.0.0 failed after it published.

It tags `v$version` rather than `HEAD`, because semantic-release commits the
changelog and version bump itself, so `HEAD` is not necessarily what it tagged.

It force-pushes with the GitHub App token explicitly. The job's own token is
read-only, and the `checkout` step sets `persist-credentials: false`, so no
credential sits in git's config. The App is also the only actor allowed to
bypass the `main` ruleset.

Consumers wanting an immutable reference pin a full tag such as `@vX.Y.Z`
instead; that is the usual trade and needs nothing here.

## Why the release does not comment on issues

`.releaserc.json` sets `successCommentCondition: false` on
`@semantic-release/github`. Its success step parses closing keywords out of
every released commit message and PR body, then resolves all the numbers in one
GraphQL query. A single number that does not exist in this repository throws
before any per-issue handling. The 2.0.0 release failed that way after
publishing, because a commit body quoted an issue number from docmeta's tracker.
A condition template cannot avoid it, since the query runs before the template
is evaluated. Failure issues are unaffected: the fail step still opens one when
a release breaks.

## Pushing the release commit past branch protection

`main` has a ruleset requiring all changes to go through a pull request. The
default `GITHUB_TOKEN` can't bypass it, so `@semantic-release/git`'s direct push
of the release commit is rejected with `GH013`. To fix this, the release runs as
a **GitHub App** that is the sole bypass actor on the ruleset.

### One-time setup

1. **Create a GitHub App** (Settings → Developer settings → GitHub Apps → New).
   - Name it something like `manni-release-bot`.
   - Set the homepage URL to the repo URL (any valid URL works).
   - Uncheck **Webhook → Active**.
   - **Repository permissions:**
     - Contents: **Read and write** (release commit, tag, GitHub Release)
     - Issues: **Read and write** (open and close the release-failure issue)
     - Pull requests: **Read and write** (used only by release comments, which are off; see [why](#why-the-release-does-not-comment-on-issues))
   - Where can this App be installed: **Only on this account**.

2. **Generate a private key** for the App (App settings → Private keys →
   Generate) and note the **App ID** (shown at the top of the App settings).

3. **Install the App** on the `hawkeyexl/manni` repository
   (App settings → Install App → choose the repo).

4. **Add repository secrets** (repo Settings → Secrets and variables → Actions):
   - `RELEASE_APP_ID` holds the App ID from step 2.
   - `RELEASE_APP_PRIVATE_KEY` holds the full contents of the `.pem` private
     key.

5. **Add the App as a bypass actor** on the `main` ruleset (repo Settings →
   Rules → Rulesets → `main` → **Bypass list** → Add bypass → select the App).
   Set its bypass mode to **Always**, because the release pushes directly rather
   than through a PR.

   Equivalent via the API (replace `<APP_ID>`):

   ```bash
   # Find the current ruleset ID for `main` (don't hardcode it — it changes if
   # the ruleset is deleted and recreated):
   RULESET_ID=$(gh api repos/hawkeyexl/manni/rulesets --jq '.[] | select(.name=="main") | .id')

   gh api repos/hawkeyexl/manni/rulesets/$RULESET_ID > /tmp/rs.json
   jq '.bypass_actors += [{"actor_id": <APP_ID>, "actor_type": "Integration", "bypass_mode": "always"}]' \
     /tmp/rs.json > /tmp/rs.new.json
   gh api repos/hawkeyexl/manni/rulesets/$RULESET_ID --method PUT --input /tmp/rs.new.json
   ```

   For an `"Integration"` bypass actor, `actor_id` is the **App ID** (the same
   value as `RELEASE_APP_ID`).

The workflow mints a short-lived token from this App
(`actions/create-github-app-token`). It hands that token to semantic-release as
`GITHUB_TOKEN`, so the release commit is pushed by the App and bypasses the
ruleset. (The token controls which actor authenticates the push, not the git
`author`/`committer` fields, which semantic-release sets independently.) The
release job skips its own release commit with a job-level `if:` that matches the
`chore(release):` subject prefix, so it doesn't re-trigger. It deliberately does
not use `[skip ci]`. GitHub honours that marker anywhere in a pushed message,
and a squash merge concatenates a branch's commits. Prerelease markers therefore
rode into `main` and skipped Release and Docs both.
