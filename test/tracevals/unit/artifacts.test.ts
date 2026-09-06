import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveArtifacts } from "../../../src/tracevals/artifacts/resolve.js";
import { buildManifest } from "../../../src/tracevals/capture/build.js";
import type { SessionManifest } from "../../../src/tracevals/capture/types.js";
import { parseTraceFile } from "../../../src/tracevals/trace/claude.js";
import type { Trace } from "../../../src/tracevals/trace/types.js";

const fixtureHome = fileURLToPath(
  new URL("../fixtures/home", import.meta.url),
);
const fixtureProject = fileURLToPath(
  new URL("../fixtures/project", import.meta.url),
);
const nestedDir = fileURLToPath(
  new URL("../fixtures/project/packages/api", import.meta.url),
);
const sessionFixture = fileURLToPath(
  new URL("../fixtures/traces/claude-session.jsonl", import.meta.url),
);

function emptyTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    source: "claude-code",
    file: "trace.jsonl",
    cwd: fixtureProject,
    events: [],
    toolCalls: [],
    skillInvocations: [],
    agentSpawns: [],
    subagentBranches: [],
    availability: {
      recorded: false,
      skills: [],
      agents: [],
      tools: [],
      mcpServers: [],
    },
    fileAccesses: [],
    userMessages: [],
    assistantTexts: [],
    turnCount: 0,
    warnings: [],
    ...overrides,
  };
}

async function resolveFixtureSession() {
  const trace = await parseTraceFile(sessionFixture);
  return resolveArtifacts(trace, {
    projectDir: fixtureProject,
    env: { MOOSE_TRACEVALS_HOME: fixtureHome },
  });
}

