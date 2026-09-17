/**
 * `term lint` (proposal 0052 § 6): each prose field is written to a temporary
 * `<id>.<field>.md`, Vale runs once over all of them, and each alert maps back
 * to the field's source line with Vale's severity folded onto the family scale.
 *
 * A stub stands in for Vale in every test but the last, which runs the real
 * binary against a fixture style when Vale is on PATH.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { lintTermSet } from "../../src/term/core/lint.js";
import type { runValeJson, ValeAlert, ValeAlerts } from "../../src/term/core/vale.js";
import type { Term, TermConstruct, TermField, TermRecord, TermSet } from "../../src/term/types.js";

const FIXTURE = resolve(__dirname, "../fixtures/term/lint");

function term(
  id: string,
  record: Partial<TermRecord>,
  construct: TermConstruct = "page",
  location: { file?: string; line?: number; fieldLines?: Partial<Record<TermField, number>> } = {},
): Term {
  return {
    id,
    record: { label: id, ...record },
    location: {
      file: location.file ?? `docs/terms/${id}.md`,
      construct,
      line: location.line ?? 1,
      fieldLines: location.fieldLines ?? {},
    },
  };
}

function set(...terms: Term[]): TermSet {
  return { terms, references: [], notices: [] };
}

function alert(Check: string, Line: number, Severity: ValeAlert["Severity"] = "error", Message = "m"): ValeAlert {
  return { Check, Message, Line, Span: [1, 2], Severity };
}

interface Seen {
  calls: { files: string[]; config?: string; cwd?: string }[];
  /** The temporary files as Vale would have read them, name to content. */
  written: Map<string, string>;
  dirs: string[];
}

/**
 * A stand-in for Vale that records what it was given, reads the temporary
 * files, and answers with alerts keyed by file name.
 */
function fakeVale(
  answer: (name: string, dir: string) => ValeAlert[] | undefined = () => undefined,
  pathFor: (dir: string, name: string) => string = (dir, name) => join(dir, name),
): { runVale: typeof runValeJson; seen: Seen } {
  const seen: Seen = { calls: [], written: new Map(), dirs: [] };
  const runVale: typeof runValeJson = async (files, opts) => {
    seen.calls.push({ files, config: opts.config, cwd: opts.cwd });
    const alerts: ValeAlerts = {};
    for (const dir of files) {
      seen.dirs.push(dir);
      for (const name of await readdir(dir)) {
        seen.written.set(name, await readFile(join(dir, name), "utf8"));
        const found = answer(name, dir);
        if (found) alerts[pathFor(dir, name)] = found;
      }
    }
    return alerts;
  };
  return { runVale, seen };
}

