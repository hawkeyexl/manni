import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentLines,
  exportGeneratedBy,
  renderStatus,
  runStatus,
  type StatusReport,
} from "../../src/family/commands/status.js";
import { parseEnvelope, type Envelope } from "../../src/family/core/envelope.js";
import pkg from "../../package.json" with { type: "json" };
import { gitAvailable, removeTempRepo } from "../helpers/temp-repo.js";
import { envelope, fixtureRepo } from "./helpers.js";

let dir: string | undefined;
afterEach(() => {
  removeTempRepo(dir);
  dir = undefined;
});

function statusOf(report: StatusReport, name: string): string | undefined {
  return report.domains.find((d) => d.name === name)?.status;
}

describe.skipIf(!gitAvailable())("runStatus", () => {
  it("names what is set up, by section or by declaration", async () => {
    dir = fixtureRepo("everything");
    const report = await runStatus({ cwd: dir });
    expect(report.version).toBe(pkg.version);
    expect(report.config).toBe("manni.config.yaml");
    expect(report.collections.map((c) => c.name)).toEqual(["site"]);
    expect(report.collections[0]?.files).toBeGreaterThan(0);
    expect(report.domains).toEqual([
      { name: "meta", status: "in-play", reason: "meta: section" },
      { name: "cite", status: "in-play", reason: "1 page carries citations" },
      { name: "lint", status: "in-play", reason: "lint: section" },
      { name: "docevals", status: "in-play", reason: "docevals: section" },
      { name: "term", status: "in-play", reason: "1 term" },
      { name: "graph", status: "in-play", reason: "graph: section" },
      { name: "a11y", status: "not-checked", reason: "run manni a11y check against a running site" },
      { name: "tracevals", status: "not-checked", reason: "run manni tracevals run over sessions" },
    ]);
  });

  it("names what is not set up, and why", async () => {
    dir = fixtureRepo("only-graph");
    const report = await runStatus({ cwd: dir });
    expect(statusOf(report, "graph")).toBe("in-play");
    for (const name of ["meta", "cite", "lint", "docevals", "term"]) {
      expect(statusOf(report, name)).toBe("not-set-up");
    }
  });

  it("sets nothing up when the config declares no collections", async () => {
    dir = fixtureRepo("everything");
    const config = join(dir, "manni.config.yaml");
    writeFileSync(config, readFileSync(config, "utf8").replace(/^collections:[\s\S]*?(?=^\S)/m, ""));
    const report = await runStatus({ cwd: dir });
    expect(report.collections).toEqual([]);
    for (const d of report.domains.filter((x) => x.status !== "not-checked")) {
      expect(d).toEqual({ name: d.name, status: "not-set-up", reason: "no collections: in manni.config.yaml" });
    }
  });

  it("says unknown, not in play, for a domain that cannot read its own setup", async () => {
    dir = fixtureRepo("only-docevals");
    const config = join(dir, "manni.config.yaml");
    writeFileSync(config, readFileSync(config, "utf8").replace("docevals:\n", "docevals:\n  bogus: 1\n"));
    const report = await runStatus({ cwd: dir });
    const row = report.domains.find((d) => d.name === "docevals");
    expect(row?.status).toBe("unknown");
    expect(row?.reason).toMatch(/^manni docevals run could not run: /);
  });

  it("puts meta in play for a page that names its own $schema", async () => {
    dir = fixtureRepo("only-citations");
    writeFileSync(join(dir, "docs/own.md"), "---\n$schema: manni:core:1.0.0\ntitle: Own\n---\n# Own\n");
    const report = await runStatus({ cwd: dir });
    expect(report.domains[0]).toEqual({ name: "meta", status: "in-play", reason: "1 page names its own $schema" });
  });
});

