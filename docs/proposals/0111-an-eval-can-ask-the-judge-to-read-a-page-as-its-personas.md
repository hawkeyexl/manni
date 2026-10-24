# 0111: An eval can ask the judge to read a page as its personas

- **Status:** Implemented (#244)
- **Serves:** Sara, the schema author.
  - S8, "Write assertions the judge can decide". An assertion says "a
    reader", and the page says who.
  - S9, "Prove the judge is trustworthy enough to gate a build". A golden
    case on an opted-in eval measures the judge that `run` uses.
- **Depends on:** Two proposals.
  - [0102](0102-a-strategy-domain-holds-pages-to-their-personas-and-journeys.md)
    made audiences, personas and journeys records a tool can read.
  - [0108](0108-a-claim-can-be-a-metadata-value.md) moved this repository's
    persona goals and pains into `goals:` and `pains:` fields.
- **Supersedes** no proposal.

## Problem

Pages here already say who they are for, and the judge never reads it. Most
judged evals say "a reader". `meta/fix/index.mdx` asks whether "a reader can
fix a failing field and confirm the check passes locally".

That page's sidecar says `personas: [theo]`. Theo's record says he has low
context on the tool and does not want to learn it. The judge sees neither. It
reads "a reader" as whoever it imagines, usually someone who already knows
what a schema is. So a fix page can pass every judged eval and still fail the
one reader it was written for.

Turning that on for every page with personas is unsafe in three ways.

- **Every verdict would move at once.** Hundreds of judged evals re-judge
  under a small local model nobody has measured on personas.
- **Nothing would invalidate on a persona edit.** The cache key covers the
  page and the eval, not the reader, so an edited record replays stale
  verdicts.
- **`--since` would hide the shift.** A branch that edits only `theo.md`
  changes no page, so a scoped run judges nothing.

## Decision

1. **The feature runs inside one rule, and falls back everywhere else.** An
   eval is judged as its page's personas only when all four hold. The run
   judges, so it is not `--deterministic-only`. The eval is `grader: ai` and
   carries `options: { readers: personas }`. At least one id in the page's
   `personas:` resolves to a persona record in a declared collection. The
   page is not itself a record. Outside that rule, the prompt, the cache key,
   the JSON, the pretty line, stderr and the exit code are today's, byte for
   byte. So is the scope of `--since` and `--newer-than`.
2. **The opt-in is one option value, one eval at a time.** `manni:evals:1.0.0`
   leaves `options` open for its grader, so the opt-in needs no vocabulary
   version, config key or flag. It works on an inline eval, on a
   `docevals.evals` entry and on a `use:` reference. A reference's options
   merge over the library's, key by key.
3. **The page's own `personas:` names the readers.** A string or a list of
   strings counts, ids match ignoring case, and duplicates collapse. An id no
   record defines is left out, silently. `personas` joins the keys docevals
   reads from a manifest, since audience marks it external.
4. **Records come from strategy's own loader.** docevals calls
   `loadStrategySet` over every declared collection, once per judged run. It
   calls it only when some eval carries an `options.readers` key, and loading
   prints nothing.
5. **The judge reads descriptive fields, never the body.** `title`,
   `description`, `name`, `role` and `team-context` render as lines.
   `proficiency`, `prerequisites`, `goals`, `pains` and `content-types` render
   as lists. Every other field is left out, `citations` included. The section
   sits between `# Anchors` and `# Page content`.
6. **One verdict per eval, for every reader at once.** The section tells the
   judge the assertion holds only when it holds for each reader. The turn cost
   and the result shape do not change.
7. **The key hashes the rendered section.** Under the rule the cache key gains
   an eighth part, `sha256` of the section. Parts are length-prefixed, so it
   never equals a key without one. `PROMPT_VERSION` stays 4.
8. **A persona record counts for scope.** `--since` and `--newer-than` count
   the record files an opted-in eval's readers came from as the page's own.
9. **The result says who it was read as.** A judged result under the rule
   carries `personas`, and pretty prints `(read as theo)` after the zone.
10. **The value is checked only where persona records exist.** There, a
    `readers` value other than `personas` is an error-level problem, exit `1`.
    Elsewhere it is ignored, as every option on an `ai` eval is today.

## Worked example

Sara wants the meta fix page judged as Theo, one eval first. Theo's record
already carries `goals:` and `pains:`. She adds two lines to `fix-and-rerun`
in `docs/src/content/docs/meta/fix/index.meta.yaml`.

```yaml
    - id: fix-and-rerun
      assertion: A reader can fix a failing field and confirm the check passes locally.
      type: capability
      grader: ai
      options:
        readers: personas
```

She judges the page. Verdicts below are illustrative.

```text
$ manni docevals run docs/src/content/docs/meta/fix/index.mdx --ai-only
docs/src/content/docs/meta/fix/index.mdx
  pass decode-error [auto-pass]  docs/src/content/docs/meta/fix/index.meta.yaml:10
  FAIL fix-and-rerun [auto-fail] (read as theo)  docs/src/content/docs/meta/fix/index.meta.yaml:14
  pass exit-code-meaning [auto-pass]  docs/src/content/docs/meta/fix/index.meta.yaml:22
```

Only the opted-in eval carries the tag. On a warm cache the other two replay,
because their prompts and keys are today's. A week later she adds a pain to
`theo.md` on a branch. `manni docevals run --ai-only --since origin/main` now
selects the pages whose opted-in evals read Theo, and judges each fresh.

## Messages

| When | Text | Exit |
|---|---|---|
| Persona records exist, and an `ai` eval's `readers` is anything but `personas` | `Eval "fix-and-rerun": ai options.readers must be one of: personas`, as a page problem | `1` |
| A file in a declared collection cannot be read while loading records | strategy's own sentence on stderr | `2` |
| The `strategy:` section is malformed | strategy's own sentence on stderr | `2` |

Each row needs a judged run in which some `ai` eval carries
`options.readers`. Outside that, no row can appear.

## Known limits

- **The fall-back is silent, so a mistake can be too.** `reader: personas` is
  ignored, and a dangling id falls back with no message. The tag is how a
  reader tells. `strategy check` reports the dangling id.
- **The field names come from a repo-local schema.** No registered vocabulary
  names them. A repository whose schema calls them something else gives the
  judge `title` and `description` alone.
- **A broken strategy stops an opted-in judged run.** A record that cannot be
  read is exit `2` for a run that carries `options.readers`, as it is for
  `strategy check`.
- **Reviews and golden cases stay keyed on the page body.** A persona edit
  re-judges an opted-in eval, and an existing review still applies to it.
- **Only a record file counts for scope.** A value a record's own sidecar
  supplies reaches the prompt and the key. An edit to that sidecar alone does
  not select the page under `--since`.
- **Whether the shift is better is unmeasured.** The dogfood records each
  flip on this repository's ten opted-in evals for a person to read.

## What was rejected

| Option | Verdict |
|---|---|
| On by detection, for every `ai` eval on a page with personas | Rejected. It re-judges every eval at once, with no way to try one. |
| Warnings for a missing, dangling or absent persona | Rejected. Each changes today's output where personas are not defined. |
| A new eval field, `readers:` | Rejected. It needs a vocabulary version and its strict overlay, and `options` is the slot for it. |
| A run-wide key or a `--readers` flag | Rejected. Both are all or nothing, and a flag flips keys between runs. |
| Ids in the option, as `readers: [theo, maya]` | Rejected. It is a second spelling of the page's `personas:`, and it drifts. |
| One verdict per persona | Rejected. It multiplies turns and changes the result shape. |
| Handing the judge the record body | Rejected. The prompt would be unbounded, and 0102 never reads the body. |
| Bumping `PROMPT_VERSION` | Rejected. It re-judges every repository's whole corpus for a section only opted-in evals see. |
| A second record loader in docevals | Rejected. Two copies of 0102's id and merge rules would drift. |

## Not breaking

No eval outside this repository carries `readers: personas`. The fall-back
rule keeps every other prompt, key, output and exit byte for byte, so this
ships as a `feat`. `test/docevals/integration/personas.test.ts` runs each
fall-back case twice, once as written and once with `options.readers`
commented out. It asserts equal provider requests, JSON, stderr and exit
codes.

## Verification

- `test/docevals/unit/readers.test.ts` covers resolution, the value check and
  the gate on loading.
- `test/docevals/unit/judge.test.ts` covers the section's text and place, the
  key, the evidence prompts and reviews.
- `test/docevals/integration/personas.test.ts` covers the rule, the fall-back,
  a broken strategy, `--since` and `--newer-than`.
- The dogfood opts in the ten judged evals on Theo's four fix pages and
  records each flip.