describe("lintTermSet", () => {
  it("writes one <id>.<field>.md per prose field and runs Vale once", async () => {
    const { runVale, seen } = fakeVale();
    const findings = await lintTermSet(
      set(
        term("kubernetes", { definition: "An orchestrator.", abstract: "Runs containers.", "scope-note": "Not k3s." }),
        term("api", { definition: "An interface.", "alt-labels": ["API"] }),
      ),
      { runVale, cwd: "/work" },
    );
    expect(findings).toEqual([]);
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]?.cwd).toBe("/work");
    expect(Object.fromEntries(seen.written)).toEqual({
      "kubernetes.definition.md": "An orchestrator.\n",
      "kubernetes.abstract.md": "Runs containers.\n",
      "kubernetes.scope-note.md": "Not k3s.\n",
      "api.definition.md": "An interface.\n",
    });
  });

  it("passes the Vale config through", async () => {
    const { runVale, seen } = fakeVale();
    await lintTermSet(set(term("a", { definition: "x" })), { runVale, valeConfig: "/work/.vale.ini" });
    expect(seen.calls[0]?.config).toBe("/work/.vale.ini");
  });

  it("puts a single-line field's findings on the field's line, or the entry's when the field has none", async () => {
    const { runVale } = fakeVale((name) =>
      name === "a.definition.md" ? [alert("Direct.Length", 1)] : name === "a.abstract.md" ? [alert("Moose.EmDash", 1)] : undefined,
    );
    const findings = await lintTermSet(
      set(term("a", { definition: "Long.", abstract: "Dash." }, "page", { line: 2, fieldLines: { definition: 9 } })),
      { runVale },
    );
    expect(findings.map((f) => [f.field, f.line])).toEqual([
      ["abstract", 2],
      ["definition", 9],
    ]);
  });

  it("maps a page's literal block line by line, the value starting after the key", async () => {
    const { runVale } = fakeVale(() => [alert("Direct.Length", 1), alert("Direct.Length", 3)]);
    const findings = await lintTermSet(
      set(term("a", { definition: "one\ntwo\nthree\n" }, "page", { fieldLines: { definition: 5 } })),
      { runVale },
    );
    expect(findings.map((f) => f.line)).toEqual([6, 8]);
  });

  it("maps a manifest's literal block the same way", async () => {
    const { runVale } = fakeVale(() => [alert("Direct.Length", 2)]);
    const findings = await lintTermSet(
      set(term("a", { definition: "one\ntwo\n" }, "manifest", { fieldLines: { definition: 10 } })),
      { runVale },
    );
    expect(findings.map((f) => f.line)).toEqual([12]);
  });

  it("maps a body construct's multi-line value from the field's own line", async () => {
    const { runVale } = fakeVale(() => [alert("Direct.Length", 1), alert("Direct.Length", 2)]);
    const findings = await lintTermSet(
      set(term("a", { definition: "one\ntwo" }, "markdown-deflist", { line: 4, fieldLines: { definition: 5 } })),
      { runVale },
    );
    expect(findings.map((f) => f.line)).toEqual([5, 6]);
  });

  it("folds Vale's severity, keeps Vale's own, and names the tool, check and entry", async () => {
    const { runVale } = fakeVale(() => [
      alert("Moose.Hedge", 1, "suggestion", "Hedge."),
      alert("Direct.Voice", 1, "warning", "Passive."),
      alert("Moose.EmDash", 1, "error", "Em dash."),
    ]);
    const findings = await lintTermSet(
      set(term("lens", { definition: "x" }, "page", { file: "docs/terms/lens.md", fieldLines: { definition: 3 } })),
      { runVale },
    );
    expect(findings).toEqual([
      {
        ruleId: "manni:term/prose/Direct.Voice",
        severity: "warning",
        toolSeverity: "warning",
        tool: "vale",
        check: "Direct.Voice",
        message: "Passive.",
        file: "docs/terms/lens.md",
        line: 3,
        id: "lens",
        field: "definition",
      },
      {
        ruleId: "manni:term/prose/Moose.EmDash",
        severity: "error",
        toolSeverity: "error",
        tool: "vale",
        check: "Moose.EmDash",
        message: "Em dash.",
        file: "docs/terms/lens.md",
        line: 3,
        id: "lens",
        field: "definition",
      },
      {
        ruleId: "manni:term/prose/Moose.Hedge",
        severity: "notice",
        toolSeverity: "suggestion",
        tool: "vale",
        check: "Moose.Hedge",
        message: "Hedge.",
        file: "docs/terms/lens.md",
        line: 3,
        id: "lens",
        field: "definition",
      },
    ]);
  });

  it("matches alerts by file name whatever form of the path Vale prints", async () => {
    const { runVale } = fakeVale(
      () => [alert("X.Y", 1)],
      (dir, name) => `C:\\Users\\HAWKEY~1\\AppData\\Local\\Temp\\${basename(dir)}/${name}`,
    );
    const findings = await lintTermSet(set(term("a", { definition: "x" })), { runVale });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.id).toBe("a");
  });

  it("does not let a second entry with the same id overwrite the first", async () => {
    const { runVale, seen } = fakeVale((name) => (name.startsWith("dup.2.") ? [alert("X.Y", 1)] : undefined));
    const findings = await lintTermSet(
      set(
        term("dup", { definition: "first" }, "page", { file: "docs/a.md", fieldLines: { definition: 3 } }),
        term("dup", { definition: "second" }, "page", { file: "docs/b.md", fieldLines: { definition: 7 } }),
      ),
      { runVale },
    );
    expect(Object.fromEntries(seen.written)).toEqual({
      "dup.definition.md": "first\n",
      "dup.2.definition.md": "second\n",
    });
    expect(findings.map((f) => [f.file, f.line])).toEqual([["docs/b.md", 7]]);
  });

  it("returns no findings, and runs no Vale, for a set with no prose", async () => {
    const { runVale, seen } = fakeVale();
    await expect(lintTermSet(set(term("a", { "alt-labels": ["b"] })), { runVale })).resolves.toEqual([]);
    expect(seen.calls).toHaveLength(0);
  });

  it("removes the temporary directory after a run", async () => {
    const { runVale, seen } = fakeVale();
    await lintTermSet(set(term("a", { definition: "x" })), { runVale });
    expect(seen.dirs).toHaveLength(1);
    expect(existsSync(seen.dirs[0] ?? "")).toBe(false);
  });

  it("removes the temporary directory when Vale fails", async () => {
    const dirs: string[] = [];
    const runVale: typeof runValeJson = (files) => {
      dirs.push(...files);
      return Promise.reject(new Error("boom"));
    };
    await expect(lintTermSet(set(term("a", { definition: "x" })), { runVale })).rejects.toThrow("boom");
    expect(dirs).toHaveLength(1);
    expect(existsSync(dirs[0] ?? "")).toBe(false);
  });

  it("sorts findings by file, line, rule id and message", async () => {
    const { runVale } = fakeVale((name) =>
      name.startsWith("b.") ? [alert("Z.Z", 1, "error", "b"), alert("A.A", 1, "error", "z"), alert("A.A", 1, "error", "a")] : [alert("Q.Q", 1)],
    );
    const findings = await lintTermSet(
      set(
        term("b", { definition: "x" }, "page", { file: "docs/b.md", fieldLines: { definition: 2 } }),
        term("a", { definition: "x" }, "page", { file: "docs/a.md", fieldLines: { definition: 9 } }),
      ),
      { runVale },
    );
    expect(findings.map((f) => `${f.file}:${String(f.line)} ${f.ruleId} ${f.message}`)).toEqual([
      "docs/a.md:9 manni:term/prose/Q.Q m",
      "docs/b.md:2 manni:term/prose/A.A a",
      "docs/b.md:2 manni:term/prose/A.A z",
      "docs/b.md:2 manni:term/prose/Z.Z b",
    ]);
  });
});

function valeOnPath(): boolean {
  try {
    execFileSync("vale", ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

describe("lintTermSet against the real Vale", () => {
  it.skipIf(!valeOnPath())("reports a fixture rule on the definition's source line", async () => {
    const findings = await lintTermSet(
      set(
        term("widget", { definition: "A part.\nIt can frobnicate a gear.\n" }, "page", {
          file: "docs/terms/widget.md",
          fieldLines: { definition: 4 },
        }),
        term("gear", { abstract: "A clean abstract." }),
      ),
      { valeConfig: join(FIXTURE, ".vale.ini"), cwd: FIXTURE },
    );
    expect(findings).toEqual([
      {
        ruleId: "manni:term/prose/Fixture.Frobnicate",
        severity: "notice",
        toolSeverity: "suggestion",
        tool: "vale",
        check: "Fixture.Frobnicate",
        message: "Avoid 'frobnicate'.",
        file: "docs/terms/widget.md",
        line: 6,
        id: "widget",
        field: "definition",
      },
    ]);
  });
});
