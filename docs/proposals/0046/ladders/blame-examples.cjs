// The derivation rule of proposal 0046, as a self-contained reference
// implementation: how `manni meta derive` turns `git blame --line-porcelain`
// into `provenance` entries, how a stamped record is compared with what blame
// says now, what `derive` writes back, and when a ranged `--generated-by` is
// refused. Every case runs over canned porcelain text and canned commits, so
// nothing here needs a repository. No src/ import and no schema: this ladder
// is what an implementation in src/meta/core/derive/ must agree with. Run from
// the repository root (picomatch and yaml are resolved from its node_modules);
// exit 0 means every golden hash and every verdict held.
//
// What the ladder models, section by section of the proposal:
//
//   - §1 An entry is `{ generated-by, lines, integrity }`. `lines` are BODY
//     lines, counted after the frontmatter as cite's claim lines are, and
//     `integrity` is cite's plain pin over those lines.
//   - §2 step 3, the five resolution rules, first match wins, per body line:
//       1. uncommitted (blame's zero sha) and --generated-by set;
//       2. the blamed commit's own blob carries a `provenance` stamp whose
//          range covers the line's number in that commit, in that commit's
//          body numbering, and whose integrity verifies against that blob;
//       3. the blamed commit carries a `Generated-by:` trailer;
//       4. the blamed commit carries a `Co-authored-by:` trailer whose name or
//          email matches a `derive.machines` glob (default `["*[bot]"]`);
//       5. no evidence.
//   - §2 step 4, contiguous body lines resolved to one machine are one entry.
//   - §2's comparison table: current, moved, changed, stale, unset, and the
//     "no evidence, pin matches" row that reads current. Duplicate text is
//     tied by the nearest `lines` (stress test 12).
//   - §2's write rule: keep current and moved (moved rewrites `lines`),
//     rewrite changed and stale, add unset, drop nothing uncontradicted.
//   - §3a and §3b: an uncommitted edit under --generated-by, and a named range
//     that attributes committed lines unless rules 2-4 name another machine.
//   - Stress tests 9 (a human edit inside an agent's range), 10 (a squash) and
//     12 (duplicate text) are cases E, D and G.
//
// Where the proposal left a choice open, the choice made here is marked
// RESOLVED in a comment beside the code that makes it.
const crypto = require("node:crypto");
const assert = require("node:assert");
const { createRequire } = require("node:module");

const requireFromRepo = createRequire(process.cwd() + "/");
const picomatch = requireFromRepo("picomatch");
const YAML = requireFromRepo("yaml");

// ---------------------------------------------------------------------------
// The hashing rule of manni:citations:1.0.0-proposal.3, identical to 0044's
// drift ladder: decode UTF-8, strip one BOM, CRLF -> LF, split on LF dropping
// the one empty element a trailing LF leaves, take L1..L2 (1-based,
// inclusive), join with LF and no trailing LF, keep trailing whitespace, and
// write `sha256-` and the lowercase hex digest.
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

/** The pin of a 1-based inclusive span of already-split lines, or undefined past the end. */
function pinOfLines(all, span) {
  if (span === undefined || span.start < 1 || span.end > all.length) return undefined;
  return "sha256-" + sha256(all.slice(span.start - 1, span.end).join("\n"));
}

// ---------------------------------------------------------------------------
// Body lines (§1). Body line 1 is the first line after the closing
// frontmatter fence, or file line 1 on a page with no frontmatter. So writing
// a stamp into the frontmatter never moves the pins it just wrote.
// ---------------------------------------------------------------------------

const FRONTMATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/**
 * A page read for provenance: every line, the file line body line 1 sits on,
 * the body's lines, and the parsed frontmatter (null when there is none).
 */
function readPage(content) {
  const text = normalize(content);
  const all = lines(text);
  const m = FRONTMATTER.exec(text);
  if (m === null) return { all, bodyLine: 1, body: all, front: null };
  // The body starts on the line after the frontmatter block: one line per
  // newline the block contains, plus one, plus one more when the closing fence
  // has no newline after it (the file ends at the fence).
  const newlines = m[0].split("\n").length - 1;
  const bodyLine = newlines + (m[0].endsWith("\n") ? 1 : 2);
  let front = null;
  try {
    front = YAML.parse(m[1]) ?? null;
  } catch {
    front = null;
  }
  return { all, bodyLine, body: all.slice(bodyLine - 1), front };
}

/** A file line as a body line, and back. A result below 1 is a frontmatter line. */
function toBodyLine(fileLine, bodyLine) {
  return fileLine - bodyLine + 1;
}
function toFileLine(bodyLineNo, bodyLine) {
  return bodyLineNo + bodyLine - 1;
}

/** Lines as an entry writes them: the integer for one line, `"L1-L2"` otherwise. */
function lineSpec(span) {
  return span.start === span.end ? span.start : `${span.start}-${span.end}`;
}

/** An entry's `lines`, or undefined when it is not `L` or `"L1-L2"` with L2 >= L1. */
function parseLines(spec) {
  if (typeof spec === "number") {
    return Number.isInteger(spec) && spec >= 1 ? { start: spec, end: spec } : undefined;
  }
  if (typeof spec !== "string") return undefined;
  const m = /^([1-9][0-9]*)(?:-([1-9][0-9]*))?$/.exec(spec);
  if (!m) return undefined;
  const start = Number(m[1]);
  const end = m[2] === undefined ? start : Number(m[2]);
  return end < start ? undefined : { start, end };
}

/** `<path>:L` / `<path>:L1-L2`, cite's parseSrc: the last `:L` wins, a drive letter is not a range. */
function parseSrc(src) {
  const m = /^(.*?)(?::([1-9][0-9]*)(?:-([1-9][0-9]*))?)?$/.exec(src);
  const start = m[2] === undefined ? undefined : Number(m[2]);
  const end = m[3] === undefined ? start : Number(m[3]);
  // RESOLVED: L2 >= L1 is the tool's rule. A reversed range keeps both numbers
  // so the caller can refuse it by name, instead of slicing an empty span and
  // minting a pin that matches nothing.
  return { path: m[1], start, end, reversed: start !== undefined && end < start };
}

/** The `provenance` entries a page's frontmatter carries, well-formed ones only. */
function stampOf(page) {
  const list = page.front === null ? undefined : page.front.provenance;
  if (!Array.isArray(list)) return [];
  // RESOLVED: an entry the schema would reject (no machine, unreadable lines,
  // a pin that is not sha256-) is not evidence and is not compared. The schema
  // finding speaks for it.
  return list.filter(
    (e) =>
      e !== null &&
      typeof e === "object" &&
      typeof e["generated-by"] === "string" &&
      e["generated-by"] !== "" &&
      parseLines(e.lines) !== undefined &&
      typeof e.integrity === "string" &&
      /^sha256-[0-9a-f]{64}$/.test(e.integrity),
  );
}