describe("renderStatus", () => {
  const report: StatusReport = {
    version: "4.4.0",
    config: "manni.config.yaml",
    collections: [{ name: "site", files: 142 }],
    domains: [
      { name: "meta", status: "in-play", reason: "meta: section" },
      { name: "lint", status: "not-set-up", reason: "no lint: section" },
      { name: "tracevals", status: "not-checked", reason: "run manni tracevals run over sessions" },
    ],
  };

  it("pretty: the header, then one row per domain", () => {
    expect(renderStatus(report, "pretty")).toBe(
      [
        "manni 4.4.0   config manni.config.yaml   collection site (142 files)",
        "",
        "meta       in play       meta: section",
        "lint       not set up    no lint: section",
        "tracevals  not checked   run manni tracevals run over sessions",
      ].join("\n"),
    );
  });

  it("json: the report as it is", () => {
    expect(JSON.parse(renderStatus(report, "json"))).toEqual(report);
  });

  it("tells an agent what will happen, naming only the set-wide checks in play", () => {
    expect(agentLines(report).split("\n")).toEqual([
      "After you edit a file in site, manni check runs on it, and errors come back to you at once.",
      "Before you finish, manni check runs on every file you changed. You get one repair pass.",
      "The manni:fix skill says how to repair each finding.",
    ]);
    const everything: StatusReport = {
      ...report,
      domains: ["cite", "term", "graph"].map((name) => ({ name, status: "in-play" as const, reason: "" })),
    };
    expect(agentLines(everything).split("\n")[1]).toBe(
      "Before you finish, manni check runs on every file you changed, plus every citation, the glossary and the graph. You get one repair pass.",
    );
    const three: StatusReport = {
      ...report,
      collections: ["site", "api", "blog"].map((name) => ({ name, files: 1 })),
    };
    expect(agentLines(three).split("\n")[0]).toBe(
      "After you edit a file in site, api or blog, manni check runs on it, and errors come back to you at once.",
    );
    const citeOnly: StatusReport = { ...report, domains: [{ name: "cite", status: "in-play", reason: "" }] };
    expect(agentLines(citeOnly).split("\n")[1]).toBe(
      "Before you finish, manni check runs on every file you changed, plus every citation. You get one repair pass.",
    );
  });
});

describe("exportGeneratedBy", () => {
  let envDir: string | undefined;
  afterEach(() => {
    if (envDir) rmSync(envDir, { recursive: true, force: true });
    envDir = undefined;
  });

  function envFile(content = ""): string {
    envDir = mkdtempSync(join(tmpdir(), "manni-env-"));
    const file = join(envDir, "env.sh");
    writeFileSync(file, content);
    return file;
  }

  function env(name: string): Envelope {
    const parsed = parseEnvelope(envelope(name));
    if (parsed === undefined) throw new Error(name);
    return parsed;
  }

  it("appends the model when the envelope names it and nothing set it", () => {
    const file = envFile("export A=1");
    expect(exportGeneratedBy(env("session-start-model"), { CLAUDE_ENV_FILE: file })).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("export A=1\nexport MANNI_GENERATED_BY=claude-opus-4-5\n");
  });

  it("writes nothing without a model, without the file, or over a value already set", () => {
    const file = envFile();
    expect(exportGeneratedBy(env("session-start"), { CLAUDE_ENV_FILE: file })).toBe(false);
    expect(exportGeneratedBy(env("session-start-model"), {})).toBe(false);
    expect(
      exportGeneratedBy(env("session-start-model"), { CLAUDE_ENV_FILE: file, MANNI_GENERATED_BY: "someone" }),
    ).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("");
  });

  it("drops a context-window suffix, which names no model", () => {
    const file = envFile();
    const long = parseEnvelope(JSON.stringify({ hook_event_name: "SessionStart", model: "claude-opus-5-5[1m]" }));
    if (long === undefined) throw new Error("not an envelope");
    expect(exportGeneratedBy(long, { CLAUDE_ENV_FILE: file })).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("export MANNI_GENERATED_BY=claude-opus-5-5\n");
  });

  it("writes nothing a shell would read as more than a model id", () => {
    const file = envFile();
    const hostile = parseEnvelope(JSON.stringify({ hook_event_name: "SessionStart", model: "m; rm -rf ~" }));
    if (hostile === undefined) throw new Error("not an envelope");
    expect(exportGeneratedBy(hostile, { CLAUDE_ENV_FILE: file })).toBe(false);
  });
});
