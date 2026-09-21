/**
 * `meta fill` writing a manifest another command wrote under it.
 *
 * `fill` reads the manifest that owns a field once, splices the entries of
 * every file it fills into the text it read, and writes the whole file back
 * after the model round trips. Another command doing the same thing over the
 * same working copy used to have its entries replaced by bytes that never had
 * them, and nothing reported it. These tests pin the compare-and-swap.
 *
 * The other command is simulated at the page write, which is the one point
 * `fill` reaches after it has read the manifest and before it writes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { MockProvider, type InferenceProvider } from "@hawkeyexl/inference";
import { resetWarnings } from "../src/shared/warn.js";

/** What the "other command" writes, and when: the first page write of a run. */
const race = vi.hoisted(() => ({ onPageWrite: null as null | (() => void) }));

vi.mock("../src/meta/core/write-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/meta/core/write-file.js")>();
  return {
    ...actual,
    writeFileAtomic: async (path: string, data: string | Uint8Array): Promise<void> => {
      const hook = race.onPageWrite;
      if (hook !== null && path.endsWith(".md")) {
        race.onPageWrite = null;
        hook();
      }
      await actual.writeFileAtomic(path, data);
    },
  };
});

const { runFill } = await import("../src/meta/commands/fill.js");
const { DocmetaError } = await import("../src/meta/types.js");

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "fixtures", "manifest-cas", "fill-race");
const MODEL = "claude-sonnet-4-5";

const dirs: string[] = [];
beforeEach(() => {
  resetWarnings();
  race.onPageWrite = null;
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function copy(): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-fill-race-"));
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");

/** One proposal of `title` and `owner`, which fill splits page / manifest. */
function proposer(owner: string): InferenceProvider {
  return new MockProvider(
    [
      {
        json: {
          title: { value: "Install", confidence: 0.9, reasoning: "the heading" },
          owner: { value: owner, confidence: 0.9, reasoning: "stated" },
        },
      },
    ],
    MODEL,
  );
}

/** The other command: append an entry to the manifest as it stands now. */
const append = (dir: string, text: string): void => {
  const at = join(dir, "site-meta.yaml");
  writeFileSync(at, `${readFileSync(at, "utf8")}${text}`, "utf8");
};

const base = { cache: false as const, concurrency: 1, inputs: ["docs/install.md"] };

describe("fill: a manifest another command wrote under the run", () => {
  it("keeps the entry another command wrote while this one was running", async () => {
    const dir = copy();
    race.onPageWrite = () => {
      append(dir, "docs/other.md:\n  owner: ops\n");
    };

    const run = await runFill({ ...base, cwd: dir, inferenceProvider: proposer("platform") });

    expect(run.results[0]?.error).toBeUndefined();
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/faq.md": { owner: "support" },
      "docs/other.md": { owner: "ops" },
      "docs/install.md": { owner: "platform" },
    });
  });

  it("keeps another key of the very entry this run wrote", async () => {
    const dir = copy();
    // The conflict base is an entry's key, not the whole entry: a command
    // writing `reviewedBy` into this page's entry is not writing `owner`.
    race.onPageWrite = () => {
      append(dir, "docs/install.md:\n  reviewedBy: ops\n");
    };

    const run = await runFill({ ...base, cwd: dir, inferenceProvider: proposer("platform") });

    expect(run.results[0]?.error).toBeUndefined();
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/faq.md": { owner: "support" },
      "docs/install.md": { reviewedBy: "ops", owner: "platform" },
    });
  });

  it("refuses when the same key changed, and puts the page back", async () => {
    const dir = copy();
    const page = read(dir, "docs/install.md");
    race.onPageWrite = () => {
      append(dir, "docs/install.md:\n  owner: ops\n");
    };

    await expect(runFill({ ...base, cwd: dir, inferenceProvider: proposer("platform") })).rejects.toThrow(
      DocmetaError,
    );

    // Nothing of this run survives: not the manifest entry, not the page.
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/faq.md": { owner: "support" },
      "docs/install.md": { owner: "ops" },
    });
    expect(read(dir, "docs/install.md")).toBe(page);
  });

  it("names the manifest, and says the page was restored", async () => {
    const dir = copy();
    race.onPageWrite = () => {
      append(dir, "docs/install.md:\n  owner: ops\n");
    };

    await expect(runFill({ ...base, cwd: dir, inferenceProvider: proposer("platform") })).rejects.toThrow(
      "site-meta.yaml changed under the command while it was being written. Nothing was written to it. Re-run the command. docs/install.md was restored.",
    );
  });
});
