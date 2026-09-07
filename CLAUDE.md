# CLAUDE.md

Guidance for agents working in this repository.

## What manni is

One npm package, `@hawkeyexl/manni`, and one bin, `manni`, with one subcommand per tool in the
family. Today that is `manni meta`, the metadata tool, published as `docmeta`
until 4.13.1. The other tools (docevals, lint, tracevals, kg) are folded in
one at a time, each on its own branch, merged only when production-ready.
Proposal 0033 is the record.

Every command reads `manni <domain> <subcommand> [<subcommand>] [<arguments>]`.
The domain is the tool: `manni meta validate docs/`, `manni meta schemas vendor`
and, once it lands, `manni a11y check <url>`. Proposal 0034 states the grammar
and what it rules out.

`manni meta` is a TypeScript CLI that validates the **presence and format** of
document metadata (frontmatter / headers) against **JSON Schema**, built for
CI. The pipeline is: load files → extract metadata (format-specific) → resolve a
schema set per file → validate → report. Everything after extraction operates on
the generic `ExtractedMetadata` shape, so new input formats never touch
validation, schema resolution, or reporting.

Key layers:
- `src/cli.ts`: the `manni` umbrella. Builds each tool's commander program and
  mounts it under its name. Owns nothing else.
- `src/docmeta.ts`: the `docmeta` bin. The metadata tool's program under its
  old name, for scripts written before the rename.
- `src/shared/`: what every tool uses. Family config discovery
  (`config-file.ts`: one `manni.config.yaml`, one top-level key per tool),
  `warn()` (stderr, said once), the `ToolError` base, the bin runner
  (`run.ts`, which owns the exit-code contract) and the program name the
  stderr prefix follows.
- `src/meta/`: the metadata tool.
  - `src/meta/extractors/`: per-format metadata extraction behind the
    `MetadataExtractor` interface (`src/meta/types.ts`). New formats are an
    isolated change to one file plus registration in `extractors/index.ts`.
  - `src/meta/commands/`: command cores (`validate`, `get`, `query`, `fill`,
    `schemas`), kept free of CLI/IO plumbing so they can be unit-tested directly.
  - `src/meta/cli.ts`: thin commander wrapper over the command cores, exported
    as `buildProgram()` and mounted by `src/cli.ts`. No entry point of its own.
  - `src/meta/core/`: file resolution, config, schema resolution, validation.
  - `src/meta/reporters/`: output formatting (pretty / json / github / sarif / junit).
- `src/a11y/`: the accessibility tool, `manni a11y check`.
  - `src/a11y/core/`: URL normalization and host scope, sitemap discovery
    (`robots.txt` `Sitemap:` lines, then `/sitemap.xml`), the same-host crawl,
    the Playwright analyzer (the browser seam, behind `PageAnalyzer`), and the
    `a11y:` config loader.
  - `src/a11y/commands/`: the `check` command core, free of CLI/IO plumbing.
  - `src/a11y/reporters/`: output formatting (pretty / json / github).
  - `src/a11y/cli.ts`: thin commander wrapper exported as `buildProgram()` and
    mounted by `src/cli.ts`. No entry point of its own.
- `src/index.ts`: the programmatic API, re-exporting `src/meta/index.ts`.

The metadata tool's tests stay flat under `test/`; each later tool adds
`test/<tool>/`, and `test/a11y/` is the first of those.

### Folding a tool in

Each tool lands on its own `tool/<name>` branch (never `feat/…`, which
`.releaserc.json` treats as a prerelease channel and publishes on every push).
Its sources go to `src/<tool>/`, importing the metadata library by relative
path (`../meta/index.js`); its `cli.ts` exports `buildProgram()` and has no
entry point; its error class extends `ToolError`; it reads its own key of
`manni.config.yaml` through `src/shared/config-file.ts`; its stderr prefix
comes from `programName()`. The umbrella mounts it with `addCommand`. The
import commit cites the source repository and SHA. A new domain also ships a
`docs/src/content/docs/<domain>/` section with at least an overview page and a
`reference/cli.mdx` page. `docs:check-cli` is extended to verify that reference
page against the domain's commander program, as it already does for `meta`.

## Working agreements

These are project preferences. Follow them unless the user says otherwise.

### Commands must have parallel behaviors

