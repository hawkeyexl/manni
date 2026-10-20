/**
 * A failed eval shows what it checks and what to do (proposal 0089).
 *
 * Every result carries `guidance`: the file that declares the eval, its name,
 * its assertion and the fix page. Every reporter prints it under the finding.
 * A judged eval prints what the judge observed and why, quoted from a run
 * that did not pass, and an eval awaiting review is annotated in the CI
 * formats.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { renderList, runList } from "../../../src/docevals/commands/list.js";
import type { ConsensusResult, JudgeRun, Match } from "@hawkeyexl/inference";
import { render } from "../../../src/docevals/reporters/index.js";
import type { EngineReport } from "../../../src/docevals/core/engine.js";
import type { EvalResult } from "../../../src/docevals/types.js";

const GUIDE = "https://hawkeyexl.github.io/manni/docevals/fix/";

function run(match: Match, observed: string, reasoning: string): JudgeRun {
  return {
    verdict: { claim: "c", observed, match, confidence: 0.9, reasoning },
    provider: "mock",
    model: "m",
    cached: false,
    durationMs: 1,
  };
}

const REGEX: EvalResult = {
  evalName: "no-todo-markers",
  suite: "reference",
  type: "regression",
  grader: "tool:regex",
  file: "docs/actions/goTo.mdx",
  location: { file: "docs/actions/goTo.mdx", line: 7 },
  outcome: "fail",
  findings: [
    {
      evalName: "no-todo-markers",
      file: "docs/actions/goTo.mdx",
      ruleId: "regex/found",
      message:
        "Pattern /TODO/ found in body, expected absent. Remove or reword the matching text.",
      severity: "error",
      line: 14,
    },
  ],
  guidance: {
    id: "docs/actions/goTo.mdx",
    rule: "no-todo-markers",
    description: "The page carries no TODO, TBD or FIXME markers.",
    guide: GUIDE,
  },
  durationMs: 1,
};

const CONSENSUS: ConsensusResult = {
  // The one passing run comes first: a reporter that quotes the first run
  // with a verdict would argue against the failure it sits under.
  runs: [
    run("pass", "Nothing is promised.", "The page is fine."),
    run(
      "fail",
      "Waiting for network idle is planned for a later release.",
      "Line 16 promises a later release.",
    ),
    run("fail", "Planned for later.", "It promises."),
  ],
  votes: { pass: 1, fail: 2, partial: 0, error: 0 },
  verdict: "fail",
  agreement: 0.67,
  meanConfidence: 0.91,
  zone: "auto-fail",
};

const JUDGED: EvalResult = {
  evalName: "no-future-promises",
  suite: "reference",
  type: "regression",
  grader: "ai",
  file: "docs/actions/goTo.mdx",
  location: { file: "docs/actions/goTo.mdx", line: 5 },
  outcome: "fail",
  consensus: CONSENSUS,
  guidance: {
    id: "docs/actions/goTo.mdx",
    rule: "no-future-promises",
    description: "The page makes no claims about unreleased or future functionality.",
    guide: GUIDE,
  },
  durationMs: 1,
};

const REVIEW: EvalResult = {
  ...JUDGED,
  evalName: "clear-intro",
  outcome: "needs-review",
  consensus: { ...CONSENSUS, meanConfidence: 0.55, zone: "human-review" },
  guidance: { id: "docs/actions/goTo.mdx", rule: "clear-intro", description: null, guide: GUIDE },
};

const HUMAN: EvalResult = {
  evalName: "tone",
  suite: "reference",
  type: "regression",
  grader: "human",
  file: "docs/actions/goTo.mdx",
  location: { file: "docs/actions/goTo.mdx", line: 9 },
  outcome: "needs-review",
  guidance: { id: "docs/actions/goTo.mdx", rule: "tone", description: "The tone is plain.", guide: GUIDE },
  durationMs: 0,
};

const REPORT: EngineReport = {
  pages: 1,
  evalResults: [REGEX, JUDGED, REVIEW, HUMAN],
  suites: [],
  usage: { totalTokens: 0, cachedEvals: 0, judgedEvals: 2 },
  generated: [],
  problems: [],
  exitCode: 1,
};

const FAIL_HEAD = "AI judge: fail (confidence 0.91). Edit the page so the assertion holds.";
const OBSERVED = "Observed: Waiting for network idle is planned for a later release.";
const REASONING = "Reasoning: Line 16 promises a later release.";
const REVIEW_HEAD =
  "AI judge: no confident verdict (confidence 0.55). Record a verdict with manni docevals review, " +
  "or sharpen the assertion and run manni docevals calibrate.";
const HUMAN_HEAD = "Awaiting human review. Record a verdict with manni docevals review.";

describe("pretty", () => {
  const out = render(REPORT, "pretty");

  it("prints the guidance lines under a finding", () => {
    expect(out).toContain(
      "  FAIL no-todo-markers  docs/actions/goTo.mdx:7\n" +
        "       error:14 [regex/found] Pattern /TODO/ found in body, expected absent. Remove or reword the matching text.\n" +
        "       docs/actions/goTo.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers.\n" +
        `       Guide: ${GUIDE}`,
    );
  });

  it("prints the judged block from the failing run, the votes, then the guidance", () => {
    expect(out).toContain(
      "  FAIL no-future-promises [auto-fail]  docs/actions/goTo.mdx:5\n" +
        `       ${FAIL_HEAD}\n` +
        `       ${OBSERVED}\n` +
        `       ${REASONING}\n` +
        "       votes pass:1 fail:2 partial:0\n" +
        "       docs/actions/goTo.mdx no-future-promises: The page makes no claims about unreleased or future functionality.\n" +
        `       Guide: ${GUIDE}`,
    );
  });

  it("says what to do with an eval awaiting review", () => {
    expect(out).toContain(`       ${REVIEW_HEAD}`);
    expect(out).toContain(`       ${HUMAN_HEAD}`);
    expect(out).toContain(
      "2 eval(s) need human review. Run `manni docevals review` to record verdicts.",
    );
  });

  it("prints no guidance under a passing result", () => {
    const pass = render(
      { ...REPORT, evalResults: [{ ...REGEX, outcome: "pass", findings: [] }] },
      "pretty",
    );
    expect(pass).not.toContain("Guide:");
  });
});

describe("github", () => {
  const out = render(REPORT, "github");

  it("appends the guidance after %0A", () => {
    expect(out).toContain(
      "::error file=docs/actions/goTo.mdx,line=14,title=manni docevals%3A no-todo-markers::" +
        "Pattern /TODO/ found in body, expected absent. Remove or reword the matching text." +
        "%0Adocs/actions/goTo.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers." +
        `%0AGuide: ${GUIDE}`,
    );
  });

  it("quotes the failing run in a judged failure", () => {
    expect(out).toContain(`::${FAIL_HEAD}%0A${OBSERVED}%0A${REASONING}%0Adocs/actions/goTo.mdx no-future-promises:`);
    expect(out).not.toContain("The page is fine.");
  });

  it("emits one warning per eval awaiting review", () => {
    const warnings = out.split("\n").filter((l) => l.startsWith("::warning "));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain(`title=manni docevals%3A clear-intro::${REVIEW_HEAD}`);
    expect(warnings[1]).toContain(`::${HUMAN_HEAD}%0Adocs/actions/goTo.mdx tone: The tone is plain.`);
  });
});

describe("sarif", () => {
  const log = JSON.parse(render(REPORT, "sarif")) as {
    runs: {
      tool: { driver: { rules: Record<string, unknown>[] } };
      results: { ruleId: string; level: string; message: { text: string }; properties?: Record<string, unknown> }[];
    }[];
  };
  const sarifRun = log.runs[0] ?? { tool: { driver: { rules: [] } }, results: [] };

  it("names a regex rule for itself, with a description and a guide", () => {
    const rule = sarifRun.tool.driver.rules.find((r) => r.id === "regex/found");
    expect(rule).toMatchObject({
      name: "regex/found",
      shortDescription: { text: "Text the eval forbids is present" },
      fullDescription: { text: "The page contains text an eval forbids. The line is the first match." },
      helpUri: GUIDE,
    });
  });

  it("gives a judged rule the guide", () => {
    const rule = sarifRun.tool.driver.rules.find((r) => r.id === "no-future-promises");
    expect(rule).toMatchObject({ helpUri: GUIDE });
  });

  it("carries the guidance in the message and the properties", () => {
    const result = sarifRun.results.find((r) => r.ruleId === "regex/found");
    expect(result?.message.text).toBe(
      "Pattern /TODO/ found in body, expected absent. Remove or reword the matching text.\n" +
        "docs/actions/goTo.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers.\n" +
        `Guide: ${GUIDE}`,
    );
    expect(result?.properties?.guidance).toEqual(REGEX.guidance);
  });

  it("quotes the failing run in a judged failure", () => {
    const result = sarifRun.results.find((r) => r.ruleId === "no-future-promises");
    expect(result?.message.text.split("\n").slice(0, 3)).toEqual([FAIL_HEAD, OBSERVED, REASONING]);
  });

  it("reports one warning per eval awaiting review", () => {
    const warnings = sarifRun.results.filter((r) => r.level === "warning");
    expect(warnings.map((r) => r.ruleId)).toEqual(["clear-intro", "tone"]);
    expect(warnings[0]?.message.text.startsWith(REVIEW_HEAD)).toBe(true);
  });
});

describe("junit", () => {
  const xml = render(REPORT, "junit");

  it("puts the guidance in the failure body", () => {
    expect(xml).toContain(
      "docs/actions/goTo.mdx:14 Pattern /TODO/ found in body, expected absent. Remove or reword the matching text.\n" +
        "docs/actions/goTo.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers.\n" +
        `Guide: ${GUIDE}</failure>`,
    );
  });

  it("quotes the failing run in a judged failure", () => {
    expect(xml).toContain(`>${FAIL_HEAD}\n${OBSERVED}\n${REASONING}\ndocs/actions/goTo.mdx no-future-promises:`);
  });
});

describe("markdown", () => {
  const md = render(REPORT, "markdown");

  it("lists the message, then the guidance, one bullet a line", () => {
    expect(md).toContain(
      "- ❌ **no-todo-markers** · `docs/actions/goTo.mdx:7`\n" +
        "  - error:14: Pattern /TODO/ found in body, expected absent. Remove or reword the matching text.\n" +
        "  - docs/actions/goTo.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers.\n" +
        `  - Guide: ${GUIDE}`,
    );
  });

  it("lists the judged block, the votes, then the guidance", () => {
    expect(md).toContain(
      "- ❌ **no-future-promises** · `docs/actions/goTo.mdx:5`\n" +
        `  - ${FAIL_HEAD}\n` +
        `  - ${OBSERVED}\n` +
        `  - ${REASONING}\n` +
        "  - votes pass:1 fail:2 partial:0, confidence 0.91 (auto-fail)\n" +
        "  - docs/actions/goTo.mdx no-future-promises:",
    );
  });
});

describe("html", () => {
  const html = render(REPORT, "html");

  it("quotes the failing run and prints the guidance", () => {
    expect(html).toContain("Line 16 promises a later release.");
    expect(html).not.toContain("The page is fine.");
    expect(html).toContain(
      '<p class="muted">docs/actions/goTo.mdx no-todo-markers: The page carries no TODO, TBD or FIXME markers.</p>',
    );
    expect(html).toContain(`<p class="muted">Guide: ${GUIDE}</p>`);
  });
});

describe("json", () => {
  it("carries guidance on every result", () => {
    const parsed = JSON.parse(render(REPORT, "json")) as { evalResults: { guidance: unknown }[] };
    expect(parsed.evalResults.every((r) => r.guidance !== undefined)).toBe(true);
  });
});

describe("list", () => {
  it("prints each eval's assertion under it", async () => {
    const pages = resolve(import.meta.dirname, "../fixtures/pages");
    const run = await runList(["docs/actions/goTo.mdx"], { cwd: pages });
    expect(renderList(run, "pretty")).toContain(
      "  - no-todo-markers [tool:regex, regression, config]\n" +
        "      The page carries no TODO, TBD or FIXME markers.",
    );
    expect(run.exitCode).toBe(0);
  });
});
