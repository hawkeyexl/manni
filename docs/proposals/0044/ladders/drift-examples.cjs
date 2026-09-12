// The drift-check contract of proposal 0044, as a self-contained reference
// implementation: the hashing rule, the encryption rule, the source-end
// classifier, the claim end, the marker scanner and the anchor rules, each
// run against a fixed source file, a fixed page and their variants. No src/
// import and no schema: this ladder is what the implementation in src/cite/
// must agree with, not the other way round. Run from anywhere; exit 0 means
// every golden hash and every verdict held. Several files under test/cite/
// import the fixtures from here.
//
// What the citation redesign changed, and what this ladder therefore models:
//
//   - An entry is two blocks. `claim` is `{ lines, integrity }` over the page
//     and `source` is `{ file, lines, integrity, commit-sha }` over the file.
//     The flat `src:`/`integrity:` pair, the sentence-valued `claim:`, the
//     entry-level `commit:` and the page-level `citation-commit:` are gone.
//   - Claim lines are BODY-relative: body line 1 is the first line after the
//     closing frontmatter fence, or file line 1 on a page with no
//     frontmatter. So editing the frontmatter never moves a claim. Every line
//     a person reads is a file line, and `claimEnd` carries both.
//   - The body carries a MARKER, `cite <id>`, and nothing else. An inline
//     JSON entry is `marker-invalid`: an entry lives in frontmatter or a
//     manifest, and a source is never written into the body.
//   - An encrypted source is pinned `hmac-sha256-`; a plain one `sha256-`.
//     Any other pairing is `entry-invalid`.
//   - Rules are named per end: `source-moved`, `claim-changed` and the rest
//     of the fourteen below. `moved`, `changed`, `missing`, `never-true` and
//     `moved-ambiguous` survive only as per-end STATUSES, which is what the
//     classifier returns.
//
// One thing here is deliberately not the entry shape. `VERDICTS` spells a
// source as one string, `path:L1-L2`, the way the command line takes it and
// every report prints it, because a row of that table is an input to the
// source-end classifier rather than a document anybody writes.
// `test/cite/classify.test.ts` translates each row into an entry before
// replaying it, and `citationOf` below is the same translation, asserted
// against the entry shape in `run()`.
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
// rewrote the source lines to 4 for the move and the value then changed.
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
// mint(text, 1, 3, key) keyed: the pin below, an HMAC under a key derived from
// the encryption key. The keyed form is what an encrypted `source.file`
// carries, and only an encrypted one.
function mint(text, l1, l2, key) {
  const all = lines(text);
  let picked;
  if (l1 === undefined) picked = all;
  else {
    const end = l2 === undefined ? l1 : l2;
    if (end > all.length) return undefined; // range beyond EOF: nothing to pin
    picked = all.slice(l1 - 1, end);
  }
  const body = picked.join("\n");
  return key === undefined ? "sha256-" + sha256(body) : pin(body, key);
}

/** The pin of a 1-based inclusive line span of an already-split text. */
function pinOfLines(all, span, key) {
  if (span === undefined || span.start < 1 || span.end > all.length) return undefined;
  const body = all.slice(span.start - 1, span.end).join("\n");
  return key === undefined ? "sha256-" + sha256(body) : pin(body, key);
}

// ---------------------------------------------------------------------------
// The encryption rule (proposal 0045), the family's one ciphertext format.
// `source.file` is a value encrypted like any other, in the `cite-src`
// context; `source.lines` stays readable beside it.
//
// Three subkeys come from the configured key with HKDF-SHA256 and an empty
// salt, labelled manni/v1/encrypt, manni/v1/nonce and manni/v1/pin. The
// plaintext is the JSON padded with 0x80 then 0x00 to the next multiple of 32
// (always at least one pad byte). The nonce is the first 12 bytes of
// HMAC(nonce key, context || 0x00 || padded), so equal plaintexts give equal
// ciphertexts. AES-256-GCM seals the padded text with associated data
// 0x01 || context. The token is `~` and unpadded base64url of
// 0x01 || nonce || ciphertext || 16-byte tag: 82 characters at the shortest.
// ---------------------------------------------------------------------------

function subkey(key, label) {
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(key, "utf8"), Buffer.alloc(0), label, 32));
}

function pad(data) {
  const out = Buffer.alloc((Math.floor(data.length / 32) + 1) * 32);
  data.copy(out);
  out[data.length] = 0x80;
  return out;
}

function nonceOf(key, ctx, padded) {
  return crypto
    .createHmac("sha256", subkey(key, "manni/v1/nonce"))
    .update(ctx)
    .update(Buffer.from([0x00]))
    .update(padded)
    .digest()
    .subarray(0, 12);
}

function encrypt(value, key, context = "cite-src") {
  const ctx = Buffer.from(context, "utf8");
  const padded = pad(Buffer.from(JSON.stringify(value), "utf8"));
  const nonce = nonceOf(key, ctx, padded);
  const cipher = crypto.createCipheriv("aes-256-gcm", subkey(key, "manni/v1/encrypt"), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.concat([Buffer.from([0x01]), ctx]));
  const sealed = Buffer.concat([cipher.update(padded), cipher.final()]);
  const bytes = Buffer.concat([Buffer.from([0x01]), nonce, sealed, cipher.getAuthTag()]);
  return "~" + bytes.toString("base64url");
}

// The value, or undefined when the token is not ours under this key: a bad
// tag, a nonce that is not the HMAC of what it seals, or padding that is not
// exactly what `pad` writes.
function decrypt(token, key, context = "cite-src") {
  if (!/^~[A-Za-z0-9_-]{82,}$/.test(token)) return undefined;
  const bytes = Buffer.from(token.slice(1), "base64url");
  if (bytes.toString("base64url") !== token.slice(1) || bytes[0] !== 0x01) return undefined;
  if (bytes.length < 61 || (bytes.length - 29) % 32 !== 0) return undefined;
  const ctx = Buffer.from(context, "utf8");
  const nonce = bytes.subarray(1, 13);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", subkey(key, "manni/v1/encrypt"), nonce, { authTagLength: 16 });
    decipher.setAAD(Buffer.concat([Buffer.from([0x01]), ctx]));
    decipher.setAuthTag(bytes.subarray(bytes.length - 16));
    const padded = Buffer.concat([decipher.update(bytes.subarray(13, bytes.length - 16)), decipher.final()]);
    if (!nonceOf(key, ctx, padded).equals(nonce)) return undefined;
    let end = padded.length - 1;
    while (end >= 0 && padded[end] === 0) end--;
    if (end < 0 || padded[end] !== 0x80 || padded.length !== (Math.floor(end / 32) + 1) * 32) return undefined;
    return JSON.parse(padded.subarray(0, end).toString("utf8"));
  } catch {
    return undefined;
  }
}

// The keyed pin: `hmac-sha256-` and the hex HMAC-SHA256 of the text under the
// pin subkey, so a public page carries no verifier a reader could run against
// a guessed private line. The prefix says it is an HMAC, so hashing the line
// by hand and getting a different value has a reason on the page.
function pin(text, key) {
  return "hmac-sha256-" + crypto.createHmac("sha256", subkey(key, "manni/v1/pin")).update(text, "utf8").digest("hex");
}

/** `~` and at least 82 base64url characters: an encrypted value, by shape alone. */
function isEncryptedValue(value) {
  return typeof value === "string" && /^~[A-Za-z0-9_-]{82,}$/.test(value);
}

/** Whether a pin says an HMAC produced it. */
function isKeyedPin(integrity) {
  return integrity.startsWith("hmac-sha256-");
}

// ---------------------------------------------------------------------------
// The source grammar. An entry keeps `file` and `lines` apart; the command
// line and every report spell the pair as one string.
// ---------------------------------------------------------------------------

