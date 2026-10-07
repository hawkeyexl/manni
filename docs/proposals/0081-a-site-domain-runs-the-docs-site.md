# 0081: A site domain runs the docs site: `manni site start`, `build` and `preview`

- **Status:** Proposed
- **Serves:** Three people, four journeys.
  - Maya · M26, "Run the docs site locally", a new journey. One command
    serves the site in any docs repository, whatever framework it runs on.
  - Maya · M7, "Make the published site pass its accessibility check". The
    site has to be running before `manni a11y check` can read it.
  - Devin · D7, "Gate accessibility in CI". The serve step of the job becomes
    one command, and its port agrees with the URL the check reads.
  - Theo · T3, "Fix an accessibility failure". He sees the page in a
    repository he does not own without reading its framework's docs.
- **Depends on:** Four earlier proposals.
  - [0033](0033-manni-monorepo.md) put every tool under one umbrella and every
    tool's settings in one file. `site` mounts under that umbrella and reads
    its own `site:` key of that file.
  - [0034](0034-command-grammar.md) is the grammar. Every verb is spelled, and
    there is no default subcommand.
  - [0041](0041-collections.md) gave a collection its `url:`. a11y reads it as
    a seed, and this domain reads the same value for its port and host.
  - [0045](0045-family-encryption-key.md) widened the definition of a domain
    to a tool, or a family resource with verbs. `site` is the second family
    resource, after `key`.
- **Relates to:** Two proposals this one touches without depending on them.
  - [0035](0035-a11y-domain.md) is the domain that needs a served site. It is
    why every page that runs a crawl typed the serve step by hand.
  - [0050](0050-lint-domain.md) put an outside tool's settings under top-level
    `tools.<tool>`. Stress test 6 says why this domain's commands do not go
    there.
- **Touches:** `src/site/**` (new), `src/shared/` (the `cmd.exe` quoting
  lifted out of `src/lint/tools/dita-ot.ts`), `src/lint/tools/dita-ot.ts`,
  `src/cli.ts`, `scripts/check-cli-reference.mjs`, `test/site/**` (new),
  `test/fixtures/site/**` (new), `docs/src/content/docs/site/**` (new),
  `docs/src/content/docs/a11y/{get-started,ci}/index.mdx`,
  `docs/src/content/docs/index.mdx`, `docs/astro.config.mjs`,
  `docs/content-strategy/{cujs,information-architecture,README}.md`,
  `manni.config.yaml`, `.github/workflows/docs.yml`
- **Verdict:** A new domain, `manni site`, with three verbs. `start` runs the
  framework's dev server, `build` runs its production build, and `preview`
  builds and then serves the output. manni detects the framework from the
  files in the site's directory, so there is no `framework:` key. The port and
  host come from the local collection `url:` a11y already reads. A
  `site.commands` override replaces any detected command.

## Problem

The docs site has to be running before `manni a11y check` can do anything, and
every framework starts it differently.

**One verb per framework.** Mintlify is `mint dev` on port 3000. Fern is
`fern docs dev`, run from the folder above `fern/`. Starlight is `astro dev` on
4321, and Docusaurus is `docusaurus start`. MkDocs takes `-a host:port` where
Hugo takes `--bind`. Theo, fixing an a11y failure in a repository he does not
own, has to read the framework's docs before he can see the page.

**The a11y pages type the serve step by hand.** The get-started page says to
run `npm run build`, then `npx serve dist -l 4173`. The CI page adds a wait
loop and calls it the step people leave out. Both assume a static `dist/`
directory that half the frameworks do not write.

**This repository types it twice, and the copies must agree.** The comment on
the `site` collection in `manni.config.yaml` says to run
`npx astro preview --host 127.0.0.1 --port 4321`. The `a11y` job in
`.github/workflows/docs.yml` runs the same line. Both have to match the
collection's `url: http://127.0.0.1:4321/manni/`, which is what a11y reads.
Nothing checks that they do.

## Decision

### 1. `site` is a family resource with three verbs

The site is the thing every other domain checks. meta validates its pages,
cite pins its sentences, and a11y crawls it once it runs. `site` is not a
folded-in tool, so it lands on an ordinary branch rather than a `tool/`
branch. It is a family resource with verbs, the shape 0045 gave `key`.

