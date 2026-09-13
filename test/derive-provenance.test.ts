/**
 * The provenance core of proposal 0046: blame porcelain in, `provenance`
 * entries, comparisons, the write plan, ranged attribution and findings out.
 *
 * Every case A–J is the reviewed ladder's
 * (`docs/proposals/0046/ladders/blame-examples.cjs`), rebuilt here over the
 * same pages, commits and golden hashes. The ladder's own porcelain generator
 * writes the blame text, so a fixture cannot say something git would not, and
 * each scenario is also run through the ladder's functions so the port and the
 * reference cannot drift apart case by case.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MACHINES,
  ZERO_SHA,
  attributeRange,
  collectTrailers,
  compareProvenance,
  deriveProvenance,
  machineIdentity,
  parseLinePorcelain,
  parseProvenanceTarget,
  planProvenanceWrite,
  provenanceEntries,
  provenanceFindings,
  rangeResults,
  readProvenancePage,
  renderProvenanceValue,
  resolveLineEvidence,
  type BlameLine,
  type CommitEvidence,
  type ProvenanceComparison,
  type ProvenanceDerivation,
  type ProvenanceEntry,
} from "../src/meta/core/derive/provenance.js";
import { DERIVED_KEYWORD, DERIVED_STALE_SCHEMA } from "../src/meta/core/derive/types.js";
import { DocmetaError } from "../src/meta/types.js";
import { pinOfLines, splitLines } from "../src/shared/pin.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const LADDER_PATH = join(repoRoot, "docs/proposals/0046/ladders/blame-examples.cjs");
const FIXTURES = join(repoRoot, "test/fixtures/derive/provenance");

// ---------------------------------------------------------------------------
// The ladder, for its porcelain generator and as the reference each case is
// checked against.
// ---------------------------------------------------------------------------

interface LadderCommit {
  sha: string;
  author: string;
  time: number;
  summary: string;
  trailers: [string, string][];
  blob: string;
  boundary?: boolean;
}
interface LadderScenario {
  path: string;
  working: string;
  commits: Record<string, LadderCommit>;
  blame: string;
}
interface LadderEntry {
  "generated-by": string;
  lines: string | number;
  integrity: string;
}
interface LadderDerivation {
  derived: { entry: LadderEntry }[];
}
interface LadderResult {
  status: string;
  entry: LadderEntry;
  newLines?: string | number;
  noEvidence?: boolean;
  evidence?: { machine: string; sha: string; rule: number };
}
interface Ladder {
  porcelain(
    path: string,
    working: string,
    commits: Record<string, LadderCommit>,
    segments: [string, number, number][],
  ): string;
  readPage(content: string): unknown;
  stampOf(page: unknown): LadderEntry[];
  deriveProvenance(s: LadderScenario, opts?: { generatedBy?: string; machines?: string[] }): LadderDerivation & {
    page: unknown;
  };
  compareProvenance(stamped: LadderEntry[], d: LadderDerivation): LadderResult[];
  writeProvenance(results: LadderResult[], d: LadderDerivation): LadderEntry[];
}

const require = createRequire(import.meta.url);
const ladder = require(LADDER_PATH) as Ladder;

// ---------------------------------------------------------------------------
// Fixtures: the ladder's page, docs/limits.md, in its states across history.
// ---------------------------------------------------------------------------

const PATH = "docs/limits.md";

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
const BODY_EDITED = BODY.map((l, i) => (i === 4 ? "Bursts of up to 50 requests are allowed." : l));
const BODY_MOVED = [...BODY.slice(0, 2), "Limits apply to every endpoint.", "", ...BODY.slice(2)];

function pageText(front: readonly string[], body: readonly string[], eol = "\n"): string {
  return [...front, ...body].join(eol) + eol;
}
const FRONT_PLAIN = ["---", "title: Rate limits", "---"];
function stampFront(entries: readonly ProvenanceEntry[], extra: readonly string[] = []): string[] {
  return [
    "---",
    "title: Rate limits",
    ...extra,
    "provenance:",
    ...entries.flatMap((e) => [
      `  - generated-by: ${e["generated-by"]}`,
      `    lines: ${String(e.lines)}`,
      `    integrity: ${e.integrity}`,
    ]),
    "---",
  ];
}

const GOLDEN = {
  "body 3-8": "sha256-f35fab13c3030b9a09b3b5d1cabd0f23cee16ca9588a6b9fbf0fad95b83347ce",
  "body 3-4 after the human edit": "sha256-44db5fddb55677b0299cfff8e1d708e623cc1d0d65f8d7ba64469a3362a4b761",
  "body 6-8 after the human edit": "sha256-8d14e72b6bfa499b2eafc308f341d248159dc9626641c373c0b02b2bc1808ea9",
  "the retry pair": "sha256-7af8b2a199e3ed7b41ae0aa68a9ac9a8fe30c74abbeef6de309b3f3384ad27aa",
} as const;
const PIN_3_8 = GOLDEN["body 3-8"];
const PIN_3_4 = GOLDEN["body 3-4 after the human edit"];
const PIN_6_8 = GOLDEN["body 6-8 after the human edit"];
const PIN_DUP = GOLDEN["the retry pair"];

const fable = (lines: string | number, integrity: string): ProvenanceEntry => ({
  "generated-by": "claude-fable-5",
  lines,
  integrity,
});
const sonnet = (lines: string | number, integrity: string): ProvenanceEntry => ({
  "generated-by": "claude-sonnet-5",
  lines,
  integrity,
});
const FABLE_3_8 = fable("3-8", PIN_3_8);

function commit(
  sha: string,
  author: string,
  summary: string,
  trailers: [string, string][],
  blob: string,
  time = 1788000000,
): LadderCommit {
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
  [], pageText(stampFront([{ ...FABLE_3_8, integrity: PIN_3_4 }]), BODY));
const C_AGENT = commit("2b3c4d5e6f708192a3b4c5d6e7f80910a1b2c3d4", GRACE, "docs: rewrite the rate limits",
  [], pageText(stampFront([FABLE_3_8]), BODY), 1785000000);
const C_HUMAN_EDIT = commit("3c4d5e6f708192a3b4c5d6e7f80910a1b2c3d4e5", ADA, "docs: allow bigger bursts",
  [], pageText(stampFront([FABLE_3_8], ["tags: [limits]"]), BODY_EDITED));
const C_HUMAN_INSERT = commit("6f708192a3b4c5d6e7f80910a1b2c3d4e5f60718", ADA, "docs: say limits are global",
  [], pageText(stampFront([FABLE_3_8]), BODY_MOVED));
const C_BOTH = commit("a0b1c2d3e4f5061728394a5b6c7d8e9f00112233", GRACE, "docs: rewrite rate limits",
  [["Generated-by", "claude-sonnet-5"]], pageText(stampFront([FABLE_3_8]), BODY));

function byShaOf(list: readonly LadderCommit[]): Record<string, LadderCommit> {
  return Object.fromEntries(list.map((c) => [c.sha, c]));
}
const COMMITS = byShaOf([C0, C_TRAILER, C_COAUTHOR, C_BOT, SQUASH, SQUASH_UNVERIFIED, C_AGENT, C_HUMAN_EDIT, C_HUMAN_INSERT, C_BOTH]);

function scenario(
  working: string,
  segments: [string, number, number][],
  commits: Record<string, LadderCommit> = COMMITS,
): LadderScenario {
  return { path: PATH, working, commits, blame: ladder.porcelain(PATH, working, commits, segments) };
}

const Z = ZERO_SHA;

const A = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [Z, 6, 6], [C0.sha, 12, 2]]);
const A_STAMPED = scenario(pageText(stampFront([FABLE_3_8]), BODY),
  [[C0.sha, 1, 2], [Z, 3, 4], [C0.sha, 3, 3], [Z, 10, 6], [C0.sha, 12, 2]]);
const B = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [C_TRAILER.sha, 6, 6], [C0.sha, 12, 2]]);
const C = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [C_COAUTHOR.sha, 6, 6], [C0.sha, 12, 2]]);
const C_BOT_CASE = scenario(pageText(FRONT_PLAIN, BODY), [[C0.sha, 1, 5], [C_BOT.sha, 6, 6], [C0.sha, 12, 2]]);
const D = scenario(SQUASH.blob, [[C0.sha, 1, 2], [SQUASH.sha, 3, 4], [C0.sha, 3, 3], [SQUASH.sha, 10, 6], [C0.sha, 12, 2]]);
const D_UNVERIFIED = scenario(SQUASH_UNVERIFIED.blob,
  [[C0.sha, 1, 2], [SQUASH_UNVERIFIED.sha, 3, 4], [C0.sha, 3, 3], [SQUASH_UNVERIFIED.sha, 10, 6], [C0.sha, 12, 2]]);
const E = scenario(C_HUMAN_EDIT.blob, [
  [C0.sha, 1, 2], [C_HUMAN_EDIT.sha, 3, 1], [C_AGENT.sha, 3, 4], [C0.sha, 3, 3],
  [C_AGENT.sha, 10, 2], [C_HUMAN_EDIT.sha, 13, 1], [C_AGENT.sha, 13, 3], [C0.sha, 12, 2],
]);
const F = scenario(C_HUMAN_INSERT.blob, [
  [C0.sha, 1, 2], [C_AGENT.sha, 3, 4], [C0.sha, 3, 3], [C_HUMAN_INSERT.sha, 10, 2], [C_AGENT.sha, 10, 6], [C0.sha, 12, 2],
]);

const DUP_PAIR = ["Wait one second, then retry.", "Double the wait each time."];
const DUP = ["# Retries", "", ...DUP_PAIR, "", "## Uploads", "", ...DUP_PAIR, "See also: backoff."];
const DUP_OLD = DUP.map((l, i) => ([2, 3, 7, 8].includes(i) ? "TBD." : l));
const DUP_MOVED = [...DUP.slice(0, 2), "Retries are automatic.", "", ...DUP.slice(2)];
const DUP_STAMP = [fable("3-4", PIN_DUP), fable("8-9", PIN_DUP)];
const G0 = commit("b1c2d3e4f5061728394a5b6c7d8e9f0011223344", ADA, "docs: add retries", [], pageText(FRONT_PLAIN, DUP_OLD), 1780000000);
const G_AGENT = commit("c2d3e4f5061728394a5b6c7d8e9f001122334455", GRACE, "docs: fill in retries",
  [["Generated-by", "claude-fable-5"]], pageText(stampFront(DUP_STAMP), DUP), 1785000000);
const G_HUMAN = commit("d3e4f5061728394a5b6c7d8e9f00112233445566", ADA, "docs: retries are automatic",
  [], pageText(stampFront(DUP_STAMP), DUP_MOVED));
const G = scenario(G_HUMAN.blob, [
  [G0.sha, 1, 2], [G_AGENT.sha, 3, 7], [G0.sha, 3, 3], [G_HUMAN.sha, 13, 2],
  [G_AGENT.sha, 13, 2], [G0.sha, 8, 3], [G_AGENT.sha, 18, 2], [G0.sha, 13, 1],
], byShaOf([G0, G_AGENT, G_HUMAN]));

const H0 = commit("e4f5061728394a5b6c7d8e9f0011223344556677", ADA, "docs: add rate limits", [], pageText(FRONT_PLAIN, BODY), 1780000000);
const H_STAMP = commit("f5061728394a5b6c7d8e9f001122334455667788", ADA, "docs: credit the rate limits",
  [], pageText(stampFront([FABLE_3_8]), BODY));
const H_COMMITS = byShaOf([H0, H_STAMP]);
const H_BEFORE = scenario(H0.blob, [[H0.sha, 1, 13]], H_COMMITS);
const H = scenario(H_STAMP.blob, [[H0.sha, 1, 2], [H_STAMP.sha, 3, 4], [H0.sha, 3, 11]], H_COMMITS);

const I = scenario(pageText(stampFront([FABLE_3_8]), BODY),
  [[C0.sha, 1, 2], [Z, 3, 4], [C0.sha, 3, 3], [C_TRAILER.sha, 6, 6], [C0.sha, 12, 2]]);
const I_RANGE = B;
const I2 = scenario(C_BOTH.blob, [[C0.sha, 1, 2], [C_BOTH.sha, 3, 4], [C0.sha, 3, 3], [C_BOTH.sha, 10, 6], [C0.sha, 12, 2]]);

const J = scenario(pageText(FRONT_PLAIN, BODY, "\r\n"), [[C0.sha, 1, 5], [C_TRAILER.sha, 6, 6], [C0.sha, 12, 2]]);

// ---------------------------------------------------------------------------
// Adapters: a ladder scenario as the port's inputs.
// ---------------------------------------------------------------------------

function commitsOf(s: LadderScenario): Map<string, CommitEvidence> {
  return new Map(
    Object.values(s.commits).map((c) => [c.sha, { sha: c.sha, trailers: collectTrailers(c.trailers), blob: c.blob }]),
  );
}

interface Opts {
  generatedBy?: string;
  machines?: string[];
}

function derive(s: LadderScenario, opts: Opts = {}): ProvenanceDerivation {
  return deriveProvenance({
    content: s.working,
    blame: parseLinePorcelain(s.blame),
    commits: commitsOf(s),
    ...(opts.machines !== undefined ? { machines: opts.machines } : {}),
    ...(opts.generatedBy !== undefined ? { generatedBy: opts.generatedBy } : {}),
  });
}

const entriesOf = (d: ProvenanceDerivation): ProvenanceEntry[] => d.derived.map((r) => r.entry);

/** Status and lines only, in the ladder's `statusesOf` shape. */
function statusesOf(results: readonly (ProvenanceComparison | LadderResult)[]): Record<string, unknown>[] {
  return results.map((r) => {
    const out: Record<string, unknown> = { status: r.status, lines: r.entry.lines };
    const newLines = "newLines" in r ? r.newLines : r.status === "moved" && "span" in r ? spec(r.span) : undefined;
    if (newLines !== undefined) out.newLines = newLines;
    if (r.evidence !== undefined && r.status !== "unset") out.blame = `${String(r.evidence.machine)} (${r.evidence.sha.slice(0, 7)})`;
    if (r.noEvidence === true) out.noEvidence = true;
    return out;
  });
}
function spec(span: { start: number; end: number }): string | number {
  return span.start === span.end ? span.start : `${String(span.start)}-${String(span.end)}`;
}

