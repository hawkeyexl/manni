/**
 * A claim that is a metadata value (proposal 0108). On a strategy record, a
 * citation's claim can be a JSON Pointer into the page's own metadata, pinned
 * by the SHA-256 of the value's canonical JSON. Every other page keeps
 * today's behaviour, which `fallback.test.ts` holds byte for byte.
 *
 * Every case works in a throwaway copy of `test/fixtures/cite-pointer`, with
 * that copy as the root, so `src/limits.ts` is the source.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { addMessage } from "../../src/cite/cli.js";
import { runAdd } from "../../src/cite/commands/add.js";
import { runCheck } from "../../src/cite/commands/check.js";
import { runUpdate } from "../../src/cite/commands/update.js";
import { noGit } from "../../src/cite/core/git.js";
import { RULE_DESCRIPTIONS, guidanceFor } from "../../src/cite/core/severity.js";
import { renderCheckGithub } from "../../src/cite/reporters/github.js";
import { renderCheckJson } from "../../src/cite/reporters/json.js";
import { renderCheckPretty, renderUpdatePretty } from "../../src/cite/reporters/pretty.js";
import { renderCheckSarif } from "../../src/cite/reporters/sarif.js";
import { CiteError } from "../../src/cite/errors.js";
import { valuePin } from "../../src/shared/pin.js";
import type { AddOptions, CheckRun } from "../../src/cite/types.js";
import { commitAll, gitAvailable, makeTempRepo, removeTempRepo } from "../helpers/temp-repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "cite-pointer");

const P0 = "A request times out with no hint.";
const P1 = "He does not know the retry count.";
/** The pin of P0: the SHA-256 of `"A request times out with no hint."`, quotes included. */
const P0_PIN = "sha256-c56558bf647d03e540ddcb461a22dc17c760420163de9d22c4c5718c27c1fdfb";
const SRC_L2 = "sha256-78af1d3321f9cbb177a7e4c958e39be56fd14cb93c1e441778bc4232e0fe4b1f";
const SRC_L3 = "sha256-e9f5bdf94a12c610b54573d2b66347592887805e59c69b64803a8c0d30edaea3";

const sha = (text: string): string => `sha256-${createHash("sha256").update(text, "utf8").digest("hex")}`;

let cwd = "";
afterEach(() => {
  removeTempRepo(cwd);
  cwd = "";
});

/** A fresh copy of the fixture, as the working directory and the root. */
function workspace(): string {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "manni-cite-pointer-")));
  cpSync(FIXTURE, cwd, { recursive: true });
  return cwd;
}

function add(over: Partial<AddOptions> & { page: string; src: string }) {
  return runAdd({ cwd, root: cwd, noConfig: true, commitSha: false, env: {}, gitClient: noGit(), ...over });
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CiteError);
    return (e as Error).message;
  }
  throw new Error("expected a refusal");
}

interface Pin {
  id: string;
  pointer?: string;
  lines?: number;
  integrity: string;
  src?: number;
  quote?: boolean;
  extra?: string[];
}

/**
 * A persona whose `pains` are the given items, carrying `pins` in its own
 * frontmatter. `type` is optional, so the same page can be a plain one.
 */
function persona(pains: string[], pins: Pin[], opts: { type?: boolean; body?: string[] } = {}): string {
  const front = ["---", ...(opts.type === false ? [] : ["type: persona"]), "id: theo", "title: Theo", "pains:"];
  for (const pain of pains) front.push(`  - ${pain}`);
  if (pins.length > 0) front.push("citations:");
  for (const pin of pins) {
    front.push(`  - id: ${pin.id}`, "    claim:");
    if (pin.lines !== undefined) front.push(`      lines: ${String(pin.lines)}`);
    if (pin.pointer !== undefined) front.push(`      pointer: ${pin.pointer}`);
    front.push(`      integrity: ${pin.integrity}`, "    source:", "      file: src/limits.ts");
    front.push(`      lines: ${String(pin.src ?? 2)}`, `      integrity: ${pin.src === 3 ? SRC_L3 : SRC_L2}`);
    if (pin.quote === true) front.push("    quote: true");
    front.push(...(pin.extra ?? []));
  }
  front.push("---");
  return [...front, ...(opts.body ?? ["# Theo", "", "Theo opened a pull request."]), ""].join("\n");
}

