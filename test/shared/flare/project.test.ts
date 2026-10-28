/**
 * The Flare project a page belongs to (proposal 0125, decisions 10 and 11):
 * found from the nearest .flprj, one target per run, and the notices and
 * warnings a run says once.
 */
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "../../../src/shared/errors.js";
import { findProjectRoot, flareRun } from "../../../src/shared/flare/project.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "fixtures", "flare");
const PROJECT = join(FIXTURES, "project");
const TOPIC = join(PROJECT, "Content", "Topics", "A.htm");
const ONE = join(FIXTURES, "one-target");
const TWO = join(FIXTURES, "two-projects");
const NO_PROJECT = join(FIXTURES, "meta", "topic.htm");

let stderr: string[];
beforeEach(() => {
  resetWarnings();
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("findProjectRoot", () => {
  it("finds the nearest folder holding a .flprj", () => {
    expect(findProjectRoot(TOPIC)).toBe(PROJECT);
  });

  it("is undefined with no project above the file", () => {
    expect(findProjectRoot(NO_PROJECT)).toBeUndefined();
  });

  it("refuses a folder holding two projects", () => {
    const find = () => findProjectRoot(join(TWO, "Content", "A.htm"));
    expect(find).toThrow(ToolError);
    expect(find).toThrow(
      `${TWO} holds two Flare projects, Alpha.flprj and Beta.flprj. manni reads one project per folder.`,
    );
  });
});

describe("flareRun: projectFor", () => {
  it("reads the project's file, language, targets and variables", () => {
    const project = flareRun(undefined).projectFor(TOPIC);
    expect(project?.root).toBe(PROJECT);
    expect(project?.flprj).toBe("Widget.flprj");
    expect(project?.language).toBe("en-us");
    expect(project?.targets).toEqual(["HTML5", "Print"]);
    expect(project?.variables.get("General")?.has("ProductVersion")).toBe(true);
  });

  it("is undefined for a file no project holds", () => {
    expect(flareRun(undefined).projectFor(NO_PROJECT)).toBeUndefined();
  });

  it("uses the target tools.flare.target names", () => {
    const project = flareRun({ flare: { target: "Print" } }).projectFor(TOPIC);
    expect(project?.target?.name).toBe("Print");
    expect(stderr).toEqual([]);
  });

  it("uses a project's only target", () => {
    const project = flareRun({}).projectFor(join(ONE, "Content", "A.htm"));
    expect(project?.target?.name).toBe("Online");
    expect(project?.language).toBeUndefined();
    expect(stderr).toEqual([]);
  });

  it("uses no target when there are several and none is named, and says so once", () => {
    const run = flareRun({});
    expect(run.projectFor(TOPIC)?.target).toBeUndefined();
    run.projectFor(TOPIC);
    run.projectFor(join(PROJECT, "Content", "B.htm"));
    expect(stderr).toEqual([
      "manni: Widget.flprj has 2 targets and tools.flare.target names none, so every condition is included and every variable takes its default.\n",
    ]);
  });

  it("refuses a target the project does not have, listing the ones it does", () => {
    const project = () => flareRun({ flare: { target: "PDF" } }).projectFor(TOPIC);
    expect(project).toThrow(ToolError);
    expect(project).toThrow(
      'tools.flare.target "PDF" names no target in Widget.flprj. Its targets are HTML5 and Print.',
    );
  });

  it("names a lone target without a conjunction", () => {
    const project = () =>
      flareRun({ flare: { target: "PDF" } }).projectFor(join(ONE, "Content", "A.htm"));
    expect(project).toThrow(
      'tools.flare.target "PDF" names no target in Solo.flprj. Its targets are Online.',
    );
  });
});

describe("flareRun: what a run says once", () => {
  it("says once per run that a page has no project", () => {
    const run = flareRun(undefined);
    run.noProjectNotice("a.htm");
    run.noProjectNotice("b.htm");
    expect(stderr).toEqual([
      "manni: No Flare project (.flprj) holds a.htm, so its variables and conditions are left unresolved.\n",
    ]);
  });

  it("warns once per undefined variable name", () => {
    const run = flareRun({ flare: { target: "HTML5" } });
    const project = run.projectFor(TOPIC);
    if (project === undefined) throw new Error("fixture project not found");
    run.warnUndefinedVariable("A.htm", "General.Missing", project);
    run.warnUndefinedVariable("B.htm", "General.Missing", project);
    run.warnUndefinedVariable("B.htm", "General.Other", project);
    expect(stderr).toEqual([
      "manni: A.htm: variable General.Missing is not defined in Widget.flprj. The reference is kept as text.\n",
      "manni: B.htm: variable General.Other is not defined in Widget.flprj. The reference is kept as text.\n",
    ]);
  });

  it("warns once per snippet that includes itself", () => {
    const run = flareRun(undefined);
    run.warnSnippetCycle("A.htm", "Loop.flsnp", ["Loop.flsnp", "Inner.flsnp", "Loop.flsnp"]);
    run.warnSnippetCycle("B.htm", "Loop.flsnp", ["Loop.flsnp", "Loop.flsnp"]);
    expect(stderr).toEqual([
      "manni: A.htm: snippet Loop.flsnp includes itself through Loop.flsnp > Inner.flsnp > Loop.flsnp. It is expanded once.\n",
    ]);
  });
});