function parseSrc(src) {
  const m = /^(.*?)(?::([1-9][0-9]*)(?:-([1-9][0-9]*))?)?$/.exec(src);
  const path = m[1];
  const start = m[2] === undefined ? undefined : Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  return { path, encrypted: path.startsWith("~"), start, end };
}

function formatSrc(path, start, end) {
  if (start === undefined) return path;
  return end === undefined || end === start ? `${path}:${start}` : `${path}:${start}-${end}`;
}

/** Lines as an entry writes them: the integer for one line, `"L1-L2"` otherwise. */
function lineSpec(span) {
  return span.start === span.end ? span.start : `${span.start}-${span.end}`;
}

/** Lines as a report spells them: `"9"` or `"9-12"`. */
function spellLines(span) {
  return String(lineSpec(span));
}

/**
 * The lines an entry's `lines` names, or undefined when it is neither a
 * positive integer nor `"L1-L2"` with `L1 <= L2`. The schema refuses the
 * first; the second is `entry-invalid`, because a pattern cannot compare two
 * numbers.
 */
function parseLines(spec) {
  if (spec === undefined) return undefined;
  if (typeof spec === "number") {
    return Number.isInteger(spec) && spec >= 1 ? { start: spec, end: spec } : undefined;
  }
  const m = /^([1-9][0-9]*)(?:-([1-9][0-9]*))?$/.exec(spec);
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  return end < start ? undefined : { start, end };
}

/** An entry's `source` spelled as one string, the way a report prints it. */
function spellSource(source) {
  const span = parseLines(source.lines);
  return span === undefined ? source.file : formatSrc(source.file, span.start, span.end);
}

/**
 * A `VERDICTS` row as an entry writes it: `source.file`, `source.lines` and
 * `source.commit-sha`, with the claim and quote passed through. This is the
 * only translation between the ladder's compact source spelling and the
 * two-block entry, and `test/cite/classify.test.ts` performs the same one.
 */
function citationOf(entry) {
  const { path, start, end } = parseSrc(entry.src);
  const source = { file: path, integrity: entry.integrity };
  if (start !== undefined) source.lines = lineSpec({ start, end });
  if (entry.commit !== undefined) source["commit-sha"] = entry.commit;
  const citation = { source };
  if (entry.id !== undefined) citation.id = entry.id;
  if (entry.claim !== undefined) citation.claim = entry.claim;
  if (entry.quote !== undefined) citation.quote = entry.quote;
  return citation;
}

// ---------------------------------------------------------------------------
// Rules. Fourteen of them, each named for the end it is about, with the
// severity a run uses unless `cite.severity:` says otherwise. `current` and
// `skipped` are statuses, per end, so they are not rules and `severity:` does
// not take them.
// ---------------------------------------------------------------------------

const RULES = {
  "source-moved": "warning",
  "source-moved-ambiguous": "error",
  "source-changed": "error",
  "source-never-true": "error",
  "source-missing": "error",
  "claim-moved": "notice",
  "claim-moved-ambiguous": "warning",
  "claim-changed": "warning",
  "marker-orphan": "error",
  "marker-invalid": "error",
  "marker-repeated": "warning",
  "anchor-invalid": "error",
  "entry-invalid": "error",
  "quote-drift": "error",
};

/** Names the redesign retired: a bare status, or a rule about a thing that is gone. */
const RETIRED_RULES = [
  "moved",
  "moved-ambiguous",
  "changed",
  "missing",
  "never-true",
  "claim-ambiguous",
  "claim-missing",
  "statement-orphan",
  "statement-invalid",
];

/** The rule an end's status reports under, or undefined when it is not a finding. */
function ruleFor(end, status) {
  if (status === "current" || status === "skipped") return undefined;
  return `${end}-${status}`;
}

/** `manni:cite/<rule>`: the SARIF rule id and the JUnit failure type. */
function ruleId(rule) {
  return `manni:cite/${rule}`;
}

// ---------------------------------------------------------------------------
// The source-end classifier. `current` is the file's text now, or null when
// no tracked file matches. `atCommit` is the file's text at the entry's
// `commit-sha`, null when the path was absent at that commit, "unavailable"
// when the commit is unknown to git (a shallow clone), or undefined when the
// entry records no commit.
//
// It is given a row of `VERDICTS`, so it reads the compact source spelling;
// `classifyEntry` below takes a two-block entry and produces the same verdict.
// ---------------------------------------------------------------------------