function writePage(name: string, text: string): string {
  writeFileSync(join(cwd, name), text, "utf8");
  return name;
}

async function check(name: string, opts: { git?: boolean } = {}): Promise<CheckRun> {
  return runCheck({
    cwd,
    root: cwd,
    noConfig: true,
    env: {},
    inputs: [name],
    ...(opts.git === true ? {} : { gitClient: noGit(), pageGitClient: noGit() }),
  });
}

describe("the value pin", () => {
  it("is the SHA-256 of the value's canonical JSON, a string with its quotes", () => {
    expect(valuePin(P0)).toBe(P0_PIN);
  });

  it("sorts every object's keys by code unit, integer-like keys included", () => {
    expect(valuePin({ b: 1, a: [1, "x"], "10": true, "2": null })).toBe(
      sha('{"10":true,"2":null,"a":[1,"x"],"b":1}'),
    );
    expect(valuePin([{ z: "é", y: 1.5 }])).toBe(sha('[{"y":1.5,"z":"é"}]'));
  });
});

describe("cite add with a pointer, on a record", () => {
  it("pins the value and writes claim.pointer", async () => {
    workspace();
    const result = await add({ page: "persona.md#/pains/0", src: "src/limits.ts:2", id: "timeout" });
    expect(result.file).toBe("persona.md");
    expect(result.citation.claim).toEqual({ pointer: "/pains/0", integrity: P0_PIN });
    const written = parseYaml(readFileSync(join(cwd, "persona.md"), "utf8").split("---")[1] ?? "") as {
      citations: unknown[];
    };
    expect(written.citations[0]).toEqual({
      id: "timeout",
      claim: { pointer: "/pains/0", integrity: P0_PIN },
      source: { file: "src/limits.ts", lines: 2, integrity: SRC_L2 },
    });
    expect(addMessage(result)).toBe(
      'persona.md: added timeout to frontmatter (claim at /pains/0, sha256-c56558bf…; source src/limits.ts:2 "export const FETCH_TIMEOUT_MS = 10_000;", sha256-78af1d33…, no commit)',
    );
  });

  it("takes the pointer as AddOptions.pagePointer too", async () => {
    workspace();
    const result = await add({ page: "persona.md", pagePointer: "/pains/1", src: "src/limits.ts:3", id: "retries" });
    expect(result.citation.claim).toEqual({ pointer: "/pains/1", integrity: sha(JSON.stringify(P1)) });
  });

  it("writes into the record's {page} sidecar when the collection declares one", async () => {
    workspace();
    const config = join(cwd, "manni.config.yaml");
    writeFileSync(
      config,
      [
        "collections:",
        "  - name: strategy",
        '    paths: ["*.md"]',
        "    externalMetadata:",
        '      - file: "{page}.citations.yaml"',
        "        keys: [citations]",
        "",
      ].join("\n"),
    );
    const result = await runAdd({
      cwd,
      root: cwd,
      configPath: config,
      commitSha: false,
      env: {},
      gitClient: noGit(),
      page: "persona.md#/pains/0",
      src: "src/limits.ts:2",
      id: "timeout",
    });
    expect(result.placed).toBe("manifest");
    expect(result.manifest?.file).toBe("persona.citations.yaml");
    expect(addMessage(result)).toContain("added timeout to persona.citations.yaml:");
    expect(addMessage(result)).toContain("(claim at /pains/0, sha256-c56558bf…;");
    const run = await runCheck({ cwd, root: cwd, configPath: config, env: {}, inputs: ["persona.md"], gitClient: noGit(), pageGitClient: noGit() });
    expect(run.pages[0]?.citations.map((c) => [c.claim?.status, c.claim?.pointer])).toEqual([["current", "/pains/0"]]);
  });

  it("names the pointer for a frontmatter line where a value starts", async () => {
    workspace();
    expect(await refusal(add({ page: "persona.md", pageLines: { start: 9, end: 9 }, src: "src/limits.ts:2" }))).toBe(
      "persona.md:9 is in the frontmatter. Cite the value there as persona.md#/pains/0.",
    );
    expect(await refusal(add({ page: "persona.md", pageLines: { start: 4, end: 4 }, src: "src/limits.ts:2" }))).toBe(
      "persona.md:4 is in the frontmatter. Cite the value there as persona.md#/title.",
    );
  });

  it("says when a frontmatter line starts no value", async () => {
    workspace();
    expect(await refusal(add({ page: "persona.md", pageLines: { start: 1, end: 1 }, src: "src/limits.ts:2" }))).toBe(
      "persona.md:1 is in the frontmatter, and starts no value. Cite a value as persona.md#/<key>.",
    );
  });

  it.each([
    ["persona.md#/pains/9", "persona.md#/pains/9 names no value in the page's metadata."],
    ["persona.md#/nothing", "persona.md#/nothing names no value in the page's metadata."],
    ["persona.md#/citations/0", "persona.md#/citations/0 is a citation, not a claim."],
    ["persona.md#/citations", "persona.md#/citations is a citation, not a claim."],
    ["persona.md#/pains/0~2", 'Invalid pointer "/pains/0~2": write ~ as ~0 and / as ~1.'],
  ])("refuses %s", async (page, message) => {
    workspace();
    expect(await refusal(add({ page, src: "src/limits.ts:2" }))).toBe(message);
  });

  it("refuses an empty list or mapping", async () => {
    workspace();
    writePage("empty.md", ["---", "type: persona", "id: e", "goals: []", "owner: {}", "---", "# E", ""].join("\n"));
    expect(await refusal(add({ page: "empty.md#/goals", src: "src/limits.ts:2" }))).toBe("empty.md#/goals is empty.");
    expect(await refusal(add({ page: "empty.md#/owner", src: "src/limits.ts:2" }))).toBe("empty.md#/owner is empty.");
  });

  it("refuses an encrypted value", async () => {
    workspace();
    const cipher = `~${"A".repeat(90)}`;
    writePage("secret.md", ["---", "type: persona", "id: s", `owner: "${cipher}"`, "---", "# S", ""].join("\n"));
    expect(await refusal(add({ page: "secret.md#/owner", src: "src/limits.ts:2" }))).toBe(
      "secret.md#/owner holds an encrypted value. A claim's pin is public, so cite a plain value.",
    );
  });

  it("refuses --marker and --quote with a pointer", async () => {
    workspace();
    expect(await refusal(add({ page: "persona.md#/pains/0", src: "src/limits.ts:2", marker: true, id: "x" }))).toBe(
      "--marker anchors body text, so it takes page lines, not a pointer.",
    );
    expect(await refusal(add({ page: "persona.md#/pains/0", src: "src/limits.ts:2", quote: true }))).toBe(
      "--quote needs the block's lines: persona.md:L1-L2.",
    );
  });

  it("refuses the same pointer and source twice", async () => {
    workspace();
    await add({ page: "persona.md#/pains/0", src: "src/limits.ts:2", id: "timeout" });
    expect(await refusal(add({ page: "persona.md#/pains/0", src: "src/limits.ts:2", id: "timeout" }))).toBe(
      "persona.md already has an entry timeout.",
    );
    expect(await refusal(add({ page: "persona.md#/pains/0", src: "src/limits.ts:2", id: "other" }))).toBe(
      "persona.md already has an entry for /pains/0 and src/limits.ts:2 (timeout).",
    );
  });
});

