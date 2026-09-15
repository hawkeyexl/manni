/**
 * Self-preference: the model that judged an eval also produced what it graded
 * (proposal 0046, § The self-preference-bias check).
 *
 * Two axes with different remedies, so they are reported apart. Content — the
 * machines attributed for what the eval's `target` reads name the judge:
 * `provenance` for `body`, the `fields` of `meta-provenance` for
 * `frontmatter`, both for `raw`, and nothing for a companion file. Criterion —
 * a `meta-provenance` entry for the judge lists this eval's id under `evals`,
 * meaning the judge wrote the question. Content wins when both hold.
 *
 * It stays a warning. Bias skews a verdict; it does not stop one forming, so
 * ADR 01022's "no verdict fails" rule is not in play, and erroring would
 * punish a single-model corpus with no second provider to reach for.
 */
import { afterEach, beforeEach, describe, it, expect, vi, type MockInstance } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { selfPreferenceOf } from "../../../src/docevals/judge/self-preference.js";
import { parseDocevalsConfig } from "../helpers/config.js";
import { resolvePage, type ResolvedEval } from "../../../src/docevals/core/resolve.js";
import { stripFrontmatterBlock, type PageFile } from "../../../src/docevals/core/discover.js";
import type { EvalTarget } from "../../../src/docevals/core/target.js";
import { extractFrontmatter } from "../../../src/meta/index.js";
import type { GraderTarget } from "../../../src/docevals/graders/types.js";
import { resetWarnings } from "../../../src/shared/warn.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/provenance/docs");
const config = parseDocevalsConfig("", "/fake/manni.config.yaml");
const tempRoot = () => mkdtempSync(join(tmpdir(), "manni-docevals-selfpref-"));

/** The model the fixtures attribute everything to. */
const AUTHOR = "claude-fable-5";

/** MockProvider reports its model name as whatever it is constructed with. */
const provider = (model: string) =>
  new MockProvider([mockVerdict("pass", 0.95)], model);

function pageFrom(content: string, file: string): PageFile {
  return {
    file,
    absPath: join("/fake", file),
    content,
    body: stripFrontmatterBlock(content),
    frontmatter: extractFrontmatter(content, "markdown"),
  };
}

/** A fixture page's first eval, with its `target` replaced when one is given. */
function fixtureTarget(name: string, target?: EvalTarget | null): GraderTarget {
  const content = readFileSync(join(FIXTURES, name), "utf8");
  const plan = resolvePage(pageFrom(content, `docs/${name}`), config);
  const ev = plan.evals[0];
  if (!ev) throw new Error(`no eval resolved from ${name}`);
  const evalWith: ResolvedEval =
    target === undefined ? ev : { ...ev, target: target ?? undefined };
  return { plan, eval: evalWith };
}

/** An inline page, for the combinations no fixture carries. */
function inlineTarget(frontmatter: string[], target?: string): GraderTarget {
  const content = [
    "---",
    "title: x",
    ...frontmatter,
    "evals:",
    "  - id: claim-check",
    "    assertion: The page satisfies the claim.",
    ...(target === undefined ? [] : [`    target: ${target}`]),
    "    examples: { pass: yes, fail: no }",
    "---",
    "Body.",
  ].join("\n");
  const plan = resolvePage(pageFrom(content, "docs/page.md"), config);
  const ev = plan.evals[0];
  if (!ev) throw new Error("no eval resolved");
  return { plan, eval: ev };
}

const of = (t: GraderTarget, model = AUTHOR) => selfPreferenceOf(t.plan, t.eval, model);

const BODY_SENTENCE =
  'provenance names claude-fable-5 for the body this eval grades, and it is also the judge. Self-judging favors the author; give "limits-stated" a model: of its own.';

describe("selfPreferenceOf: the content axis, by target", () => {
  it("body (the default) reads provenance", () => {
    expect(of(fixtureTarget("self-preference-provenance.md"))).toEqual({
      axis: "content",
      model: AUTHOR,
      message: BODY_SENTENCE,
    });
  });

  it("body ignores a machine provenance does not name", () => {
    expect(of(fixtureTarget("self-preference-provenance.md"), "claude-sonnet-5")).toBeUndefined();
  });

  it("body does not read meta-provenance fields", () => {
    expect(of(fixtureTarget("self-preference-meta-provenance-fields.md", "body"))).toBeUndefined();
  });

  it("frontmatter reads the fields of meta-provenance", () => {
    expect(of(fixtureTarget("self-preference-meta-provenance-fields.md"))).toEqual({
      axis: "content",
      model: AUTHOR,
      message:
        'meta-provenance names claude-fable-5 for the fields this eval grades, and it is also the judge. Self-judging favors the author; give "description-matches" a model: of its own.',
    });
  });

  it("frontmatter does not read provenance", () => {
    expect(of(fixtureTarget("self-preference-provenance.md", "frontmatter"))).toBeUndefined();
  });

  it("frontmatter needs an entry that names fields, not only evals", () => {
    const t = inlineTarget(
      ["meta-provenance:", `  - generated-by: ${AUTHOR}`, "    evals: [some-other-eval]"],
      "frontmatter",
    );
    expect(of(t)).toBeUndefined();
  });

  it("raw reads provenance, with the body sentence", () => {
    expect(of(fixtureTarget("self-preference-provenance.md", "raw"))).toEqual({
      axis: "content",
      model: AUTHOR,
      message: BODY_SENTENCE,
    });
  });

  it("raw reads meta-provenance fields, with the fields sentence", () => {
    expect(of(fixtureTarget("self-preference-meta-provenance-fields.md", "raw"))?.message).toBe(
      'meta-provenance names claude-fable-5 for the fields this eval grades, and it is also the judge. Self-judging favors the author; give "description-matches" a model: of its own.',
    );
  });

  it("a companion file is never compared", () => {
    for (const name of [
      "self-preference-provenance.md",
      "self-preference-meta-provenance-fields.md",
    ]) {
      expect(of(fixtureTarget(name, { source: "file", path: "companion.md" }))).toBeUndefined();
    }
  });

  it("does not read a page-level generated-by", () => {
    expect(of(inlineTarget([`generated-by: ${AUTHOR}`]))).toBeUndefined();
  });

  it("reads a malformed record as naming nobody", () => {
    expect(of(inlineTarget(["provenance: nonsense", "meta-provenance: nonsense"], "raw"))).toBeUndefined();
    expect(
      of(inlineTarget(["provenance:", "  - generated-by: claude-fable-5", "    lines: 1"])),
    ).toBeUndefined();
  });
});