/** The port and the ladder agree on a scenario: entries, and statuses and write plan against its stamp. */
function agreesWithLadder(s: LadderScenario, opts: Opts = {}): void {
  const mine = derive(s, opts);
  const theirs = ladder.deriveProvenance(s, opts);
  expect(entriesOf(mine)).toEqual(theirs.derived.map((d) => d.entry));
  const stamp = ladder.stampOf(ladder.readPage(s.working));
  expect(mine.page.stamp).toEqual(stamp);
  const myResults = compareProvenance(mine.page.stamp, mine);
  const theirResults = ladder.compareProvenance(stamp, theirs);
  expect(statusesOf(myResults)).toEqual(statusesOf(theirResults));
  expect(planProvenanceWrite(myResults, mine)).toEqual(ladder.writeProvenance(theirResults, theirs));
}

function refusal(fn: () => ProvenanceEntry): { entry: ProvenanceEntry } | { exit: number; message: string } {
  try {
    return { entry: fn() };
  } catch (err) {
    if (!(err instanceof DocmetaError)) throw err;
    return { exit: err.exitCode, message: err.message };
  }
}

function attribute(s: LadderScenario, target: string, generatedBy: string): ProvenanceEntry {
  return attributeRange({
    target,
    content: s.working,
    blame: parseLinePorcelain(s.blame),
    commits: commitsOf(s),
    generatedBy,
  });
}