Every subcommand should expose a **consistent surface**. When one command gains
an input affordance, the others should match it (where it makes sense). Concrete
baseline shared by `validate`, `get`, and `fill`:

- Targets are **positional** `[paths...]`: files, directories, and globs.
- `-` reads **stdin** (requires `--as <format>` to pick an extractor). It is one
  more input, processed *alongside* any named paths, never instead of them.
- `paths:` from `manni.config.yaml` is the **fallback** when no positional
  paths are given.
- No inputs and no config is an **operational error** (`DocmetaError`, exit 2),
  not silent empty output.
- Shared flags use the same names/semantics: `--as`, `--ext`, `--exclude`,
  `-c/--config`, `-f/--format`.

Do not introduce per-command input conventions (e.g. an `--in` option on one
command but positional paths on another). If a parser limitation forces a
difference, prefer changing how the *other* argument is supplied rather than
breaking parity.

Do not add a deprecated alias to soften a rename unless asked. Breakage is not
free here. manni meta is past 1.0 and published to npm, and semantic-release turns
a breaking change into a major release. That costs the version number and a
release note. The objection to an alias is a different one. An alias is a
permanent second surface for one command, which is what "commands must have
parallel behaviors" exists to prevent. When a rename is right, make it and mark
the commit `feat!:` / `BREAKING CHANGE:` so the release says so.

### Every command lives under a domain

The umbrella in `src/cli.ts` owns no verbs and no flags beyond `--version` and
`--help`. A domain is a tool mounted with `addCommand`, and its verbs are
subcommands of the domain. A third level groups related verbs under a noun, as
`meta schemas vendor` does. There are no top-level verbs and no domain-less
aliases. `manni validate` is not a shortcut for `manni meta validate`. When
someone types it, the umbrella's only job is to say where the command went.

One thing does not fit. `manni meta docs/` runs `validate`, because
`docmeta docs/` did and the scripts written against it are honored. That
default subcommand is grandfathered from docmeta and is not a pattern a new
domain copies. A domain with one verb still spells the verb.

The reason is that two more domains are about to land on their own branches.
A grammar that lives only in `src/cli.ts` gets re-derived, slightly
differently, by every branch that mounts one. Proposal 0034 is the record.

### Plans show the full interface

A plan for a code change spells out every exported type, every function
signature, and every CLI argument and option. For an argument or option that
means the name, type, default, required or optional, and what it does. It also
spells out every config key and every output shape it adds or changes. "Add a
flag for X" is a sentence, not a plan. The review happens on the plan, so
anything the plan leaves to be invented during implementation is something the
reviewer never saw. The first time anyone looks at it is in the diff.

**CLI plans show examples from minimal to maximal.** A plan that adds or
changes a command carries a ladder of invocations. The first rung is the bare
minimum that does something useful. Then come the common variants (config
fallback, the CI format, the scripting form) and one invocation that uses every
option at once. The last rung is the usage errors with their exact stderr line
and exit code. Each rung shows the command and what it prints. The option table
says what each flag is; the ladder shows whether the flags compose into a
command a person would type. It is where a missing default, an awkward pairing,
or a parity break with `meta` gets caught before it ships.

### One separator per list

A list reaches a command in exactly one of three shapes, and a given flag uses
exactly one of them:

- A positional variadic (`[paths...]`) is space-separated, because that is
  what argv is.
- An option written `<list>` (`--ext`, `--fields`) is comma-separated and
  given once. A second occurrence replaces the first.
- A repeatable option (`--exclude <glob>`, `-s <ref>`) takes one value per
  occurrence and never splits on commas.

A flag that accepts both commas and repeats has two spellings for one thing.
The docs, the tests and the config mapping all pay for the second one. The
same rule applies to any interface a plan defines, CLI or not: pick one
separator per list and name it. It is written down because a plan once mixed
the two on one flag. The fix was cheaper before the flag existed than it would
have been after.

### Use subagents liberally to preserve context

The main session is for decisions, review and the final report. Anything that
produces long output or many file reads goes to a subagent that reports a
conclusion, not a transcript. Concretely, exploration sweeps go to an Explore
agent. Each independent implementation chunk of a plan goes to its own agent,
with the plan section pasted in. Each runs its own red/green loop. Long
verification runs (`npm test`, `npm run lint`, a docs build) go to an agent
that reads the log and summarizes it back. And the demo-video pipeline goes to
the producer agent. Do not delegate the things that need the whole picture: the
plan itself, the interfaces between chunks, and the commit and PR text.

