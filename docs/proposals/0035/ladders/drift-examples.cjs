// The drift-check contract of proposal 0035, as a self-contained reference
// implementation: the hashing rule, the obfuscation rule, the classifier, the
// inline-statement scanner and the claim search, each run against a fixed
// source file and its variants. No src/ import and no schema: this ladder is
// what the implementation in src/cite/ must agree with, not the other way
// round. Run from anywhere; exit 0 means every golden hash and every verdict
// held. `test/cite/classify.test.ts` imports the fixtures from here.
const crypto = require("node:crypto");
const assert = require("node:assert");

// ---------------------------------------------------------------------------
// Fixtures. SOURCE is test/fixtures/cite/src/limits.ts, seven lines, trailing
// LF. Every variant is a way a real file drifts.
// ---------------------------------------------------------------------------

const SOURCE = [
  "export const MAX_FILES = 10_000;",
  "export const FETCH_TIMEOUT_MS = 10_000;",
  "export const RETRIES = 3;",
  "",
  "export function limits() {",
  "  return { MAX_FILES, FETCH_TIMEOUT_MS, RETRIES };",
  "}",
].join("\n") + "\n";

const L = SOURCE.split("\n"); // L[i] is line i+1; L[7] is the empty tail

const variants = {
  // Two comment lines inserted above: every line shifts down by two.
  MOVED: "// Tuned for the docs build.\n// Raise with care.\n" + SOURCE,
  // Line 2's value changed.
  CHANGED: SOURCE.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 30_000"),
  // Same bytes, Windows line endings.
  CRLF: SOURCE.replace(/\n/g, "\r\n"),
  // Same bytes, a UTF-8 byte-order mark in front.
  BOM: "\uFEFF" + SOURCE,
  // Lines 1-3 appended after line 7: a second copy of the pinned line exists.
  AMBIG: SOURCE + L.slice(0, 3).join("\n") + "\n",
  // Line 2 gained one trailing space.
  TRAILING_WS: SOURCE.replace("FETCH_TIMEOUT_MS = 10_000;\n", "FETCH_TIMEOUT_MS = 10_000; \n"),
  // Only lines 1-3 survive.
  SHRUNK: L.slice(0, 3).join("\n") + "\n",
  // What the file looked like at the recorded commit, when the pin was minted
  // against something else: line 2 was 20_000 there.
  AT_COMMIT_OTHER: SOURCE.replace("FETCH_TIMEOUT_MS = 10_000", "FETCH_TIMEOUT_MS = 20_000"),
};
// MOVED and AMBIG together: the pinned line is gone from line 2 and equal
// windows sit at 4 and 11. This is the plan's `2 candidates (:4, :11)` case.
variants.MOVED_AMBIG = "// Tuned for the docs build.\n// Raise with care.\n" + variants.AMBIG;
// MOVED, then CHANGED: the two comment lines are in, and line 4 (the old
// line 2) was edited afterwards. This is what `update` leaves behind when it
// rewrote `src` to :4 for the move and the value then changed.
variants.MOVED_CHANGED = "// Tuned for the docs build.\n// Raise with care.\n" + variants.CHANGED;

// ---------------------------------------------------------------------------
// The hashing rule, stated once in the schema's `integrity` description.
// ---------------------------------------------------------------------------

function normalize(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n/g, "\n");
}

