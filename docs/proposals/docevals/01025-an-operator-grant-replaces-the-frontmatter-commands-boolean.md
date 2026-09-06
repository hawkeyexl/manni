---
status: "accepted"
date: 2026-09-01
decision-makers: [hawkeyexl]
---

# An operator grant replaces the frontmatter-commands boolean

## Context and Problem Statement

Content files drive arbitrary code execution by two paths, and only one was gated. A `command`
eval declared in page frontmatter ran unless `scripts.allow-frontmatter-commands` said otherwise,
and it defaulted to **true**. The `tool:doc-detective` grader executes steps embedded in page
*bodies*, and nothing covered it at all. CLAUDE.md recorded the hole and instructed readers never
to document the flag as sufficient. That is an unusual thing to have to write about your own gate.

## Decision Drivers

- Both paths are code that an author of a *content* file controls.
- Granting one capability should not imply the other: trusting a repo's frontmatter is not the same
  as trusting arbitrary steps written in its prose.
- The tool is unpublished, so a wrong default can be corrected without a migration path.
- Whatever ships must not be mistakable for protection against a hostile fork.

## Considered Options

- Extend the existing boolean to cover doc-detective as well.
- Add a second boolean for page-embedded steps.
- One operator grant naming capabilities, default-deny.

## Decision Outcome

The chosen option is **one operator grant naming capabilities**, default-deny.

```yaml
docevals:
  execution:
    allow: [frontmatter-commands, page-embedded-steps]
```

`--allow-execution <kind...>` adds a grant for one run; `--no-execution` clears every grant for one
run. `scripts.allow-frontmatter-commands` and `--no-frontmatter-commands` are **removed**, not
aliased.

### Consequences

- Good, because the two capabilities are granted independently. An operator can run a corpus
  whose frontmatter it trusts without also executing steps out of its prose.
- Good, because the default is deny, which is the correct posture for content-driven execution and
  the opposite of what shipped before.
- Good, because the removed key raises a message naming `execution.allow`, rather than Ajv's
  "must NOT have additional properties" against the parent object. The old key *changed meaning* as
  well as moving. It defaulted to permitting and the grant defaults to denying. A silent
  migration would have quietly stopped running checks rather than loudly stopping the run.
- Bad, because every corpus relying on the permissive default must now say so, including this
  repo's own `moose.config.yaml` and `docs/moose.config.yaml`, which move in the same change.
- Neutral, because the threat model is unchanged. A grant says "this corpus is trusted to execute";
  a fork's pages are not this corpus. The `verify-docs` job's same-repo-pull-request restriction
  remains the only complete control, and this ADR does not weaken or replace it.

### Confirmation

`test/unit/execution-grant.test.ts` pins that both paths deny by default, and that granting one
leaves the other denied. It pins that `--no-execution` clears a configured grant, and that
`--allow-execution` grants without touching the config. It pins that the removed key raises a
message naming its replacement. The suite injects an `ExecFn`. A test that shelled out to check
whether shelling out was gated would be no test at all.

## Pros and Cons of the Options

### Extend the existing boolean

- Good, because it is a one-line change.
- Bad, because one flag for two capabilities means granting either grants both.
- Bad, because it keeps the permissive default, which is the larger of the two problems.

### A second boolean

- Good, because the capabilities separate.
- Bad, because two booleans with similar names is how a config grows a trap, and there is no
  natural place for the third.

### One grant naming capabilities

- Good, because adding a capability is adding an enum member, not another boolean.
- Good, because the config reads as what it is, a list of things this corpus may do.
- Bad, because it is more to write than `true`.