A session that reads every test log and every file it edits runs out of room
before the work is reviewed. That is the reason, and the review is the part
that catches mistakes.

### Red/green TDD

Develop test-first:

1. **Red.** Write or adjust tests for the new behavior and run them, and confirm
   they fail for the right reason.
2. **Green.** Implement the minimum to make them pass.
3. **Refactor.** Clean up with the tests as a safety net.

Sometimes a behavior change makes existing tests fail correctly, as when you
remove a flag. Update those tests as part of the red step rather than working
around them.

### Test fixtures per feature

When a feature needs sample input, add a **dedicated fixture** under
`test/fixtures/` rather than embedding large literals in tests or reusing an
unrelated fixture. Keep fixtures minimal and named for what they exercise (e.g.
`bad-timestamp.md`, `missing-type.md`). Inline string content is fine for small
stdin/parse cases.

### Content & documentation work

Before any user-facing writing or docs task, consult `docs/content-strategy/`:

1. Identify the **persona** the page serves: Maya (docs engineer), Devin (CI engineer), Sara (schema author), or Theo (contributor fixing a failure). See `personas.md`.
2. Find the matching **CUJ** in `cujs.md` (M1–M4, D1–D4, S1–S3, T1). Structure the content around reaching that outcome, not by document type or Diátaxis category.
3. Link into the **Reference shelf** (`reference/`) for exhaustive detail (flag tables, config keys, precedence chain). Journey pages explain the path; they don't duplicate reference.
4. Check `information-architecture.md` for the page's place in the content set and its ★ launch status.
5. Every page in `docs/src/content/docs/**` needs `title` and `description` frontmatter.
6. Anything **visual** follows `docs/content-strategy/design.md`, which governs
   the docs site and the demo videos alike. That covers a screenshot, a diagram,
   a code-block style, and an embedded video.

### Keep npm at 11.6.3 or newer when changing a dependency

Change dependencies normally, with `npm install <dep>` and a committed lockfile.
This needs npm **11.6.3** or newer. `npm run check:deps` asserts that floor and
auto-runs before `test`, `typecheck` and `build`, so the version cannot drift
back down unnoticed.

At 11.6.2 and below, npm writes an incomplete `package-lock.json`. It drops the
top-level entries for the peer dependencies of an optional package, while
keeping the dependency edges that point at them. Those peers are `@emnapi/core`
and `@emnapi/runtime`, reached through `@rolldown/binding-wasm32-wasi` (vitest →
vite → rolldown). The result installs happily, so nothing looks wrong locally,
and `npm ci` rejects it. Every workflow starts with `npm ci`. So on the next
push build-test, lint, docs and docs-as-tests all go red at once with
`Missing: @emnapi/core@<ver> from lock file`.

**This is not platform-specific**, whatever the symptom suggests. The repo
carried a "splice the lockfile by hand, never regenerate it" rule for a while,
on the theory that `npm install` was broken *on Windows*. It was not. npm 11.6.2
drops those entries on Linux, macOS and Windows alike, and npm 11.6.3 keeps them
on all three. The local npm was 11.6.1, two patch releases below the fix, while
CI's bundled npm was well above it. That is why only CI ever complained.

Regenerating the whole tree is fine again. Hand-splicing is not needed, and it
leaves its own cruft behind. The spliced lockfile had accumulated a stale nested
entry for `conventional-commits-parser` under `git-raw-commits` that a clean
regeneration removes.

Still worth doing after any dependency change: **read the lockfile diff**. A
change that adds packages you cannot name, or removes any, is worth stopping
for. And `npm link` / `npm unlink` rewrite `package-lock.json` as a side effect
of something you ran for another reason. Running the docs-as-tests suite (Doc
Detective) locally needs `npm link`. So check `git status` afterwards, and
`git checkout -- package-lock.json` if it was touched.

### Run `npm ci` first when working in a worktree

