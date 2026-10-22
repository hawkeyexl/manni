# 0100: Citations from more than one checkout, with `cite.repos`

- **Status:** Implemented (#231)
- **Serves:** Three citation journeys in `../content-strategy/cujs.md`.
  - Maya · M5, "Pin a claim and catch it going stale". One page can rest on
    code in two repositories.
  - Devin · D5, "Gate citations in CI without blocking on prose". One job
    checks every pin, whichever repository holds its source.
  - Theo · T2, "Read a citation failure and fix it". The advice on a missing
    source stops telling him to delete a citation that holds.
- **Depends on:** Four earlier proposals.
  - [0044](0044-citations-and-drift.md) is the pin, the `src` grammar and the
    root. Its stress test 7 keeps a path inside the root, and this keeps it
    inside the entry's checkout.
  - [0045](0045-family-encryption-key.md) is the encrypted source. It
    encrypts the path, and the repo name stays plain beside it.
  - [0097](0097-the-source-end-derives-its-baseline.md) is the baseline walk.
    It runs in the entry's own checkout.
  - [0098](0098-verification-metadata.md) added citations 1.1.0, and the
    rule that an optional-field version maps to its predecessor.
- **Relates to:** [0092](0092-how-long-a-pin-stood-stale.md), `cite history`.
  It walks one repository, and [Known limits](#known-limits) says what it does
  with an entry that names another.
- **Extends:** 0044's stress test 7. A source in another checkout is reached
  by `--root`, and now also by a named repo. A path still never leaves its
  checkout.
- **Changes:** The citations vocabulary. `manni:citations:1.2.0` adds an
  optional `source.repo`, and the default schema set moves to it.
- **Touches:** `src/cite/` (config, the `src` grammar, sources, mint, check,
  update, history, re-encryption and the reporters), `src/cite/cli.ts`,
  `src/key/` (`rotate` and its CLI), `src/meta/schemas/citations*/1.2.0.json`,
  `src/meta/core/schema-registry.ts`, `src/meta/core/resolve-schema.ts`, the
  cite pages under `docs/src/content/docs/cite/` and journey D5 in
  `docs/content-strategy/cujs.md`

## Problem

`manni cite` resolves every source in a run from one directory. That is
`--root`, else `cite.root`, else the git root, else the working directory.
Every command builds one source index and one git client from it. A source
path is relative to that root, and the grammar refuses `..` and URLs.

So a docs repository can cite one code repository per run. A product whose
code lives in two repositories gets two runs, and a page that cites both
cannot pass either. This is a docs repository, `docs`, checked out beside
`api` and `sdk`. Its page `pages/limits.md` has one pin into each. The CLI is
built at `6a890ff3`.

```text
$ manni cite check pages/limits.md --root ../api --no-config
✗ pages/limits.md
    ✓ timeout   :24 current   lib/limits.ts:2 current
    ✗ retries   :26 current   src/client.ts:2 missing
      Run manni cite remove --only retries, then manni cite add against the file's new path.
      manni:cite source-missing: The path names no tracked file, or an encrypted source cannot be decrypted.

1 file checked, 0 passed, 1 failed, 1 finding          # exit 1

$ manni cite check pages/limits.md --root ../sdk --no-config
✗ pages/limits.md
    ✗ timeout   :24 current   lib/limits.ts:2 missing
      Run manni cite remove --only timeout, then manni cite add against the file's new path.
      manni:cite source-missing: The path names no tracked file, or an encrypted source cannot be decrypted.
    ✓ retries   :26 current   src/client.ts:2 current

1 file checked, 0 passed, 1 failed, 1 finding          # exit 1
```

No `--root` makes this page pass. The advice on each missing line deletes a
citation that holds.

It gets worse when both repositories hold a file of the same name. The page
adds "The API needs Node 24", pinned to line 3 of `api`'s `README.md`. The
`sdk` checkout has a `README.md` too, and its line 3 says Node 22.

```text
$ manni cite check pages/limits.md --root ../sdk --no-config
    ✗ node      :37 current   README.md:3 never true: the pin held at no commit in the history of README.md
      Check the sentence against the source, then run manni cite update --accept --only node.

$ manni cite update pages/limits.md --root ../sdk --no-config --accept --only node
pages/limits.md: node source README.md:3 re-pinned at 1148795 (never true; sha256-92e95f1f… -> sha256-1a4d34c9…)

$ manni cite check pages/limits.md --root ../sdk --no-config
    ✓ node      :37 current   README.md:3 current
```

The advice was followed, and the check went green. The sentence that says
Node 24 now rests on a line that says Node 22.

The ways around it today each cost something.

| Workaround | What it costs |
|---|---|
| Split the pages so each cites one repository | A page about a request that crosses both repositories cannot be written. |
| Vendor or submodule the code into the docs repository | A copy goes stale on its own. `git ls-files` lists a submodule as one entry, so its files read as untracked anyway. |
| Symlink the code into the docs checkout | The realpath containment check refuses it, on purpose. |
| One run per repository, with `source-missing` set to `off` | Every pin into the other repository is hidden, including the ones that broke. |

| Who | What they hit today | Cost |
|---|---|---|
| Maya · M5 | A page that rests on two repositories cannot be pinned whole. | She pins half of it, or none. |
| Devin · D5 | No job layout makes such a page pass. | The gate is red until someone removes a pin that holds. |
| Theo · T2 | The finding tells him to remove a citation that holds, or to accept a wrong one. | He follows it, and the docs get worse while the check goes green. |

## Worked example

Maya keeps the docs for a product whose code lives in `api` and `sdk`. She
starts from the layout above, before either pin exists. The commands run from
the `docs` checkout. Output after the first step is this proposal's format.
Each line is today's line with the repo name added.

1. **She names the two checkouts once.** `manni.config.yaml` in `docs` gains
   one key.

   ```yaml
   cite:
     repos:
       api: ../api
       sdk: ../sdk
   ```

2. **She pins the first sentence.** The `docs` root has no `lib/limits.ts`
   and `api` has one, so `add` names the repo itself.

   ```text
   $ manni cite add pages/limits.md:5 lib/limits.ts:2 --id timeout
   pages/limits.md: added timeout to frontmatter (claim at line 15, sha256-8c00bfdf…; source api:lib/limits.ts:2 "timeoutMs: 30_000,", sha256-4ba04f0f…, b92a367)
   ```

3. **She pins the second.** She spells the repo herself, the way the output
   spells it. The first entry grew the frontmatter, so the sentence is now on
   line 17.

   ```text
   $ manni cite add pages/limits.md:17 sdk:src/client.ts:2 --id retries
   pages/limits.md: added retries to frontmatter (claim at line 26, sha256-b4b4aac2…; source sdk:src/client.ts:2 "return retry(() => fetch(url), { attempts: 3 });", sha256-4bcf2ce6…, b54d1d0)
   ```

   The two entries differ by one key.

   ```yaml
   citations:
     - id: timeout
       claim: { lines: 2, integrity: sha256-8c00bfdf… }
       source:
         repo: api
         file: lib/limits.ts
         lines: 2
         integrity: sha256-4ba04f0f…
         commit-sha: b92a367df6f2cefff512bfce2f06c13723b30b77
     - id: retries
       claim: { lines: 4, integrity: sha256-b4b4aac2… }
       source:
         repo: sdk
         file: src/client.ts
         lines: 2
         integrity: sha256-4bcf2ce6…
         commit-sha: b54d1d05ebb1560c8dfca18c54a1047a153d53f9
   ```

4. **One run checks both.** Each entry resolves in its own checkout.

   ```text
   $ manni cite check pages/limits.md
   ✓ pages/limits.md
       ✓ timeout   :24 current   api:lib/limits.ts:2 current
       ✓ retries   :26 current   sdk:src/client.ts:2 current

   1 file checked, 1 passed, 0 failed, 0 findings          # exit 0
   ```

5. **The SDK moves to five attempts.** Commit `1148795` in `sdk` edits the
   pinned line. Only the pin that rests on it reports.

   ```text
   $ manni cite check pages/limits.md
   ✗ pages/limits.md
       ✓ timeout   :24 current   api:lib/limits.ts:2 current
       ✗ retries   :26 current   sdk:src/client.ts:2 changed since b54d1d0, 1 commit
         Check the sentence against the source, then run manni cite update --accept --only retries.

   1 file checked, 0 passed, 1 failed, 1 finding          # exit 1
   ```

6. **She fixes the sentence and re-pins.** `--accept` re-mints in `sdk`, at
   `sdk`'s HEAD, and keeps `repo: sdk`.

   ```text
   $ manni cite update pages/limits.md --accept --only retries
   pages/limits.md: retries source sdk:src/client.ts:2 re-pinned at 1148795 (changed; sha256-4bcf2ce6… -> sha256-8c03fdeb…)
   ```

7. **Devin gates it in CI.** The job checks out all three repositories side
   by side and runs from `docs`. The paths in `cite.repos` match the layout,
   so the job passes no `--repo`.

   ```yaml
   - uses: actions/checkout@v7
     with: { path: docs, fetch-depth: 0 }
   - uses: actions/checkout@v7
     with: { repository: acme/api, path: api, fetch-depth: 0 }
   - uses: actions/checkout@v7
     with: { repository: acme/sdk, path: sdk, fetch-depth: 0 }
   - run: npx @hawkeyexl/manni cite check -f github
     working-directory: docs
   ```

   The step-5 edit annotates the sentence line in the pull request.

   ```text
   ::error file=pages/limits.md,line=26,title=manni%3Acite/source-changed::retries (sdk:src/client.ts:2): changed since b54d1d0, 1 commit. …
   ```

One config key, one run, and one annotation on the sentence that went stale.
The page that rests on two repositories is pinned whole.

## Decision

### 1. A repo is a name for a checkout

`cite.repos` maps a name to a directory. The name is what an entry records.
The directory is where this repository keeps that checkout. Two docs
repositories may give one code repository different names, and neither
entry changes the other's meaning.

The name is an alias, not the repository's remote. An alias works without
git and without a remote, and it reads the same over SSH and HTTPS and from a
fork.

`--repo <name=dir>` names one checkout for one run, as `--root` does for the
root. It is repeatable, one name per occurrence. It overrides `cite.repos`
for that name and adds a name the config lacks. It works with `--no-config`.

### 2. An entry names its repo

`source.repo` is optional. An entry without it resolves against the root,
exactly as today, so no existing entry changes. An entry with it resolves
against that repo's checkout and nowhere else.

`file` keeps its grammar. The repo is its own key, so a path never carries a
checkout and a ciphertext never carries a repo.

### 3. The command line spells a repo as a prefix

Output prints a source as `sdk:src/client.ts:2`, and `add` accepts the same
spelling. What a person copies out of a finding is what they can type back.

A source on the command line is `[<repo>:]<path>[:<L>[-<L2>]]`. Today's
grammar keeps `:` out of every path, and a line suffix is digits. So the
parts read one way.

- One part is a path.
- Two parts are a path and lines when the second is a line suffix, and a repo
  and a path otherwise.
- Three parts are a repo, a path and lines.

Every source that parses today keeps its meaning. `api:2` is line 2 of a root
file named `api`, as it is today.

### 4. `add` names the repo only where the root cannot

A plain path still means the root. `add` looks further only where today's
`add` would refuse.

1. **The root tracks the path.** The entry gets no `repo`, as today.
2. **One repo tracks it.** The entry gets that repo, and the output line
   spells the source with its prefix.
3. **Several repos track it.** `add` refuses and names each spelling.
4. **None does.** `add` refuses, as today, and names where it looked.

A prefixed source is looked up in that repo alone. A repo named nowhere is
refused.

### 5. Every read stays inside the entry's checkout

Each checkout gets its own source index and its own git client. The
tracked-file rule and the realpath containment check apply to each, as 0044
applies them to the root. `commit-sha` is minted from that checkout's HEAD.

0097's baseline walk, the move search, `update --accept`, `update --recommit`
and `key rotate` all read the entry's checkout. A move is searched inside the
checkout the entry names. `update` never changes `repo`. Pointing a pin at
another repository is a `remove` and an `add`.

### 6. Checkouts open when a page cites them

A run opens the root and each repo that an entry in the run names. A declared
repo that no page in the run cites is never opened, so a job may check out
only what its collection needs.

A cited repo whose directory is missing stops the run with exit `2`, as a
missing root does. An entry that names a repo nobody declared is
`source-missing` on its sentence. `--no-check-sources` opens no checkout at
all, so the public job of the public-docs, private-code layout is unchanged.

### 7. What does not change

- **Exit codes.** `0`, `1` and `2` keep their meanings.
- **Rules.** No rule is added or renamed. `source-missing` gains one cause.
- **Collections.** A collection does not name a repo, because one page can
  cite two.
- **Baselines.** A fingerprint hashes the entry's `id`, or its
  `source.integrity`, and never the source path. A recorded baseline carries
  across.
- **The encryption key.** One family key covers every checkout.

### 8. Config

Before, `cite:` has six keys. After, `repos` joins them, and every key stays
optional.

```yaml
# Before
cite:
  root: ../code
  checkSources: true
```

```yaml
# After
cite:
  # string. Unchanged. Where an entry with no source.repo resolves.
  root: ../code
  checkSources: true

  # mapping of name to string. Default: none. Each key is a repo name an
  # entry's source.repo may give: lowercase letters, digits and hyphens,
  # starting with a letter or digit. Each value is that checkout's directory,
  # relative to this file's directory, as cite.root is.
  repos:
    api: ../api
    sdk: ../sdk
```

| Key | Type | Default | Required | Meaning |
|---|---|---|---|---|
| `cite.repos` | mapping | none | no | Names each checkout an entry may cite by `source.repo`. |
| `cite.repos.<name>` | string | none | yes, per name | The checkout's directory, relative to the config file. |

The citation entry gains one key, in `manni:citations:1.2.0`.

```yaml
# Before, manni:citations:1.1.0
source:
  file: src/client.ts
  lines: 2
  integrity: sha256-4bcf2ce6…
  commit-sha: b54d1d05ebb1560c8dfca18c54a1047a153d53f9
```

```yaml
# After, manni:citations:1.2.0
source:
  # string. Optional. The checkout the file is in, by the name the citing
  # repository's config gives it. Absent, the file is in the root.
  repo: sdk
  file: src/client.ts
  lines: 2
  integrity: sha256-4bcf2ce6…
  commit-sha: b54d1d05ebb1560c8dfca18c54a1047a153d53f9
```

| Key | Type | Pattern | Required | Meaning |
|---|---|---|---|---|
| `source.repo` | string | `^[a-z0-9][a-z0-9-]*$` | no | The checkout `file` is in, by name. Absent means the root. |

`manni:citations:1.2.0` maps to 1.1.0 in the optional-field predecessors, as
0098 set up. It keeps the 1.1.0 strict overlay, because nothing the overlay
narrows changed. ai-context 1.2.0 keeps its 1.0.0 overlay the same way, so no
new strict file ships.
The default schema set moves to 1.2.0. A repository that lists
`manni:citations:1.1.0` in its own schema set moves to 1.2.0 before writing
`repo`.

### 9. The command line

`--repo` joins the four verbs that take `--root`. `remove` reads no source
and `history` walks one repository, so neither takes it.

```text
manni cite check  [options] [paths...]
manni cite add    [options] <page> <src>
manni cite update [options] [paths...]
manni key rotate  [options]

New option, on each of the four:
  --repo <name=dir>   a checkout an entry's source.repo may name, as name=dir
                      relative to the current directory; repeatable;
                      overrides cite.repos for that name
```

One help string changes.

| Where | Before | After |
|---|---|---|
| `cite add <src>` | `path, path:L or path:L1-L2 relative to --root, or an encrypted ~source with the same line forms` | `path, path:L or path:L1-L2 relative to --root, or repo:path with the same line forms for a checkout in cite.repos, or an encrypted ~source` |

### 10. Messages and exit codes

| When | Stream | Line | Exit |
|---|---|---|---|
| A repo entry, current | stdout | `    ✓ retries   :26 current   sdk:src/client.ts:2 current` | 0 |
| A repo entry, changed | stdout | `    ✗ retries   :26 current   sdk:src/client.ts:2 changed since b54d1d0, 1 commit` | 1 |
| An undeclared repo | stdout | `    ✗ retries   :26 current   sdk:src/client.ts:2 missing (no repo named sdk is declared)` | 1 |
| Its remedy | stdout | `      Declare sdk under cite.repos in manni.config.yaml, or pass --repo sdk=<dir>.` | 1 |
| An encrypted source not tracked in a repo | stdout | `missing (no tracked file matches in sdk; wrong cite.repos.sdk?)` | 1 |
| Its remedy | stdout | `Point cite.repos.sdk at the sdk checkout, or re-add the citation against the new path.` | 1 |
| A cited repo's directory is missing | stderr | `manni: Repo directory not found: /work/sdk (sdk). Fix --repo sdk=<dir>, or cite.repos.sdk in manni.config.yaml.` | 2 |
| A shallow repo checkout | stderr, once per checkout | `manni: sdk: the source history ends before the pin held; use fetch-depth: 0 to tell never-true from changed` | n/a |
| A repo checkout without git | stderr, once per checkout | `manni: sdk: git is not available here, so citations are checked without history: no never-true, no reanchored claims, no diffs, no commit subjects.` | n/a |
| `update --recommit` in a shallow repo | stderr, once per checkout | `manni: sdk: this clone is shallow, so --recommit re-recorded only commits that do not contain their lines. Fetch full history to check the rest.` | n/a |
| `add` or `--accept` in a repo without git | stderr, once per checkout | `manni: sdk: git is not available here, so the citation records no commit.` | n/a |
| `add`, one repo tracks a plain path | stdout | `pages/limits.md: added retries to frontmatter (… source sdk:src/client.ts:2 "…", sha256-4bcf2ce6…, b54d1d0)` | 0 |
| `add`, several repos track it | stderr | `manni: README.md is tracked in api and sdk. Spell the one you mean: api:README.md:3 or sdk:README.md:3.` | 2 |
| `add`, nothing tracks it | stderr | `manni: Source not found: lib/x.ts is not a tracked file under the root, or in api or sdk.` | 2 |
| `add`, a prefixed path the repo lacks | stderr | `manni: Source not found: lib/x.ts is not a tracked file in api.` | 2 |
| `add`, an undeclared prefix | stderr | `manni: No repo named apii. Declare it under cite.repos in manni.config.yaml, or pass --repo apii=<dir>. Declared: api, sdk.` | 2 |
| `--repo` without `=` | stderr | `manni: --repo "sdk" is not name=dir. Use --repo sdk=../sdk.` | 2 |
| `--repo` names one repo twice | stderr | `manni: --repo names sdk twice.` | 2 |
| A bad repo name | stderr | `manni: --repo name "SDK" must be lowercase letters, digits and hyphens, starting with a letter or digit.` | 2 |
| `cite.repos` is not a mapping | stderr | `manni: cite.repos in manni.config.yaml must be a mapping.` | 2 |
| A value is not a string | stderr | `manni: cite.repos.sdk in manni.config.yaml must be a string.` | 2 |
| A bad key | stderr | `manni: cite.repos key "SDK" in manni.config.yaml must be lowercase letters, digits and hyphens, starting with a letter or digit.` | 2 |
| `history` meets repo entries | stderr | `manni: cite history walks one repository, so 2 citations that name a repo are left out: retries, timeout.` | 0 |

The `source-missing` rule description becomes "The path names no tracked
file, names an undeclared repo, or an encrypted source cannot be decrypted."
A plain source still prints a bare `missing` when its file is gone, because
the path names its own file.

### 11. Output shapes

Every surface that prints a source spells a repo entry with its prefix. That
covers pretty, `github`, SARIF and JUnit message text, `add` and `update`
lines, and the `source` of a graph chunk record. A root entry prints as
today.

`-f json` gains one member on `source`, present only for a repo entry.

```json
"source": {
  "src": "sdk:src/client.ts:2",
  "repo": "sdk",
  "status": "changed",
  "commitSha": "b54d1d05ebb1560c8dfca18c54a1047a153d53f9",
  "baselineSha": "b54d1d05ebb1560c8dfca18c54a1047a153d53f9",
  "historyAvailable": true
}
```

`src` and `newSrc` carry the prefix, so a script that copies one into `add`
gets the same entry. `repo` saves a script the parse. A finding's `src`
carries the prefix too. SARIF still locates a finding on the page, never in
the source.

An encrypted source prints as `sdk:~AR0x…:2`. With `--reveal` it prints as
`sdk:~AR0x…:2 (src/client.ts)`.

### 12. The ladder

In the worked example's `docs` checkout unless noted.

```text
# 1. Minimal: repos in config, one run
$ manni cite check
✓ pages/limits.md
1 file checked, 1 passed, 0 failed, 0 findings          # exit 0

# 2. A local layout that differs from the config
$ manni cite check --repo sdk=../../oss/sdk

# 3. No config at all
$ manni cite check pages/limits.md --no-config --repo api=../api --repo sdk=../sdk

# 4. Pin, letting add find the repo
$ manni cite add pages/limits.md:5 lib/limits.ts:2 --id timeout

# 5. Pin, naming the repo
$ manni cite add pages/limits.md:17 sdk:src/client.ts:2 --id retries

# 6. An encrypted source in a private repo
$ MANNI_ENCRYPTION_KEY=… manni cite add pages/limits.md:17 sdk:src/client.ts:2 --id retries --encrypt

# 7. CI, a collection whose pages cite api only; sdk is never checked out
$ manni cite check --collection api-reference -f github

# 8. Scripting
$ manni cite check -f json | jq '.pages[].citations[] | select(.source.repo == "sdk")'

# 9. Rotate the key across every checkout
$ MANNI_ENCRYPTION_KEY="$OLD" manni key rotate --to "$NEW" --repo sdk=../sdk

# 10. Everything at once
$ manni cite check docs/ -c manni.config.yaml --root ../code --repo api=../api --repo sdk=../sdk \
    --collection api-reference --baseline -f sarif

# 11. Usage errors, all exit 2
$ manni cite check --repo sdk
manni: --repo "sdk" is not name=dir. Use --repo sdk=../sdk.
$ manni cite check --repo sdk=../a --repo sdk=../b
manni: --repo names sdk twice.
$ manni cite check                                       # ../sdk not checked out
manni: Repo directory not found: /work/sdk (sdk). Fix --repo sdk=<dir>, or cite.repos.sdk in manni.config.yaml.
$ manni cite add pages/limits.md:30 README.md:3 --id node
manni: README.md is tracked in api and sdk. Spell the one you mean: api:README.md:3 or sdk:README.md:3.
$ manni cite add pages/limits.md:30 apii:README.md:3 --id node
manni: No repo named apii. Declare it under cite.repos in manni.config.yaml, or pass --repo apii=<dir>. Declared: api, sdk.
```

### 13. Programmatic API

| Change | Export |
|---|---|
| addition | `CitationSource.repo?: string`, the entry's `source.repo`. |
| addition | `SourceEnd.repo?: string`, present for a repo entry. |
| addition | `repos?: Record<string, string>` on the options of `runCheck`, `runAdd`, `runUpdate` and `runKeyRotate`. Each value is resolved against `cwd`, and each name overrides `cite.repos`. |
| addition | `CiteRun.repos`, each declared name mapped to its absolute directory. |

## Known limits

- **`cite history` walks one repository.** It follows the first-parent
  history of the root's repository, and that history says nothing about
  another checkout. An entry that names a repo is left out, with one notice.
- **A move across checkouts is `missing`.** A file that moves from `sdk` to
  `api` is not followed. The fix is a `remove` and an `add`.
- **The name is local.** Two docs repositories may call one checkout by two
  names. Each repository's entries mean what its own config says.

## Stress test

### 1. Two checkouts track a file of the same name

`README.md`, `package.json` and `src/index.ts` exist in most repositories. The
Problem section shows the cost of resolving against the wrong one. A wrong
file reads `never-true`, and `--accept` then makes the wrong pin green.

**Changed as a result:** the entry records its repo, and resolution never
searches. `add` detects only where the root lacks the path, and refuses when
several repos have it.

### 2. Does the repo name leak a private repository?

The alias is printed in plain text beside an encrypted path. It reaches
public logs, SARIF uploads, the chunk records of 0090 and the site attributes
of 0095. The ciphertext already says that a private source exists. The alias
adds only the name the author chose. The public-docs, private-code page says
to choose one that names nothing, such as `private`.

Encrypting the name would cost a second ciphertext per entry. The public job
opens no checkout, so it would gain nothing from hiding the name.

### 3. A job that checks out one repository

A collection about the API cites `api` alone. Its CI job should not need
`sdk`. Opening every declared repo would fail that job for a checkout it never
reads.

**Changed as a result:** a run opens only the repos its pages cite.

### 4. A shallow clone of one checkout

Each checkout has its own history, and each can be shallow. 0097's notice is
said once per run today.

**Changed as a result:** it is said once per checkout, prefixed with the
repo's name. The root's notice keeps no prefix. The three other notices about
a source's git follow the same rule. They cover git not being available,
`--recommit` in a shallow clone, and a pin minted with no commit.

### 5. A submodule

`git ls-files` lists a submodule as one entry, so a file inside one reads as
untracked under the root today. Declaring `repos: { sdk: vendor/sdk }` gives
the submodule its own index and history. Its files can then be cited, and
`commit-sha` is the submodule's commit.

### 6. A repo inside the root

A monorepo has no need for `repos`, since the root covers it. A repo whose
directory lies under the root is allowed all the same. A plain path still
means the root, and a prefixed path means the repo, so the two never compete.

### 7. Why not a family-level `repos:` key?

0041 lifted `paths` to the top level because every domain reads a document
set. Only cite reads another checkout. `graph publish` and `manni check` reach
cite's sources through cite's own check, so they read `cite.repos` as it is.
When a second domain needs a checkout, a superseding proposal lifts the key.

### 8. Why an alias, and not the remote?

The remote is the same everywhere, but it needs git and a remote. It is spelled
differently over SSH and HTTPS, and differently again from a fork. A CI
checkout of a tarball has none. An alias costs one line of config per
repository and works in all of these.

### 9. `api:2`

Under the new grammar, two parts whose second is a line suffix are a path and
lines. So `api:2` keeps today's meaning, line 2 of a root file named `api`. A
whole-file pin of a file named `2` at the top of a repo cannot be spelled.
That is the only spelling the grammar gives up.

A URL and a drive letter are still refused. `C:/x` would be repo `C` and path
`/x`, and neither is valid. The name takes no capitals, and a path takes no
empty segment.

### 10. `--repo` beside the config

`--root` overrides `cite.root`, and a developer's local layout seldom matches
CI's. `--repo` does the same per name. Repeating a name in one run has no
reading anyone would want, so it is refused rather than resolved by order.

## Rejected

- **Let `src` leave the root.** `../sdk/src/client.ts` reopens the hole 0044's
  stress test 7 closed. A page is untrusted input to the job that checks it.
- **Search every checkout, first hit wins.** The Problem section's `README.md`
  run is the reason. Telling checkouts apart by `commit-sha` fails on a
  shallow clone and on an entry with no commit.
- **A root per collection.** A pin belongs to an entry, and one page can cite
  two repositories.
- **A `--repo <name>` flag on `add` to pick one.** The prefix does the same,
  and it round-trips with the output.
- **Encrypt the repo name.** Stress test 2 says why.

## Open questions

- **Does this repository's Docs workflow keep a cross-repository pin?** The
  dogfood below pins a sentence to The Good Docs Project's templates on
  GitLab. Keeping it in CI adds a network clone to every docs pull request.
  The weekly `check:tgdp-pin` job is the other place it could live.

## Verification

- `test/cite/config.test.ts` covers `cite.repos`. That means its parse, each
  refusal in decision 10, and `--repo` precedence, duplicates and
  `--no-config`.
- `test/cite/range.test.ts` covers the grammar. Every source that parses
  today keeps its meaning, and the prefixed forms parse as decision 3 says.
- A fixture of three repositories is built at test time under
  `test/fixtures/cite-repos/`, with no `.git` committed. It covers each row of
  decision 4's table, a pin per repo through `check`, `update --accept` and
  `--recommit`, and the same-named `README.md` resolving only where its entry
  says.
- A missing cited checkout exits `2`. An uncited missing checkout is never
  opened. An undeclared repo is `source-missing` on its sentence.
- `test/key/rotate.test.ts` re-keys an encrypted pin in a named repo.
- `cite history` leaves repo entries out with its notice.
- The schema registry test holds `citations` 1.2.0 to the same findings as
  1.1.0 over the fixture corpus.
- **Dogfood.** This repository's `manni cite check` result is unchanged with
  no `repos` declared. Then `gitlab.com/tgdp/templates` at `v1.6.0` is cloned
  to `../tgdp` and declared as `tgdp`. A sentence on lint's TGDP template page
  is pinned to `tgdp:how-to/template_how-to.md`, and `manni cite check` passes
  with both checkouts. The output goes in the PR description.

## Acceptance checklist

- [ ] `cite.repos` parses as decision 8 says, and each config refusal in
      decision 10 prints its line and exits `2`.
- [ ] `--repo <name=dir>` exists on `cite check`, `cite add`, `cite update`
      and `key rotate`. It overrides `cite.repos` per name, works with
      `--no-config`, and refuses a missing `=`, a bad name and a repeated
      name with exit `2`.
- [ ] `cite add` accepts `[<repo>:]<path>[:<L>[-<L2>]]`, and every source
      that parsed before keeps its meaning.
- [ ] `cite add` with a plain path follows decision 4. The root wins, one repo
      is written, and several repos or none exit `2` with the lines in
      decision 10.
- [ ] An entry with `source.repo` resolves, mints, walks, follows moves,
      accepts, recommits and re-keys inside its own checkout only.
- [ ] A run opens only the checkouts its entries cite. A missing cited one
      exits `2` with `Repo directory not found`.
- [ ] An undeclared repo is `source-missing` with
      `missing (no repo named <name> is declared)` and its remedy.
- [ ] The four source-git notices are said once per checkout, prefixed for a
      repo and unchanged for the root.
- [ ] Pretty, `github`, SARIF, JUnit, `add` and `update` print
      `<repo>:<path>` for a repo entry. `-f json` carries the prefixed `src`
      and a `repo` member.
- [ ] `cite history` leaves repo entries out with its notice and exits `0`.
- [ ] `src/meta/schemas/citations/1.2.0.json` exists, registered, mapped to
      1.1.0 in the optional-field predecessors and published. It keeps the
      1.1.0 strict overlay. The default schema set names
      `manni:citations:1.2.0`.
- [ ] `cite/reference/configuration.mdx` documents `repos`, and
      `cite/reference/citations.mdx` documents `source.repo` and the prefix.
      `cite/reference/cli.mdx` documents `--repo`, and `docs:check-cli` passes.
- [ ] `cite/set-up/public-docs-private-code.mdx` covers more than one private
      checkout and the alias advice of stress test 2. Its Doc Detective steps
      run a two-repo fixture.
- [ ] Journey D5 in `docs/content-strategy/cujs.md` names `cite.repos`.
- [ ] The tests and fixtures in Verification exist and pass.
- [ ] The dogfood output is pasted into the PR description.
- [ ] This proposal's `Status:` line and its row in `README.md` say
      Implemented, with the PR number.
- [ ] A demo video of the worked example is in `media/`, with the MP4
      attached to the PR.
