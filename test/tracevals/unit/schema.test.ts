/**
 * Pins the vendored `manni:artifact-evals:1.0.0-proposal.2` vocabulary.
 *
 * The cases are a port of docmeta's own verification ladder
 * (`docs/proposals/0023/ladders/artifact-evals-examples.cjs`), kept case-for-case
 * so a drift between our copy and docmeta's draft shows up here rather than in
 * the field. The migration negatives (N1–N3) are the ones that matter most in
 * this repo: they are the `artifact-evals-0.2` spellings this vocabulary
 * replaces, and they must fail loudly rather than quietly do nothing.
 *
 * Cases are written as YAML because that is how artifacts are authored — a
 * JSON-literal port would not catch a shape that only YAML can express.
 */
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import {
  ARTIFACT_EVALS_SCHEMA_ID,
  artifactEvalsSchemaPath,
} from "../../../src/tracevals/evals/extract.js";

async function loadSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(artifactEvalsSchemaPath(), "utf-8")) as Record<
    string,
    unknown
  >;
}

async function compile() {
  const validate = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
  }).compile(await loadSchema());
  return (yamlText: string) => validate(parse(yamlText));
}

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
    "9 eval-provenance, the family pattern one level down",
    true,
    `metadata:
  eval-provenance:
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
];

describe("manni:artifact-evals:1.0.0-proposal.2", () => {
  it("carries docmeta's id, not one of ours", async () => {
    const schema = await loadSchema();
    expect(schema.$id).toBe(ARTIFACT_EVALS_SCHEMA_ID);
    // A vocabulary docmeta publishes; this repo implements behavior against it
    // (ADR 01010). The pre-1.0 URL `$id` said we owned the shape — we do not.
    expect(schema.$id).toBe("manni:artifact-evals:1.0.0-proposal.2");
  });

  it("resolves the schema to a file that actually exists", () => {
    // The path is probed rather than inferred from the directory name: keying
    // off `src/evals` vs `dist` meant a rename returned a path that does not
    // exist, and validation quietly stopped happening. Probing makes it loud.
    const path = artifactEvalsSchemaPath();
    expect(existsSync(path)).toBe(true);
    // Memoized, and stable across calls.
    expect(artifactEvalsSchemaPath()).toBe(path);
  });

  it("keeps the prerelease hyphen, which sorts below the 1.0.0 it registers as", async () => {
    // `+proposal.2` would be build metadata and compare *equal* to the release.
    expect(artifactEvalsSchemaPath()).toMatch(
      /artifact-evals-1\.0\.0-proposal\.2\.json$/,
    );
    expect(String((await loadSchema()).$id)).toContain("-proposal.2");
  });

  it.each(CASES)("%s", async (_name, expected, yamlText) => {
    const validate = await compile();
    expect(validate(yamlText)).toBe(expected);
  });

  it("leaves the metadata bag open so other tools' keys pass through", async () => {
    const validate = await compile();
    expect(
      validate(`metadata:
  dockg:
    label: Fix a bug
  evals:
    - Reproduce the bug first.`),
    ).toBe(true);
  });
});

/**
 * The cases above pin the schema's *behavior*. They cannot notice a change that
 * leaves behavior intact — a reworded description, a reordered key, an added
 * `$comment` — yet CLAUDE.md requires this file stay byte-identical to
 * docmeta's draft, `$id` included, and re-synced rather than patched.
 *
 * docmeta does not ship the schema in its package (`exports` is `.` and
 * `./package.json` only), so there is nothing to diff against at test time.
 * Pinning the digest is the next best thing: any edit fails here, and updating
 * this constant is the deliberate act that records a re-sync.
 */
describe("vendored schema identity", () => {
  const EXPECTED_SHA256 =
    "c1ad5f2a3cec9d52105a4ed22eccc4c70b5f92fef7e89bf3e751e5783c8b075f";

  it("is byte-identical to the vendored copy this repo was verified against", async () => {
    const bytes = await readFile(artifactEvalsSchemaPath());
    const actual = createHash("sha256").update(bytes).digest("hex");
    expect(
      actual,
      "schemas/tracevals/artifact-evals-1.0.0-proposal.2.json changed. If this is a " +
        "deliberate re-sync from docs/proposals/0023, update EXPECTED_SHA256; if it is a " +
        "local patch, revert it — the shape belongs upstream (ADR 01010).",
    ).toBe(EXPECTED_SHA256);
  });
});
