/**
 * Per-eval `target` and `runs`.
 *
 * `target` selects which bytes the grader receives; `evidence` still only
 * hints where to look *within* them. The two are easy to conflate, so the
 * tests here assert on what actually reached the provider.
 *
 * `runs` lets one eval buy more agreement than the corpus default. Precedence
 * is CLI > eval > config: the flag is an explicit operator act ("run cheap
 * right now"), so it wins over a page that asked for more.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

const config = parseDocevalsConfig(
  ["version: 1", "judge:", "  ensemble-runs: 3"].join("\n"),
  "/fake/manni.config.yaml",
);

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "manni-docevals-target-"));
}

/** A page whose single eval carries `extra` frontmatter lines verbatim. */
function makeTarget(extra: string[], root = "/fake", body = "Visible body."): GraderTarget {
  const content = [
    "---",
    "title: x",
    "owner: docs-team",
    "evals:",
    "  - id: claim-check",
    "    assertion: The page satisfies the claim.",
    "    examples: { pass: yes, fail: no }",
    ...extra,
    "---",
    body,
  ].join("\n");
  const page: PageFile = {
    file: "docs/page.md",
    absPath: join(root, "docs", "page.md"),
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const plan = resolvePage(page, config);
  const ev = plan.evals[0];
  if (!ev) throw new Error("no eval resolved");
  return { plan, eval: ev };
}

const provider = () => new MockProvider([mockVerdict("pass", 0.95)]);

describe("per-eval runs", () => {
  it("defaults to the configured ensemble size", async () => {
    const p = provider();
    await makeJudge({ provider: p, root: tempRoot() })(
      [makeTarget([])],
      config,
      {},
    );
    expect(p.requests).toHaveLength(3);
  });

  it("honours a smaller per-eval count", async () => {
    const p = provider();
    await makeJudge({ provider: p, root: tempRoot() })(
      [makeTarget(["    runs: 1"])],
      config,
      {},
    );
    expect(p.requests).toHaveLength(1);
  });

  it("honours a larger per-eval count", async () => {
    const p = provider();
    await makeJudge({ provider: p, root: tempRoot() })(
      [makeTarget(["    runs: 5"])],
      config,
      {},
    );
    expect(p.requests).toHaveLength(5);
  });

  it("lets an explicit --runs override the page", async () => {
    const p = provider();
    await makeJudge({ provider: p, root: tempRoot() })(
      [makeTarget(["    runs: 5"])],
      config,
      { runs: 2 },
    );
    expect(p.requests).toHaveLength(2);
  });

  it("keys the cache on the effective count, so two counts do not share a verdict", async () => {
    const root = tempRoot();
    const p1 = provider();
    await makeJudge({ provider: p1, root })([makeTarget(["    runs: 1"])], config, {});
    const p2 = provider();
    await makeJudge({ provider: p2, root })([makeTarget(["    runs: 2"])], config, {});
    // A shared key would replay the 1-run ensemble and call nothing.
    expect(p2.requests).toHaveLength(2);
  });
});

describe("per-eval target", () => {
  const userOf = (p: MockProvider): string => {
    const req = p.requests[0];
    if (!req) throw new Error("no request recorded");
    return req.user;
  };

  it("sends the body by default, without the frontmatter fence", async () => {
    const p = provider();
    await makeJudge({ provider: p, root: tempRoot() })([makeTarget([])], config, {});
    expect(userOf(p)).toContain("Visible body.");
    expect(userOf(p)).not.toContain("owner: docs-team");
  });

  it("target: raw includes the frontmatter", async () => {
    const p = provider();
    await makeJudge({ provider: p, root: tempRoot() })(
      [makeTarget(["    target: raw"])],
      config,
      {},
    );
    expect(userOf(p)).toContain("owner: docs-team");
    expect(userOf(p)).toContain("Visible body.");
  });

  it("target: frontmatter sends the metadata and not the prose", async () => {
    const p = provider();
    await makeJudge({ provider: p, root: tempRoot() })(
      [makeTarget(["    target: frontmatter"])],
      config,
      {},
    );
    expect(userOf(p)).toContain("owner");
    expect(userOf(p)).not.toContain("Visible body.");
  });

  it("target: a companion file sends that file's contents", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "sample.ts"), "export const answer = 42;\n");
    const p = provider();
    await makeJudge({ provider: p, root })(
      [
        makeTarget(
          ["    target:", "      source: file", "      path: sample.ts"],
          root,
        ),
      ],
      config,
      {},
    );
    expect(userOf(p)).toContain("export const answer = 42;");
    expect(userOf(p)).not.toContain("Visible body.");
  });

  it("errors rather than silently grading something else when the file is missing", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    const p = provider();
    const results = await makeJudge({ provider: p, root })(
      [
        makeTarget(
          ["    target:", "      source: file", "      path: nope.ts"],
          root,
        ),
      ],
      config,
      {},
    );
    // No verdict is a failure, never a quiet pass (ADR 01022).
    expect(results[0]?.outcome).toBe("error");
    expect(results[0]?.skipReason ?? "").toContain("nope.ts");
    expect(p.requests).toHaveLength(0);
  });

  it("keys the cache on the target, so two targets do not share a verdict", async () => {
    const root = tempRoot();
    const p1 = provider();
    await makeJudge({ provider: p1, root })([makeTarget([])], config, {});
    const p2 = provider();
    await makeJudge({ provider: p2, root })(
      [makeTarget(["    target: raw"])],
      config,
      {},
    );
    expect(p2.requests).toHaveLength(3);
  });
});

