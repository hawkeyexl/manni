/**
 * Readers (proposal 0111): an `ai` eval with `options: { readers: personas }`
 * is judged as the page's personas. Everything here is the resolution step,
 * `resolveReaders`, over the committed fixtures. What the judge does with the
 * readers is `judge.test.ts`'s, and the byte-for-byte fall-back is
 * `integration/personas.test.ts`'s.
 */
import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { defaultConfig, loadConfig } from "../../../src/docevals/core/config.js";
import { discoverPages } from "../../../src/docevals/core/discover.js";
import { withExternalMetadata } from "../../../src/docevals/core/external.js";
import { resolvePages, type ResolvedPagePlan } from "../../../src/docevals/core/resolve.js";
import { resolveReaders, type LoadPersonas } from "../../../src/docevals/core/readers.js";

const PERSONAS = resolve(import.meta.dirname, "../fixtures/personas");
const FREE_FORM = resolve(import.meta.dirname, "../fixtures/personas-free-form");

async function plansOf(dir: string, paths: string[] = []) {
  const config = loadConfig(undefined, dir);
  const pages = await withExternalMetadata(discoverPages(config, { paths, verb: "evaluate" }, dir), config, dir);
  return { config, plans: resolvePages(pages, config) };
}

function evalOf(plans: ResolvedPagePlan[], file: string, name: string) {
  const ev = plans.find((p) => p.page.file === file)?.evals.find((e) => e.name === name);
  if (ev === undefined) throw new Error(`${file} resolved no eval ${name}`);
  return ev;
}

const throwing: LoadPersonas = () => {
  throw new Error("the loader was called");
};

describe("resolveReaders over the persona fixture", () => {
  it("gives an opted-in eval its readers, and a sibling eval on the same page none", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    await resolveReaders(plans, config, PERSONAS);
    expect(evalOf(plans, "docs/one-reader.md", "finish-task").readers?.personas).toEqual(["theo"]);
    expect(evalOf(plans, "docs/one-reader.md", "plain-judge").readers).toBeUndefined();
    expect(evalOf(plans, "docs/one-reader.md", "no-todo-markers").readers).toBeUndefined();
  });

  it("reads a string, a list and mixed case, in the page's order, spelled as the records spell them, once each", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    await resolveReaders(plans, config, PERSONAS);
    expect(evalOf(plans, "docs/string-reader.md", "finish-task").readers?.personas).toEqual(["theo"]);
    expect(evalOf(plans, "docs/two-readers.md", "finish-task").readers?.personas).toEqual(["theo", "maya"]);
  });

  it("reads personas a manifest supplies, and a use: reference's option", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    await resolveReaders(plans, config, PERSONAS);
    expect(evalOf(plans, "docs/sidecar-reader.md", "finish-task").readers?.personas).toEqual(["theo"]);
    expect(evalOf(plans, "docs/use-reader.md", "reader-can-finish").readers?.personas).toEqual(["theo"]);
  });

  it("names the record files the readers came from", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    await resolveReaders(plans, config, PERSONAS);
    expect(evalOf(plans, "docs/two-readers.md", "finish-task").readers?.files).toEqual([
      resolve(PERSONAS, "strategy/theo.md"),
      resolve(PERSONAS, "strategy/maya.md"),
    ]);
  });

  it("leaves out an id no record defines, and a page naming none, with no problem", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    const problems = await resolveReaders(plans, config, PERSONAS);
    expect(evalOf(plans, "docs/unknown-reader.md", "finish-task").readers).toBeUndefined();
    expect(evalOf(plans, "docs/no-reader.md", "finish-task").readers).toBeUndefined();
    expect(problems.filter((p) => p.file !== "docs/bad-value.md")).toEqual([]);
  });

  it("gives a record page no readers", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    await resolveReaders(plans, config, PERSONAS);
    expect(evalOf(plans, "strategy/t1.md", "journey-outcome").readers).toBeUndefined();
  });

  it("refuses readers: persona where persona records exist, in optionalEnum's sentence", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    const problems = await resolveReaders(plans, config, PERSONAS);
    expect(problems).toEqual([
      {
        file: "docs/bad-value.md",
        level: "error",
        message: 'Eval "finish-task": ai options.readers must be one of: personas',
      },
    ]);
    expect(evalOf(plans, "docs/bad-value.md", "finish-task").readers).toBeUndefined();
  });

  it("ignores reader: personas", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    const problems = await resolveReaders(plans, config, PERSONAS);
    expect(problems.some((p) => p.file === "docs/bad-key.md")).toBe(false);
    expect(evalOf(plans, "docs/bad-key.md", "finish-task").readers).toBeUndefined();
  });

  it("never calls the loader when no eval carries options.readers", async () => {
    const { config, plans } = await plansOf(PERSONAS, ["docs/not-opted.md", "docs/bad-key.md"]);
    await expect(resolveReaders(plans, config, PERSONAS, throwing)).resolves.toEqual([]);
  });

  it("calls the loader once for a run with many opted-in evals", async () => {
    const { config, plans } = await plansOf(PERSONAS);
    const load = vi.fn<LoadPersonas>(() => Promise.resolve([]));
    await resolveReaders(plans, config, PERSONAS, load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("resolveReaders with no persona records", () => {
  it("gives no readers, reports nothing and prints nothing", async () => {
    const { config, plans } = await plansOf(FREE_FORM);
    const stderr = vi.spyOn(process.stderr, "write");
    const problems = await resolveReaders(plans, config, FREE_FORM);
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
    expect(problems).toEqual([]);
    expect(plans.flatMap((p) => p.evals).every((e) => e.readers === undefined)).toBe(true);
  });

  it("never loads under --no-config, which declares no collection", async () => {
    const { plans } = await plansOf(PERSONAS);
    await expect(resolveReaders(plans, defaultConfig(PERSONAS), PERSONAS)).resolves.toEqual([]);
    expect(plans.flatMap((p) => p.evals).every((e) => e.readers === undefined)).toBe(true);
  });
});