// ---------------------------------------------------------------------------

describe("the reference ladder", () => {
  it("runs green, so the reference this port follows still holds", () => {
    const out = execFileSync(process.execPath, [LADDER_PATH], { cwd: repoRoot, encoding: "utf8" });
    expect(out).toContain("all verdicts held");
  });

  it("agrees with the port on every scenario", () => {
    agreesWithLadder(A, { generatedBy: "claude-fable-5" });
    agreesWithLadder(A);
    agreesWithLadder(A_STAMPED);
    agreesWithLadder(A_STAMPED, { generatedBy: "claude-fable-5" });
    agreesWithLadder(B);
    agreesWithLadder(C, { machines: ["*[bot]", "noreply@anthropic.com"] });
    agreesWithLadder(C);
    agreesWithLadder(C_BOT_CASE);
    agreesWithLadder(D);
    agreesWithLadder(D_UNVERIFIED);
    agreesWithLadder(E);
    agreesWithLadder(F);
    agreesWithLadder(G);
    agreesWithLadder(H);
    agreesWithLadder(I);
    agreesWithLadder(I2);
    agreesWithLadder(J);
  });
});

describe("golden hashes", () => {
  it("reproduces the ladder's pins", () => {
    expect(pinOfLines(BODY, { start: 3, end: 8 })).toBe(PIN_3_8);
    expect(pinOfLines(BODY_EDITED, { start: 3, end: 4 })).toBe(PIN_3_4);
    expect(pinOfLines(BODY_EDITED, { start: 6, end: 8 })).toBe(PIN_6_8);
    expect(pinOfLines(DUP, { start: 3, end: 4 })).toBe(PIN_DUP);
    expect(pinOfLines(DUP, { start: 8, end: 9 })).toBe(PIN_DUP);
  });
});

describe("readProvenancePage", () => {
  it("finds body line 1 after the frontmatter, or at file line 1 without one", () => {
    expect(readProvenancePage(A.working).bodyLine).toBe(4);
    expect(readProvenancePage(D.working).bodyLine).toBe(8);
    expect(readProvenancePage(BODY.join("\n") + "\n").bodyLine).toBe(1);
    expect(readProvenancePage("---\ntitle: t\n---").bodyLine).toBe(4);
  });

  it("keeps body line 1 at file line 1 for a page whose metadata is not fenced", () => {
    const page = readProvenancePage(D.working, { fenced: false });
    expect(page.bodyLine).toBe(1);
    expect(page.stamp).toEqual([]);
  });

  it("reads only well-formed stamp entries", () => {
    expect(
      provenanceEntries([
        FABLE_3_8,
        { "generated-by": "", lines: "3-8", integrity: PIN_3_8 },
        { "generated-by": "x", lines: "8-3", integrity: PIN_3_8 },
        { "generated-by": "x", lines: 0, integrity: PIN_3_8 },
        { "generated-by": "x", lines: 4, integrity: "sha256-abc" },
        null,
        "3-8",
      ]),
    ).toEqual([FABLE_3_8]);
    expect(provenanceEntries({ not: "a list" })).toEqual([]);
  });

  it("reads an entry with a key outside the closed set, and keeps the key: the schema reports it", () => {
    const noted = { "generated-by": "x", lines: 4, integrity: PIN_3_8, note: "reviewed" };
    expect(provenanceEntries([noted])).toEqual([noted]);
  });

  it("reads a page whose frontmatter does not parse as carrying no stamp", () => {
    const page = readProvenancePage("---\ntitle: [unclosed\n---\nbody\n");
    expect(page.stamp).toEqual([]);
    expect(page.bodyLine).toBe(4);
    expect(page.body).toEqual(["body"]);
  });
});

