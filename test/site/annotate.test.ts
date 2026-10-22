/**
 * `manni site annotate` (proposal 0095), the command core over
 * test/site/fixtures/annotate/: a Starlight-shaped built site with one
 * stamped page and one unstamped page, and the chunk artifact `graph publish`
 * writes for it, from git and from outside git. Each test works on a copy.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "parse5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimTexts, renderAnnotate, runAnnotate, type AnnotateReport } from "../../src/site/commands/annotate.js";
import { SiteError } from "../../src/site/errors.js";
import { resetWarnings } from "../../src/shared/warn.js";

const FIXTURE = join(import.meta.dirname, "fixtures", "annotate");
const BASE = "https://example.com/doc/site/src/content/docs/";
const TOKEN = "~" + "AQ".repeat(41);

let root: string;
let stderr: string[];

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "manni-annotate-")));
  mkdirSync(join(root, ".git"));
  cpSync(FIXTURE, root, { recursive: true });
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const read = (rel: string): string => readFileSync(join(root, rel), "utf8");
const run = (opts: Partial<Parameters<typeof runAnnotate>[0]> = {}): AnnotateReport =>
  runAnnotate({ cwd: root, ...opts });

function failure(opts: Partial<Parameters<typeof runAnnotate>[0]> = {}): string {
  try {
    run(opts);
  } catch (e) {
    expect(e).toBeInstanceOf(SiteError);
    return (e as Error).message;
  }
  throw new Error("expected a SiteError");
}

interface El {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

/** Every element of a page, with its attributes and its text. */
function elements(html: string): El[] {
  const out: El[] = [];
  const walk = (node: unknown): void => {
    const n = node as { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: unknown[]; value?: string };
    if (n.tagName !== undefined) {
      out.push({ tag: n.tagName, attrs: Object.fromEntries((n.attrs ?? []).map((a) => [a.name, a.value])), text: textOf(n) });
    }
    for (const c of n.childNodes ?? []) walk(c);
  };
  walk(parse(html));
  return out;
}

function textOf(node: unknown): string {
  const n = node as { nodeName: string; childNodes?: unknown[]; value?: string };
  if (n.nodeName === "#text") return n.value ?? "";
  return (n.childNodes ?? []).map(textOf).join("");
}

const manni = (el: El | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(el?.attrs ?? {}).filter(([k]) => k.startsWith("data-manni-")));

const byText = (html: string, tag: string, text: string): El | undefined =>
  elements(html).find((e) => e.tag === tag && e.text.trim() === text);

function island(html: string): { page: string; commit: string | null; worktree: string | null; dates: unknown; records: { node: string; lines: string; pins: { items: { source: string }[] } }[] } {
  const el = elements(html).find((e) => e.attrs.id === "manni-provenance");
  expect(el?.tag).toBe("script");
  expect(el?.attrs.type).toBe("application/json");
  return JSON.parse(el?.text ?? "null") as ReturnType<typeof island>;
}

/** The page with every `data-manni-*` attribute and the island taken out. */
function stripped(html: string): string {
  return html
    .replace(/ data-manni-[a-z-]+="[^"]*"/g, "")
    .replace(/<script type="application\/json" id="manni-provenance">[\s\S]*?<\/script>\n/, "");
}

describe("the text a claim range reads", () => {
  it("clamps a range outside the page and reads an inverted one as empty", () => {
    const { text } = claimTexts(join(root, "site/src/content/docs/guide.md"), "guide.md");
    expect(text(1, 1)).toBe("Pinsholdtheirsentencestosourcelines.");
    expect(text(-5, 1)).toContain("Pinsholdtheirsentencestosourcelines.");
    expect(text(90, 99)).toBe("");
    expect(text(3, 1)).toBe("");
  });
});

