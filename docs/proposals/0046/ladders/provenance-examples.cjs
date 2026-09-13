// Validate the proposal 0046 example ladder against the four drafts it adds,
// without registering anything. Run from the worktree root:
//   node docs/proposals/0046/ladders/provenance-examples.cjs
//
// Proposal 0046 splits one word into two records. `provenance` in
// manni:ai-context becomes the pinned record of which *body lines* a machine
// wrote: closed entries of `generated-by`, `lines` and `integrity`, the
// spellings of manni:citations:1.0.0-proposal.3's claim, managed by
// `manni meta derive`. Field attribution, which proposal.1 kept under that
// name, is renamed `meta-provenance` and becomes the one shape for the whole
// family: `fields` hold JSON Pointers, `evals` hold eval ids, and an entry
// must name at least one of the two. So the other three shapes go:
// `kg.provenance` (kg proposal.2), `eval-provenance` (evals proposal.3, whose
// prefix guard stops excepting it) and artifact-evals
// `metadata.eval-provenance` (artifact-evals proposal.3, which carries
// `metadata.meta-provenance` with the same entry, repeated byte for byte).
// The page-level `generated-by` goes too: the machines that wrote a page are
// the distinct `generated-by` values across its `provenance`, so ai-context
// proposal.2 keeps that name only as a member of the two entry shapes.
//
// The earlier drafts sit beside these in `docs/proposals/0023/schemas/` and
// are never edited: each is the record of what the vocabulary looked like when
// it was proposed. This ladder reads two of them only to show a rung that
// passed before and fails now, or the reverse.
//
// Every invalid rung names the reason it must fail for: an ajv keyword and
// the instance path it must be reported at. A rung that fails for some other
// reason is as wrong as one that passes.
const { isDeepStrictEqual } = require("node:util");
const fs = require("fs");
const crypto = require("crypto");
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/");
let Ajv = req("ajv/dist/2020.js");
Ajv = Ajv.default ?? Ajv;
const { parse } = req("yaml");

// Each family's draft, spelled once. The prior versions are the drafts these
// were copied from, loaded only for the before/after rungs.
const ROOT = "docs/proposals/0023/schemas";
const VERSIONS = {
  "ai-context": "1.0.0-proposal.2",
  kg: "1.0.0-proposal.2",
  evals: "1.0.0-proposal.3",
  "artifact-evals": "1.0.0-proposal.3",
};
const PRIOR = {
  "ai-context": "1.0.0-proposal.1",
  evals: "1.0.0-proposal.2",
};
const CITATIONS = "docs/proposals/0044/schemas/citations/1.0.0-proposal.3.json";

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
let bad = 0;
const schemas = {};
const validators = {};
function load(key, family, version) {
  const s = read(`${ROOT}/${family}/${version}.json`);
  // A file name and an `$id` that disagree compile fine and then describe the
  // wrong draft, so the two are checked against each other first.
  if (s.$id !== `manni:${family}:${version}`) {
    console.log(`UNEXPECTED ${family}/${version}.json carries $id ${s.$id}`);
    bad++;
  }
  schemas[key] = s;
  validators[key] = new Ajv({ allErrors: true, allowUnionTypes: true }).compile(s);
}
for (const [family, version] of Object.entries(VERSIONS)) load(family, family, version);
for (const [family, version] of Object.entries(PRIOR)) load(`${family}@prior`, family, version);

// Pins are real sha256 digests over short body text, so the rungs carry the
// bytes a tool would write rather than a shape that merely matches.
const pin = (text) => "sha256-" + crypto.createHash("sha256").update(text, "utf8").digest("hex");
const PIN_A = pin("Set `FETCH_TIMEOUT_MS` to raise the limit.\nThe default is ten seconds.");
const PIN_B = pin("Retries back off exponentially.");
const HEX = PIN_A.slice("sha256-".length);

