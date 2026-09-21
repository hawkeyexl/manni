/**
 * Every published pre-commit hook's `files` pattern must cover exactly the
 * extensions manni actually reads. The hooks share one pattern, and the last
 * describe block runs the checks over all of them, so a hook added later is
 * pinned without anyone remembering to list it.
 *
 * Both directions matter, and each has its own failure. Too narrow and the hook
 * silently skips files the CLI would have checked — a green commit over an
 * unvalidated page, which is the failure docmeta exists to prevent. Too wide and
 * pre-commit hands docmeta files it will refuse, turning an unrelated commit
 * red.
 *
 * `test/extractors.test.ts` asserts only that `supportedExtensions()` *contains*
 * a handful of extensions. That is why the pattern first drafted for this hook
 * could omit `.markdown` and `.asciidoc` without anything noticing: a
 * containment check cannot see an omission. This one is an exact-set check on
 * purpose.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { supportedExtensions } from "../src/meta/extractors/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Hook {
  id: string;
  files: string;
  entry: string;
  language: string;
}

const hooks = parse(
  readFileSync(join(repoRoot, ".pre-commit-hooks.yaml"), "utf8"),
) as Hook[];

const docmetaHook = hooks.find((h) => h.id === "manni-meta");

/**
 * pre-commit uses Python's `re`; `(?i)` is an inline flag JS spells as a
 * trailing `i`, so translate rather than assuming they are interchangeable.
 */
function patternOf(hook: Hook): RegExp {
  return new RegExp(hook.files.replace(/^\(\?i\)/, ""), "i");
}

/**
 * The exact-set check, in both directions, for one hook's `files`. Too narrow
 * and the hook silently skips files the CLI would have read. Too wide and
 * pre-commit hands manni files it refuses, turning an unrelated commit red.
 */
function expectExactExtensionSet(hook: Hook): void {
  const re = patternOf(hook);
  const missed = supportedExtensions().filter((ext) => !re.test(`page${ext}`));
  expect(missed, `${hook.id} skips supported extensions: ${missed.join(", ")}`).toEqual([]);

  const foreign = [".txt", ".json", ".yaml", ".ts", ".png", ".mdxx"];
  const overreach = foreign.filter((ext) => re.test(`page${ext}`));
  expect(overreach, `${hook.id} claims unsupported extensions: ${overreach.join(", ")}`).toEqual(
    [],
  );
}

describe("the published pre-commit hook", () => {
  it("declares a docmeta hook", () => {
    expect(docmetaHook).toBeDefined();
  });

  it("matches exactly the extensions docmeta supports", () => {
    if (!docmetaHook) throw new Error("no docmeta hook");
    expectExactExtensionSet(docmetaHook);
  });

  it("matches regardless of case, as the CLI does", () => {
    if (!docmetaHook) throw new Error("no docmeta hook");
    const re = patternOf(docmetaHook);
    // `extractors/index.ts` lowercases on both insert and lookup, so the CLI
    // reads `README.MD`; a case-sensitive hook would skip it.
    expect(re.test("README.MD")).toBe(true);
    expect(re.test("Guide.DITA")).toBe(true);
  });

  it("runs the newest published CLI", () => {
    // A major pinned in `entry` goes stale at the next major release. It sat at
    // `@0` through 1.0.0 and 2.0.0, so every consumer ran the 0.x CLI.
    if (!docmetaHook) throw new Error("no docmeta hook");
    expect(docmetaHook.entry).toBe("npx --yes @hawkeyexl/manni@latest meta validate");
  });

  it("declares the case-insensitive flag pre-commit needs", () => {
    // The JS translation above would pass whether or not the shipped pattern
    // carries `(?i)`, because it forces `i`. pre-commit gets no such help.
    if (!docmetaHook) throw new Error("no docmeta hook");
    expect(docmetaHook.files.startsWith("(?i)")).toBe(true);
  });
});

