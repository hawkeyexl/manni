/**
 * Pages are validated against the evals draft proposal 0023 publishes for
 * review, `manni:evals:1.0.0-proposal.3`, read from `docs/proposals/` and
 * bundled into the build. docevals ships no schema copy of its own: a copy
 * would be a second artifact to keep in step with the draft, and it drifted
 * once (its severity scale and its `eval-provenance` outlived the draft).
 *
 * These tests also pin the *vocabulary*, so the ladder below is ported from
 * that proposal's own `ladders/evals-examples.cjs`. The negatives are the
 * migration guard: every 0.1 spelling has to fail loudly, because a page that
 * silently resolves to defaults is the failure mode this whole rename exists
 * to avoid.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { runValidate } from "../../../src/meta/index.js";
import {
  frontmatterSchema,
  FRONTMATTER_SCHEMA_ID,
} from "../../../src/docevals/schema.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const DRAFT = "docs/proposals/0023/schemas/evals/1.0.0-proposal.3.json";

describe("the page schema", () => {
  it("is the evals draft, byte for byte", () => {
    expect(frontmatterSchema).toEqual(JSON.parse(readFileSync(resolve(ROOT, DRAFT), "utf8")));
    expect(FRONTMATTER_SCHEMA_ID).toBe("manni:evals:1.0.0-proposal.3");
  });

  it("ships no copy of its own", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ) as { files: string[]; exports: Record<string, unknown> };
    // `schemas` is in `files` because kg ships `schemas/kg`. What has to stay
    // absent is a docevals copy, asserted by the two `existsSync` lines below.
    expect(pkg.files).not.toContain("schemas/docevals");
    expect(Object.keys(pkg.exports).filter((k) => k.startsWith("./schemas/"))).toEqual([]);
    expect(existsSync(resolve(ROOT, "schemas/docevals"))).toBe(false);
    expect(existsSync(resolve(ROOT, "docs/public/docevals/schemas"))).toBe(false);
  });

  it("validates the fixture corpus when passed to manni meta as a file path", async () => {
    const run = await runValidate({
      inputs: ["test/docevals/fixtures/pages/**/*.{md,mdx}"],
      cliSchemas: [resolve(ROOT, DRAFT)],
      cwd: ROOT,
    });
    expect(run.results.length).toBeGreaterThan(0);
    const failures = run.results
      .filter((r) => !r.ok)
      .map((r) => `${r.file}: ${JSON.stringify(r.errors)}`);
    expect(failures).toEqual([]);
  }, 30000);

  it("full deterministic run validates fixtures via the tool:docmeta eval", async () => {
    const { runEvals } = await import("../../../src/docevals/core/engine.js");
    const report = await runEvals({
      cwd: ROOT,
      paths: ["test/docevals/fixtures/pages"],
      deterministicOnly: true,
      generate: false,
    });
    const docmetaResults = report.evalResults.filter(
      (r) => r.evalName === "frontmatter-valid",
    );
    expect(docmetaResults.length).toBeGreaterThan(0);
    for (const r of docmetaResults) expect(r.outcome).toBe("pass");
  }, 60000);
});

/**
 * The vocabulary ladder, ported from proposal 0023.
 *
 * Each case is [name, expectedValid, yaml]. The YAML is a whole page's
 * frontmatter, not just the `evals` key — the `eval-` prefix reservation is a
 * statement about the page root, so it can only be tested there.
 */
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(frontmatterSchema);