describe("cite add's usage errors, through the built bin", () => {
  const bin = join(here, "..", "..", "dist", "cli.js");
  it.each([
    [["persona.md:9"], "manni: persona.md:9 is in the frontmatter. Cite the value there as persona.md#/pains/0."],
    [["persona.md:1"], "manni: persona.md:1 is in the frontmatter, and starts no value. Cite a value as persona.md#/<key>."],
    [["persona.md#/pains/9"], "manni: persona.md#/pains/9 names no value in the page's metadata."],
    [["persona.md#/citations/0"], "manni: persona.md#/citations/0 is a citation, not a claim."],
    [["persona.md#/pains/0~2"], 'manni: Invalid pointer "/pains/0~2": write ~ as ~0 and / as ~1.'],
    [["persona.md#/pains/0", "--marker", "--id", "x"], "manni: --marker anchors body text, so it takes page lines, not a pointer."],
    [["persona.md#/pains/0", "--quote"], "manni: --quote needs the block's lines: persona.md:L1-L2."],
  ])("%j prints its line and exits 2", (args, line) => {
    workspace();
    const [page, ...rest] = args;
    const run = spawnSync(
      process.execPath,
      [bin, "cite", "add", "--no-config", "--root", ".", page ?? "", "src/limits.ts:2", ...rest],
      { cwd, encoding: "utf8" },
    );
    expect(run.stderr).toBe(`${line}\n`);
    expect(run.status).toBe(2);
  });
});

