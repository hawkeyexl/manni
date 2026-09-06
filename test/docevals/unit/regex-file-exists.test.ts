/**
 * `tool:regex` and `tool:file-exists` — the deterministic rungs below the
 * judge.
 *
 * Every distinct shape gets a case, per the fixtures rule: each `match` mode,
 * both `exists` values, and each `target` the regex grader can be pointed at.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvals } from "../../../src/docevals/core/engine.js";

interface Case {
  /** Lines under the config eval, e.g. grader + options. */
  evalLines: string[];
  /** Extra files to write beside the page, as [relative path, contents]. */
  files?: [string, string][];
}

function scaffold({ evalLines, files = [] }: Case): string {
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-native-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(
    join(root, "docs", "install.md"),
    [
      "---",
      "title: Install",
      "owner: docs-team",
      "evals:",
      "  - use: subject",
      "---",
      "",
      "# Install",
      "",
      "Run `npm i -g manni docevals` to install.",
      "",
      "## Install",
      "",
    ].join("\n"),
  );
  for (const [rel, body] of files) {
    const abs = join(root, "docs", rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      "  evals:",
      "    subject:",
      ...evalLines,
      "",
    ].join("\n"),
  );
  return root;
}

const outcomeOf = async (c: Case) => {
  const report = await runEvals({ cwd: scaffold(c), generate: false });
  const errors = report.problems.filter((p) => p.level === "error");
  if (errors.length > 0) return `config-error: ${errors[0]?.message ?? ""}`;
  return report.evalResults[0]?.outcome ?? "missing";
};

const regexEval = (opts: string[]) => [
  "      grader: tool:regex",
  "      options:",
  ...opts.map((o) => `        ${o}`),
];

describe("tool:regex", () => {
  it("passes when the pattern is present (contains is the default)", async () => {
    expect(await outcomeOf({ evalLines: regexEval(['pattern: "npm i -g"']) })).toBe(
      "pass",
    );
  });

  it("fails when the pattern is absent", async () => {
    expect(await outcomeOf({ evalLines: regexEval(['pattern: "yarn global add"']) })).toBe(
      "fail",
    );
  });

  it("not-contains passes when absent and fails when present", async () => {
    expect(
      await outcomeOf({
        evalLines: regexEval(['pattern: "coming soon"', "match: not-contains"]),
      }),
    ).toBe("pass");
    expect(
      await outcomeOf({
        evalLines: regexEval(['pattern: "Install"', "match: not-contains"]),
      }),
    ).toBe("fail");
  });

  it("count:N counts every occurrence, not just the first", async () => {
    // "Install" appears in the title heading and the duplicated one below it.
    expect(
      await outcomeOf({ evalLines: regexEval(['pattern: "^## Install"', "match: count:1", 'flags: "m"']) }),
    ).toBe("pass");
    expect(
      await outcomeOf({ evalLines: regexEval(['pattern: "Install"', "match: count:1"]) }),
    ).toBe("fail");
  });

  it("honours target: frontmatter, which the body would not match", async () => {
    expect(
      await outcomeOf({
        evalLines: [...regexEval(['pattern: "docs-team"']), "      target: frontmatter"],
      }),
    ).toBe("pass");
    // The same pattern against the default body target finds nothing.
    expect(await outcomeOf({ evalLines: regexEval(['pattern: "docs-team"']) })).toBe(
      "fail",
    );
  });

  it("honours target: raw, which sees both", async () => {
    expect(
      await outcomeOf({
        evalLines: [...regexEval(['pattern: "docs-team"']), "      target: raw"],
      }),
    ).toBe("pass");
  });

  it("rejects an uncompilable pattern as a config error, not a page failure", async () => {
    const outcome = await outcomeOf({ evalLines: regexEval(['pattern: "([unclosed"']) });
    expect(outcome).toContain("config-error");
    expect(outcome).toContain("not a valid regular expression");
  });

  it("rejects a missing pattern", async () => {
    expect(await outcomeOf({ evalLines: regexEval(["match: contains"]) })).toContain(
      "options.pattern is required",
    );
  });
});

describe("tool:file-exists", () => {
  const fe = (opts: string[]) => [
    "      grader: tool:file-exists",
    "      options:",
    ...opts.map((o) => `        ${o}`),
  ];

  it("passes when the companion file is there", async () => {
    expect(
      await outcomeOf({
        evalLines: fe(['path: "examples/quickstart.ts"']),
        files: [["examples/quickstart.ts", "export const x = 1;\n"]],
      }),
    ).toBe("pass");
  });

  it("fails when it is not", async () => {
    expect(await outcomeOf({ evalLines: fe(['path: "examples/quickstart.ts"']) })).toBe(
      "fail",
    );
  });

  it("matches a glob, so a page can require some example without naming one", async () => {
    expect(
      await outcomeOf({
        evalLines: fe(['path: "examples/*.ts"']),
        files: [["examples/anything.ts", "export const x = 1;\n"]],
      }),
    ).toBe("pass");
  });

  it("exists: false fails while the file is still shipped", async () => {
    expect(
      await outcomeOf({
        evalLines: fe(['path: "legacy.md"', "exists: false"]),
        files: [["legacy.md", "old\n"]],
      }),
    ).toBe("fail");
    expect(
      await outcomeOf({ evalLines: fe(['path: "legacy.md"', "exists: false"]) }),
    ).toBe("pass");
  });

  it("refuses a path that climbs out of the page's directory", async () => {
    expect(
      await outcomeOf({ evalLines: fe(['path: "../../etc/passwd"']) }),
    ).toBe("fail");
  });
});
