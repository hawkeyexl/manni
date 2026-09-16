/**
 * The `manni term` command cores and reporters (proposal 0052 § The interface),
 * against small trees written per test. The document writers land separately,
 * so `write -f` is tested with `json` and `vale`, and the in-place write with a
 * stand-in reader that has `apply`.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "../../src/term/commands/check.js";
import { listFormats } from "../../src/term/commands/formats.js";
import { closestId, findTerm, runGet } from "../../src/term/commands/get.js";
import { runLint } from "../../src/term/commands/lint.js";
import { runList } from "../../src/term/commands/list.js";
import { formatChoice } from "../../src/term/commands/run.js";
import { runWrite, writeFormats } from "../../src/term/commands/write.js";
import { MANIFEST_FORMAT } from "../../src/term/core/load-set.js";
import { TERM_READERS } from "../../src/term/core/readers/index.js";
import { VALE_MARKER } from "../../src/term/core/writers/vale.js";
import { TermError } from "../../src/term/errors.js";
import { renderFindingsGithub } from "../../src/term/reporters/github.js";
import { renderFindingsJson, renderListJson } from "../../src/term/reporters/json.js";
import {
  renderFindingsPretty,
  renderFormatsPretty,
  renderGetPretty,
  renderListPretty,
  renderWritePretty,
} from "../../src/term/reporters/pretty.js";
import { renderListCsv } from "../../src/term/reporters/csv.js";
import type { Term, TermReader } from "../../src/term/types.js";

const PROGRESSIVE = [
  "---",
  "type: term",
  "id: progressive-lens",
  "label: progressive lens",
  "alt-labels: [PAL, graduated lens]",
  "hidden-labels: [no-line bifocal]",
  "broader: [corrective lens]",
  "abstract: Lenses that correct presbyopia without a visible line.",
  "definition: >-",
  "  Corrective lenses whose optical power increases continuously from the top of",
  "  the lens to the bottom, correcting presbyopia without the visible boundary a",
  "  bifocal carries.",
  "---",
  "",
].join("\n");

const CORRECTIVE = [
  "---",
  "type: term",
  "id: corrective-lens",
  "label: corrective lens",
  "narrower: [progressive lens]",
  "definition: A lens worn to correct a refractive error of the eye.",
  "---",
  "",
].join("\n");

const CONFIG = ["collections:", "  - name: site", "    paths:", '      - "docs/**/*.md"', ""].join("\n");

function guide(concepts: string): string {
  return ["---", "title: Fitting", `concepts: [${concepts}]`, "---", "# Fitting", ""].join("\n");
}

let tmp: string | undefined;

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

async function tree(spec: Record<string, string>): Promise<string> {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "manni-term-cmd-")));
  for (const [rel, content] of Object.entries(spec)) {
    const p = join(tmp, rel);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, content, "utf8");
  }
  return tmp;
}

async function lenses(concepts = "progressive lens, corrective lens", extra: Record<string, string> = {}): Promise<string> {
  return tree({
    "manni.config.yaml": CONFIG,
    "docs/terms/progressive-lens.md": PROGRESSIVE,
    "docs/terms/corrective-lens.md": CORRECTIVE,
    "docs/guides/fitting.md": guide(concepts),
    ...extra,
  });
}

describe("formatChoice", () => {
  it("returns a known value and refuses an unknown one with the expected list", () => {
    expect(formatChoice("json", ["pretty", "json"])).toBe("json");
    expect(() => formatChoice("tmx", ["pretty", "json"])).toThrow(
      new TermError('unknown format "tmx". Expected pretty | json.'),
    );
  });
});

