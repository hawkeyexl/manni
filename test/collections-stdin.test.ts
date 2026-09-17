/**
 * Regression: `-` used to cancel an explicit `--collection`.
 *
 * `resolveRunConfig` decided whether a run's targets came from the configured
 * collections with `opts.inputs.length === 0`, and that count included the
 * stdin token. The refusal above it already filters `-` out — stdin is allowed
 * beside `--collection` — so `manni meta validate - --as markdown --collection
 * guides` was accepted, read stdin, opened not one file of the collection,
 * printed no warning, and exited 0: a green run that checked nothing the flag
 * named.
 *
 * After the fix an explicit `--collection` is honoured whatever else is in
 * the run: the stdin token is kept at the front and the selected collections'
 * paths are appended in declaration order, so stdin is processed *and* the
 * collection's files are walked, in one run. A bare `-` with no flag still
 * cancels the implicit fallback, because a piped document is a run of its own.
 *
 * The config is written inline into a temp dir rather than committed as a
 * fixture, which is what the `--collection` flag-behavior tests already do
 * (`test/cli.integration.test.ts`, "cli --collection (0041, built bin)"): the
 * behavior under test is which paths the run resolves, and a tree built here
 * is read beside the assertion that depends on it.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockProvider } from "@hawkeyexl/inference";
import { makeTempRepo, removeTempRepo } from "./helpers/temp-repo.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { runGet } from "../src/meta/commands/get.js";
import { runQuery } from "../src/meta/commands/query.js";
import { runFill } from "../src/meta/commands/fill.js";
import { runInferSchema } from "../src/meta/commands/schemas.js";
import { runDerive } from "../src/meta/commands/derive.js";
import { runRelocate } from "../src/meta/commands/relocate.js";
import { DocmetaError } from "../src/meta/types.js";

/**
 * One collection, `guides`, whose single member fails the configured schema.
 * A run that skipped the collection looks identical to one that walked it
 * unless the collection's file is *observable* in the result, so the member is
 * the only thing here that can fail and the only thing carrying `guideonly`.
 */
const CONFIG = [
  "collections:",
  "  - name: guides",
  "    paths:",
  '      - "docs/guides/**/*.md"',
  "meta:",
  "  schemas:",
  "    - ./guide.json",
  "",
].join("\n");

const SCHEMA = JSON.stringify({
  type: "object",
  required: ["title", "owner"],
  properties: {
    title: { type: "string" },
    owner: { type: "string" },
    guideonly: { type: "string" },
  },
});

/** The collection's one member: no `owner`, so validate has something to say. */
const GUIDE = "---\ntitle: auth\nguideonly: g\n---\n\n# auth\n";

/** What is piped in. Valid, so a failure below can only be the guide's. */
const PIPED = "---\ntitle: piped\nowner: sam\n---\n\n# piped\n";

const GUIDE_PATH = "docs/guides/auth.md";
const STDIN = "<stdin>";

const tree = (): Record<string, string> => ({
  "manni.config.yaml": CONFIG,
  "guide.json": SCHEMA,
  [GUIDE_PATH]: GUIDE,
});

/** Labels as the run reported them, posix-normalized and sorted. */
const labels = (files: string[]): string[] =>
  files.map((f) => f.replace(/\\/g, "/")).sort();

/** `<stdin>` and the collection's member, together, and nothing else. */
const BOTH = [STDIN, GUIDE_PATH];