| Verb | Does |
|---|---|
| `start` | Runs the framework's dev server, with hot reload, until Ctrl-C. |
| `build` | Runs the framework's production build once. |
| `preview` | Runs `build`, then serves the output until Ctrl-C. It always builds first, so it never serves stale output. |

The umbrella describes the domain as `Start, build and preview the docs site`.
A bare `manni site` prints usage and exits `2`, as `manni key` does.

### 2. The command line

```
manni site start   [dir] [--port <n>] [--host <host>] [-c <file>] [-- <args...>]
manni site build   [dir] [-c <file>] [-- <args...>]
manni site preview [dir] [--port <n>] [--host <host>] [-c <file>] [-- <args...>]
```

| Argument or option | Verbs | Meaning |
|---|---|---|
| `[dir]` | all | The site's directory. Default: `site.dir`, else detected (decision 3). One directory, not a list. |
| `--port <n>` | start, preview | The port, an integer from 1 to 65535. Default: the port of a local collection `url:`, else the framework's default. |
| `--host <host>` | start, preview | The host to bind. Default: the host of a local collection `url:`, else the framework's default. |
| `-c, --config <file>` | all | The config file, as in every domain. |
| `-- <args...>` | all | Appended verbatim to the command manni runs, after npm's own `--` where one is needed. With `preview` they go to the serve step, not the build. |

The arguments after `--` are space-separated, because they are argv. That is
the positional shape of the one-separator rule.

There is no `-f, --format`. These verbs print no report, so the framework's
own output is the output.

### 3. Finding the site

1. `[dir]` when it is given, else `site.dir`.
2. Otherwise a search, where the first match wins. It looks in the config
   file's directory, or the working directory when there is no config. Then it
   looks in that directory's `docs/`, `website/` and `site/`.
3. In a directory, the markers in decision 4 decide the framework.

In this repository the root `package.json` names no framework, and
`docs/package.json` has `@astrojs/starlight`. So the site is Starlight in
`docs/`, and this repository's config needs no `site:` section.

### 4. The frameworks detected

| Framework | Marker | start | build | preview | Port / host flags | Default port |
|---|---|---|---|---|---|---|
| Mintlify | `mint.json`, or `docs.json` with Mintlify's `$schema` or `theme` | `mint dev` | none | none | `--port` / none | 3000 |
| Fern | `fern/fern.config.json`, and the site's directory is its parent | `fern docs dev` | none | none | `--port` / none | 3000 |
| Starlight | an `@astrojs/starlight` dependency | `dev`, else `astro dev` | `build`, else `astro build` | `preview`, else `astro preview` | `--port` / `--host` | 4321 |
| Docusaurus | an `@docusaurus/core` dependency | `start`, else `docusaurus start` | `build` | `serve`, else `docusaurus serve` | `--port` / `--host` | 3000 |
| VitePress | a `vitepress` dependency | `docs:dev`, else `vitepress dev <root>` | `docs:build` | `docs:preview` | `--port` / `--host` | 5173 |
| Nextra | a `nextra` dependency | `dev`, else `next dev` | `build` | `start`, else `next start` | `--port` / `--hostname` | 3000 |
| Fumadocs | a `fumadocs-core` dependency | as Nextra | as Nextra | as Nextra | as Nextra | 3000 |
| Rspress | an `rspress` or `@rspress/core` dependency | `dev`, else `rspress dev` | `build` | `preview` | `--port` / `--host` | 3000 |
| MkDocs | `mkdocs.yml` | `mkdocs serve` | `mkdocs build` | the built-in server over `site/` | `-a host:port` | 8000 |
| Zensical | `zensical.toml`, or `mkdocs.yml` with `zensical` in the requirements or `pyproject.toml` | `zensical serve` | `zensical build` | the built-in server over `site/` | `-a host:port` | 8000 |
| Sphinx | `conf.py` or `source/conf.py` | `sphinx-autobuild <src> <src>/_build/html` | `sphinx-build -M html <src> <src>/_build` | the built-in server over `_build/html` | `--port` / `--host` | 8000 |
| Hugo | `hugo.toml`, `hugo.yaml` or `hugo.json` | `hugo server` | `hugo` | the built-in server over `public/` | `--port` / `--bind` | 1313 |
| Jekyll | `_config.yml`, with a Gemfile naming `jekyll` or `github-pages` | `jekyll serve` | `jekyll build` | the built-in server over `_site/` | `--port` / `--host` | 4000 |