describe("list", () => {
  it("lists every term from the collections, with pretty, json and csv renderings", async () => {
    const cwd = await lenses();
    const { terms } = await runList({ cwd, inputs: [] });
    expect(terms.map((t) => t.id).sort()).toEqual(["corrective-lens", "progressive-lens"]);

    const sorted = [...terms].sort((a, b) => a.id.localeCompare(b.id));
    expect(renderListPretty(sorted)).toBe(
      [
        "corrective-lens    corrective lens",
        "progressive-lens   progressive lens   PAL, graduated lens",
        "2 terms",
      ].join("\n"),
    );

    const json = JSON.parse(renderListJson(sorted)) as { terms: Record<string, unknown>[] };
    expect(json.terms[1]).toMatchObject({ id: "progressive-lens", label: "progressive lens", "alt-labels": ["PAL", "graduated lens"] });

    expect(renderListCsv(sorted)).toBe(
      [
        "id,label,alt-labels,abstract",
        "corrective-lens,corrective lens,,",
        "progressive-lens,progressive lens,PAL|graduated lens,Lenses that correct presbyopia without a visible line.",
      ].join("\n"),
    );
  });

  it("quotes a csv cell holding a comma or a quote", () => {
    const t: Term = {
      id: "a",
      record: { label: 'say "hi", then', abstract: "one, two" },
      location: { file: "x.md", construct: "page", line: 1, fieldLines: {} },
    };
    expect(renderListCsv([t]).split("\n")[1]).toBe('a,"say ""hi"", then",,"one, two"');
  });

  it("reads stdin alongside nothing else when given - with --as", async () => {
    const cwd = await tree({});
    const { terms } = await runList({ cwd, inputs: ["-"], stdin: CORRECTIVE, as: "markdown" });
    expect(terms.map((t) => t.id)).toEqual(["corrective-lens"]);
  });

  it("refuses stdin without --as", async () => {
    const cwd = await tree({});
    await expect(runList({ cwd, inputs: ["-"], stdin: CORRECTIVE })).rejects.toThrow("reading stdin needs --as <format>.");
  });
});

describe("get", () => {
  it("finds by id, then by label without case", async () => {
    const cwd = await lenses();
    expect((await runGet({ cwd, inputs: [], term: "progressive-lens" })).id).toBe("progressive-lens");
    expect((await runGet({ cwd, inputs: [], term: "Corrective Lens" })).id).toBe("corrective-lens");
  });

  it("says how many terms there are and the nearest id when nothing matches", async () => {
    const cwd = await lenses();
    await expect(runGet({ cwd, inputs: [], term: "progresive-lens" })).rejects.toThrow(
      new TermError('no term "progresive-lens". 2 terms; did you mean "progressive-lens"?'),
    );
  });

  it("picks the closest id and none for an empty list", () => {
    expect(closestId("bifcal", ["bifocal", "trifocal"])).toBe("bifocal");
    expect(closestId("x", [])).toBeUndefined();
    expect(findTerm([], "x")).toBeUndefined();
  });

  it("renders the term as rung 3 does, wrapping long values under their column", async () => {
    const cwd = await lenses();
    const term = await runGet({ cwd, inputs: [], term: "progressive-lens" });
    expect(renderGetPretty(term, { color: false })).toBe(
      [
        "progressive lens                        docs/terms/progressive-lens.md:1",
        "  id             progressive-lens",
        "  alt-labels     PAL, graduated lens",
        "  hidden-labels  no-line bifocal",
        "  broader        corrective lens",
        "  abstract       Lenses that correct presbyopia without a visible line.",
        "  definition     Corrective lenses whose optical power increases continuously",
        "                 from the top of the lens to the bottom, correcting presbyopia",
        "                 without the visible boundary a bifocal carries.",
      ].join("\n"),
    );
  });
});