describe("parseLinePorcelain", () => {
  it("reads one record per file line from the ladder's porcelain", () => {
    const rows = parseLinePorcelain(A.blame);
    expect(rows).toHaveLength(13);
    const row = rows[5];
    expect(row).toMatchObject({
      sha: ZERO_SHA,
      origLine: 6,
      finalLine: 6,
      uncommitted: true,
      author: "Not Committed Yet",
      authorMail: "not.committed.yet",
      content: BODY[2],
      groupCount: 6,
    });
    expect(rows[6]?.groupCount).toBeUndefined();
  });

  it("reads real git output, boundary and previous included", () => {
    const text = readFileSync(join(FIXTURES, "blame-sample.txt"), "utf8");
    const rows = parseLinePorcelain(text);
    expect(rows.map((r) => [r.sha.slice(0, 7), r.origLine, r.finalLine, r.uncommitted, r.boundary, r.content])).toEqual([
      ["60afda7", 1, 1, false, true, "---"],
      ["60afda7", 2, 2, false, true, "title: t"],
      ["60afda7", 3, 3, false, true, "---"],
      ["60afda7", 4, 4, false, true, "one"],
      ["4b5ca46", 5, 5, false, false, "TWO"],
      ["60afda7", 6, 6, false, true, "three"],
      ["0000000", 7, 7, true, false, "four"],
    ]);
    const two = rows[4] as BlameLine;
    expect(two).toMatchObject({
      author: "Grace Hopper",
      authorMail: "grace@example.com",
      filename: "f.md",
      previous: { sha: "60afda75edbd36d58988f4b0da4597bf1463f670", filename: "f.md" },
      groupCount: 1,
    });
    expect(rows[0]?.previous).toBeUndefined();
    expect(rows[0]?.groupCount).toBe(4);
  });

  it("keeps a CR in a content row, as a CRLF checkout blames", () => {
    expect(parseLinePorcelain(J.blame)[5]?.content).toBe(`${String(BODY[2])}\r`);
  });

  it("refuses plain --porcelain, whose header does not repeat", () => {
    expect(() => parseLinePorcelain(`${C0.sha} 1 1 2\nauthor Ada\nfilename x\n\tone\n${C0.sha} 2 2\n\ttwo\n`)).toThrow(
      "porcelain: line 2 has no full header; run blame with --line-porcelain",
    );
  });

  it("reads a SHA-256 repository's 64-hex shas, the all-zero one uncommitted", () => {
    const committed = "ab".repeat(32);
    const zero = "0".repeat(64);
    const text = [
      `${committed} 1 1 1`, "author Ada", "author-mail <ada@example.com>", "summary init", "filename f.md", "\tone",
      `${zero} 2 2 1`, "author Not Committed Yet", "author-mail <not.committed.yet>", "summary Version of f.md from f.md", "filename f.md", "\ttwo",
      "",
    ].join("\n");
    expect(parseLinePorcelain(text).map((r) => [r.sha, r.uncommitted, r.content])).toEqual([
      [committed, false, "one"],
      [zero, true, "two"],
    ]);
  });

  it("refuses a row where a header should be", () => {
    expect(() => parseLinePorcelain("not a header\n")).toThrow('porcelain: expected a header at row 1, got "not a header"');
  });

  it("refuses a record with no content row", () => {
    expect(() => parseLinePorcelain(`${C0.sha} 1 1 1\nauthor Ada\nfilename x\n`)).toThrow(
      "porcelain: line 1 has no content row",
    );
  });
});

describe("machineIdentity and trailers", () => {
  it("reads *[bot] as literal brackets: Scott and Matt are people", () => {
    expect(
      ["Scott Tiger <scott@example.com>", "Matt <matt@example.com>", "dependabot[bot] <x@example.com>"].map((v) =>
        machineIdentity(v, DEFAULT_MACHINES),
      ),
    ).toEqual([undefined, undefined, "dependabot[bot]"]);
  });

  it("matches by email and answers with the name as written", () => {
    expect(machineIdentity("Claude Opus 5 <noreply@anthropic.com>", ["noreply@anthropic.com"])).toBe("Claude Opus 5");
  });

  it("answers with the email only when the name is empty", () => {
    expect(machineIdentity("<noreply@anthropic.com>", ["noreply@anthropic.com"])).toBe("noreply@anthropic.com");
  });

  it("matches case-sensitively", () => {
    expect(machineIdentity("Docs-Helper[BOT] <x@example.com>", DEFAULT_MACHINES)).toBeUndefined();
  });

  it("matches a bare name with no email", () => {
    expect(machineIdentity("renovate[bot]", DEFAULT_MACHINES)).toBe("renovate[bot]");
  });

  it("*[bot] matches a name with a slash or a leading dot, as endsWith('[bot]') did", () => {
    expect(
      ["ci/deploy[bot] <d@x.y>", ".hidden[bot] <h@x.y>", "Robert <r@x.y>"].map((v) => machineIdentity(v, DEFAULT_MACHINES)),
    ).toEqual(["ci/deploy[bot]", ".hidden[bot]", undefined]);
  });

  it("collects trailers by key without case, trimmed, in message order", () => {
    expect(
      collectTrailers([
        ["generated-BY", " claude-fable-5 "],
        ["Generated-by", "claude-sonnet-5"],
        ["CO-AUTHORED-BY", "Claude <noreply@anthropic.com>"],
        ["Reviewed-by", "Ada"],
      ]),
    ).toEqual({ generatedBy: ["claude-fable-5", "claude-sonnet-5"], coAuthoredBy: ["Claude <noreply@anthropic.com>"] });
  });
});

describe("resolveLineEvidence", () => {
  const commits = commitsOf(E);
  const machines = DEFAULT_MACHINES;
  const line = (sha: string, origLine: number, finalLine = origLine): BlameLine => ({
    sha,
    origLine,
    finalLine,
    author: "x",
    authorMail: "x@example.com",
    filename: PATH,
    boundary: false,
    uncommitted: sha === ZERO_SHA,
    content: "",
  });

  it("rule 1 applies only to uncommitted lines with a name", () => {
    expect(resolveLineEvidence(line(ZERO_SHA, 9), { commits, machines, generatedBy: "claude-fable-5" })).toEqual({
      machine: "claude-fable-5",
      rule: 1,
      sha: ZERO_SHA,
    });
    expect(resolveLineEvidence(line(ZERO_SHA, 9), { commits, machines, generatedBy: "" })).toEqual({ rule: 5, sha: ZERO_SHA });
    expect(resolveLineEvidence(line(ZERO_SHA, 9), { commits, machines })).toEqual({ rule: 5, sha: ZERO_SHA });
  });

  it("the human commit's blob still carries the stamp, and it does not verify there", () => {
    expect(resolveLineEvidence(line(C_HUMAN_EDIT.sha, 13), { commits, machines })).toEqual({ rule: 5, sha: C_HUMAN_EDIT.sha });
  });

  it("a frontmatter line in the commit is never covered by its stamp", () => {
    expect(resolveLineEvidence(line(C_AGENT.sha, 2), { commits, machines })).toEqual({ rule: 5, sha: C_AGENT.sha });
  });

  it("rule 2 reads a stamp the caller supplies, as a manifest's, verified against the page blob", () => {
    const page = pageText(FRONT_PLAIN, BODY);
    const withManifest = new Map<string, CommitEvidence>([
      ["m".repeat(40), { sha: "m".repeat(40), trailers: { generatedBy: [], coAuthoredBy: [] }, blob: page, stamp: [FABLE_3_8] }],
    ]);
    const sha = "m".repeat(40);
    // body 3 is file 6 under a three-line frontmatter
    expect(resolveLineEvidence(line(sha, 6), { commits: withManifest, machines })).toEqual({ machine: "claude-fable-5", rule: 2, sha });
    // the same stamp at a line it does not cover
    expect(resolveLineEvidence(line(sha, 5), { commits: withManifest, machines })).toEqual({ rule: 5, sha });
  });

  it("the first of two valid covering entries wins", () => {
    const sha = "e".repeat(40);
    const page = pageText(FRONT_PLAIN, BODY);
    const commits2 = new Map<string, CommitEvidence>([
      [sha, { sha, trailers: { generatedBy: [], coAuthoredBy: [] }, blob: page, stamp: [sonnet("3-8", PIN_3_8), FABLE_3_8] }],
    ]);
    expect(resolveLineEvidence(line(sha, 6), { commits: commits2, machines }).machine).toBe("claude-sonnet-5");
  });

  it("the first Generated-by trailer wins over a later one and over Co-authored-by", () => {
    const sha = "f".repeat(40);
    const commits3 = new Map<string, CommitEvidence>([
      [
        sha,
        {
          sha,
          trailers: { generatedBy: ["", "claude-fable-5", "claude-sonnet-5"], coAuthoredBy: ["renovate[bot] <r@example.com>"] },
          blob: pageText(FRONT_PLAIN, BODY),
        },
      ],
    ]);
    expect(resolveLineEvidence(line(sha, 6), { commits: commits3, machines })).toEqual({ machine: "claude-fable-5", rule: 3, sha });
  });

  it("refuses a sha it has no commit for", () => {
    expect(() => resolveLineEvidence(line("0123456789012345678901234567890123456789", 6), { commits, machines })).toThrow(
      "no commit 0123456789012345678901234567890123456789",
    );
  });
});

