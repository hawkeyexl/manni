# 0034: The command grammar

- **Status:** Accepted
- **Serves:** Every persona; it is the shape of the CLI surface, as
  [0005](0005-command-parity.md) and [0016](0016-flag-ownership.md) are
- **Depends on:** [0033](0033-manni-monorepo.md), the umbrella this grammar
  describes
- **Relates to:** [0005](0005-command-parity.md), which makes sibling verbs
  match, and [0016](0016-flag-ownership.md), which says which command a flag
  belongs to. This one says where a verb belongs.
- **Touches:** `CLAUDE.md`; `src/cli.ts` only as the thing being described (it
  already complies); every future `src/<domain>/cli.ts` and the plan that
  precedes it
- **Verdict:** Every command is
  `manni <domain> <subcommand> [<subcommand>] [<arguments>]`. The umbrella owns
  no verbs. A list has one separator. A plan for a command shows its full
  interface and a ladder of examples, minimal to maximal.

## Problem

0033 mounted the metadata tool as `manni meta` and said the umbrella owns only
the name, the version and the exit-code contract. That sentence, plus the fifty
lines of `src/cli.ts`, is the whole written record of how a manni command is
shaped. The grammar is implied, not stated. Nothing says whether a domain may
have a top-level verb, or whether `manni validate` should exist as a shortcut.
Nothing says whether a second domain may copy `meta`'s default subcommand, or
how a flag that takes several values spells them.

With one domain that was fine. Two more are about to land on their own
branches, written by people and agents who read `CLAUDE.md` first and
`src/cli.ts` later, if at all. Each branch would re-derive the grammar from
the one example, and the derivations would differ exactly where the example is
silent. The cheapest time to write a grammar down is before the second speaker
of it exists.

A smaller problem surfaced while planning the first of those domains. A plan
proposed a flag that took a comma-separated list *and* could be repeated.
`meta` already has both shapes, `--ext <list>` and `--exclude <glob>`, and uses
them for different things; 0005 § stress test 4 declined a third spelling for
`--fields` on the same grounds. The rule existed as a precedent inside a stress
test, which is not somewhere a plan author looks.

## Decision

### The grammar

```
manni <domain> <subcommand> [<subcommand>] [<arguments>]
```

Three levels. The **domain** is a tool, mounted with `addCommand` in
`src/cli.ts`: `meta` today, `a11y` and the others as they land. Its
**subcommands** are the verbs: `manni meta validate docs/`. A **third level**
groups related verbs under a noun when a domain has enough of them to want it:
`manni meta schemas vendor`. Arguments follow.

The umbrella owns no verbs and no flags beyond `--version` and `--help`. There
are no top-level verbs and no domain-less aliases. `manni validate` does not
exist, and when someone types it the umbrella's only job is to say
`manni meta validate`, which it does today.

**Grandfathered:** `manni meta docs/` runs `validate`. `docmeta docs/` always
did, and 0033 keeps docmeta's commands working. The default subcommand stays on
`meta` and is not a pattern a new domain copies. A domain with one verb still
spells it: `manni a11y check <url>`, never `manni a11y <url>`. The reason is the
one 0005 recorded for `get`. A positional that is sometimes a verb and sometimes
an argument produces errors that blame the wrong thing.

### One separator per list

A list reaches a command in one of three shapes, and each flag uses exactly
one:

| Shape | Example | Separator | Second occurrence |
|---|---|---|---|
| Positional variadic | `[paths...]` | space, because that is argv | n/a |
| `<list>` option | `--ext md,mdx`, `--fields title,type` | comma, given once | replaces the first |
| Repeatable option | `--exclude <glob>`, `-s <ref>` | none; one value per occurrence, via `collect` | appends |

A repeatable option never splits on commas; a `<list>` option never appends. A
flag that accepts both has two spellings for one thing, and the cost lands in
three places. The reference page documents both, and the tests pin both. The
config key that mirrors the flag has to say which spelling it mirrors. The rule
applies to any list a plan defines, on the CLI, in config or in the API: pick
one separator and name it.

### What a plan shows

The review happens on the plan, so the plan has to contain what the review
needs to see.

