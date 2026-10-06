/**
 * `manni graph fill` on every format graph reads (proposal 0077 §4). Markdown
 * and MDX keep graph's YAML editor; every other page is written through its
 * meta extractor's `apply`, so HTML gets a `<meta name="graph">`, DITA an
 * `<othermeta>`, and a fenced AsciiDoc or reStructuredText page its fence. A
 * writer's refusal is that page's `error`, in meta's words, and the page is
 * left as it was.
 *
 * The formats fixture is only ever read from a copy: its goldens must not move.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill } from "../../../src/graph/commands/fill.js";
import { runBuild } from "../../../src/graph/commands/build.js";
import { extractorForExtension } from "../../../src/meta/index.js";
import { defined } from "../helpers/defined.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "formats",
);

function copy(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-graph-fillfmt-"));
  cpSync(fixture, dir, { recursive: true });
  for (const [name, text] of Object.entries(extra)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

/** The page's metadata as meta reads it. */
function metadata(dir: string, name: string): Record<string, unknown> {
  const ext = name.slice(name.lastIndexOf("."));
  return defined(extractorForExtension(ext)).extract(read(dir, name), name)
    .data;
}

const LABELS = {
  label: "Install",
  "alt-labels": ["setup"],
  confidence: { label: 0.95, "alt-labels": 0.9 },
};

function fill(
  dir: string,
  paths: string[],
  responses: Array<Record<string, unknown>>,
  extra: Parameters<typeof runFill>[0] = {},
) {
  return runFill({
    cwd: dir,
    paths,
    fields: ["label", "alt-labels", "type"],
    noCache: true,
    providerInstance: new MockProvider(responses.map((json) => ({ json }))),
    ...extra,
  });
}