describe("resolveArtifacts", () => {
  it("resolves a project skill from .claude/skills", async () => {
    const { artifacts } = await resolveFixtureSession();
    const skill = artifacts.find(
      (a) => a.type === "skill" && a.name === "fix-bug",
    );
    expect(skill).toBeDefined();
    expect(skill?.path?.endsWith("SKILL.md")).toBe(true);
    expect(skill?.content).toContain("Reproduce the bug");
    expect(skill?.origin).toBe("project");
  });

  it("resolves a plugin skill from the user plugin store", async () => {
    const { artifacts } = await resolveFixtureSession();
    const skill = artifacts.find(
      (a) => a.name === "writing-toolkit:identify-ai-tells",
    );
    expect(skill).toBeDefined();
    expect(skill?.origin).toBe("plugin");
    expect(skill?.content).toContain("Detection only");
  });

  it("resolves a project agent definition by subagent_type", async () => {
    const { artifacts } = await resolveFixtureSession();
    const agent = artifacts.find(
      (a) => a.type === "agent" && a.name === "doc-writer",
    );
    expect(agent).toBeDefined();
    expect(agent?.content).toContain("Doc Writer");
  });

  it("notes built-in agents in coverage without warning", async () => {
    const { artifacts, coverage, warnings } = await resolveFixtureSession();
    expect(artifacts.some((a) => a.name === "Explore")).toBe(false);
    const entry = coverage.find((c) => c.ref === "Explore");
    expect(entry?.resolved).toBe(false);
    expect(entry?.note).toContain("built-in");
    expect(warnings.some((w) => w.includes("Explore"))).toBe(false);
  });

  // A `<command-name>` injection is one of three things and only the
  // filesystem can say which (ADR 01023).
  it("resolves a project slash command from .claude/commands", async () => {
    const { artifacts, coverage } = await resolveFixtureSession();
    const command = artifacts.find((a) => a.name === "ship-it");
    expect(command?.type).toBe("slash-command");
    expect(command?.origin).toBe("project");
    expect(command?.content).toContain("Ship it");
    const entry = coverage.find((c) => c.ref === "ship-it");
    expect(entry?.kind).toBe("slash-command");
    expect(entry?.resolved).toBe(true);
  });

  it("keeps a slash command that resolves to a SKILL.md a skill", async () => {
    const { coverage } = await resolveFixtureSession();
    const entry = coverage.find(
      (c) => c.ref === "writing-toolkit:identify-ai-tells",
    );
    expect(entry?.kind).toBe("skill");
    expect(entry?.resolved).toBe(true);
  });

  it("notes a built-in slash command rather than a missing skill", async () => {
    const { artifacts, coverage, warnings } = await resolveFixtureSession();
    expect(artifacts.some((a) => a.name === "model")).toBe(false);
    const entry = coverage.find((c) => c.ref === "model");
    expect(entry?.kind).toBe("slash-command");
    expect(entry?.resolved).toBe(false);
    expect(entry?.note).toContain("built-in");
    // The whole point: it must not be reported as a skill that went missing.
    expect(coverage.some((c) => c.ref === "model" && c.kind === "skill")).toBe(
      false,
    );
    expect(warnings.some((w) => w.includes("model"))).toBe(false);
  });

  it("resolves a plugin slash command from the user plugin store", async () => {
    const { artifacts } = await resolveArtifacts(
      emptyTrace({
        skillInvocations: [
          {
            name: "writing-toolkit:polish-prose",
            via: "command-injection",
            index: 0,
          },
        ],
      }),
      { env: { MOOSE_TRACEVALS_HOME: fixtureHome } },
    );
    const command = artifacts.find(
      (a) => a.name === "writing-toolkit:polish-prose",
    );
    expect(command?.type).toBe("slash-command");
    expect(command?.origin).toBe("plugin");
  });

  it("keeps the whole remainder of a plugin reference as the short name", async () => {
    // `split(":", 2)` discards everything past the second field, so
    // `plugin:release:tag` looked for a skill named `release`. The plugin
    // namespace is the part before the first colon; the rest is the name.
    const { coverage } = await resolveArtifacts(
      emptyTrace({
        skillInvocations: [
          {
            name: "writing-toolkit:deep:nested",
            via: "skill-tool",
            index: 0,
          },
        ],
      }),
      { env: { MOOSE_TRACEVALS_HOME: fixtureHome } },
    );
    const entry = coverage.find((c) => c.ref === "writing-toolkit:deep:nested");
    expect(entry?.resolved).toBe(false);
    // Truncation shows up as a lookup for the *wrong* name: the store is
    // searched for `deep` rather than for `deep:nested`.
    expect(
      entry?.tried.some((t) => /deep:nested[\\/]SKILL\.md$/.test(t)),
      `tried: ${entry?.tried.join(" | ") ?? "(no entry)"}`,
    ).toBe(true);
  });

  it("matches a plugin name as a path segment, not a substring", async () => {
    // `path.includes(pluginName)` matched any absolute path containing the
    // name — another plugin's directory, or a Windows home like C:\Users\docs.
    const { coverage, artifacts } = await resolveArtifacts(
      emptyTrace({
        skillInvocations: [
          // `identify-ai-tells` really exists, but under `writing-toolkit`.
          { name: "toolkit:identify-ai-tells", via: "skill-tool", index: 0 },
        ],
      }),
      { env: { MOOSE_TRACEVALS_HOME: fixtureHome } },
    );
    expect(
      artifacts.some((a) => a.name === "toolkit:identify-ai-tells"),
      "a substring match claimed another plugin's skill",
    ).toBe(false);
    expect(
      coverage.find((c) => c.ref === "toolkit:identify-ai-tells")?.resolved,
    ).toBe(false);
  });

  it("matches a plugin command by segment too", async () => {
    const { artifacts } = await resolveArtifacts(
      emptyTrace({
        skillInvocations: [
          { name: "toolkit:polish-prose", via: "command-injection", index: 0 },
        ],
      }),
      { env: { MOOSE_TRACEVALS_HOME: fixtureHome } },
    );
    expect(artifacts.some((a) => a.name === "toolkit:polish-prose")).toBe(false);
  });

  it("resolves project rules at the project dir", async () => {
    const { artifacts } = await resolveFixtureSession();
    const rules = artifacts.filter((a) => a.type === "project-rules");
    const names = rules.map((r) => r.name);
    expect(names).toContain("CLAUDE.md");
    expect(names).toContain("AGENTS.md");
  });

  it("finds project rules from a nested cwd by walking to the project root", async () => {
    const { artifacts } = await resolveArtifacts(emptyTrace({ cwd: nestedDir }), {
      projectRoot: fixtureProject,
      env: { MOOSE_TRACEVALS_HOME: fixtureHome },
    });
    const rules = artifacts.filter((a) => a.type === "project-rules");
    expect(rules.some((r) => r.name === "CLAUDE.md")).toBe(true);
  });

  it("degrades unresolved refs to coverage entries and warnings", async () => {
    const { artifacts, coverage, warnings } = await resolveArtifacts(
      emptyTrace({
        skillInvocations: [
          { name: "ghost-skill", via: "skill-tool", index: 0 },
        ],
      }),
      { env: { MOOSE_TRACEVALS_HOME: fixtureHome } },
    );
    expect(artifacts.some((a) => a.name === "ghost-skill")).toBe(false);
    const entry = coverage.find((c) => c.ref === "ghost-skill");
    expect(entry?.resolved).toBe(false);
    expect(entry?.tried.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("ghost-skill"))).toBe(true);
  });

  it("dedupes artifacts resolved through multiple refs", async () => {
    const trace = emptyTrace({
      skillInvocations: [
        { name: "fix-bug", via: "skill-tool", index: 0 },
        { name: "fix-bug", via: "command-injection", index: 1 },
      ],
    });
    const { artifacts } = await resolveArtifacts(trace, {
      env: { MOOSE_TRACEVALS_HOME: fixtureHome },
    });
    expect(artifacts.filter((a) => a.name === "fix-bug")).toHaveLength(1);
  });
});