describe("the published derive hook", () => {
  // Proposal 0046: an agent that exports MANNI_GENERATED_BY gets its lines
  // attributed without remembering a command, because this hook runs derive on
  // the staged files and the stamp lands in the same commit as the edit.
  const deriveHook = hooks.find((h) => h.id === "manni-meta-derive");

  it("declares a derive hook", () => {
    expect(deriveHook).toBeDefined();
  });

  it("runs derive from the newest published CLI", () => {
    if (!deriveHook) throw new Error("no derive hook");
    expect(deriveHook.entry).toBe("npx --yes @hawkeyexl/manni@latest meta derive");
    expect(deriveHook.language).toBe("system");
  });

  it("watches exactly the files the validate hook watches", () => {
    // One pattern, so the two hooks cannot drift apart; the exact-set checks
    // above already pin it against supportedExtensions().
    if (!deriveHook || !docmetaHook) throw new Error("missing hook");
    expect(deriveHook.files).toBe(docmetaHook.files);
  });
});

describe("the published cite hook", () => {
  // Proposal 0044: pre-commit appends the staged paths, so the hook checks
  // those pages' citations while the sources resolve from the git root. Both
  // ends come out of one working tree, so a commit that edits a cited source
  // is judged against the edit rather than waiting for CI.
  const citeHook = hooks.find((h) => h.id === "manni-cite");

  it("declares a cite hook", () => {
    expect(citeHook).toBeDefined();
  });

  it("runs check from the newest published CLI", () => {
    if (!citeHook) throw new Error("no cite hook");
    expect(citeHook.entry).toBe("npx --yes @hawkeyexl/manni@latest cite check");
    expect(citeHook.language).toBe("system");
  });

  it("passes the staged paths, so its entry names none", () => {
    // A path in the entry would check that path on every commit and ignore
    // what was staged, which is not what `pass_filenames` defaults to.
    if (!citeHook) throw new Error("no cite hook");
    expect(citeHook.entry.endsWith("cite check")).toBe(true);
  });

  it("does not skip the source end", () => {
    // `--no-check-sources` leaves the page-side rules only. The sources are in
    // the same checkout here, so skipping them would drop the half that
    // catches a source edit in the commit that makes it.
    if (!citeHook) throw new Error("no cite hook");
    expect(citeHook.entry).not.toContain("--no-check-sources");
  });

  it("watches exactly the files the validate hook watches", () => {
    if (!citeHook || !docmetaHook) throw new Error("missing hook");
    expect(citeHook.files).toBe(docmetaHook.files);
  });
});

describe("every published hook", () => {
  // The per-hook blocks above name their hook, so a hook added later is
  // covered by none of them. These run over whatever `.pre-commit-hooks.yaml`
  // publishes, so a new hook's pattern is pinned the moment it ships, and a
  // drift in any one of them fails here rather than in a consumer's repo.
  it("publishes at least the three hooks the docs recommend", () => {
    expect(hooks.map((h) => h.id)).toEqual(
      expect.arrayContaining(["manni-meta", "manni-meta-derive", "manni-cite"]),
    );
  });

  it.each(hooks.map((hook) => [hook.id, hook] as const))(
    "%s watches exactly the extensions manni reads",
    (_id, hook) => {
      expectExactExtensionSet(hook);
    },
  );

  it.each(hooks.map((hook) => [hook.id, hook] as const))(
    "%s declares the case-insensitive flag pre-commit needs",
    (_id, hook) => {
      // The JS translation forces `i`, so it would pass either way.
      // pre-commit gets no such help.
      expect(hook.files.startsWith("(?i)")).toBe(true);
    },
  );

  it.each(hooks.map((hook) => [hook.id, hook] as const))(
    "%s runs the newest published CLI through the system npx",
    (_id, hook) => {
      // A major pinned in `entry` goes stale at the next major release. It sat
      // at `@0` through 1.0.0 and 2.0.0, so every consumer ran the 0.x CLI.
      // `language: system` is the header comment's measured decision.
      expect(hook.entry.startsWith("npx --yes @hawkeyexl/manni@latest ")).toBe(true);
      expect(hook.language).toBe("system");
    },
  );
});
