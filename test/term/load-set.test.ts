/**
 * Loading a term set: every file is offered to every reader of its format,
 * every file contributes its `concepts:` references, and an unreadable file or
 * an empty set is an error rather than a quiet pass (proposal 0052).
 *
 * Uses a stand-in reader so the loader is tested apart from any construct.
 */
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTermSet, MANIFEST_FORMAT } from "../../src/term/core/load-set.js";
import { TermError } from "../../src/term/errors.js";
import type { Term, TermInput, TermReader, TermRun } from "../../src/term/types.js";

/** Reads a page whose metadata says `type: term`, and a manifest line per entry. */
const standIn: TermReader = {
  construct: "page",
  label: "page",
  formats: ["markdown", "html", MANIFEST_FORMAT],
  read(input: TermInput) {
    if (input.format === MANIFEST_FORMAT) {
      const terms: Term[] = input.content
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((label, i) => ({
          id: label,
          record: { label },
          location: { file: input.file, construct: "manifest", line: i + 1, fieldLines: {} },
        }));
      return { terms, notices: [] };
    }
    if (input.metadata["type"] !== "term") return { terms: [], notices: [] };
    const label = String(input.metadata["label"]);
    return {
      terms: [
        {
          id: label,
          record: { label },
          location: { file: input.file, construct: "page", line: 1, fieldLines: {} },
        },
      ],
      notices: [`read ${input.file}`],
    };
  },
};

function runFor(base: string, inputs: string[], extra: Partial<TermRun> = {}): TermRun {
  return {
    config: null,
    inputs,
    base,
    collections: [],
    fromCollections: false,
    manifests: [],
    tools: {},
    ...extra,
  };
}

describe("loadTermSet", () => {
  let tmp: string | undefined;

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  async function tree(spec: Record<string, string>): Promise<string> {
    tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-term-set-")));
    for (const [rel, content] of Object.entries(spec)) {
      const p = join(tmp, rel);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, "utf8");
    }
    return tmp;
  }

  it("offers each file to its format's readers and gathers every file's references", async () => {
    const root = await tree({
      "terms/pal.md": "---\ntype: term\nlabel: progressive lens\n---\n",
      "guides/fitting.md": "---\ntitle: Fitting\nconcepts: [PAL, bifocal]\nkg:\n  concepts: lens\n---\n",
    });
    const set = await loadTermSet({ run: runFor(root, ["terms", "guides"]), readers: [standIn] });

    expect(set.terms.map((t) => t.record.label)).toEqual(["progressive lens"]);
    expect(set.notices).toEqual(["read terms/pal.md"]);
    expect(set.references).toEqual([
      { file: "guides/fitting.md", line: 3, label: "PAL" },
      { file: "guides/fitting.md", line: 3, label: "bifocal" },
      { file: "guides/fitting.md", line: 5, label: "lens" },
    ]);
  });

  it("reads stdin as the format --as names", async () => {
    const root = await tree({});
    const set = await loadTermSet({
      run: runFor(root, ["-"]),
      stdin: "---\ntype: term\nlabel: bifocal\n---\n",
      as: "markdown",
      readers: [standIn],
    });
    expect(set.terms[0]?.location.file).toBe("<stdin>");
  });

  it("refuses stdin with no --as", async () => {
    const root = await tree({});
    await expect(loadTermSet({ run: runFor(root, ["-"]), stdin: "", readers: [standIn] })).rejects.toThrow(
      "reading stdin needs --as <format>.",
    );
  });

  it("offers each manifest as a manifest", async () => {
    const root = await tree({ "glossary.txt": "bifocal\ntrifocal\n" });
    const set = await loadTermSet({
      run: runFor(root, [], { manifests: [{ path: join(root, "glossary.txt"), written: "glossary.txt" }] }),
      readers: [standIn],
    });
    expect(set.terms.map((t) => t.id)).toEqual(["bifocal", "trifocal"]);
  });

  it("refuses a manifest that is not there, naming the config and the path as the config spells it", async () => {
    const root = await tree({});
    const missing = { path: join(root, "terms", "nope.yaml"), written: "terms/nope.yaml" };
    await expect(
      loadTermSet({
        run: runFor(root, [], { manifests: [missing], configSource: "manni.config.yaml" }),
        readers: [standIn],
      }),
    ).rejects.toThrow(new TermError('manni.config.yaml: term.manifests "terms/nope.yaml" does not exist.'));
  });

  it("is an error when files hold no terms", async () => {
    const root = await tree({ "guides/fitting.md": "---\ntitle: Fitting\n---\n" });
    await expect(loadTermSet({ run: runFor(root, ["guides"]), readers: [standIn] })).rejects.toThrow(
      "no terms found. A term is a page declaring type: term, or an entry in a file declaring type: term-set.",
    );
  });

  it("allows an empty set when allowEmpty is on", async () => {
    const root = await tree({ "guides/fitting.md": "---\ntitle: Fitting\n---\n" });
    const set = await loadTermSet({
      run: runFor(root, ["guides"], { config: { allowEmpty: true } }),
      readers: [standIn],
    });
    expect(set.terms).toEqual([]);
  });

  it("walks only the extensions --ext names", async () => {
    const root = await tree({
      "terms/pal.md": "---\ntype: term\nlabel: progressive lens\n---\n",
      "terms/bifocal.html":
        '<html><head><meta name="type" content="term"><meta name="label" content="bifocal"></head></html>',
    });
    const set = await loadTermSet({ run: runFor(root, ["terms"]), exts: ["md"], readers: [standIn] });
    expect(set.terms.map((t) => t.record.label)).toEqual(["progressive lens"]);
  });

  it("lets --allow-empty win over a config that does not allow it", async () => {
    const root = await tree({ "guides/fitting.md": "---\ntitle: Fitting\n---\n" });
    const set = await loadTermSet({
      run: runFor(root, ["guides"], { config: { allowEmpty: false } }),
      allowEmpty: true,
      readers: [standIn],
    });
    expect(set.terms).toEqual([]);
  });

  it("is an error when there is nothing to read at all", async () => {
    const root = await tree({});
    await expect(loadTermSet({ run: runFor(root, []), readers: [standIn] })).rejects.toThrow(
      "No files to read. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  });

  it("refuses a file it cannot parse, naming the file", async () => {
    const root = await tree({ "bad.md": "---\ntitle: [unclosed\n---\n" });
    const load = loadTermSet({ run: runFor(root, ["bad.md"]), readers: [standIn] });
    await expect(load).rejects.toThrow(TermError);
    await expect(loadTermSet({ run: runFor(root, ["bad.md"]), readers: [standIn] })).rejects.toThrow(
      /^bad\.md: could not be read as markdown: /,
    );
  });
});
