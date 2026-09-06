/**
 * `manni docevals promote` — the most destructive command in the tool and, until
 * now, the only one with no tests. `--write` writes script files, rewrites page
 * frontmatter, *and* rewrites the user's manni.config.yaml.
 *
 * The load-bearing assertion is the repo invariant: script generation must
 * leave the page byte-identical outside the edited frontmatter node.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "@hawkeyexl/inference";
import { runPromote } from "../../../src/docevals/commands/promote.js";

const BODY = [
  "",
  "# Install",
  "",
  "Run this:",
  "",
  "```bash",
  "npm i -g doc-detective",
  "```",
  "",
  "Then verify it.",
  "",
].join("\n");

/** A provider whose every response is the given promote assessment. */
function promoter(json: Record<string, unknown>): MockProvider {
  return new MockProvider([{ json }]);
}

interface ScaffoldOptions {
  /** Extra config body lines, e.g. a config-defined eval. */
  configEvals?: string[];
  /** Page frontmatter lines under `evals:`. */
  pageEvals?: string[];
  eol?: "\n" | "\r\n";
}

function scaffold(opts: ScaffoldOptions = {}): string {
  const eol = opts.eol ?? "\n";
  const root = mkdtempSync(join(tmpdir(), "manni-docevals-promote-"));
  mkdirSync(join(root, "docs"), { recursive: true });

  const page = [
    "---",
    "title: Install",
    "evals:",
    ...(opts.pageEvals ?? [
      "  - id: shows-install-command",
      "    assertion: The page contains a bash code block with the install command.",
      "    grader: ai",
    ]),
    "---",
    // BODY is authored with LF, so re-split it to the requested ending rather
    // than producing a mixed-ending fixture that tests itself.
    ...BODY.split("\n"),
  ].join(eol);
  writeFileSync(join(root, "docs", "install.md"), page);

  writeFileSync(
    join(root, "manni.config.yaml"),
    [
      "docevals:",
      "  version: 1",
      "  files:",
      '    include: ["docs/**/*.md"]',
      ...(opts.configEvals ?? []),
      "",
    ].join("\n"),
  );
  return root;
}

const pagePath = (root: string) => join(root, "docs", "install.md");