describe("cite add on a page that is not a record", () => {
  it("reads the whole argument as a path", async () => {
    workspace();
    expect(await refusal(add({ page: "plain.md#/pains/0", src: "src/limits.ts:2" }))).toBe(
      'File not found: "plain.md#/pains/0". Check the path. Named paths resolve from the working directory.',
    );
  });

  it("keeps today's frontmatter refusal", async () => {
    workspace();
    expect(await refusal(add({ page: "plain.md", pageLines: { start: 8, end: 8 }, src: "src/limits.ts:2" }))).toBe(
      "plain.md:8 is in the frontmatter. A claim is body text.",
    );
  });

  it("reports a pointer entry entry-invalid, in 1.2.0's words", async () => {
    workspace();
    const run = await check("plain-pointer.md");
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.message])).toEqual([
      ["entry-invalid", "/claim must NOT have additional properties"],
    ]);
  });
});

describe("cite check over a pointer claim", () => {
  const pins = (pointer = "/pains/0"): Pin[] => [{ id: "a", pointer, integrity: P0_PIN }];

  it("reads current, at the value's line", async () => {
    workspace();
    writePage("p.md", persona([P0, P1], pins()));
    const run = await check("p.md");
    const [result] = run.pages[0]?.citations ?? [];
    expect(result?.claim).toMatchObject({ status: "current", pointer: "/pains/0" });
    expect(result?.anchor).toBe("claim");
    expect(result?.anchorLine).toBe(6);
    expect(run.pages[0]?.findings).toEqual([]);
    expect(renderCheckPretty(run, { color: false })).toContain("✓ a   #/pains/0 current   src/limits.ts:2 current");
  });

  it("reads moved, a notice on the value's new line, with the pointer wording", async () => {
    workspace();
    writePage("p.md", persona([P1, P0], pins()));
    const run = await check("p.md");
    const page = run.pages[0];
    expect(page?.citations[0]?.claim).toMatchObject({ status: "moved", pointer: "/pains/0", newPointer: "/pains/1" });
    expect(page?.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      ["claim-moved", "notice", 7, "a: the claim moved from #/pains/0 to #/pains/1. Run manni cite update."],
    ]);
    expect(page?.findings[0]?.guidance?.description).toBe("The pinned metadata value sits at another pointer.");
    const pretty = renderCheckPretty(run, { color: false });
    expect(pretty).toContain("ℹ a   #/pains/0 moved -> #/pains/1   src/limits.ts:2 current");
    expect(pretty).toContain("      Run manni cite update.\n      manni:cite claim-moved: The pinned metadata value sits at another pointer.");
    expect(run.summary.failed).toBe(0);
  });

  it("reads moved-ambiguous, a warning naming every candidate in document order", async () => {
    workspace();
    writePage("p.md", persona([P1, P0, P0], pins()));
    const run = await check("p.md");
    const page = run.pages[0];
    expect(page?.citations[0]?.claim).toMatchObject({
      status: "moved-ambiguous",
      candidates: ["/pains/1", "/pains/2"],
    });
    expect(page?.findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      [
        "claim-moved-ambiguous",
        "warning",
        "a: the claim at #/pains/0 now appears at #/pains/1 and #/pains/2. Run manni cite remove --only a, then cite add the pointer you mean.",
      ],
    ]);
    expect(page?.findings[0]?.guidance?.description).toBe(
      "The pinned metadata value now occurs at more than one pointer.",
    );
    expect(renderCheckPretty(run, { color: false })).toContain("↕ a   #/pains/0 moved-ambiguous (#/pains/1, #/pains/2)");
  });

  it("reads changed, a warning, when the value was edited in place", async () => {
    workspace();
    writePage("p.md", persona(["A request times out with no fix.", P1], pins()));
    const run = await check("p.md");
    const page = run.pages[0];
    expect(page?.citations[0]?.claim).toMatchObject({ status: "changed", pointer: "/pains/0" });
    expect(page?.findings.map((f) => [f.rule, f.severity, f.line, f.message])).toEqual([
      [
        "claim-changed",
        "warning",
        6,
        "a: the claim at #/pains/0 has changed since it was pinned. Check it still matches the source, then run manni cite update --accept --only a.",
      ],
    ]);
    expect(page?.findings[0]?.guidance?.description).toBe("The metadata value was edited since it was pinned.");
    expect(renderCheckPretty(run, { color: false })).toContain("↕ a   #/pains/0 changed   src/limits.ts:2 current");
  });

  it("reads missing when the pointer names no value, on its nearest parent's line", async () => {
    workspace();
    writePage("p.md", persona([P1], pins("/pains/1")));
    const run = await check("p.md");
    const page = run.pages[0];
    expect(page?.citations[0]?.claim).toMatchObject({ status: "missing", pointer: "/pains/1" });
    expect(page?.findings.map((f) => [f.rule, f.ruleId, f.severity, f.line, f.message])).toEqual([
      [
        "claim-missing",
        "manni:cite/claim-missing",
        "warning",
        5,
        "a: the value pinned at #/pains/1 is gone. Run manni cite remove --only a. If the claim still stands, cite add it at its pointer now.",
      ],
    ]);
    expect(page?.findings[0]?.guidance?.description).toBe("The pinned metadata value is gone from the record.");
    expect(renderCheckPretty(run, { color: false })).toContain("↕ a   #/pains/1 missing   src/limits.ts:2 current");
    expect(run.summary.failed).toBe(0);
  });

  it("reads missing, not changed, for a deleted item whose neighbour another entry pins", async () => {
    workspace();
    const two: Pin[] = [
      { id: "a", pointer: "/pains/0", integrity: P0_PIN },
      { id: "b", pointer: "/pains/1", integrity: sha(JSON.stringify(P1)), src: 3 },
    ];
    writePage("p.md", persona([P1], two));
    const run = await check("p.md");
    expect(run.pages[0]?.citations.map((c) => [c.citation.id, c.claim?.status, c.claim?.newPointer])).toEqual([
      ["a", "missing", undefined],
      ["b", "moved", "/pains/0"],
    ]);
  });

  it("reads changed for a deleted item whose neighbour nobody pins", async () => {
    workspace();
    writePage("p.md", persona([P1], pins()));
    const run = await check("p.md");
    expect(run.pages[0]?.citations[0]?.claim?.status).toBe("changed");
  });

  it("refuses a claim with lines and a pointer", async () => {
    workspace();
    writePage("p.md", persona([P0], [{ id: "a", pointer: "/pains/0", lines: 1, integrity: P0_PIN }]));
    const run = await check("p.md");
    expect(run.pages[0]?.findings.map((f) => [f.rule, f.message])).toEqual([
      ["entry-invalid", "a: claim has lines and a pointer. Keep one."],
    ]);
  });

  it("refuses a pointer with a marker, and a pointer with quote: true", async () => {
    workspace();
    writePage(
      "m.md",
      persona([P0], [{ id: "a", pointer: "/pains/0", integrity: P0_PIN }], {
        body: ["# Theo", "", "<!-- cite a -->", "Theo opened a pull request."],
      }),
    );
    const marked = await check("m.md");
    expect(marked.pages[0]?.findings.map((f) => [f.rule, f.message])).toEqual([
      ["anchor-invalid", "a has a claim pointer and a marker. Keep one."],
    ]);
    writePage("q.md", persona([P0], [{ id: "a", pointer: "/pains/0", integrity: P0_PIN, quote: true }]));
    const quoted = await check("q.md");
    expect(quoted.pages[0]?.findings.map((f) => [f.rule, f.message])).toEqual([
      ["anchor-invalid", "a: a quote's claim is a fenced block, so it takes claim.lines, not claim.pointer."],
    ]);
  });

  it("keeps today's wording on a body-line claim", () => {
    expect(guidanceFor("claim-moved").description).toBe("The pinned page text sits at a different line.");
    expect(guidanceFor("claim-changed").description).toBe("The sentence was edited since it was pinned.");
    expect(RULE_DESCRIPTIONS["claim-moved-ambiguous"]).toBe("The pinned page text now occurs in more than one place.");
  });

  it.skipIf(!gitAvailable())("reads changed since its baseline commit, with a diff of the value", async () => {
    cwd = makeTempRepo({ files: {} });
    cpSync(FIXTURE, cwd, { recursive: true });
    writePage("p.md", persona([P0, P1], pins()));
    const base = commitAll(cwd, "pin a pain");
    writePage("p.md", persona(["A request times out with no fix.", P1], pins()));
    commitAll(cwd, "reword the pain");
    const run = await check("p.md", { git: true });
    const claim = run.pages[0]?.citations[0]?.claim;
    expect(claim).toMatchObject({ status: "changed", commitSha: base, historyAvailable: true });
    expect(claim?.diff).toBe(
      [
        `--- p.md@${base.slice(0, 7)}:#/pains/0`,
        "+++ p.md:#/pains/0",
        `-${P0}`,
        "+A request times out with no fix.",
      ].join("\n"),
    );
    const pretty = renderCheckPretty(run, { color: false, showDiff: true });
    expect(pretty).toContain(`#/pains/0 changed since ${base.slice(0, 7)}, 1 commit`);
    expect(pretty).toContain("        reword the pain");
  });
});

