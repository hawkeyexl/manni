# 0033: one package, one bin: docmeta becomes `manni meta`

- **Status:** Implemented (this repository)
- **Serves:** Maya · M1, M2 · Devin · D1, D2 · Theo · T1
- **Depends on:** [0009](0009-publish-builtin-schemas.md), whose promise of
  byte-stable published URLs is the constraint that decided the repository
  question below. Also [0004](0004-config-upward-discovery.md), whose walk the
  family config discovery keeps.
- **Relates to:** [0023](0023-metadata-vocabularies.md), whose draft
  vocabulary ids change namespace here while they are still unregistered.
  [0019](0019-no-docmeta-init.md) still holds: there is no `init`, and the
  family file is written by the one command that already wrote a config.
- **Touches:** everything. `package.json`, `src/cli.ts`, `src/docmeta.ts`,
  `src/shared/**`, `src/meta/**` (formerly `src/**`), every docs page, the
  workflows, the Action.
- **Verdict:** Rename the package and CLI to `manni`, mount the metadata tool
  as `manni meta`, keep a `docmeta` bin, read one shared `manni.config.yaml`,
  and do it in a **new repository** rather than by renaming this one.

## Problem

docmeta grew a family. Four sibling tools exist in four repositories, each
importing this package as a library, each with its own bin, its own config
file, its own docs site, its own ADR log and its own release pipeline:
moose-docevals, moose-tracevals, moose-lint (renamed from doc-structure-lint)
and dockg. None of them is published. A person who wants the family installs
four packages, learns four config files and reads four sites, and the only
published one is the one whose name says nothing about the others.

The name is the second problem. `docmeta` names the metadata tool, not the
family, and the working brand for the family (`moose`) is taken on npm by an
ORM last touched in 2022. So is `manny`. `manni` is free, on npm and on GitHub.

## Decision

### One package, one bin, one subcommand per tool

`manni` is the package and the bin. Each tool builds its own commander program
and is mounted under its name: `manni meta validate …` is the metadata tool's
`validate` with nothing in between. The umbrella owns only what is common: the
name, the version and the exit-code contract.

The metadata tool moves to `src/meta/`; every later tool takes a sibling
directory, imports the metadata library by relative path, and lands on its own
branch, merged only when it is production-ready. Until a tool merges, its
subcommand does not exist and `manni --help` lists exactly what does.

**Rejected: plugin discovery.** A `manni docevals` that resolves a separately
published `moose-docevals` at runtime avoids a dependency cycle (the tools
import docmeta as a library) but keeps four repositories, four pipelines and
four version numbers. The cycle is real only across package boundaries; inside
one package it is a relative import.

**Rejected: a core split.** Publishing the library as one package and the CLI
as another doubles the publishes per change and gives the first release a
bootstrap ordering problem, for a boundary no user asked for.

### `docmeta` stays as a bin

The package ships a second bin, `docmeta`, that runs the metadata tool's
program under its old name: same options, same exit codes, same stderr prefix.
A script or workflow written against `docmeta …` keeps working. This is the one
deprecated alias `CLAUDE.md` allows, and it exists because the user asked for
it: the metadata tool is the only published, production package in the family,
with eighteen releases and CI users, and its commands are honored.

### One config file

`manni.config.yaml`, one top-level key per tool, read by every tool in the
family. The metadata tool reads `meta:` and ignores its siblings. That is the
convention the three sibling tools already shipped (`docevals:`,
`tracevals:`, `lint:` in `moose.config.yaml`), so it is what manni does.

**Rejected: top-level keys as a family base with a per-tool overlay.** An
earlier plan for a `moose-meta` rename (never merged) treated top-level keys as
shared defaults and `meta:` as an overlay. It made `paths:` mean the same thing
for every tool, which is appealing until two tools disagree about what a path
is for. Every tool that shipped read only its own key; a rule three tools
follow beats a nicer rule none of them do.

Two older names are still discovered, each with a warning said once per run:
`moose.config.yaml` (same shape) and `docmeta.config.yaml` (whole document is
the `meta:` section). A family file with no `meta:` key belongs to a sibling
and is skipped, so a repository mid-migration keeps working. An explicit `-c`
path is unwrapped when it has the key and taken whole otherwise, with no
filename sniffing and no new flag; a flag would have to be added to every
command to keep 0005's parity, for a problem the file's shape already solves.

Fixing the family discovery also fixed a latent bug: `parseConfig` ran inside
the `try` whose `catch` meant "not found", so a discovered config with a typo
was silently skipped and the run continued on defaults. With six candidate
names instead of two that would have become a confusing bug. A typo is an
error now.

### What is renamed, and what deliberately is not

