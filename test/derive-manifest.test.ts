/**
 * `meta derive` writing a manifest another command wrote under it.
 *
 * `derive` holds every manifest it writes from the first file that touches it
 * to the end of the run, and writes each once. Another command writing the
 * same manifest inside that window used to lose its entries without a word.
 * These tests pin the compare-and-swap.
 *
 * The other command is simulated at the first page write, which `derive`
 * reaches after it has read the manifest and long before it writes it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { resetWarnings } from "../src/shared/warn.js";
import { commit, makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";

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

const { runDerive } = await import("../src/meta/commands/derive.js");
const { DocmetaError } = await import("../src/meta/types.js");

vi.setConfig({ testTimeout: 60_000 });

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "fixtures", "manifest-cas", "derive-race");
const D1 = "2026-08-20T10:00:00+00:00";

const dirs: string[] = [];
beforeEach(() => {
  resetWarnings();
  race.onPageWrite = null;
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const d of dirs.splice(0)) removeTempRepo(d);
});

function stage(): string {
  const dir = makeTempRepo({ files: {} });
  dirs.push(dir);
  cpSync(FIXTURE, dir, { recursive: true });
  commit(dir, "add", { authorDate: D1 });
  return dir;
}

const read = (dir: string, rel: string): string => readFileSync(join(dir, rel), "utf8");

/** The other command: append an entry to the manifest as it stands now. */
const append = (dir: string, text: string): void => {
  const at = join(dir, "site-meta.yaml");
  writeFileSync(at, `${readFileSync(at, "utf8")}${text}`, "utf8");
};

describe("derive: a manifest another command wrote under the run", () => {
  it("keeps the entry another command wrote while this one was running", async () => {
    const dir = stage();
    race.onPageWrite = () => {
      append(dir, 'docs/other.md:\n  owner: ["@ops"]\n');
    };

    const run = await runDerive({ inputs: [], cwd: dir });

    expect(run.results.every((r) => r.error === undefined)).toBe(true);
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/install.md": { owner: ["@platform-docs"] },
      "docs/other.md": { owner: ["@ops"] },
      "docs/faq.md": { owner: ["@platform-docs"] },
    });
  });

  it("keeps another key of the very entry this run wrote", async () => {
    const dir = stage();
    // The conflict base is an entry's key, not the whole entry: a command
    // writing `reviewedBy` into this page's entry is not writing `owner`.
    race.onPageWrite = () => {
      append(dir, "docs/faq.md:\n  reviewedBy: ops\n");
    };

    const run = await runDerive({ inputs: [], cwd: dir });

    expect(run.results.every((r) => r.error === undefined)).toBe(true);
    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/install.md": { owner: ["@platform-docs"] },
      "docs/faq.md": { reviewedBy: "ops", owner: ["@platform-docs"] },
    });
  });

  it("refuses when the same key changed, and writes nothing to the manifest", async () => {
    const dir = stage();
    race.onPageWrite = () => {
      append(dir, 'docs/faq.md:\n  owner: ["@ops"]\n');
    };

    await expect(runDerive({ inputs: [], cwd: dir })).rejects.toThrow(DocmetaError);

    expect(parseYaml(read(dir, "site-meta.yaml"))).toEqual({
      "docs/install.md": { owner: ["@old-team"] },
      "docs/faq.md": { owner: ["@ops"] },
    });
  });

  it("names the manifest and says nothing was written to it", async () => {
    const dir = stage();
    race.onPageWrite = () => {
      append(dir, 'docs/faq.md:\n  owner: ["@ops"]\n');
    };

    await expect(runDerive({ inputs: [], cwd: dir })).rejects.toThrow(
      "site-meta.yaml changed under the command while it was being written. Nothing was written to it. Re-run the command.",
    );
  });
});
