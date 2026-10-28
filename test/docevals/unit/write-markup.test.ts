/**
 * Writing evals for an HTML or XML page (proposal 0125, decision 21). A YAML
 * block cannot go onto markup, so where no manifest of the page's collection
 * owns `evals`, `fill`, `generate` and `promote --write` refuse with exit 2 and
 * the page is untouched. Where one does, the write lands there as for any page.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill } from "../../../src/docevals/commands/fill.js";
import { runGenerate } from "../../../src/docevals/commands/generate.js";
import { runPromote } from "../../../src/docevals/commands/promote.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const HTML = [
  "<!DOCTYPE html>",
  "<html>",
  "  <head><title>Install</title></head>",
  "  <body><h1>Install</h1><p>Run the installer.</p></body>",
  "</html>",
  "",
].join("\n");

const XML = '<?xml version="1.0"?>\n<doc type="guide">\n  <p>Run the installer.</p>\n</doc>\n';

/** A workspace with `pages` under `docs/`, read as one collection. */
function workspace(pages: Record<string, string>, manifest?: string): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-markup-write-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  for (const [name, content] of Object.entries(pages)) writeFileSync(join(root, "docs", name), content);
  const external = manifest === undefined ? "" : `    externalMetadata:\n${manifest}`;
  writeFileSync(
    join(root, "manni.config.yaml"),
    `collections:\n  - name: site\n    paths: ["docs/**/*"]\n${external}docevals:\n  fill:\n    confidenceThreshold: 0.5\n`,
  );
  return root;
}

const proposals = (): MockProvider =>
  new MockProvider([
    {
      json: {
        evals: [
          {
            id: "names-installer",
            assertion: "The page names the installer.",
            confidence: 0.9,
            examples: { pass: "Names it.", fail: "Does not." },
          },
        ],
      },
    },
  ]);

/** What `run` rejected with. */
async function rejection(run: Promise<unknown>): Promise<unknown> {
  try {
    await run;
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal");
}

describe("an eval write to an HTML or XML page", () => {
  it("refuses fill on an HTML page no manifest owns, before asking a model", async () => {
    const root = workspace({ "install.htm": HTML });
    const provider = proposals();
    const e = await rejection(runFill([], { cwd: root, providerInstance: provider, noCache: true }));
    expect(e).toBeInstanceOf(DocevalsError);
    expect((e as Error).message).toBe(
      "docs/install.htm is HTML, so its evals live in a manifest. Give its collection an externalMetadata entry that owns evals.",
    );
    expect(provider.requests).toHaveLength(0);
    expect(readFileSync(join(root, "docs/install.htm"), "utf8")).toBe(HTML);
  });

  it("refuses generate on an HTML page no manifest owns, before asking a model", async () => {
    const page = HTML.replace(
      "<title>Install</title>",
      `<title>Install</title><meta name="evals" content='[{id: names-installer, assertion: "The page names the installer.", grader: command}]'>`,
    );
    const root = workspace({ "install.htm": page });
    const provider = new MockProvider([{ json: { code: "process.exit(0);\n" } }]);
    const e = await rejection(runGenerate([], { cwd: root, providerInstance: provider }));
    expect(e).toBeInstanceOf(DocevalsError);
    expect((e as Error).message).toBe(
      "docs/install.htm is HTML, so its evals live in a manifest. Give its collection an externalMetadata entry that owns evals.",
    );
    expect(provider.requests).toHaveLength(0);
    expect(readFileSync(join(root, "docs/install.htm"), "utf8")).toBe(page);
  });

  it("refuses before any page is written, a Markdown page included", async () => {
    const md = "---\ntitle: A\n---\n\nRun the installer.\n";
    const root = workspace({ "a.md": md, "install.htm": HTML });
    await rejection(runFill([], { cwd: root, providerInstance: proposals(), noCache: true }));
    expect(readFileSync(join(root, "docs/a.md"), "utf8")).toBe(md);
  });

  it("names an XML page as XML", async () => {
    const root = workspace({ "guide.xml": XML });
    const e = await rejection(runFill([], { cwd: root, providerInstance: proposals(), noCache: true }));
    expect((e as Error).message).toBe(
      "docs/guide.xml is XML, so its evals live in a manifest. Give its collection an externalMetadata entry that owns evals.",
    );
    expect(readFileSync(join(root, "docs/guide.xml"), "utf8")).toBe(XML);
  });

  it("writes to the manifest that owns evals, and leaves the page alone", async () => {
    const root = workspace(
      { "install.htm": HTML },
      '      - file: "{page}.meta.yaml"\n        keys: [evals, meta-provenance]\n',
    );
    const report = await runFill([], { cwd: root, providerInstance: proposals(), noCache: true });
    expect(report.exitCode).toBe(0);
    expect(report.results[0]).toMatchObject({ status: "filled", wroteTo: "docs/install.meta.yaml" });
    expect(readFileSync(join(root, "docs/install.htm"), "utf8")).toBe(HTML);
    const manifest = readFileSync(join(root, "docs/install.meta.yaml"), "utf8");
    expect(manifest).toContain("names-installer");
    expect(manifest).toContain("meta-provenance");
  });

  it("records no meta-provenance on the page when only evals have a manifest", async () => {
    const root = workspace(
      { "install.htm": HTML },
      '      - file: "{page}.meta.yaml"\n        keys: [evals]\n',
    );
    const report = await runFill([], { cwd: root, providerInstance: proposals(), noCache: true });
    expect(report.results[0]).toMatchObject({
      status: "filled",
      metaProvenance: { written: false, skipReason: "unwritable" },
    });
    expect(readFileSync(join(root, "docs/install.htm"), "utf8")).toBe(HTML);
  });

  it("refuses promote --write on an HTML page whose evals are its own", async () => {
    const page = HTML.replace(
      "<title>Install</title>",
      '<title>Install</title><meta name="evals" content="The page names the installer.">',
    );
    const root = workspace({ "install.htm": page });
    const e = await rejection(
      runPromote([], {
        cwd: root,
        write: true,
        providerInstance: new MockProvider([
          { json: { promotable: true, rationale: "Deterministic.", code: "process.exit(0);\n" } },
        ]),
      }),
    );
    expect((e as Error).message).toBe(
      "docs/install.htm is HTML, so its evals live in a manifest. Give its collection an externalMetadata entry that owns evals.",
    );
    expect(readFileSync(join(root, "docs/install.htm"), "utf8")).toBe(page);
  });
});
