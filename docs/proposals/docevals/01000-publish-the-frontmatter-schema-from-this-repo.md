---
status: "superseded by ADR-01009"
date: 2026-07-21
decision-makers: [hawkeyexl]
---

# Publish the frontmatter schema from this repo rather than registering it as a docmeta built-in

## Context and Problem Statement

moose-docevals declares its evals in page frontmatter under the `evals` key, and that shape needs a JSON Schema so authors get validation and editor support. docmeta already validates documentation frontmatter against JSON Schema, and ships built-in schemas addressed by `vendor:name:version` ids. Registering `docevals:frontmatter:0.1` as a docmeta built-in was the obvious first move. It was built, reviewed, and opened as a pull request before being reversed.

Where should the schema for a tool's own frontmatter live? Inside the validator that happens to be popular, or inside the tool that defines the fields?

## Decision Drivers

- The fields are defined by moose-docevals and change on moose-docevals' schedule.
- A built-in couples every schema revision to a docmeta release.
- Consumers should not need a special validator to check their frontmatter.
- The same question recurs for every tool that defines frontmatter (dockg hit it immediately after).

## Considered Options

- Register the schema as a docmeta built-in (`docevals:frontmatter:0.1`).
- Publish the schema as an artifact of the moose-docevals package and reference it by path or URL.

## Decision Outcome

The chosen option is to **publish from this repo**. `schemas/frontmatter-0.1.json` ships in the package via `files`/`exports`, and consumers point any JSON Schema validator at it:

```bash
docmeta validate --schema node_modules/moose-docevals/schemas/frontmatter-0.1.json docs/
```

This works through docmeta's existing `file` and `url` reference kinds, so nothing in its resolution chain needs to know moose-docevals exists. docmeta's only contribution is the `extractFrontmatter` export that moose-docevals consumes as a library.

### Consequences

- Good, because schema versioning stays in this repo. A field change ships with the release that introduces it, with no docmeta release in the loop.
- Good, because the schema is usable by any validator, not only docmeta.
- Good, because it generalizes: every tool owns its own schema, and docmeta stays a general validator rather than accumulating a registry of tool-specific entries.
- Bad, because consumers reference a longer path instead of a short built-in id.
- Bad, because there is no central discovery surface (`docmeta schemas` no longer lists it).

### Confirmation

`test/unit/schema.test.ts` pins the schema's behavior. `package.json` `files`/`exports` keep it in the published tarball. The `$id` must stay a resolvable URL so the schema remains self-describing when referenced remotely. See the invariant in [CLAUDE.md](../CLAUDE.md#invariants).

## Pros and Cons of the Options

### Register as a docmeta built-in

- Good, because consumers use a short, memorable id.
- Good, because `docmeta schemas` lists it, aiding discovery.
- Bad, because every schema revision requires a docmeta release.
- Bad, because it inverts ownership: the validator would version a schema it does not define.
- Bad, because it does not scale. Each new tool adds a registry entry and a docs page to an unrelated repo.

### Publish from the owning repo

- Good, because ownership and release cadence line up.
- Good, because it is validator-agnostic.
- Bad, because references are longer and discovery is weaker.