describe("the join, on the stamped page", () => {
  it("places each pin on its block by lines, with the section node and the state", () => {
    run();
    const html = read("site/dist/guide/index.html");
    expect(manni(byText(html, "p", "Pins hold their sentences to source lines."))).toEqual({
      "data-manni-node": `${BASE}guide.md`,
      "data-manni-pins": "holds",
      "data-manni-state": "current",
    });
    expect(manni(byText(html, "p", "A drifted claim reads here & nowhere else."))).toEqual({
      "data-manni-node": `${BASE}guide.md`,
      "data-manni-pins": "drifts",
      "data-manni-state": "drifted",
    });
  });

  it("places a claim over two list items on both, and not on the list", () => {
    run();
    const html = read("site/dist/guide/index.html");
    for (const text of ["First step of the list.", "Second step of the list."]) {
      expect(manni(byText(html, "li", text))).toEqual({
        "data-manni-node": `${BASE}guide.md#setup`,
        "data-manni-pins": "list-steps",
        "data-manni-state": "current",
      });
    }
    expect(manni(elements(html).find((e) => e.tag === "ul"))).toEqual({});
  });

  it("names a pin with no id by its index in the page's citations", () => {
    run();
    expect(manni(byText(read("site/dist/guide/index.html"), "p", "A private claim cites an encrypted source."))).toMatchObject({
      "data-manni-pins": "#4",
    });
  });

  it("places a heading statement on its heading, with the section's applies-to", () => {
    run();
    expect(manni(byText(read("site/dist/guide/index.html"), "h2", "Setup"))).toEqual({
      "data-manni-node": `${BASE}guide.md#setup`,
      "data-manni-verified": "2026-10-01",
      "data-manni-verified-by": "doc-detective",
      "data-manni-statement": "current",
      "data-manni-applies-to": "cli ci",
    });
  });

  it("places a block statement on its block, as the graph:Block node", () => {
    run();
    expect(manni(byText(read("site/dist/guide/index.html"), "p", "Run the check before you merge."))).toEqual({
      "data-manni-node": `${BASE}guide.md#setup.1`,
      "data-manni-verified": "2026-10-20",
      "data-manni-verified-by": "vale doc-detective",
      "data-manni-statement": "changed",
    });
  });

  it("keeps the passage node on a block that holds a pin and a block statement", () => {
    const file = join(root, "graph", "chunks.en.jsonl");
    const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { provenance: { statements: unknown[] } });
    rows[0]?.provenance.statements.push({ data: { "last-verified": "2026-10-02" }, lines: "1-1", status: "current" });
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    run();
    expect(manni(byText(read("site/dist/guide/index.html"), "p", "Pins hold their sentences to source lines."))).toEqual({
      "data-manni-node": `${BASE}guide.md`,
      "data-manni-pins": "holds",
      "data-manni-state": "current",
      "data-manni-verified": "2026-10-02",
      "data-manni-statement": "current",
    });
  });

  it("marks <main> with the commit and the page's last-verified", () => {
    run();
    expect(manni(elements(read("site/dist/guide/index.html")).find((e) => e.tag === "main"))).toEqual({
      "data-manni-commit": "a".repeat(40),
      "data-manni-last-verified": "2026-10-21",
    });
  });
});

describe("the join, on the unstamped page", () => {
  it("places a claim whose text one block holds", () => {
    run();
    expect(manni(byText(read("site/dist/plain/index.html"), "p", "This sentence is found by its text alone."))).toEqual({
      "data-manni-node": `${BASE}plain.md`,
      "data-manni-pins": "by-text",
      "data-manni-state": "current",
    });
  });

  it("never breaks a tie: a repeated row is placed on neither", () => {
    run();
    const rows = elements(read("site/dist/plain/index.html")).filter((e) => e.tag === "tr");
    expect(rows.map(manni)).toEqual([{}, {}, {}]);
  });

  it("places no statement without line stamps", () => {
    run();
    expect(manni(byText(read("site/dist/plain/index.html"), "p", "Checked by hand."))).toEqual({});
  });
});