// [name, schema key, expect valid, YAML, reason for an invalid rung]
// A reason is { keyword, instancePath } and, where the plan promises what the
// message names, the ajv param that carries it.
const cases = [
  // ---------------------------------------------------------- provenance
  ["P1 provenance with one range", "ai-context", true,
`title: Rate limits
provenance:
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: ${PIN_A}`],

  ["P2 provenance with two ranges by two machines", "ai-context", true,
`provenance:
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: ${PIN_A}
  - generated-by: claude-sonnet-5
    lines: 44-52
    integrity: ${PIN_B}`],

  ["P3 a single line, lines: 44", "ai-context", true,
`provenance:
  - generated-by: claude-sonnet-5
    lines: 44
    integrity: ${PIN_B}`],

  ["P4 a reversed range passes the schema: L1 <= L2 is the tool's rule, as in citations", "ai-context", true,
`provenance:
  - generated-by: claude-sonnet-5
    lines: 52-44
    integrity: ${PIN_B}`],

  ["N1 an entry with no integrity", "ai-context", false,
`provenance:
  - generated-by: claude-fable-5
    lines: 12-31`,
    { keyword: "required", instancePath: "/provenance/0", param: ["missingProperty", "integrity"] }],

  ["N2 a keyed pin: provenance is always plain, the page is public", "ai-context", false,
`provenance:
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: hmac-sha256-${HEX}`,
    { keyword: "pattern", instancePath: "/provenance/0/integrity" }],

  ["N3 lines: 0, there is no line 0", "ai-context", false,
`provenance:
  - generated-by: claude-fable-5
    lines: 0
    integrity: ${PIN_A}`,
    { keyword: "oneOf", instancePath: "/provenance/0/lines" }],

  ["N4 a commit-sha: evidence is read from blame, never stamped", "ai-context", false,
`provenance:
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: ${PIN_A}
    commit-sha: 3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182`,
    { keyword: "additionalProperties", instancePath: "/provenance/0", param: ["additionalProperty", "commit-sha"] }],

  ["N5 no generated-by: a range nobody wrote is not an entry", "ai-context", false,
`provenance:
  - lines: 12-31
    integrity: ${PIN_A}`,
    { keyword: "required", instancePath: "/provenance/0", param: ["missingProperty", "generated-by"] }],

  ["N6 an empty provenance list", "ai-context", false,
`provenance: []`,
    { keyword: "minItems", instancePath: "/provenance" }],

  ["N7 the same range listed twice", "ai-context", false,
`provenance:
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: ${PIN_A}
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: ${PIN_A}`,
    { keyword: "uniqueItems", instancePath: "/provenance" }],

  ["B1 proposal.1-shaped provenance passes proposal.1 ...", "ai-context@prior", true,
`provenance:
  - generated-by: claude-fable-5
    fields: [intent]
    confidence:
      intent: 0.9`],

  ["N8 ... and fails proposal.2, with the message naming fields", "ai-context", false,
`provenance:
  - generated-by: claude-fable-5
    fields: [intent]
    confidence:
      intent: 0.9`,
    { keyword: "additionalProperties", instancePath: "/provenance/0", param: ["additionalProperty", "fields"] }],

  ["P5 a proposal.1 document with no provenance still passes proposal.2", "ai-context", true,
`title: Install the operator
risks: [privileged, cost-incurring, org-specific-flag]
sample-questions:
  - How do I install the operator on EKS?
  - Which permissions does the install need?`],

  // ----------------------------------------------------- meta-provenance
  ["P6 meta-provenance with fields only", "ai-context", true,
`meta-provenance:
  - generated-by: claude-fable-5
    fields: [/intent, /kg/label]`],

  ["P7 meta-provenance with evals only", "ai-context", true,
`meta-provenance:
  - generated-by: claude-fable-5
    evals: [install-works]`],

  ["P8 fields and evals, confidence keyed by pointer and by eval id", "ai-context", true,
`meta-provenance:
  - generated-by: claude-fable-5
    fields: [/intent, /kg/label]
    evals: [install-works]
    confidence:
      /intent: 0.9
      /kg/label: 0.84
      install-works: 0.7`],

  ["P9 two models, and both keys on one page", "ai-context", true,
`provenance:
  - generated-by: claude-fable-5
    lines: 12-31
    integrity: ${PIN_A}
meta-provenance:
  - generated-by: claude-fable-5
    fields: [/intent]
  - generated-by: claude-sonnet-5
    evals: [install-works]
    confidence:
      install-works: 1`],

  ["N9 an entry with only generated-by says nothing", "ai-context", false,
`meta-provenance:
  - generated-by: claude-fable-5`,
    { keyword: "anyOf", instancePath: "/meta-provenance/0" }],

  ["N10 a bare field name, not a pointer", "ai-context", false,
`meta-provenance:
  - generated-by: claude-fable-5
    fields: [intent]`,
    { keyword: "pattern", instancePath: "/meta-provenance/0/fields/0" }],

  ["N11 a confidence key that is neither a pointer nor an eval id", "ai-context", false,
`meta-provenance:
  - generated-by: claude-fable-5
    fields: [/intent]
    confidence:
      Intent Label: 0.9`,
    { keyword: "propertyNames", instancePath: "/meta-provenance/0/confidence" }],

  ["N12 a confidence above 1", "ai-context", false,
`meta-provenance:
  - generated-by: claude-fable-5
    fields: [/intent]
    confidence:
      /intent: 1.5`,
    { keyword: "maximum", instancePath: "/meta-provenance/0/confidence/~1intent" }],

  ["N13 an empty fields list does not satisfy anyOf by being present", "ai-context", false,
`meta-provenance:
  - generated-by: claude-fable-5
    fields: []`,
    { keyword: "minItems", instancePath: "/meta-provenance/0/fields" }],

  ["N14 an unknown member of an entry", "ai-context", false,
`meta-provenance:
  - generated-by: claude-fable-5
    fields: [/intent]
    reviewed-by: maya`,
    { keyword: "additionalProperties", instancePath: "/meta-provenance/0", param: ["additionalProperty", "reviewed-by"] }],

  // ----------------------------------------------------------------- kg
  ["P10 kg proposal.2 still takes the block without provenance", "kg", true,
`kg:
  label: Configuration
  alt-labels: [config, settings]
  type: reference`],

  ["N15 kg proposal.2 rejects kg.provenance: the block is closed", "kg", false,
`kg:
  label: Configuration
  provenance:
    - generated-by: claude-fable-5
      fields: [label]`,
    { keyword: "additionalProperties", instancePath: "/kg", param: ["additionalProperty", "provenance"] }],

  // -------------------------------------------------------------- evals
  ["B2 eval-provenance at the page root passes evals proposal.2 ...", "evals@prior", true,
`evals:
  - id: install-works
    assertion: The install command works.
eval-provenance:
  - generated-by: claude-fable-5
    evals: [install-works]`],

  ["N16 ... and the narrowed guard rejects it in proposal.3", "evals", false,
`evals:
  - id: install-works
    assertion: The install command works.
eval-provenance:
  - generated-by: claude-fable-5
    evals: [install-works]`,
    { keyword: "false schema", instancePath: "/eval-provenance" }],

  ["P11 evals proposal.3 still takes eval-suite and eval-skip", "evals", true,
`eval-suite: how-to
eval-skip: false
evals:
  - The install command is correct.`],

  ["P12 evals proposal.3 leaves meta-provenance to the open root", "evals", true,
`evals:
  - id: install-works
    assertion: The install command works.
meta-provenance:
  - generated-by: claude-fable-5
    evals: [install-works]`],

  ["N17 an eval-* typo is still rejected in proposal.3", "evals", false,
`eval-suites: how-to`,
    { keyword: "false schema", instancePath: "/eval-suites" }],

  // ----------------------------------------------------- artifact-evals
  ["N18 artifact-evals proposal.3 rejects metadata.eval-provenance", "artifact-evals", false,
`name: release-notes
metadata:
  evals:
    - id: cites-changelog
      assertion: The agent read CHANGELOG.md before writing.
  eval-provenance:
    - generated-by: claude-fable-5
      evals: [cites-changelog]`,
    { keyword: "false schema", instancePath: "/metadata/eval-provenance" }],

  ["P13 artifact-evals proposal.3 takes metadata.meta-provenance", "artifact-evals", true,
`name: release-notes
metadata:
  evals:
    - id: cites-changelog
      assertion: The agent read CHANGELOG.md before writing.
  eval-skip: false
  meta-provenance:
    - generated-by: claude-fable-5
      fields: [/description]
      evals: [cites-changelog]
      confidence:
        /description: 0.8
        cites-changelog: 0.6`],

  ["N19 the shared entry's anyOf holds one level down too", "artifact-evals", false,
`name: release-notes
metadata:
  meta-provenance:
    - generated-by: claude-fable-5`,
    { keyword: "anyOf", instancePath: "/metadata/meta-provenance/0" }],
];

