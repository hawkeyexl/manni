/**
 * docevals grades the evals of the template `manni lint` routes each page to.
 * `list` and `run` go through the built `dist/cli.js`; the judged run and
 * `promote` run in-process, with a scripted MockProvider.
 *
 * The fixture's `templates/how-to.yaml` replaces the built-in how-to, extends
 * it, skips `tgdp-one-method`, and adds `shows-the-command` and the config's
 * `no-todo-markers`. `overrides` routes `overridden.md`; `explicit.md` names
 * the template with `$template`; `builtin.md` is a built-in concept page.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MockProvider, mockVerdict } from "@hawkeyexl/inference";
import { loadConfig } from "../../../src/docevals/core/config.js";
import { runEvals } from "../../../src/docevals/core/engine.js";
import { makeJudge } from "../../../src/docevals/judge/judge.js";
import { runPromote } from "../../../src/docevals/commands/promote.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const MANNI = join(ROOT, "dist", "cli.js");
const DIR = join(ROOT, "test/docevals/fixtures/template-evals");

function manni(cwd: string, ...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync("node", [MANNI, "docevals", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

interface ListedPage {
  file: string;
  template: string | null;
  evals: { name: string; source: string; skip: boolean }[];
}

describe("template evals: list", () => {
  const r = manni(DIR, "list", "-f", "json");
  const pages = JSON.parse(r.stdout) as ListedPage[];
  const byFile = new Map(pages.map((p) => [p.file, p] as const));

  it("exits 0", () => {
    expect(r.status).toBe(0);
  });

  it("names each page's template, and null for an unrouted one", () => {
    expect(byFile.get("docs/builtin.md")?.template).toBe("tgdp:concept:1.6");
    // Local templates print relative to the working directory, whichever
    // stage routed them: `$template` beside the page, or config.
    for (const file of ["docs/typed.md", "docs/overridden.md", "docs/narrowed.md", "docs/explicit.md"]) {
      expect(byFile.get(file)?.template).toBe("templates/how-to.yaml#how-to");
    }
    expect(byFile.get("docs/untyped.md")?.template).toBeNull();
  });

  it("resolves the house template's merge, with source template on its own evals", () => {
    const evals = byFile.get("docs/typed.md")?.evals ?? [];
    const of = (name: string) => evals.find((e) => e.name === name);
    expect(of("shows-the-command")?.source).toBe("template");
    expect(of("tgdp-overview-names-the-task")?.source).toBe("template");
    expect(of("tgdp-one-method")?.skip).toBe(true);
    // The template's `use: no-todo-markers` is the config's eval.
    expect(of("no-todo-markers")?.source).toBe("config");
    expect(of("has-a-heading")?.source).toBe("config");
  });

  it("lets the page narrow and replace template evals", () => {
    const evals = byFile.get("docs/narrowed.md")?.evals ?? [];
    expect(evals.find((e) => e.name === "shows-the-command")).toMatchObject({
      source: "template",
      skip: true,
    });
    expect(evals.find((e) => e.name === "tgdp-overview-names-the-task")?.source).toBe("page");
  });

  it("gives an unrouted page its suite alone", () => {
    expect(byFile.get("docs/untyped.md")?.evals.map((e) => e.name)).toEqual(["has-a-heading"]);
  });

  it("shows the template in the pretty header and tags template evals", () => {
    const pretty = manni(DIR, "list");
    expect(pretty.status).toBe(0);
    expect(pretty.stdout).toContain("docs/builtin.md (suite: site) (template: tgdp:concept:1.6)\n");
    expect(pretty.stdout).toContain("  - tgdp-one-concept [ai, regression, template]\n");
    expect(pretty.stdout).toContain("  - no-todo-markers [tool:regex, regression, config]\n");
    expect(pretty.stdout).toContain("docs/untyped.md (suite: site)\n");
    expect(pretty.stdout).toContain(
      "docs/typed.md (suite: site) (template: templates/how-to.yaml#how-to)\n",
    );
  });
});

interface RunResult {
  file: string;
  evalName: string;
  outcome: string;
  location?: { file: string; line?: number };
}

describe("template evals: a deterministic run", () => {
  const r = manni(DIR, "run", "--deterministic-only", "--no-generate", "-f", "json");
  const report = JSON.parse(r.stdout) as { exitCode: number; evalResults: RunResult[]; problems: unknown[] };
  const result = (file: string, name: string) =>
    report.evalResults.find((e) => e.file === file && e.evalName === name);

  it("exits 1 on the template's regex eval, located at the page's type line", () => {
    expect(r.status).toBe(1);
    expect(result("docs/typed-fails.md", "shows-the-command")).toMatchObject({
      outcome: "fail",
      location: { file: "docs/typed-fails.md", line: 3 },
    });
    expect(result("docs/typed.md", "shows-the-command")?.outcome).toBe("pass");
    expect(report.problems).toEqual([]);
  });

  it("locates a $template page's evals at its $template line, and a config-routed one at the page", () => {
    expect(result("docs/explicit.md", "shows-the-command")?.location).toEqual({
      file: "docs/explicit.md",
      line: 3,
    });
    expect(result("docs/overridden.md", "shows-the-command")?.location).toEqual({
      file: "docs/overridden.md",
    });
  });

  it("skips the tgdp ai evals", () => {
    expect(result("docs/builtin.md", "tgdp-one-concept")?.outcome).toBe("skipped");
  });
});

describe("template evals: a judged run", () => {
  it("fails the run when the judge fails a tgdp eval", async () => {
    const loaded = loadConfig(join(DIR, "manni.config.yaml"));
    const config = {
      ...loaded,
      judge: { ...loaded.judge, cacheDir: join(mkdtempSync(join(tmpdir(), "manni-template-evals-")), "cache") },
    };
    const judge = makeJudge({ provider: new MockProvider([mockVerdict("fail", 0.95)]), root: DIR });
    const report = await runEvals({
      cwd: DIR,
      paths: ["docs/builtin.md"],
      config,
      generate: false,
      judge: (targets, _config, options) => judge(targets, config, options),
    });
    expect(report.exitCode).toBe(1);
    const judged = report.evalResults.find((e) => e.evalName === "tgdp-one-concept");
    expect(judged?.outcome).toBe("fail");
    expect(judged?.location).toEqual({ file: "docs/builtin.md", line: 3 });
  }, 60000);
});

describe("template evals: a template use: no config defines", () => {
  it("is exit 2 from list and run, naming the template and the config", () => {
    const cwd = join(DIR, "bad-ref");
    for (const args of [["list"], ["run", "--deterministic-only"]]) {
      const r = manni(cwd, ...args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(
        'templates/how-to.yaml#how-to: evals use "no-such-eval", which no template it extends and no docevals.evals entry in manni.config.yaml defines',
      );
      expect(r.stderr).not.toContain("bad-ref");
    }
  });
});

describe("template evals: promote --write", () => {
  it("proposes a template eval and edits no template", async () => {
    const proposals = await runPromote(["docs/typed.md"], {
      cwd: DIR,
      write: true,
      providerInstance: new MockProvider([
        { json: { promotable: true, rationale: "A regex is enough.", code: "process.exit(0);\n" } },
      ]),
    });
    const p = proposals.find((x) => x.evalName === "tgdp-shows-the-result");
    expect(p).toMatchObject({ source: "template", promotable: true, applied: false });
    expect(p?.error).toBe(
      'eval "tgdp-shows-the-result" is declared in templates/how-to.yaml#how-to; ' +
        "promote --write does not edit templates. Apply the proposal in the template or in one that extends it.",
    );
  });
});