describe("check", () => {
  it("is clean on a set whose references all resolve", async () => {
    const cwd = await lenses();
    const report = await runCheck({ cwd, inputs: [] });
    expect(report.findings).toEqual([]);
    expect(report.summary.failed).toBe(0);
    expect(renderFindingsPretty(report, { color: false })).toBe("✓ 2 terms, 2 references, no findings");
    expect(renderFindingsGithub(report)).toBe("");
  });

  it("reports an alt-label reference as undefined-term, grouped by file:line, and fails", async () => {
    const cwd = await lenses("PAL, progressive lens, corrective lens");
    const report = await runCheck({ cwd, inputs: [] });
    expect(report.summary.failed).toBe(1);
    expect(renderFindingsPretty(report, { color: false })).toBe(
      [
        "docs/guides/fitting.md:3",
        '  error  manni:term/undefined-term       concepts: "PAL" names no entry.',
        '                                         "progressive lens" lists it as an alt-label.',
        "",
        "1 error in 2 terms",
      ].join("\n"),
    );
    expect(renderFindingsGithub(report)).toBe(
      '::error file=docs/guides/fitting.md,line=3,title=manni%3Aterm/undefined-term::concepts: "PAL" names no entry. "progressive lens" lists it as an alt-label.',
    );
    const json = JSON.parse(renderFindingsJson(report)) as { findings: unknown[]; summary: Record<string, unknown> };
    expect(json.findings).toHaveLength(1);
    expect(json.summary).toMatchObject({ terms: 2, references: 3, errors: 1 });
  });

  it("applies term.severity, so an error turned to a warning does not fail", async () => {
    const cwd = await lenses("PAL, progressive lens, corrective lens", {
      "manni.config.yaml": `${CONFIG}term:\n  severity:\n    undefined-term: warning\n`,
    });
    const report = await runCheck({ cwd, inputs: [] });
    expect(report.summary.failed).toBe(0);
    expect(report.findings[0]?.severity).toBe("warning");
  });

  it("records a baseline on the first --baseline, then fails only on new findings", async () => {
    const cwd = await lenses("PAL, progressive lens, corrective lens");
    const first = await runCheck({ cwd, inputs: [], baseline: true });
    expect(first.summary.failed).toBe(0);
    expect(first.baseline?.written).toBe(true);
    expect(existsSync(join(cwd, ".manni-term-baseline.json"))).toBe(true);
    expect(renderFindingsPretty(first, { color: false })).toBe("✓ 1 finding recorded in .manni-term-baseline.json");

    const second = await runCheck({ cwd, inputs: [], baseline: true });
    expect(second.summary.failed).toBe(0);
    expect(second.findings).toEqual([]);

    await writeFile(join(cwd, "docs/guides/other.md"), guide("graduated lens"), "utf8");
    const third = await runCheck({ cwd, inputs: [], baseline: true });
    expect(third.summary.failed).toBe(1);
    expect(third.findings.map((f) => f.file)).toEqual(["docs/guides/other.md"]);
  });

  it("compares against a configured baseline without the flag, and says how to record a missing one", async () => {
    const cwd = await lenses("PAL, progressive lens, corrective lens", {
      "manni.config.yaml": `${CONFIG}term:\n  baseline: term.baseline.json\n`,
    });
    await expect(runCheck({ cwd, inputs: [] })).rejects.toThrow(
      'Baseline "term.baseline.json" not found. Record one with `manni term check --baseline`.',
    );
    await runCheck({ cwd, inputs: [], baseline: true });
    expect(existsSync(join(cwd, "term.baseline.json"))).toBe(true);
    expect((await runCheck({ cwd, inputs: [] })).summary.failed).toBe(0);
  });
});

describe("lint", () => {
  it("runs Vale through the injected seam and maps findings back", async () => {
    const cwd = await lenses();
    const report = await runLint({
      cwd,
      inputs: [],
      runVale: (dirs) => {
        expect(dirs).toHaveLength(1);
        return Promise.resolve({
          "x/corrective-lens.definition.md": [
            { Check: "Direct.Length", Message: "Too long.", Line: 1, Span: [1, 2], Severity: "error" },
          ],
        });
      },
    });
    expect(report.summary.failed).toBe(1);
    expect(renderFindingsPretty(report, { color: false })).toBe(
      ["docs/terms/corrective-lens.md:6", "  error  manni:term/prose/Direct.Length  Too long.", "", "1 error in 2 terms"].join("\n"),
    );
  });

  it("names a tools.vale.config that does not exist", async () => {
    const cwd = await lenses(undefined, { "manni.config.yaml": `${CONFIG}tools:\n  vale:\n    config: nowhere.ini\n` });
    await expect(runLint({ cwd, inputs: [], runVale: () => Promise.resolve({}) })).rejects.toThrow(
      new TermError('manni.config.yaml: tools.vale.config "nowhere.ini" does not exist.'),
    );
  });
});