// ---------------------------------------------------------------------------
// `git blame --line-porcelain` (§2 step 2). Per final line: a header
// `<40-hex sha> <orig-line> <final-line>[ <group-count>]`, where the count
// appears on the first line of a group only; then `author`, `author-mail`,
// `author-time`, `author-tz`, `committer`, `committer-mail`, `committer-time`,
// `committer-tz`, `summary`, optionally `previous <sha> <path>` or
// `boundary`, then `filename`; then the line's content prefixed with one TAB.
// `--line-porcelain`, unlike `--porcelain`, repeats the full header on every
// line. An uncommitted line carries the zero sha and `Not Committed Yet`.
// ---------------------------------------------------------------------------

const ZERO_SHA = "0000000000000000000000000000000000000000";
const HEADER = /^([0-9a-f]{40}) ([1-9][0-9]*) ([1-9][0-9]*)(?: ([1-9][0-9]*))?$/;

function parsePorcelain(text) {
  const out = [];
  const rows = text.split("\n");
  if (rows.length && rows[rows.length - 1] === "") rows.pop();
  let i = 0;
  while (i < rows.length) {
    const m = HEADER.exec(rows[i]);
    if (m === null) throw new Error(`porcelain: expected a header at row ${i + 1}, got ${JSON.stringify(rows[i])}`);
    const record = { sha: m[1], origLine: Number(m[2]), finalLine: Number(m[3]), fields: {} };
    if (m[4] !== undefined) record.groupCount = Number(m[4]);
    i++;
    while (i < rows.length && !rows[i].startsWith("\t")) {
      const row = rows[i];
      const space = row.indexOf(" ");
      if (space === -1) record.fields[row] = true; // `boundary`
      else record.fields[row.slice(0, space)] = row.slice(space + 1);
      i++;
    }
    if (i >= rows.length) throw new Error(`porcelain: line ${record.finalLine} has no content row`);
    // Not `--porcelain`: that form omits the header after a group's first line.
    if (record.fields.author === undefined || record.fields.filename === undefined) {
      throw new Error(`porcelain: line ${record.finalLine} has no full header; run blame with --line-porcelain`);
    }
    record.content = rows[i].slice(1);
    record.uncommitted = record.sha === ZERO_SHA;
    out.push(record);
    i++;
  }
  return out;
}

/**
 * Canned porcelain for a working file. `segments` are `[sha, origStart,
 * count]` in final-line order and must cover every line. The generator
 * refuses a segment whose content is not what the commit's blob holds at the
 * orig lines, so a fixture cannot say something git would not.
 */