function classify(entry, current, atCommit, opts = {}) {
  const { path, encrypted, start, end } = parseSrc(entry.src);
  const key = encrypted ? opts.key : undefined;
  const pinOf = (text, a, b) => mint(text, a, b, key);

  // An encrypted source names a file only under the key it was encrypted
  // with. No key, or another one, and there is no file to read.
  if (encrypted && (key === undefined || typeof decrypt(path, key) !== "string")) return { status: "missing" };
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
  // Not at the recorded lines. `update` rewrites the source lines for a move
  // and keeps `commit-sha`, so the lines the pin was minted from may sit
  // elsewhere in the file as it was then. Only a pin found nowhere there
  // never held; a whole-file pin has nowhere else to be.
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

/** The same classification, from the two-block entry rather than the compact row. */
function classifyEntry(citation, current, atCommit, opts = {}) {
  const row = { src: spellSource(citation.source), integrity: citation.source.integrity };
  if (citation.source["commit-sha"] !== undefined) row.commit = citation.source["commit-sha"];
  return classify(row, current, atCommit, opts);
}

/** The source end's message, per status, as the pretty reporter composes it. */
function sourceMessage(source) {
  const at = source.commitSha === undefined ? undefined : source.commitSha.slice(0, 7);
  const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  switch (source.status) {
    case "current":
      return "current";
    case "skipped":
      return "skipped";
    case "moved":
      return `moved -> ${source.newSrc}`;
    case "moved-ambiguous":
      return `moved, ${plural(source.candidates.length, "candidate")} (${source.candidates.join(", ")}); widen the range`;
    case "changed":
      if (at === undefined) return "changed";
      if (source.historyAvailable === false) {
        return `changed (history unavailable: commit ${at} not found; fetch-depth: 0)`;
      }
      if (source.commitsSince === undefined) return `changed since ${at}`;
      return `changed since ${at}, ${plural(source.commitsSince.length, "commit")}`;
    case "never-true":
      return at === undefined
        ? "never true: the pin does not match at the recorded commit"
        : `never true: the pin does not match at ${at}`;
    case "missing":
      return missingMessage(source);
  }
}

/**
 * Why a source is missing, in words that never name the path: a plain path
 * names its own file, so the bare status says the rest.
 */
function missingMessage(source) {
  if (!parseSrc(source.src ?? "").encrypted) return "missing";
  switch (source.missingReason) {
    case "no-key":
      return "missing (no encryption key is available to decrypt it)";
    case "undecryptable":
      return "missing (does not decrypt under the current key)";
    case "untracked":
      return "missing (no tracked file matches; wrong --root?)";
    default:
      return "missing";
  }
}

// ---------------------------------------------------------------------------
// Pages. A page is frontmatter and a body, and the two are numbered
// differently: a claim's `lines` are body-relative, everything a person reads
// is a file line.
// ---------------------------------------------------------------------------

const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** 1-based line of a file offset. */
function lineAt(content, offset) {
  let n = 1;
  for (let i = 0; i < Math.min(offset, content.length); i++) {
    if (content.charCodeAt(i) === 10) n++;
  }
  return n;
}

/** Offset of the first character of a 1-based line. */
function offsetOfLine(content, line) {
  let pos = 0;
  for (let n = 1; n < line; n++) {
    const nl = content.indexOf("\n", pos);
    if (nl === -1) return content.length;
    pos = nl + 1;
  }
  return pos;
}

function lineEnd(content, pos) {
  const nl = content.indexOf("\n", pos);
  return nl === -1 ? content.length : nl;
}

function lineTextAt(content, pos, end) {
  const text = content.slice(pos, end);
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

/**
 * A page read for citations: where its body starts, in offsets and in file
 * lines. Body line 1 is the first line after the closing frontmatter fence,
 * or file line 1 on a page with no frontmatter.
 */
function readPage(content, format = "markdown") {
  const m = FRONTMATTER.exec(content);
  const bodyOffset = m === null ? 0 : m[0].length;
  const bodyLine = bodyOffset === 0 ? 1 : lineAt(content, bodyOffset);
  return { content, format, bodyOffset, bodyLine, body: content.slice(bodyOffset) };
}

/** Body lines as file lines, and back. */
function toFileLines(span, bodyLine) {
  return { start: bodyLine + span.start - 1, end: bodyLine + span.end - 1 };
}
function toBodyLines(span, bodyLine) {
  return { start: span.start - bodyLine + 1, end: span.end - bodyLine + 1 };
}

// ---------------------------------------------------------------------------
// Markers: `cite <id>` in the format's comment syntax, and nothing else.
//
// | Format        | Forms                                                       |
// |---------------|-------------------------------------------------------------|
// | markdown, mdx | `<!-- cite … -->`, `{/* cite … */}`, `[comment]: # (cite …)` |
// | html, xml     | `<!-- cite … -->`                                           |
// | asciidoc      | `// (cite …)`                                               |
// | rst           | `.. (cite …)`                                               |
//
// A payload starting with `{` was the inline entry of proposal 0044's first
// draft. It is `marker-invalid` now, in every form, with one message: an
// entry lives in frontmatter or a manifest, and a source is never written
// into the body. An opener inside a fenced block is skipped, so a page that
// documents the syntax carries no markers. (src/cite/core/statements.ts skips
// inline backtick spans too; only the fences are modelled here.)
// ---------------------------------------------------------------------------

const FORMS = {
  markdown: [["<!--", "-->"], ["{/*", "*/}"], ["[comment]: # (", ")"]],
  mdx: [["{/*", "*/}"], ["<!--", "-->"], ["[comment]: # (", ")"]],
  html: [["<!--", "-->"]],
  xml: [["<!--", "-->"]],
  asciidoc: [["// (", ")"]],
  rst: [[".. (", ")"]],
};

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** Any family's fence opener, for the anchor and claim machinery, which has no format. */
const ANY_FENCE = /^(?:[ \t]*(?:`{3,}|~{3,})|-{4,})/;
/** The fence opener a format's own locator recognises, at column 0. */
const FENCE_OF = { markdown: /^(`{3,}|~{3,})/, mdx: /^(`{3,}|~{3,})/, asciidoc: /^(-{4,})/ };
/** The fence opener the code skip recognises: indented too, as inside a list item. */
const SKIP_FENCE_OF = { markdown: /^[ \t]*(`{3,}|~{3,})/, mdx: /^[ \t]*(`{3,}|~{3,})/, asciidoc: /^(-{4,})/ };

/** At most this many markers are read on one page. */
const MAX_MARKERS_PER_PAGE = 500;

/** What a marker with a JSON payload is told, since an entry never lives in the body. */
const MARKER_JSON = "A marker names an entry by id. Write the entry in frontmatter or the sidecar.";

/** The fenced stretches of a body, as offsets; an unclosed fence runs to the end. */
function codeRegions(body, format) {
  const fence = SKIP_FENCE_OF[format];
  const out = [];
  if (fence === undefined) return out;
  let open;
  let pos = 0;
  while (pos < body.length) {
    const end = lineEnd(body, pos);
    const text = lineTextAt(body, pos, end);
    if (open !== undefined) {
      const trimmed = text.trim();
      let n = 0;
      while (trimmed.charAt(n) === open.char) n++;
      if (n >= open.length && n === trimmed.length) {
        out.push({ start: open.start, end });
        open = undefined;
      }
    } else {
      const opener = fence.exec(text)?.[1];
      if (opener !== undefined) open = { char: opener.charAt(0), length: opener.length, start: pos };
    }
    pos = end + 1;
  }
  if (open !== undefined) out.push({ start: open.start, end: body.length });
  return out;
}

function payloadOf(payload) {
  if (payload === "") return { kind: "bad", reason: "empty payload" };
  // An entry lives in frontmatter or a manifest; the body carries a name.
  if (payload.startsWith("{")) return { kind: "bad", reason: "a JSON payload", json: true };
  if (ID.test(payload)) return { kind: "ref", id: payload };
  return { kind: "bad", reason: "payload is not an id" };
}

/**
 * Scan a body for markers. `from` maps body offsets and lines to file ones,
 * so a marker's `line` and `anchorLine` are file lines however deep the
 * frontmatter is.
 */
function parseStatements(body, format, from = { offset: 0, line: 1 }) {
  const table = FORMS[format];
  if (!table) throw new Error(`no marker syntax for format "${format}"`);
  const code = codeRegions(body, format);
  const codeEndAt = (at) => code.find((r) => at >= r.start && at < r.end)?.end;
  const out = [];
  for (const [open, close] of table) {
    let cursor = 0;
    for (;;) {
      const at = body.indexOf(open, cursor);
      if (at === -1) break;
      const codeEnd = codeEndAt(at);
      if (codeEnd !== undefined) {
        cursor = codeEnd;
        continue;
      }
      const closeAt = body.indexOf(close, at + open.length);
      if (closeAt === -1) break;
      const end = closeAt + close.length;
      cursor = end;
      const inner = body.slice(at + open.length, closeAt).trim();
      if (!(inner === "cite" || (inner.startsWith("cite") && /\s/.test(inner.charAt(4))))) continue;
      const unit = anchoredLines(body, end, format);
      const statement = {
        line: from.line + lineAt(body, at) - 1,
        payload: payloadOf(inner.slice(4).trim()),
        raw: inner,
        start: from.offset + at,
        end: from.offset + end,
      };
      if (unit !== undefined) statement.anchorLine = from.line + unit.start - 1;
      out.push(statement);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The paragraph at or after `offset`, as 1-based lines of `text`. A fence ends the search. */
function paragraphAfter(text, offset) {
  let pos = offset;
  const firstEnd = lineEnd(text, pos);
  if (lineTextAt(text, pos, firstEnd).trim() === "") pos = firstEnd + 1;
  while (pos < text.length) {
    const end = lineEnd(text, pos);
    const body = lineTextAt(text, pos, end);
    if (body.trim() === "") {
      pos = end + 1;
      continue;
    }
    if (ANY_FENCE.test(body)) return undefined;
    const start = lineAt(text, pos);
    let last = start;
    let cursor = end + 1;
    while (cursor < text.length) {
      const e = lineEnd(text, cursor);
      const t = lineTextAt(text, cursor, e);
      if (t.trim() === "" || ANY_FENCE.test(t)) break;
      last = lineAt(text, cursor);
      cursor = e + 1;
    }
    return { start, end: last };
  }
  return undefined;
}

/** The fenced block opening on `line`, fences included, or undefined when it does not. */
function fenceSpanAt(text, line, format) {
  const fence = FENCE_OF[format];
  if (fence === undefined) return undefined;
  const pos = offsetOfLine(text, line);
  const opener = fence.exec(lineTextAt(text, pos, lineEnd(text, pos)))?.[1];
  if (opener === undefined) return undefined;
  let cursor = lineEnd(text, pos) + 1;
  while (cursor < text.length) {
    const e = lineEnd(text, cursor);
    if (lineTextAt(text, cursor, e).startsWith(opener)) return { start: line, end: lineAt(text, cursor) };
    cursor = e + 1;
  }
  return undefined;
}

/**
 * The fenced block at or after `offset`: the lines it spans, fences included,
 * and the text between them. Undefined when none closes.
 */
function fencedBlockAfter(text, offset, format = "markdown") {
  const fence = FENCE_OF[format];
  if (fence === undefined) return undefined;
  let pos = offset === 0 || text.charCodeAt(offset - 1) === 10 ? offset : lineEnd(text, offset) + 1;
  while (pos < text.length) {
    const end = lineEnd(text, pos);
    if (fence.test(lineTextAt(text, pos, end))) {
      const span = fenceSpanAt(text, lineAt(text, pos), format);
      if (span === undefined) return undefined;
      const all = lines(text);
      return { ...span, text: all.slice(span.start, span.end - 1).join("\n") + "\n" };
    }
    pos = end + 1;
  }
  return undefined;
}

/**
 * The lines a marker anchors: the rest of its own line when that carries
 * text, else the paragraph or fenced block that follows. With `quote`, the
 * next fenced block after it, wherever that is.
 */
function anchoredLines(text, after, format, quote = false) {
  if (quote) {
    const block = fencedBlockAfter(text, after, format);
    return block === undefined ? undefined : { start: block.start, end: block.end };
  }
  const restEnd = lineEnd(text, after);
  if (text.slice(after, restEnd).trim() !== "") {
    const line = lineAt(text, after);
    return { start: line, end: line };
  }
  const paragraph = paragraphAfter(text, after);
  if (paragraph !== undefined) return paragraph;
  // A fence where a paragraph would be: the block is what the marker anchors.
  let pos = after;
  while (pos < text.length) {
    const end = lineEnd(text, pos);
    if (lineTextAt(text, pos, end).trim() !== "") return fenceSpanAt(text, lineAt(text, pos), format);
    pos = end + 1;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The claim end. The same machinery as the source end, against the page as it
// is now, and the pin is always plain: the page is public, so there is
// nothing to hide.
//
// The pin holds at the recorded lines: `current`. A window of the same width
// hashes equal elsewhere in the body: `moved`, once, or `moved-ambiguous`.
// Nowhere: `changed`, the sentence was edited. A marker-anchored claim pins
// what the marker anchors, and the marker moves with its text, so it is
// `current` or `changed` and never `moved`.
// ---------------------------------------------------------------------------

/** 1-based starts, within `all`, of the windows of `width` lines that hash to `pin`. */
function findWindows(all, width, integrity) {
  const out = [];
  for (let s = 1; s + width - 1 <= all.length; s++) {
    if (pinOfLines(all, { start: s, end: s + width - 1 }) === integrity) out.push(s);
  }
  return out;
}

function claimEnd(page, entry) {
  const claim = entry.citation.claim;
  if (claim === undefined) return null;
  const marker = entry.marker;
  const all = lines(page.content);
  const body = page.bodyLine;

  if (claim.lines !== undefined) {
    const recorded = parseLines(claim.lines);
    // An unreadable range is `entry-invalid`, and that entry is never classified.
    if (recorded === undefined) return { status: "skipped" };
    const file = toFileLines(recorded, body);
    const end = { lines: spellLines(recorded), fileLines: spellLines(file), status: "changed" };
    // Lines and a marker both is `anchor-invalid`: neither anchor is judged.
    if (marker !== undefined) return { ...end, status: "skipped" };
    if (pinOfLines(all, file) === claim.integrity) return { ...end, status: "current" };

    const width = recorded.end - recorded.start + 1;
    const spans = findWindows(all.slice(body - 1), width, claim.integrity).map((start) => ({
      start,
      end: start + width - 1,
    }));
    if (spans.length === 1) {
      return {
        ...end,
        status: "moved",
        newLines: spellLines(spans[0]),
        newFileLines: spellLines(toFileLines(spans[0], body)),
      };
    }
    if (spans.length > 1) {
      return {
        ...end,
        status: "moved-ambiguous",
        candidates: spans.map(spellLines),
        candidateFileLines: spans.map((span) => spellLines(toFileLines(span, body))),
      };
    }
    return end;
  }

  if (marker !== undefined) {
    const unit = anchoredLines(page.content, marker.end, page.format, entry.citation.quote === true);
    if (unit === undefined) return { status: "changed" };
    const end = { fileLines: spellLines(unit), status: "changed" };
    if (pinOfLines(all, unit) === claim.integrity) return { ...end, status: "current" };
    return end;
  }

  // A claim pin with neither lines nor a marker anchors nothing at all.
  return { status: "changed" };
}

/** `line 9`, or `lines 9-10` when the claim covers several. */
function at(spec) {
  return String(spec).includes("-") ? `lines ${spec}` : `line ${spec}`;
}

/** `<id>: <text>`, or the text alone for an entry with no id. */
function named(id, text) {
  return id === undefined ? text : `${id}: ${text}`;
}

/** The claim end's message, per status, in file lines throughout. */
function claimMessage(id, claim, markerLine) {
  const where = claim.fileLines ?? (markerLine === undefined ? undefined : String(markerLine));
  switch (claim.status) {
    case "moved":
      return named(id, `the claim moved from ${at(where)} to ${at(claim.newFileLines)}.`);
    case "moved-ambiguous": {
      const all = claim.candidateFileLines;
      const list = all.length <= 1 ? all.join("") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
      return named(id, `the claim at ${at(where)} now appears at lines ${list}.`);
    }
    case "changed":
      return where === undefined
        ? named(id, "the claim has no lines and no marker names the entry, so its pin anchors nothing.")
        : named(id, `the claim at ${at(where)} has changed since it was pinned.`);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Page-side findings: the ones that need no source. An entry is resolved
// against the page's markers, then the anchor rules run.
// ---------------------------------------------------------------------------

/**
 * Resolve one page: validate what the schema cannot, attach each entry's
 * first marker, and make the marker and anchor findings. `citations` are
 * entries as they are written, from the frontmatter or from a manifest.
 */
function resolvePage(page, citations) {
  const findings = [];
  const entries = [];
  const byId = new Map();
  const ids = new Set();
  const markedAt = new Map();
  const push = (rule, message, line) => {
    const finding = { rule, ruleId: ruleId(rule), severity: RULES[rule], message };
    if (line !== undefined) finding.line = line;
    findings.push(finding);
  };

  citations.forEach((citation, index) => {
    // A range that ends before it starts: the schema cannot compare two
    // numbers, so the rule is kept here.
    const bad = ["claim", "source"].find((end) => {
      const spec = end === "claim" ? citation.claim?.lines : citation.source.lines;
      return spec !== undefined && parseLines(spec) === undefined;
    });
    if (bad !== undefined) {
      const spec = bad === "claim" ? citation.claim.lines : citation.source.lines;
      push("entry-invalid", named(citation.id, `${bad}.lines "${spec}" ends before it starts`));
      return;
    }
    // The pin's prefix says how it was taken, and only an encrypted source
    // carries a keyed one.
    const encrypted = isEncryptedValue(citation.source.file);
    if (encrypted !== isKeyedPin(citation.source.integrity)) {
      push(
        "entry-invalid",
        named(
          citation.id,
          encrypted
            ? "an encrypted source is pinned with hmac-sha256-, not sha256-."
            : "a plain source is pinned with sha256-, not hmac-sha256-.",
        ),
      );
      return;
    }
    const entry = { citation, index };
    entries.push(entry);
    if (citation.id !== undefined) {
      if (ids.has(citation.id)) push("entry-invalid", `duplicate id "${citation.id}"`);
      else {
        ids.add(citation.id);
        byId.set(citation.id, entry);
      }
    }
  });

  const statements = parseStatements(page.body, page.format, {
    offset: page.bodyOffset,
    line: page.bodyLine,
  });
  if (statements.length > MAX_MARKERS_PER_PAGE) {
    push(
      "marker-invalid",
      `more than ${MAX_MARKERS_PER_PAGE} markers on one page (${statements.length}); the rest are not read`,
      statements[MAX_MARKERS_PER_PAGE].line,
    );
  }
  for (const statement of statements.slice(0, MAX_MARKERS_PER_PAGE)) {
    const { payload } = statement;
    if (payload.kind === "bad") {
      push(
        "marker-invalid",
        payload.json === true ? MARKER_JSON : `invalid marker: ${payload.reason}`,
        statement.line,
      );
      continue;
    }
    const target = byId.get(payload.id);
    if (target === undefined) {
      push("marker-orphan", `no entry has id "${payload.id}"`, statement.line);
      continue;
    }
    const first = markedAt.get(target);
    if (first !== undefined) {
      push(
        "marker-repeated",
        `${payload.id} is named by markers at lines ${first} and ${statement.line}; the first anchors it.`,
        statement.line,
      );
      continue;
    }
    markedAt.set(target, statement.line);
    target.marker = statement;
  }

  // Anchors: exactly one way in, and a quote needs one of them.
  for (const entry of entries) {
    const { citation, marker } = entry;
    const hasLines = citation.claim?.lines !== undefined;
    if (hasLines && marker !== undefined) {
      // The finding sits on the marker, which is the half a reader can see.
      push(
        "anchor-invalid",
        `${citation.id ?? "the entry"} has claim lines and a marker. Keep one.`,
        marker.line,
      );
      continue;
    }
    if (citation.quote === true && !hasLines && marker === undefined) {
      push("anchor-invalid", named(citation.id, "quote needs a claim or a marker."));
    }
  }

  return { entries, statements, findings };
}

/** How a citation is anchored, and the page line it anchors to. */
function anchorOf(page, entry, claim) {
  const { citation, marker } = entry;
  const hasLines = citation.claim?.lines !== undefined;
  const out = { anchor: null };
  if (marker !== undefined) out.markerLine = marker.line;
  if (hasLines && marker !== undefined) return out;
  if (hasLines) {
    out.anchor = "claim";
    const spec = claim.newFileLines ?? claim.candidateFileLines?.[0] ?? claim.fileLines;
    if (spec !== undefined) out.anchorLine = parseLines(spec).start;
    return out;
  }
  if (marker !== undefined) {
    out.anchor = "marker";
    const unit = anchoredLines(page.content, marker.end, page.format, citation.quote === true);
    out.anchorLine = unit === undefined ? marker.line : unit.start;
  }
  return out;
}

/**
 * The quote check for one entry, page-side: where its block is, and whether
 * that is still a fenced block. `anchor-invalid` when it is not; `quote-drift`
 * when the block no longer reproduces the source, or a marker has no block at
 * all. `now` is the cited lines as the source reads them today.
 */
function quoteFindings(page, entry, result, now) {
  const { citation, marker } = entry;
  if (citation.quote !== true || result.anchor === null) return [];
  const all = lines(page.content);
  let block;
  if (result.anchor === "marker") {
    block = anchoredLines(page.content, marker.end, page.format, true);
    if (block === undefined) {
      return [
        {
          rule: "quote-drift",
          message: "quote: true, but no fenced block follows the marker",
          line: result.markerLine,
        },
      ];
    }
  } else {
    const spec = result.claim.newFileLines ?? result.claim.candidateFileLines?.[0] ?? result.claim.fileLines;
    if (spec === undefined) return [];
    const want = parseLines(spec);
    const span = fenceSpanAt(page.content, want.start, page.format);
    if (span === undefined || span.end !== want.end) {
      return [
        {
          rule: "anchor-invalid",
          message: named(
            citation.id,
            `the quote's claim lines ${spellLines(want)} are no longer a fenced block.`,
          ),
          line: want.start,
        },
      ];
    }
    block = span;
  }
  // The block is faithful when it reproduces the cited lines as pinned (which
  // survives a move and a missing source) or as they are now.
  const inside = all.slice(block.start, block.end - 1).join("\n");
  const key = isEncryptedValue(citation.source.file) ? entry.key : undefined;
  const minted = key === undefined ? "sha256-" + sha256(inside) : pin(inside, key);
  if (minted === citation.source.integrity || (now !== undefined && inside === now)) return [];
  return [
    {
      rule: "quote-drift",
      message: "quote: true, but the fenced block does not reproduce the cited lines",
      line: block.start,
    },
  ];
}

