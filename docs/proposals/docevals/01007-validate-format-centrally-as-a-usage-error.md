---
status: "accepted"
date: 2026-08-04
decision-makers: [hawkeyexl]
---

# Validate `--format` centrally, and reject an unknown value as a usage error

## Context and Problem Statement

Three commands take `-f/--format`: `list` and `fill` (`human | json`), and `run` (`human | json |
markdown | github`). None of them validated the value. `src/cli.ts` cast the raw string straight
through, as `opts.format as "human" | "json"`, so the type assertion was the *only* thing standing
between a typo and the renderer.

Each command then degraded differently, and all three degraded silently:

| Command | `--format xml` | Exit |
|---|---|---|
| `list` | `renderList` tests `format === "json"` and otherwise falls through to the human renderer. Prints the human report. | `0` |
| `fill` | `renderFill` does the same. Prints the human report. | `0` |
| `run` | `render()` is a `switch` with a case per format and no `default`. Falls off the end, returns `undefined`, and the CLI prints the literal string `undefined`. | `0` |

So a CI job piping `--format json` into `jq` with the flag misspelled gets human-formatted colour
codes and a green exit. A misspelled `run --format` writes the word `undefined` to the report
file and still exits 0. `run`'s exhaustive `switch` looked safe because TypeScript proves it
exhaustive over `ReportFormat`. The cast at the call site is what admits the value that escapes
it. The compile-time guarantee buys nothing at the boundary where the string actually arrives.

This surfaced while writing inline Doc Detective steps for the docs site (ADR 01004). A step
asserting exit 2 for `moose-docevals list --format xml` failed, because the real behavior is exit 0. The
step was rewritten to use a genuine operational error rather than encode the defect, so nothing in
the repo documented or tested this.

The documented exit-code contract is `0` pass, `1` findings, `2` operational or usage error. An
unrecognized flag value is squarely the third.

## Decision Drivers

- The exit-code contract is a **published promise**. `reference/output-and-exit-codes.mdx` and
  `reference/cli.mdx` both state that `2` covers a "malformed flag". A silent fallback breaks it.
- **Silent format degradation is worse than a crash in CI**, the primary consumer of `--format
  json` and `--format github`. Wrong-format output that exits 0 is indistinguishable from success.
- `cli.ts` already has the shape for this: `parseIntArg` and `parseFloatArg` validate at parse time
  and `fail()` with a `DocevalsError`. `--format` was the odd one out.
- CLAUDE.md's config ↔ CLI pattern favors **one source of truth** per knob. Three commands each
  re-listing their allowed formats is three places to drift.
- The `undefined` return from `render()` is reachable by **library** consumers too, not only the
  CLI. Validation at the CLI boundary alone leaves a real defect in place.

## Considered Options

1. **A shared parser module plus an exhaustive guard in `render()`.** One module owns the allowed
   sets and the error message. `cli.ts` wires it into all three commands as a commander argument
   parser, and `render()` grows a `default:` that throws instead of returning `undefined`.
2. **Per-command inline validation.** An `if (!["human","json"].includes(opts.format))` at the top
   of each `.action()`.
3. **Commander's `.choices()`.** Let commander reject the value itself.
4. **Make the renderers total.** Have `renderList`/`renderFill`/`render` throw on an unknown
   format, with no CLI-level parsing.

## Decision Outcome

Chosen option: **Option 1**, a shared parser plus a renderer guard.

`src/reporters/format.ts` becomes the single source of truth:

- `REPORT_FORMATS` holds `run`'s four formats. `ReportFormat` is now derived from it rather than
  declared separately, so the constant and the type cannot disagree.
- `SUMMARY_FORMATS` / `SummaryFormat` is the `human | json` pair that `list` and `fill` emit.
- `parseFormat(value, allowed, flag)` returns the narrowed value or throws `DocevalsError` with
  the flag name, the received value, and the full allowed set.

`cli.ts` wraps it in `parseFormatArg(flag, allowed)` and passes that as commander's argument-parser
callback for `list`, `run`, and `fill`. The wrapper routes through the existing `fail()` helper, for
the same reason `parseIntArg` does. Commander only gives `InvalidArgumentError` special handling, so
any other exception thrown from an option parser escapes `program.parse()` uncaught. It would print
a stack trace and exit 1, the wrong code and the wrong presentation for a usage error. Validation
happens at parse time, so the value reaching each `.action()` is already narrowed and the casts are
gone.