describe("what a page gains, and what it keeps", () => {
  it("removes every line stamp", () => {
    run();
    expect(read("site/dist/guide/index.html")).not.toContain("data-manni-src");
  });

  it("changes nothing else: the prose is byte-identical, with no stylesheet or script added", () => {
    const before = {
      guide: read("site/dist/guide/index.html").replace(/ data-manni-src="[^"]*"/g, ""),
      plain: read("site/dist/plain/index.html"),
    };
    run();
    for (const page of ["guide", "plain"] as const) {
      const after = read(`site/dist/${page}/index.html`);
      expect(stripped(after)).toBe(before[page]);
      expect(after.match(/<script/g)).toHaveLength(1);
      expect(after.match(/<link/g)?.length ?? 0).toBe(before[page].match(/<link/g)?.length ?? 0);
    }
  });

  it("writes one island before </body>, holding the page's records unchanged in lines order", () => {
    run();
    const html = read("site/dist/guide/index.html");
    expect(html).toMatch(/<script type="application\/json" id="manni-provenance">[^<]*<\/script>\n<\/body>/);
    const data = island(html);
    expect(data.page).toBe("site/src/content/docs/guide.md");
    expect(data.commit).toBe("a".repeat(40));
    expect(data.worktree).toBe("clean");
    expect(data.records.map((r) => r.lines)).toEqual(["1-12", "5-12"]);
    const rows = read("graph/chunks.en.jsonl").trim().split("\n").map((l) => JSON.parse(l) as { id: string; provenance: unknown });
    expect(data.records[0]).toEqual(rows.find((r) => r.id === `${BASE}guide.md`)?.provenance);
  });

  it("keeps an encrypted source a token", () => {
    run();
    const sources = island(read("site/dist/guide/index.html")).records[0]?.pins.items.map((i) => i.source);
    expect(sources).toContain(`${TOKEN}:1-3`);
  });

  it("escapes the island so no record can close the script", () => {
    const rows = read("graph/chunks.en.jsonl").replace('"source":"src/a.ts:1-2"', '"source":"</script><b>:1-2"');
    writeFileSync(join(root, "graph/chunks.en.jsonl"), rows);
    run();
    const html = read("site/dist/guide/index.html");
    expect(html.match(/<\/script>/g)).toHaveLength(1);
  });
});

describe("the report", () => {
  it("counts pages, pins and statements, and lists what it could not place with the reason", () => {
    const report = run();
    expect(JSON.parse(renderAnnotate(report, "json"))).toEqual({
      out: "site/dist",
      pages: 2,
      pins: { total: 8, placed: 5 },
      statements: { total: 3, placed: 2 },
      unplaced: [
        { page: "site/src/content/docs/missing.md", kind: "pin", ids: ["gone"], reason: "no-page" },
        { page: "plain/index.html", kind: "pin", ids: ["repeat"], reason: "repeated-text" },
        { page: "plain/index.html", kind: "pin", ids: ["dropped"], reason: "no-block" },
        { page: "plain/index.html", kind: "statement", ids: ["10-10"], reason: "no-block" },
      ],
      drifted: [{ page: "guide/index.html", ids: ["drifts"] }],
    });
  });

  it("prints the success line and one line per page finding", () => {
    expect(renderAnnotate(run(), "pretty")).toBe(
      [
        "site/dist: 2 pages annotated. 5 of 8 pins placed, 3 listed on their page only. 2 blocks carry a verification.",
        "  guide/index.html: 1 block drifted, because a source changed: drifts.",
        "  site/src/content/docs/missing.md: no built page at site/dist/missing/index.html.",
        "  plain/index.html: 1 pin not placed, because its text appears twice: repeat.",
        "  plain/index.html: 1 pin not placed, because no block holds its text: dropped.",
        "  plain/index.html: 1 statement not placed, because no block holds lines 10-10.",
      ].join("\n"),
    );
  });

  it("announces the framework, the site and the artifact on stderr", () => {
    run();
    expect(stderr[0]).toBe("manni: Starlight in site/. Annotating site/dist from graph/chunks.json.\n");
  });
});

describe("options", () => {
  it("reads --out and --chunks from the working directory", () => {
    cpSync(join(root, "site/dist"), join(root, "site/build"), { recursive: true });
    rmSync(join(root, "site/dist"), { recursive: true });
    cpSync(join(root, "graph"), join(root, "elsewhere"), { recursive: true });
    const report = run({ out: "site/build", chunks: "elsewhere/chunks.json" });
    expect(report.out).toBe("site/build");
    expect(stderr.join("")).toContain("Annotating site/build from elsewhere/chunks.json.");
  });

  it("reads site.out, relative to the site", () => {
    cpSync(join(root, "site/dist"), join(root, "site/public-html"), { recursive: true });
    writeFileSync(join(root, "manni.config.yaml"), "site:\n  dir: site\n  out: public-html\ngraph:\n  out: graph/graph.ttl\n");
    expect((run()).out).toBe("site/public-html");
  });
});