describe("selfPreferenceOf: the criterion axis", () => {
  it("flags an eval whose id the judge's meta-provenance entry lists", () => {
    expect(of(fixtureTarget("self-preference-criterion.md"))).toEqual({
      axis: "criterion",
      model: AUTHOR,
      message:
        'meta-provenance says claude-fable-5 proposed "limits-stated", and it is also the judge. Self-judging favors the author; give "limits-stated" a model: of its own.',
    });
  });

  it("holds whatever the target, a companion file included", () => {
    expect(
      of(fixtureTarget("self-preference-criterion.md", { source: "file", path: "companion.md" }))?.axis,
    ).toBe("criterion");
  });

  it("ignores an entry that lists a different eval", () => {
    const t = inlineTarget([
      "meta-provenance:",
      `  - generated-by: ${AUTHOR}`,
      "    evals: [some-other-eval]",
    ]);
    expect(of(t)).toBeUndefined();
  });

  it("ignores another model's entry for this eval", () => {
    expect(of(fixtureTarget("self-preference-criterion.md"), "claude-sonnet-5")).toBeUndefined();
  });

  it("gives way to the content axis when both hold", () => {
    const t = inlineTarget([
      "meta-provenance:",
      `  - generated-by: ${AUTHOR}`,
      "    fields: [/title]",
      "    evals: [claim-check]",
    ], "frontmatter");
    expect(of(t)?.axis).toBe("content");
  });
});

describe("the judge marks and warns", () => {
  let stderr: MockInstance<typeof process.stderr.write>;
  beforeEach(() => {
    resetWarnings();
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const said = (): string => stderr.mock.calls.map((c) => String(c[0])).join("");

  const judge = async (target: GraderTarget, model: string) =>
    (await makeJudge({ provider: provider(model), root: tempRoot() })([target], config, {}))[0];

  it("marks the content axis and still forms a verdict", async () => {
    const r = await judge(fixtureTarget("self-preference-provenance.md"), AUTHOR);
    expect(r?.selfPreference).toEqual({ axis: "content", model: AUTHOR });
    expect(r?.outcome).toBe("pass");
    expect(said()).toBe(`manni: docs/self-preference-provenance.md: ${BODY_SENTENCE}\n`);
  });

  it("marks the criterion axis", async () => {
    const r = await judge(fixtureTarget("self-preference-criterion.md"), AUTHOR);
    expect(r?.selfPreference).toEqual({ axis: "criterion", model: AUTHOR });
    expect(said()).toContain('meta-provenance says claude-fable-5 proposed "limits-stated"');
  });

  it("stays quiet and unmarked when a different model judges", async () => {
    const r = await judge(fixtureTarget("self-preference-provenance.md"), "claude-sonnet-5");
    expect(r?.selfPreference).toBeUndefined();
    expect(said()).toBe("");
  });

  it("says it once per page and eval", async () => {
    const target = fixtureTarget("self-preference-provenance.md");
    await judge(target, AUTHOR);
    await judge(target, AUTHOR);
    expect(said().split("\n").filter((l) => l.includes("provenance names"))).toHaveLength(1);
  });

  it("compares against the eval's own model, not the run default", async () => {
    // The run's default judge is someone else, but this eval pins the page's
    // author, which is exactly the case a check against the run-wide model
    // would miss.
    const target = fixtureTarget("self-preference-provenance.md");
    const results = await makeJudge({
      provider: provider("run-default"),
      root: tempRoot(),
      providerFor: () => provider(AUTHOR),
      // A provider as well as the model: a model alone, under the default
      // `auto`, names no provider to own it and is refused.
    })([{ ...target, eval: { ...target.eval, provider: "mock", model: AUTHOR } }], config, {});
    expect(results[0]?.selfPreference).toEqual({ axis: "content", model: AUTHOR });
  });
});