// ---------------------------------------------------------------------------
// Goldens and verdicts.
// ---------------------------------------------------------------------------

const COMMIT = "3f9c2a1e7b0d4c5a6f8e9d0b1a2c3d4e5f607182";
const PIN_L2 = mint(SOURCE, 2);
const PIN_1_3 = mint(SOURCE, 1, 3);
const PIN_WHOLE = mint(SOURCE);
// A fixed test key: at least 32 hex or base64url characters, like any
// configured one. Never a real key.
const KEY = "ladder-key-0123456789abcdef0123456789";
const TOKEN = encrypt("src/limits.ts", KEY);

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
  // `update` rewrote the source lines 2 -> 4 for the move and kept
  // `commit-sha`; line 4 then changed. The pinned bytes sat at line 2 at the
  // commit, so the pin was true then, and this is drift, not a pin that never
  // held.
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
  ["encrypted, keyed pin, right key", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, KEY) }, SOURCE, undefined,
    { status: "current" }],
  ["encrypted, keyed pin, moved", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, KEY) }, variants.MOVED, undefined,
    { status: "moved", newSrc: `${TOKEN}:4` }],
  ["encrypted, keyed pin, changed", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, KEY) }, variants.CHANGED, undefined,
    { status: "changed" }],
  ["encrypted, another key is missing, not a leak", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, KEY) }, SOURCE, undefined,
    { status: "missing" }, { key: "another-key-0123456789abcdef012345" }],
  ["encrypted, no key is missing", { src: `${TOKEN}:2`, integrity: mint(SOURCE, 2, 2, KEY) }, SOURCE, undefined,
    { status: "missing" }, { key: undefined }],
];

