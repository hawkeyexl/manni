# 0083: Runtime evals, the rename

- **Status:** Proposed
- **Serves:** Maya · M25, "Catch a broken rule before the agent hands back".
  It renames the one section she writes to turn the check on.
- **Depends on:** [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md),
  for the section and the in-play rule.
- **Supersedes, in part:** [0079](0079-tracevals-checks-each-turn-against-the-rules-it-read.md),
  for the config section's name only. Its Status line is the only edit.
- **Touches:** `src/tracevals/core/config.ts`, `src/tracevals/core/config-schema.json`,
  `src/family/core/in-play.ts`, `src/tracevals/commands/runtime.ts`,
  `src/tracevals/reporters/runtime.ts`, `docs/src/content/docs/tracevals/runtime/`
- **Verdict:** The section is `tracevals.runtime`. The old key fails with exit
  2 and names the new one. In-play detection still sees the old key, so the
  error reaches hook users. There is no alias.

## Problem

0079 named the section `tracevals.conformance`. That word names a property of
the agent's work. It does not name the thing a person sets up.

What Maya sets up is a set of evals that run while the agent works. She calls
them runtime evals. The post-hoc run
grades a session after it ends. These evals grade each turn as it ends. The
section should say that.

## Verdict

### The section is `tracevals.runtime`

The children and defaults are the same as 0079's. They are `hook.provider`,
`hook.model`, `hook.runs`, `include`, `exclude` and `plans`.

```yaml
tracevals:
  runtime: {}
```

### The old key fails and names the new one

The loader still rejects `conformance` as an unknown key. It adds a hint, as
it already does for a moved `provider:` object.

```text
manni: manni.config.yaml: unknown key "conformance"; it is now "runtime"
```

The exit code is 2. The hint applies only to the key at the section root.

### In-play detection still sees the old key

`manni status` loads the tracevals config only when tracevals is in play. A
config that kept the old key would otherwise drop tracevals out of play without
a word. So the old key still counts. The loader then refuses it, and the
tracevals row of `status` carries the message.

### No alias

Nothing reads the old key's values. An alias would be a second spelling for one
section, which the project's parity rule exists to prevent.

## Release

This ships as a minor version. Runtime evals are in beta, so the rename is
released as a feature rather than as a breaking change.