**The full interface.** Every exported type, function signature, config key and
output shape the change adds or alters. Every CLI argument and option, with its
name, type, default, required or optional, and what it does. "Add a flag for X"
leaves the name, the default and the arity to be invented in the diff. The
reviewer meets them there for the first time.

**A ladder of examples, minimal to maximal.** For a command, the first rung is
the bare minimum that does something useful. Then the common variants (config
fallback, the CI format, the scripting form) and one invocation using every
option at once. Last, the usage errors with their exact stderr line and exit
code. Each rung shows the command and what it prints. An option table says what
each flag is. The ladder shows whether the flags compose into a command a person
would type. It is where a missing default, an awkward pairing, or a break with
`meta`'s parity gets caught before it ships. 0005's probe table is the model.

### Subagents, as a working practice

Not a rule about the CLI, but recorded here because it is how the next two
domains get built. The main session holds the plan, the interfaces between
chunks, the review and the commit text. Exploration, long verification runs and
the demo-video pipeline go to subagents that return a conclusion. So does each
independent implementation chunk, with its plan section pasted in. A session
that reads every test log runs out of room before the review, and the review is
where mistakes are caught.

## Stress test

### 1. Does the grammar forbid `manni --version`? (no)

`--version` and `--help` are flags, not verbs. The grammar is about the
positional structure. The umbrella keeps the two flags every CLI has and adds no
others. `manni --help` listing the domains is the grammar's index, not an
exception to it.

### 2. What about `docmeta validate`? (a second bin, not a second grammar)

`docmeta` is a bin that runs the `meta` program under its old name, allowed by
0033 as the one deprecated alias. Inside it the grammar holds: `docmeta
validate` is the domain program plus a subcommand, with the domain supplied by
the bin name instead of a positional. No other domain gets a bin, because no
other domain shipped under one.

### 3. Does a domain need at least two subcommands? (no)

`manni a11y check <url>` alone is a complete domain. The rule is that the verb
is spelled, not that it has siblings. What is ruled out is collapsing the single
verb into the domain, `manni a11y <url>`, because that is the grandfathered
default subcommand under another name. The second instance of an exception is a
pattern.

### 4. Why not let `<list>` flags also repeat? (three places pay)

`--ext md --ext mdx` parses fine and reads well, and the objection is not in the
parser. Two earlier proposals carry it. [0005](0005-command-parity.md) § stress
test 4 declined a repeatable `--fields`, and [0016](0016-flag-ownership.md) §
stress test 4 is where the testing argument comes from. A behavior that can be
reached two ways needs a test on each way, or the untested one drifts. With
that lineage, three places pay for a second spelling. The reference page has to
document both. The integration tests have to pin both, for 0016's reason. And
the config key that mirrors the flag (`exclude:` is a YAML list) has to say
which spelling it corresponds to. The reasoning has not changed.

### 5. Does the third level cap the depth? (yes, at three)

The grammar writes `[<subcommand>]` once, not `[<subcommand>...]`. A fourth
level would read `manni meta schemas vendor something`, and no planned domain
has asked for it. A plan that wants one argues for it in a superseding proposal
first, so the depth changes on purpose rather than by accretion.

### 6. Is the example ladder busywork for a one-flag change? (no, it is short)

A one-flag change has a three-rung ladder. The rungs are the command without the
flag, with it, and the usage error if the flag takes a value. If those three
lines are hard to write, the flag is not designed yet, which is what the ladder
is for.

## Consequences

- `CLAUDE.md` gains the grammar in "What manni is" and four working agreements:
  domains, plans, separators, subagents.
- `src/cli.ts` does not change. It already complies: the umbrella declares
  `-V, --version`, mounts `meta`, and redirects `manni validate` to
  `manni meta validate`.
- Every new domain ships `docs/src/content/docs/<domain>/` with an overview and
  a `reference/cli.mdx`, and `docs:check-cli` is extended to verify it.
- The next plan for a domain is reviewed against this proposal: full interface,
  example ladder, one separator per list. A plan that lacks them goes back
  before code is written.
- `meta`'s default subcommand is a documented exception. Removing it would be a
  `feat!:` and a superseding proposal, not an edit here.
