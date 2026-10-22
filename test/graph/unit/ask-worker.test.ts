/**
 * The Ask AI worker the "Retrieve from a script" page shows is the file
 * `tsc` type-checks, test/graph/fixtures/ask-worker/worker.ts. The page
 * imports the published entry point and the fixture imports source, so that
 * one specifier is the only difference allowed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const page = readFileSync(
  join(root, "docs/src/content/docs/graph/retrieve-from-a-script/index.mdx"),
  "utf8",
).replace(/\r\n/g, "\n");
const fixture = readFileSync(join(root, "test/graph/fixtures/ask-worker/worker.ts"), "utf8").replace(/\r\n/g, "\n");

describe("the page's Ask AI worker", () => {
  it("is the type-checked fixture, importing the published entry point", () => {
    const code = fixture
      .split("\n")
      .filter((line) => !line.startsWith("//"))
      .join("\n")
      .trimStart()
      .replace("../../../../src/graph/runtime/index.js", "@hawkeyexl/manni/graph/runtime");
    const block = /```ts title="worker\.ts"\n([\s\S]*?)```/.exec(page)?.[1];
    expect(block, 'the page has a ts block titled "worker.ts"').toBeDefined();
    expect(block).toBe(code);
  });
});
