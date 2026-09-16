/**
 * Pins the `manni:artifact-evals:1.0.0-proposal.4` vocabulary this tool
 * bundles.
 *
 * The cases are a port of the repository's own verification ladder
 * (`docs/proposals/0023/ladders/artifact-evals-examples.cjs`), kept
 * case-for-case so a drift between the draft and what this tool accepts shows
 * up here rather than in the field.
 *
 * There is no copy to pin any more. tracevals imports
 * `docs/proposals/0023/schemas/artifact-evals/1.0.0-proposal.4.json` directly
 * and the bundler inlines it, so the bytes under test *are* the draft's — the
 * sha256 pin that used to guard a vendored copy has nothing left to guard.
 *
 * Cases are written as YAML because that is how artifacts are authored — a
 * JSON-literal port would not catch a shape that only YAML can express.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  ARTIFACT_EVALS_SCHEMA_ID,
  artifactEvalsErrors,
  artifactEvalsSchema,
} from "../../../src/tracevals/evals/schema.js";

const validate = (yamlText: string): boolean =>
  artifactEvalsErrors(
    parse(yamlText) as Record<string, unknown>,
    () => undefined,
  ).length === 0;

/** [name, expected verdict, artifact front matter] */
const CASES: Array<[string, boolean, string]> = [
  [
    "1 an artifact with no metadata at all",
    true,
    `name: fix-bug
description: Fix a reported bug, reproducing it with a failing test first.`,
  ],
  [
    "2 metadata carrying other tools' entries, no evals",
    true,
    `name: fix-bug
description: Fix a reported bug.
metadata:
  some-other-tool:
    setting: value`,
  ],
  [
    "3 single-string shorthand — the whole block is one assertion",
    true,
    `metadata:
  evals: Reproduce the bug with a failing test before applying the fix.`,
  ],
  [
    "4 list of shorthands",
    true,
    `metadata:
  evals:
    - Reproduce the bug with a failing test before applying the fix.
    - The session never touched files outside src/ and test/.`,
  ],
  [
    "5 mixed shorthand and object entries",
    true,
    `metadata:
  evals:
    - id: used-read
      assertion: The session read at least one source file before editing.
      grader: tool-usage
      options:
        tool: Read
        expect: used
    - Reproduce the bug with a failing test before applying the fix.`,
  ],
  [
    "6 session graders, spread",
    true,
    `metadata:
  evals:
    - id: forbidden-tool
      assertion: The session never ran shell commands; this skill is edit-only.
      grader: tool-usage
      options:
        tool: Bash
        expect: not-used
    - id: stayed-cheap
      assertion: The session stayed under budget.
      grader: cost
      options:
        maxUsd: 2
      severity: warning
    - id: bounded-turns
      assertion: The session finished within a reasonable number of turns.
      grader: turn-count
      options:
        max: 30`,
  ],
  [
    "7 ai judge with provider, capability probe, anchor lists",
    true,
    `metadata:
  evals:
    - id: honored-tdd
      assertion: The session wrote a failing test before the fix.
      grader: ai
      provider: claude-cli
      type: capability
      evidence: The first Edit and Bash calls of the session
      examples:
        pass:
          - A test file edit lands before the src edit, and the first run fails.
          - The session narrates red-green explicitly.
        fail: The fix lands first and a test is added afterwards.`,
  ],
  ["8 artifact skipped", true, `metadata:\n  eval-skip: true`],
  [
    "9 meta-provenance, the family pattern one level down",
    true,
    `metadata:
  meta-provenance:
    - generated-by: claude-fable-5
      evals: [used-read, forbidden-tool]
      confidence:
        used-read: 0.91
        forbidden-tool: 0.86
  evals:
    - id: used-read
      assertion: The session read at least one source file before editing.
      grader: tool-usage
      options:
        tool: Read`,
  ],
  [
    "10 the 0.2 fixture, translated and flattened (capability-fidelity demo)",
    true,
    `name: fix-bug
description: Fix a reported bug, reproducing it with a failing test first.
metadata:
  evals:
    - id: used-read
      assertion: The session read at least one source file before editing.
      grader: tool-usage
      options:
        tool: Read
        expect: used
    - id: forbidden-tool
      assertion: The session never ran shell commands; this skill is edit-only.
      grader: tool-usage
      options:
        tool: Bash
        expect: not-used
    - Reproduce the bug with a failing test before applying the fix.`,
  ],
  [
    "11 human grader — a review-queue entry per session",
    true,
    `metadata:
  evals:
    - id: refactor-preserved-intent
      assertion: The session's refactor preserved the module's public behavior.
      grader: human
      evidence: The diff of src/core/ across the session
      severity: warning`,
  ],
  [
    "12 command grader, authored and post-generation",
    true,
    `metadata:
  evals:
    - id: no-force-push
      assertion: The trace contains no force push.
      grader: command
    - id: no-force-push-materialized
      assertion: The trace contains no force push.
      grader: command
      command: ["node", "tracevals/no-force-push.mjs", "{trace}"]
      success-exit-codes: [0]
      timeout-ms: 15000
      generated-assertion-hash: 07d185732a48ace07056e847b0fadd72fa35f830f7b793f2790db1a59182fd7a`,
  ],
  [
    "13 a future grader nobody has written yet (open enum)",
    true,
    `metadata:
  evals:
    - id: frontier
      assertion: Something the registry will learn to check.
      grader: memory-usage`,
  ],
  [
    // The positive half of N4. Dropping `assertion` from `required` in
    // proposal.2 is only meaningful if some entry can actually omit it: a
    // deterministic grader says everything in `options`, and the assertion it
    // would otherwise carry is a sentence no grader reads.
    "14 a deterministic grader with no assertion",
    true,
    `metadata:
  evals:
    - id: read-before-write
      grader: tool-usage
      options:
        tool: Read
        expect: used`,
  ],
  [
    // The family scale (`src/shared/severity.ts`). proposal.2 spelled the
    // quietest level `info`; N10 below is the same artifact under the old name.
    "15 the quietest level is notice",
    true,
    `metadata:
  evals:
    - id: worth-recording
      assertion: The session left a note.
      severity: notice`,
  ],

  // Migration negatives: the artifact-evals-0.2 spellings this replaces.
  [
    "N1 the 0.2 criteria envelope now fails loudly",
    false,
    `metadata:
  evals:
    criteria:
      - Something.`,
  ],
  [
    "N2 the 0.2 optional name is now a required id",
    false,
    `metadata:
  evals:
    - assertion: A nameless object entry.`,
  ],
  [
    "N3 the old name key fails loudly",
    false,
    `metadata:
  evals:
    - name: used-read
      assertion: The session read a file.`,
  ],
  [
    "N4 an object entry without an assertion",
    false,
    `metadata:
  evals:
    - id: empty-claim`,
  ],
  [
    "N5 a misspelled field inside an entry",
    false,
    `metadata:
  evals:
    - id: typo-demo
      assertion: Something.
      severty: error`,
  ],
  ["N6 eval-skip must be a boolean", false, `metadata:\n  eval-skip: "true"`],
  [
    "N7 anchor examples must be strings or lists of them",
    false,
    `metadata:
  evals:
    - id: bad-anchor
      assertion: Something.
      examples:
        pass: 5`,
  ],
  [
    "N8 exit codes on an ai grader (command-family fields need grader: command)",
    false,
    `metadata:
  evals:
    - id: wrong-family
      assertion: Something.
      grader: ai
      timeout-ms: 5000`,
  ],
  [
    "N9 a hash without its command (half write-back)",
    false,
    `metadata:
  evals:
    - id: orphan-hash
      assertion: Something.
      grader: command
      generated-assertion-hash: 07d185732a48ace07056e847b0fadd72fa35f830f7b793f2790db1a59182fd7a`,
  ],
  [
    "N10 severity: info, proposal.2's spelling of notice",
    false,
    `metadata:
  evals:
    - id: old-scale
      assertion: Something.
      severity: info`,
  ],
  [
    // The guard narrowed to `^eval-(?!skip$)`, so the key proposal.2 excepted
    // is now caught by the schema itself rather than silently ignored.
    "N11 eval-provenance, the name proposal.2 used",
    false,
    `metadata:
  eval-provenance:
    - generated-by: claude-fable-5
      evals: [used-read]`,
  ],
];

