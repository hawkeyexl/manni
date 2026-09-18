/**
 * The package root, for assets that ship beside the code.
 *
 * Some files are read by path at runtime rather than imported: a JSON Schema a
 * validator is pointed at, a template a linter loads. They live at the package
 * root (`schemas/<tool>/…`), listed in `files`, and are reached by walking up
 * from the calling module until a `package.json` appears. That is the one
 * rule that holds both in the source tree, where a module sits two or three
 * directories down, and in the bundle, where it sits in `dist/`.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ToolError } from "./errors.js";

export function packageRoot(moduleUrl: string): string {
  let dir = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      // A `ToolError`, not a bare one: the bin runner renders anything else as
      // "Unexpected error:" with a stack trace, which is what it says about a
      // bug. A package whose files did not ship is an operational failure and
      // reads as one line and exit 2, like every other.
      throw new ToolError(`No package.json above ${fileURLToPath(moduleUrl)}`);
    }
    dir = parent;
  }
}