function lines(text) {
  const parts = normalize(text).split("\n");
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function sha256(s) {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// mint(text)            whole file, plain
// mint(text, 2)         one line, plain
// mint(text, 1, 3)      a range, plain
// mint(text, 1, 3, salt) keyed: sha256(salt + "\n" + text). The keyed form is
// what an obfuscated `src` carries; the salt may be "" and is still a key.
function mint(text, l1, l2, salt) {
  const all = lines(text);
  let picked;
  if (l1 === undefined) picked = all;
  else {
    const end = l2 === undefined ? l1 : l2;
    if (end > all.length) return undefined; // range beyond EOF: nothing to pin
    picked = all.slice(l1 - 1, end);
  }
  const body = picked.join("\n");
  return "sha256-" + sha256(salt === undefined ? body : salt + "\n" + body);
}

// ---------------------------------------------------------------------------
// The obfuscation rule.
// ---------------------------------------------------------------------------

function obfuscate(path, salt) {
  return "~" + sha256(salt + "\n" + path).slice(0, 16);
}

function parseSrc(src) {
  const m = /^(.*?)(?::([1-9][0-9]*)(?:-([1-9][0-9]*))?)?$/.exec(src);
  const path = m[1];
  const start = m[2] === undefined ? undefined : Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  return { path, obfuscated: path.startsWith("~"), start, end };
}

function formatSrc(path, start, end) {
  if (start === undefined) return path;
  return end === undefined || end === start ? `${path}:${start}` : `${path}:${start}-${end}`;
}

// ---------------------------------------------------------------------------
// The classifier. `current` is the file's text now, or null when no tracked
// file matches. `atCommit` is the file's text at entry.commit, null when the
// path was absent at that commit, "unavailable" when the commit is unknown to
// git (a shallow clone), or undefined when the entry carries no commit.
// ---------------------------------------------------------------------------

function classify(entry, current, atCommit, opts = {}) {
  const { path, obfuscated, start, end } = parseSrc(entry.src);
  const salt = obfuscated ? (opts.salt ?? "") : undefined;
  const pinOf = (text, a, b) => mint(text, a, b, salt);

  if (current === null) return { status: "missing" };

  const now = lines(current);
  const here = pinOf(current, start, end);
  if (here === entry.integrity) return { status: "current" };

  // A whole-file pin has nowhere to move to.
  if (start !== undefined) {
    const width = end - start + 1;
    const candidates = [];
    for (let s = 1; s + width - 1 <= now.length; s++) {
      if (s === start) continue;
      if (pinOf(current, s, s + width - 1) === entry.integrity) {
        candidates.push(formatSrc(path, s, s + width - 1));
      }
    }
    if (candidates.length === 1) return { status: "moved", newSrc: candidates[0] };
    if (candidates.length > 1) return { status: "moved-ambiguous", candidates };
  }

  const result = { status: "changed" };
  if (here === undefined) result.fileLines = now.length;
  if (entry.commit === undefined) return result;

  if (atCommit === "unavailable") return { ...result, historyAvailable: false };
  if (atCommit === null) return { status: "never-true", reason: "path absent at commit" };
  const then = pinOf(atCommit, start, end);
  if (then === entry.integrity) return { ...result, historyAvailable: true };
  // Not at the recorded lines. `update` rewrites `src` for a move and keeps
  // `commit`, so the lines the pin was minted from may sit elsewhere in the
  // file as it was then. Only a pin found nowhere there never held; a
  // whole-file pin has nowhere else to be.
  if (start !== undefined) {
    const width = end - start + 1;
    const was = lines(atCommit);
    for (let s = 1; s + width - 1 <= was.length; s++) {
      if (pinOf(atCommit, s, s + width - 1) === entry.integrity) {
        return { ...result, historyAvailable: true };
      }
    }
  }
  return { status: "never-true", reason: "pin does not match at commit" };
}

// ---------------------------------------------------------------------------
// Inline statements: one keyword, `cite`, in the format's comment syntax.
// ---------------------------------------------------------------------------

// [open, close, jsonAllowed]
const DELIMITERS = {
  markdown: [["<!--", "-->", true], ["{/*", "*/}", true], ["[comment]: # (", ")", false]],
  mdx: [["<!--", "-->", true], ["{/*", "*/}", true], ["[comment]: # (", ")", false]],
  html: [["<!--", "-->", true]],
  xml: [["<!--", "-->", true]],
  asciidoc: [["// (", ")", false]],
  rst: [[".. (", ")", false]],
};

const ID = /^[a-z0-9][a-z0-9-]*$/;

function lineAt(text, offset) {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function anchorAfter(body, closeEnd, closeLine) {
  const eol = body.indexOf("\n", closeEnd);
  const rest = body.slice(closeEnd, eol === -1 ? body.length : eol);
  if (rest.trim() !== "") return closeLine;
  const all = body.split("\n");
  for (let i = closeLine; i < all.length; i++) {
    if (all[i].trim() !== "") return i + 1;
  }
  return undefined;
}

function parseStatements(body, format) {
  const table = DELIMITERS[format];
  if (!table) throw new Error(`no statement syntax for format "${format}"`);
  const out = [];
  for (const [open, close, jsonAllowed] of table) {
    let from = 0;
    for (;;) {
      const at = body.indexOf(open, from);
      if (at === -1) break;
      const closeAt = body.indexOf(close, at + open.length);
      if (closeAt === -1) break;
      from = closeAt + close.length;
      const inner = body.slice(at + open.length, closeAt).trim();
      if (!/^cite(\s|$)/.test(inner)) continue;
      const payload = inner.slice(4).trim();
      const line = lineAt(body, at);
      const raw = body.slice(at, from);
      const anchorLine = anchorAfter(body, from, lineAt(body, closeAt));
      let parsed;
      if (payload === "") parsed = { kind: "bad", reason: "empty payload" };
      else if (payload.startsWith("{")) {
        if (!jsonAllowed) parsed = { kind: "bad", reason: "json payload not allowed in this form" };
        else {
          try {
            parsed = { kind: "entry", entry: JSON.parse(payload) };
          } catch {
            parsed = { kind: "bad", reason: "malformed json" };
          }
        }
      } else if (ID.test(payload)) parsed = { kind: "ref", id: payload };
      else parsed = { kind: "bad", reason: "payload is neither an id nor json" };
      out.push({ line, anchorLine, payload: parsed, raw });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Claims: a whitespace-normalized search scoped to paragraphs, so a
// soft-wrapped sentence still matches and one match per paragraph is the unit.
// ---------------------------------------------------------------------------

function squash(s) {
  return s.replace(/\s+/g, " ").trim();
}

function paragraphs(body) {
  const all = body.split("\n");
  const out = [];
  let start = null;
  let buf = [];
  let inFence = false;
  const flush = () => {
    if (start !== null) out.push({ line: start, text: buf.join("\n") });
    start = null;
    buf = [];
  };
  all.forEach((ln, i) => {
    const fence = /^(```|~~~|----)/.test(ln);
    if (fence) {
      flush();
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (ln.trim() === "") return flush();
    if (start === null) start = i + 1;
    buf.push(ln);
  });
  flush();
  return out;
}

// Reports the line the claim starts on, not the paragraph's first line: a
// statement sitting directly above the sentence is part of the same paragraph
// in markdown terms, and the finding should point at the sentence.
function findClaim(body, claim) {
  const want = squash(claim);
  const hits = [];
  for (const p of paragraphs(body)) {
    const ls = p.text.split("\n");
    if (!squash(p.text).includes(want)) continue;
    let at = 0;
    for (let i = 1; i < ls.length; i++) {
      if (squash(ls.slice(i).join("\n")).includes(want)) at = i;
      else break;
    }
    hits.push(p.line + at);
  }
  return { count: hits.length, lines: hits };
}

// The fenced block that follows a line: its content, for quote comparison.
function fencedBlockAfter(body, line) {
  const all = body.split("\n");
  for (let i = line; i < all.length; i++) {
    const m = /^(```|~~~|----)/.exec(all[i]);
    if (!m) continue;
    const buf = [];
    for (let j = i + 1; j < all.length; j++) {
      if (all[j].startsWith(m[1])) return { line: i + 1, text: buf.join("\n") + "\n" };
      buf.push(all[j]);
    }
    return undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Goldens and verdicts.
// ---------------------------------------------------------------------------

const COMMIT = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
const PIN_L2 = mint(SOURCE, 2);
const PIN_1_3 = mint(SOURCE, 1, 3);
const PIN_WHOLE = mint(SOURCE);
const SALT = "SALT-LADDER";
const TOKEN = obfuscate("src/limits.ts", SALT);

const ENTRY = { id: "fetch-timeout", src: "src/limits.ts:2", integrity: PIN_L2, commit: COMMIT };

// [name, entry, current, atCommit, expected]
const VERDICTS = [
  ["current", ENTRY, SOURCE, SOURCE, { status: "current" }],
  ["moved by two lines", ENTRY, variants.MOVED, SOURCE, { status: "moved", newSrc: "src/limits.ts:4" }],
  ["moved, two candidates", ENTRY, variants.MOVED_AMBIG, SOURCE,
    { status: "moved-ambiguous", candidates: ["src/limits.ts:4", "src/limits.ts:11"] }],
  ["a copy elsewhere does not move a pin that still holds", ENTRY, variants.AMBIG, SOURCE, { status: "current" }],
  ["changed, history available", ENTRY, variants.CHANGED, SOURCE, { status: "changed", historyAvailable: true }],
  ["changed, history unavailable", ENTRY, variants.CHANGED, "unavailable", { status: "changed", historyAvailable: false }],
  ["changed, no commit recorded", { ...ENTRY, commit: undefined }, variants.CHANGED, undefined, { status: "changed" }],
  ["never true: pin does not match at commit", ENTRY, variants.CHANGED, variants.AT_COMMIT_OTHER,
    { status: "never-true", reason: "pin does not match at commit" }],
  ["never true: path absent at commit", ENTRY, variants.CHANGED, null,
    { status: "never-true", reason: "path absent at commit" }],
  // `update` rewrote src :2 -> :4 for the move and kept the commit; line 4
  // then changed. The pinned bytes sat at line 2 at the commit, so the pin
  // was true then, and this is drift, not a pin that never held.
  ["moved by update, then changed: the pin held elsewhere at the commit", { ...ENTRY, src: "src/limits.ts:4" },
    variants.MOVED_CHANGED, SOURCE, { status: "changed", historyAvailable: true }],
  ["crlf is the same bytes", ENTRY, variants.CRLF, SOURCE, { status: "current" }],
  ["bom is the same bytes", ENTRY, variants.BOM, SOURCE, { status: "current" }],
  ["trailing whitespace is a change", ENTRY, variants.TRAILING_WS, SOURCE, { status: "changed", historyAvailable: true }],
  ["missing: no tracked file", ENTRY, null, undefined, { status: "missing" }],
  ["whole-file pin never moves", { src: "src/limits.ts", integrity: PIN_WHOLE, commit: COMMIT }, variants.MOVED, SOURCE,
    { status: "changed", historyAvailable: true }],
  ["whole-file pin holds across crlf", { src: "src/limits.ts", integrity: PIN_WHOLE }, variants.CRLF, undefined, { status: "current" }],
  ["range beyond eof", { src: "src/limits.ts:1-7", integrity: PIN_WHOLE, commit: COMMIT }, variants.SHRUNK, SOURCE,
    { status: "changed", historyAvailable: true, fileLines: 3 }],
  ["obfuscated, keyed pin, right salt", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, SALT) }, SOURCE, undefined,
    { status: "current" }],
  ["obfuscated, keyed pin, moved", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, SALT) }, variants.MOVED, undefined,
    { status: "moved", newSrc: `${TOKEN}:4` }],
  ["obfuscated, wrong salt is a changed pin, not a leak", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, SALT) }, SOURCE, undefined,
    { status: "changed" }, { salt: "wrong" }],
];

function run() {
  // Golden hashes, from the plan, verified with node.
  assert.strictEqual(PIN_L2, "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f");
  assert.strictEqual(PIN_1_3, "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6");
  assert.strictEqual(PIN_WHOLE, "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023");
  assert.strictEqual(mint(SOURCE, 1, 7), PIN_WHOLE, "1-N equals the whole file");
  assert.strictEqual(mint(variants.CRLF, 2), PIN_L2, "crlf line 2 equals plain line 2");
  assert.strictEqual(mint(variants.BOM, 1, 3), PIN_1_3, "a bom does not enter the hash");
  assert.notStrictEqual(mint(SOURCE, 2, 2, ""), PIN_L2, "an empty salt is still a key");
  assert.strictEqual(TOKEN.length, 17);
  assert.match(TOKEN, /^~[0-9a-f]{16}$/);
  assert.notStrictEqual(obfuscate("src/limits.ts", "other"), TOKEN, "the token depends on the salt");
  console.log("golden hashes");
  console.log(`  line 2    ${PIN_L2}`);
  console.log(`  lines 1-3 ${PIN_1_3}`);
  console.log(`  whole     ${PIN_WHOLE}  (= lines 1-7)`);
  console.log(`  token     ${TOKEN}  (salt ${JSON.stringify(SALT)})`);

  let bad = 0;
  const check = (name, got, expected) => {
    let ok = true;
    try {
      assert.deepStrictEqual(got, expected);
    } catch {
      ok = false;
      bad++;
    }
    console.log(`${ok ? "OK " : "UNEXPECTED"} ${name}${ok ? "" : `\n      got ${JSON.stringify(got)}\n      want ${JSON.stringify(expected)}`}`);
  };

  console.log("\nverdicts: classify(entry, current, atCommit)");
  for (const [name, entry, current, atCommit, expected, opts] of VERDICTS) {
    const got = classify(entry, current, atCommit, { salt: SALT, ...opts });
    check(`${name.padEnd(52)} -> ${expected.status}`, got, expected);
  }

  console.log("\nclaims and statements");
  const CLAIM = "The fetch timeout is 10 seconds.";
  // The claim is matched verbatim, whitespace aside: "10 seconds." is not
  // "10 seconds," so the body carries the sentence as the entry spells it.
  const page = `# Limits\n\nThe fetch timeout is 10 seconds. It is\nnot configurable.\n\nRetries default to 3.\n`;
  check("claim found in a paragraph", findClaim(page, CLAIM), { count: 1, lines: [3] });
  check("claim missing", findClaim(page, "The fetch timeout is 9 seconds."), { count: 0, lines: [] });
  check("punctuation is not whitespace: a comma for a full stop is a miss",
    findClaim("The fetch timeout is 10 seconds, and it is\nnot configurable.\n", CLAIM), { count: 0, lines: [] });
  check("soft-wrapped claim found across two lines",
    findClaim(page, "The fetch timeout is 10 seconds. It is not configurable."), { count: 1, lines: [3] });

  const twice = `Retries default to 3.\n\nSome other text.\n\n<!-- cite retries -->\nRetries default to 3. Really.\n`;
  check("ambiguous claim, unresolved", findClaim(twice, "Retries default to 3."), { count: 2, lines: [1, 6] });
  const refs = parseStatements(twice, "markdown");
  check("reference statement parsed", refs, [
    { line: 5, anchorLine: 6, payload: { kind: "ref", id: "retries" }, raw: "<!-- cite retries -->" },
  ]);
  const anchored = findClaim(twice, "Retries default to 3.").lines.filter((l) => l === refs[0].anchorLine);
  check("ambiguous claim resolved by the reference statement", anchored, [6]);

  const ids = new Set(["fetch-timeout"]);
  const orphan = parseStatements("<!-- cite nope -->\nSome claim.\n", "markdown")[0];
  check("orphan: reference names no frontmatter id", ids.has(orphan.payload.id), false);

  const quoted = `<!-- cite ${JSON.stringify({ src: "src/limits.ts:1-3", integrity: PIN_1_3, quote: true })} -->\n\`\`\`ts\n${L[0]}\n${L[1].replace("10_000", "30_000")}\n${L[2]}\n\`\`\`\n`;
  const st = parseStatements(quoted, "markdown")[0];
  const block = fencedBlockAfter(quoted, st.line);
  check("quote-drift: the fenced block no longer reproduces the range", mint(block.text) === st.payload.entry.integrity, false);
  const quotedOk = quoted.replace("30_000", "10_000");
  const blockOk = fencedBlockAfter(quotedOk, 1);
  check("quote holds when the block matches", mint(blockOk.text) === PIN_1_3, true);

  check("`cite true` is a reference to id `true`, never json",
    parseStatements("<!-- cite true -->\nx\n", "markdown")[0].payload, { kind: "ref", id: "true" });
  check("json payload in the html comment form",
    parseStatements(`<!-- cite {"src":"a:1","integrity":"${PIN_L2}"} -->\nx\n`, "markdown")[0].payload,
    { kind: "entry", entry: { src: "a:1", integrity: PIN_L2 } });
  check("mdx expression form {/* */}",
    parseStatements("{/* cite fetch-timeout */}\nx\n", "mdx")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("markdown link-reference form [comment]: # ( )",
    parseStatements("[comment]: # (cite fetch-timeout)\nx\n", "markdown")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("json is not allowed in the [comment] form",
    parseStatements('[comment]: # (cite {"src":"a:1"})\nx\n', "markdown")[0].payload,
    { kind: "bad", reason: "json payload not allowed in this form" });
  check("asciidoc form // ( )",
    parseStatements("// (cite fetch-timeout)\nx\n", "asciidoc")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("rst form .. ( )",
    parseStatements(".. (cite fetch-timeout)\nx\n", "rst")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("html comment form in html",
    parseStatements("<p>x</p>\n<!-- cite fetch-timeout -->\n<p>The claim.</p>\n", "html")[0],
    { line: 2, anchorLine: 3, payload: { kind: "ref", id: "fetch-timeout" }, raw: "<!-- cite fetch-timeout -->" });
  check("same-line anchor",
    parseStatements("<!-- cite fetch-timeout --> The claim.\n", "markdown")[0].anchorLine, 1);
  check("a comment that is not a statement is ignored",
    parseStatements("<!-- citeable -->\n<!-- todo -->\nx\n", "markdown"), []);
  check("malformed json is statement-invalid",
    parseStatements("<!-- cite {src: nope} -->\nx\n", "markdown")[0].payload, { kind: "bad", reason: "malformed json" });
  check("a payload that is neither id nor json is statement-invalid",
    parseStatements("<!-- cite Fetch Timeout -->\nx\n", "markdown")[0].payload,
    { kind: "bad", reason: "payload is neither an id nor json" });

  console.log(bad ? `\n${bad} UNEXPECTED` : "\nall verdicts held");
  process.exit(bad ? 1 : 0);
}

module.exports = {
  SOURCE,
  variants,
  normalize,
  lines,
  mint,
  obfuscate,
  parseSrc,
  formatSrc,
  classify,
  parseStatements,
  findClaim,
  fencedBlockAfter,
  VERDICTS,
};

if (require.main === module) run();
