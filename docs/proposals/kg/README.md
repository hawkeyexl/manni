# Architecture Decision Records

> **Closed at 01040.** [Proposal 0051](../0051-kg-domain.md) folded kg into the manni family, and
> later kg decisions go in the family series, `docs/proposals/NNNN-*.md`. The files below stay as
> the record. Their `status:` lines still follow the supersede rule, and no new ADR is added here.
> The conventions that follow describe the log as it was kept.

Behavior changes in dockg ship with an ADR in [MADR 4.0.0](https://adr.github.io/madr/) format.
See the "Architecture Decision Records" section of the repository's CLAUDE.md for when one is
required and what it must contain.

- Filename: `NNNNN-kebab-case-title.md`, 5-digit zero-padded.
- Numbering starts at `01000`. The range `00001`–`00999` is reserved for backfilling
  pre-existing decisions if and when that becomes useful. Those would be the v1 determinism
  contract, the `kg:`/`dockg:` naming split, self-hosted schemas, and route mappings.
