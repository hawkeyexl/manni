/**
 * Flare variable sets (proposal 0125, decision 12).
 *
 * Each `.flvar` under `Project/VariableSets/` is one set, named for its file.
 * A variable's default is its first definition's text. `EvaluatedDefinition`
 * is a cache Flare rewrites on save, and can be stale, so it is not read. A
 * definition may name other variables as `[%=Set.Name%]`.
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readRoot } from "./xml.js";

export interface FlareVariable {
  /** The first definition's text, references unresolved. */
  definition: string;
  /** A date and time variable, whose value a run cannot know. */
  dateTime: boolean;
}

/** Set name to variable name to variable. */
export type VariableSets = Map<string, Map<string, FlareVariable>>;

const REFERENCE = /\[%=([^%\]]+)%\]/g;

export function readVariableSets(projectRoot: string): VariableSets {
  const sets: VariableSets = new Map();
  const dir = join(projectRoot, "Project", "VariableSets");
  let files: string[];
  try {
    files = readdirSync(dir, { recursive: true, encoding: "utf8" });
  } catch {
    return sets;
  }
  for (const file of files.filter((f) => f.toLowerCase().endsWith(".flvar")).sort()) {
    const root = readRoot(join(dir, file));
    if (root === null) continue;
    const set = new Map<string, FlareVariable>();
    for (const variable of Array.from(root.getElementsByTagName("Variable"))) {
      const name = variable.getAttribute("Name");
      if (name === null || set.has(name)) continue;
      set.set(name, {
        definition: variable.textContent ?? "",
        dateTime: variable.getAttribute("Type") === "DateTime",
      });
    }
    sets.set(basename(file).replace(/\.flvar$/i, ""), set);
  }
  return sets;
}

/** The variable `Set.Name` names, split on the first dot. */
export function lookupVariable(sets: VariableSets, name: string): FlareVariable | undefined {
  const dot = name.indexOf(".");
  if (dot < 0) return undefined;
  return sets.get(name.slice(0, dot))?.get(name.slice(dot + 1));
}

/**
 * The value of `Set.Name`, with the references in it resolved. An override
 * wins over the set. `undefined` for a name no set defines, a `System.*`
 * variable, or a date and time variable, so the caller keeps the reference.
 */
export function resolveVariable(
  sets: VariableSets,
  name: string,
  overrides?: ReadonlyMap<string, string>,
): string | undefined {
  return resolve(sets, name, overrides, new Set());
}

/** `text` with every `[%=Set.Name%]` that resolves replaced by its value. */
export function resolveText(
  sets: VariableSets,
  text: string,
  overrides?: ReadonlyMap<string, string>,
): string {
  return substitute(sets, text, overrides, new Set());
}

function resolve(
  sets: VariableSets,
  name: string,
  overrides: ReadonlyMap<string, string> | undefined,
  seen: ReadonlySet<string>,
): string | undefined {
  if (name.startsWith("System.")) return undefined;
  let value = overrides?.get(name);
  if (value === undefined) {
    const variable = lookupVariable(sets, name);
    if (variable === undefined || variable.dateTime) return undefined;
    value = variable.definition;
  }
  return substitute(sets, value, overrides, new Set([...seen, name]));
}

/** A reference back into `seen` is a cycle, and keeps its text. */
function substitute(
  sets: VariableSets,
  text: string,
  overrides: ReadonlyMap<string, string> | undefined,
  seen: ReadonlySet<string>,
): string {
  return text.replace(REFERENCE, (reference, raw: string) => {
    const name = raw.trim();
    if (seen.has(name)) return reference;
    return resolve(sets, name, overrides, seen) ?? reference;
  });
}