describe("A. an uncommitted agent edit under --generated-by (rule 1)", () => {
  it("attributes exactly the uncommitted body lines", () => {
    expect(entriesOf(derive(A, { generatedBy: "claude-fable-5" }))).toEqual([FABLE_3_8]);
  });

  it("without --generated-by, uncommitted lines have no evidence; an empty value is unset", () => {
    expect(entriesOf(derive(A))).toEqual([]);
    expect(entriesOf(derive(A, { generatedBy: "" }))).toEqual([]);
  });

  it("A2. the stamp written, still uncommitted: current with no evidence, and current with the flag", () => {
    const bare = derive(A_STAMPED);
    expect(statusesOf(compareProvenance(bare.page.stamp, bare))).toEqual([{ status: "current", lines: "3-8", noEvidence: true }]);
    const flagged = derive(A_STAMPED, { generatedBy: "claude-fable-5" });
    expect(statusesOf(compareProvenance(flagged.page.stamp, flagged))).toEqual([{ status: "current", lines: "3-8" }]);
  });
});

describe("B. a Generated-by trailer (rule 3)", () => {
  const b = derive(B);

  it("committed lines take the trailer's machine, with the commit as evidence", () => {
    expect(entriesOf(b)).toEqual([sonnet("3-8", PIN_3_8)]);
    expect(b.derived[0]?.evidence).toEqual({ machine: "claude-sonnet-5", rule: 3, sha: C_TRAILER.sha });
  });

  it("--generated-by does not reach committed lines", () => {
    expect(entriesOf(derive(B, { generatedBy: "claude-fable-5" }))).toEqual([sonnet("3-8", PIN_3_8)]);
  });

  it("the unstamped page: unset", () => {
    expect(statusesOf(compareProvenance([], b))).toEqual([{ status: "unset", lines: "3-8" }]);
  });
});

describe("C. a Co-authored-by trailer matched by derive.machines (rule 4)", () => {
  it("matched by email, attributed to the trailer's name", () => {
    expect(entriesOf(derive(C, { machines: ["*[bot]", "noreply@anthropic.com"] }))).toEqual([
      { "generated-by": "Claude Opus 5", lines: "3-8", integrity: PIN_3_8 },
    ]);
  });

  it("not matched under the default", () => {
    expect(entriesOf(derive(C))).toEqual([]);
  });

  it("a [bot] co-author matches the default", () => {
    expect(entriesOf(derive(C_BOT_CASE))).toEqual([{ "generated-by": "docs-helper[bot]", lines: "3-8", integrity: PIN_3_8 }]);
  });
});

describe("D. a squash merge (rule 2)", () => {
  const d = derive(D);

  it("the squash's own blob's stamp attributes the lines, at the squash, and compares current", () => {
    expect(entriesOf(d)).toEqual([FABLE_3_8]);
    expect(d.derived[0]?.evidence).toEqual({ machine: "claude-fable-5", rule: 2, sha: SQUASH.sha });
    expect(statusesOf(compareProvenance(d.page.stamp, d))).toEqual([{ status: "current", lines: "3-8" }]);
  });

  it("D-negative. a stamp that does not verify against its commit's blob is not evidence", () => {
    expect(entriesOf(derive(D_UNVERIFIED))).toEqual([]);
  });
});

describe("E. a human edit inside an agent's range (stress test 9)", () => {
  const e = derive(E);
  const results = compareProvenance(e.page.stamp, e);

  it("the untouched lines stay with the agent; the edited line loses attribution", () => {
    expect(entriesOf(e)).toEqual([fable("3-4", PIN_3_4), fable("6-8", PIN_6_8)]);
    expect([3, 4, 5, 6, 8].map((n) => e.evidenceByLine.get(n)?.rule)).toEqual([2, 2, 5, 2, 2]);
  });

  it("the old stamp is changed, and nothing else is reported", () => {
    expect(statusesOf(results)).toEqual([{ status: "changed", lines: "3-8" }]);
  });

  it("derive rewrites it as the two surviving ranges", () => {
    expect(planProvenanceWrite(results, e)).toEqual([fable("3-4", PIN_3_4), fable("6-8", PIN_6_8)]);
  });
});

describe("F. moved: an insertion above a stamped range", () => {
  const f = derive(F);
  const results = compareProvenance(f.page.stamp, f);

  it("finds the agent's lines at body 5-10, and the inserted lines have no evidence", () => {
    expect(entriesOf(f)).toEqual([fable("5-10", PIN_3_8)]);
    expect([f.evidenceByLine.get(3)?.rule, f.evidenceByLine.get(4)?.rule]).toEqual([5, 5]);
  });

  it("same integrity and machine, other lines: moved, and derive rewrites lines only", () => {
    expect(statusesOf(results)).toEqual([{ status: "moved", lines: "3-8", newLines: "5-10" }]);
    expect(planProvenanceWrite(results, f)).toEqual([fable("5-10", PIN_3_8)]);
  });
});