describe("graph fill writes each format through meta", () => {
  it("writes an HTML page's graph block into one <meta name=graph>", async () => {
    const dir = copy();
    const before = read(dir, "guide.html");
    const report = await fill(
      dir,
      ["guide.html"],
      [
        {
          ...LABELS,
          sections: [
            { slug: "verify", type: "task", confidence: { type: 0.95 } },
          ],
        },
      ],
      { sections: true },
    );
    expect(report.results[0]?.error).toBeUndefined();
    expect(report.exitCode).toBe(0);
    expect(report.results[0]?.status).toBe("filled");

    const after = read(dir, "guide.html");
    expect(after.match(/<meta name="graph"/g)).toHaveLength(1);
    expect(after.startsWith("<!DOCTYPE html>")).toBe(true);
    // Everything from </head> on is the page's own.
    expect(after.slice(after.indexOf("</head>"))).toBe(
      before.slice(before.indexOf("</head>")),
    );
    expect(metadata(dir, "guide.html")["graph"]).toEqual({
      label: "Install",
      "alt-labels": ["setup"],
      sections: { verify: { type: "task" } },
    });
    // The record of the fill is written the same way.
    expect(metadata(dir, "guide.html")["meta-provenance"]).toBeDefined();

    // `graph build` reads the filled block back.
    await runBuild({ cwd: dir, out: join(dir, "graph.ttl") });
    const ttl = read(dir, "graph.ttl");
    expect(ttl).toContain('"Install"');
    expect(ttl).toContain('"setup"');

    // A second run has nothing left to do and changes no byte.
    const again = await fill(dir, ["guide.html"], [LABELS], {
      fields: ["label", "alt-labels"],
    });
    expect(again.results[0]?.status).toBe("complete");
    expect(read(dir, "guide.html")).toBe(after);
  });

  it("keeps a value a human set on an HTML page", async () => {
    const dir = copy();
    const human = read(dir, "guide.html").replace(
      "  </head>",
      '    <meta name="graph" content="{ label: Mine, sections: { verify: { type: concept } } }">\n  </head>',
    );
    writeFileSync(join(dir, "guide.html"), human);
    const report = await fill(
      dir,
      ["guide.html"],
      [
        {
          "alt-labels": ["setup"],
          confidence: { "alt-labels": 0.9 },
          sections: [
            { slug: "verify", type: "task", confidence: { type: 0.95 } },
          ],
        },
      ],
      { sections: true },
    );
    expect(report.results[0]).toMatchObject({
      status: "filled",
      fields: ["alt-labels"],
      preserved: ["sections.verify.type"],
    });
    expect(metadata(dir, "guide.html")["graph"]).toEqual({
      label: "Mine",
      "alt-labels": ["setup"],
      sections: { verify: { type: "concept" } },
    });
  });

  it("--dry-run on HTML reports what it would write and writes nothing", async () => {
    const dir = copy();
    const before = read(dir, "guide.html");
    const report = await fill(dir, ["guide.html"], [LABELS], { dryRun: true });
    expect(report.results[0]).toMatchObject({
      status: "proposed",
      fields: ["label", "alt-labels"],
    });
    expect(read(dir, "guide.html")).toBe(before);
  });

  it("prints a filled HTML page read from stdin", async () => {
    const dir = copy();
    const page = read(dir, "guide.html");
    const report = await fill(dir, ["-"], [LABELS], {
      as: "html",
      stdinContent: page,
    });
    expect(report.results[0]?.status).toBe("filled");
    const out = defined(report.stdinDocument);
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(
      defined(extractorForExtension(".html")).extract(out, "-").data["graph"],
    ).toEqual({ label: "Install", "alt-labels": ["setup"] });
  });

  it("writes a DITA topic's graph block into its prolog", async () => {
    const dir = copy();
    const report = await fill(dir, ["topic.dita"], [LABELS]);
    expect(report.results[0]?.error).toBeUndefined();
    expect(report.results[0]?.status).toBe("filled");
    const after = read(dir, "topic.dita");
    expect(after).toMatch(/<othermeta name="graph" content="[^"]*Install/);
    expect(metadata(dir, "topic.dita")["graph"]).toEqual({
      label: "Install",
      "alt-labels": ["setup"],
    });
  });

  it("edits a fenced AsciiDoc page's fence in place", async () => {
    const body = "= Fenced\n\nSome prose.\n\n== Part\n\nMore.\n";
    const dir = copy({ "fenced.adoc": `---\ntitle: Fenced\n---\n${body}` });
    const report = await fill(dir, ["fenced.adoc"], [LABELS]);
    expect(report.results[0]?.error).toBeUndefined();
    expect(report.results[0]?.status).toBe("filled");
    const after = read(dir, "fenced.adoc");
    expect(after.startsWith("---\n")).toBe(true);
    expect(after.endsWith(`---\n${body}`)).toBe(true);
    expect(metadata(dir, "fenced.adoc")["graph"]).toEqual({
      label: "Install",
      "alt-labels": ["setup"],
    });
  });

  it.each([
    ["notes.adoc", "asciidoc"],
    ["ref.rst", "rst"],
  ])(
    "refuses an unfenced %s page in meta's words",
    async (name, format) => {
      const dir = copy();
      const before = read(dir, name);
      const report = await fill(dir, [name], [LABELS]);
      expect(report.exitCode).toBe(1);
      expect(report.results[0]).toMatchObject({
        status: "error",
        error: `This ${format} document has no fenced front matter block; manni can only write fenced front matter for ${format}. Add a fenced block, or set the field manually.`,
      });
      expect(read(dir, name)).toBe(before);
    },
  );

  it("fills an unfenced AsciiDoc page whose manifest owns graph", async () => {
    // The page cannot take a write, and need not: every key goes to the
    // manifest, as `keyHome` decides for any format.
    const dir = copy({
      "manni.config.yaml": [
        "collections:",
        "  - name: formats",
        '    paths: ["*.adoc"]',
        "    externalMetadata:",
        '      - file: "{page}.meta.yaml"',
        "        keys: [graph, meta-provenance]",
        "graph:",
        "  baseIri: https://example.com/formats/",
        "",
      ].join("\n"),
      "notes.meta.yaml": "notes.adoc:\n  graph:\n    label: Notes\n",
    });
    const before = read(dir, "notes.adoc");
    const report = await fill(dir, ["notes.adoc"], [
      { "alt-labels": ["changelog"], confidence: { "alt-labels": 0.9 } },
    ]);
    expect(report.results[0]?.error).toBeUndefined();
    expect(report.results[0]).toMatchObject({
      status: "filled",
      fields: ["alt-labels"],
    });
    expect(read(dir, "notes.adoc")).toBe(before);
    expect(read(dir, "notes.meta.yaml")).toContain("changelog");
    expect(read(dir, "notes.meta.yaml")).toContain("label: Notes");
  });

  it("reports a fenced page whose graph is not a map, rather than writing past it", async () => {
    // mergedText falls back to a new fence only for meta's no-fence refusal.
    // Any other failure is the page's own problem and must reach the report.
    const page = "---\ngraph: 5\n---\n= Notes\n\nBody.\n";
    const dir = copy({
      "manni.config.yaml": [
        "collections:",
        "  - name: formats",
        '    paths: ["*.adoc"]',
        "    externalMetadata:",
        '      - file: "{page}.meta.yaml"',
        "        keys: [meta-provenance]",
        "graph:",
        "  baseIri: https://example.com/formats/",
        "",
      ].join("\n"),
      "fenced.adoc": page,
      "fenced.meta.yaml": "fenced.adoc:\n  meta-provenance: []\n",
    });
    const report = await fill(dir, ["fenced.adoc"], [LABELS]);
    expect(report.exitCode).toBe(1);
    expect(report.results[0]).toMatchObject({
      status: "error",
      error: 'fenced.adoc: metadata key "graph" is not a map',
    });
    expect(read(dir, "fenced.adoc")).toBe(page);
  });

  it("refuses an HTML page with no <head> in meta's words", async () => {
    const page = "<html><body><h1>Bare</h1><p>No head.</p></body></html>\n";
    const dir = copy({ "bare.html": page });
    const report = await fill(dir, ["bare.html"], [LABELS]);
    expect(report.exitCode).toBe(1);
    expect(report.results[0]).toMatchObject({
      status: "error",
      error:
        "This HTML document has no <head> element; manni meta fill writes metadata into <head>. Add one, or set the field manually.",
    });
    expect(read(dir, "bare.html")).toBe(page);
  });
});
