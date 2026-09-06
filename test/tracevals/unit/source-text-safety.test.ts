/**
 * Source files must stay *text*.
 *
 * `workflows.test.ts` guards the same property for `.github/workflows`, where a
 * literal NUL once made a workflow unparseable on GitHub while every other
 * check went green. The failure mode in a `.ts` file is quieter and worse: git
 * marks the file binary, so its diff shows as `Bin 0 -> 4917 bytes` and is
 * invisible in review, it cannot be three-way merged, and `grep` prints
 * `Binary file … matches` and nothing else.
 *
 * The `\\u0000` escape has the identical runtime value and none of that, so a
 * literal NUL in source is never the thing anyone wanted.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../..", import.meta.url));

/** Where hand-written source lives. Fixtures are data and are exempt. */
const ROOTS = ["src/tracevals", "test/tracevals/unit", "test/tracevals/integration"];
const SOURCE = /\.(ts|mts|cts|js|mjs|cjs|json|yaml|yml|md|mdx)$/;

/**
 * Tab, LF and CR are the only C0 characters a source file has a reason to
 * hold; anything else is an escape someone wrote raw. Built from a string so
 * this file states the rule without containing an instance of it.
 */
const CONTROL = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]",
  "g",
);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(entry)) out.push(path);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(join(repo, root)));

describe("tracked source files carry no control characters", () => {
  it("finds the source tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no literal NUL or other C0 control character in any source file", () => {
    const offenders: string[] = [];
    for (const path of files) {
      const text = readFileSync(path, "utf-8");
      for (const match of text.matchAll(CONTROL)) {
        const line = text.slice(0, match.index).split("\n").length;
        const code = match[0].codePointAt(0)!.toString(16).padStart(4, "0");
        offenders.push(`${path.slice(repo.length)}:${line} U+${code}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