describe("G. duplicate text (stress test 12)", () => {
  const g = derive(G);

  it("each stamped entry takes the nearest range, and a range is taken once", () => {
    expect(entriesOf(g)).toEqual([fable("5-6", PIN_DUP), fable("10-11", PIN_DUP)]);
    const results = compareProvenance(g.page.stamp, g);
    expect(statusesOf(results)).toEqual([
      { status: "moved", lines: "3-4", newLines: "5-6" },
      { status: "moved", lines: "8-9", newLines: "10-11" },
    ]);
    expect(planProvenanceWrite(results, g)).toEqual([fable("5-6", PIN_DUP), fable("10-11", PIN_DUP)]);
  });

  it("G2. one entry at 8-9: 10-11 is nearer than 5-6, and the other range is unset", () => {
    expect(statusesOf(compareProvenance([fable("8-9", PIN_DUP)], g))).toEqual([
      { status: "moved", lines: "8-9", newLines: "10-11" },
      { status: "unset", lines: "5-6" },
    ]);
  });

  it("an equal distance goes to the earlier range", () => {
    // One stamp at 3-4 between the pair moved to 1-2 and 5-6: both two away.
    const page = pageText(FRONT_PLAIN, [...DUP_PAIR, "x", "y", ...DUP_PAIR]);
    const sha = "a".repeat(40);
    const d = deriveProvenance({
      content: page,
      blame: parseLinePorcelain(
        ladder.porcelain(PATH, page, { [sha]: { ...G_AGENT, sha, blob: page } }, [[sha, 1, 9]]),
      ),
      commits: new Map([[sha, { sha, trailers: { generatedBy: ["claude-fable-5"], coAuthoredBy: [] }, blob: page }]]),
    });
    // Every line is the agent's, so the derivation is one range and the stamp goes to the window search.
    expect(entriesOf(d)).toHaveLength(1);
    const results = compareProvenance([fable("3-4", PIN_DUP)], d);
    expect(results[0]).toMatchObject({ status: "moved", span: { start: 1, end: 2 } });
  });
});

describe("H. no evidence: a person attributes committed human lines", () => {
  it("the range is accepted: nothing names a machine", () => {
    expect(refusal(() => attribute(H_BEFORE, `${PATH}:6-11`, "claude-fable-5"))).toEqual({ entry: FABLE_3_8 });
  });

  it("once committed, nothing is derived, the pin compares current, and derive keeps it", () => {
    const h = derive(H);
    expect(entriesOf(h)).toEqual([]);
    const results = compareProvenance(h.page.stamp, h);
    expect(statusesOf(results)).toEqual([{ status: "current", lines: "3-8", noEvidence: true }]);
    expect(planProvenanceWrite(results, h)).toEqual([FABLE_3_8]);
  });
});

describe("I. a contradiction", () => {
  it("the stamp says claude-fable-5, the trailer says claude-sonnet-5: stale, rewritten to the recorded machine", () => {
    const i = derive(I);
    const results = compareProvenance(i.page.stamp, i);
    expect(statusesOf(results)).toEqual([{ status: "stale", lines: "3-8", blame: "claude-sonnet-5 (9b0e2c1)" }]);
    expect(planProvenanceWrite(results, i)).toEqual([sonnet("3-8", PIN_3_8)]);
  });

  it("a range cannot overrule a recorded machine; one overlapping line is enough", () => {
    expect(refusal(() => attribute(I_RANGE, `${PATH}:6-11`, "claude-fable-5"))).toEqual({
      exit: 2,
      message:
        "docs/limits.md:6-11: blame attributes these lines to claude-sonnet-5 (9b0e2c1); --generated-by cannot overrule a recorded machine.",
    });
    expect(refusal(() => attribute(I_RANGE, `${PATH}:4-6`, "claude-fable-5"))).toMatchObject({ exit: 2 });
  });

  it("naming the recorded machine is accepted", () => {
    expect(refusal(() => attribute(I_RANGE, `${PATH}:6-11`, "claude-sonnet-5"))).toEqual({ entry: sonnet("3-8", PIN_3_8) });
  });

  it("I2. a verified stamp in the commit outranks that commit's own trailer", () => {
    expect(entriesOf(derive(I2))).toEqual([FABLE_3_8]);
  });
});

describe("J. line endings", () => {
  it("a CRLF checkout derives the same entries as its LF twin", () => {
    expect(entriesOf(derive(J))).toEqual(entriesOf(derive(B)));
  });

  it("a BOM does not move body lines or enter the hash", () => {
    const d = derive({ ...B, working: "\uFEFF" + B.working });
    expect(entriesOf(d)).toEqual([sonnet("3-8", PIN_3_8)]);
  });
});

describe("attributeRange usage errors", () => {
  const cases: [string, string][] = [
    [`${PATH}:6-99`, "docs/limits.md has no lines 6-99: the file ends at line 13."],
    [`${PATH}:99`, "docs/limits.md has no lines 99: the file ends at line 13."],
    [`${PATH}:2-5`, "docs/limits.md:2-5 reaches into the frontmatter; provenance pins body lines, which start at line 4."],
    [`${PATH}:11-6`, "docs/limits.md:11-6 ends before it starts."],
  ];
  it.each(cases)("%s", (target, message) => {
    expect(refusal(() => attribute(I_RANGE, target, "claude-fable-5"))).toEqual({ exit: 2, message });
  });

  it("the reversed check comes before the others", () => {
    expect(refusal(() => attribute(I_RANGE, `${PATH}:99-2`, "claude-fable-5"))).toEqual({
      exit: 2,
      message: "docs/limits.md:99-2 ends before it starts.",
    });
  });

  it("parseProvenanceTarget splits the last :L, keeps a drive letter, and refuses a reversed range", () => {
    expect(parseProvenanceTarget("C:/docs/limits.md:6-11")).toEqual({ page: "C:/docs/limits.md", lines: { start: 6, end: 11 } });
    expect(parseProvenanceTarget("docs/limits.md")).toEqual({ page: "docs/limits.md" });
    expect(() => parseProvenanceTarget("docs/limits.md:31-12")).toThrow(
      new DocmetaError("docs/limits.md:31-12 ends before it starts."),
    );
  });

  it("refuses a target that names no lines", () => {
    expect(() => attribute(I_RANGE, PATH, "claude-fable-5")).toThrow("names no lines");
  });
});