function porcelain(path, working, commits, segments) {
  const rawRows = working.split("\n");
  if (rawRows[rawRows.length - 1] === "") rawRows.pop();
  const out = [];
  let final = 0;
  for (const [sha, orig, count] of segments) {
    const commit = sha === ZERO_SHA ? undefined : commits[sha];
    if (sha !== ZERO_SHA && commit === undefined) throw new Error(`fixture: no commit ${sha}`);
    const blob = commit === undefined ? undefined : lines(commit.blob);
    for (let k = 0; k < count; k++) {
      final++;
      const raw = rawRows[final - 1];
      if (raw === undefined) throw new Error(`fixture: ${path} has no line ${final}`);
      const content = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (commit === undefined) {
        if (orig + k !== final) throw new Error(`fixture: uncommitted line ${final} must keep its number`);
      } else if (blob[orig + k - 1] !== content) {
        throw new Error(`fixture: ${sha.slice(0, 7)} line ${orig + k} is ${JSON.stringify(blob[orig + k - 1])}, not ${JSON.stringify(content)}`);
      }
      out.push(`${sha} ${orig + k} ${final}${k === 0 ? ` ${count}` : ""}`);
      if (commit === undefined) {
        out.push(
          "author Not Committed Yet",
          "author-mail <not.committed.yet>",
          "author-time 1789209600",
          "author-tz +0000",
          "committer Not Committed Yet",
          "committer-mail <not.committed.yet>",
          "committer-time 1789209600",
          "committer-tz +0000",
          `summary Version of ${path} from ${path}`,
        );
      } else {
        const [, name, mail] = /^(.*) <(.*)>$/.exec(commit.author);
        out.push(
          `author ${name}`,
          `author-mail <${mail}>`,
          `author-time ${commit.time}`,
          "author-tz +0000",
          `committer ${name}`,
          `committer-mail <${mail}>`,
          `committer-time ${commit.time}`,
          "committer-tz +0000",
          `summary ${commit.summary}`,
        );
        if (commit.boundary) out.push("boundary");
      }
      out.push(`filename ${path}`, `\t${raw}`);
    }
  }
  if (final !== rawRows.length) throw new Error(`fixture: segments cover ${final} of ${rawRows.length} lines`);
  return out.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Resolution per body line (§2 step 3). Commits are canned as
// `{ sha, author, time, summary, trailers: [[key, value]], blob }`, the blob
// being the page's full text at that commit.
// ---------------------------------------------------------------------------

const DEFAULT_MACHINES = ["*[bot]"];

/** Trailer values for one key, in message order. RESOLVED: keys compare case-insensitively, as git's do. */
function trailerValues(commit, key) {
  return commit.trailers.filter(([k]) => k.toLowerCase() === key.toLowerCase()).map(([, v]) => v.trim());
}

/**
 * Whether a `Name <email>` identity matches a `derive.machines` glob, by name
 * or by email. RESOLVED: picomatch with `literalBrackets: true`. Without it
 * the default `*[bot]` is a character class, "anything ending in b, o or t",
 * and would count "Scott" and "Matt" as machines and drop them from
 * `authors`; today's rule is `name.endsWith("[bot]")`. Matching is otherwise
 * picomatch's default, so case-sensitive.
 *
 * For the implementation: `derive.machines` must be matched with this same
 * option. Proposal 0046 states the rule (its config table and stress test 16),
 * and this ladder's "Scott and Matt are people" check is the case that fails
 * without it.
 */
function machineIdentity(value, machines) {
  const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(value);
  const name = m === null ? value.trim() : m[1];
  const email = m === null ? "" : m[2];
  const match = (s) => s !== "" && machines.some((glob) => picomatch.isMatch(s, glob, { literalBrackets: true }));
  if (!match(name) && !match(email)) return undefined;
  // RESOLVED: "that trailer's name" is written verbatim ("Claude Opus 5"), not
  // slugged into a model id; the email stands in only when the name is empty.
  return name !== "" ? name : email;
}

/**
 * Rule 2: the machine a verified stamp in the commit's own blob names for the
 * line's orig (file) line, or undefined. The orig line is converted to THAT
 * blob's body numbering, since the commit's frontmatter need not be today's.
 * RESOLVED: verification is at the stamp's recorded lines only; a stamp whose
 * pin holds elsewhere in that blob is not evidence (every writer re-derives
 * `lines` before committing, so the recorded lines are where it was minted).
 * RESOLVED: when several verified entries cover the line, the first in list
 * order wins.
 */
function stampEvidence(commit, origLine) {
  const page = readPage(commit.blob);
  const body = toBodyLine(origLine, page.bodyLine);
  if (body < 1) return undefined;
  for (const entry of stampOf(page)) {
    const span = parseLines(entry.lines);
    if (body < span.start || body > span.end) continue;
    if (pinOfLines(page.body, span) === entry.integrity) return entry["generated-by"];
  }
  return undefined;
}

/**
 * Rules 2-4 for one blame record: `{ machine, rule, sha }`, or `{ rule: 5 }`.
 * RESOLVED: an uncommitted line has no commit, so rules 2-4 never apply to it.
 * In particular the working tree's own stamp is never its own evidence: that
 * would make every stamp confirm itself.
 */
function recordedEvidence(record, commits, machines) {
  if (record.uncommitted) return { rule: 5, sha: record.sha };
  const commit = commits[record.sha];
  if (commit === undefined) throw new Error(`no commit ${record.sha}`);
  const stamped = stampEvidence(commit, record.origLine);
  if (stamped !== undefined) return { machine: stamped, rule: 2, sha: record.sha };
  // RESOLVED: several trailers of one kind: the first in the message wins.
  const generated = trailerValues(commit, "Generated-by").find((v) => v !== "");
  if (generated !== undefined) return { machine: generated, rule: 3, sha: record.sha };
  for (const value of trailerValues(commit, "Co-authored-by")) {
    const machine = machineIdentity(value, machines);
    if (machine !== undefined) return { machine, rule: 4, sha: record.sha };
  }
  return { rule: 5, sha: record.sha };
}

/** All five rules, first match wins. */
function resolveLine(record, ctx) {
  if (record.uncommitted && ctx.generatedBy !== undefined && ctx.generatedBy !== "") {
    return { machine: ctx.generatedBy, rule: 1, sha: record.sha };
  }
  return recordedEvidence(record, ctx.commits, ctx.machines);
}

// ---------------------------------------------------------------------------
// Grouping (§2 step 4): contiguous body lines resolved to the same machine,
// hashed over the current body.
// ---------------------------------------------------------------------------

/**
 * Derive a page's `provenance` from its working text, its blame and its
 * commits. Returns the page, every body line's resolution, and the derived
 * groups `{ entry, span, first }` where `first` is the first line's evidence.
 */
function deriveProvenance(scenario, opts = {}) {
  const page = readPage(scenario.working);
  const ctx = {
    commits: scenario.commits,
    generatedBy: opts.generatedBy,
    machines: opts.machines ?? DEFAULT_MACHINES,
  };
  const byLine = new Map();
  for (const record of parsePorcelain(scenario.blame)) {
    const body = toBodyLine(record.finalLine, page.bodyLine);
    if (body < 1) continue; // a frontmatter line
    byLine.set(body, resolveLine(record, ctx));
  }
  const derived = [];
  let open;
  for (let n = 1; n <= page.body.length; n++) {
    const res = byLine.get(n);
    const machine = res === undefined ? undefined : res.machine;
    if (open !== undefined && machine === open.machine && n === open.end + 1) {
      open.end = n;
      continue;
    }
    if (open !== undefined) derived.push(open);
    open = machine === undefined ? undefined : { machine, start: n, end: n, first: res };
  }
  if (open !== undefined) derived.push(open);
  return {
    page,
    byLine,
    derived: derived.map((g) => {
      const span = { start: g.start, end: g.end };
      return {
        entry: { "generated-by": g.machine, lines: lineSpec(span), integrity: pinOfLines(page.body, span) },
        span,
        first: g.first,
      };
    }),
  };
}

/** The bare entries of a derivation. */
function entriesOf(derivation) {
  return derivation.derived.map((d) => d.entry);
}

// ---------------------------------------------------------------------------
// Comparison (§2's table) and the write rule.
// ---------------------------------------------------------------------------

/**
 * The candidate nearest a recorded span (stress test 12). RESOLVED: distance
 * is between start lines; an equal distance goes to the earlier candidate.
 */
function nearest(candidates, recorded) {
  let best;
  for (const c of candidates) {
    const d = Math.abs(c.span.start - recorded.start);
    if (best === undefined || d < best.d || (d === best.d && c.span.start < best.c.span.start)) best = { c, d };
  }
  return best === undefined ? undefined : best.c;
}

/** Every window of the body, of the recorded width, that hashes to the pin. */
function windowsOf(body, width, integrity) {
  const out = [];
  for (let s = 1; s + width - 1 <= body.length; s++) {
    const span = { start: s, end: s + width - 1 };
    if (pinOfLines(body, span) === integrity) out.push({ span });
  }
  return out;
}

const sameSpan = (a, b) => a.start === b.start && a.end === b.end;
const short = (sha) => sha.slice(0, 7);

/**
 * Compare stamped entries with a fresh derivation. Returns one result per
 * stamped entry, in order, then one `unset` per uncovered derived group.
 *
 * Step 1, by integrity: a derived group with the stamp's pin, nearest by
 * lines, not already claimed by an earlier stamped entry. Its machine is the
 * evidence: the same machine is current (same lines) or moved; another is
 * stale.
 *
 * Step 2, no derived group carries the pin: the pin is looked for in the
 * current body, nearest window first. Found nowhere: changed. Found, and some
 * line in it resolves to a different machine: stale. Found, and no line
 * names another machine: current, or moved when at other lines.
 * RESOLVED: the table's "no evidence, pin matches" row reads current at the
 * recorded lines and moved elsewhere, as the evidence-backed rows do; and a
 * window where some lines name the stamp's machine and the rest name none is
 * that same row, not a contradiction.
 *
 * Unset. RESOLVED: a derived group is unset when some line of it lies outside
 * every matched span (of a current, moved or stale result) and outside the
 * recorded lines of every changed result. A changed entry's recorded lines
 * are the only place it can be said to cover, and its finding already speaks
 * for them, so E reports one finding, not three. A moved or stale entry's
 * recorded lines cover nothing, so another range landing where it used to be
 * is still unset.
 */
function compareProvenance(stamped, derivation) {
  const { page, byLine, derived } = derivation;
  const claimed = new Set();
  const results = [];
  for (const entry of stamped) {
    const recorded = parseLines(entry.lines);
    const width = recorded.end - recorded.start + 1;
    const machine = entry["generated-by"];
    const pool = derived.filter((d) => !claimed.has(d) && d.entry.integrity === entry.integrity);
    const hit = nearest(pool, recorded);
    if (hit !== undefined) {
      claimed.add(hit);
      if (hit.entry["generated-by"] !== machine) {
        results.push({
          status: "stale",
          entry,
          span: hit.span,
          evidence: { machine: hit.entry["generated-by"], sha: short(hit.first.sha), rule: hit.first.rule },
        });
      } else if (sameSpan(hit.span, recorded)) {
        results.push({ status: "current", entry, span: hit.span });
      } else {
        results.push({ status: "moved", entry, span: hit.span, newLines: hit.entry.lines });
      }
      continue;
    }
    const claimedSpans = [...claimed].map((d) => d.span);
    const windows = windowsOf(page.body, width, entry.integrity).filter(
      (w) => !claimedSpans.some((s) => sameSpan(s, w.span)),
    );
    const found = nearest(windows, recorded);
    if (found === undefined) {
      results.push({ status: "changed", entry, span: recorded });
      continue;
    }
    let contradiction;
    let anyMachine = false;
    for (let n = found.span.start; n <= found.span.end; n++) {
      const res = byLine.get(n);
      if (res === undefined || res.machine === undefined) continue;
      anyMachine = true;
      if (res.machine !== machine) {
        contradiction = res;
        break;
      }
    }
    if (contradiction !== undefined) {
      results.push({
        status: "stale",
        entry,
        span: found.span,
        evidence: { machine: contradiction.machine, sha: short(contradiction.sha), rule: contradiction.rule },
      });
      continue;
    }
    const result = sameSpan(found.span, recorded)
      ? { status: "current", entry, span: found.span }
      : { status: "moved", entry, span: found.span, newLines: lineSpec(found.span) };
    if (!anyMachine) result.noEvidence = true;
    results.push(result);
  }

  const covering = results.map((r) => r.span);
  for (const d of derived) {
    if (claimed.has(d)) continue;
    let uncovered = false;
    for (let n = d.span.start; n <= d.span.end && !uncovered; n++) {
      uncovered = !covering.some((s) => n >= s.start && n <= s.end);
    }
    if (uncovered) {
      results.push({
        status: "unset",
        entry: d.entry,
        span: d.span,
        evidence: { machine: d.entry["generated-by"], sha: short(d.first.sha), rule: d.first.rule },
      });
    }
  }
  return results;
}

/** Status and lines only, for assertions. */
function statusesOf(results) {
  return results.map((r) => {
    const out = { status: r.status, lines: r.entry.lines };
    if (r.newLines !== undefined) out.newLines = r.newLines;
    if (r.evidence !== undefined && r.status !== "unset") out.blame = `${r.evidence.machine} (${r.evidence.sha})`;
    if (r.noEvidence) out.noEvidence = true;
    return out;
  });
}

/**
 * What `derive` writes. Current entries stay as they are; moved entries stay
 * with `lines` rewritten; changed and stale entries are replaced by whatever
 * the derivation found; every derived group not already kept is added.
 * Nothing uncontradicted is dropped: a current entry with no evidence stays.
 * RESOLVED: a changed entry whose lines no machine now answers for is dropped
 * with nothing in its place (stress test 11: the bytes are gone). The output is
 * ordered by start line.
 * NOT MODELLED: a derived group that partly overlaps a kept entry of the same
 * machine is added beside it.
 */
function writeProvenance(results, derivation) {
  const kept = [];
  for (const r of results) {
    if (r.status === "current") kept.push(r.entry);
    else if (r.status === "moved") {
      kept.push({ "generated-by": r.entry["generated-by"], lines: r.newLines, integrity: r.entry.integrity });
    }
  }
  const same = (a, b) =>
    a["generated-by"] === b["generated-by"] && String(a.lines) === String(b.lines) && a.integrity === b.integrity;
  const out = [...kept];
  for (const d of derivation.derived) {
    if (!kept.some((k) => same(k, d.entry))) out.push(d.entry);
  }
  return out.sort((a, b) => parseLines(a.lines).start - parseLines(b.lines).start);
}

// ---------------------------------------------------------------------------
// Ranged attribution (§3b): `manni meta derive <path>:L1-L2 --generated-by
// <name>`. RESOLVED: the range on the path is in FILE lines, the numbers an
// editor shows, as cite's `add` takes them; the entry written is in body lines.
// ---------------------------------------------------------------------------

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = 2;
  }
}