describe("manni:artifact-evals:1.0.0-proposal.4", () => {
  it("carries the repository's id, not one of ours", () => {
    expect(artifactEvalsSchema.$id).toBe(ARTIFACT_EVALS_SCHEMA_ID);
    // A vocabulary proposal 0023 publishes; this tool implements behavior
    // against it (ADR 01010). The pre-1.0 URL `$id` said we owned the shape.
    expect(ARTIFACT_EVALS_SCHEMA_ID).toBe(
      "manni:artifact-evals:1.0.0-proposal.4",
    );
  });

  it("keeps the prerelease hyphen, which sorts below the 1.0.0 it registers as", () => {
    // `+proposal.4` would be build metadata and compare *equal* to the release.
    expect(ARTIFACT_EVALS_SCHEMA_ID).toContain("-proposal.4");
  });

  it("marks metadata external, so a trail can live outside the artifact (0047)", () => {
    // proposal.4's one addition. tracevals does not move it — `manni meta
    // relocate` does — but the mark has to survive the bundling, or the two
    // tools would disagree about where the block belongs.
    const properties = artifactEvalsSchema.properties as Record<
      string,
      Record<string, unknown> | undefined
    >;
    expect(properties.metadata?.["x-manni-location"]).toBe("external");
  });

  it.each(CASES)("%s", (_name, expected, yamlText) => {
    expect(validate(yamlText)).toBe(expected);
  });

  it("leaves the metadata bag open so other tools' keys pass through", () => {
    expect(
      validate(`metadata:
  dockg:
    label: Fix a bug
  evals:
    - Reproduce the bug first.`),
    ).toBe(true);
  });
});
