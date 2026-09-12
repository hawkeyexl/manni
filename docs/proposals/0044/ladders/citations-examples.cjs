// Validate the manni:citations example ladder against the draft schema,
// without registering anything. Run from the worktree root.
//
// Three drafts sit side by side in `../schemas/citations/`. `1.0.0-proposal.1`
// and `1.0.0-proposal.2` are kept exactly as they were written: they are the
// record of what the vocabulary looked like when each was proposed, and a
// superseded draft is never edited to match what shipped. This ladder
// validates `1.0.0-proposal.3`, the draft the tool implements.
//
// What proposal.3 changed, and what this ladder therefore exercises: an entry
// is two blocks, `claim` and `source`, each a line range and a hash. The flat
// `src:`/`integrity:` pair is gone, `claim` is an object rather than a
// sentence, `commit:` became `source.commit-sha`, and the page-level
// `citation-commit:` is gone with it. `source.file` holds the path alone
// (a plain path or the `~` ciphertext of one) and `source.lines` holds the
// lines beside it, so nothing carries a `:L` suffix any more.
const fs = require("fs");
const { createRequire } = require("module");
const req = createRequire(process.cwd() + "/");
let Ajv = req("ajv/dist/2020.js");
Ajv = Ajv.default ?? Ajv;
const { parse } = req("yaml");

// The draft's semver prerelease, spelled once per ladder so a bump is a
// one-line edit here rather than a literal buried mid-expression.
const V = "1.0.0-proposal.3";

// Ciphertext-shaped sources: `~` and base64url (A-Z, a-z, 0-9, `-`, `_`). The
// schema checks the shape only; whether a value decrypts is the key holder's
// question. 84 characters here, 82 at the shortest.
const CIPHER = "~" + "AQx7Vb2_Kp-9Qm".repeat(6);
// One character short of the shortest ciphertext.
const SHORT = CIPHER.slice(0, 82);
// Standard base64's `+` and `/` are not in the base64url alphabet.
const BAD_ALPHABET = "~" + "AQx7Vb2+Kp/9Qm".repeat(6);
const schema = JSON.parse(
  fs.readFileSync(`docs/proposals/0044/schemas/citations/${V}.json`, "utf8"),
);
const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

// One real source pin, reused wherever a case needs a well-formed one. It is
// sha256 of `export const FETCH_TIMEOUT_MS = 10_000;` — line 2 of the drift
// ladder's SOURCE fixture — so the two ladders agree on the bytes.
const PIN = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
// The keyed pin an encrypted source carries: same sixty-four digits' worth of
// hex, a prefix that says an HMAC produced it. A plain source may never carry
// this prefix, and an encrypted one may never carry `sha256-`; the pairing is
// a rule on implementations, not something the schema can see.
const KEYED = "hmac-sha256-4f2c8b9a1d3e5f607182930a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e";
// A claim pin, always plain: the page is public, so there is nothing to hide.
const CLAIM = "sha256-921b21cccab21a4577f224ec4171aa56a3414bb3a5a4704ab8b6f314c46aa094";
// Forty hex digits exactly, what git writes for a SHA-1 repository.
const FULL = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
// Sixty-four, what a SHA-256 repository writes.
const FULL256 = FULL + "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182".slice(0, 24);