/**
 * The entry a named range writes, or a UsageError. Committed or not, the
 * lines are attributed, unless rules 2-4 name a different machine for any of
 * them: then the first such line, in file order, is named in the refusal.
 * Evidence naming the same machine, or none, lets the range through.
 */
function attributeRange(scenario, target, opts) {
  const { path, start, end, reversed } = parseSrc(target);
  if (reversed) throw new UsageError(`${target} ends before it starts.`);
  const machines = opts.machines ?? DEFAULT_MACHINES;
  const page = readPage(scenario.working);
  const spec = start === end ? String(start) : `${start}-${end}`;
  if (end > page.all.length) {
    throw new UsageError(`${path} has no lines ${spec}: the file ends at line ${page.all.length}.`);
  }
  if (start < page.bodyLine) {
    // A range reaching into the frontmatter: the message proposal 0046 states.
    throw new UsageError(`${target} reaches into the frontmatter; provenance pins body lines, which start at line ${page.bodyLine}.`);
  }
  for (const record of parsePorcelain(scenario.blame)) {
    if (record.finalLine < start || record.finalLine > end) continue;
    const res = recordedEvidence(record, scenario.commits, machines);
    if (res.machine !== undefined && res.machine !== opts.generatedBy) {
      throw new UsageError(
        `${target}: blame attributes these lines to ${res.machine} (${short(res.sha)}); --generated-by cannot overrule a recorded machine.`,
      );
    }
  }
  const span = { start: toBodyLine(start, page.bodyLine), end: toBodyLine(end, page.bodyLine) };
  return { "generated-by": opts.generatedBy, lines: lineSpec(span), integrity: pinOfLines(page.body, span) };
}

// ---------------------------------------------------------------------------
// Fixtures. One page, docs/limits.md, in its states across history.
// ---------------------------------------------------------------------------

const PATH = "docs/limits.md";

/** The body as the agent left it: lines 3-8 are the agent's rewrite. */
const BODY = [
  "# Rate limits",
  "",
  "Requests are limited per API key.",
  "The default limit is 100 requests per minute.",
  "Bursts of up to 20 requests are allowed.",
  "A limited request returns HTTP 429.",
  "The Retry-After header says when to retry.",
  "Limits reset at the top of each minute.",
  "",
  "Contact support to raise a limit.",
];
/** The body before the agent's rewrite: the same length, other words at 3-8. */
const BODY_OLD = [
  ...BODY.slice(0, 2),
  "Every key has a limit.",
  "The limit is 60 requests per minute.",
  "There is no burst allowance.",
  "Excess requests fail.",
  "Clients should back off.",
  "Limits reset hourly.",
  ...BODY.slice(8),
];
/** A human edited line 5 inside the agent's range. */
const BODY_EDITED = BODY.map((l, i) => (i === 4 ? "Bursts of up to 50 requests are allowed." : l));
/** A human inserted two lines above the agent's range. */
const BODY_MOVED = [...BODY.slice(0, 2), "Limits apply to every endpoint.", "", ...BODY.slice(2)];

