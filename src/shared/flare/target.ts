/**
 * A Flare target (proposal 0125, decision 11): the condition expression
 * content is filtered by, and the variable definitions it overrides.
 */
import { basename } from "node:path";
import { type ConditionExpression, parseConditionExpression } from "./conditions.js";
import { readRoot } from "./xml.js";

export interface FlareTarget {
  /** The file name without `.fltar`, which is how Flare names a target. */
  name: string;
  file: string;
  expression?: ConditionExpression;
  /** `Set.Name` to the target's own value. */
  variables: Map<string, string>;
}

/**
 * Read a `.fltar`. The root's `conditions=` attribute tags the target file
 * itself, and is not read. A target writes an override's name as `Set/Name`.
 */
export function readTarget(file: string): FlareTarget {
  const target: FlareTarget = {
    name: basename(file).replace(/\.fltar$/i, ""),
    file,
    variables: new Map(),
  };
  const root = readRoot(file);
  if (root === null) return target;

  const text = root.getAttribute("ConditionTagExpression") ?? "";
  if (text.trim() !== "") target.expression = parseConditionExpression(text);

  for (const variable of Array.from(root.getElementsByTagName("Variable"))) {
    const name = variable.getAttribute("Name")?.replace("/", ".");
    if (name === undefined || target.variables.has(name)) continue;
    target.variables.set(name, variable.textContent ?? "");
  }
  return target;
}