describe("the file-target escape guard", () => {
  it("serves a sibling whose name begins with two dots", async () => {
    // `..rc` starts with the traversal spelling and goes nowhere. Refusing it
    // is a refusal the author cannot act on: the file is inside the root and
    // named exactly what they wrote.
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "..notes.ts"), "const kept = 1;\n");
    const p = provider();
    await makeJudge({ provider: p, root })(
      [
        makeTarget(
          ["    target:", "      source: file", "      path: ..notes.ts"],
          root,
        ),
      ],
      config,
      {},
    );
    const req = p.requests[0];
    expect(req?.user).toContain("const kept = 1;");
  });

  it("still refuses a real climb out of the root", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs"), { recursive: true });
    const p = provider();
    const results = await makeJudge({ provider: p, root })(
      [
        makeTarget(
          ["    target:", "      source: file", "      path: ../../secrets"],
          root,
        ),
      ],
      config,
      {},
    );
    expect(results[0]?.outcome).toBe("error");
    expect(p.requests).toHaveLength(0);
  });
});

describe("judge provider memoization", () => {
  /** Counts how many providers the judge asks to be built. */
  const countingJudge = (
    evals: Array<{ provider?: string; model?: string }>,
    cli: { provider?: string; model?: string } = {},
  ) => {
    const built: string[] = [];
    const targets = evals.map((e) =>
      makeTarget([
        ...(e.provider === undefined ? [] : [`    provider: ${e.provider}`]),
        ...(e.model === undefined ? [] : [`    model: ${e.model}`]),
      ]),
    );
    // Distinct eval ids, so nothing is deduplicated upstream of the provider.
    targets.forEach((t, i) => {
      t.eval.name = `claim-${String(i)}`;
    });
    const judge = makeJudge({
      provider: provider(),
      root: tempRoot(),
      providerFor: (ev) => {
        built.push(`${ev.provider ?? ""}:${ev.model ?? ""}`);
        return provider();
      },
    });
    return { built, go: () => judge(targets, config, cli) };
  };

  it("builds one provider per distinct effective identity", async () => {
    const { built, go } = countingJudge([
      { provider: "mock", model: "a" },
      { provider: "mock", model: "a" },
      { provider: "mock", model: "b" },
    ]);
    await go();
    expect(built).toHaveLength(2);
  });

  it("builds nothing when a CLI flag overrides every eval's choice", async () => {
    // With both halves flagged, every eval resolves to the run's own provider.
    // Keying on the authored value instead would build one per eval and cache
    // them under names that no longer describe what they are.
    const { built, go } = countingJudge(
      [
        { provider: "mock", model: "a" },
        { provider: "anthropic", model: "b" },
      ],
      { provider: "mock", model: "pinned" },
    );
    await go();
    expect(built).toEqual([]);
  });
});
