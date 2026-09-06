---
status: "accepted"
date: 2026-08-13
decision-makers: [hawkeyexl]
---

# Read settings from a `tracevals:` section of a shared `moose.config.yaml`

## Context and Problem Statement

moose-tracevals read its settings from `moose-tracevals.config.yaml`, a file it owned outright. It is
one of a family of tools, alongside docevals and docmeta, that are routinely used together in
the same repository. Each brought its own dotfile. A project wiring up all three accumulated
three config files that nobody could see the relationship between. The settings they duplicate
(provider selection, model, API key variable, cost ceilings) had to be restated and kept in sync in
each one.

Where should a tool in the family look for its configuration? One file should serve all of them,
without any tool having to know what the others put in it.

## Decision Drivers

- One file per project, not one per tool, so shared settings are stated once and read together.
- A tool must never fail, warn, or otherwise care because a sibling tool's keys are in the file.
- Validation must stay as strict as it is today for the keys this tool owns. `additionalProperties:
  false` at every level is what turns a typo'd key into a loud failure instead of a silent default.
- The two ways an author can lose a whole config to this change must be reported, not silently
  defaulted through. Those are leaving keys un-nested, and leaving the old filename in place.
- The package has never been published and `RELEASE_ENABLED` is unset, so there are no external
  consumers to migrate.

## Considered Options

- **A single `moose.config.yaml`, each tool reading its own top-level key.**
- **Keep per-tool files, add an optional shared file that each tool merges under its own key.**
- **Keep per-tool files and share settings through YAML anchors or an `extends:` pointer.**
- **Status quo, one file per tool.**

## Decision Outcome

The chosen option is **a single `moose.config.yaml`, each tool reading its own top-level key**. This
tool reads `tracevals:`.

The file root is a mapping of tool name to that tool's settings. `loadConfig()` owns the file. It
reads `moose.config.yaml`, takes the `tracevals` value, and hands that to `parseConfig()`. Sibling
keys are neither validated nor read. `config-schema.json` continues to describe **the section**, so
its `additionalProperties: false` still applies at every level below `tracevals:`. `parseConfig()`
keeps its existing signature and contract, taking the section object rather than the file.

Four shapes are rejected rather than defaulted through, because silently applying defaults would
discard the author's entire configuration with no signal:

- A file with no `tracevals:` key but with keys this tool owns at the top level (`judge:`,
  `provider:`, …), which is the un-nested config. The stray keys are named in the error. The list
  is derived from the schema's own `properties`, so it cannot drift from the real key set.
- A top-level key that matches `tracevals` case-insensitively but not exactly (`Tracevals:`), the
  miscased wrapper. The stray-key check cannot see this one, because the keys under it are nested
  rather than at the top level.
- A directory holding the pre-centralization `moose-tracevals.config.yaml` and no
  `moose.config.yaml`, the un-renamed config. The error names the new filename and the required
  key.
- A `moose.config.yaml` that exists but cannot be read, such as a directory by that name or a
  permission error. Only `ENOENT`/`ENOTDIR` counts as absent. Anything else is reported rather than
  defaulted through, and does not reach the legacy check, which would otherwise claim the file is
  missing.

A file that is absent, empty, or that carries only other tools' sections is not an error; all
defaults apply. That is the case that keeps a shared file usable by a project that has not adopted
this tool yet.

### Consequences

- Good, because a project configures the whole family in one reviewable file, and shared settings
  are stated once.
- Good, because the strictness that catches typos is unchanged for our own keys, while sibling keys
  cost nothing. There is no registry of known tools, no coordination, and no version coupling
  between the tools.
- Good, because the two migration mistakes fail loudly with an actionable message instead of quietly
  running on defaults.
- Good, because `parseConfig()`'s contract is untouched, so library consumers and every existing
  config test carry over unchanged.
- Bad, because every existing config gains a level of indentation, and every documented YAML example
  had to be re-nested.
- Bad, because the file root is unvalidated by construction. A top-level key that is a genuine
  misspelling of `tracevals` (`traceval:`, `tracvals:`) is indistinguishable from another tool's
  section, and still yields defaults. The two most likely shapes are covered, meaning keys left at
  the top level and a wrapper differing only in case. A wrapper misspelled in any other way is not
  covered. It cannot be, without a registry of known tool names, which is exactly the coupling this
  decision avoids.
- Neutral, because nothing reads `moose-tracevals.config.yaml` any more; it is detected only to
  produce the migration error.

### Confirmation

`test/unit/config.test.ts` pins the behavior end to end against real files in `.tmp/`. The section
is read, and sibling tool sections are ignored. An absent file and an other-tools-only file both
yield defaults. Seven shapes each raise a `TracevalsError`. Those are the un-nested config, the
orphaned legacy file, a non-mapping root, and an unparseable file. They also include a miscased
`Tracevals:` wrapper, an unreadable file, and an invalid value inside the section. The unreadable case asserts specifically that the
legacy file is not blamed for it. The section-level validation tests that predate this ADR still
exercise `parseConfig()` directly and are unchanged.

## Pros and Cons of the Options

### A single `moose.config.yaml`, each tool reading its own top-level key

- Good, because one file is the whole story. There are no precedence rules, no merge semantics, and
  no second place to look when a value is not what you expected.
- Good, because tools stay fully decoupled. A tool needs to know its own key and nothing else.
- Good, because the change is contained in `loadConfig()`; the schema and `parseConfig()` are
  unchanged.
- Bad, because the file root cannot be strictly validated by any single tool, so a misspelled
  section name is only partially detectable.

### Keep per-tool files, add an optional shared file merged under a per-tool key

- Good, because it is backward compatible, which would matter if the package had shipped.
- Bad, because two sources for one value need precedence rules. Every "why is this value not
  taking effect?" question then has two files to check.
- Bad, because it institutionalizes the duplication this change exists to remove.

### Share settings via YAML anchors or an `extends:` pointer

- Good, because it removes duplication without changing any tool's file contract.
- Bad, because anchors do not cross file boundaries, so it only helps within one file. That is the
  same option as above, with extra syntax.
- Bad, because `extends:` is a resolution feature every tool would have to implement identically,
  and get identically right, including cycle detection and relative-path handling.

### Status quo, one file per tool

- Good, because each tool's file is entirely its own and strictly validated root to leaf.
- Bad, because it scales linearly in dotfiles and forces shared settings to be restated per tool,
  which is exactly where they drift.
