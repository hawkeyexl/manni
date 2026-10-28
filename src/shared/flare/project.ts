/**
 * The Flare project a page belongs to (proposal 0125, decisions 10 and 11).
 *
 * The project is found, never named: it is the nearest folder above a page
 * holding a `.flprj`. The target is `tools.flare.target`, else the project's
 * only one, else none, in which case every condition is included and every
 * variable takes its default. A run reads each project once, and says each
 * thing it has to say about one once.
 */
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ToolError } from "../errors.js";
import { noticeOnce, warn } from "../warn.js";
import { type FlareTarget, readTarget } from "./target.js";
import { type VariableSets, readVariableSets } from "./variables.js";
import { readRoot } from "./xml.js";

/** A Flare project that cannot be read as one, exit 2. */
export class FlareError extends ToolError {
  constructor(message: string) {
    super(message);
    this.name = "FlareError";
  }
}

export interface FlareProject {
  /** The folder holding the `.flprj`. */
  root: string;
  /** The `.flprj` file's name. */
  flprj: string;
  /** The project's `xml:lang`. */
  language?: string;
  /** Every target's name, sorted. */
  targets: string[];
  /** The target this run resolves against, when there is one. */
  target?: FlareTarget;
  /** Why `target` is the one: the config named it, or it is the only one. */
  targetFrom?: "tools.flare.target" | "the only target";
  variables: VariableSets;
}

export interface FlareRun {
  /** The project holding `absPath`, read once per run. */
  projectFor(absPath: string): FlareProject | undefined;
  /** Say, once per run, that a page has no project. */
  noProjectNotice(file: string): void;
  /** Warn, once per name per run, that a page names a variable no set defines. */
  warnUndefinedVariable(file: string, name: string, project: FlareProject): void;
  /** Warn, once per snippet per run, that a snippet includes itself. */
  warnSnippetCycle(file: string, snippet: string, chain: readonly string[]): void;
}

/** The names in `folder` ending in `ext`, sorted, or none when it cannot be read. */
function filesIn(folder: string, ext: string, recursive = false): string[] {
  try {
    return readdirSync(folder, { recursive, encoding: "utf8" })
      .filter((name) => name.toLowerCase().endsWith(ext))
      .sort();
  } catch {
    return [];
  }
}

/**
 * The nearest folder at or above `absPath`'s folder that holds a `.flprj`.
 * Flare never writes two in one folder, so two is refused rather than chosen
 * between.
 */
export function findProjectRoot(absPath: string): string | undefined {
  for (let dir = dirname(absPath); ; dir = dirname(dir)) {
    const [a, b] = filesIn(dir, ".flprj");
    if (a !== undefined && b !== undefined) {
      throw new FlareError(
        `${dir} holds two Flare projects, ${a} and ${b}. manni reads one project per folder.`,
      );
    }
    if (a !== undefined) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

/** "A", "A and B", "A, B and C". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

function readProject(root: string, configured: string | undefined): FlareProject {
  const flprj = filesIn(root, ".flprj")[0] ?? "";
  const targetsDir = join(root, "Project", "Targets");
  const targetFiles = filesIn(targetsDir, ".fltar", true);
  const names = targetFiles.map((file) => basename(file).replace(/\.fltar$/i, ""));
  const targets = [...new Set(names)].sort();

  let chosen: string | undefined;
  if (configured !== undefined) {
    if (!targets.includes(configured)) {
      throw new FlareError(
        `tools.flare.target "${configured}" names no target in ${flprj}. Its targets are ${listOf(targets)}.`,
      );
    }
    chosen = configured;
  } else if (targets.length === 1) {
    chosen = targets[0];
  } else if (targets.length > 1) {
    noticeOnce(
      `${flprj} has ${String(targets.length)} targets and tools.flare.target names none, so every condition is included and every variable takes its default.`,
    );
  }

  const project: FlareProject = {
    root,
    flprj,
    targets,
    variables: readVariableSets(root),
  };
  const language = readRoot(join(root, flprj))?.getAttribute("xml:lang");
  if (language) project.language = language;
  const file = targetFiles[names.indexOf(chosen ?? "")];
  if (chosen !== undefined && file !== undefined) {
    project.target = readTarget(join(targetsDir, file));
    project.targetFrom = configured === undefined ? "the only target" : "tools.flare.target";
  }
  return project;
}

export function flareRun(tools: { flare?: { target?: string } } | undefined): FlareRun {
  const configured = tools?.flare?.target;
  const roots = new Map<string, string | undefined>();
  const projects = new Map<string, FlareProject>();
  let saidNoProject = false;
  const undefinedNames = new Set<string>();
  const cycles = new Set<string>();

  return {
    projectFor(absPath) {
      const dir = dirname(absPath);
      let root = roots.get(dir);
      if (!roots.has(dir)) {
        root = findProjectRoot(absPath);
        roots.set(dir, root);
      }
      if (root === undefined) return undefined;
      let project = projects.get(root);
      if (project === undefined) {
        project = readProject(root, configured);
        projects.set(root, project);
      }
      return project;
    },
    noProjectNotice(file) {
      if (saidNoProject) return;
      saidNoProject = true;
      noticeOnce(
        `No Flare project (.flprj) holds ${file}, so its variables and conditions are left unresolved.`,
      );
    },
    warnUndefinedVariable(file, name, project) {
      if (undefinedNames.has(name)) return;
      undefinedNames.add(name);
      warn(
        `${file}: variable ${name} is not defined in ${project.flprj}. The reference is kept as text.`,
      );
    },
    warnSnippetCycle(file, snippet, chain) {
      if (cycles.has(snippet)) return;
      cycles.add(snippet);
      warn(
        `${file}: snippet ${snippet} includes itself through ${chain.join(" > ")}. It is expanded once.`,
      );
    },
  };
}