const cases = [
  // Positives.
  ["1 a bare whole-file pin: source alone, no lines and no claim", true,
`citations:
  - source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["2 one source line, one claim line: the two-block entry", true,
`citations:
  - id: fetch-timeout
    claim:
      lines: 3
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["3 a claim with no lines: a marker names the entry and anchors the text", true,
`citations:
  - id: fetch-timeout
    claim:
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["4 a two-line claim, lines: \"3-4\"", true,
`citations:
  - claim:
      lines: "3-4"
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["5 a source range, lines: \"1-3\"", true,
`citations:
  - claim:
      lines: 3
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      lines: "1-3"
      integrity: ${PIN}`],

  ["6 source with no lines: the whole file is pinned", true,
`citations:
  - claim:
      lines: 3
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["7 commit-sha at seven hex, the shortest git abbreviates to", true,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}
      commit-sha: 3f9c2a1`],

  ["8 commit-sha at forty hex, what a tool writes", true,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}
      commit-sha: ${FULL}`],

  ["9 commit-sha at sixty-four hex, a SHA-256 repository", true,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}
      commit-sha: ${FULL256}`],

  ["10 an id-only entry, for a body marker to name", true,
`citations:
  - id: fetch-timeout
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["11 quote true with a claim", true,
`citations:
  - claim:
      lines: "3-7"
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      lines: "1-3"
      integrity: ${PIN}
    quote: true`],

  ["12 quote false and no claim (a bare pin that says so)", true,
`citations:
  - source:
      file: src/limits.ts
      lines: "1-3"
      integrity: ${PIN}
    quote: false`],

  ["13 a path with spaces and dots in its segments", true,
`citations:
  - source:
      file: docs/release notes/v1.2.md
      lines: "4-9"
      integrity: ${PIN}`],

  // The pattern cannot compare two numbers; the tool refuses both of these
  // with `entry-invalid`, naming the end that is wrong.
  ["14 a reversed claim range passes the schema (tool enforces order)", true,
`citations:
  - claim:
      lines: "9-3"
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["15 a reversed source range passes the schema too", true,
`citations:
  - source:
      file: src/limits.ts
      lines: "9-3"
      integrity: ${PIN}`],

  ["16 two entries with distinct ids", true,
`citations:
  - id: max-files
    source:
      file: src/limits.ts
      lines: 1
      integrity: ${PIN}
  - id: fetch-timeout
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["17 an encrypted source with a range, pinned hmac-sha256-", true,
`citations:
  - source:
      file: "${CIPHER}"
      lines: "1-3"
      integrity: ${KEYED}`],

  ["18 an encrypted whole-file pin", true,
`citations:
  - source:
      file: "${CIPHER}"
      integrity: ${KEYED}`],

  ["19 the shortest encrypted source, 82 characters", true,
`citations:
  - source:
      file: "${CIPHER.slice(0, 83)}"
      lines: 2
      integrity: ${KEYED}`],

  ["20 every field at once: id, claim, source, commit-sha, quote", true,
`citations:
  - id: fetch-timeout
    claim:
      lines: "14-18"
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      lines: "1-3"
      integrity: ${PIN}
      commit-sha: ${FULL}
    quote: true`],

  // Negatives.
  ["N1 citations as an object, not a list", false,
`citations:
  source:
    file: src/limits.ts
    integrity: ${PIN}`],

  ["N2 an empty list is not a declaration", false,
`citations: []`],

  ["N3 an entry with no source", false,
`citations:
  - id: fetch-timeout
    claim:
      lines: 3
      integrity: ${CLAIM}`],

  ["N4 source without integrity", false,
`citations:
  - source:
      file: src/limits.ts
      lines: 2`],

  ["N5 source without file", false,
`citations:
  - source:
      lines: 2
      integrity: ${PIN}`],

  ["N6 a claim with no integrity: lines pin nothing", false,
`citations:
  - claim:
      lines: 3
    source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["N7 a claim integrity spelled hmac-sha256-: a claim is never keyed", false,
`citations:
  - claim:
      lines: 3
      integrity: ${KEYED}
    source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["N8 claim as a sentence, the way proposal.2 wrote it", false,
`citations:
  - claim: The fetch timeout is 10 seconds.
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["N9 the flat src: of proposal.2", false,
`citations:
  - src: src/limits.ts:2
    integrity: ${PIN}`],

  ["N10 a top-level integrity beside a source block", false,
`citations:
  - integrity: ${PIN}
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["N11 commit: on the entry, the way proposal.2 wrote it", false,
`citations:
  - commit: ${FULL}
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["N12 commit: inside source, an unknown key there", false,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}
      commit: ${FULL}`],

  ["N13 an unknown key inside claim", false,
`citations:
  - claim:
      lines: 3
      integrity: ${CLAIM}
      text: The fetch timeout is 10 seconds.
    source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["N14 the page-level citation-commit of proposal.2", false,
`citation-commit: ${FULL}
citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["N15 a misspelled citation-* key is a typo, not an extension", false,
`citation-comit: ${FULL}
citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["N16 a bare hex integrity with no algorithm prefix", false,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: 78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f`],

  ["N17 a sha512- prefix (two algorithms, and that is not one)", false,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: sha512-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f`],

  ["N18 a file carrying the old path:L suffix", false,
`citations:
  - source:
      file: src/limits.ts:2
      integrity: ${PIN}`],

  ["N19 an absolute path", false,
`citations:
  - source:
      file: /src/limits.ts
      integrity: ${PIN}`],

  ["N20 a .. segment walks out of the root", false,
`citations:
  - source:
      file: ../other/limits.ts
      integrity: ${PIN}`],

  ["N21 a backslash separator", false,
`citations:
  - source:
      file: src\\\\limits.ts
      integrity: ${PIN}`],

  ["N22 a ./ segment", false,
`citations:
  - source:
      file: ./src/limits.ts
      integrity: ${PIN}`],

  ["N23 a trailing slash names a directory, not a source", false,
`citations:
  - source:
      file: src/
      integrity: ${PIN}`],

  ["N24 line 0 on the claim", false,
`citations:
  - claim:
      lines: 0
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["N25 one line as the string \"3\": the string form is a range", false,
`citations:
  - claim:
      lines: "3"
      integrity: ${CLAIM}
    source:
      file: src/limits.ts
      integrity: ${PIN}`],

  ["N26 a six-hex commit-sha, shorter than git ever abbreviates to", false,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}
      commit-sha: 3f9c2a`],

  ["N27 an uppercase commit-sha", false,
`citations:
  - source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}
      commit-sha: 3F9C2A1`],

  ["N28 an id with uppercase and a space", false,
`citations:
  - id: Fetch timeout
    source:
      file: src/limits.ts
      lines: 2
      integrity: ${PIN}`],

  ["N29 quote as the string \"true\"", false,
`citations:
  - source:
      file: src/limits.ts
      lines: "1-3"
      integrity: ${PIN}
    quote: "true"`],

  ["N30 an encrypted source one character short of the shortest", false,
`citations:
  - source:
      file: "${SHORT}"
      lines: 2
      integrity: ${KEYED}`],

  ["N31 an encrypted source in standard base64, not base64url", false,
`citations:
  - source:
      file: "${BAD_ALPHABET}"
      lines: 2
      integrity: ${KEYED}`],

  ["N32 proposal.1's sixteen-hex token, which carried no ciphertext", false,
`citations:
  - source:
      file: "~9c1f0e2b7a3d4c5e"
      lines: "1-3"
      integrity: ${KEYED}`],
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

// Regex probes: the fileRef pattern on its own, under node, against strings
// the YAML cases above cannot carry cleanly (a literal newline, for one).
// `file` is the path and nothing else, so there is no `:L` suffix to probe;
// a colon anywhere is what rules out a URL, a drive letter and the old
// `path:L` spelling in one stroke. Ajv compiles patterns with the `u` flag,
// so the probe does too.
console.log("\nregex probes: $defs.fileRef.pattern");
const fileRef = new RegExp(schema.$defs.fileRef.pattern, "u");
const probes = [
  ["src/limits.ts", true],
  ["a", true],
  ["docs/release notes/v1.2.md", true],
  [".hidden/file.md", true],
  ["a.b.c", true],
  ["...a", true],
  [CIPHER, true],
  [CIPHER.slice(0, 83), true],
  ["src/limits.ts:2", false],
  ["src/limits.ts:1-3", false],
  ["https://x/y", false],
  ["C:/x", false],
  ["a//b", false],
  ["a/b\n", false],
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
  ["a\tb", false],
  [SHORT, false],
  [BAD_ALPHABET, false],
  [`${CIPHER}=`, false],
  ["~9c1f0e2b7a3d4c5e", false],
  ["~home/x", false],
  ["~", false],
];
for (const [input, expected] of probes) {
  const got = fileRef.test(input);
  const verdict = got === expected ? "OK " : "UNEXPECTED";
  if (got !== expected) bad++;
  console.log(`${verdict} ${JSON.stringify(input)} -> ${got}`);
}

process.exit(bad ? 1 : 0);