describe("write -f", () => {
  it("needs -o for every format but vale, and refuses an unregistered one", async () => {
    const cwd = await lenses();
    await expect(runWrite({ cwd, inputs: [], format: "json" })).rejects.toThrow(new TermError("-f json needs -o <path>."));
    const expected = writeFormats().join(" | ");
    await expect(runWrite({ cwd, inputs: [], format: "tmx", out: "x" })).rejects.toThrow(
      new TermError(`unknown format "tmx". Expected ${expected}.`),
    );
  });

  it("renders json to a file, then --check is clean, and drifts after an edit", async () => {
    const cwd = await lenses();
    const report = await runWrite({ cwd, inputs: [], format: "json", out: "build/terms.json" });
    expect(renderWritePretty(report)).toBe("Wrote 2 terms to build/terms.json");
    const written = JSON.parse(await readFile(join(cwd, "build/terms.json"), "utf8")) as { terms: unknown[] };
    expect(written.terms).toHaveLength(2);

    const clean = await runWrite({ cwd, inputs: [], format: "json", out: "build/terms.json", check: true });
    expect(clean.changes).toEqual([]);
    expect(renderWritePretty(clean)).toBe("build/terms.json is up to date");

    await writeFile(join(cwd, "docs/terms/corrective-lens.md"), CORRECTIVE.replace("refractive", "optical"), "utf8");
    const drift = await runWrite({ cwd, inputs: [], format: "json", out: "build/terms.json", check: true });
    expect(drift.changes).toEqual([{ path: "build/terms.json", action: "change" }]);
    expect(renderWritePretty(drift)).toBe("build/terms.json would change");
  });

  it("writes nothing under --dry-run", async () => {
    const cwd = await lenses();
    const report = await runWrite({ cwd, inputs: [], format: "json", out: "terms.json", dryRun: true });
    expect(existsSync(join(cwd, "terms.json"))).toBe(false);
    expect(renderWritePretty(report)).toBe("terms.json would be created");
  });

  it("writes a Vale style to -o, removes a stale marked file, and reports the style's files", async () => {
    const cwd = await lenses(undefined, { "styles/Terms/OLD.yml": `${VALE_MARKER}\nextends: conditional\n` });
    const report = await runWrite({ cwd, inputs: [], format: "vale", out: "styles" });
    expect(existsSync(join(cwd, "styles/Terms/OLD.yml"))).toBe(false);
    expect(existsSync(join(cwd, "styles/Terms/PAL.yml"))).toBe(true);
    expect(renderWritePretty(report)).toBe(
      [
        "Wrote 2 terms to styles/Terms",
        "  Lowercase.yml   3 terms",
        "  Deprecated.yml  1 swap",
        "  PAL.yml         1 acronym",
      ].join("\n"),
    );
    expect(report.wiring).toBeUndefined();
    expect((await runWrite({ cwd, inputs: [], format: "vale", out: "styles", check: true })).changes).toEqual([]);
  });

  it("relativizes the path in a writer's refusal", async () => {
    const cwd = await lenses(undefined, { "styles/Terms/Casing.yml": "extends: substitution\n" });
    await expect(runWrite({ cwd, inputs: [], format: "vale", out: "styles" })).rejects.toThrow(
      new TermError("styles/Terms/Casing.yml was not written by manni. Move it, or pass -o <styles directory>."),
    );
  });

  it("asks Vale for the styles directory with no -o, and says how to wire the style in", async () => {
    const cwd = await lenses();
    const report = await runWrite({
      cwd,
      inputs: [],
      format: "vale",
      lsConfig: () =>
        Promise.resolve({
          stylesPath: join(cwd, ".vale", "styles"),
          rootIni: join(cwd, ".vale.ini"),
          baseStyles: { "*.md": ["Vale", "Direct"] },
        }),
    });
    expect(existsSync(join(cwd, ".vale/styles/Terms/Lowercase.yml"))).toBe(true);
    expect(report.wiring).toEqual({ rootIni: ".vale.ini", section: "*.md", styles: ["Vale", "Direct", "Terms"] });
  });

  it("says Vale found no config when ls-config resolves none", async () => {
    const cwd = await lenses();
    await expect(runWrite({ cwd, inputs: [], format: "vale", lsConfig: () => Promise.resolve(null) })).rejects.toThrow(
      new TermError("Vale found no config file. Set tools.vale.config in manni.config.yaml, or pass -o <styles directory>."),
    );
  });
});

