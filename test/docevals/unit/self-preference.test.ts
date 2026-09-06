/**
 * Self-preference: the model that judged an eval also produced what it graded.
 *
 * Two axes with different remedies, so they are reported apart. Content — the
 * page's `generated-by` names the judge model, meaning the judge wrote the
 * prose. Criterion — `eval-provenance` records the judge model proposing this
 * assertion, meaning the judge wrote the question.
 *
 * It stays a warning. Bias skews a verdict; it does not stop one forming, so
 * ADR 01022's "no verdict fails" rule is not in play, and erroring would
 * punish a single-model corpus with no second provider to reach for.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";

const config = parseDocevalsConfig("version: 1\n", "/fake/manni.config.yaml");
const tempRoot = () => mkdtempSync(join(tmpdir(), "manni-docevals-selfpref-"));

/** MockProvider reports its model name as whatever it is constructed with. */
const provider = (model: string) =>
  new MockProvider([mockVerdict("pass", 0.95)], model);

function makeTarget(frontmatter: string[]): GraderTarget {
  const content = [
    "---",
    "title: x",
    ...frontmatter,
    "evals:",
    "  - id: claim-check",
    "    assertion: The page satisfies the claim.",
    "    examples: { pass: yes, fail: no }",
    "---",
    "Body.",
  ].join("\n");
  const page: PageFile = {
    file: "docs/page.md",
    absPath: "/fake/docs/page.md",
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
  const plan = resolvePage(page, config);
  const ev = plan.evals[0];
  if (!ev) throw new Error("no eval resolved");
  return { plan, eval: ev };
}

const judgeWith = async (model: string, frontmatter: string[]) => {
  const p = provider(model);
  const results = await makeJudge({ provider: p, root: tempRoot() })(
    [makeTarget(frontmatter)],
    config,
    {},
  );
  return results[0];
};

describe("self-preference", () => {
  it("is absent when the judge did not write the page", async () => {
    const r = await judgeWith("judge-model", ["generated-by: some-other-model"]);
    expect(r?.selfPreference).toBeUndefined();
    expect(r?.outcome).toBe("pass");
  });

  it("is absent when the page declares no author at all", async () => {
    const r = await judgeWith("judge-model", []);
    expect(r?.selfPreference).toBeUndefined();
  });

  it("flags the content axis when generated-by names the judge model", async () => {
    const r = await judgeWith("judge-model", ["generated-by: judge-model"]);
    expect(r?.selfPreference).toEqual({ axis: "content", model: "judge-model" });
    // A real verdict still forms — bias is reported alongside it, not instead.
    expect(r?.outcome).toBe("pass");
  });

  it("flags the criterion axis when the judge proposed the assertion", async () => {
    const r = await judgeWith("judge-model", [
      "eval-provenance:",
      "  - generated-by: judge-model",
      "    evals: [claim-check]",
    ]);
    expect(r?.selfPreference).toEqual({
      axis: "criterion",
      model: "judge-model",
    });
  });

  it("ignores provenance for a different eval on the same page", async () => {
    const r = await judgeWith("judge-model", [
      "eval-provenance:",
      "  - generated-by: judge-model",
      "    evals: [some-other-eval]",
    ]);
    expect(r?.selfPreference).toBeUndefined();
  });

  it("compares against the eval's own model, not the run default", async () => {
    // The page was written by `page-author`. The run's default judge is
    // someone else, but this eval pins `page-author` — which is exactly the
    // case a check against the run-wide model would miss.
    const p = provider("run-default");
    const target = makeTarget(["generated-by: page-author"]);
    const results = await makeJudge({
      provider: p,
      root: tempRoot(),
      providerFor: () => provider("page-author"),
    })([{ ...target, eval: { ...target.eval, model: "page-author" } }], config, {});
    expect(results[0]?.selfPreference).toEqual({
      axis: "content",
      model: "page-author",
    });
  });
});