Where a cell names a script and then a binary, the script runs when
`package.json` has it, because it carries the project's own flags. Otherwise
the binary runs through the detected package manager. That is the
`packageManager` field, then a lockfile found walking up to the git root, else
npm. Python tools run under `uv run` or `poetry run` when `uv.lock` or
`poetry.lock` is present. Jekyll runs under `bundle exec`.

### 5. The port and host come from the collection `url:`

The precedence is the flag, then a collection `url:`, then the framework's
default. A `url:` counts when its host is `localhost`, `127.0.0.1` or `[::1]`.
manni passes a port or host flag only when one of the first two supplies it.
Otherwise it passes nothing, and the framework's default stands.
When several collections name different local host and port pairs, manni
warns and uses the framework's default. This applies to `start` and
`preview`. It never applies to an override command, because manni cannot know
that command's flags.

So `manni site preview`, then `manni a11y check`, works with no flags. Both read
the one `url:` the collection declares.

### 6. The built-in server

MkDocs, Zensical, Sphinx, Hugo and Jekyll write a static directory and serve
none of it for a preview. For those, `preview` serves the output itself. It is
a small `node:http` static server with no dependency, bound to `127.0.0.1`. It
mounts the output at the collection `url:` path when there is one, so a site
under `/manni/` answers there. It serves `index.html` for a directory, and
`404.html` when the output has one. It prints its URL to stdout.

### 7. Config

Before, there is no `site:` key. After, every key is optional:

```yaml
site:
  # string. The site's directory, relative to this file.
  # Default: detected (decision 3).
  dir: docs

  # Each value is a string, a whole command line run through the shell in `dir`.
  # A set value replaces the detected command for that verb; the others stay detected.
  # `preview` still runs `build`, detected or overridden, first.
  commands:
    start: pnpm dev --port 4000
    build: pnpm build
    preview: npx serve dist -l 4000
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `site.dir` | string | detected | The site's directory, resolved against the config file. |
| `site.commands.start` | string | detected | Replaces the dev-server command. |
| `site.commands.build` | string | detected | Replaces the build command. |
| `site.commands.preview` | string | detected | Replaces the serve step of `preview`. |

When every command a verb needs is set, detection is skipped. So a framework
the table does not list works through config alone. `dir` then defaults to the
config file's directory.

### 8. Messages and exit codes

Every diagnostic goes to stderr with the `programName()` prefix. Stdout is the
child's own output, through inherited stdio, plus the built-in server's URL.

| When | Line | Exit |
|---|---|---|
| Before a detected command runs | `manni: Starlight in docs/. Running npm run dev -- --host 127.0.0.1 --port 4321` | n/a |
| Before an override runs | `manni: Running site.commands.start in docs/: pnpm dev --port 4000` | n/a |
| The built-in server is listening (stdout) | `http://127.0.0.1:8000/` | n/a |
| Ctrl-C or SIGTERM stops a server, or `preview` during its build | nothing | 0 |
| A build succeeded | the child's output | 0 |
| Local collection URLs disagree (a warning) | `manni: collections site and api name different local URLs. Using Starlight's default port; pass --port to pick one.` | n/a |
| Nothing found | `manni: no docs site found in ./, docs/, website/ or site/. Pass the site's directory, or set site.commands.start in manni.config.yaml.` | 2 |
| `[dir]` has no markers | `manni: no docs framework detected in website/. Set site.commands.build in manni.config.yaml.` | 2 |
| Two frameworks in one directory | `manni: docs/ holds more than one docs site: Docusaurus (@docusaurus/core), MkDocs (mkdocs.yml). Set site.commands.start in manni.config.yaml.` | 2 |
| No local build (Mintlify, Fern) | `manni: Mintlify has no local build. Run manni site start, or set site.commands.build.` | 2 |
| The binary is missing | `manni: mint not found on PATH. Install Mintlify's CLI, or set site.commands.start.` | 2 |
| A runner manni adds is missing | `manni: uv not found on PATH. Install uv, or set site.commands.start.` | 2 |
| The binary cannot start | `manni: hugo could not start: spawn EACCES` | 2 |
| Node dependencies are missing | `manni: astro is not installed for docs/. Run npm ci in docs/ first.` | 2 |
| The child failed | `manni: npm run build exited with code 1.` | 2 |
| The port is taken (built-in server) | `manni: port 8000 is in use. Pass --port, or stop the process holding it.` | 2 |
| A bad `--port` | `manni: --port must be an integer from 1 to 65535, got "abc".` | 2 |
| `--port` with an override | `manni: --port does not apply to site.commands.start. Put the port in that command.` | 2 |
| `--host` with an override | `manni: --host does not apply to site.commands.start. Put the host in that command.` | 2 |
| `--host` on Mintlify or Fern | `manni: Mintlify's dev server takes no host option. Drop --host.` | 2 |
| `preview` on Mintlify or Fern with only `build` overridden | `manni: Mintlify has no local preview. Run manni site start, or set site.commands.preview.` | 2 |
| Arguments after `--` for the built-in server | `manni: MkDocs previews through manni's built-in server, which takes no extra arguments. Drop the arguments after --.` | 2 |
| A `-c` file that does not exist | `manni: Config file not found: "ci/manni.config.yaml".` | 2 |
| `[dir]` is missing | `manni: website/ does not exist.` | 2 |
| An unknown config key | ``manni.config.yaml: `site:` has unknown key "framework". Supported keys: dir, commands.`` | 2 |
| A wrong type | `manni.config.yaml: site.commands.start must be a string.` | 2 |
| An empty command | `manni.config.yaml: site.commands.build must not be empty.` | 2 |