Worktrees live at `.claude/worktrees/<name>/`, **inside** the main checkout. A
worktree with no `node_modules` therefore does not fail. Node's resolution walks
up and silently finds the outer checkout's `node_modules`, which belongs to
whatever branch happens to be checked out there. `tsc` and `vitest` then run
against another branch's dependency tree. The type errors and test failures that
come back read exactly like real code bugs. Diagnosing that once cost a detour
through four "pre-existing failures" that were nothing of the kind.

`npm ci` is the fix. It installs *from* `package-lock.json` and never rewrites
it, so it cannot drag an unrelated lockfile change into your branch.

`npm run check:deps` asserts direct dependencies are installed in this checkout
at the locked versions, and names the outside directory when the walk happens.
It also asserts the npm floor from the section above. It runs automatically
before `test`, `typecheck`, and `build`, so both problems now announce
themselves instead of being diagnosed. Before believing any failure that smells
like a dependency, check that it passes.

### Every new feature ships with a short demo video

When a change adds a **feature**, also produce a short demo video suitable for
posting on LinkedIn. Do it as part of the same piece of work, without being
asked.

**When this applies.** Trigger on the commit type, since that is already the
thing semantic-release and commitlint agree on:

| Commit type | Video? |
|---|---|
| `feat:` / `feat(scope):` | **Yes** |
| `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:`, `build:` | No |

A bug fix does not get a video no matter how significant it felt to write. If a
branch carries both a `feat:` and some `fix:` commits, the feature is what the
video shows. When it is genuinely unclear whether something is a feature or a
fix, ask rather than guessing. The commit type is a release-visible decision
anyway.

**What it shows.** manni meta is a CLI, so the demo is a terminal session, not
slides:

1. the problem, as a real document or repo that is missing something;
2. the new command or flag, typed out and run;
3. the result, including the exit code where that is the point.

Aim for **20–45 seconds**. Use `test/fixtures/` as the material wherever it
fits, so the demo stays true to what CI actually runs. Keep the terminal legible
at phone size, with a large font, short lines, and no scrollback noise. Leave
`--no-color` off, because the color is worth showing. Add a one-line caption per
step rather than narration.

**How it should look.** `docs/content-strategy/design.md` is the spec. It covers
frame, capture geometry, bands, type, timing, and the palette. Read it before
shooting. One rule is least obvious and most often broken. The accent colour may
not be red, green, yellow or cyan, because manni meta's own output already uses all
four to mean something. Two of the first three videos shipped with an accent
that collided with the product output in the same frame.

**How to make it.** The tooling is **not in this repo**. It comes from plugin
skills, which you invoke with the Skill tool. Do not go looking for a vendored
script, and do not hand-roll `ffmpeg` when a skill covers the step:

| Step | Skill |
|---|---|
| Script the 20–45s beat sheet | `writing-toolkit:video-script-writing` |
| Plan the shots, if the feature needs more than one | `writing-toolkit:storyboard-creation` |
| Capture the terminal session | `writing-toolkit:video-recording` |
| Titles, callouts, motion | `remotion-best-practices` |
| Trim and assemble | `writing-toolkit:video-editing` |
| Burn in captions | `writing-toolkit:closed-caption-creation` |
| GIF instead of MP4 | `writing-toolkit:gif-creation` |

`writing-toolkit:video-multimedia-producer` is available as an agent when the
whole pipeline is worth delegating in one go, and
`writing-toolkit:video-multimedia-production-workflow` describes the end-to-end
process.

**Caption it.** LinkedIn autoplays muted, so a demo with no on-screen text reads
as a silent flicker in the feed. Captions or step titles are the only thing most
viewers will read, so they are not optional polish.

If a skill is genuinely unavailable in the session, say so plainly. Hand over
the script plus the exact commands to run, rather than silently skipping the
step or substituting a screenshot.

**Where it goes.** Write to `media/` (gitignored). **Do not commit video or GIF
binaries.** They bloat the history permanently, and this repo publishes a docs
site that does not need them. Attach the file to the PR, or hand the path to the
user.

**Posting is a human action.** Generate the asset and hand it over; never post
to LinkedIn or any other account, and never draft-and-send on someone's behalf.
Writing the suggested caption text is fine and useful. Publishing it is the
user's call, every time.

### Supersede a proposal, never amend it

