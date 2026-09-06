import { describe, it, expect } from "vitest";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import type { PageFile } from "../../../src/docevals/core/discover.js";
import { stripFrontmatterBlock } from "../../../src/docevals/core/discover.js";

const CONFIG = parseDocevalsConfig(
  [
    "version: 1",
    "evals:",
    "  central-ai:",
    "    assertion: Central claim holds.",
    "    examples: { pass: yes, fail: no }",
    "  central-tool:",
    "    grader: tool:freshness",
    "    options: { max-age-days: 100 }",
    "    severity: warning",
    "suites:",
    "  ref:",
    "    target-pass-rate: 0.9",
    "    evals: [central-ai, central-tool]",
  ].join("\n"),
  "/fake/manni.config.yaml",
);

function page(frontmatterYaml: string, body = "Body."): PageFile {
  const content = `---\n${frontmatterYaml}\n---\n${body}`;
  return {
    file: "docs/page.md",
    absPath: "/fake/docs/page.md",
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
}

describe("resolvePage", () => {
  it("resolves suite evals from config", () => {
    const plan = resolvePage(page("eval-suite: ref"), CONFIG);
    expect(plan.suite).toBe("ref");
    expect(plan.evals.map((e) => e.name).sort()).toEqual([
      "central-ai",
      "central-tool",
    ]);
    expect(plan.evals.every((e) => e.source === "config")).toBe(true);
  });

  it("defaults type to regression and grader to ai", () => {
    const plan = resolvePage(page("eval-suite: ref"), CONFIG);
    const ai = plan.evals.find((e) => e.name === "central-ai")!;
    expect(ai.type).toBe("regression");
    expect(ai.grader).toBe("ai");
    expect(ai.severity).toBe("error");
  });

  it("applies string-shorthand references", () => {
    const plan = resolvePage(
      page("evals:\n  - use: central-ai"),
      CONFIG,
    );
    expect(plan.evals).toHaveLength(1);
    expect(plan.evals[0]?.name).toBe("central-ai");
  });

  it("accepts the array shorthand for the evals key", () => {
    const plan = resolvePage(
      page(
        [
          "evals:",
          "  - use: central-ai",
          "  - id: inline-check",
          "    assertion: Inline claim.",
          "    examples: { pass: yes, fail: no }",
        ].join("\n"),
      ),
      CONFIG,
    );
    expect(plan.problems.filter((p) => p.level === "error")).toHaveLength(0);
    expect(plan.evals.map((e) => e.name).sort()).toEqual([
      "central-ai",
      "inline-check",
    ]);
  });

  it("reports line-accurate problems in the array shorthand", () => {
    const plan = resolvePage(page("evals:\n  - use: ghost"), CONFIG);
    const err = plan.problems.find((p) => p.level === "error");
    expect(err?.message).toMatch(/Unknown eval "ghost"/);
    expect(err?.line).toBe(3);
  });

  it("merges reference overrides onto suite evals", () => {
    const plan = resolvePage(
      page(
        [
          "eval-suite: ref",
          "evals:",
          "  - use: central-tool",
          "    severity: error",
          "    type: capability",
          "    options: { max-age-days: 30 }",
        ].join("\n"),
      ),
      CONFIG,
    );
    const tool = plan.evals.find((e) => e.name === "central-tool")!;
    expect(tool.severity).toBe("error");
    expect(tool.type).toBe("capability");
    expect(tool.options).toEqual({ "max-age-days": 30 });
    // Not duplicated by the reference.
    expect(plan.evals.filter((e) => e.name === "central-tool")).toHaveLength(1);
  });

  it("carries a reference's weight onto the suite eval", () => {
    // `weight` is the override that says how much a config-defined check
    // counts *for this page*, and `use:` is how most pages join a suite at
    // all. Accepting it in the schema and dropping it in the merge would
    // silently score the page at the corpus default.
    const plan = resolvePage(
      page(
        [
          "eval-suite: ref",
          "evals:",
          "  - use: central-tool",
          "    weight: 3",
        ].join("\n"),
      ),
      CONFIG,
    );
    const tool = plan.evals.find((e) => e.name === "central-tool")!;
    expect(tool.weight).toBe(3);
  });

  it("leaves the defined weight alone when the reference does not say", () => {
    const plan = resolvePage(
      page(["eval-suite: ref", "evals:", "  - use: central-tool"].join("\n")),
      CONFIG,
    );
    expect(plan.evals.find((e) => e.name === "central-tool")?.weight).toBe(1);
  });

  it("resolves inline evals as page-sourced", () => {
    const plan = resolvePage(
      page(
        [
          "evals:",
          "  - id: my-inline",
          "    assertion: Inline claim.",
          "    examples: { pass: yes, fail: no }",
        ].join("\n"),
      ),
      CONFIG,
    );
    expect(plan.evals[0]?.source).toBe("page");
    expect(plan.evals[0]?.suite).toBe("default");
  });

  it("warns when an inline ai eval lacks examples", () => {
    const plan = resolvePage(
      page(
        "evals:\n  - id: bare\n    assertion: Claim.",
      ),
      CONFIG,
    );
    expect(plan.problems.some((p) => p.level === "warning" && /examples/.test(p.message))).toBe(true);
  });

  it("reports unknown eval references as errors with a line", () => {
    const plan = resolvePage(
      page("evals:\n  - use: ghost"),
      CONFIG,
    );
    const err = plan.problems.find((p) => p.level === "error");
    expect(err?.message).toMatch(/Unknown eval "ghost"/);
    expect(err?.line).toBeGreaterThan(1);
  });

  it("reports an unknown suite as an error", () => {
    const plan = resolvePage(page("eval-suite: ghost"), CONFIG);
    expect(plan.problems[0]?.message).toMatch(/Unknown suite "ghost"/);
    expect(plan.evals).toHaveLength(0);
  });

  it("rejects malformed manni docevals frontmatter via schema", () => {
    const plan = resolvePage(
      page("evals:\n  - id: Bad_Name\n    assertion: x"),
      CONFIG,
    );
    expect(plan.problems.some((p) => p.level === "error")).toBe(true);
    expect(plan.evals).toHaveLength(0);
  });

  it("requires assertion for ai-graded inline evals", () => {
    const plan = resolvePage(
      page("evals:\n  - id: no-claim"),
      CONFIG,
    );
    expect(plan.problems.some((p) => p.level === "error")).toBe(true);
  });

  it("allows command-graded inline evals with only an assertion (generation target)", () => {
    const plan = resolvePage(
      page(
        [
          "evals:",
          "  - id: gen-me",
          "    assertion: Deterministic claim.",
          "    grader: command",
        ].join("\n"),
      ),
      CONFIG,
    );
    expect(plan.problems.filter((p) => p.level === "error")).toHaveLength(0);
    expect(plan.evals[0]?.command).toBeUndefined();
  });

  it("honors page and eval skip flags", () => {
    const plan = resolvePage(
      page(
        [
          "eval-skip: true",
          "evals:",
          "  - use: central-ai",
          "    skip: true",
        ].join("\n"),
      ),
      CONFIG,
    );
    expect(plan.skip).toBe(true);
    expect(plan.evals[0]?.skip).toBe(true);
  });

  it("uses defaults.suite for pages without a manni docevals key", () => {
    const cfg = parseDocevalsConfig(
      [
        "version: 1",
        "defaults: { suite: ref }",
        "evals:",
        "  central-ai:",
        "    assertion: Central claim holds.",
        "suites:",
        "  ref:",
        "    evals: [central-ai]",
      ].join("\n"),
      "/fake/manni.config.yaml",
    );
    const plan = resolvePage(page("title: Plain"), cfg);
    expect(plan.suite).toBe("ref");
    expect(plan.evals.map((e) => e.name)).toEqual(["central-ai"]);
  });

  it("surfaces extraction errors as page problems", () => {
    const p = page("title: x");
    p.extractError = "Invalid YAML frontmatter: boom";
    const plan = resolvePage(p, CONFIG);
    expect(plan.problems[0]?.message).toMatch(/boom/);
    expect(plan.evals).toHaveLength(0);
  });
});

/**
 * The 0.1 → 1.0.0 semantic trap.
 *
 * In 0.1 a bare string in the eval list was a *reference* to a config-defined
 * eval. In the docmeta vocabulary it is an *assertion* — so a page that still
 * says `- fresh-enough` no longer runs the freshness grader. It quietly sends
 * the words "fresh-enough" to the judge instead, and reports a pass or a fail
 * on that. Nothing errors, and the eval a maintainer thought was guarding the
 * page is simply gone.
 *
 * A string shorthand that exactly matches a defined eval id is the shape of
 * that mistake, so it is named.
 */
describe("resolvePage: 0.1 reference migration", () => {
  it("warns when a string shorthand matches a config-defined eval id", () => {
    const plan = resolvePage(page("evals:\n  - central-ai"), CONFIG);
    const warning = plan.problems.find((p) => p.level === "warning");
    expect(warning?.message).toMatch(/central-ai/);
    expect(warning?.message).toMatch(/use: central-ai/);
    expect(warning?.line).toBe(3);
  });

  it("still treats it as an assertion — the warning does not change behavior", () => {
    // Guessing that the author meant a reference would be a second, invisible
    // spelling of `use:`. Say what happened; let the author fix the page.
    const plan = resolvePage(page("evals:\n  - central-ai"), CONFIG);
    expect(plan.evals).toHaveLength(1);
    expect(plan.evals[0]?.assertion).toBe("central-ai");
    expect(plan.evals[0]?.grader).toBe("ai");
  });

  it("says nothing about a genuine assertion", () => {
    const plan = resolvePage(
      page("evals:\n  - The install command names the current package."),
      CONFIG,
    );
    expect(plan.problems).toEqual([]);
  });
});

/**
 * The `eval-` prefix reservation is the whole reason the flat vocabulary does
 * not lose the closed 0.1 block's loud-typo property — so its message has to
 * actually say what is wrong. Ajv reports a `false` subschema as "boolean
 * schema is false", which names neither the key nor the fix.
 */
describe("resolvePage: the eval- prefix reservation", () => {
  it("names the key and the reserved prefix, not Ajv's internals", () => {
    const plan = resolvePage(page("eval-suit: ref"), CONFIG);
    const err = plan.problems.find((p) => p.level === "error");
    expect(err?.message).toMatch(/eval-suit/);
    expect(err?.message).toMatch(/eval-suite|eval-skip|eval-provenance/);
    expect(err?.message).not.toMatch(/boolean schema/);
  });

  it("points at the offending line", () => {
    // Line 1 is the opening fence, so the second frontmatter key is line 3.
    const plan = resolvePage(page("title: x\neval-timeout: 30"), CONFIG);
    expect(plan.problems[0]?.line).toBe(3);
  });

  it("leaves a sibling tool's page keys alone", () => {
    const plan = resolvePage(page("title: x\nkg:\n  label: Thing"), CONFIG);
    expect(plan.problems.filter((p) => p.level === "error")).toHaveLength(0);
  });
});

/**
 * The shorthand's derived name is not reserved, so it can collide with an
 * explicit id. Losing a declared eval to a name the author never wrote — and
 * only warning about it — is the wrong trade: a corpus quietly stops checking
 * something while the run stays green.
 */
describe("resolvePage: shorthand naming", () => {
  const collide = () =>
    resolvePage(
      page(
        [
          "evals:",
          "  - A durable claim.",
          "  - id: assertion-1",
          "    assertion: A different claim.",
          "    examples: { pass: yes, fail: no }",
        ].join("\n"),
      ),
      CONFIG,
    );

  it("keeps both evals when an explicit id looks like a derived name", () => {
    expect(collide().evals).toHaveLength(2);
  });

  it("yields the derived name to the id the author wrote", () => {
    // The explicit id keeps `assertion-1`; the shorthand steps aside. Renaming
    // the shorthand is free — nobody wrote its name down — while renaming the
    // explicit one would break every `use:` and cached verdict pointing at it.
    const names = collide().evals.map((e) => e.name);
    expect(names).toContain("assertion-1");
    expect(names.filter((n) => n.startsWith("assertion-1"))).toHaveLength(2);
  });

  it("reports two page entries sharing an id as an error", () => {
    // One of them is dropped, so the page checks less than it declares. A
    // warning would let that ship green.
    const plan = resolvePage(
      page(
        [
          "evals:",
          "  - id: dup",
          "    assertion: First.",
          "    examples: { pass: yes, fail: no }",
          "  - id: dup",
          "    assertion: Second.",
          "    examples: { pass: yes, fail: no }",
        ].join("\n"),
      ),
      CONFIG,
    );
    const err = plan.problems.find((p) => p.level === "error");
    expect(err?.message).toMatch(/dup/);
  });

  it("still lets a page entry override a suite eval of the same id", () => {
    // Documented precedence, and deliberately not an error.
    const plan = resolvePage(
      page(
        [
          "eval-suite: ref",
          "evals:",
          "  - id: central-tool",
          "    assertion: Replaced locally.",
          "    examples: { pass: yes, fail: no }",
        ].join("\n"),
      ),
      CONFIG,
    );
    expect(plan.problems.filter((p) => p.level === "error")).toHaveLength(0);
    expect(
      plan.evals.find((e) => e.name === "central-tool")?.source,
    ).toBe("page");
  });

  it("still numbers plain shorthands by position", () => {
    const plan = resolvePage(page("evals:\n  - One.\n  - Two."), CONFIG);
    expect(plan.evals.map((e) => e.name)).toEqual(["assertion-1", "assertion-2"]);
  });

  // Two page entries claiming one id means one of them is dropped, so the page
  // checks less than it declares. The behavior was already here; nothing
  // pinned it, so a refactor could have quietly turned it back into
  // last-one-wins.
  it("errors when two page entries claim the same id", () => {
    const plan = resolvePage(
      page(
        [
          "evals:",
          "  - id: same-id",
          "    assertion: First claim.",
          "    examples: { pass: yes, fail: no }",
          "  - id: same-id",
          "    assertion: Second claim.",
          "    examples: { pass: yes, fail: no }",
        ].join("\n"),
      ),
      CONFIG,
    );
    const errors = plan.problems.filter((p) => p.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('Duplicate eval id "same-id"');
    // The survivor is still resolved — the error reports the loss, it does not
    // drop both and leave the page checking nothing.
    expect(plan.evals.filter((e) => e.name === "same-id")).toHaveLength(1);
  });

  it("stays silent when a page entry overrides a suite eval of the same id", () => {
    const plan = resolvePage(
      page(
        [
          "eval-suite: ref",
          "evals:",
          "  - id: central-ai",
          "    assertion: Overridden locally.",
          "    examples: { pass: yes, fail: no }",
        ].join("\n"),
      ),
      CONFIG,
    );
    expect(
      plan.problems.filter((p) => p.message.includes("Duplicate eval id")),
    ).toHaveLength(0);
    expect(plan.evals.find((e) => e.name === "central-ai")?.source).toBe("page");
  });
});
