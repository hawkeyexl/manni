// Validate the manni:citations:1.0.0-proposal.1 example ladder against the draft
// schema, without registering anything. Run from the worktree root.
const fs = require("fs");
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/");
let Ajv = req("ajv/dist/2020.js");
Ajv = Ajv.default ?? Ajv;
const { parse } = req("yaml");

// The draft's semver prerelease, spelled once per ladder so a bump is a
// one-line edit here rather than a literal buried mid-expression.
const V = "1.0.0-proposal.1";
const schema = JSON.parse(
  fs.readFileSync(`docs/proposals/0044/schemas/citations/${V}.json`, "utf8"),
);
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

// One real pin, reused wherever a case needs a well-formed integrity value.
// It is sha256 of `export const FETCH_TIMEOUT_MS = 10_000;` — line 2 of the
// drift ladder's SOURCE fixture — so the two ladders agree on the bytes.
const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
// Forty hex digits exactly. The plan's one-screen example spelled a 65-digit
// "commit", which the pattern rightly refuses; this is its first forty.
const FULL = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";

const cases = [
  // Positives.
  ["1 bare whole-file pin", true,
`citations:
  - src: src/limits.ts
    integrity: ${PIN}`],

  ["2 one line with the claim it supports", true,
`citations:
  - src: src/limits.ts:2
    integrity: ${PIN}
    claim: The fetch timeout is 10 seconds.`],

  ["3 a range, pinned at a full 40-hex commit", true,
`citations:
  - src: src/limits.ts:1-3
    integrity: ${PIN}
    commit: ${FULL}`],

  ["4 the page-level citation-commit stands in for every entry", true,
`citation-commit: ${FULL}
citations:
  - src: src/limits.ts:2
    integrity: ${PIN}`],

  ["5 an entry commit beside the page default (the entry wins; tool rule)", true,
`citation-commit: ${FULL}
citations:
  - src: src/limits.ts:2
    integrity: ${PIN}
    commit: 3f9c2a1`],

  ["6 an id-only entry, for an in-body reference to name", true,
`citations:
  - id: fetch-timeout
    src: src/limits.ts:2
    integrity: ${PIN}`],

  ["7 quote true with a claim", true,
`citations:
  - src: src/limits.ts:1-3
    integrity: ${PIN}
    claim: The limits are set in one file.
    quote: true`],

  ["8 quote false and no claim (a bare pin that says so)", true,
`citations:
  - src: src/limits.ts:1-3
    integrity: ${PIN}
    quote: false`],

  ["9 a seven-hex commit, the shortest git abbreviates to", true,
`citations:
  - src: src/limits.ts:2
    integrity: ${PIN}
    commit: 3f9c2a1`],

  ["10 a path with spaces and dots in its segments", true,
`citations:
  - src: docs/release notes/v1.2.md:4-9
    integrity: ${PIN}`],

  // The pattern cannot compare two numbers; the tool refuses this one.
  ["11 a reversed range passes the schema (tool enforces order)", true,
`citations:
  - src: src/limits.ts:9-3
    integrity: ${PIN}`],

  ["12 two entries with distinct ids", true,
`citations:
  - id: max-files
    src: src/limits.ts:1
    integrity: ${PIN}
  - id: fetch-timeout
    src: src/limits.ts:2
    integrity: ${PIN}`],

  ["13 an obfuscated source with a range", true,
`citations:
  - src: "~9c1f0e2b7a3d4c5e:1-3"
    integrity: ${PIN}`],

  ["14 an obfuscated whole-file pin", true,
`citations:
  - src: "~9c1f0e2b7a3d4c5e"
    integrity: ${PIN}`],

  // Negatives.
  ["N1 citations as an object, not a list", false,
`citations:
  src: src/limits.ts:2
  integrity: ${PIN}`],

  ["N2 an empty list is not a declaration", false,
`citations: []`],

  ["N3 src without integrity", false,
`citations:
  - src: src/limits.ts:2`],

  ["N4 integrity without src", false,
`citations:
  - integrity: ${PIN}`],

  ["N5 neither src nor integrity", false,
`citations:
  - claim: The fetch timeout is 10 seconds.`],

  ["N6 a bare hex integrity with no algorithm prefix", false,
`citations:
  - src: src/limits.ts:2
    integrity: 78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f`],

  ["N7 a sha512- prefix (one algorithm in proposal.1)", false,
`citations:
  - src: src/limits.ts:2
    integrity: sha512-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f`],

  ["N8 an absolute path", false,
`citations:
  - src: /src/limits.ts:2
    integrity: ${PIN}`],

  ["N9 a .. segment walks out of the root", false,
`citations:
  - src: ../other/limits.ts:2
    integrity: ${PIN}`],

  ["N10 a backslash separator", false,
`citations:
  - src: src\\\\limits.ts:2
    integrity: ${PIN}`],

  ["N11 line 0", false,
`citations:
  - src: src/limits.ts:0
    integrity: ${PIN}`],

  ["N12 a ./ segment", false,
`citations:
  - src: ./src/limits.ts:2
    integrity: ${PIN}`],

  ["N13 a six-hex commit, shorter than git ever abbreviates to", false,
`citations:
  - src: src/limits.ts:2
    integrity: ${PIN}
    commit: 3f9c2a`],

  ["N14 an uppercase commit", false,
`citations:
  - src: src/limits.ts:2
    integrity: ${PIN}
    commit: 3F9C2A1`],

  ["N15 an id with uppercase and a space", false,
`citations:
  - id: Fetch timeout
    src: src/limits.ts:2
    integrity: ${PIN}`],

  ["N16 an empty claim", false,
`citations:
  - src: src/limits.ts:2
    integrity: ${PIN}
    claim: ""`],

  ["N17 an unknown entry field (the line belongs in src)", false,
`citations:
  - src: src/limits.ts
    line: 2
    integrity: ${PIN}`],

  ["N18 a misspelled citation-* key is a typo, not an extension", false,
`citation-comit: ${FULL}
citations:
  - src: src/limits.ts:2
    integrity: ${PIN}`],

  ["N19 quote as the string \"true\"", false,
`citations:
  - src: src/limits.ts:1-3
    integrity: ${PIN}
    quote: "true"`],

  ["N20 a trailing slash names a directory, not a source", false,
`citations:
  - src: src/
    integrity: ${PIN}`],

  ["N21 an uppercase obfuscation token", false,
`citations:
  - src: "~9C1F0E2B7A3D4C5E"
    integrity: ${PIN}`],

  ["N22 a fifteen-hex obfuscation token", false,
`citations:
  - src: "~9c1f0e2b7a3d4c5"
    integrity: ${PIN}`],
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

// Regex probes: the srcRef pattern on its own, under node, against strings the
// YAML cases above cannot carry cleanly (a literal newline, for one). Ajv
// compiles patterns with the `u` flag, so the probe does too.
console.log("\nregex probes: $defs.srcRef.pattern");
const srcRef = new RegExp(schema.$defs.srcRef.pattern, "u");
const probes = [
  ["src/limits.ts", true],
  ["src/limits.ts:2", true],
  ["src/limits.ts:1-3", true],
  ["a:1-2", true],
  ["docs/release notes/v1.2.md:4-9", true],
  [".hidden/file.md", true],
  ["a.b.c", true],
  ["~9c1f0e2b7a3d4c5e", true],
  ["~9c1f0e2b7a3d4c5e:1-3", true],
  ["src/limits.ts:9-3", true],
  ["https://x/y", false],
  ["C:/x", false],
  ["a//b", false],
  ["a/b\n", false],
  ["a:0", false],
  ["a:01", false],
  ["/a", false],
  ["a/", false],
  ["a\\b", false],
  ["./a", false],
  ["../a", false],
  ["a/./b", false],
  ["a/../b", false],
  [".", false],
  ["..", false],
  ["", false],
  ["a:1-", false],
  ["a:-2", false],
  ["a:1-2-3", false],
  ["a\tb", false],
  ["~9C1F0E2B7A3D4C5E", false],
  ["~9c1f0e2b7a3d4c5", false],
  ["~9c1f0e2b7a3d4c5e7", false],
  ["~home/x", false],
  ["~", false],
];
for (const [input, expected] of probes) {
  const got = srcRef.test(input);
  const verdict = got === expected ? "OK " : "UNEXPECTED";
  if (got !== expected) bad++;
  console.log(`${verdict} ${JSON.stringify(input)} -> ${got}`);
}

process.exit(bad ? 1 : 0);