// ---------------------------------------------------------------------------
// Page fixtures. Every one carries twelve lines of frontmatter, so body line 1
// is file line 13 and the difference between the two numberings is visible in
// every message below.
// ---------------------------------------------------------------------------

/** Twelve lines: the opening fence, ten of frontmatter, the closing fence. */
const FRONT = [
  "---",
  "title: Limits",
  "citations:",
  "  - id: fetch-timeout",
  "    claim:",
  "      lines: 3",
  "      integrity: <claim pin>",
  "    source:",
  "      file: src/limits.ts",
  "      lines: 2",
  "      integrity: <source pin>",
  "---",
].join("\n") + "\n";

const CLAIM_TEXT = "The fetch timeout is 10 seconds.";
/** Body line 3, file line 15: the claim the fixtures below pin. */
const PAGE = FRONT + ["# Limits", "", CLAIM_TEXT, "", "Retries default to 3.", ""].join("\n");
const CLAIM_PIN = "sha256-" + sha256(CLAIM_TEXT);

const pages = {
  // One `tags:` line added to the frontmatter: every file line moved, no body
  // line did. This is what body-relative claim lines are for.
  FRONTMATTER_GREW: PAGE.replace("title: Limits\n", "title: Limits\ntags: [limits]\n"),
  // A paragraph inserted above the claim: body 3 -> 5, file 15 -> 17.
  CLAIM_MOVED: PAGE.replace("# Limits\n\n", "# Limits\n\nLimits are configured in one file.\n\n"),
  // The sentence edited.
  CLAIM_CHANGED: PAGE.replace(CLAIM_TEXT, "The fetch timeout is 30 seconds."),
  // The sentence moved and copied: two windows hash equal, neither at body 3.
  CLAIM_AMBIGUOUS: PAGE.replace(
    `# Limits\n\n${CLAIM_TEXT}\n`,
    `# Limits\n\nLimits are configured in one file.\n\n${CLAIM_TEXT}\n\nAlso:\n\n${CLAIM_TEXT}\n`,
  ),
  // A marker above the sentence, and no claim lines at all.
  MARKER: FRONT + ["# Limits", "", "<!-- cite fetch-timeout -->", CLAIM_TEXT, "", "Retries default to 3.", ""].join("\n"),
};
// The marker page with a paragraph pushed in above it: the marker moved with
// its text, so the claim it anchors is still current.
pages.MARKER_MOVED = pages.MARKER.replace("# Limits\n\n", "# Limits\n\nLimits are configured in one file.\n\n");
// ...and with the sentence edited under it: `claim-changed`.
pages.MARKER_CHANGED = pages.MARKER.replace(CLAIM_TEXT, "The fetch timeout is 30 seconds.");

