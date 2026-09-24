/**
 * docevals reads a page's metadata the way `manni meta validate` does: the
 * frontmatter block, plus every key an external-metadata manifest of one of
 * the page's collections owns (proposal 0037, 0041).
 *
 * The evals vocabulary marks `evals`, `eval-suite` and `eval-skip`
 * `x-manni-location: external` from `1.0.0-proposal.4`, so a corpus that ran
 * `manni meta relocate` keeps them in a manifest. Reading them there is not a
 * feature of its own: the plan a page resolves has to be the same before and
 * after the move, and everything downstream — the freshness grader, the
 * self-preference check, `target: frontmatter` — has to see the same values.
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { loadConfig } from "../../../src/docevals/core/config.js";
import { discoverPages } from "../../../src/docevals/core/discover.js";
import { withExternalMetadata } from "../../../src/docevals/core/external.js";
import { resolvePages } from "../../../src/docevals/core/resolve.js";
import type { ResolvedPagePlan } from "../../../src/docevals/core/resolve.js";
import { readTarget } from "../../../src/docevals/core/target.js";
import { selfPreferenceOf } from "../../../src/docevals/judge/self-preference.js";
import { freshnessGrader } from "../../../src/docevals/graders/native/freshness.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/manifest");
const dir = (name: string): string => resolve(FIXTURES, name);

/** Every page of a fixture corpus, resolved the way a run resolves it. */
async function plansOf(fixture: string): Promise<ResolvedPagePlan[]> {
  const cwd = dir(fixture);
  const config = loadConfig(undefined, cwd);
  const pages = await withExternalMetadata(
    discoverPages(config, { paths: [] }, cwd),
    config,
    cwd,
  );
  return resolvePages(pages, config);
}

const planFor = (plans: ResolvedPagePlan[], file: string): ResolvedPagePlan => {
  const plan = plans.find((p) => p.page.file === file);
  if (!plan) throw new Error(`no plan for ${file}`);
  return plan;
};

describe("evals kept in a manifest", () => {
  it("resolves the suite and the evals the manifest supplies", async () => {
    const plan = planFor(await plansOf("external"), "docs/install.md");
    expect(plan.problems).toEqual([]);
    expect(plan.suite).toBe("reference");
    expect(plan.evals.map((e) => e.name)).toEqual(["fresh-enough"]);
  });

  it("takes eval-skip from the manifest too", async () => {
    expect(planFor(await plansOf("external"), "docs/skipped.md").skip).toBe(true);
  });

  it("leaves a page in no collection on its own frontmatter", async () => {
    // `dated.md` is a member; the manifest holds nothing for a non-member, and
    // the merge is what decides that, not the reader.
    const plan = planFor(await plansOf("external"), "docs/dated.md");
    expect(plan.page.frontmatter.data.title).toBe("Dated");
  });

  it("hands the freshness grader the date the manifest holds", async () => {
    const cwd = dir("external");
    const config = loadConfig(undefined, cwd);
    const plan = planFor(await plansOf("external"), "docs/dated.md");
    const ev = plan.evals.find((e) => e.name === "fresh-enough");
    if (!ev) throw new Error("fresh-enough did not resolve");
    const findings = await freshnessGrader.grade({
      targets: [{ plan, eval: ev }],
      config,
      root: cwd,
      exec: () => {
        throw new Error("the freshness grader shells out to nothing");
      },
    });
    // Without the merge there is no `last-reviewed` on this page at all, and
    // the grader reports `freshness/missing`.
    expect(findings).toEqual([]);
  });

  it("serializes the merged metadata for target: frontmatter", async () => {
    const plan = planFor(await plansOf("external"), "docs/install.md");
    const read = readTarget("frontmatter", plan);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.text).toBe(stringifyYaml(plan.page.frontmatter.data));
    expect(read.text).toContain("eval-suite: reference");
    // `raw` stays the file verbatim: it is the bytes on disk, manifest or not.
    const raw = readTarget("raw", plan);
    expect(raw.ok && raw.text).toBe(plan.page.content);
    expect(raw.ok && raw.text).not.toContain("eval-suite");
  });

  it("points a problem at the manifest line, not at the page", async () => {
    const cwd = dir("external");
    const config = loadConfig(undefined, cwd);
    const pages = await withExternalMetadata(
      discoverPages(config, { paths: [] }, cwd),
      config,
      cwd,
    );
    // The suite the manifest names is removed from the config, so the only
    // place the bad value can be shown is the manifest that supplied it.
    const withoutSuite = { ...config, suites: {} };
    const plan = planFor(resolvePages(pages, withoutSuite), "docs/install.md");
    expect(plan.problems).toEqual([
      {
        message: expect.stringContaining('Unknown suite "reference"') as string,
        level: "error",
        file: "site.metadata.yaml",
        line: 2,
      },
    ]);
  });
});