describe("--collection is honoured with stdin beside it", () => {
  let dir: string | undefined;

  beforeEach(() => {
    dir = makeTempRepo({ files: tree(), init: false });
  });

  afterEach(() => {
    removeTempRepo(dir);
    dir = undefined;
  });

  it("validate reads stdin and checks the collection's file", async () => {
    const { results, summary } = await runValidate({
      inputs: ["-"],
      as: "markdown",
      stdinContent: PIPED,
      collections: ["guides"],
      cwd: dir,
      env: {},
    });

    expect(labels(results.map((r) => r.file))).toEqual(BOTH);
    // The guide was really opened, not merely counted: its missing `owner` is
    // the finding, and stdin's document has one.
    const guide = results.find((r) => r.file.replace(/\\/g, "/") === GUIDE_PATH);
    expect(guide?.ok).toBe(false);
    expect(guide?.errors.map((e) => e.message)).toContain(
      "must have required property 'owner'",
    );
    expect(summary.failed).toBe(1);
  });

  it("get reads stdin and the collection's file", async () => {
    const results = await runGet({
      fields: ["title"],
      inputs: ["-"],
      as: "markdown",
      stdinContent: PIPED,
      collections: ["guides"],
      cwd: dir,
      // The evidence sources are a separate concern, and there is no git
      // repository here for them to read.
      derived: false,
    });

    expect(labels(results.map((r) => r.file))).toEqual(BOTH);
    const guide = results.find((r) => r.file.replace(/\\/g, "/") === GUIDE_PATH);
    expect(guide?.values.title).toBe("auth");
  });

  it("query rows cover stdin and the collection's file", async () => {
    const { rows } = await runQuery({
      sql: "SELECT _path, title FROM docs ORDER BY _path",
      inputs: ["-"],
      as: "markdown",
      stdinContent: PIPED,
      collections: ["guides"],
      cwd: dir,
    });

    expect(labels(rows.map((r) => String(r._path)))).toEqual(BOTH);
    const guide = rows.find(
      (r) => String(r._path).replace(/\\/g, "/") === GUIDE_PATH,
    );
    expect(guide?.title).toBe("auth");
  });

  it("fill proposes for stdin and the collection's file", async () => {
    const { results } = await runFill({
      inputs: ["-"],
      as: "markdown",
      stdinContent: PIPED,
      collections: ["guides"],
      cwd: dir,
      fields: ["owner"],
      // Dry run plus the injected provider: nothing is written and nothing is
      // fetched, exactly as the rest of the fill suite runs.
      dryRun: true,
      cache: false,
      env: {},
      inferenceProvider: new MockProvider([
        {
          json: {
            owner: { value: "platform", confidence: 0.95, reasoning: "stated" },
          },
        },
      ]),
    });

    expect(labels(results.map((r) => r.file))).toEqual(BOTH);
    const guide = results.find((r) => r.file.replace(/\\/g, "/") === GUIDE_PATH);
    // The guide's missing `owner` is the candidate, which only a file that was
    // actually read and validated can produce.
    expect(guide?.fields.map((f) => f.field)).toContain("/owner");
  });

  it("schemas infer scans stdin and the collection's file", async () => {
    const result = await runInferSchema({
      inputs: ["-"],
      as: "markdown",
      stdinContent: PIPED,
      collections: ["guides"],
      cwd: dir,
    });

    expect(result.filesScanned).toBe(2);
    // `guideonly` exists in no other document, so the key can only have come
    // from the collection's member.
    expect(result.keys.map((k) => k.key)).toContain("guideonly");
  });

  it("a bare - with no --collection is a run of its own", async () => {
    // The other side of the rule, and the reason the fix reads `--collection`
    // rather than the input count: the flag is a request a run has to honour,
    // while the *implicit* collections fallback is not. A piped document has
    // no history and is a member of nothing, so nothing of the configured
    // corpus joins it.
    const { results, summary } = await runValidate({
      inputs: ["-"],
      as: "markdown",
      stdinContent: PIPED,
      cwd: dir,
      env: {},
    });

    expect(labels(results.map((r) => r.file))).toEqual([STDIN]);
    expect(summary.failed).toBe(0);
  });

  // The two commands that refuse `-` outright. Pinned so the refusal is
  // recorded rather than left to drift once the fallback keeps the token.
  it("derive still refuses stdin", async () => {
    await expect(
      runDerive({
        inputs: ["-"],
        collections: ["guides"],
        cwd: dir,
      }),
    ).rejects.toThrow(
      new DocmetaError("cannot derive <stdin>: no history behind it"),
    );
  });

  it("relocate still refuses stdin", async () => {
    await expect(
      runRelocate({
        inputs: ["-"],
        collections: ["guides"],
        cwd: dir,
      }),
    ).rejects.toThrow(
      new DocmetaError(
        "relocate moves values between documents and a collection's manifest, and stdin is not a document on disk.",
      ),
    );
  });
});