The verb in a `site.commands.<verb>` hint is the verb that ran. The current
directory shows as `./`. The missing-dependencies hint names the install
command of the detected package manager. That is `npm ci` when an npm lockfile
exists, else `npm install`, `pnpm install`, `yarn install` or `bun install`.
Two Node frameworks in one directory are named by their package, in table
order. Exit `1` is
never used, because nothing here is a finding.

### 9. The ladder

In this repository unless noted.

```text
# 1. Minimal
$ manni site start
manni: Starlight in docs/. Running npm run dev -- --host 127.0.0.1 --port 4321
 astro  v7 ready in 900 ms  ┃ Local http://127.0.0.1:4321/manni/
^C                                                     # exit 0

# 2. A production build only
$ manni site build
manni: Starlight in docs/. Running npm run build        # exit 0, or 2 on failure

# 3. Build, then serve the output; a11y finds it with no flags
$ manni site preview
manni: Starlight in docs/. Running npm run build
manni: Starlight in docs/. Running npm run preview -- --host 127.0.0.1 --port 4321
$ manni a11y check                                      # another terminal

# 4. CI (D7), replacing the hand-typed astro preview in docs.yml
- run: npx @hawkeyexl/manni site preview > preview.log 2>&1 &
- run: until curl -fsS http://127.0.0.1:4321/manni/ >/dev/null; do sleep 1; done
- run: npx @hawkeyexl/manni a11y check -f github

# 5. A directory named, and a port chosen
$ manni site start website --port 3001
manni: Docusaurus in website/. Running npm run start -- --port 3001

# 6. The built-in server (an MkDocs repository with uv)
$ manni site preview
manni: MkDocs in docs/. Running uv run mkdocs build
http://127.0.0.1:8000/

# 7. Mintlify, with its CLI installed globally
$ manni site start
manni: Mintlify in docs/. Running mint dev

# 8. A config override
$ manni site start          # site.commands.start: pnpm dev --port 4000
manni: Running site.commands.start in docs/: pnpm dev --port 4000

# 9. Everything at once
$ manni site preview docs -c ci/manni.config.yaml --host 0.0.0.0 --port 4000 -- --open
manni: Starlight in docs/. Running npm run build
manni: Starlight in docs/. Running npm run preview -- --host 0.0.0.0 --port 4000 --open

# 10. Usage errors, all exit 2
$ manni site build                  # a Mintlify repository
manni: Mintlify has no local build. Run manni site start, or set site.commands.build.
$ manni site start --port abc
manni: --port must be an integer from 1 to 65535, got "abc".
$ manni site start --port 4000      # site.commands.start is set
manni: --port does not apply to site.commands.start. Put the port in that command.
$ manni site start                  # an empty repository
manni: no docs site found in ./, docs/, website/ or site/. Pass the site's directory, or set site.commands.start in manni.config.yaml.
```