describe("rangeResults", () => {
  it("spells file lines, with from on moved and stale only", () => {
    const f = derive(F);
    expect(rangeResults(compareProvenance(f.page.stamp, f), f.page.bodyLine)).toEqual([
      {
        lines: "12-17",
        "generated-by": "claude-fable-5",
        integrity: PIN_3_8,
        status: "moved",
        evidence: "pin",
        from: { lines: "10-15", "generated-by": "claude-fable-5" },
        written: false,
      },
    ]);
    const i = derive(I);
    const bodyLineI = i.page.bodyLine;
    expect(rangeResults(compareProvenance(i.page.stamp, i), bodyLineI)).toEqual([
      {
        lines: `${String(bodyLineI + 2)}-${String(bodyLineI + 7)}`,
        "generated-by": "claude-sonnet-5",
        integrity: PIN_3_8,
        status: "stale",
        evidence: "blame 9b0e2c1",
        from: { lines: `${String(bodyLineI + 2)}-${String(bodyLineI + 7)}`, "generated-by": "claude-fable-5" },
        written: false,
      },
    ]);
    const a = derive(A, { generatedBy: "claude-fable-5" });
    expect(rangeResults(compareProvenance([], a), a.page.bodyLine)).toEqual([
      { lines: "6-11", "generated-by": "claude-fable-5", integrity: PIN_3_8, status: "unset", evidence: "uncommitted", written: false },
    ]);
  });
});

describe("provenanceFindings", () => {
  it("files one finding per changed, stale and unset range, none for current or moved", () => {
    const e = derive(E);
    const changed = provenanceFindings(compareProvenance(e.page.stamp, e), e.page.bodyLine);
    // E's frontmatter is eight lines: body 3-8 is file 11-16.
    expect(changed).toEqual([
      {
        schema: DERIVED_STALE_SCHEMA,
        keyword: DERIVED_KEYWORD,
        instancePath: "/provenance",
        subject: `provenance ${PIN_3_8}`,
        message: "provenance lines 11-16 changed since claude-fable-5 wrote them — run manni meta derive",
        line: 11,
      },
    ]);

    const i = derive(I);
    const stale = provenanceFindings(compareProvenance(i.page.stamp, i), i.page.bodyLine);
    const start = i.page.bodyLine + 2;
    expect(stale).toEqual([
      {
        schema: DERIVED_STALE_SCHEMA,
        keyword: DERIVED_KEYWORD,
        instancePath: "/provenance",
        subject: `provenance ${PIN_3_8}`,
        message: `provenance lines ${String(start)}-${String(start + 5)} say claude-fable-5; blame says claude-sonnet-5 (9b0e2c1) — run manni meta derive`,
        line: start,
      },
    ]);

    const f = derive(F);
    const d = derive(D);
    expect(provenanceFindings(compareProvenance(f.page.stamp, f), f.page.bodyLine)).toEqual([]);
    expect(provenanceFindings(compareProvenance(d.page.stamp, d), d.page.bodyLine)).toEqual([]);
  });

  it("an unset range carries the derived pin; two ranges carry distinct subjects and lines", () => {
    // Body 3-4 from a Generated-by commit, body 6-8 from a bot co-author.
    const page = pageText(FRONT_PLAIN, BODY);
    const s = scenario(page, [[C0.sha, 1, 5], [C_TRAILER.sha, 6, 2], [H0.sha, 8, 1], [C_BOT.sha, 9, 3], [C0.sha, 12, 2]], {
      ...COMMITS,
      [H0.sha]: H0,
    });
    const d = derive(s);
    const findings = provenanceFindings(compareProvenance([], d), d.page.bodyLine);
    expect(findings).toEqual([
      {
        schema: DERIVED_STALE_SCHEMA,
        keyword: DERIVED_KEYWORD,
        instancePath: "/provenance",
        subject: `provenance ${String(pinOfLines(BODY, { start: 3, end: 4 }))}`,
        message: "provenance is unset for lines 6-7; blame says claude-sonnet-5 (9b0e2c1) — run manni meta derive",
        line: 6,
      },
      {
        schema: DERIVED_STALE_SCHEMA,
        keyword: DERIVED_KEYWORD,
        instancePath: "/provenance",
        subject: `provenance ${String(pinOfLines(BODY, { start: 6, end: 8 }))}`,
        message: "provenance is unset for lines 9-11; blame says docs-helper[bot] (5d6e7f8) — run manni meta derive",
        line: 9,
      },
    ]);
    expect(findings[0]?.subject).not.toBe(findings[1]?.subject);
  });

  it("an unset single line from uncommitted evidence", () => {
    // Body 10 is file 13, the only uncommitted line.
    const page = pageText(FRONT_PLAIN, [...BODY_OLD.slice(0, 9), "Email support to raise a limit."]);
    const s = scenario(page, [[C0.sha, 1, 12], [Z, 13, 1]]);
    const d = derive(s, { generatedBy: "claude-fable-5" });
    expect(provenanceFindings(compareProvenance([], d), d.page.bodyLine)).toEqual([
      expect.objectContaining({
        message: "provenance is unset for lines 13; blame says claude-fable-5 (uncommitted) — run manni meta derive",
        line: 13,
      }),
    ]);
  });
});

describe("planProvenanceWrite", () => {
  it("keeps an uncontradicted entry, drops a changed one with no evidence left, orders by line", () => {
    // H's stamp stands with no evidence; a second stamp elsewhere whose text is gone is dropped.
    const h = derive(H);
    const gone = fable("10", "sha256-" + "0".repeat(64));
    const results = compareProvenance([gone, FABLE_3_8], h);
    expect(statusesOf(results)).toEqual([
      { status: "changed", lines: "10" },
      { status: "current", lines: "3-8", noEvidence: true },
    ]);
    expect(planProvenanceWrite(results, h)).toEqual([FABLE_3_8]);
  });

  it("adds unset ranges beside kept ones", () => {
    const b = derive(B);
    expect(planProvenanceWrite(compareProvenance([], b), b)).toEqual([sonnet("3-8", PIN_3_8)]);
  });
});

describe("renderProvenanceValue", () => {
  it("spells file lines and machines, one range per clause", () => {
    expect(renderProvenanceValue([FABLE_3_8, sonnet(10, PIN_3_8)], 4)).toBe("lines 6-11 claude-fable-5; lines 13 claude-sonnet-5");
    expect(renderProvenanceValue([], 4)).toBe("");
  });
});