describe("artifact staleness", () => {
  let dir: string;

  beforeEach(async () => {
    // .tmp/ is gitignored, so a fresh checkout won't have it yet.
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "stale-"));
    await writeFile(join(dir, "CLAUDE.md"), "# Rules\n", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Pin the rules file's mtime so the comparison has a fixed ground. */
  async function touchRules(iso: string): Promise<void> {
    const when = new Date(iso);
    await utimes(join(dir, "CLAUDE.md"), when, when);
  }

  function traceEnding(endedAt?: string) {
    return emptyTrace({
      cwd: dir,
      ...(endedAt !== undefined ? { endedAt } : {}),
    });
  }

  it("flags an artifact edited after the session ended", async () => {
    await touchRules("2026-07-01T00:00:00.000Z");
    const { coverage, warnings } = await resolveArtifacts(
      traceEnding("2026-06-01T00:00:00.000Z"),
      { projectDir: dir, projectRoot: dir, env: {} },
    );
    const rules = coverage.find((c) => c.kind === "project-rules");
    expect(rules?.stale).toBe(true);
    expect(rules?.modifiedAt).toBe("2026-07-01T00:00:00.000Z");
    expect(
      warnings.some((w) => /modified after the session ended/.test(w)),
    ).toBe(true);
  });

  it("leaves an artifact older than the session alone", async () => {
    await touchRules("2026-05-01T00:00:00.000Z");
    const { coverage, warnings } = await resolveArtifacts(
      traceEnding("2026-06-01T00:00:00.000Z"),
      { projectDir: dir, projectRoot: dir, env: {} },
    );
    expect(coverage.find((c) => c.kind === "project-rules")?.stale).toBe(false);
    expect(warnings).toHaveLength(0);
  });

  it("says nothing when the trace has no end timestamp", async () => {
    await touchRules("2099-01-01T00:00:00.000Z");
    const { coverage, warnings } = await resolveArtifacts(traceEnding(), {
      projectDir: dir,
      projectRoot: dir,
      env: {},
    });
    // Without a session end there is nothing to compare against, and guessing
    // would manufacture a warning out of no evidence.
    expect(coverage.find((c) => c.kind === "project-rules")?.stale).toBe(
      undefined,
    );
    expect(warnings).toHaveLength(0);
  });

  it("is a warning only — it never becomes an eval outcome or an exit code", async () => {
    await touchRules("2099-01-01T00:00:00.000Z");
    const resolved = await resolveArtifacts(
      traceEnding("2026-06-01T00:00:00.000Z"),
      { projectDir: dir, projectRoot: dir, env: {} },
    );
    // The artifact still resolves and still carries its content: staleness
    // changes what the report says, never what gets graded.
    expect(resolved.artifacts).toHaveLength(1);
    expect(resolved.artifacts[0]?.content).toContain("# Rules");
    expect(resolved.coverage.find((c) => c.kind === "project-rules")?.resolved).toBe(
      true,
    );
  });
});

describe("artifact staleness with a session manifest", () => {
  let dir: string;

  beforeEach(async () => {
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "manifest-"));
    await writeFile(join(dir, "CLAUDE.md"), "# Rules\n", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A manifest captured against the rules file as it stands right now. */
  async function capture(): Promise<SessionManifest> {
    return buildManifest({ sessionId: "s1", root: dir });
  }

  function traceEnding(endedAt?: string) {
    return emptyTrace({
      cwd: dir,
      sessionId: "s1",
      ...(endedAt !== undefined ? { endedAt } : {}),
    });
  }

  async function resolveWith(manifest?: SessionManifest, endedAt?: string) {
    return resolveArtifacts(traceEnding(endedAt), {
      projectDir: dir,
      projectRoot: dir,
      env: {},
      ...(manifest !== undefined ? { manifest } : {}),
    });
  }

  it("reports the hash check as skipped, with a reason, when there is no manifest", async () => {
    const { coverage } = await resolveWith(
      undefined,
      "2026-06-01T00:00:00.000Z",
    );
    const rules = coverage.find((c) => c.kind === "project-rules");
    expect(rules?.contentCheck?.status).toBe("skipped");
    expect(rules?.contentCheck?.reason).toMatch(/manifest/i);
  });

  it("clears the mtime guess when the content is provably unchanged", async () => {
    const manifest = await capture();
    // A checkout rewrites every mtime, which is exactly the CI false positive
    // ADR 01021 accepted. The manifest answers mtime's own question exactly.
    const future = new Date("2099-01-01T00:00:00.000Z");
    await utimes(join(dir, "CLAUDE.md"), future, future);
    const { coverage, warnings } = await resolveWith(
      manifest,
      "2026-06-01T00:00:00.000Z",
    );
    const rules = coverage.find((c) => c.kind === "project-rules");
    expect(rules?.contentCheck?.status).toBe("match");
    expect(rules?.stale).toBe(false);
    // The observation itself is never hidden — only the conclusion changes.
    expect(rules?.modifiedAt).toBe("2099-01-01T00:00:00.000Z");
    expect(warnings.some((w) => /modified after the session ended/.test(w))).toBe(
      false,
    );
  });

  it("flags an exact mismatch even when mtime says the file is older", async () => {
    const manifest = await capture();
    await writeFile(join(dir, "CLAUDE.md"), "# Rules, rewritten\n", "utf-8");
    const past = new Date("2020-01-01T00:00:00.000Z");
    await utimes(join(dir, "CLAUDE.md"), past, past);
    const { coverage, warnings } = await resolveWith(
      manifest,
      "2026-06-01T00:00:00.000Z",
    );
    const rules = coverage.find((c) => c.kind === "project-rules");
    expect(rules?.contentCheck?.status).toBe("mismatch");
    expect(rules?.stale).toBe(true);
    expect(warnings.some((w) => /changed since the session started/.test(w))).toBe(
      true,
    );
  });

  it("compares content even when the trace records no end time", async () => {
    const manifest = await capture();
    await writeFile(join(dir, "CLAUDE.md"), "# Different\n", "utf-8");
    const { coverage } = await resolveWith(manifest);
    const rules = coverage.find((c) => c.kind === "project-rules");
    expect(rules?.contentCheck?.status).toBe("mismatch");
    expect(rules?.stale).toBe(true);
  });

  it("falls back to the mtime heuristic for an artifact the manifest never recorded", async () => {
    const manifest = await capture();
    // Recorded before this file existed, so the manifest can say nothing.
    await writeFile(join(dir, "AGENTS.md"), "# Extra\n", "utf-8");
    const future = new Date("2099-01-01T00:00:00.000Z");
    await utimes(join(dir, "AGENTS.md"), future, future);
    const { coverage, warnings } = await resolveWith(
      manifest,
      "2026-06-01T00:00:00.000Z",
    );
    const rules = coverage.find((c) => c.kind === "project-rules");
    expect(rules?.contentCheck?.status).toBe("skipped");
    expect(rules?.stale).toBe(true);
    expect(warnings.some((w) => /mtime is a heuristic/.test(w))).toBe(true);
  });

  it("never lets a manifest reach an eval — the artifact resolves either way", async () => {
    const manifest = await capture();
    await writeFile(join(dir, "CLAUDE.md"), "# Rewritten\n", "utf-8");
    const resolved = await resolveWith(manifest, "2026-06-01T00:00:00.000Z");
    expect(resolved.artifacts).toHaveLength(1);
    expect(resolved.artifacts[0]?.content).toContain("# Rewritten");
    expect(
      resolved.coverage.find((c) => c.kind === "project-rules")?.resolved,
    ).toBe(true);
  });

  it("joins when the session cwd is below the git root", async () => {
    // The monorepo case: `capture` runs at the session's cwd, while `run`
    // without `--project` keys on the *git root*. Two different bases produce
    // two different relative paths for one file, so every hash check silently
    // degraded to `skipped` — which is exactly the outcome a manifest exists
    // to remove.
    const app = join(dir, "app");
    await mkdir(app, { recursive: true });
    await writeFile(join(app, "CLAUDE.md"), "# App rules\n", "utf-8");
    // One rules file, so the row is about the join and nothing else.
    await rm(join(dir, "CLAUDE.md"));
    const manifest = await buildManifest({ sessionId: "s1", root: app });
    expect(manifest.artifacts.map((a) => a.path)).toContain("CLAUDE.md");

    const { coverage, warnings } = await resolveArtifacts(
      emptyTrace({ cwd: app, sessionId: "s1" }),
      { projectDir: app, projectRoot: dir, env: {}, manifest },
    );
    const rules = coverage.find((c) => c.kind === "project-rules");
    expect(rules?.contentCheck?.status).toBe("match");
    expect(warnings.some((w) => /manifest/i.test(w) && /no/i.test(w))).toBe(
      false,
    );
  });

  it("says so once when a manifest joins nothing at all", async () => {
    // Row-by-row degradation reads as "nothing recorded here", which is the
    // same sentence a manifest for a different tree produces. Say it once,
    // loudly, instead.
    const manifest = await capture();
    const foreign: SessionManifest = {
      ...manifest,
      artifacts: [
        {
          name: "CLAUDE.md",
          type: "project-rules",
          path: "somewhere/else/CLAUDE.md",
          sha256: "0".repeat(64),
          bytes: 1,
        },
      ],
    };
    const { warnings } = await resolveWith(foreign, "2026-06-01T00:00:00.000Z");
    expect(
      warnings.some((w) => /manifest/i.test(w) && /no artifact/i.test(w)),
      `warnings were: ${warnings.join(" | ")}`,
    ).toBe(true);
  });
});