`docs/proposals/` is an ADR log. Each file records what was decided **at the
time it was written**, on the evidence available then. That makes the wrong ones
as valuable as the right ones. They are the only account of why a decision
looked correct before it wasn't.

So when reality moves past a proposal, **write a new one that supersedes it**.
Do not edit the old file to match what shipped. Rewriting a verdict destroys the
record of the reasoning that produced it, and leaves no trace that the question
was ever open.

0007 is the worked example. It concluded "implement HTML, keep XML and DITA
read-only, permanently", and shipped all three. Both objections behind that
verdict turned out to be answerable. xmldom positions are reconstructible into
offsets, and DITA has a DTD-valid metadata channel in `<prolog>`. The right
response is a superseding proposal that states what changed and why, not a patch
to 0007's title and verdict. Reading 0007 as written is how the next person
learns that "permanently" was a judgment about effort, not a fact about the
format.

A superseding proposal should say what it supersedes, and the superseded one is
left exactly as it was.

The one exception is the `Status:` line, which is an index entry rather than
part of the record. `0004` went `Proposed` → `Implemented (#74)` in the PR that
implemented it, and that is how you find out a proposal was acted on. Mark a
superseded proposal `Superseded by NNNN` and change nothing else: not the title,
not the verdict, not the reasoning, however wrong they read afterwards.

### Other conventions

- **Strict TypeScript.** `tsconfig` enables strict settings including
  `noUncheckedIndexedAccess`. Avoid unsound casts and non-null assertions; guard
  indexed access and regex capture groups.
- **Type-aware lint.** `npm run lint` runs `typescript-eslint`'s
  `strictTypeChecked` set over `src/` and `test/`. It needs type information, so
  it is slower than a syntax linter, and worth the cost. What it catches that
  `tsc` does not is an *inferred* `any` crossing a boundary, such as a commander
  callback parameter, a `JSON.parse`, or a `ReadableStream<any>`. That never
  appears as the word `any` in the source, so it cannot be grepped for. When a
  rule is genuinely wrong here, turn it off in `eslint.config.js` with a comment
  saying why, rather than scattering inline disables.
- **Conventional Commits.** Commit messages are linted by commitlint and drive
  semantic-release (`fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE`
  → major). Scope extractor work as `feat(extractors): …`.
- **clig.dev output discipline.** Primary output to stdout, diagnostics to
  stderr; color only on a TTY and never under `NO_COLOR`/`--no-color`. Exit
  codes: `0` ok, `1` validation failures, `2` operational/usage errors.

## Commands

```bash
npm ci              # first thing in a fresh worktree — see the worktree note above
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run (unit + built-bin CLI integration)
npm run build       # tsup -> dist/ (needed before CLI integration tests)
npm run check:deps  # deps installed here, at locked versions (auto-runs before the three above)
npm run lint        # eslint, type-aware (strictTypeChecked) over src/ and test/
npm run test:coverage  # vitest with v8 coverage; reported, not gated
npm run docs:check-cli  # CLI reference must match src/cli.ts
npm run docs:check-action  # Action reference must match action.yml
npm run docs:check-api  # API reference must match the built dist/index.d.ts
npm run docs:check-links  # every internal link and anchor in the built site
                        # resolves. Reads docs/dist, so it needs
                        # `cd docs && npm run build` first.
npm run schemas:check   # published built-in schemas immutable and in sync (local)
npm run schemas:check-published  # ...and the live URLs still serve those bytes.
                        # Hits the network, so it runs on a daily schedule
                        # rather than in PR CI — see published-schemas.yml.

# After editing anything under docs/, run the dogfood check too. manni meta
# validates its own docs, and the Docs deploy is gated on it. No paths and no
# -s: both come from the repo's own manni.config.yaml, so this exercises
# config discovery rather than stepping around it. The override there carries
# two schemas — the house rule (title + description) and the Starlight contract
# this site runs on.
node dist/cli.js meta validate
```

Command cores are tested directly in `test/*.test.ts`; the full CLI is exercised
against the built `dist/cli.js` in `test/cli.integration.test.ts`.

**Editing docs frontmatter is a validation change, not a prose change.** A
`description:` containing `: ` is invalid YAML unless quoted, so a rephrase can
break the parse. Run the dogfood command above before pushing; it is what the
deploy gates on.