describe("the reporters", () => {
  it("print a pointer claim's JSON, github and SARIF on the value's line", async () => {
    workspace();
    writePage("p.md", persona([P1], [{ id: "a", pointer: "/pains/1", integrity: P0_PIN }]));
    const run = await check("p.md");
    const json = JSON.parse(renderCheckJson(run)) as { pages: { citations: unknown[] }[] };
    expect(json.pages[0]?.citations[0]).toEqual({
      id: "a",
      origin: { kind: "frontmatter", file: "p.md", line: 8 },
      anchor: "claim",
      at: 5,
      claim: { status: "missing", pointer: "/pains/1" },
      source: { src: "src/limits.ts:2", status: "current" },
    });
    expect(renderCheckGithub(run)).toMatch(/^::warning file=p\.md,line=5,title=manni%3Acite\/claim-missing::/);
    const sarif = JSON.parse(renderCheckSarif(run)) as {
      runs: { results: { ruleId: string; locations: { physicalLocation: { region: { startLine: number } } }[] }[] }[];
    };
    const [result] = sarif.runs[0]?.results ?? [];
    expect(result?.ruleId).toBe("manni:cite/claim-missing");
    expect(result?.locations[0]?.physicalLocation.region.startLine).toBe(5);
  });

  it("print a moved claim's newPointer and where the value is now", async () => {
    workspace();
    writePage("p.md", persona([P1, P0], [{ id: "a", pointer: "/pains/0", integrity: P0_PIN }]));
    const json = JSON.parse(renderCheckJson(await check("p.md"))) as {
      pages: { citations: Record<string, unknown>[] }[];
    };
    const [row] = json.pages[0]?.citations ?? [];
    expect(row?.at).toBe(7);
    expect(row?.claim).toEqual({ status: "moved", pointer: "/pains/0", newPointer: "/pains/1" });
  });
});

