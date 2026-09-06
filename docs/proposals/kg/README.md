# Architecture Decision Records

Behavior changes in dockg ship with an ADR in [MADR 4.0.0](https://adr.github.io/madr/) format.
See the "Architecture Decision Records" section of [CLAUDE.md](../CLAUDE.md) for when one is
required and what it must contain.

- Filename: `NNNNN-kebab-case-title.md`, 5-digit zero-padded.
- Numbering starts at `01000`. The range `00001`–`00999` is reserved for backfilling
  pre-existing decisions if and when that becomes useful. Those would be the v1 determinism
  contract, the `kg:`/`dockg:` naming split, self-hosted schemas, and route mappings.