describe("write in place", () => {
  /** A manifest reader whose apply upper-cases every label, standing in for a real writer-back. */
  const manifestReader = TERM_READERS.find((r) => r.construct === "manifest");
  if (manifestReader === undefined) throw new Error("no manifest reader");
  const standIn: TermReader = {
    ...manifestReader,
    apply: (input, terms) => `${input.content.trimEnd()}\n# ${terms.map((t) => t.id).join(",")}\n`,
  };
  const noApply: TermReader = { ...manifestReader, apply: undefined };

  it("applies each file's terms through its reader and writes only what changed", async () => {
    const cwd = await tree({
      "manni.config.yaml": "term:\n  manifests: [terms.yaml]\n",
      "terms.yaml": "bifocal:\n  label: bifocal\n",
    });
    const report = await runWrite({ cwd, inputs: [], readers: [standIn] });
    expect(renderWritePretty(report)).toBe("Wrote 1 file");
    expect(await readFile(join(cwd, "terms.yaml"), "utf8")).toBe("bifocal:\n  label: bifocal\n# bifocal\n");
    expect(MANIFEST_FORMAT).toBe("manifest");
  });

  it("says nothing to write when nothing changed", async () => {
    const cwd = await tree({
      "manni.config.yaml": "term:\n  manifests: [terms.yaml]\n",
      "terms.yaml": "bifocal:\n  label: bifocal\n",
    });
    const identity: TermReader = { ...manifestReader, apply: (input) => input.content };
    expect(renderWritePretty(await runWrite({ cwd, inputs: [], readers: [identity] }))).toBe("Nothing to write");
  });

  it("refuses a construct with no apply, naming it", async () => {
    const cwd = await tree({
      "manni.config.yaml": "term:\n  manifests: [terms.yaml]\n",
      "terms.yaml": "bifocal:\n  label: bifocal\n",
    });
    await expect(runWrite({ cwd, inputs: [], readers: [noApply] })).rejects.toThrow(
      "terms.yaml: a manifest cannot be written in place. Pass -f <format> -o <path>.",
    );
  });

  it("refuses terms read from stdin", async () => {
    const cwd = await tree({});
    await expect(runWrite({ cwd, inputs: ["-"], stdin: CORRECTIVE, as: "markdown" })).rejects.toThrow(
      "<stdin> has nowhere to write back to. Pass -f <format> -o <path>.",
    );
  });

  it("refuses -o without -f", async () => {
    const cwd = await lenses();
    await expect(runWrite({ cwd, inputs: [], out: "x" })).rejects.toThrow(new TermError("-o needs -f <format>."));
  });
});

describe("formats", () => {
  it("lists only what the registries hold, one line per reader format and per interchange writer", () => {
    const rows = listFormats();
    expect(rows.some((r) => r.format === "markdown" && r.label === "page" && r.read)).toBe(true);
    expect(rows.find((r) => r.format === "vale")).toMatchObject({ label: "style", read: false, write: true });
    const pretty = renderFormatsPretty(rows);
    expect(pretty).toMatch(/^markdown +page +read$/m);
    expect(pretty).toMatch(/^tbx +TBX v2 Core +write$/m);
    expect(pretty).toMatch(/^json +write$/m);
  });

  it("marks a reader with apply as written", () => {
    const reader: TermReader = {
      construct: "page",
      label: "page",
      formats: ["markdown"],
      read: () => ({ terms: [], notices: [] }),
      apply: (input) => input.content,
    };
    expect(listFormats({ readers: [reader], writers: [] })).toEqual([
      { format: "markdown", construct: "page", label: "page", read: true, write: true },
    ]);
  });
});