describe("runPromote", () => {
  it("keeps an eval on the judge when the assessment says it is not promotable", async () => {
    const root = scaffold();
    const before = readFileSync(pagePath(root), "utf8");

    const proposals = await runPromote([], {
      cwd: root,
      write: true,
      providerInstance: promoter({
        promotable: false,
        rationale: "Requires reading the prose for meaning.",
      }),
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      evalName: "shows-install-command",
      source: "page",
      promotable: false,
      applied: false,
    });
    // Not promotable means nothing is written, even under --write.
    expect(readFileSync(pagePath(root), "utf8")).toBe(before);
  });

  it("reports a promotable eval without touching anything until --write", async () => {
    const root = scaffold();
    const before = readFileSync(pagePath(root), "utf8");

    const proposals = await runPromote([], {
      cwd: root,
      providerInstance: promoter({
        promotable: true,
        rationale: "A regex over fenced code blocks is enough.",
        code: "process.exit(0);\n",
      }),
    });

    expect(proposals[0]?.promotable).toBe(true);
    expect(proposals[0]?.applied).toBe(false);
    expect(proposals[0]?.scriptPath).toBeUndefined();
    expect(readFileSync(pagePath(root), "utf8")).toBe(before);
  });

  it("writes the script and rewrites only the eval's frontmatter node", async () => {
    const root = scaffold();
    const before = readFileSync(pagePath(root), "utf8");

    const proposals = await runPromote([], {
      cwd: root,
      write: true,
      providerInstance: promoter({
        promotable: true,
        rationale: "Deterministic.",
        code: "process.exit(0);\n",
      }),
    });

    const proposal = proposals[0]!;
    expect(proposal.applied).toBe(true);
    expect(proposal.scriptPath).toBeDefined();
    expect(existsSync(join(root, proposal.scriptPath!))).toBe(true);

    const after = readFileSync(pagePath(root), "utf8");
    expect(after).not.toBe(before);
    // The invariant: everything outside the frontmatter block is untouched.
    const body = (s: string) => s.slice(s.indexOf("---", 3) + 3);
    expect(body(after)).toBe(body(before));
    expect(after).toContain("grader: command");
  });

  it("preserves CRLF line endings when it rewrites a page", async () => {
    const root = scaffold({ eol: "\r\n" });
    await runPromote([], {
      cwd: root,
      write: true,
      providerInstance: promoter({
        promotable: true,
        rationale: "Deterministic.",
        code: "process.exit(0);\n",
      }),
    });
    const after = readFileSync(pagePath(root), "utf8");
    expect(after).toContain("\r\n");
    // No line ending was silently normalized to LF on the way through.
    expect(after.split("\n").filter((l) => l !== "" && !l.endsWith("\r"))).toHaveLength(0);
  });

  it("rewrites a config-defined eval in the config, not the page", async () => {
    const root = scaffold({
      pageEvals: ["  - use: no-future-promises"],
      configEvals: [
        "  evals:",
        "    no-future-promises:",
        "      assertion: The page names only shipped behavior.",
        "      grader: ai",
      ],
    });
    const pageBefore = readFileSync(pagePath(root), "utf8");

    const proposals = await runPromote([], {
      cwd: root,
      write: true,
      providerInstance: promoter({
        promotable: true,
        rationale: "Deterministic.",
        code: "process.exit(0);\n",
      }),
    });

    expect(proposals[0]?.source).toBe("config");
    expect(proposals[0]?.applied).toBe(true);
    expect(readFileSync(pagePath(root), "utf8")).toBe(pageBefore);
    expect(readFileSync(join(root, "manni.config.yaml"), "utf8")).toContain(
      "grader: command",
    );
  });

  it("assesses a config-defined eval once, not once per page using it", async () => {
    const root = scaffold({
      pageEvals: ["  - use: no-future-promises"],
      configEvals: [
        "  evals:",
        "    no-future-promises:",
        "      assertion: The page names only shipped behavior.",
        "      grader: ai",
      ],
    });
    writeFileSync(
      join(root, "docs", "second.md"),
      ["---", "title: Second", "evals:", "  - use: no-future-promises", "---", BODY].join("\n"),
    );

    const provider = promoter({ promotable: false, rationale: "Semantic." });
    const proposals = await runPromote([], { cwd: root, providerInstance: provider });

    expect(proposals).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
  });

  it("records an assessment failure as not promotable rather than throwing", async () => {
    const root = scaffold();
    const provider = new MockProvider([{ error: "upstream exploded" }]);

    const proposals = await runPromote([], { cwd: root, providerInstance: provider });
    expect(proposals[0]?.promotable).toBe(false);
    expect(proposals[0]?.rationale).toMatch(/assessment failed/);
  });

  // `promote` built a provider before looking at whether it had anything to
  // assess, so a corpus with no ai evals demanded an API key to be told there
  // was nothing to do. `fill` already resolves identity lazily for the same
  // reason.
  it("needs no provider when nothing is ai-graded", async () => {
    const root = scaffold({
      pageEvals: [
        "  - id: fresh-enough",
        "    assertion: The page was reviewed recently.",
        "    grader: tool:freshness",
      ],
    });
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    await expect(runPromote([], { cwd: root })).resolves.toEqual([]);
  });
});

describe("runPromote: the promoted eval must be able to go stale", () => {
  // The updates object carried the pre-1.0 `generated: { assertionHash }`
  // wrapper, which applyUpdates does not read, so a promoted eval was written
  // with no hash — and both staleness checks require one. Editing the
  // assertion afterwards never marked the script stale, and `generate`
  // reported nothing to do.
  it("writes generated-assertion-hash beside the command", async () => {
    const root = scaffold();
    await runPromote([], {
      cwd: root,
      write: true,
      providerInstance: promoter({
        promotable: true,
        rationale: "Deterministic.",
        code: "process.exit(0);\n",
      }),
    });
    const after = readFileSync(pagePath(root), "utf8");
    expect(after).toContain("grader: command");
    expect(after).toContain("generated-assertion-hash");
    expect(after).not.toContain("assertionHash");
  });
});
