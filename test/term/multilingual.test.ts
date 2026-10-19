/**
 * A multilingual set (proposal 0084): one term per language, joined on `id`.
 * `test/fixtures/term/multilingual/` holds an `en/` and a `de/` page for each
 * of three ids: one pair with an identical label (`API`), one with a case
 * clash (`Kubernetes`/`kubernetes`), and a manifest whose entry carries its
 * own language.
 */
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { runCheck } from "../../src/term/commands/check.js";
import { runWrite, type WriteReport } from "../../src/term/commands/write.js";
import { loadTermSet } from "../../src/term/core/load-set.js";
import { writerFor } from "../../src/term/core/writers/index.js";
import { conceptGroups, mergeFirst } from "../../src/term/core/writers/merge.js";
import { TermError } from "../../src/term/errors.js";
import { renderWritePretty } from "../../src/term/reporters/pretty.js";
import type { Term, TermRun, TermWriteFormat, TermWriter } from "../../src/term/types.js";
import { term } from "./writer-fixture.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "term", "multilingual");
const NO_EXISTING = { existing: new Map<string, string>() };

function run(inputs: string[], manifests: string[] = []): TermRun {
  return {
    config: null,
    inputs,
    base: FIXTURE,
    collections: [],
    fromCollections: false,
    manifests: manifests.map((written) => ({ path: join(FIXTURE, written), written })),
    tools: {},
  };
}

async function fixtureSet(): Promise<Term[]> {
  return (await loadTermSet({ run: run(["en", "de"]) })).terms;
}

function writer(format: TermWriteFormat): TermWriter {
  const found = writerFor(format);
  if (found === undefined) throw new Error(`no ${format} writer`);
  return found;
}

function pairs(terms: readonly Term[]): string[] {
  return terms.map((t) => `${t.language ?? ""}/${t.id}`).sort();
}