const cases: [string, boolean, string][] = [
  [
    "1 single-string shorthand",
    true,
    `evals: The documented install command matches the current package name.`,
  ],
  [
    "2 list shorthand",
    true,
    `evals:
  - The install command is \`npm i -g manni docevals\`.
  - The stated Node minimum is 24 or later.`,
  ],
  [
    "3 mixed list with config references",
    true,
    `evals:
  - use: no-future-promises
  - use: readable
    severity: warning
  - The exit codes table lists 0, 1, and 2.`,
  ],
  [
    "4 flat suite assignment",
    true,
    `eval-suite: how-to
evals:
  - Screenshots show the current UI.`,
  ],
  ["5 suite alone, no page evals", true, `eval-suite: reference`],
  ["6 page skipped", true, `eval-skip: true`],
  [
    "7 ai judge (default grader), fully aimed",
    true,
    `eval-suite: reference
evals:
  - id: flags-current
    assertion: Every flag in the table exists in the CLI help output.
    type: regression
    evidence: The flags table under "Options"
    examples:
      pass: Table lists --as, --ext, --exclude; help shows all three.
      fail: Table lists --in, which the CLI no longer accepts.`,
  ],
  [
    "8 ai judge with an explicit provider (agent)",
    true,
    `evals:
  - id: install-works-clean
    assertion: The install steps produce a working CLI on a clean machine.
    grader: ai
    provider: claude-cli
    type: capability
    severity: warning`,
  ],
  [
    "9 command, authored for generation (no command yet)",
    true,
    `evals:
  - id: has-examples-heading
    assertion: The page includes an Examples heading.
    grader: command`,
  ],
  [
    "9b command, after generation writes back",
    true,
    `evals:
  - id: has-examples-heading
    assertion: The page includes an Examples heading.
    grader: command
    command: ["node", "manni-docevals/install.has-examples-heading.mjs", "{file}"]
    generated-assertion-hash: 07d185732a48ace07056e847b0fadd72fa35f830f7b793f2790db1a59182fd7a`,
  ],
  [
    "10 command, explicit, maximal",
    true,
    `evals:
  - id: links-resolve
    assertion: Every link on the page resolves.
    grader: command
    command: ["npx", "linkinator", "{file}"]
    success-exit-codes: [0, 2]
    timeout-ms: 45000
    type: regression
    severity: warning`,
  ],
  [
    "11 human, maximal",
    true,
    `evals:
  - id: screenshots-current
    assertion: The screenshots match the current product UI.
    grader: human
    evidence: Images under "Configure the dashboard"
    severity: warning`,
  ],
  [
    "12 tool graders, maximal spread",
    true,
    `evals:
  - id: fresh-enough
    assertion: Page was reviewed within the last half year.
    grader: tool:freshness
    options:
      field: last-reviewed
      max-age-days: 180
    severity: warning
  - id: follows-template
    grader: tool:doc-structure-lint
    options:
      template: how-to
      template-path: templates.yaml
  - id: house-style
    grader: tool:vale
    options:
      command: ["vale", "--output=JSON", "--config", ".vale.ini"]
    severity-map:
      suggestion: notice
      warning: notice
  - id: distinct-from-siblings
    grader: tool:differentiation
    options:
      scope: "docs/reference/actions/*.md"
      max-similarity: 0.8`,
  ],
  [
    "13 meta-provenance: fill's trail, retired by humans as they review",
    true,
    `meta-provenance:
  - generated-by: claude-fable-5
    evals: [install-verified, eks-coverage]
    confidence:
      install-verified: 0.88
      eks-coverage: 0.74
evals:
  - id: install-verified
    assertion: The Helm install steps produce a Ready operator pod.`,
  ],
  [
    "14 anchor examples widen to lists",
    true,
    `evals:
  - id: multi-anchor
    assertion: The page's flags table matches the CLI.
    examples:
      pass:
        - Table lists --as, --ext, --exclude; help shows all three.
        - Table and help agree after a new flag lands in both.
      fail: Table lists --in, which the CLI no longer accepts.`,
  ],
  [
    "15 sibling tools' page keys pass untouched",
    true,
    `title: Configure the dashboard
description: How to configure it.
generated-by: claude-fable-5
kg:
  label: Dashboard
evals:
  - The page names every required field.`,
  ],

  [
    "N1 the 0.1 object form now fails loudly",
    false,
    `evals:
  suite: how-to
  generatedBy: gpt-5
  evals:
    - Something.`,
  ],
  [
    "N2 misspelled field inside an entry",
    false,
    `evals:
  - id: typo-demo
    assertion: Something.
    severty: error`,
  ],
  [
    "N3 ai grader without an assertion",
    false,
    `evals:
  - id: judged-but-empty
    grader: ai`,
  ],
  [
    "N4 the old llm spelling no longer matches the grader pattern",
    false,
    `evals:
  - id: yesterdays-spelling
    assertion: Something.
    grader: llm`,
  ],
  [
    "N5 human grader without an assertion",
    false,
    `evals:
  - id: review-something
    grader: human`,
  ],
  ["N6 eval-skip must be a boolean, not a string", false, `eval-skip: "true"`],
  [
    "N7 eval-provenance is gone, so the eval- reservation refuses it",
    false,
    `eval-provenance:
  - generated-by: claude-fable-5
    evals: [something]`,
  ],
  [
    "N7b info is not a severity; the family scale says notice",
    false,
    `evals:
  - id: quiet-check
    assertion: Something.
    severity: info`,
  ],
  [
    "N8 the old generated wrapper now fails (flattened to generated-assertion-hash)",
    false,
    `evals:
  - id: has-examples-heading
    assertion: The page includes an Examples heading.
    grader: command
    command: ["node", "manni-docevals/x.mjs", "{file}"]
    generated:
      assertionHash: 07d185732a48ace07056e847b0fadd72fa35f830f7b793f2790db1a59182fd7a`,
  ],
  [
    "N9 exit codes on an ai grader (command-family fields need grader: command)",
    false,
    `evals:
  - id: wrong-family
    assertion: Something.
    grader: ai
    success-exit-codes: [0]`,
  ],
  [
    "N10 a hash without its command (half write-back)",
    false,
    `evals:
  - id: orphan-hash
    assertion: Something.
    grader: command
    generated-assertion-hash: 07d185732a48ace07056e847b0fadd72fa35f830f7b793f2790db1a59182fd7a`,
  ],

  // Beyond the proposal's ladder: the prefix reservation is this repo's addition.
  // The vocabulary's root is `additionalProperties: true`, so a typo'd settings key
  // would sail through it; reserving the prefix restores the loud-typo
  // property the closed 0.1 `evals:` object used to have.
  ["N11 a typo'd settings key is caught by the eval- reservation", false, `eval-sute: how-to`],
  ["N12 ...including one that looks like a plausible new setting", false, `eval-timeout: 30`],
  [
    "N13 the 0.1 name field is not the id field",
    false,
    `evals:
  - name: yesterdays-spelling
    assertion: Something.`,
  ],
  [
    "N14 an id that is not kebab-case",
    false,
    `evals:
  - id: Not_Kebab
    assertion: Something.`,
  ],
  ["N15 an empty eval list is not a declaration", false, `evals: []`],
];

describe("manni:evals vocabulary ladder", () => {
  it.each(cases)("%s", (_name, expectedValid, yaml) => {
    const parsed: unknown = parseYaml(yaml);
    const actual = validate(parsed);
    // On an unexpected result, the errors are the whole diagnosis.
    expect(
      actual,
      actual ? "expected invalid, got valid" : JSON.stringify(validate.errors),
    ).toBe(expectedValid);
  });
});