describe("cite update over a pointer claim", () => {
  const update = (name: string, over: { accept?: boolean; only?: string[]; git?: boolean } = {}) =>
    runUpdate({
      cwd,
      root: cwd,
      noConfig: true,
      env: {},
      inputs: [name],
      ...(over.accept === true ? { accept: true } : {}),
      ...(over.only === undefined ? {} : { only: over.only }),
      ...(over.git === true ? {} : { gitClient: noGit(), pageGitClient: noGit() }),
    });

  it("rewrites a moved pointer in place", async () => {
    workspace();
    writePage("p.md", persona([P1, P0], [{ id: "a", pointer: "/pains/0", integrity: P0_PIN }]));
    const run = await update("p.md");
    expect(renderUpdatePretty(run, { color: false })).toBe(
      ["p.md: a claim #/pains/0 -> #/pains/1 (moved)", "1 citation rewritten in 1 file, 0 skipped"].join("\n"),
    );
    expect(readFileSync(join(cwd, "p.md"), "utf8")).toContain("      pointer: /pains/1\n");
    const after = await check("p.md");
    expect(after.pages[0]?.citations[0]?.claim?.status).toBe("current");
  });

  it("re-pins a changed value with --accept, and prints it", async () => {
    workspace();
    writePage("p.md", persona(["A request times out with no fix.", P1], [{ id: "a", pointer: "/pains/0", integrity: P0_PIN }]));
    const run = await update("p.md", { accept: true });
    expect(renderUpdatePretty(run, { color: false })).toBe(
      [
        'p.md: a claim at #/pains/0 re-pinned (changed; now "A request times out with no fix.")',
        "1 citation rewritten in 1 file, 0 skipped",
      ].join("\n"),
    );
    expect(readFileSync(join(cwd, "p.md"), "utf8")).toContain(
      `      integrity: ${sha(JSON.stringify("A request times out with no fix."))}\n`,
    );
  });

  it("skips a missing and a moved-ambiguous value, with the remedy", async () => {
    workspace();
    writePage("gone.md", persona([P1], [{ id: "a", pointer: "/pains/1", integrity: P0_PIN }]));
    const gone = await update("gone.md", { accept: true });
    expect(renderUpdatePretty(gone, { color: false })).toBe(
      [
        "gone.md: a  ↕ skipped: a: the value pinned at #/pains/1 is gone. Run manni cite remove --only a. If the claim still stands, cite add it at its pointer now.",
        "0 citations rewritten in 0 files, 1 skipped",
      ].join("\n"),
    );
    writePage("two.md", persona([P1, P0, P0], [{ id: "a", pointer: "/pains/0", integrity: P0_PIN }]));
    const two = await update("two.md", { accept: true });
    expect(two.pages[0]?.skipped.map((f) => f.rule)).toEqual(["claim-moved-ambiguous"]);
    expect(two.rewritten).toBe(0);
  });

  it.skipIf(!gitAvailable())("refuses a replacement, unless --only names it", async () => {
    cwd = makeTempRepo({ files: {} });
    cpSync(FIXTURE, cwd, { recursive: true });
    const pins: Pin[] = [{ id: "a", pointer: "/pains/0", integrity: P0_PIN }];
    writePage("p.md", persona([P0, P1], pins));
    const base = commitAll(cwd, "pin a pain");
    writePage("p.md", persona(["Configuration lives in one file per tool.", P1], pins));
    commitAll(cwd, "replace the pain");
    const refused = await update("p.md", { accept: true, git: true });
    expect(renderUpdatePretty(refused, { color: false }).split("\n")[0]).toBe(
      `p.md: a claim at #/pains/0 skipped: that value now holds text sharing 0% of the claim's words at ${base.slice(0, 7)}. Re-add it with cite add.`,
    );
    expect(refused.exitCode).toBe(1);
    const named = await update("p.md", { accept: true, only: ["a"], git: true });
    expect(renderUpdatePretty(named, { color: false }).split("\n")[0]).toBe(
      'p.md: a claim at #/pains/0 re-pinned (replaced; now "Configuration lives in one file per tool.")',
    );
  });
});
