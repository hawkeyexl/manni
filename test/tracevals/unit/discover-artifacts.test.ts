import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverArtifacts } from "../../../src/tracevals/artifacts/discover.js";

const fixtureProject = fileURLToPath(
  new URL("../fixtures/project", import.meta.url),
);

/** `<type>:<basename>` — stable across OS path separators. */
function ids(artifacts: { artifact: { type: string; path: string } }[]): string[] {
  return artifacts
    .map((a) => `${a.artifact.type}:${a.artifact.path.replace(/\\/g, "/").split("/").pop() ?? ""}`)
    .sort();
}

describe("discoverArtifacts", () => {
  it("finds every artifact in the fixture project and nothing else", async () => {
    const result = await discoverArtifacts({ root: fixtureProject });

    expect(ids(result.artifacts)).toEqual([
      "agent:doc-writer.md",
      "agent:reviewer.md",
      "project-rules:AGENTS.md",
      "project-rules:CLAUDE.md",
      "skill:SKILL.md",
      "slash-command:ship-it.md",
    ]);
    // packages/api/README.md is a doc, not an instruction artifact.
    expect(
      result.artifacts.some((a) => a.artifact.path.endsWith("README.md")),
    ).toBe(false);
  });

  it("reports evals already declared, for dedupe and cache keying", async () => {
    const result = await discoverArtifacts({ root: fixtureProject });
    const skill = result.artifacts.find((a) => a.artifact.type === "skill");

    expect(skill?.status).toBe("ok");
    // fix-bug declares two id'd evals plus one string shorthand.
    expect(skill?.existingNames).toContain("used-read");
    expect(skill?.existingNames).toContain("forbidden-tool");

    const rules = result.artifacts.find((a) =>
      a.artifact.path.endsWith("CLAUDE.md"),
    );
    expect(rules?.status).toBe("ok");
    // CLAUDE.md declares the two conditionally-triggered evals (ADR 01016).
    expect(rules?.existingNames).toEqual([
      "source-edits-use-the-fix-bug-skill",
      "docs-work-uses-the-writing-skill",
    ]);
  });

  describe("in a scratch tree", () => {
    let dir: string;

    beforeAll(async () => {
      await mkdir(".tmp", { recursive: true });
      dir = await mkdtemp(join(".tmp", "discover-"));
      await mkdir(join(dir, ".claude", "skills", "good"), { recursive: true });
      await mkdir(join(dir, ".claude", "skills", "broken"), { recursive: true });
      await mkdir(join(dir, "node_modules", ".claude", "skills", "vendored"), {
        recursive: true,
      });
      await mkdir(join(dir, "agents"), { recursive: true });

      await writeFile(
        join(dir, ".claude", "skills", "good", "SKILL.md"),
        "---\nname: good\n---\nbody\n",
      );
      // Unterminated flow mapping: docmeta's extractFrontmatter throws on this.
      await writeFile(
        join(dir, ".claude", "skills", "broken", "SKILL.md"),
        "---\nname: [unclosed\ndescription: x\n---\nbody\n",
      );
      await writeFile(
        join(dir, "node_modules", ".claude", "skills", "vendored", "SKILL.md"),
        "---\nname: vendored\n---\nbody\n",
      );
      await writeFile(join(dir, "agents", "helper.md"), "---\nname: helper\n---\nx\n");
      await writeFile(join(dir, "GEMINI.md"), "# Gemini rules\n");
    });

    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("contains malformed frontmatter instead of throwing", async () => {
      const result = await discoverArtifacts({ root: dir });
      const broken = result.artifacts.find((a) =>
        a.artifact.path.includes("broken"),
      );
      expect(broken?.status).toBe("unreadable");
      expect(broken?.error).toBeTruthy();

      // A neighbouring good artifact is still discovered.
      expect(
        result.artifacts.find((a) => a.artifact.path.includes("good"))?.status,
      ).toBe("ok");
    });

    it("prunes node_modules", async () => {
      const result = await discoverArtifacts({ root: dir });
      expect(
        result.artifacts.some((a) => a.artifact.path.includes("node_modules")),
      ).toBe(false);
    });

    it("recognizes GEMINI.md and bare agents/ definitions", async () => {
      const result = await discoverArtifacts({ root: dir });
      expect(ids(result.artifacts)).toContain("project-rules:GEMINI.md");
      expect(ids(result.artifacts)).toContain("agent:helper.md");
    });

    it("does not treat prose under any agents/ directory as an agent", async () => {
      // fill writes by default, so an over-broad match would edit unrelated
      // markdown. Only .claude/agents/ and a root-level agents/ count.
      await mkdir(join(dir, "docs", "agents"), { recursive: true });
      await mkdir(join(dir, "vendor", "agents"), { recursive: true });
      await writeFile(
        join(dir, "docs", "agents", "hiring-guide.md"),
        "# Hiring agents\n\nProse about recruiting.\n",
      );
      await writeFile(join(dir, "vendor", "agents", "thing.md"), "# Vendor\n");

      const result = await discoverArtifacts({ root: dir });
      const paths = result.artifacts.map((a) =>
        a.artifact.path.replace(/\\/g, "/"),
      );
      expect(paths.some((p) => p.includes("docs/agents"))).toBe(false);
      expect(paths.some((p) => p.includes("vendor/agents"))).toBe(false);
      // The legitimate ones are still found.
      expect(paths.some((p) => p.endsWith("agents/helper.md"))).toBe(true);
    });

    // `.claude/commands/` is the only place the resolver ever looks, and
    // organizing subdirectories there are still one flat command namespace
    // (ADR 01023).
    it("recognizes .claude/commands at any depth, and nothing else named commands", async () => {
      await mkdir(join(dir, ".claude", "commands", "release"), {
        recursive: true,
      });
      await mkdir(join(dir, "docs", "commands"), { recursive: true });
      await writeFile(
        join(dir, ".claude", "commands", "ship.md"),
        "---\ndescription: ship\n---\nbody\n",
      );
      await writeFile(
        join(dir, ".claude", "commands", "release", "tag.md"),
        "---\ndescription: tag\n---\nbody\n",
      );
      await writeFile(
        join(dir, "docs", "commands", "cli-reference.md"),
        "# CLI reference\n\nProse about commands.\n",
      );

      const result = await discoverArtifacts({ root: dir });
      expect(ids(result.artifacts)).toContain("slash-command:ship.md");
      // A nested command is still invoked by its bare name.
      const nested = result.artifacts.find((a) =>
        a.artifact.path.endsWith("tag.md"),
      );
      expect(nested?.artifact.type).toBe("slash-command");
      expect(nested?.artifact.name).toBe("tag");
      // fill writes by default, so prose under docs/commands/ must stay out.
      expect(
        result.artifacts.some((a) =>
          a.artifact.path.replace(/\\/g, "/").includes("docs/commands"),
        ),
      ).toBe(false);
    });

    it("anchors convention at the scanned directory, not only the root", async () => {
      // `fill packages/api` should treat that package as its own project
      // rather than silently finding nothing.
      const pkg = join(dir, "packages", "api");
      await mkdir(join(pkg, ".claude", "agents"), { recursive: true });
      await writeFile(
        join(pkg, ".claude", "agents", "scoped.md"),
        "---\nname: scoped\n---\nx\n",
      );

      const result = await discoverArtifacts({ root: dir, paths: [pkg] });
      expect(ids(result.artifacts)).toContain("agent:scoped.md");
    });

    it("accepts an explicit file path, bypassing convention", async () => {
      const target = join(dir, ".claude", "skills", "good", "SKILL.md");
      const result = await discoverArtifacts({ root: dir, paths: [target] });
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]?.artifact.type).toBe("skill");
    });
  });
});

/**
 * `isRecognizedSlashCommand` used to take the *first* segment named "commands",
 * so a project holding a top-level `commands/` directory failed its own
 * `at >= 1` check and had every real `.claude/commands/` file rejected. The
 * pair has to be found wherever it sits, not where it first looks like it does.
 */
describe("discoverArtifacts under a directory already named commands", () => {
  let dir: string;

  beforeAll(async () => {
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "discover-commands-"));
    await mkdir(join(dir, "commands", ".claude", "commands"), {
      recursive: true,
    });
    await writeFile(
      join(dir, "commands", ".claude", "commands", "ship.md"),
      "---\ndescription: Ship it.\n---\n\n# Ship\n",
      "utf-8",
    );
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("recognises the command file despite the earlier commands/ segment", async () => {
    const result = await discoverArtifacts({ root: dir });
    expect(ids(result.artifacts)).toEqual(["slash-command:ship.md"]);
  });
});
