---
status: accepted
date: 2026-07-21
decision-makers: [hawkeyexl, Claude]
---

# Agent IRIs segmented by PROV agent kind

## Context and Problem Statement

`mintAgentIri` minted `{base}agent/{slug(name)}` for every agent regardless of
kind, so identity was "slug of the display name" alone. Two different kinds of
actor whose names slug alike merged into one node. Frontmatter
`author: GPT 4` plus `generatedBy: gpt-4` produced a node typed both
`prov:Person` and `prov:SoftwareAgent`, and a git author named `dockg` merged
with the build tool agent, receiving `dockg:version`. The graph stated things
that are simply false, quietly.

## Decision Drivers

- Provenance must not assert false identity.
- Deterministic, readable, diff-friendly IRIs; no blank nodes.
- IRIs become a consumer contract at first release, so they are cheap to change now.
- PROV-O already models the distinction; dockg should not invent one.

## Considered Options

1. Detect collisions and suffix the loser (`gpt-4-1`).
2. Hash names instead of slugging them.
3. Segment the namespace by kind: `agent/person/`, `agent/software/`,
   `agent/org/` (chosen).
4. Flat sibling namespaces: `person/`, `agent/`, later `org/`.

## Decision Outcome

Chosen option 3. `mintAgentIri(base, kind, name)` mints
`{base}agent/{kind}/{slug}` where kind is `person` | `org` | `software`,
mapped from the PROV class the call site already passes (`AGENT_KIND` in
derive.ts). Cross-kind merging becomes structurally impossible rather than
merely unlikely. `org` is reserved now so `prov:Organization`, PROV's third
agent subclass, has a home the day something mints one. Nothing does yet.

Option 4 was considered seriously and rejected on reflection. It reads well
today, since "agents" colloquially means software. But `prov:Person` is a
subclass of `prov:Agent`, so filing people outside `agent/` fights the
vocabulary dockg emits. A third flat sibling for organizations would also leave
the actor kinds ungrouped. Renaming the concept to "actor" was considered
and rejected too, since `prov:Agent` is W3C's term and not ours to rename.

### Consequences

- Good. False cross-kind identity is impossible, the tool agent is
  unambiguously `agent/software/dockg`, and organizations have a reserved home.
- Bad. Emitted agent IRIs changed shape, so the golden was regenerated. It is a
  breaking change for graph consumers, which is why it lands pre-release. And
  `mintAgentIri`'s exported signature gained a parameter.
- Unchanged. Two people sharing a name still converge, exactly as identical
  concept labels do. Git supplies emails, the natural unique key, but
  ADR 01000 rules them out on privacy grounds. A truncated email hash could
  disambiguate later without publishing the address.

### Confirmation

`test/unit/iri.test.ts` asserts per-kind minting. It also asserts that a person
and a software agent sharing a slug (including "dockg") stay distinct. The corpus
golden was regenerated with a reviewed five-line diff containing only the
kind segments.

## Pros and Cons of the Options

- **Collision suffixing.** The suffix depends on traversal order, breaking
  byte-determinism unless sorted first. Complexity for no gain.
- **Hashing.** Destroys readability and diffability, and does not address
  cross-kind identity at all. It only reshuffles which collisions occur.
- **Kind segments** (chosen). One parameter, a structural guarantee, and it
  extends to organizations for free.
- **Flat siblings.** Shortest IRIs, but they conflict with PROV's class
  hierarchy and scatter the actor kinds.
