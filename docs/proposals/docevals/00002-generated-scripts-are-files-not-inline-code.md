---
status: "accepted"
date: 2026-08-31
decision-makers: [hawkeyexl]
---

# Generated check scripts are files referenced as commands, never inline in frontmatter

**Backfill.** This records a decision made before the ADR rule existed; until now it lived only as a bullet in [CLAUDE.md](../CLAUDE.md#design-decisions). The date is when the record was written, not when the decision was taken.

## Context and Problem Statement

A deterministic eval can be written in plain language, and have its check *generated* rather than hand-written. "The page contains a bash code block installing the CLI" is such an assertion. That leaves one question: where does the generated code live?

The tempting answer is inside the page's own frontmatter, next to the assertion it implements. Everything about one check would then sit in one place.

## Decision Drivers

- **Generated code is code, and code gets reviewed.** A model wrote it; a human has to be able to read it before it gates anything.
- Frontmatter is a metadata block that many tools parse. Embedding a shell script in it makes every one of those tools carry executable content.
- Generated artifacts drift from the assertions that produced them, and drift has to be *visible*.
- A generated script is a starting point, not a final answer, and people will want to fix one by hand.

## Considered Options

- **Inline the script in frontmatter**, under a `script` field, as a new grader kind.
- **Write the script to a file** beside the doc and reference it as a `command`.
- Store scripts in a central directory keyed by a hash of the assertion.

## Decision Outcome

The chosen option is to **write the script to a file, and reference it from the eval as a `command`.**

Scripts land in `{docDir}/moose-docevals/`, configurable via `scripts.dir`. The command that invokes them is persisted back into the page's frontmatter with a surgical YAML edit. That happens in [src/graders/scriptgen.ts](../src/graders/scriptgen.ts) and [src/core/frontmatter-edit.ts](../src/core/frontmatter-edit.ts). **There is no `script` grader kind**, and this is why.

The consequence for review is the point. A generated script arrives in a pull request as a file with a diff. It sits in a directory a reviewer can browse, in a language their editor highlights. A script embedded in a YAML scalar arrives as an unreadable block inside a metadata change.

Staleness is handled by hashing the assertion at generation time. When the assertion changes, the engine reports that the script is stale and names the command to regenerate it. The alternative is silently running code that no longer implements what the page claims.

### Consequences

- Good, because generated code is reviewable by every tool a team already uses for code, from diffs and blame to linters and the editor.
- Good, because a script can be edited by hand and stays edited. It is a file; nothing owns it.
- Good, because frontmatter stays metadata. The published schema describes fields, not a program.
- Bad, because one logical check is now two artifacts in two places, and they can drift. The assertion hash is the mitigation, and it converts silent drift into a named error.
- Bad, because generating scripts writes files into the docs tree, which teams must expect and gitignore or commit deliberately.

### Confirmation

One invariant in [CLAUDE.md](../CLAUDE.md#invariants) says *script generation must leave the page byte-identical outside the edited frontmatter node*. It is pinned by `test/unit/scriptgen.test.ts` and `test/unit/frontmatter-append.test.ts`. The absence of a `script` grader kind is enforced by `GraderKind` in `src/types.ts` and the registry in `src/graders/registry.ts`. The stale-hash path is covered in the engine tests.

## Pros and Cons of the Options

### Inline in frontmatter

- Good, because one check lives in exactly one place and cannot drift from itself.
- Bad, because it puts executable content into a metadata block that other tools parse, widening what a content file means.
- Bad, because reviewing a shell script inside a YAML scalar is materially harder than reviewing a file. A check nobody reviews is a check nobody trusts.
- Bad, because hand-editing it means editing frontmatter, which invites the surgical-edit problems the tool otherwise avoids.

### A file referenced as a command

- Good, because it reuses the `command` grader that already exists, rather than adding a kind.
- Good, because the artifact is reviewable, diffable, and editable by hand.
- Bad, because two artifacts can drift, requiring the assertion hash.

### A central hash-keyed directory

- Good, because scripts never sit in the docs tree.
- Bad, because the path is meaningless to a human, so nobody browses to one, and review suffers exactly as it does with inlining.
- Neutral, because it solves a collision problem that co-locating beside the doc does not have.
