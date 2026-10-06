import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, sha256 } from "@hawkeyexl/inference";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RulesCache } from "../../../src/tracevals/rules/cache.js";
import { extractRules, type ExtractSource } from "../../../src/tracevals/rules/extract.js";
import { mockRequestsResponse, mockRulesResponse } from "../../../src/tracevals/rules/mock.js";
import { RULES_SYSTEM_PROMPT } from "../../../src/tracevals/rules/prompt.js";
import { REQUIREMENTS_SYSTEM_PROMPT } from "../../../src/tracevals/rules/requests-prompt.js";

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

describe("what the session was asked (proposal 0080)", () => {
  const tasks = "- [x] T014 Write the reset-password test.\n";
  const spec: ExtractSource = {
    path: "specs/001-login/tasks.md",
    format: "speckit-spec",
    content: tasks,
    sha256: sha256(tasks),
  };

  it("reads a request format with the requirements prompt, and a rule file with the rules prompt", async () => {
    const asked = new MockProvider([{ json: { rules: [] } }]);
    await extractRules(spec, { provider: asked });
    expect(asked.requests[0]?.system).toBe(REQUIREMENTS_SYSTEM_PROMPT);
    expect(asked.requests[0]?.user).toContain("format: speckit-spec");

    const governed = new MockProvider([{ json: { rules: [] } }]);
    await extractRules(source, { provider: governed });
    expect(governed.requests[0]?.system).toBe(RULES_SYSTEM_PROMPT);
  });

  it("keeps a spec's own ids as written, and still drops one that is no id", async () => {
    const provider = new MockProvider([
      {
        json: {
          rules: [
            { id: "T014", text: "Write the reset-password test." },
            { id: "FR-001", text: "Let a user reset their password." },
            { id: "1.2", text: "Send the reset link by email." },
            { id: "keep-labels", text: "Keep the login form's labels." },
            { id: "has space", text: "Bad id." },
            { id: "-lead", text: "Bad id." },
          ],
        },
      },
    ]);
    const out = await extractRules(spec, { provider });
    expect(out.rules.map((r) => r.id)).toEqual(["T014", "FR-001", "1.2", "keep-labels"]);
    expect(out.dropped.map((d) => d.id)).toEqual(["has space", "-lead"]);
  });

  it("keeps the two prompts' readings of one content apart in the cache", async () => {
    const dir = await mkdtemp(join(tmpdir(), "manni-tracevals-requests-extract-"));
    try {
      const cache = new RulesCache(dir, true);
      const provider = new MockProvider([
        { json: { rules: [{ id: "T014", text: "Write the reset-password test." }] } },
        { json: { rules: [] } },
      ]);
      const asked = await extractRules(spec, { provider, cache });
      const governed = await extractRules({ ...spec, format: "claude-md" }, { provider, cache });
      expect(asked.rules).toHaveLength(1);
      expect(governed.cached).toBe(false);
      expect(governed.rules).toEqual([]);
      expect(provider.requests).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("mockRequestsResponse", () => {
  it("keeps a spec id, reads numbered prompts and ticked tasks, and skips the rest", () => {
    const { json } = mockRequestsResponse(
      [
        "1. Add a reset-password link to the login form.",
        "",
        "2. What does the login page do today?",
        "- [x] T014 Write the reset-password test.",
        "- **FR-001**: Let a user reset their password.",
        "- [ ] 1.2 Send the reset link by email.",
        "The login page is old.",
      ].join("\n"),
    );
    expect(json.rules).toEqual([
      { id: "add-a-reset-password-link", text: "Add a reset-password link to the login form." },
      { id: "T014", text: "Write the reset-password test." },
      { id: "FR-001", text: "Let a user reset their password." },
      { id: "1.2", text: "Send the reset link by email." },
    ]);
  });
});