/** A page's full text from frontmatter lines and body lines. */
function pageText(front, body, eol = "\n") {
  return [...front, ...body].join(eol) + eol;
}
const FRONT_PLAIN = ["---", "title: Rate limits", "---"];
/** Frontmatter carrying a stamp, with optional extra keys above it. */
function stampFront(entries, extra = []) {
  return [
    "---",
    "title: Rate limits",
    ...extra,
    "provenance:",
    ...entries.flatMap((e) => [
      `  - generated-by: ${e["generated-by"]}`,
      `    lines: ${e.lines}`,
      `    integrity: ${e.integrity}`,
    ]),
    "---",
  ];
}

// Golden hashes, computed with node from the rule above and fixed here.
const GOLDEN = {
  "body 3-8": "sha256-f35fab13c3030b9a09b3b5d1cabd0f23cee16ca9588a6b9fbf0fad95b83347ce",
  "body 3-4 after the human edit": "sha256-44db5fddb55677b0299cfff8e1d708e623cc1d0d65f8d7ba64469a3362a4b761",
  "body 6-8 after the human edit": "sha256-8d14e72b6bfa499b2eafc308f341d248159dc9626641c373c0b02b2bc1808ea9",
  "the retry pair": "sha256-7af8b2a199e3ed7b41ae0aa68a9ac9a8fe30c74abbeef6de309b3f3384ad27aa",
};
const PIN_3_8 = pinOfLines(BODY, { start: 3, end: 8 });
const PIN_3_4 = pinOfLines(BODY_EDITED, { start: 3, end: 4 });
const PIN_6_8 = pinOfLines(BODY_EDITED, { start: 6, end: 8 });

const FABLE_3_8 = { "generated-by": "claude-fable-5", lines: "3-8", integrity: PIN_3_8 };

function commit(sha, author, summary, trailers, blob, time = 1788000000) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`fixture: bad sha ${sha}`);
  return { sha, author, time, summary, trailers, blob };
}
const ADA = "Ada Lovelace <ada@example.com>";
const GRACE = "Grace Hopper <grace@example.com>";

const C0 = commit("1a2b3c4d5e6f708192a3b4c5d6e7f80910a1b2c3", ADA, "docs: add rate limits", [], pageText(FRONT_PLAIN, BODY_OLD), 1780000000);
const C_TRAILER = commit("9b0e2c1f4a7d3e5b6c8a9f0e1d2c3b4a5f6e7d80", GRACE, "docs: rewrite rate limits",
  [["Generated-by", "claude-sonnet-5"]], pageText(FRONT_PLAIN, BODY));
const C_COAUTHOR = commit("4c1d2e0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e", GRACE, "docs: rewrite rate limits",
  [["Co-authored-by", "Claude Opus 5 <noreply@anthropic.com>"]], pageText(FRONT_PLAIN, BODY));
const C_BOT = commit("5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80", GRACE, "docs: rewrite rate limits",
  [["Co-authored-by", "docs-helper[bot] <41898282+docs-helper[bot]@users.noreply.github.com>"]], pageText(FRONT_PLAIN, BODY));
const SQUASH = commit("7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f", GRACE, "docs: rewrite rate limits (#41)",
  [], pageText(stampFront([FABLE_3_8]), BODY));
const SQUASH_UNVERIFIED = commit("8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f70", GRACE, "docs: rewrite rate limits (#42)",
  [], pageText(stampFront([{ ...FABLE_3_8, integrity: GOLDEN["body 3-4 after the human edit"] }]), BODY));
const C_AGENT = commit("2b3c4d5e6f708192a3b4c5d6e7f80910a1b2c3d4", GRACE, "docs: rewrite the rate limits",
  [], pageText(stampFront([FABLE_3_8]), BODY), 1785000000);
const C_HUMAN_EDIT = commit("3c4d5e6f708192a3b4c5d6e7f80910a1b2c3d4e5", ADA, "docs: allow bigger bursts",
  [], pageText(stampFront([FABLE_3_8], ["tags: [limits]"]), BODY_EDITED));
const C_HUMAN_INSERT = commit("6f708192a3b4c5d6e7f80910a1b2c3d4e5f60718", ADA, "docs: say limits are global",
  [], pageText(stampFront([FABLE_3_8]), BODY_MOVED));
const C_BOTH = commit("a0b1c2d3e4f5061728394a5b6c7d8e9f00112233", GRACE, "docs: rewrite rate limits",
  [["Generated-by", "claude-sonnet-5"]], pageText(stampFront([FABLE_3_8]), BODY));

const COMMITS = Object.fromEntries(
  [C0, C_TRAILER, C_COAUTHOR, C_BOT, SQUASH, SQUASH_UNVERIFIED, C_AGENT, C_HUMAN_EDIT, C_HUMAN_INSERT, C_BOTH].map((c) => [c.sha, c]),
);

/** A scenario: the working text, the blame over it, and the commits it names. */
function scenario(working, segments, commits = COMMITS) {
  return { path: PATH, working, commits, blame: porcelain(PATH, working, commits, segments) };
}

const Z = ZERO_SHA;

// A: the agent rewrote body 3-8 (file 6-11) and has not committed.
const A = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [Z, 6, 6], [C0.sha, 12, 2]]);
// A, after `derive` wrote the stamp, still uncommitted (validate in a pre-commit hook).
const A_STAMPED = scenario(pageText(stampFront([FABLE_3_8]), BODY),
  [[C0.sha, 1, 2], [Z, 3, 4], [C0.sha, 3, 3], [Z, 10, 6], [C0.sha, 12, 2]]);
// B: body 3-8 committed with `Generated-by: claude-sonnet-5`.
const B = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [C_TRAILER.sha, 6, 6], [C0.sha, 12, 2]]);
// C: body 3-8 committed with `Co-authored-by: Claude Opus 5 <noreply@anthropic.com>`.
const C = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [C_COAUTHOR.sha, 6, 6], [C0.sha, 12, 2]]);
const C_BOT_CASE = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [C_BOT.sha, 6, 6], [C0.sha, 12, 2]]);
// D: a squash commit with no trailers; its blob carries the stamp. Frontmatter
// is seven lines, so body 3-8 is file 10-15 in the squash and now.
const D = scenario(SQUASH.blob, [[C0.sha, 1, 2], [SQUASH.sha, 3, 4], [C0.sha, 3, 3], [SQUASH.sha, 10, 6], [C0.sha, 12, 2]]);
// D, but the squash's stamp does not verify against the squash's own blob.
const D_UNVERIFIED = scenario(SQUASH_UNVERIFIED.blob,
  [[C0.sha, 1, 2], [SQUASH_UNVERIFIED.sha, 3, 4], [C0.sha, 3, 3], [SQUASH_UNVERIFIED.sha, 10, 6], [C0.sha, 12, 2]]);
