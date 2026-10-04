# 0074: stewardship 1.1.0 keeps people out of published graphs

- **Status:** Implemented
- **Serves:** Maya · M18, who publishes the graph a docs set derives, and
  Sara · S1, who owns the standard that says what a published artifact carries.
- **Depends on:** [0051](0051-graph-domain.md), whose §5 defines
  `x-manni-graph-output` and reads it from the schema set meta resolves.
  [0009](0009-publish-builtin-schemas.md), which makes a published built-in
  immutable. [0067](0067-registering-the-vocabularies.md), which registers a
  later version beside `1.0.0` rather than moving an alias.
- **Supersedes, in part:** [0070](0070-defaults-register-strict.md), for the
  stewardship member of the default set. The Status line is the only edit.
- **Touches:** `src/meta/schemas/stewardship/1.1.0.json` (new),
  `src/meta/schemas/stewardship-strict/1.1.0.json` (new),
  `src/meta/core/{resolve-schema,schema-registry,config,page-marks}.ts`,
  `src/graph/core/{config,graph-output}.ts`, `src/graph/commands/{build,init}.ts`,
  `docs/public/schemas/**`, `test/**`, `docs/src/content/docs/**`
- **Verdict:** `manni:stewardship:1.1.0` is 1.0.0 with
  `x-manni-graph-output: false` on `owner`, `stakeholders` and `reviewed-by`.
  The default set moves to it. `manni graph build` reads its marks from the
  set `manni meta validate` resolves, and the `graph.schemas` key goes.

## Problem

0051 §5 gives a schema the say over what a published graph carries. Its worked
example marks `owner` false, because a name has no place in a graph handed out.
The only schema that carried the mark was a stewardship draft,
`1.0.0-proposal.4`.

Main then published `manni:stewardship:1.0.0` without the mark. The published
file is immutable under 0009, so its bytes cannot gain one. A default run
therefore marks nothing, and the people fields would reach any graph that
derived them.

graph also kept a schema set of its own, `graph.schemas`. Its default was the
graph page vocabulary alone, which marks nothing either. So a page's published
fields came from one set, and its validation from another. 0051 §5 says the
harvest reads the set meta already resolves. The extra key broke that promise.

## Decision

1. **Stewardship gains 1.1.0.** It claims the same ten fields and validates
   every value as 1.0.0 does. It adds `x-manni-graph-output: false` to `owner`,
   `stakeholders` and `reviewed-by`, the three fields that name people.
2. **A strict overlay ships beside it.** `manni:stewardship-strict:1.1.0` holds
   the constraints of the 1.0.0 overlay under the new id. `strict: true` pairs
   it with 1.1.0.
3. **The default set carries 1.1.0.** `DEFAULT_SCHEMAS` names
   `manni:stewardship:1.1.0` where it named 1.0.0. Both 1.0.0 ids stay
   registered and published, and a page or config that names one keeps it.
4. **graph reads meta's set.** `graph build` resolves each page's schemas the
   way `manni meta validate` does. That means its `$schema`, then the
   overrides, `schemas`, `register`, `strict` and the default set. It reads
   them from meta's section of the config the build runs under.
5. **`graph.schemas` goes.** The key never shipped in a release, so it is
   removed rather than migrated. A config that still sets it fails the config
   schema, exit 2, as any unknown key does.

### Why a new version

0009 publishes each built-in at a version-pinned URL and records its hash. A
mark added to 1.0.0 would change bytes that a pinned `integrity` already names.
That pin would then fail, which is the breakage 0009 exists to prevent. 0067
settles the rest, since ids resolve by exact string and a later version
registers beside the earlier one.

### Why the move is not breaking

Validation over the default set is unchanged. 1.1.0 accepts and refuses
exactly what 1.0.0 does, and a finding differs only in the schema id it names.
Baselines carry across too, because a fingerprint treats 1.1.0 as 1.0.0.
`x-manni-graph-output` is an annotation that no validation result reads.

What changes is what a published graph carries, and only toward less. A
page's `owner`, `stakeholders` and `reviewed-by` no longer reach the graph
build. graph derives no triple from those fields today, so no published
output changes either. The mark holds the line for any harvest that follows.

## Stress test

1. **A team that wants owners in its graph.** It lists a house schema after
   the defaults that marks `owner: true`. A later ref's mark wins, so the
   field is harvested again. Pinning `manni:stewardship:1.0.0` with
   `defaults: false` works too.
2. **A config pinned by integrity to 1.0.0.** Its bytes are untouched, so the
   pin holds. That config validates as before and marks nothing.
3. **`strict: true`.** The default set stacks
   `manni:stewardship-strict:1.1.0` after 1.1.0. The overlay carries no mark,
   so the open vocabulary's marks decide the output.
4. **A family file with no `meta:` section.** meta reads an empty section, so
   the page gets the default set and its marks.
5. **`graph build -c` on a file with no family key.** That file is graph's
   section alone and holds nothing of meta's. The default set decides the
   marks.
6. **A broken `meta:` section.** `graph build` fails, exit 2, with the message
   `manni meta validate` gives. A graph built while its marks could not be
   read is the failure 0051 §5 refuses.

## Consequences

- A finding from the default set names `manni:stewardship:1.1.0`. Baselines
  carry across, because a fingerprint treats 1.1.0 as 1.0.0. A recorded
  finding stays suppressed, and no re-record is needed.
- One config now decides both which schemas judge a page and which of its
  fields a published graph may carry.
- The stewardship draft `1.0.0-proposal.4` existed only to carry the mark. It
  is removed, and the published 1.1.0 carries the mark instead.