The three render entry points additionally guard themselves. This is not redundant with the CLI
parser: `render`, `renderList`, and `renderFill` are all exported from `src/index.ts`, so a library
caller reaches them with no parser in front.

- `render()` gains a `default:` branch that throws, closing the path where
  `render(report, someString as ReportFormat)` previously returned `undefined`.
- `renderList` and `renderFill` are re-typed to `SummaryFormat` and call `parseFormat` on entry.

Guarding all three rather than only `render()` is deliberate. The first draft of this decision
guarded `render()` alone, on the grounds that the summary renderers' fallback is "benign". It gives
a real report in the other shape rather than `undefined`. That reasoning does not survive contact
with the actual failure. A library caller doing `renderFill(report, userFormat as SummaryFormat)`
gets human output where it asked for JSON, with no error. That is precisely the silent degradation
this ADR exists to remove. Being reached from a library instead of the CLI does not make it quieter. Three
equally public functions taking the same flag's value should fail the same way.

The error is a `DocevalsError`, so `fail()` prints `moose-docevals: --format must be one of human | json,
got "xml"` and exits 2.

### Consequences

- Good, because all three commands now agree with the documented contract and with each other.
- Good, because the allowed values live in one place, next to the renderer they gate.
- Good, because the `undefined` output from `render()` is unreachable from both the CLI and the
  library, and the summary renderers' human fallback is unreachable the same way.
- Good, because `cli.ts` loses four `as` casts on `format`; the parser narrows the type instead of
  a cast asserting it.
- Bad, because a script that today passes a bogus `--format` and tolerates human output starts
  failing at exit 2. That is the intent, but it is a behavior change for anyone relying on the
  fallback. Deliberately shipped as `fix:` rather than `feat!:`, because the previous behavior
  contradicted documented behavior, so no documented contract is broken.
- Neutral, because `--format` still has no config-file counterpart. CLAUDE.md's rule that a CLI flag
  needs a matching config field applies to *new* knobs. `--format` predates it and is a
  per-invocation output choice rather than project policy. Adding `output.format` to the config
  schema is a separate decision, not smuggled in here.

### Confirmation

- `test/unit/format.test.ts` pins `parseFormat` (every accepted value for both sets, rejection,
  error type, and message content) and the guards on all three render entry points.
- `.github/workflows/ci.yml` asserts exit 2 for `list --format xml` through the built CLI on both
  ubuntu and windows, alongside the existing fixture dogfood run.
- `docs/src/content/docs/reference/cli.mdx` carries inline Doc Detective steps asserting exit 2 for
  all three commands, run by the `verify-docs` job.

A regression that restores the silent fallback fails the unit test, the dogfood step, and
`verify-docs`.

## Pros and Cons of the Options

### Option 1, shared parser plus renderer guard

- Good, because one module owns the allowed values, the type, and the message.
- Good, because it matches the existing `parseIntArg` / `parseFloatArg` precedent in `cli.ts`, so
  every malformed flag is handled the same way.
- Good, because it covers the library path as well as the CLI.
- Neutral, because it adds a small module for what is currently two string arrays.

### Option 2, per-command inline validation

- Good, because it is the smallest possible diff.
- Bad, because the allowed set is then written out three times. It drifts the first time a format is
  added, exactly what happened when `markdown` and `github` were added to `run` alone.
- Bad, because validation lands after commander has parsed, so each `.action()` carries a guard
  clause before its real work.

### Option 3, commander's `.choices()`

- Good, because it is one chained call per option and needs no new code.
- Bad, because commander exits **1** with its own `error: option '-f, --format <format>' argument
  'xml' is invalid`, and 1 is the code reserved for findings. Distinguishing usage errors from
  findings is the entire point of the contract, and a CI job cannot tell the two apart.
- Bad, because the message is not a `DocevalsError` and does not match the `moose-docevals: …` prefix
  every other error uses.

### Option 4, make the renderers total, with no CLI parsing

- Good, because there is exactly one enforcement point and it is closest to the data.
- Bad, because the error surfaces *after* the work is done. `run` would discover a typo only after
  a full judging pass, having spent tokens and money on a report it then refuses to print. This is
  the decisive objection. It is why the renderer guards adopted above are a *second* line rather
  than the only one. They catch the library caller, but the CLI must still fail before spending.