describe("outside git", () => {
  it("writes no data-manni-commit, keeps commit: null, and says so once", () => {
    run({ chunks: "graph-no-git/chunks.json" });
    for (const page of ["guide", "plain"]) {
      const html = read(`site/dist/${page}/index.html`);
      expect(html).not.toContain("data-manni-commit");
      expect(island(html).commit).toBeNull();
    }
    const said = stderr.join("").split("\n").filter((l) => l.includes("carries no commit"));
    expect(said).toEqual(["manni: chunks.json carries no commit, so pages get no data-manni-commit."]);
  });
});

describe("when it cannot run, exit 2", () => {
  it("names a missing built site", () => {
    rmSync(join(root, "site/dist"), { recursive: true });
    expect(failure()).toBe("no built site at site/dist. Run manni site build first, or pass --out.");
  });

  it("names a missing chunk artifact", () => {
    expect(failure({ chunks: "nope/chunks.json" })).toBe("nope/chunks.json does not exist; run manni graph publish.");
  });

  it("refuses an artifact from another graph", () => {
    writeFileSync(join(root, "graph/graph.jsonld"), '{"@graph":[{}]}\n');
    expect(failure()).toBe("graph/chunks.json was built from another graph; run manni graph publish.");
  });

  it("refuses a file that is not a chunk manifest", () => {
    writeFileSync(join(root, "graph/chunks.json"), "{}\n");
    expect(failure()).toBe("graph/chunks.json is not a chunk manifest; run manni graph publish.");
  });

  it("says a Nextra server build has no static pages", () => {
    writeFileSync(join(root, "site/package.json"), '{ "dependencies": { "nextra": "0.0.0" } }\n');
    expect(failure()).toBe('site/out does not exist. Nextra writes static pages only with output: "export" in next.config.');
  });

  it("says Mintlify has no local site", () => {
    writeFileSync(join(root, "site/package.json"), "{}\n");
    writeFileSync(join(root, "site/mint.json"), "{}\n");
    expect(failure()).toBe("Mintlify builds on its own host, so there is no local site to annotate.");
  });
});

describe("a unified framework with no stamps", () => {
  it("places by text alone, and says how to add the stamps", () => {
    const guide = read("site/dist/guide/index.html").replace(/ data-manni-src="[^"]*"/g, "");
    writeFileSync(join(root, "site/dist/guide/index.html"), guide);
    const report = run();
    expect(stderr.join("")).toContain(
      "manni: site/dist carries no line stamps, so blocks are placed by text alone. Add @hawkeyexl/manni/site/rehype to the framework's rehype plugins.\n",
    );
    expect(report.statements.placed).toBe(0);
  });

  it("does not suggest the plugin to a text-only framework", () => {
    writeFileSync(join(root, "site/package.json"), '{ "dependencies": { "vitepress": "0.0.0" } }\n');
    const guide = read("site/dist/guide/index.html").replace(/ data-manni-src="[^"]*"/g, "");
    writeFileSync(join(root, "site/dist/guide/index.html"), guide);
    run({ out: "site/dist" });
    expect(stderr.join("")).not.toContain("rehype");
  });
});

describe("a source that cannot be read", () => {
  it("says so once for the page, and still reports", () => {
    rmSync(join(root, "site/src/content/docs/plain.md"));
    const report = run();
    expect(report.pages).toBeGreaterThan(0);
    const said = stderr.join("").split("\n").filter((l) => l.includes("plain.md could not be read"));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(
      /^manni: site\/src\/content\/docs\/plain\.md could not be read, so its pins are placed by line alone: .+\.$/,
    );
  });
});

describe("escaping an attribute", () => {
  it("writes < as &lt; in a stamped value", () => {
    const rows = read("graph/chunks.en.jsonl").replace(/by-text/g, "a<b");
    writeFileSync(join(root, "graph/chunks.en.jsonl"), rows);
    run();
    expect(read("site/dist/plain/index.html")).toContain('data-manni-pins="a&lt;b"');
  });
});