### 10. Programmatic API

No change. `src/index.ts` exports nothing new. Nobody has asked to start a
server from code.

### 11. This repository runs it

The comment on the `site` collection says to run `manni site preview`. The
Docs workflow's `a11y` job runs it in place of `npx astro preview`, and drops
its separate site build, because `preview` builds first. CI then proves the
Starlight detection and the port read from the collection `url:` on every pull
request.

## Known limits

- **Undetected frameworks.** GitBook and ReadMe have no local preview to run.
  Eleventy, Docsify, Redocly and Antora are not detected yet. Each is one table
  row when someone asks, and `site.commands` covers them until then.
- **Default output directories only.** The built-in server reads the
  framework's default output directory. A custom `site_dir` or `publishDir` is
  served wrong and needs `site.commands.preview`.
- **A small MIME map.** The built-in server knows the types a docs build
  writes. A file outside that map is served as `application/octet-stream`.
- **A local `url:` only.** A public collection URL names the deployed host's
  port, which says nothing about a local bind, so it is ignored here.
- **No dry run.** The line printed before each command already shows what
  runs.

## Stress test

What was tried against this design, and what each attempt changed.

### 1. Is `site` a domain at all?

0034 said the domain is the tool, and `site` wraps no tool of its own. 0045
answered the same question for `key`. A domain is a tool, or a family resource
with verbs. The site is the resource every other domain reads, so the verbs
that run it belong under its name. A top-level `manni serve` would be the
domain-less verb the grammar rules out.

**Changed as a result:** nothing in the grammar. `site` follows the `key`
precedent, and CLAUDE.md's key-layers list gains `src/site/`.

### 2. Why `site`, and not `docs`?

The domain was drafted as `docs`. Every manni domain serves documentation, so
`docs` names the family rather than this domain. Elsewhere the word means
showing a package's documentation, as in `npm docs`, `go doc` and `cargo doc`.
In this repository it also doubled the path, to `docs/src/content/docs/docs/`.

`site` names what the verbs act on, which is the rendered site. The collection
`url:` says where that site is published. This repository's collection is
already `name: site`. That is a value under `collections:`, and `site:` is a
top-level key, so the two never collide. They name the same thing.

Three other kinds of name were tried.

- `serve`, `preview` and `dev` are verbs or modes. A domain named for one
  breaks the noun-then-verb grammar of 0034, and `preview` is already a verb
  here.
- `framework`, `ssg` and `generator` name the tool that renders the site.
  0050 names a domain for its job and keeps the tool in config.
- `server` is wrong for `build`, which serves nothing.

**Changed as a result:** the domain is `site`. Its config key is `site:`, and
its section is `docs/src/content/docs/site/`, published at `/manni/site/`.

### 3. Why no `framework:` key?

A key naming the framework is a switch for a fact the files already state.
Every framework in decision 4 leaves a marker that names it. Two markers in one
directory are an error that asks for an override, rather than a guess. A
framework the table does not list needs its commands anyway, so a key that
named it would add nothing `site.commands` does not.

**Changed as a result:** detection decides, and `site.commands` is the only
override. An unknown `framework:` key is refused with the supported keys named.

### 4. Why does a failed build exit 2, not 1?

In this family `1` means findings, and `2` means something could not run. A
build that fails is a process that could not finish, and the framework has
already printed why. A CI script that reads `1` as "a11y found violations"
would otherwise read a broken build the same way.

**Changed as a result:** every failure here exits `2`. The message names the
command and its exit code, and leaves the cause to the framework's output
above it.

### 5. Why does `preview` always build?

