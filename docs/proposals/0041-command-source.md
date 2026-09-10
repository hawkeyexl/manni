# 0041: the `command` source, a managed field derived by a program the config names

- **Status:** Implemented (#21)
- **Serves:** Maya · M1, M2 · Devin · D4 · Sara · S2
- **Depends on:** One earlier proposal.
  - [0040](0040-derived-metadata.md) is the derived channel. A managed field
    is stamped by `derive`, compared by `validate`, and refused by `fill` and
    `query`. This proposal adds a source to that channel and changes none of
    its rules.
- **Relates to:** Three proposals this one touches without depending on them.
  - [0026](0026-corpus-checks-are-findings.md) put SQL in the config file and
    trusted the operator who wrote it. Decision 5 stands on the same line.
  - [0038](0038-sidecar-url-manifests.md) rule 6 put a manifest URL in the
    config and drew the same line again. This is the first config key that
    executes something, and the line does not move.
  - [0023](0023-metadata-vocabularies.md) round 9 gave `verified-against` its
    object form, `{name, version}`, so a drift check could compare it without
    parsing prose. This is the tooling that compares it.
- **Touches (planned):** `src/meta/core/derive/{types,command}.ts`,
  `src/meta/core/config.ts`, `src/meta/commands/{derive,validate,get,query,fill}.ts`,
  `src/meta/cli.ts`, `src/meta/index.ts`,
  `reference/{configuration,cli,query,output-and-exit-codes,api}.mdx`,
  `set-up/derived-metadata.mdx`, `proposals/stewardship.mdx`,
  `test/derive-command.test.ts`, `test/fixtures/derive/command/`
- **Verdict:** Add a fourth kind of source, **`command`**. Config names a
  frontmatter key and an argv to run, and the trimmed stdout is the derived
  value. The field is then managed exactly as the six built-ins are. A
  command may only derive a field no built-in source claims.

## Problem

0040 answered Batami Gold's comment of 2026-09-05 for two of her three
questions. Git knows when a page changed and who changed it. CODEOWNERS knows
who answers for it. GitHub or GitLab knows who approved the change. The first
question she asked stayed open, and 0040 said so:

> What version did you check this against?

0040's vocabulary table listed `verified-against` under "not derivable, and
not offered", because the answer is a judgment a person makes. That is true
of the judgment. It is not true of the evidence the judgment is checked
against. A repository that documents `operator` carries `operator`'s version
in `package.json`, a `VERSION` file, or a `git describe` away. What a page
was verified against is a person's claim. What the product's version *is* can
be read by a program. A stamp that disagrees with it is exactly the drift
0040 exists to catch.

Manny asked the general form of the question on 2026-09-09, reviewing the
0040 build:

> what if I wanted to specify a command to run to derive the value of a
> different field?

The four built-in sources are four programs manni knows how to run and read.
This proposal lets the config name a fifth, and any number after it, for
fields the built-ins do not claim. `verified-against` is the first and the
reason. `source-of-truth` from a script that knows the repository's layout is
the second.

## Decision

Nine decisions, then the config, the ladder, and the shapes.

1. **`run` is an argv list, never a shell string.** One separator per list,
   and argv is the list a process receives. A shell string would need
   quoting rules, and the rules differ between `sh` and `cmd.exe`. One
   config would run on one platform and break on the other. A user who wants
   a shell writes `["sh", "-c", "…"]` and owns the quoting.
2. **Per run or per file, chosen by a placeholder.** An argv containing
   `{path}` runs once per document, with the document's run label
   substituted, so a script can answer for one page. An argv without it runs
   once per run, and the one value is copied to every document. There is no
   flag for this. The argv says which it is.
3. **The value is the trimmed stdout, and only structured JSON is parsed.**
   `1.4.2` is the string `1.4.2`. `["a","b"]` is a list.
   `{"name":"operator","version":"1.4.2"}` is an object, which is
   `verified-against`'s checker form from 0023 round 9. Empty stdout with
   exit 0 is null, meaning no fact, which is never stale. Only `{`, `[` and
   `"` open a parse. The pre-merge review found the first draft parsing any
   JSON, which silently rewrote a bare scalar. `1.10` became the number
   `1.1`, so a command reporting version 1.10 stamped 1.1 into the document.
   A field wants the characters the command printed. An object or a list is
   the only thing a parse was ever for.
4. **A command may only derive a field no built-in source claims.** A
   command for `last-updated` is a config error, exit 2. The six built-ins
   have one authority each. A second authority for the same key would make
   the finding's message a lie about where the value came from. A
   command may not target a sidecar-owned key either, for 0040 rule 4's
   reason, nor `$schema`, because the schema pointer is never metadata.
5. **The config that runs a command is operator-trusted.** 0026 put SQL in
   `checks:` and ran it. 0038 rule 6 put a URL in `sidecars[].file` and
   fetched it. Both drew the line at the config file, which is a reviewed
   file in the repository the operator owns. A command is on the same line.
   It is the first config key that executes something, and it is still the
   config that names it. A document can never supply a command. Nothing in a
   document reaches the argv, and `{path}` is the run label, which the
   corpus walk produced, not a value the document carries.
6. **Managed means managed.** A command-derived field is stamped by `derive`,
   compared by `validate` under `derived:stale/derived`, refused by `fill`
   and `query`, shown by `get --derived`, and given a column in the `derived`
   table. No rule of 0040 has a command-shaped exception.
7. **The source is named `command`, once.** `sources:` lists `command` beside
   `git`, `codeowners`, `github` and `gitlab`, and the default is all five.
   Excluding it makes every command field derive null. `DerivedValue.source`
   is `command`, and the evidence string is the argv joined with spaces,
   `{path}` already substituted. So the finding names the program that
   disagreed, and a reader can run it by hand.
8. **Commands run in the config file's directory.** That is where every
   other config-relative path resolves from, per 0004, so a `run` that names
   `package.json` finds the one beside the config. With no config, the
   working directory. The environment is inherited, and manni adds nothing
   to it.
9. **No cache.** A command is the operator's, and only the operator knows
   what it reads. A cache keyed by anything manni can see would return a
   stale version after a release, which is the false green 0014 forbids.
   Stress test 6 records the cost.

### Config

Under `meta.derive`, one new key:

```yaml
meta:
  derive:
    fields: [last-updated, verified-against]
    sources: [git, command]                  # optional; default all five: git, codeowners, github, gitlab, command
    commands:
      verified-against:
        run: ["jq", "-r", ".version", "package.json"]
      source-of-truth:
        run: ["node", "scripts/source-for.mjs", "{path}"]   # per file
        timeout: 30                                          # seconds; default 60
```

| Key | Type | Required | Rule |
|---|---|---|---|
| `derive.commands` | map of field name to command | no | Each key is a top-level frontmatter key. It may not be one of the six built-in fields, a sidecar-owned key, or `$schema`. Each violation is a config error, exit 2, naming `derive.commands.<field>`. A `derive:` with only `commands:` is valid. |
| `derive.commands.<field>.run` | `string[]` | yes | The argv. Never a shell string. Non-empty. `{path}` anywhere in an element makes the command per file. |
| `derive.commands.<field>.timeout` | integer, seconds | no | Default `60`. A command still running at the limit is killed, and the source is unavailable. |
| `derive.fields` | `string[]` | no | Unchanged, except that a key with an entry in `derive.commands` is now derivable. A key with neither a built-in source nor a command is refused as before, and the message ends `…, or any key with an entry in derive.commands`. |
| `derive.sources` | list | no | Gains `command`. The default is all five. |

### The ladder

```console
$ manni meta derive
docs/install.md
    verified-against  1.4.1 → 1.4.2   (command: jq -r .version package.json)
1 file, 1 changed, 1 field written
                                                                    exit 0
$ manni meta validate
docs/install.md
    /verified-against  verified-against says 1.4.1; command says 1.4.2 (jq -r .version package.json) — run manni meta derive  (line 7)  [derived:stale]
1 file checked, 1 failed
                                                                    exit 1
$ manni meta get verified-against docs/install.md --derived
docs/install.md: verified-against=1.4.1 (derived 1.4.2, command: jq -r .version package.json)
                                                                    exit 0
$ manni meta derive --sources git             # command excluded; the field derives null
docs/install.md  current
1 file, 0 changed, 0 fields written
                                                                    exit 0
$ manni meta derive                           # package.json is missing
manni: command source unavailable: `jq -r .version package.json` failed (exit 2): jq: error: Could not open package.json; narrow --sources or --fields
                                                                    exit 2
$ manni meta derive                           # jq is not installed
manni: command source unavailable: `jq` is not on PATH (derive.commands.verified-against); narrow --sources or --fields
                                                                    exit 2
$ manni meta derive                           # the script hangs
manni: command source unavailable: `node scripts/source-for.mjs docs/install.md` timed out after 60s; narrow --sources or --fields
                                                                    exit 2
$ manni meta derive                           # commands.last-updated in config
manni: derive.commands.last-updated targets a field git already derives; a command may only derive a field no built-in source claims
                                                                    exit 2
```

### Shapes

The `derived` table gains one `TEXT` column per key in `derive.commands`,
after the six built-in columns and before `_sources`. A list or object is
JSON text, as in `docs`. `_sources` carries `{source: "command", evidence:
"jq -r .version package.json"}` for each non-null command value. In `get
--derived`'s JSON, the `derived` record's `source` is `command`.

The public types, extending 0040's:

```ts
export const DERIVE_SOURCES = ["git", "codeowners", "github", "gitlab", "command"] as const;
export interface DeriveCommand { run: string[]; timeout?: number }
export interface DeriveConfig {
  fields: string[]; sources?: DeriveSource[]; codeowners?: string;
  commands?: Record<string, DeriveCommand>;
}
```

`DerivableField` widens from the six-member union to `string`, because the
set of derivable fields is now a function of the config. The six built-in
names stay in `DERIVABLE_FIELDS`, and a helper answers whether a given key
is derivable under a given config.

## Stress test

1. **A shell string.** The first sketch took `run: "jq -r .version
   package.json"` and split on spaces. Rejected. A path with a space breaks
   it, and the fix is quoting, whose rules differ per platform. Then the
   sketch passed the string to a shell. Rejected again. `sh` on the runner
   and `cmd.exe` on the laptop parse one string two ways, so the config
   would be correct on one and wrong on the other. Decision 1 makes the argv
   the list. A user who wants a pipeline writes `["sh", "-c", "…"]`, and the
   shell is then a visible choice in the config, not a hidden one in manni.
2. **Per-file cost over a large corpus.** A `{path}` command over two
   thousand pages spawns two thousand processes, and a slow script makes
   `validate` slow. Accepted, and bounded two ways. The placeholder is what
   opts in, so a command that does not need the path pays one spawn per run.
   And the `timeout` bounds each spawn, so a hung script is exit 2 with the
   argv in the message rather than a stuck gate. A batch form, where the
   command reads paths on stdin and answers in JSON, is recorded as a
   follow-up.
3. **The trust line.** Executing a program from a config file is the kind
   of feature that needs its own security paragraph. The paragraph is short,
   because the line was drawn twice before. 0026's `checks:` runs SQL the
   config wrote. 0038 rule 6 fetches a URL the config wrote, with a token
   the environment supplied. Both trust the config. It is a file in the
   repository, reviewed like any other file, and the operator who merges it
   owns what it does. A command is the same. What the line
   forbids is a document supplying any part of the argv. `{path}` is the only
   substitution, and its value is the run label from the corpus walk, which
   the document never sees. A frontmatter value is never interpolated, a
   document cannot name a command, and there is no per-document override.
   So an outside pull request that changes a document cannot change what
   runs. One that changes `manni.config.yaml` can, and that is the file a
   reviewer reads.
4. **Shadowing a built-in.** A config could name a command for
   `last-updated` and the sketch let it, on the theory that the operator
   knows best. Rejected. The finding says `git says 2026-09-07`, and with a
   command in the way the value would not be git's. Two authorities for one
   key would also mean two evidence strings and a precedence rule. Decision
   4 refuses the config with a message naming which built-in claims the
   field.
5. **Empty output against failure.** A version script that prints nothing
   could mean "no version" or "broken script". The two are told apart by
   exit code. Exit 0 with empty stdout is null, a fact with no value, which
   is never stale. Non-zero exit is unavailable, exit 2, with the last
   stderr line in the message. A script that wants to say "no answer"
   prints nothing and exits 0. One that failed exits non-zero, as every
   program already does.
6. **Why no cache.** The review cache in 0040 is keyed by commit, because a
   merged pull request's answer never changes. A command's inputs are
   unknown to manni. `jq -r .version package.json` reads one file, `git
   describe` reads the whole history, and a script may read the network.
   Any key manni chose would be wrong for one of them. A wrong cache hit
   after a release is a stale version reported as current. The cost is
   one spawn per run for a per-run command, which is what `git log` already
   costs. A cache keyed by files the config names is recorded as a
   follow-up, opt-in.
7. **Why `{path}` only.** The sketch offered `{sha}`, `{root}` and
   `{field}`. Rejected for version one. Each is one more thing a command
   can depend on and one more thing to document. None has a use the
   `{path}` form does not serve. A script given the path can run `git` on
   it. `{sha}` is the one with a real case, a command that reads a file at
   the newest body-changing commit. It is the first follow-up.

## Consequences

- `verified-against` stops being the field the tool could only require. A
  repository that keeps the product's version anywhere a program can read
  answers Batami's first question from evidence.
- `validate` may now spawn any program the config names. A config with no
  `commands:` spawns nothing new. `--sources` without `command` makes every
  command field derive null, and `--no-derive` skips the comparison.
- The derivable set is no longer fixed. Every message that listed the six
  fields now ends with `, or any key with an entry in derive.commands`, and
  `DerivableField` is `string`.
- The `derived` table's column set depends on the config. A query that
  selects a command column by name derives only that column, as for the
  built-ins. A read of `owner` still spawns no command.
- A config that names a command is a config that executes, and the review of
  a pull request touching `manni.config.yaml` now includes reading the argv.
  The docs say so where the key is defined.

## Follow-ups recorded, not promised

- **An `env:` map on a command.** `env: {OPERATOR_HOME: ../operator}` merged
  over the inherited environment, so a script does not need a wrapper to
  find its inputs.
- **A `{sha}` placeholder.** The newest body-changing commit for the
  document, from the walk 0040 already runs. A command could then read a
  file as it was when the page last changed.
- **A cache keyed by named input files.** `cache: [package.json]` on a
  command, hashed before the spawn, so a per-run command over an unchanged
  input is free. Opt-in, because decision 9 says manni cannot guess the
  inputs.
- **A batch form.** A command that reads run labels on stdin, one per line,
  and answers with a JSON object keyed by label. That serves the corpus in
  stress test 2.