/** A page whose body lines 2-6 (file 14-18) are prose where a quote's block should be. */
const UNFENCED = FRONT + [
  "# Limits",
  "The limits live in one file.",
  "MAX_FILES is 10_000.",
  "FETCH_TIMEOUT_MS is 10_000.",
  "RETRIES is 3.",
  "That is the lot.",
  "",
].join("\n");

/** The same block, fenced, reproducing src/limits.ts:1-3. */
const FENCED = FRONT + ["# Limits", "```ts", L[0], L[1], L[2], "```", ""].join("\n");
/** ...and with the block's middle line edited away from the source. */
const FENCED_DRIFTED = FENCED.replace(L[1], L[1].replace("10_000", "30_000"));
/** A marker above the fenced block, rather than claim lines. */
const FENCED_MARKER = FRONT + ["# Limits", "<!-- cite fetch-timeout -->", "```ts", L[0], L[1], L[2], "```", ""].join("\n");

function run() {
  // Golden hashes, from the plan, verified with node.
  assert.strictEqual(PIN_L2, "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f");
  assert.strictEqual(PIN_1_3, "sha256-d2981e71e50b9bd645ab30ad36aeb87dcb3c3268ff8d90ed3b021a45dfbed1d6");
  assert.strictEqual(PIN_WHOLE, "sha256-aebba92fe4cddf100cc781281d1f24ad7c234b6189413e2130d5fe71ed86e023");
  assert.strictEqual(mint(SOURCE, 1, 7), PIN_WHOLE, "1-N equals the whole file");
  assert.strictEqual(mint(variants.CRLF, 2), PIN_L2, "crlf line 2 equals plain line 2");
  assert.strictEqual(mint(variants.BOM, 1, 3), PIN_1_3, "a bom does not enter the hash");
  assert.notStrictEqual(mint(SOURCE, 2, 2, KEY), PIN_L2, "a keyed pin is not the plain one");
  assert.strictEqual(mint(SOURCE, 2, 2, KEY), mint(SOURCE, 2, 2, KEY), "a keyed pin is stable per key");
  assert.notStrictEqual(mint(SOURCE, 2, 2, "another-key-0123456789abcdef012345"), mint(SOURCE, 2, 2, KEY));
  assert.ok(isKeyedPin(mint(SOURCE, 2, 2, KEY)), "an encrypted source is pinned hmac-sha256-");
  assert.ok(!isKeyedPin(PIN_L2), "a plain source is pinned sha256-");
  // "src/limits.ts" is 15 bytes of JSON, one padded block: 61 bytes, 82 characters.
  assert.strictEqual(TOKEN.length, 83);
  assert.match(TOKEN, /^~[A-Za-z0-9_-]{82,}$/);
  assert.strictEqual(encrypt("src/limits.ts", KEY), TOKEN, "equal plaintexts give equal ciphertexts");
  assert.strictEqual(decrypt(TOKEN, KEY), "src/limits.ts", "the ciphertext decrypts to the path");
  assert.strictEqual(decrypt(TOKEN, "another-key-0123456789abcdef012345"), undefined, "and only under its key");
  assert.strictEqual(decrypt(TOKEN, KEY, "meta"), undefined, "and only in its context");
  assert.notStrictEqual(encrypt("src/limits.ts", "another-key-0123456789abcdef012345"), TOKEN);
  console.log("golden hashes");
  console.log(`  line 2    ${PIN_L2}`);
  console.log(`  lines 1-3 ${PIN_1_3}`);
  console.log(`  whole     ${PIN_WHOLE}  (= lines 1-7)`);
  console.log(`  claim     ${CLAIM_PIN}  ("${CLAIM_TEXT}")`);
  console.log(`  source    ${TOKEN}  (src/limits.ts, encrypted)`);

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

  console.log("\nthe entry: two blocks, and the one string a report prints");
  check("a line range becomes source.file plus source.lines, and commit-sha", citationOf(ENTRY), {
    source: {
      file: "src/limits.ts",
      integrity: PIN_L2,
      lines: 2,
      "commit-sha": COMMIT,
    },
    id: "fetch-timeout",
  });
  check("a range keeps the \"L1-L2\" string form", citationOf({ src: "src/limits.ts:1-3", integrity: PIN_1_3 }), {
    source: { file: "src/limits.ts", integrity: PIN_1_3, lines: "1-3" },
  });
  check("a whole-file pin writes no lines at all", citationOf({ src: "src/limits.ts", integrity: PIN_WHOLE }), {
    source: { file: "src/limits.ts", integrity: PIN_WHOLE },
  });
  check("an encrypted source keeps its lines readable beside the ciphertext",
    citationOf({ src: `${TOKEN}:1-3`, integrity: mint(SOURCE, 1, 3, KEY) }),
    { source: { file: TOKEN, integrity: mint(SOURCE, 1, 3, KEY), lines: "1-3" } });
  for (const src of ["src/limits.ts", "src/limits.ts:2", "src/limits.ts:1-3", TOKEN, `${TOKEN}:4-9`]) {
    check(`spellSource round-trips ${src.startsWith("~") ? "an encrypted source" : src}`,
      spellSource(citationOf({ src, integrity: PIN_L2 }).source), src);
  }

  console.log("\nrules: fourteen, named per end");
  check("the rule set is exactly the fourteen", Object.keys(RULES).length, 14);
  check("a moved source reports under source-moved", ruleFor("source", "moved"), "source-moved");
  check("a changed claim reports under claim-changed", ruleFor("claim", "changed"), "claim-changed");
  check("an ambiguous claim reports under claim-moved-ambiguous", ruleFor("claim", "moved-ambiguous"), "claim-moved-ambiguous");
  check("current is a status, not a finding", ruleFor("source", "current"), undefined);
  check("skipped is a status, not a finding", ruleFor("source", "skipped"), undefined);
  check("the retired names are not rules", RETIRED_RULES.filter((name) => name in RULES), []);
  check("severity: takes only rule names", ["current", "skipped"].filter((name) => name in RULES), []);
  check("the rule id is manni:cite/<rule>", ruleId("claim-changed"), "manni:cite/claim-changed");
  check("source-moved only warns, because update fixes it", RULES["source-moved"], "warning");
  check("claim-moved is a notice: the text is found verbatim", RULES["claim-moved"], "notice");

  console.log("\nverdicts: classify(entry, current, atCommit)");
  for (const [name, entry, current, atCommit, expected, opts] of VERDICTS) {
    const got = classify(entry, current, atCommit, { key: KEY, ...opts });
    check(`${name.padEnd(52)} -> ${expected.status}`, got, expected);
  }
  check("the same entry, classified from its two blocks",
    classifyEntry(citationOf(ENTRY), variants.MOVED, SOURCE, { key: KEY }),
    { status: "moved", newSrc: "src/limits.ts:4" });
  check("the source end's message names the new source",
    sourceMessage({ src: "src/limits.ts:2", status: "moved", newSrc: "src/limits.ts:4" }),
    "moved -> src/limits.ts:4");
  check("...and a changed one names the commit and how far back",
    sourceMessage({ src: "src/limits.ts:2", status: "changed", commitSha: COMMIT, historyAvailable: true, commitsSince: ["raise fetch timeout to 30s"] }),
    "changed since 3f9c2a1, 1 commit");
  check("...and an unreadable encrypted one never names a path",
    sourceMessage({ src: `${TOKEN}:2`, status: "missing", missingReason: "no-key" }),
    "missing (no encryption key is available to decrypt it)");

  console.log("\nclaims: body lines in the entry, file lines in every message");
  const claimOf = (content, citation, key) => {
    const page = readPage(content);
    const resolved = resolvePage(page, [citation]);
    const entry = resolved.entries[0];
    if (entry === undefined) return { page, resolved, entry, claim: null, anchor: { anchor: null } };
    if (key !== undefined) entry.key = key;
    const claim = claimEnd(page, entry);
    return { page, resolved, entry, claim, anchor: anchorOf(page, entry, claim) };
  };
  const PINNED = {
    id: "fetch-timeout",
    claim: { lines: 3, integrity: CLAIM_PIN },
    source: { file: "src/limits.ts", lines: 2, integrity: PIN_L2 },
  };

  check("body line 1 is the first line after the frontmatter", readPage(PAGE).bodyLine, 13);
  check("a page with no frontmatter starts at file line 1", readPage("# Limits\n").bodyLine, 1);
  check("the claim is current, and carries both numberings", claimOf(PAGE, PINNED).claim,
    { lines: "3", fileLines: "15", status: "current" });
  check("editing the frontmatter moves every file line and no body line",
    claimOf(pages.FRONTMATTER_GREW, PINNED).claim, { lines: "3", fileLines: "16", status: "current" });
  check("a paragraph above the claim moves it", claimOf(pages.CLAIM_MOVED, PINNED).claim,
    { lines: "3", fileLines: "15", status: "moved", newLines: "5", newFileLines: "17" });
  check("...and the message says so in file lines",
    claimMessage("fetch-timeout", claimOf(pages.CLAIM_MOVED, PINNED).claim),
    "fetch-timeout: the claim moved from line 15 to line 17.");
  check("the sentence edited is changed", claimOf(pages.CLAIM_CHANGED, PINNED).claim,
    { lines: "3", fileLines: "15", status: "changed" });
  check("...and the message says so in file lines",
    claimMessage("fetch-timeout", claimOf(pages.CLAIM_CHANGED, PINNED).claim),
    "fetch-timeout: the claim at line 15 has changed since it was pinned.");
  const ambiguous = claimOf(pages.CLAIM_AMBIGUOUS, PINNED).claim;
  check("the sentence in two places is ambiguous", ambiguous,
    { lines: "3", fileLines: "15", status: "moved-ambiguous", candidates: ["5", "9"], candidateFileLines: ["17", "21"] });
  check("...and the message lists every candidate", claimMessage("fetch-timeout", ambiguous),
    "fetch-timeout: the claim at line 15 now appears at lines 17 and 21.");
  const RANGE = {
    id: "fetch-timeout",
    claim: { lines: "3-5", integrity: pinOfLines(lines(PAGE), { start: 15, end: 17 }) },
    source: { file: "src/limits.ts", lines: 2, integrity: PIN_L2 },
  };
  check("a two-line claim is pinned over the range", claimOf(PAGE, RANGE).claim,
    { lines: "3-5", fileLines: "15-17", status: "current" });
  check("...and a changed one says lines, plural",
    claimMessage("fetch-timeout", { ...claimOf(PAGE, RANGE).claim, status: "changed" }),
    "fetch-timeout: the claim at lines 15-17 has changed since it was pinned.");
  check("an entry with no claim is a bare pin, and has no claim end",
    claimOf(PAGE, { source: { file: "src/limits.ts", integrity: PIN_WHOLE } }).claim, null);
  check("an entry whose claim range is reversed is entry-invalid",
    claimOf(PAGE, { ...PINNED, claim: { lines: "9-3", integrity: CLAIM_PIN } }).resolved.findings.map((f) => f.message),
    ['fetch-timeout: claim.lines "9-3" ends before it starts']);
  check("a plain source pinned hmac-sha256- is entry-invalid",
    claimOf(PAGE, { ...PINNED, source: { file: "src/limits.ts", lines: 2, integrity: pin("x", KEY) } }).resolved.findings.map((f) => f.message),
    ["fetch-timeout: a plain source is pinned with sha256-, not hmac-sha256-."]);
  check("an encrypted source pinned sha256- is entry-invalid",
    claimOf(PAGE, { ...PINNED, source: { file: TOKEN, lines: 2, integrity: PIN_L2 } }).resolved.findings.map((f) => f.message),
    ["fetch-timeout: an encrypted source is pinned with hmac-sha256-, not sha256-."]);
  check("...and an encrypted source pinned hmac-sha256- passes",
    claimOf(PAGE, { ...PINNED, source: { file: TOKEN, lines: 2, integrity: mint(SOURCE, 2, 2, KEY) } }).resolved.findings,
    []);
  check("two entries claiming one id is entry-invalid",
    (() => {
      const page = readPage(PAGE);
      return resolvePage(page, [PINNED, { ...PINNED, claim: undefined }]).findings.map((f) => f.message);
    })(),
    ['duplicate id "fetch-timeout"']);

  console.log("\nmarkers: an id, in the format's comment syntax");
  const MARKED = { id: "fetch-timeout", claim: { integrity: CLAIM_PIN }, source: PINNED.source };
  const marked = claimOf(pages.MARKER, MARKED);
  check("the marker anchors the line under it", marked.entry.marker.anchorLine, 16);
  check("a marker-anchored claim carries file lines and no body lines", marked.claim,
    { fileLines: "16", status: "current" });
  check("the anchor is the marker", marked.anchor, { anchor: "marker", markerLine: 15, anchorLine: 16 });
  check("a marker-anchored claim never moves: it travels with its text",
    claimOf(pages.MARKER_MOVED, MARKED).claim, { fileLines: "18", status: "current" });
  check("...but an edit under it is claim-changed",
    claimOf(pages.MARKER_CHANGED, MARKED).claim, { fileLines: "16", status: "changed" });
  check("...and the message names the marker's own lines",
    claimMessage("fetch-timeout", claimOf(pages.MARKER_CHANGED, MARKED).claim),
    "fetch-timeout: the claim at line 16 has changed since it was pinned.");
  check("a claim with neither lines nor a marker anchors nothing",
    claimOf(PAGE, MARKED).claim, { status: "changed" });
  check("...and says so rather than naming a line",
    claimMessage("fetch-timeout", claimOf(PAGE, MARKED).claim),
    "fetch-timeout: the claim has no lines and no marker names the entry, so its pin anchors nothing.");

  const markerPage = (body) => readPage(FRONT + body);
  const findingsOf = (body, citations = [PINNED]) => {
    const page = markerPage(body);
    return resolvePage(page, citations).findings.map((f) => ({ rule: f.rule, message: f.message, line: f.line }));
  };
  check("a marker naming no entry is marker-orphan",
    findingsOf("<!-- cite nope -->\nSome claim.\n", [{ ...PINNED, claim: undefined }]),
    [{ rule: "marker-orphan", message: 'no entry has id "nope"', line: 13 }]);
  check("a second marker for one entry is marker-repeated, and the first anchors it",
    findingsOf("<!-- cite retries -->\nRetries default to 3.\n\n<!-- cite retries -->\nAlso.\n",
      [{ id: "retries", source: PINNED.source }]),
    [{
      rule: "marker-repeated",
      message: "retries is named by markers at lines 13 and 16; the first anchors it.",
      line: 16,
    }]);
  check("a JSON payload is marker-invalid, and says where an entry lives",
    findingsOf(`<!-- cite {"source":{"file":"src/limits.ts"}} -->\nx\n`, [{ ...PINNED, claim: undefined }]),
    [{ rule: "marker-invalid", message: MARKER_JSON, line: 13 }]);
  check("...in every form, including the ones that never took JSON",
    findingsOf('[comment]: # (cite {"file":"a"})\nx\n', [{ ...PINNED, claim: undefined }]),
    [{ rule: "marker-invalid", message: MARKER_JSON, line: 13 }]);
  check("an empty payload is marker-invalid",
    findingsOf("<!-- cite -->\nx\n", [{ ...PINNED, claim: undefined }]),
    [{ rule: "marker-invalid", message: "invalid marker: empty payload", line: 13 }]);
  check("a payload that is not an id is marker-invalid",
    findingsOf("<!-- cite Fetch Timeout -->\nx\n", [{ ...PINNED, claim: undefined }]),
    [{ rule: "marker-invalid", message: "invalid marker: payload is not an id", line: 13 }]);
  check("`cite true` names the id `true`, and is never a JSON literal",
    parseStatements("<!-- cite true -->\nx\n", "markdown")[0].payload, { kind: "ref", id: "true" });
  check("mdx expression form {/* */}",
    parseStatements("{/* cite fetch-timeout */}\nx\n", "mdx")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("markdown link-reference form [comment]: # ( )",
    parseStatements("[comment]: # (cite fetch-timeout)\nx\n", "markdown")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("asciidoc form // ( )",
    parseStatements("// (cite fetch-timeout)\nx\n", "asciidoc")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("rst form .. ( )",
    parseStatements(".. (cite fetch-timeout)\nx\n", "rst")[0].payload, { kind: "ref", id: "fetch-timeout" });
  check("html comment form in html",
    parseStatements("<p>x</p>\n<!-- cite fetch-timeout -->\n<p>The claim.</p>\n", "html")[0],
    { line: 2, payload: { kind: "ref", id: "fetch-timeout" }, raw: "cite fetch-timeout", start: 9, end: 36, anchorLine: 3 });
  check("same-line anchor",
    parseStatements("<!-- cite fetch-timeout --> The claim.\n", "markdown")[0].anchorLine, 1);
  check("a comment that is not a marker is ignored",
    parseStatements("<!-- citeable -->\n<!-- todo -->\nx\n", "markdown"), []);
  check("a marker inside a fenced block is documentation, not a marker",
    parseStatements("```md\n<!-- cite fetch-timeout -->\n```\n", "markdown"), []);

  console.log("\nanchors: exactly one way in, and a quote needs one of them");
  const BOTH = { ...PINNED, claim: { lines: 4, integrity: CLAIM_PIN } };
  const both = claimOf(pages.MARKER, BOTH);
  check("claim lines and a marker: anchor-invalid, on the marker's line",
    both.resolved.findings.map((f) => ({ rule: f.rule, message: f.message, line: f.line })),
    [{ rule: "anchor-invalid", message: "fetch-timeout has claim lines and a marker. Keep one.", line: 15 }]);
  check("...and neither anchor is judged", both.claim,
    { lines: "4", fileLines: "16", status: "skipped" });
  check("...so the entry has no anchor at all", both.anchor, { anchor: null, markerLine: 15 });
  check("quote with no claim and no marker: anchor-invalid",
    claimOf(PAGE, { id: "fetch-timeout", source: PINNED.source, quote: true }).resolved.findings
      .map((f) => ({ rule: f.rule, message: f.message, line: f.line })),
    [{ rule: "anchor-invalid", message: "fetch-timeout: quote needs a claim or a marker.", line: undefined }]);
  const unfenced = claimOf(UNFENCED, {
    id: "fetch-timeout",
    claim: { lines: "2-6", integrity: pinOfLines(lines(UNFENCED), { start: 14, end: 18 }) },
    source: { file: "src/limits.ts", lines: "1-3", integrity: PIN_1_3 },
    quote: true,
  });
  check("a quote whose claim lines are no longer a fenced block: anchor-invalid",
    quoteFindings(unfenced.page, unfenced.entry, { ...unfenced.anchor, claim: unfenced.claim }, undefined),
    [{
      rule: "anchor-invalid",
      message: "fetch-timeout: the quote's claim lines 14-18 are no longer a fenced block.",
      line: 14,
    }]);
  check("those are the three reachable anchor-invalid cases; claim lines in the frontmatter is not one",
    toBodyLines({ start: 2, end: 2 }, readPage(PAGE).bodyLine).start < 1, true);

  console.log("\nquotes: the block reproduces the source, or it is quote-drift");
  const quoted = claimOf(FENCED, {
    id: "fetch-timeout",
    claim: { lines: "2-6", integrity: pinOfLines(lines(FENCED), { start: 14, end: 18 }) },
    source: { file: "src/limits.ts", lines: "1-3", integrity: PIN_1_3 },
    quote: true,
  });
  check("the claim lines are the fenced block, fences included", quoted.claim,
    { lines: "2-6", fileLines: "14-18", status: "current" });
  check("a block that reproduces the cited lines is no finding",
    quoteFindings(quoted.page, quoted.entry, { ...quoted.anchor, claim: quoted.claim }, undefined), []);
  const drifted = claimOf(FENCED_DRIFTED, {
    id: "fetch-timeout",
    claim: { lines: "2-6", integrity: pinOfLines(lines(FENCED_DRIFTED), { start: 14, end: 18 }) },
    source: { file: "src/limits.ts", lines: "1-3", integrity: PIN_1_3 },
    quote: true,
  });
  check("a block edited away from the source is quote-drift",
    quoteFindings(drifted.page, drifted.entry, { ...drifted.anchor, claim: drifted.claim }, undefined),
    [{
      rule: "quote-drift",
      message: "quote: true, but the fenced block does not reproduce the cited lines",
      line: 14,
    }]);
  check("...unless the source now reads exactly what the block shows",
    quoteFindings(drifted.page, drifted.entry, { ...drifted.anchor, claim: drifted.claim },
      lines(FENCED_DRIFTED).slice(14, 17).join("\n")),
    []);
  const quoteMarker = claimOf(FENCED_MARKER, {
    id: "fetch-timeout",
    claim: { integrity: pinOfLines(lines(FENCED_MARKER), { start: 15, end: 19 }) },
    source: { file: "src/limits.ts", lines: "1-3", integrity: PIN_1_3 },
    quote: true,
  });
  check("under a marker, the block is the next fence after it", quoteMarker.claim,
    { fileLines: "15-19", status: "current" });
  check("...and it is checked the same way",
    quoteFindings(quoteMarker.page, quoteMarker.entry, { ...quoteMarker.anchor, claim: quoteMarker.claim }, undefined), []);
  const noBlock = claimOf(pages.MARKER, {
    id: "fetch-timeout",
    claim: { integrity: CLAIM_PIN },
    source: { file: "src/limits.ts", lines: "1-3", integrity: PIN_1_3 },
    quote: true,
  });
  check("a marker with no fenced block under it is quote-drift",
    quoteFindings(noBlock.page, noBlock.entry, { ...noBlock.anchor, claim: noBlock.claim }, undefined),
    [{ rule: "quote-drift", message: "quote: true, but no fenced block follows the marker", line: 15 }]);

  console.log(bad ? `\n${bad} UNEXPECTED` : "\nall verdicts held");
  process.exit(bad ? 1 : 0);
}

module.exports = {
  SOURCE,
  variants,
  pages,
  normalize,
  lines,
  mint,
  pinOfLines,
  encrypt,
  decrypt,
  pin,
  isEncryptedValue,
  isKeyedPin,
  KEY,
  parseSrc,
  formatSrc,
  parseLines,
  spellLines,
  spellSource,
  citationOf,
  RULES,
  ruleFor,
  ruleId,
  classify,
  classifyEntry,
  sourceMessage,
  readPage,
  toFileLines,
  toBodyLines,
  MARKER_JSON,
  parseStatements,
  anchoredLines,
  fenceSpanAt,
  fencedBlockAfter,
  findWindows,
  claimEnd,
  claimMessage,
  resolvePage,
  anchorOf,
  quoteFindings,
  VERDICTS,
};

if (require.main === module) run();