// E: the agent's commit stamped body 3-8 (file 10-15 there). A human commit
// then added `tags:` (frontmatter now eight lines, body 1 is file 9) and
// changed body 5. Body 3-4 blame to the agent at orig 10-11, body 5 to the
// human at 13, body 6-8 to the agent at orig 13-15.
const E = scenario(C_HUMAN_EDIT.blob, [
  [C0.sha, 1, 2], [C_HUMAN_EDIT.sha, 3, 1], [C_AGENT.sha, 3, 4], [C0.sha, 3, 3],
  [C_AGENT.sha, 10, 2], [C_HUMAN_EDIT.sha, 13, 1], [C_AGENT.sha, 13, 3], [C0.sha, 12, 2],
]);
// F: the agent's commit stamped body 3-8; a human inserted two body lines above.
const F = scenario(C_HUMAN_INSERT.blob, [
  [C0.sha, 1, 2], [C_AGENT.sha, 3, 4], [C0.sha, 3, 3], [C_HUMAN_INSERT.sha, 10, 2], [C_AGENT.sha, 10, 6], [C0.sha, 12, 2],
]);

// G: duplicate text. Body 3-4 and 8-9 are the same two lines.
const DUP_PAIR = ["Wait one second, then retry.", "Double the wait each time."];
const DUP = ["# Retries", "", ...DUP_PAIR, "", "## Uploads", "", ...DUP_PAIR, "See also: backoff."];
const DUP_OLD = DUP.map((l, i) => ([2, 3, 7, 8].includes(i) ? "TBD." : l));
const DUP_MOVED = [...DUP.slice(0, 2), "Retries are automatic.", "", ...DUP.slice(2)];
const PIN_DUP = pinOfLines(DUP, { start: 3, end: 4 });
const DUP_STAMP = [
  { "generated-by": "claude-fable-5", lines: "3-4", integrity: PIN_DUP },
  { "generated-by": "claude-fable-5", lines: "8-9", integrity: PIN_DUP },
];
const G0 = commit("b1c2d3e4f5061728394a5b6c7d8e9f0011223344", ADA, "docs: add retries", [], pageText(FRONT_PLAIN, DUP_OLD), 1780000000);
const G_AGENT = commit("c2d3e4f5061728394a5b6c7d8e9f001122334455", GRACE, "docs: fill in retries",
  [["Generated-by", "claude-fable-5"]], pageText(stampFront(DUP_STAMP), DUP), 1785000000);
const G_HUMAN = commit("d3e4f5061728394a5b6c7d8e9f00112233445566", ADA, "docs: retries are automatic",
  [], pageText(stampFront(DUP_STAMP), DUP_MOVED));
const G_COMMITS = Object.fromEntries([G0, G_AGENT, G_HUMAN].map((c) => [c.sha, c]));
// Frontmatter is ten lines; body 1 is file 11. After the insertion the pair
// sits at body 5-6 (file 15-16) and body 10-11 (file 20-21).
const G = scenario(G_HUMAN.blob, [
  [G0.sha, 1, 2], [G_AGENT.sha, 3, 7], [G0.sha, 3, 3], [G_HUMAN.sha, 13, 2],
  [G_AGENT.sha, 13, 2], [G0.sha, 8, 3], [G_AGENT.sha, 18, 2], [G0.sha, 13, 1],
], G_COMMITS);

// H: a person attributes committed human lines. Before, and after the stamp is committed.
const H0 = commit("e4f5061728394a5b6c7d8e9f0011223344556677", ADA, "docs: add rate limits", [], pageText(FRONT_PLAIN, BODY), 1780000000);
const H_STAMP = commit("f5061728394a5b6c7d8e9f001122334455667788", ADA, "docs: credit the rate limits",
  [], pageText(stampFront([FABLE_3_8]), BODY));
const H_COMMITS = Object.fromEntries([H0, H_STAMP].map((c) => [c.sha, c]));
const H_BEFORE = scenario(H0.blob, [[H0.sha, 1, 13]], H_COMMITS);
const H = scenario(H_STAMP.blob, [[H0.sha, 1, 2], [H_STAMP.sha, 3, 4], [H0.sha, 3, 11]], H_COMMITS);

// I: the stamp says claude-fable-5 (uncommitted), blame's trailer says claude-sonnet-5.
const I = scenario(pageText(stampFront([FABLE_3_8]), BODY),
  [[C0.sha, 1, 2], [Z, 3, 4], [C0.sha, 3, 3], [C_TRAILER.sha, 6, 6], [C0.sha, 12, 2]]);
// I, before any stamp: the range a person would name, file lines 6-11.
const I_RANGE = B;
// I2: one commit carries both a verified stamp (fable) and a trailer (sonnet).
const I2 = scenario(C_BOTH.blob, [[C0.sha, 1, 2], [C_BOTH.sha, 3, 4], [C0.sha, 3, 3], [C_BOTH.sha, 10, 6], [C0.sha, 12, 2]]);

// J: B checked out with CRLF line endings. Blame's content rows carry the CR.
const J = scenario(pageText(FRONT_PLAIN, BODY, "\r\n"), [[C0.sha, 1, 5], [C_TRAILER.sha, 6, 6], [C0.sha, 12, 2]]);

// ---------------------------------------------------------------------------

