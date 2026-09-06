/**
 * The frontmatter schema is published from this repo (shipped in the package
 * under schemas/), not registered as a built-in inside a validator. These
 * tests pin the published artifact: it must be resolvable by path, usable by
 * docmeta as a plain schema file, and it must accept the fixture corpus.
 *
 * They also pin the *vocabulary* — manni docevals implements
 * `docmeta:evals:1.0.0-proposal.1` (docmeta proposal 0023), so the ladder below
 * is ported from that proposal's own `ladders/evals-examples.cjs`. The
 * negatives are the migration guard: every 0.1 spelling has to fail loudly,
 * because a page that silently resolves to defaults is the failure mode this
 * whole rename exists to avoid.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";
import { runValidate } from "../../../src/meta/index.js";
import {
  frontmatterSchema,
  frontmatterSchemaPath,
  FRONTMATTER_SCHEMA_ID,
  FRONTMATTER_SCHEMA_VERSIONS,
} from "../../../src/docevals/schema.js";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("published frontmatter schema", () => {
  it("ships at a resolvable path", () => {
    const path = frontmatterSchemaPath();
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(frontmatterSchema);
  });

  it("is listed in the package files so it reaches consumers", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ) as { files: string[]; exports: Record<string, unknown> };
    expect(pkg.files).toContain("schemas");
    // Every shipped version, not just the current one. `exports` is a closed
    // map: a file inside a `files` directory is unreachable by subpath import
    // unless it is listed, so publishing 1.1.0 while exporting only 1.0.0
    // ships bytes that no consumer can `import` or resolve by path. Driving
    // this from the version list means the next version cannot be forgotten.
    for (const version of FRONTMATTER_SCHEMA_VERSIONS) {
      const subpath = `./schemas/docevals/frontmatter-${version}.json`;
      expect(pkg.exports, subpath).toHaveProperty(subpath);
      expect(existsSync(resolve(ROOT, subpath))).toBe(true);
    }
  });

  it("carries a resolvable $id, not a validator-internal registry id", () => {
    expect(FRONTMATTER_SCHEMA_ID).toMatch(/^https?:\/\//);
  });

  it("versions with three segments, because its bytes are frozen once published", () => {
    // A published schema may never change in place — a consumer's `$schema` URL
    // has to keep meaning what it meant. With two segments the only way to fix
    // a `description` typo is a minor bump, which announces new fields when
    // none were added. See CLAUDE.md, "The published schema".
    expect(FRONTMATTER_SCHEMA_ID).toMatch(/frontmatter-\d+\.\d+\.\d+\.json$/);
  });

  it("validates the fixture corpus when passed to docmeta as a file path", async () => {
    const run = await runValidate({
      inputs: ["test/docevals/fixtures/pages/**/*.{md,mdx}"],
      cliSchemas: [frontmatterSchemaPath()],
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
 * The vocabulary ladder, ported from docmeta proposal 0023.
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
      suggestion: info
      warning: info
  - id: distinct-from-siblings
    grader: tool:differentiation
    options:
      scope: "docs/reference/actions/*.md"
      max-similarity: 0.8`,
  ],
  [
    "13 eval-provenance: fill's trail, retired by humans as they review",
    true,
    `eval-provenance:
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
    "N7 an eval-provenance entry without generated-by",
    false,
    `eval-provenance:
  - evals: [something]`,
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

  // Beyond docmeta's ladder: the prefix reservation is this repo's addition.
  // docmeta's root is `additionalProperties: true`, so a typo'd settings key
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

describe("docmeta:evals vocabulary ladder", () => {
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

/**
 * The `$id` is a URL, and consumers are invited to point `$schema` or a
 * `tool:docmeta` eval at it. Nothing checked that the URL served anything: the
 * schema lived only in `schemas/`, the docs site had no `public/` directory,
 * and every existing test passed against a 404. These are the local half of
 * that promise — that the copy the site publishes is byte-identical to the one
 * the package ships. The other half, that the URL is actually reachable, can
 * only be answered by fetching it (see scripts/check-published-schemas.mjs).
 */
describe("published schema is served at its $id", () => {
  const PUBLIC_DIR = resolve(ROOT, "docs/public/docevals/schemas");

  /** Path under docs/public that `$id` resolves to, given the site's base. */
  function servedPathFor(id: string): string {
    const url = new URL(id);
    const base = "/manni"; // docs/astro.config.mjs
    expect(url.pathname.startsWith(`${base}/`), `$id is under ${base}`).toBe(
      true,
    );
    return resolve(ROOT, "docs/public", url.pathname.slice(base.length + 1));
  }

  it("ships a copy under the site's public directory", () => {
    const served = servedPathFor(FRONTMATTER_SCHEMA_ID);
    expect(
      existsSync(served),
      `${served} is what ${FRONTMATTER_SCHEMA_ID} resolves to`,
    ).toBe(true);
  });

  it("serves bytes identical to the package copy", () => {
    // Byte-identical, not merely equivalent: a published schema's bytes are
    // frozen, so "same JSON, different formatting" is still a second artifact.
    const served = servedPathFor(FRONTMATTER_SCHEMA_ID);
    expect(readFileSync(served)).toEqual(readFileSync(frontmatterSchemaPath()));
  });

  it("publishes nothing under public/schemas that the package does not ship", () => {
    // A stale copy of a retired version would keep resolving forever.
    const shipped = new Set(readdirSync(resolve(ROOT, "schemas/docevals")));
    for (const name of readdirSync(PUBLIC_DIR)) {
      expect(shipped.has(name), `${name} has no counterpart in schemas/`).toBe(
        true,
      );
    }
  });
});