describe("splitLines sanity for the fixture pages", () => {
  it("the E page has an eight-line frontmatter", () => {
    expect(splitLines(E.working).indexOf("---", 1)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Review findings on PR #34: recorded lines first, unbudgeted move search,
// open entry keys.
// ---------------------------------------------------------------------------

const machineA = (lines: string | number, integrity: string): ProvenanceEntry => ({ "generated-by": "claude-a", lines, integrity });
const machineB = (lines: string | number, integrity: string): ProvenanceEntry => ({ "generated-by": "claude-b", lines, integrity });
const ABC = ["a", "b", "c"];
const PIN_ABC = String(pinOfLines(ABC, { start: 1, end: 3 }));

describe("the stamp's own lines come first", () => {
  // Body a,b,c,-,a,b,c. Lines 1-4 from a person; 5-7 from a commit with Generated-by: claude-b.
  const R_HUMAN = commit("1111111111111111111111111111111111111111", ADA, "docs: abc", [], pageText(FRONT_PLAIN, [...ABC, "-"]));
  const R_BOT = commit("2222222222222222222222222222222222222222", GRACE, "docs: abc again",
    [["Generated-by", "claude-b"]], pageText(FRONT_PLAIN, [...ABC, "-", ...ABC]));
  // The stamp's frontmatter is seven lines, so body 1 is file 8.
  const REPRO_A = scenario(pageText(stampFront([machineA("1-3", PIN_ABC)]), [...ABC, "-", ...ABC]),
    [[Z, 1, 7], [R_HUMAN.sha, 4, 4], [R_BOT.sha, 8, 3]], byShaOf([R_HUMAN, R_BOT]));

  it("A. the pin holds at the recorded lines and nothing there contradicts: current, and the other machine's copy is unset", () => {
    const d = derive(REPRO_A);
    const results = compareProvenance(d.page.stamp, d);
    expect(statusesOf(results)).toEqual([
      { status: "current", lines: "1-3", noEvidence: true },
      { status: "unset", lines: "5-7" },
    ]);
    expect(planProvenanceWrite(results, d)).toEqual([machineA("1-3", PIN_ABC), machineB("5-7", PIN_ABC)]);
  });

  // Body a,b,c,d..i,a,b,c. Lines 1-9 from a person; 10-12 from a commit with Generated-by: claude-a.
  const FILLER = ["d", "e", "f", "g", "h", "i"];
  const S_HUMAN = commit("3333333333333333333333333333333333333333", ADA, "docs: abc", [], pageText(FRONT_PLAIN, [...ABC, ...FILLER]));
  const S_AGENT = commit("4444444444444444444444444444444444444444", GRACE, "docs: abc again",
    [["Generated-by", "claude-a"]], pageText(FRONT_PLAIN, [...ABC, ...FILLER, ...ABC]));
  // Two entries: a ten-line frontmatter, body 1 is file 11.
  const REPRO_B = scenario(pageText(stampFront([machineA("1-3", PIN_ABC), machineA("10-12", PIN_ABC)]), [...ABC, ...FILLER, ...ABC]),
    [[Z, 1, 10], [S_HUMAN.sha, 4, 9], [S_AGENT.sha, 13, 3]], byShaOf([S_HUMAN, S_AGENT]));

  it("B. two identical stamped ranges, evidence on one: both current, neither swapped", () => {
    const d = derive(REPRO_B);
    const results = compareProvenance(d.page.stamp, d);
    expect(statusesOf(results)).toEqual([
      { status: "current", lines: "1-3", noEvidence: true },
      { status: "current", lines: "10-12" },
    ]);
    expect(planProvenanceWrite(results, d)).toEqual([machineA("1-3", PIN_ABC), machineA("10-12", PIN_ABC)]);
  });

  it("the ladder agrees on both", () => {
    agreesWithLadder(REPRO_A);
    agreesWithLadder(REPRO_B);
  });

  it("a machine named at the recorded lines still makes them stale", () => {
    // I's recorded lines hold the pin, and the trailer there names claude-sonnet-5.
    const i = derive(I);
    expect(statusesOf(compareProvenance(i.page.stamp, i))).toEqual([{ status: "stale", lines: "3-8", blame: "claude-sonnet-5 (9b0e2c1)" }]);
  });
});

describe("a large page", () => {
  const WIDE = Array.from({ length: 2600 }, (_, i) => String(i).padStart(200, "x"));
  const pinWide = String(pinOfLines(WIDE, { start: 2100, end: 2499 }));
  const noBlame = (body: readonly string[]): ProvenanceDerivation =>
    deriveProvenance({ content: pageText(FRONT_PLAIN, body), blame: [], commits: new Map() });

  it("a correct pin at its recorded lines, past the search budget from the band's start, is current", () => {
    const d = noBlame(WIDE);
    const entry = machineA("2100-2499", pinWide);
    const results = compareProvenance([entry], d);
    expect(statusesOf(results)).toEqual([{ status: "current", lines: "2100-2499", noEvidence: true }]);
    expect(planProvenanceWrite(results, d)).toEqual([entry]);
  });

  it("the same range moved one line down is still found: the search has no budget", () => {
    const narrow = Array.from({ length: 2600 }, (_, i) => String(i).padStart(100, "x"));
    const pin = String(pinOfLines(narrow, { start: 2100, end: 2499 }));
    const d = noBlame(["inserted", ...narrow]);
    expect(statusesOf(compareProvenance([machineA("2100-2499", pin)], d))).toEqual([
      { status: "moved", lines: "2100-2499", newLines: "2101-2500", noEvidence: true },
    ]);
  });
});

describe("an entry key outside the closed set", () => {
  const T_HUMAN = commit("5555555555555555555555555555555555555555", ADA, "docs: abc", [], pageText(FRONT_PLAIN, [...ABC, "-"]));
  const T_BOT = commit("6666666666666666666666666666666666666666", GRACE, "docs: xy",
    [["Generated-by", "claude-b"]], pageText(FRONT_PLAIN, [...ABC, "-", "x", "y"]));
  const front = ["---", "title: Rate limits", "provenance:", "  - generated-by: claude-a", "    lines: 1-3",
    `    integrity: ${PIN_ABC}`, "    note: reviewed", "---"];
  const NOTED = scenario(pageText(front, [...ABC, "-", "x", "y"]),
    [[Z, 1, 8], [T_HUMAN.sha, 4, 4], [T_BOT.sha, 8, 2]], byShaOf([T_HUMAN, T_BOT]));
  const noted = { ...machineA("1-3", PIN_ABC), note: "reviewed" };

  it("is compared, and survives the write beside a new range", () => {
    const d = derive(NOTED);
    expect(d.page.stamp).toEqual([noted]);
    const results = compareProvenance(d.page.stamp, d);
    expect(statusesOf(results)).toEqual([
      { status: "current", lines: "1-3", noEvidence: true },
      { status: "unset", lines: "5-6" },
    ]);
    expect(planProvenanceWrite(results, d)).toEqual([noted, machineB("5-6", String(pinOfLines(["x", "y"], { start: 1, end: 2 })))]);
    agreesWithLadder(NOTED);
  });

  it("survives a move, with only lines rewritten", () => {
    const d = deriveProvenance({ content: pageText(FRONT_PLAIN, ["-", ...ABC]), blame: [], commits: new Map() });
    const results = compareProvenance([noted], d);
    expect(statusesOf(results)).toEqual([{ status: "moved", lines: "1-3", newLines: "2-4", noEvidence: true }]);
    expect(planProvenanceWrite(results, d)).toEqual([{ ...noted, lines: "2-4" }]);
  });
});