function matches(errors, reason) {
  return (errors ?? []).some((e) =>
    e.keyword === reason.keyword &&
    e.instancePath === reason.instancePath &&
    (reason.param === undefined || e.params?.[reason.param[0]] === reason.param[1]));
}

for (const [name, key, expectValid, yamlText, reason] of cases) {
  const validate = validators[key];
  const ok = validate(parse(yamlText));
  let good = ok === expectValid;
  let detail = "";
  if (!ok && !expectValid) {
    if (reason === undefined || !matches(validate.errors, reason)) {
      good = false;
      detail = ` fails, but not for ${JSON.stringify(reason)}: ${JSON.stringify(validate.errors?.slice(0, 4))}`;
    } else {
      const e = validate.errors.find((x) => x.keyword === reason.keyword && x.instancePath === reason.instancePath);
      detail = ` (fails as intended: ${e.instancePath || "/"} ${e.keyword}: ${e.message})`;
    }
  } else if (!ok) {
    detail = ` errors: ${JSON.stringify(validate.errors?.slice(0, 3))}`;
  }
  if (!good) bad++;
  console.log(`${good ? "OK " : "UNEXPECTED"} [${key}] ${name}${detail}`);
}

// Structural assertions: what the rungs cannot see from a document.
console.log("\nstructural assertions");
const assertions = [
  // Compared as values, not as serialized text: the promise is one definition,
  // and a reformat that only reorders keys must not read as drift.
  ["$defs.metaProvenanceEntry is the same definition in ai-context and artifact-evals",
    isDeepStrictEqual(schemas["ai-context"].$defs.metaProvenanceEntry, schemas["artifact-evals"].$defs.metaProvenanceEntry)],
  ["ai-context $defs.lines is citations proposal.3's $defs.lines",
    isDeepStrictEqual(schemas["ai-context"].$defs.lines, read(CITATIONS).$defs.lines)],
  ["provenance integrity is citations proposal.3's claim integrity pattern",
    schemas["ai-context"].$defs.provenanceEntry.properties.integrity.pattern ===
      read(CITATIONS).$defs.claim.properties.integrity.pattern],
  ["kg proposal.2 has no provenance property and no provenanceEntry",
    !("provenance" in schemas.kg.properties.kg.properties) && !("provenanceEntry" in schemas.kg.$defs)],
  ["evals proposal.3 guard is ^eval-(?!suite$|skip$)",
    JSON.stringify(schemas.evals.patternProperties) === JSON.stringify({ "^eval-(?!suite$|skip$)": false })],
  ["artifact-evals proposal.3 guard is ^eval-(?!skip$)",
    JSON.stringify(schemas["artifact-evals"].properties.metadata.patternProperties) ===
      JSON.stringify({ "^eval-(?!skip$)": false })],
  ["ai-context proposal.2 defines exactly meta-provenance, provenance, risks and sample-questions",
    JSON.stringify(Object.keys(schemas["ai-context"].properties).sort()) ===
      JSON.stringify(["meta-provenance", "provenance", "risks", "sample-questions"])],
  ["evals proposal.3 and artifact-evals proposal.3 use the family severity scale",
    [schemas.evals, schemas["artifact-evals"]].every((schema) => {
      // Every severity enum in the draft, compared as a set, wherever it sits.
      const enums = [];
      const walk = (node) => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (node === null || typeof node !== "object") return;
        if (Array.isArray(node.enum) && node.enum.includes("error")) enums.push([...node.enum].sort());
        Object.values(node).forEach(walk);
      };
      walk(schema);
      return enums.length > 0 && enums.every((e) => isDeepStrictEqual(e, ["error", "notice", "warning"]));
    })],
  ["no new draft still defines a provenanceEntry for field attribution",
    !("provenanceEntry" in schemas.evals.$defs) && !("provenanceEntry" in schemas["artifact-evals"].$defs) &&
      schemas["ai-context"].$defs.provenanceEntry.required.includes("integrity")],
];
for (const [name, holds] of assertions) {
  if (!holds) bad++;
  console.log(`${holds ? "OK " : "UNEXPECTED"} ${name}`);
}

const total = cases.length + assertions.length;
console.log(`\n${total - bad}/${total} checks passed (${cases.length} rungs, ${assertions.length} assertions)`);
process.exit(bad ? 1 : 0);