function run() {
  // Golden hashes, reproduced with node.
  assert.strictEqual(PIN_3_8, GOLDEN["body 3-8"]);
  assert.strictEqual(PIN_3_4, GOLDEN["body 3-4 after the human edit"]);
  assert.strictEqual(PIN_6_8, GOLDEN["body 6-8 after the human edit"]);
  assert.strictEqual(PIN_DUP, GOLDEN["the retry pair"]);
  assert.strictEqual(pinOfLines(DUP, { start: 8, end: 9 }), PIN_DUP, "identical ranges share a pin");
  assert.strictEqual(pinOfLines(lines(pageText(FRONT_PLAIN, BODY, "\r\n")), { start: 6, end: 11 }), PIN_3_8,
    "a CRLF copy hashes as its LF twin");
  assert.strictEqual(pinOfLines(lines("\uFEFF" + pageText(FRONT_PLAIN, BODY)), { start: 6, end: 11 }), PIN_3_8,
    "a BOM does not enter the hash");
  assert.notStrictEqual(pinOfLines(BODY.map((l, i) => (i === 3 ? l + " " : l)), { start: 3, end: 8 }), PIN_3_8,
    "trailing whitespace is kept");
  console.log("golden hashes");
  for (const [label, value] of Object.entries(GOLDEN)) console.log(`  ${label.padEnd(30)} ${value}`);

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
  const refusal = (fn) => {
    try {
      return { entry: fn() };
    } catch (err) {
      if (!(err instanceof UsageError)) throw err;
      return { exit: err.exitCode, message: err.message };
    }
  };
  const fable = (lines, integrity) => ({ "generated-by": "claude-fable-5", lines, integrity });
  const sonnet = (lines, integrity) => ({ "generated-by": "claude-sonnet-5", lines, integrity });

  console.log("\nbody lines and porcelain");
  check("body line 1 follows a three-line frontmatter", readPage(A.working).bodyLine, 4);
  check("...and a seven-line one", readPage(D.working).bodyLine, 8);
  check("a page with no frontmatter starts at file line 1", readPage(BODY.join("\n") + "\n").bodyLine, 1);
  check("file line 13 is body line 5 when body 1 is file 9", toBodyLine(13, 9), 5);
  check("...and back", toFileLine(5, 9), 13);
  const rows = parsePorcelain(A.blame);
  check("one record per file line", rows.length, 13);
  check("an uncommitted record: zero sha, orig = final, Not Committed Yet",
    (({ sha, origLine, finalLine, uncommitted, content }) => ({ sha, origLine, finalLine, uncommitted, author: rows[5].fields.author, content }))(rows[5]),
    { sha: ZERO_SHA, origLine: 6, finalLine: 6, uncommitted: true, author: "Not Committed Yet", content: BODY[2] });
  check("the group count is on a group's first line only", [rows[5].groupCount, rows[6].groupCount], [6, undefined]);
  // Captured from git 2.x over a two-commit scratch repository: `boundary` on
  // a root commit's line, `previous` on an uncommitted one.
  const captured = [
    "8d8a7c5ada82ea10a9e1ec8164fc60505ddd5777 1 1 1", "author A", "author-mail <a@x>", "author-time 1789243498",
    "author-tz -0700", "committer A", "committer-mail <a@x>", "committer-time 1789243498", "committer-tz -0700",
    "summary init", "boundary", "filename f.md", "\ta",
    "0000000000000000000000000000000000000000 2 2 1", "author Not Committed Yet", "author-mail <not.committed.yet>",
    "author-time 1789243498", "author-tz -0700", "committer Not Committed Yet", "committer-mail <not.committed.yet>",
    "committer-time 1789243498", "committer-tz -0700", "summary Version of f.md from f.md",
    "previous 8d8a7c5ada82ea10a9e1ec8164fc60505ddd5777 f.md", "filename f.md", "\tX", "",
  ].join("\n");
  check("real porcelain, boundary and previous included",
    parsePorcelain(captured).map((r) => [r.sha.slice(0, 7), r.origLine, r.finalLine, r.uncommitted, r.fields.boundary ?? false, r.content]),
    [["8d8a7c5", 1, 1, false, true, "a"], ["0000000", 2, 2, true, false, "X"]]);
  check("plain --porcelain is refused: the header does not repeat",
    (() => {
      try {
        parsePorcelain(`${C0.sha} 1 1 2\nauthor Ada\nfilename x\n\tone\n${C0.sha} 2 2\n\ttwo\n`);
        return "parsed";
      } catch (err) {
        return err.message;
      }
    })(),
    "porcelain: line 2 has no full header; run blame with --line-porcelain");

  console.log("\nA. an uncommitted agent edit under --generated-by (§3a, rule 1)");
  check("attributes exactly the uncommitted body lines", entriesOf(deriveProvenance(A, { generatedBy: "claude-fable-5" })),
    [fable("3-8", PIN_3_8)]);
  check("without --generated-by, uncommitted lines have no evidence", entriesOf(deriveProvenance(A)), []);
  check("an empty MANNI_GENERATED_BY counts as unset", entriesOf(deriveProvenance(A, { generatedBy: "" })), []);
  check("the stamp written, still uncommitted, validated without the flag: current, no evidence",
    statusesOf(compareProvenance(stampOf(readPage(A_STAMPED.working)), deriveProvenance(A_STAMPED))),
    [{ status: "current", lines: "3-8", noEvidence: true }]);
  check("...and with the flag: current, evidence agrees",
    statusesOf(compareProvenance(stampOf(readPage(A_STAMPED.working)), deriveProvenance(A_STAMPED, { generatedBy: "claude-fable-5" }))),
    [{ status: "current", lines: "3-8" }]);

  console.log("\nB. a Generated-by trailer (§3c, rule 3)");
  const b = deriveProvenance(B);
  check("committed lines take the trailer's machine", entriesOf(b), [sonnet("3-8", PIN_3_8)]);
  check("...with the commit as evidence", b.derived[0].first, { machine: "claude-sonnet-5", rule: 3, sha: C_TRAILER.sha });
  check("--generated-by does not reach committed lines", entriesOf(deriveProvenance(B, { generatedBy: "claude-fable-5" })),
    [sonnet("3-8", PIN_3_8)]);
  check("the unstamped page: unset", statusesOf(compareProvenance([], b)), [{ status: "unset", lines: "3-8" }]);

  console.log("\nC. a Co-authored-by trailer matched by derive.machines (§3d, rule 4)");
  const MACHINES = ["*[bot]", "noreply@anthropic.com"];
  check("matched by email, attributed to the trailer's name", entriesOf(deriveProvenance(C, { machines: MACHINES })),
    [{ "generated-by": "Claude Opus 5", lines: "3-8", integrity: PIN_3_8 }]);
  check("not matched under the default [\"*[bot]\"]", entriesOf(deriveProvenance(C)), []);
  check("a [bot] co-author matches the default", entriesOf(deriveProvenance(C_BOT_CASE)),
    [{ "generated-by": "docs-helper[bot]", lines: "3-8", integrity: PIN_3_8 }]);
  check("*[bot] is literal brackets: Scott and Matt are not machines",
    ["Scott Tiger <scott@example.com>", "Matt <matt@example.com>", "dependabot[bot] <x@example.com>"].map((v) => machineIdentity(v, DEFAULT_MACHINES)),
    [undefined, undefined, "dependabot[bot]"]);
  check("...where picomatch's default reads [bot] as a class and would take Scott",
    picomatch.isMatch("Scott", "*[bot]"), true);

  console.log("\nD. a squash merge (stress test 10, rule 2)");
  const d = deriveProvenance(D);
  check("the squash has no trailers, and its own blob's stamp attributes the lines", entriesOf(d), [fable("3-8", PIN_3_8)]);
  check("...by rule 2, at the squash", d.derived[0].first, { machine: "claude-fable-5", rule: 2, sha: SQUASH.sha });
  check("...and the stamp compares current", statusesOf(compareProvenance(stampOf(d.page), d)),
    [{ status: "current", lines: "3-8" }]);
  check("a stamp that does not verify against its commit's blob is not evidence", entriesOf(deriveProvenance(D_UNVERIFIED)), []);

  console.log("\nE. a human edit inside an agent's range (stress test 9)");
  const e = deriveProvenance(E);
  check("the untouched lines stay with the agent, renumbered to current body lines; the edited line loses attribution",
    entriesOf(e), [fable("3-4", PIN_3_4), fable("6-8", PIN_6_8)]);
  check("body 3-4 read the stamp at orig file lines 10-11, body 5 found none, body 6-8 at orig 13-15",
    [3, 4, 5, 6, 8].map((n) => (e.byLine.get(n).rule)), [2, 2, 5, 2, 2]);
  check("the human commit's blob still carries the stamp, and it does not verify there", stampEvidence(C_HUMAN_EDIT, 13), undefined);
  const eResults = compareProvenance(stampOf(e.page), e);
  check("the old stamp is changed, and nothing else is reported", statusesOf(eResults), [{ status: "changed", lines: "3-8" }]);
  check("derive rewrites it as the two surviving ranges", writeProvenance(eResults, e), [fable("3-4", PIN_3_4), fable("6-8", PIN_6_8)]);

  console.log("\nF. moved: an insertion above a stamped range");
  const f = deriveProvenance(F);
  check("the agent's lines are found at body 5-10", entriesOf(f), [fable("5-10", PIN_3_8)]);
  check("the inserted lines sit inside the stale stamp's numbers, which do not verify at that commit",
    [f.byLine.get(3).rule, f.byLine.get(4).rule], [5, 5]);
  const fResults = compareProvenance(stampOf(f.page), f);
  check("same integrity and machine, other lines: moved", statusesOf(fResults), [{ status: "moved", lines: "3-8", newLines: "5-10" }]);
  check("derive rewrites lines and nothing else", writeProvenance(fResults, f), [fable("5-10", PIN_3_8)]);

  console.log("\nG. duplicate text (stress test 12)");
  const g = deriveProvenance(G);
  check("two agent ranges, one pin", entriesOf(g), [fable("5-6", PIN_DUP), fable("10-11", PIN_DUP)]);
  const gResults = compareProvenance(stampOf(g.page), g);
  check("each stamped entry takes the nearest range, and a range is taken once", statusesOf(gResults), [
    { status: "moved", lines: "3-4", newLines: "5-6" },
    { status: "moved", lines: "8-9", newLines: "10-11" },
  ]);
  check("derive rewrites both", writeProvenance(gResults, g), [fable("5-6", PIN_DUP), fable("10-11", PIN_DUP)]);
  const gOne = compareProvenance([fable("8-9", PIN_DUP)], g);
  check("one entry at 8-9: 10-11 is nearer (2) than 5-6 (3); the other range is unset", statusesOf(gOne), [
    { status: "moved", lines: "8-9", newLines: "10-11" },
    { status: "unset", lines: "5-6" },
  ]);
  check("an equal distance goes to the earlier range",
    nearest([{ span: { start: 10, end: 11 } }, { span: { start: 6, end: 7 } }], { start: 8, end: 9 }).span.start, 6);

  console.log("\nH. no evidence: a person attributes committed human lines (§3b)");
  check("the range is accepted: nothing names a machine", refusal(() => attributeRange(H_BEFORE, `${PATH}:6-11`, { generatedBy: "claude-fable-5" })),
    { entry: fable("3-8", PIN_3_8) });
  const h = deriveProvenance(H);
  check("once committed, blame still names the human commit, so nothing is derived", entriesOf(h), []);
  const hResults = compareProvenance(stampOf(h.page), h);
  check("the pin matches and evidence names no machine: current, not stale", statusesOf(hResults),
    [{ status: "current", lines: "3-8", noEvidence: true }]);
  check("derive keeps the uncontradicted entry", writeProvenance(hResults, h), [fable("3-8", PIN_3_8)]);

  console.log("\nI. a contradiction");
  const i = deriveProvenance(I);
  const iResults = compareProvenance(stampOf(i.page), i);
  check("the stamp says claude-fable-5, the trailer says claude-sonnet-5: stale", statusesOf(iResults),
    [{ status: "stale", lines: "3-8", blame: "claude-sonnet-5 (9b0e2c1)" }]);
  check("derive rewrites it to the recorded machine", writeProvenance(iResults, i), [sonnet("3-8", PIN_3_8)]);
  check("a range cannot overrule a recorded machine", refusal(() => attributeRange(I_RANGE, `${PATH}:6-11`, { generatedBy: "claude-fable-5" })), {
    exit: 2,
    message: "docs/limits.md:6-11: blame attributes these lines to claude-sonnet-5 (9b0e2c1); --generated-by cannot overrule a recorded machine.",
  });
  check("...one overlapping line is enough", refusal(() => attributeRange(I_RANGE, `${PATH}:4-6`, { generatedBy: "claude-fable-5" })).exit, 2);
  check("...but naming the recorded machine is accepted", refusal(() => attributeRange(I_RANGE, `${PATH}:6-11`, { generatedBy: "claude-sonnet-5" })),
    { entry: sonnet("3-8", PIN_3_8) });
  check("a range past the file", refusal(() => attributeRange(I_RANGE, `${PATH}:6-99`, { generatedBy: "claude-fable-5" })),
    { exit: 2, message: "docs/limits.md has no lines 6-99: the file ends at line 13." });
  check("a range that ends before it starts is refused, not hashed as an empty span",
    refusal(() => attributeRange(I_RANGE, `${PATH}:11-6`, { generatedBy: "claude-fable-5" })),
    { exit: 2, message: "docs/limits.md:11-6 ends before it starts." });
  const i2 = deriveProvenance(I2);
  check("rule order: a verified stamp in the commit outranks that commit's own trailer", entriesOf(i2), [fable("3-8", PIN_3_8)]);

  console.log("\nJ. line endings");
  check("a CRLF checkout derives the same entries as its LF twin", entriesOf(deriveProvenance(J)), entriesOf(deriveProvenance(B)));
  check("...and blame's content rows carried the CR", parsePorcelain(J.blame)[5].content, BODY[2] + "\r");

  console.log(bad ? `\n${bad} UNEXPECTED` : "\nall verdicts held");
  process.exit(bad ? 1 : 0);
}

module.exports = {
  normalize,
  lines,
  pinOfLines,
  readPage,
  toBodyLine,
  toFileLine,
  parseLines,
  parseSrc,
  stampOf,
  parsePorcelain,
  porcelain,
  machineIdentity,
  stampEvidence,
  resolveLine,
  deriveProvenance,
  compareProvenance,
  writeProvenance,
  attributeRange,
  nearest,
  GOLDEN,
  ZERO_SHA,
};

if (require.main === module) run();
