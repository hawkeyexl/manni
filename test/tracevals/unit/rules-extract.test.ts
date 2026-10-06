import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, sha256 } from "@hawkeyexl/inference";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RulesCache } from "../../../src/tracevals/rules/cache.js";
import { extractRules, type ExtractSource } from "../../../src/tracevals/rules/extract.js";
import { mockRulesResponse } from "../../../src/tracevals/rules/mock.js";

const content = [
  "# Rules",
  "",
  "- Run npm ci first when working in a worktree.",
  "- Never use red as an accent colour.",
  "- The tool reads config from manni.config.yaml.",
  "",
].join("\n");

const source: ExtractSource = {
  path: "CLAUDE.md",
  format: "markdown",
  content,
  sha256: sha256(content),
};

describe("extractRules", () => {
  it("returns the rules the model proposes, with a valid `when`", async () => {
    const provider = new MockProvider([
      {
        json: {
          rules: [
            {
              id: "run-npm-ci-first",
              text: "Run npm ci first when working in a worktree.",
              when: { "command-matches": "\\bnpm (test|run)\\b" },
            },
            { id: "accent-not-red", text: "Never use red as an accent colour." },
          ],
        },
      },
    ]);
    const out = await extractRules(source, { provider });
    expect(out.cached).toBe(false);
    expect(out.dropped).toEqual([]);
    expect(out.rules.map((r) => r.id)).toEqual(["run-npm-ci-first", "accent-not-red"]);
    expect(out.rules[0]?.when).toEqual({ "command-matches": "\\bnpm (test|run)\\b" });
    // The whole file reached the model.
    expect(provider.requests[0]?.user).toContain("manni.config.yaml");
  });

  it("drops a rule with a bad id, empty text, repeated id or invalid when, and reads an empty when as none", async () => {
    const provider = new MockProvider([
      {
        json: {
          rules: [
            { id: "ok", text: "Do the thing." },
            { id: "Not Kebab", text: "Bad id." },
            { id: "blank", text: "   " },
            { id: "ok", text: "Same id again." },
            { id: "bad-re", text: "Bad regex.", when: { "command-matches": "a(" } },
            { id: "bad-key", text: "Unknown.", when: { "file-acess": "docs/**" } },
            { id: "empty-when", text: "Empty.", when: {} },
          ],
        },
      },
    ]);
    const out = await extractRules(source, { provider });
    // Local models write `"when": {}` for "no condition". It means what an
    // absent `when` means, so the rule is kept and applies to every turn.
    expect(out.rules).toEqual([
      { id: "ok", text: "Do the thing." },
      { id: "empty-when", text: "Empty." },
    ]);
    expect(out.dropped.map((d) => d.id)).toEqual([
      "Not Kebab",
      "blank",
      "ok",
      "bad-re",
      "bad-key",
    ]);
    expect(out.dropped.every((d) => d.reason.length > 0)).toBe(true);
  });

  it("yields an empty list when nothing qualifies", async () => {
    const out = await extractRules(source, {
      provider: new MockProvider([{ json: { rules: [] } }]),
    });
    expect(out).toEqual({ rules: [], cached: false, dropped: [] });
  });

  it("throws when the provider errors, so empty and failed stay distinct", async () => {
    await expect(
      extractRules(source, { provider: new MockProvider([{ error: "boom" }]) }),
    ).rejects.toThrow(/boom/);
  });

  describe("cache", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "manni-tracevals-rules-extract-"));
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("pays once per file version, and shares across paths", async () => {
      const cache = new RulesCache(dir, true);
      const provider = new MockProvider([mockRulesResponse(content)]);
      const first = await extractRules(source, { provider, cache });
      expect(first.cached).toBe(false);
      expect(first.rules).toHaveLength(2);

      const second = await extractRules(
        { ...source, path: "elsewhere/AGENTS.md" },
        { provider, cache },
      );
      expect(second.cached).toBe(true);
      expect(second.rules).toEqual(first.rules);
      expect(provider.requests).toHaveLength(1);
    });

    it("re-asks when the content changes", async () => {
      const cache = new RulesCache(dir, true);
      const provider = new MockProvider([{ json: { rules: [] } }]);
      const edited = "- Keep commits small.\n";
      const out = await extractRules(
        { ...source, content: edited, sha256: sha256(edited) },
        { provider, cache },
      );
      expect(out.cached).toBe(false);
      expect(provider.requests).toHaveLength(1);
    });
  });
});

describe("mockRulesResponse", () => {
  it("derives a rule from each imperative bullet and skips descriptions", () => {
    const { json } = mockRulesResponse(content);
    expect(json.rules).toEqual([
      {
        id: "run-npm-ci-first-when",
        text: "Run npm ci first when working in a worktree.",
      },
      { id: "never-use-red-as-an", text: "Never use red as an accent colour." },
    ]);
  });
});
