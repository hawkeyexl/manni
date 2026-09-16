// Validate the manni:graph:1.0.0-proposal.1 example ladder against the draft
// schema, without registering anything. Ported case for case from
// kg-examples.cjs, the ladder of this vocabulary under its earlier name, and
// brought up to what manni:kg:1.0.0-proposal.3 settled: machine attribution is
// the page-level `meta-provenance`, so a `provenance` key inside the block is a
// rejection now rather than a shape to check. Run from the repo root:
//   node docs/proposals/0023/ladders/graph-examples.cjs
const fs = require("fs");
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/");
let Ajv = req("ajv/dist/2020.js");
Ajv = Ajv.default ?? Ajv;
const { parse } = req("yaml");

// The drafts' semver prerelease, spelled once per ladder so a bump is a
// one-line edit here rather than a literal buried mid-expression.
const V = "1.0.0-proposal.1";
const schema = JSON.parse(fs.readFileSync(`docs/proposals/0023/schemas/graph/${V}.json`, "utf8"));
// `strict: false` is how `manni meta` compiles: the block carries
// `x-manni-location: page` (proposal 0047), an annotation Ajv has no vocabulary
// for and refuses outright under strict mode.
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
const validate = ajv.compile(schema);

const cases = [
  ["1 no graph key at all — files without graph pass", true,
`title: Plain page
description: Nothing graph-related here.`],

  ["2 label alone", true,
`graph:
  label: Configuration`],

  ["3 full SKOS, arrays", true,
`graph:
  label: Configuration
  alt-labels: [config, settings]
  broader: [Administration]
  narrower: [Environment variables]
  related-concepts: [Installation]
  concepts: [reference]`],

  ["4 single-string shorthand on label fields (widening over 0.8)", true,
`graph:
  label: Configuration
  alt-labels: config
  broader: Administration
  concepts: reference`],

  ["5 iiRDS typing, list and single forms", true,
`graph:
  type: task
  applies-to: [SP-X100, SP-X200]
  about-product-lifecycle: deployment
  about-product-aspect: [interface]`],

  ["6 negative scope", true,
`graph:
  applies-to: [SP-X100]
  not-applicable-to: [SP-X300]
  about-product-aspect: [interface]
  not-about-product-aspect: [architecture]`],

  ["7 sections with per-section typing", true,
`graph:
  type: task
  sections:
    install:
      type: reference
      applies-to: SP-X200
      concepts: [installation]
    options:
      not-about-product-aspect: [architecture]`],

  ["8 page-level meta-provenance with /graph/ pointers, beside a graph block", true,
`title: API keys
graph:
  label: API keys
meta-provenance:
  - generated-by: claude-opus-4-6
    fields: ["/graph/label"]
    confidence:
      "/graph/label": 0.92`],

  ["9 the 0.8 worked example, translated (capability-fidelity demo)", true,
`title: Configuration Reference
graph:
  label: Configuration
  alt-labels: [config, settings]
  broader: [Administration]
  related-concepts: [Installation]
  concepts: [reference]
  type: reference
  applies-to: [SP-X100, SP-X200]
  about-product-aspect: [interface]
  not-applicable-to: [SP-X300]
  sections:
    options:
      not-about-product-aspect: [architecture]`],

  ["N1 hierarchy without a label (dependentRequired)", false,
`graph:
  alt-labels: [orphaned]`],

  ["N2 the 0.8 camelCase spelling now fails loudly", false,
`graph:
  prefLabel: Configuration`],

  ["N3 graph.generatedBy is gone — top-level generated-by owns it", false,
`graph:
  label: Configuration
  generatedBy: gpt-5`],

  ["N4 a single provenance object under graph — not a property of the block", false,
`graph:
  label: API keys
  provenance:
    generated-by: claude-opus-4-6`],

  ["N5 a type outside the published iiRDS list", false,
`graph:
  type: tutorial`],

  ["N6 a provenance entry with a fields list — the key is gone, not its shape", false,
`graph:
  label: X
  provenance:
    - generated-by: m
      fields: [prefLabel]`],

  ["N7 duplicate labels in a list", false,
`graph:
  label: Configuration
  alt-labels: [config, config]`],

  ["N8 the 0.8 field names subjects / softwareSubject now fail", false,
`graph:
  label: Configuration
  subjects: [reference]
  softwareSubject: [interface]`],

  ["N9 an empty provenance array is still an unknown graph property", false,
`graph:
  label: API keys
  provenance: []`],

  ["N10 empty about-product-lifecycle list", false,
`graph:
  label: API keys
  about-product-lifecycle: []`],

  ["N11 empty about-product-aspect list", false,
`graph:
  label: API keys
  about-product-aspect: []`],

  ["N12 an empty section entry is not a declaration", false,
`graph:
  label: API keys
  sections:
    install: {}`],

  ["N13 graph.provenance is not in the vocabulary — machine attribution is the page-level meta-provenance", false,
`graph:
  label: API keys
  provenance:
    - generated-by: claude-opus-4-6
      fields: [label, type]
      confidence:
        label: 0.92
        type: 0.81`],
];

let bad = 0;
for (const [name, expectValid, yamlText] of cases) {
  const ok = validate(parse(yamlText));
  const verdict = ok === expectValid ? "OK " : "UNEXPECTED";
  if (ok !== expectValid) bad++;
  const detail =
    !ok && expectValid === false
      ? ` (fails as intended: ${validate.errors?.[0]?.instancePath || "/"} ${validate.errors?.[0]?.message})`
      : ok === false
        ? ` errors: ${JSON.stringify(validate.errors?.slice(0, 3))}`
        : "";
  console.log(`${verdict} ${name}${detail}`);
}
process.exit(bad ? 1 : 0);