let tmp: string;
beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-term-multilingual-")));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("a multilingual set", () => {
  it("reads one term per language from pages and a manifest entry's own language", async () => {
    const set = await loadTermSet({ run: run(["en", "de"], ["terms.de.yaml"]) });
    expect(pairs(set.terms)).toEqual([
      "de/api",
      "de/kubernetes",
      "de/progressive-lens",
      "de/spectacle-lens",
      "en/api",
      "en/kubernetes",
      "en/progressive-lens",
    ]);
    expect(set.notices).toEqual([]);
  });

  it("checks clean but for the case clash across languages, on the later entry", async () => {
    const report = await runCheck({ cwd: FIXTURE, inputs: ["en", "de"] });
    const findings = report.findings.filter((f) => f.rule !== "unused-term");
    expect(findings.map((f) => [f.rule, f.file, f.message])).toEqual([
      ["label-collision", "en/kubernetes.md", '"Kubernetes" is claimed by de/kubernetes.md:1 as "kubernetes"'],
    ]);
  });

  describe("directory renders", () => {
    it("write <lang>/<id> pages that read back as the same set", async () => {
      const out = join(tmp, "terms");
      const report = await runWrite({ cwd: FIXTURE, inputs: ["en", "de"], format: "markdown", out: `${out}/` });
      expect(report.files.map((f) => f.path.split(/[\\/]/).slice(-2).join("/")).sort()).toEqual([
        "de/api.md",
        "de/kubernetes.md",
        "de/progressive-lens.md",
        "en/api.md",
        "en/kubernetes.md",
        "en/progressive-lens.md",
      ]);
      const read = await loadTermSet({ run: { ...run([out]), base: tmp } });
      expect(read.terms.map((t) => [t.id, t.language, t.record])).toEqual(
        expect.arrayContaining((await fixtureSet()).map((t) => [t.id, t.language, t.record])),
      );
      expect(read.terms).toHaveLength(report.terms);
    });

    it("keep one file per id in a single-language set", () => {
      const render = writer("markdown").render(
        [term("api", { label: "API" }, "de"), term("pal", { label: "Gleitsichtglas" }, "de")],
        { path: tmp, shape: "directory" },
        NO_EXISTING,
      );
      expect(render.files.map((f) => f.path)).toEqual([join(tmp, "api.md"), join(tmp, "pal.md")]);
    });

    it("refuse the same id twice in one language", () => {
      const terms = [
        term("api", { label: "API" }, "en"),
        term("api", { label: "API" }, "de"),
        term("api", { label: "Schnittstelle" }, "DE"),
      ];
      for (const format of ["markdown", "dita"] as const) {
        expect(() => writer(format).render(terms, { path: tmp, shape: "directory" }, NO_EXISTING)).toThrow(
          new TermError('two terms have the id "api" in de, and a directory holds one file per id in each language.'),
        );
      }
    });

    it("refuse a language that cannot name a directory", () => {
      const terms = [term("api", { label: "API" }, "en"), term("api", { label: "API" }, "../de")];
      expect(() => writer("markdown").render(terms, { path: tmp, shape: "directory" }, NO_EXISTING)).toThrow(
        new TermError('the language "../de" cannot name a directory. Give the term a language without path characters.'),
      );
    });
  });

  describe("single-file document renders", () => {
    it("write the first term's language and report the rest", async () => {
      const report = await runWrite({
        cwd: FIXTURE,
        inputs: ["en", "de"],
        format: "markdown",
        out: "build/glossary.md",
        dryRun: true,
      });
      // The loader reads de/ before en/, so de is the first term's language.
      expect(report.otherLanguages).toEqual({
        written: "de",
        terms: [
          { id: "api", language: "en" },
          { id: "kubernetes", language: "en" },
          { id: "progressive-lens", language: "en" },
        ],
      });
      expect(renderWritePretty(report).split("\n")).toContain(
        "  skipped 3 terms in another language than de: api (en), kubernetes (en), progressive-lens (en)",
      );
      const content = report.files[0]?.content ?? "";
      expect(content).toContain("Orchestrierer");
      expect(content).not.toContain("orchestrator");
    });

    it.each(["asciidoc", "rst", "html", "dita", "docbook"] as const)("%s writes one language too", (format) => {
      const terms = [term("pal", { label: "Gleitsichtglas", definition: "d" }, "de"), term("pal", { label: "PAL", definition: "d" })];
      const render = writer(format).render(terms, { path: join(tmp, "g"), shape: "file" }, NO_EXISTING);
      expect(render.otherLanguages).toEqual({ written: "de", terms: [{ id: "pal", language: "en" }] });
      expect(render.files[0]?.content).toContain("Gleitsichtglas");
    });

    it("count the terms written without the other languages", () => {
      const report: WriteReport = {
        mode: "render",
        format: "markdown",
        shape: "file",
        target: "glossary.md",
        terms: 3,
        changes: [],
        files: [],
        dropped: [],
        droppedFrom: "a definition list",
        skipped: [],
        otherLanguages: { written: "en", terms: [{ id: "pal", language: "de" }] },
        check: false,
        dryRun: false,
      };
      expect(renderWritePretty(report)).toBe(
        [
          "Wrote 2 terms to glossary.md",
          "  skipped 1 term in another language than en: pal (de)",
        ].join("\n"),
      );
    });
  });

  describe("csv", () => {
    it("writes one row per id, each language's columns from its own term", async () => {
      const report = await runWrite({ cwd: FIXTURE, inputs: ["en", "de"], format: "csv", out: "x.csv", dryRun: true });
      const rows = (report.files[0]?.content ?? "").trimEnd().split("\n");
      expect(rows[0]).toMatch(/^ID,Term \[de\],.*,Term \[en\],/);
      expect(rows.slice(1).map((row) => row.split(",")[0])).toEqual(["api", "kubernetes", "progressive-lens"]);
      expect(rows.find((row) => row.startsWith("api,"))).toBe(
        "api,API,Eine Programmierschnittstelle.,,,,,API,A contract between programs.,,,,,,,,",
      );
      expect(report.conflicts).toBeUndefined();
    });

    it("keeps the first term's language-neutral columns and reports where languages differ", () => {
      const terms = [
        term("pal", { label: "progressive lens", broader: ["lens"], see: "varifocal" }, "en"),
        term("pal", { label: "Gleitsichtglas", broader: ["Linse"], see: "varifocal" }, "de"),
        term("lens", { label: "lens", broader: ["optic"] }, "en"),
      ];
      const render = writer("csv").render(terms, { path: join(tmp, "x.csv"), shape: "file" }, NO_EXISTING);
      const rows = (render.files[0]?.content ?? "").trimEnd().split("\n");
      expect(rows.slice(1)).toEqual([
        "pal,progressive lens,,,,,,Gleitsichtglas,,,,,,lens,,,varifocal",
        "lens,lens,,,,,,,,,,,,optic,,,",
      ]);
      expect(render.conflicts).toEqual([{ id: "pal", field: "broader" }]);
    });

    it("keeps a repeated id in one language on rows of its own", () => {
      const terms = [term("x", { label: "one" }), term("x", { label: "two" })];
      const render = writer("csv").render(terms, { path: join(tmp, "x.csv"), shape: "file" }, NO_EXISTING);
      expect((render.files[0]?.content ?? "").trimEnd().split("\n").slice(1)).toEqual([
        "x,one,,,,,,,,,",
        "x,two,,,,,,,,,",
      ]);
    });
  });

  describe("the merge-conflict line", () => {
    function report(conflicts: WriteReport["conflicts"]): WriteReport {
      return {
        mode: "render",
        format: "csv",
        shape: "file",
        target: "x.csv",
        terms: 4,
        changes: [],
        files: [],
        dropped: [],
        skipped: [],
        ...(conflicts === undefined ? {} : { conflicts }),
        check: false,
        dryRun: true,
      };
    }

    it("counts concepts per field, fewest first, after the dropped line", () => {
      const lines = renderWritePretty(
        report([
          { id: "a", field: "broader" },
          { id: "b", field: "broader" },
          { id: "a", field: "concept-entry.subject-field" },
        ]),
      ).split("\n");
      expect(lines.at(-1)).toBe(
        "  kept the first language's value where languages differ: concept-entry.subject-field on 1 concept, broader on 2",
      );
    });

    it("names the TBX headers a render left behind, after the dropped fields and before the conflicts", () => {
      const lines = renderWritePretty({
        ...report([{ id: "a", field: "concept-entry.notes" }]),
        format: "tbx3",
        droppedFrom: "tbx3",
        dropped: [{ id: "a", field: "abstract" }],
        droppedHeaders: ["glossary.tbx", "<stdin>"],
      }).split("\n");
      expect(lines.slice(1)).toEqual([
        "  dropped from tbx3: abstract on 1 term",
        "  dropped from tbx3: the headers of glossary.tbx, <stdin>",
        "  kept the first language's value where languages differ: concept-entry.notes on 1 concept",
      ]);
      expect(
        renderWritePretty({ ...report(undefined), droppedFrom: "a page", droppedHeaders: ["glossary.tbx"] }).split("\n")[1],
      ).toBe("  dropped from a page: the header of glossary.tbx");
    });

    it("prints the line after an in-place write too", () => {
      const written = { ...report([{ id: "a", field: "concept-entry.subject-field" }]), mode: "in-place" as const, dryRun: false };
      expect(renderWritePretty({ ...written, changes: [{ path: "glossary.tbx", action: "change" as const }] }).split("\n")).toEqual([
        "Wrote 1 file",
        "  kept the first language's value where languages differ: concept-entry.subject-field on 1 concept",
      ]);
    });

    it("says nothing when no field differs", () => {
      expect(renderWritePretty(report([]))).toBe("x.csv is up to date");
    });
  });

  describe("mergeFirst", () => {
    it("merges field by field, the first value winning and an absent one saying nothing", () => {
      const { merged, conflicts } = mergeFirst("pal", [
        { "subject-field": "optics" },
        undefined,
        { "subject-field": "Optik", notes: ["n"] },
        { notes: ["n"] },
      ], "concept-entry.");
      expect(merged).toEqual({ "subject-field": "optics", notes: ["n"] });
      expect(conflicts).toEqual([{ id: "pal", field: "concept-entry.subject-field" }]);
    });

    it("groups terms by id in order of first appearance", () => {
      const terms = [term("b", { label: "b" }), term("a", { label: "a" }), term("b", { label: "B" }, "de")];
      expect(conceptGroups(terms).map((group) => group.map((t) => t.record.label))).toEqual([["b", "B"], ["a"]]);
    });
  });

  describe("vale", () => {
    function files(terms: readonly Term[]): Record<string, string> {
      const render = writer("vale").render(terms, { path: tmp, shape: "directory" }, NO_EXISTING);
      return Object.fromEntries(render.files.map((f) => [f.path.slice(tmp.length + 7), f.content]));
    }

    it("writes a label several languages share once", () => {
      const en = term("k8s", { label: "Kubernetes", "alt-labels": ["PAL"] }, "en");
      const de = term("k8s", { label: "Kubernetes", "alt-labels": ["PAL"] }, "de");
      expect(files([en, de])).toEqual(files([en]));
    });

    it("keeps the first term's acronym rule when another language shares the acronym", () => {
      const out = files([
        term("pal", { label: "progressive lens", "alt-labels": ["PAL"] }, "en"),
        term("pal", { label: "Gleitsichtglas", "alt-labels": ["PAL"] }, "de"),
      ]);
      expect(out["PAL.yml"]).toContain("progressive lens (PAL)");
      expect(out["PAL.yml"]).not.toContain("Gleitsichtglas");
    });

    it("swaps a superseded designation for its label in Deprecated.yml", async () => {
      const out = files(await fixtureSet());
      const deprecated = parseYaml(out["Deprecated.yml"] ?? "") as { swap: Record<string, string> };
      expect(Object.entries(deprecated.swap)).toContainEqual(["\\bno-line bifocal\\b", "progressive lens"]);
    });
  });

  describe("skos", () => {
    it("writes one concept per id, with each language's labels on it", async () => {
      const render = writer("skos").render(await fixtureSet(), { path: join(tmp, "x.jsonld"), shape: "file" }, NO_EXISTING);
      const graph = (JSON.parse(render.files[0]?.content ?? "{}") as { "@graph": Record<string, unknown>[] })["@graph"];
      const api = graph.filter((node) => node["@id"] === "#api").map((node) => node["skos:prefLabel"]);
      expect(api).toEqual([
        [
          { "@value": "API", "@language": "de" },
          { "@value": "API", "@language": "en" },
        ],
      ]);
    });
  });
});