describe("a field-joined manifest", () => {
  it("matches the page on its own value of the join field", async () => {
    const plans = await plansOf("join");
    expect(planFor(plans, "docs/install.md").evals.map((e) => e.name)).toEqual([
      "fresh-enough",
    ]);
  });

  it("leaves a page no entry joins to on its frontmatter", async () => {
    const plan = planFor(await plansOf("join"), "docs/other.md");
    expect(plan.evals).toEqual([]);
    expect(plan.suite).toBeNull();
  });
});

describe("provenance kept in a manifest", () => {
  it("is what the self-preference check reads", async () => {
    const plan = planFor(await plansOf("provenance"), "docs/install.md");
    const body = plan.evals.find((e) => e.name === "limits-stated");
    const fields = plan.evals.find((e) => e.name === "description-matches");
    if (!body || !fields) throw new Error("the fixture's evals did not resolve");
    expect(selfPreferenceOf(plan, body, "claude-fable-5")?.axis).toBe("content");
    expect(selfPreferenceOf(plan, fields, "claude-fable-5")?.axis).toBe("content");
    expect(selfPreferenceOf(plan, body, "claude-sonnet-5")).toBeUndefined();
  });
});

describe("refusals", () => {
  it("reports a key the page keeps after a manifest took it over", async () => {
    const plan = planFor(await plansOf("collision"), "docs/install.md");
    expect(plan.problems).toEqual([
      {
        message:
          '"evals" is owned by manifest site.metadata.yaml (collection site); remove it from the document',
        level: "error",
        line: 4,
      },
    ]);
  });

  it("refuses a URL manifest that owns an eval key", async () => {
    await expect(plansOf("url")).rejects.toThrow(
      new DocevalsError(
        "manni.config.yaml: collection site: evals cannot come from a URL manifest, because docevals writes them.",
      ),
    );
  });

  it("refuses a page whose collections both keep evals in a manifest", async () => {
    await expect(plansOf("two-collections")).rejects.toThrow(
      new DocevalsError(
        "docs/install.md is in collections site and guides, and both keep evals in a manifest.",
      ),
    );
  });
});

describe("a manifest per page", () => {
  it("resolves the suite and the evals the page's own manifest supplies", async () => {
    const plan = planFor(await plansOf("per-page"), "docs/install.md");
    expect(plan.problems).toEqual([]);
    expect(plan.suite).toBe("reference");
    expect(plan.evals.map((e) => e.name)).toEqual(["fresh-enough"]);
  });

  it("hands the freshness grader the date that manifest holds", async () => {
    const cwd = dir("per-page");
    const config = loadConfig(undefined, cwd);
    const plan = planFor(await plansOf("per-page"), "docs/install.md");
    const ev = plan.evals.find((e) => e.name === "fresh-enough");
    if (!ev) throw new Error("fresh-enough did not resolve");
    const findings = await freshnessGrader.grade({
      targets: [{ plan, eval: ev }],
      config,
      root: cwd,
      exec: () => {
        throw new Error("the freshness grader shells out to nothing");
      },
    });
    expect(findings).toEqual([]);
  });

  it("points a problem at the page's own manifest", async () => {
    const cwd = dir("per-page");
    const config = loadConfig(undefined, cwd);
    const pages = await withExternalMetadata(
      discoverPages(config, { paths: [] }, cwd),
      config,
      cwd,
    );
    const plan = planFor(resolvePages(pages, { ...config, suites: {} }), "docs/install.md");
    expect(plan.problems).toEqual([
      {
        message: expect.stringContaining('Unknown suite "reference"') as string,
        level: "error",
        file: "docs/install.evals.yaml",
        line: 2,
      },
    ]);
  });

  it("reads a page with no manifest of its own as declaring nothing", async () => {
    const plan = planFor(await plansOf("per-page"), "docs/uncovered.md");
    expect(plan.problems).toEqual([]);
    expect(plan.suite).toBeNull();
    expect(plan.evals).toEqual([]);
  });
});
