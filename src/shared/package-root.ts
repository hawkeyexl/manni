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

export function packageRoot(moduleUrl: string): string {
  let dir = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No package.json above ${fileURLToPath(moduleUrl)}`);
    }
    dir = parent;
  }
}
