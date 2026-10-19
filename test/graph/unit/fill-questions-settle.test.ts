/**
 * The question pass's settle loop (proposal 0087). A writer that moves the
 * body on every write never lets the pins settle, so fill stops after three
 * writes and says so. The stub adds one more blank line after the frontmatter
 * on each write.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { runFill } from "../../../src/graph/commands/fill.js";
import { resetWarnings } from "../../../src/shared/warn.js";

vi.mock("../../../src/graph/core/frontmatter-edit.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/graph/core/frontmatter-edit.js")>();
  let writes = 0;
  return {
    ...real,
    writeGraphFields: (...args: Parameters<typeof real.writeGraphFields>) => {
      const out = real.writeGraphFields(...args);
      writes++;
      return { ...out, content: out.content.replace("\n---\n", `\n---\n${"\n".repeat(writes)}`) };
    },
  };
});

const FIXTURE = resolve(__dirname, "..", "fixtures", "questions", "fill-draft");
let dir: string | undefined;

afterEach(() => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  resetWarnings();
});

it("stops after three writes when the pins keep moving, and says so", async () => {
  dir = mkdtempSync(join(tmpdir(), "manni-graph-settle-"));
  cpSync(FIXTURE, dir, { recursive: true });
  const provider = new MockProvider([
    {
      json: {
        pairs: [],
        drafts: [{ question: "How often does the client try again?", quote: "The client tries three more times", confidence: 0.9 }],
      },
    },
  ]);
  const report = await runFill({ cwd: dir, paths: ["docs/retry.md"], providerInstance: provider, noCache: true });
  expect(report.warnings).toContain("docs/retry.md: the answer pins did not settle, so check their lines.");
});
