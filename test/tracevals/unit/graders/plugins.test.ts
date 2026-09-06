/**
 * Grader-plugin loading (ADR 01017). The registry has always accepted late
 * registration; what is covered here is everything around it — where a
 * specifier resolves, and which of the four failure shapes each defect takes.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadGraderPlugins } from "../../../../src/tracevals/graders/plugins.js";
import {
  graderFor,
  listGraderKinds,
  registerGrader,
} from "../../../../src/tracevals/graders/registry.js";
import type { TraceGrader } from "../../../../src/tracevals/graders/types.js";
import { TracevalsError } from "../../../../src/tracevals/types.js";

const pluginsDir = fileURLToPath(new URL("../../fixtures/plugins", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const fixture = (name: string) => join(pluginsDir, name);

/**
 * The registry is module state shared by every test in this file, and one
 * fixture deliberately replaces a built-in. Put it back afterwards so the
 * collision case cannot leak into the cases that follow it.
 */
let builtins: Map<string, TraceGrader>;

beforeEach(() => {
  builtins = new Map(listGraderKinds().map((k) => [k, graderFor(k)!]));
});

afterEach(() => {
  for (const [, grader] of builtins) registerGrader(grader);
});

describe("loadGraderPlugins", () => {
  it("does nothing, loudly or otherwise, for an empty list", async () => {
    const { loaded, warnings } = await loadGraderPlugins({
      plugins: [],
      configDir: repoRoot,
    });
    expect(loaded).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("resolves a relative specifier against the config directory, not the cwd", async () => {
    // `./stayed-in-scope.mjs` is nonsense from the repo root, which is where
    // the suite runs. Portability of a committed config is the whole point.
    expect(process.cwd()).not.toBe(pluginsDir);
    const { warnings } = await loadGraderPlugins({
      plugins: ["./stayed-in-scope.mjs"],
      configDir: pluginsDir,
    });
    expect(warnings).toEqual([]);

    // Registered whole, not just present: `fill` refuses to propose a kind
    // that cannot ground-check its own options (ADR 01004).
    const grader = graderFor("stayed-in-scope");
    expect(grader).toBeDefined();
    expect(grader?.validateOptions?.({})).toMatch(/options\.root/);
    expect(grader?.validateOptions?.({ root: "src" })).toBeUndefined();
  });

  it("accepts an absolute path", async () => {
    await loadGraderPlugins({
      plugins: [fixture("absolute-probe.mjs")],
      configDir: repoRoot,
    });
    expect(graderFor("absolute-probe")).toBeDefined();
  });

  it("imports a specifier once however many times it is named", async () => {
    // A repeat import is an ESM no-op, so re-running a `register` export would
    // make the two plugin shapes disagree — and re-registering the same kind
    // would look like one plugin stealing it from another.
    const { loaded, warnings } = await loadGraderPlugins({
      plugins: [
        fixture("dedup-probe.mjs"),
        "./dedup-probe.mjs",
        fixture("dedup-probe.mjs"),
      ],
      configDir: pluginsDir,
    });
    expect(loaded).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("loads a plugin once per process, not once per call", async () => {
    // What a batch would otherwise trip over: N traces evaluated in one
    // process must not re-register, nor report N-1 spurious replacements.
    const again = await loadGraderPlugins({
      plugins: [fixture("dedup-probe.mjs")],
      configDir: repoRoot,
    });
    expect(again.loaded).toEqual([]);
    expect(again.warnings).toEqual([]);
    expect(graderFor("dedup-probe")).toBeDefined();
  });

  describe("failure modes", () => {
    it("makes an unresolvable specifier an operational error, not a skip", async () => {
      await expect(
        loadGraderPlugins({
          plugins: ["./no-such-plugin.mjs"],
          configDir: pluginsDir,
        }),
      ).rejects.toThrow(TracevalsError);
    });

    it("names the specifier and where it looked, and reads nothing like a typo'd grader", async () => {
      // The two are neighbours in practice — you reach for --require *because*
      // a run said `unknown grader kind`. Collapsing them sends the reader to
      // the artifact when the defect is in the config.
      const failure = await loadGraderPlugins({
        plugins: ["./no-such-plugin.mjs"],
        configDir: pluginsDir,
      }).catch((err: unknown) => err);
      expect(failure).toBeInstanceOf(TracevalsError);
      const message = (failure as Error).message;
      expect(message).toContain("could not load grader plugin");
      expect(message).toContain("./no-such-plugin.mjs");
      expect(message).toContain(pluginsDir);
      expect(message).not.toMatch(/unknown grader kind/);
    });

    // The fixture throws on the first line, so nothing here is slow — but this
    // is the file's first dynamic `import()`, and paying the module-graph
    // warmup on a cold windows-latest runner has come in just over vitest's
    // 5s default (measured: 5006ms). The assertion is that it rejects, not
    // that it rejects quickly, so give the import room rather than leaving a
    // marginal timeout to fail one CI leg at random.
    it("surfaces a plugin that throws while it is imported", async () => {
      await expect(
        loadGraderPlugins({
          plugins: [fixture("broken.mjs")],
          configDir: repoRoot,
        }),
      ).rejects.toThrow(/deliberately broken/);
    }, 30_000);

    // A separate failure mode, and previously unreachable from this suite:
    // `broken.mjs` throws while its module body evaluates, so it never gets as
    // far as the registrar and lands in the *first* catch. This one imports
    // cleanly and throws from inside `register()`, which is the only way to
    // exercise the second. ADR 01017 lists them separately because the messages
    // have to be told apart — "could not load" points at the specifier, "threw
    // while registering" points inside the plugin.
    it("surfaces a plugin that throws while it is registering", async () => {
      await expect(
        loadGraderPlugins({
          plugins: [fixture("register-throws.mjs")],
          configDir: repoRoot,
        }),
      ).rejects.toThrow(/threw while registering/);
    });

    it("tells a registration failure apart from a load failure", async () => {
      // The two catches must not be confusable: a reader who cannot tell which
      // one fired does not know whether to look at their config or the plugin.
      const message = await loadGraderPlugins({
        plugins: [fixture("register-throws.mjs")],
        configDir: repoRoot,
      }).then(
        () => "did not throw",
        (err: unknown) => (err as Error).message,
      );
      expect(message).toMatch(/register-throws\.mjs/);
      expect(message).toMatch(/fails while registering/);
      expect(message).not.toMatch(/could not load/);
    });

    it("warns — but does not fail — when a plugin registers nothing", async () => {
      const { loaded, warnings } = await loadGraderPlugins({
        plugins: [fixture("registers-nothing.mjs")],
        configDir: repoRoot,
      });
      expect(loaded).toHaveLength(1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("registers-nothing.mjs");
      expect(warnings[0]).toMatch(/registered no grader kinds/);
    });

    it("allows a plugin to replace a built-in, and says which one", async () => {
      const original = graderFor("file-access");
      const { warnings } = await loadGraderPlugins({
        plugins: [fixture("overrides-file-access.mjs")],
        configDir: repoRoot,
      });
      expect(graderFor("file-access")).not.toBe(original);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/replaced the built-in grader "file-access"/);
    });
  });

  describe("bare specifiers", () => {
    let dir: string;

    beforeEach(async () => {
      await mkdir(".tmp", { recursive: true });
      dir = resolve(await mkdtemp(join(".tmp", "plugins-")));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("resolves a package name from the config directory", async () => {
      // Node's own algorithm, run from beside the config rather than from
      // beside this package: a plugin installed in the project being evaluated
      // has to win.
      const pkg = join(dir, "node_modules", "fixture-grader-plugin");
      await mkdir(pkg, { recursive: true });
      await writeFile(
        join(pkg, "package.json"),
        JSON.stringify({ name: "fixture-grader-plugin", version: "0.0.0", main: "index.mjs" }),
        "utf-8",
      );
      // Re-exports the committed fixture rather than restating it: what is
      // under test here is resolution, not the grader.
      const back = relative(pkg, fixture("bare-probe.mjs")).replace(/\\/g, "/");
      await writeFile(join(pkg, "index.mjs"), `export { register } from "${back}";\n`, "utf-8");

      await loadGraderPlugins({
        plugins: ["fixture-grader-plugin"],
        configDir: dir,
      });
      expect(graderFor("bare-probe")).toBeDefined();
    });

    it("errors on a package name nothing resolves", async () => {
      await expect(
        loadGraderPlugins({
          plugins: ["definitely-not-a-real-grader-package"],
          configDir: dir,
        }),
      ).rejects.toThrow(TracevalsError);
    });
  });
});