| Renamed | Kept |
|---|---|
| Help examples, error hints, the stderr prefix (follows the bin that ran) | `DocmetaError`, `DocmetaConfig` and every other exported symbol: renaming them is a second breaking change with no user benefit |
| JUnit suite and classnames, SARIF driver name, rule ids (`manni/parse-error`) | The SARIF fingerprint key `docmetaViolation/v1`: it is what keeps an alert opened by a docmeta run the same alert under manni |
| Cache directories, to `.manni/meta/…`; caches are regenerable, so nothing migrates | The baseline is committed, so `.docmeta-baseline.json` is still read when `.manni-baseline.json` is absent, with a warning |
| The published schema base, to `hawkeyexl.github.io/manni/schemas/` | Every old published URL: still served (below) and still resolved to the bundle, in the registry and in Ajv |
| The draft vocabulary ids of 0023, to `manni:<vocab>:<version>` | The published built-in ids (`google:okf:0.1` …): immutable by 0009 |

### A new repository, not a rename

`hawkeyexl/docmeta` stays where it is. `hawkeyexl/manni` is seeded from its
full history, without the version tags, so `git blame` and every ADR reference
survive while semantic-release starts manni at 1.0.0.

The deciding fact is 0009. GitHub redirects a renamed repository's git and
HTML URLs but not its Pages URLs, and `hawkeyexl.github.io/docmeta/schemas/*`
is a promise: byte-identical built-ins, forever, asserted by a daily workflow.
Renaming the repository would break every `$schema` written against those
URLs. Keeping the repository, cutting it down to a pointer plus the schema
bytes, and archiving it (archived repositories keep serving Pages) keeps the
promise at no ongoing cost.

The same choice removes every other hazard the rename plan carried: docmeta's
npm trusted publisher, GitHub App, ruleset and secrets are never touched;
there is no window where publishing fails closed; and the final docmeta
release, the one whose only change is a stderr notice saying where the tool
went, ships from the old repository's own `main` with its existing pipeline.

### Sequence

Everything docmeta first, then the other tools. docmeta is the only
production package; the rest live on their own branches until each is ready.

1. Push the history to `hawkeyexl/manni`; wire the release App, the ruleset,
   the trusted publisher, Pages.
2. This change lands on `main` there as `feat!` → `manni@1.0.0`.
3. `hawkeyexl/docmeta` ships 4.14.0: a three-line stderr notice, silenced by
   `DOCMETA_NO_RENAME_NOTICE=1`, never by `CI`. Then `npm deprecate`.
4. `hawkeyexl/docmeta` is reduced to `README.md`, `LICENSE`, `CHANGELOG.md`,
   the schema bytes and a Pages workflow, and archived.
5. One branch per tool, in the order docevals, lint, tracevals, kg, merged
   when production-ready. Each import commit cites the source repository and
   SHA; the archived repositories keep the full history.

## Postscript, 2026-09-05: the npm name is scoped

`npm publish` refused the unscoped name with a 403: "package name too similar
to existing package `vanli`". `npm view` cannot see that check. It fires only
at publish time. `vanli` is an unrelated 2024 package by another author. The
only route to the unscoped name is an npm support request, and support
publishes no turnaround. So the package ships as **`@hawkeyexl/manni`**, and
the request is filed in parallel.

Nothing else in this record changes. The bin is still `manni`, so
`manni meta validate` in a script is the same command. The repository, site,
config file, Action reference and vocabulary ids keep the bare name. Only the
install spelling carries the scope: `npm i -D @hawkeyexl/manni`, and
`npx @hawkeyexl/manni meta …`. If npm grants the unscoped name later, it is
published as a second package, and the scoped one is deprecated with a pointer.

The version line starts at 0 rather than 1. `v0.0.0` is tagged on the seed
commit, so the first release is 0.1.0. The Action reference is
`hawkeyexl/manni@v0`. Reaching 1.0 is a decision for after the other tools
have landed, not a side effect of the rename.

## Consequences

- Every `hawkeyexl.github.io/docmeta/*` page that is not under `schemas/`
  stops resolving once step 4 lands. The README, the npm deprecation message
  and the redirect index carry the new address.
- Two `main`s exist between steps 2 and 4. A fix that matters to both packages
  lands in both. Keep the window short.
- The Action reference becomes `hawkeyexl/manni@v1`. `hawkeyexl/docmeta@v4`
  keeps resolving in the old repository for as long as it exists.
- The test suite grows by one file per tool as they land, and the CI matrix
  (3 OS × 2 Node) runs all of it. If that doubles wall-clock time, split
  `build-test` per tool with `vitest --project`; not in this change.