A preview of yesterday's build is the failure this domain exists to remove. A
pull request that broke a page would pass `manni a11y check` against the stale
output. A `--no-build` flag would make that the fast path.

**Changed as a result:** `preview` runs `build` first, every time, including
when `site.commands.preview` is set. The cost is one build per preview, which
is what CI pays already.

### 6. Why do overrides live under `site:`, not top-level `tools:`?

`tools.<tool>` holds an outside tool's settings when several domains read
them, such as Vale's config path. `site.commands` belong to one domain, and no
other domain reads them. They are this site's commands too, rather than a
setting of Astro or MkDocs that another site would share.

**Changed as a result:** the commands are `site.commands.<verb>`. Nothing goes
under `tools:`.

### 7. Why do the port and host come from the collection `url:`?

A second place to declare the port is the problem in this repository. The
config comment, the workflow and the `url:` all had to agree by hand. a11y
already reads the `url:` as its seed, so reading the port from it makes the two
agree by construction. Only a local host counts, because a public URL's port
belongs to the deployed host.

Collections that disagree were tried as an error. That would stop `start` in a
repository that works fine on the framework's default. So it is a warning,
which names both collections and says to pass `--port`.

**Changed as a result:** the flag wins, then a local `url:`, then the
framework's default. Disagreement warns and falls back.

### 8. Why a built-in server rather than `npx serve`?

`npx serve` downloads a package at run time, and it serves from the root, so a
site built under `/manni/` answers at the wrong path. A small `node:http`
server needs no network, adds no dependency, and mounts the output at the
`url:` path.

**Changed as a result:** five frameworks preview through the built-in server,
and the MIME map carries a `ponytail:` comment naming its ceiling.

### 9. Where do the arguments after `--` go under `preview`?

`preview` runs two commands. Splitting the arguments between them would need a
second `--`, and argv has no way to say which half is which. The build's flags
are stable, so they belong in `site.commands.build`. The serve step's flags
change per run.

**Changed as a result:** the arguments go to the serve step only. The
built-in server takes none, so arguments after `--` are refused there.

## Verification

```bash
npm ci && npm run typecheck && npm run lint && npm test     # strict types, type-aware lint, the suite
npm run build && npm run docs:check-cli                     # site/reference/cli.mdx against src/site/cli.ts
node dist/cli.js meta validate && node dist/cli.js term check && node dist/cli.js cite check
npm run docs:check-docevals                                 # the deterministic evals over the site
cd docs && npm run build && cd .. && npm run docs:check-links
vale docs/proposals/0081-a-site-domain-runs-the-docs-site.md docs/src/content/docs/site
```

By hand in this repository, on Windows for the `.cmd` launcher path:

1. `node dist/cli.js site start` says Starlight in `docs/` and serves port 4321,
   read from the collection `url:`. Ctrl-C exits `0`.
2. `node dist/cli.js site build` exits `0`.
3. `node dist/cli.js site preview`, then `node dist/cli.js a11y check` from
   another terminal, crawls the served build with no flags.

On the pull request, the Docs workflow's `a11y` job runs `manni site preview`.

## Not breaking

- **A new domain.** `manni site` was an unknown command before, so no script
  ran it.
- **A new optional key.** A config without `site:` reads exactly as before.
- **One refactor.** The `cmd.exe` quoting moves from
  `src/lint/tools/dita-ot.ts` to `src/shared/`, so both callers share it. The
  DITA-OT behaviour is unchanged, and its tests stay as they are.

## Consequences

- Good, because one command serves the site in any docs repository manni
  detects, and config covers the rest.
- Good, because the a11y pages and this repository's workflow stop typing a
  framework's serve line, and the port agrees with the `url:` by construction.
- Bad, because each new framework is code, a row in the table and a fixture.
  The table is the contract, and every row is tested.
- Bad, because `preview` costs a full build on every run.
- The domain ships its docs section, an overview and `reference/cli.mdx`,
  verified by `docs:check-cli`. The IA gains the tenth domain, and the CUJs
  gain M26 and a one-command serve step in D7.
- The `feat` ships a demo video. It shows `manni site start` detecting
  Starlight in this repository, then `manni site preview` and
  `manni a11y check`. The accent follows `docs/content-strategy/design.md`.
