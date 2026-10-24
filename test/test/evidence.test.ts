import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_DOCS_CHARS,
  MAX_FILE_CHARS,
  MAX_TOOL_RESULT_CHARS,
  MAX_WORKSPACE_CHARS,
  renderEvidence,
  taskBrief,
} from "../../src/test/core/evidence.js";
import { recordedPass, stream, taskRun, type TaskRun } from "./task-run.js";

let run: TaskRun | undefined;
afterEach(() => {
  run?.cleanup();
  run = undefined;
});

/** The section of the evidence under `heading`, up to the next `## `. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\n## ", start + 3);
  return text.slice(start, next === -1 ? undefined : next);
}

describe("renderEvidence on the recorded pass", () => {
  it("lists the start page alone: the reader read workspace files, not other docs", () => {
    run = recordedPass();
    expect(renderEvidence(run.evidence).docs).toEqual(["meta/fix/index.mdx"]);
  });

  it("renders user, assistant and tool events, each result joined to its call", () => {
    run = recordedPass();
    const trace = section(renderEvidence(run.evidence).text, "The trace");
    expect(trace).toMatch(/^\[tool\] Read \{"file_path":/m);
    expect(trace).toMatch(/^\[result of Read\] 1\t---/m);
    expect(trace).toMatch(/^\[tool\] Edit \{"replace_all":false,"file_path":/m);
    expect(trace).toMatch(/^\[tool\] Bash \{"command":"[^\n]*npx --yes @hawkeyexl\/manni meta validate/m);
    expect(trace).toMatch(/^\[result of Bash\] /m);
    expect(trace).toMatch(/^\[assistant\] It passes now\./m);
  });

  it("names the workspace's changes and shows each changed text file", () => {
    run = recordedPass();
    const workspace = section(renderEvidence(run.evidence).text, "The workspace");
    expect(workspace).toContain("changed: docs/install.md");
    expect(workspace).not.toContain("added:");
    expect(workspace).toContain("### docs/install.md\n---\ntitle: Install the widget\ndescription:");
    expect(workspace).not.toContain("manni.config.yaml");
  });

  it("shows the start page's copy under the docs", () => {
    run = recordedPass();
    const docs = section(renderEvidence(run.evidence).text, "The docs the reader had");
    expect(docs).toContain("### meta/fix/index.mdx\n---\ntitle: Fix a failing check");
    expect(docs).not.toContain("Not opened by the reader");
  });
});

describe("renderEvidence: which docs the reader had", () => {
  it("adds each docs page the reader opened, in order, once, however the path is spelled", () => {
    run = taskRun({
      startPage: "start.md",
      docs: { "start.md": "start page", "guide/a.md": "page a", "guide/b.md": "page b" },
      trace: (long) => {
        // The stream's spelling of the docs copy differs in case from the
        // one the run hands over, as an 8.3 name differs on Windows.
        const docs = process.platform === "win32" ? join(long, "DOCS") : join(long, "docs");
        return [
          stream.init(join(long, "workspace")),
          stream.call("t1", "Read", { file_path: join(docs, "guide", "b.md") }),
          stream.result("t1", "1\tpage b"),
          stream.call("t2", "Read", { file_path: join(docs, "start.md") }),
          stream.result("t2", "1\tstart page"),
          stream.call("t3", "Read", { file_path: join(long, "docs", "guide", "a.md") }),
          stream.result("t3", "1\tpage a"),
          stream.call("t4", "Read", { file_path: join(docs, "guide", "b.md") }),
          stream.result("t4", "1\tpage b"),
          stream.call("t5", "WebFetch", { url: "https://example.com/more", prompt: "read it" }),
          stream.result("t5", [{ type: "text", text: "fetched words" }]),
          stream.call("t6", "Read", { file_path: join(long, "workspace", "notes.md") }),
          stream.result("t6", "not a doc"),
        ];
      },
    });
    const seen = renderEvidence(run.evidence);
    expect(seen.docs).toEqual(["start.md", "guide/b.md", "guide/a.md", "https://example.com/more"]);
    expect(seen.docsText).toContain("### https://example.com/more\nfetched words");
    expect(seen.docsText).toContain("### guide/b.md\npage b");
  });

  it("starts a URL run at the WebFetch result for that URL", () => {
    run = taskRun({
      url: "https://docs.example.com/start",
      trace: (long) => [
        stream.init(join(long, "workspace")),
        stream.call("t1", "WebFetch", { url: "https://docs.example.com/other", prompt: "p" }),
        stream.result("t1", "other page"),
        stream.call("t2", "WebFetch", { url: "https://docs.example.com/start", prompt: "p" }),
        stream.result("t2", "start page"),
      ],
    });
    const seen = renderEvidence(run.evidence);
    expect(seen.docs).toEqual(["https://docs.example.com/start", "https://docs.example.com/other"]);
    expect(seen.docsText.indexOf("start page")).toBeLessThan(seen.docsText.indexOf("other page"));
  });

  it("lists no start page for a URL the reader never fetched", () => {
    run = taskRun({
      url: "https://docs.example.com/start",
      trace: (long) => [stream.init(join(long, "workspace")), stream.say("I gave up.")],
    });
    const seen = renderEvidence(run.evidence);
    expect(seen.docs).toEqual([]);
    expect(seen.docsText).toBe("The reader opened no page of the docs.");
  });
});

describe("renderEvidence: limits", () => {
  it("cuts each tool result to 2,000 characters", () => {
    run = taskRun({
      startPage: "start.md",
      docs: { "start.md": "start" },
      trace: (long) => [
        stream.init(join(long, "workspace")),
        stream.call("t1", "Bash", { command: "cat big" }),
        stream.result("t1", "x".repeat(MAX_TOOL_RESULT_CHARS + 500)),
      ],
    });
    const line = renderEvidence(run.evidence)
      .text.split("\n")
      .find((l) => l.startsWith("[result of Bash]"));
    expect(line).toContain(`${"x".repeat(MAX_TOOL_RESULT_CHARS)} [manni shortened this for the judge; the reader received 500 more characters]`);
    expect(line).not.toContain("x".repeat(MAX_TOOL_RESULT_CHARS + 1));
  });

  it("cuts each file to 4,000 characters and the workspace to 20,000, and skips binaries", () => {
    const big = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`f${String(i)}.txt`, String(i).repeat(MAX_FILE_CHARS + 100)]),
    );
    run = taskRun({
      startPage: "start.md",
      docs: { "start.md": "start" },
      workspace: { ...big, "logo.png": Buffer.from([0x89, 0x50, 0x00, 0x01]) },
      changes: { added: ["logo.png", ...Object.keys(big)] },
      trace: (long) => [stream.init(join(long, "workspace"))],
    });
    const workspace = section(renderEvidence(run.evidence).text, "The workspace");
    expect(workspace).toContain("added: logo.png, f0.txt");
    expect(workspace).not.toContain("### logo.png");
    expect(workspace).toContain(`### f0.txt\n${"0".repeat(MAX_FILE_CHARS)} [manni shortened this for the judge; the reader received 100 more characters]`);
    expect(workspace).toContain(`### f5.txt\n[left out: the workspace's ${String(MAX_WORKSPACE_CHARS)}-character limit is reached]`);
  });

  it("cuts the docs to 40,000 characters, start page first", () => {
    run = taskRun({
      startPage: "start.md",
      docs: { "start.md": "s".repeat(MAX_DOCS_CHARS - 10), "next.md": "n".repeat(100), "last.md": "l" },
      trace: (long) => [
        stream.init(join(long, "workspace")),
        stream.call("t1", "Read", { file_path: join(long, "docs", "next.md") }),
        stream.result("t1", "n"),
        stream.call("t2", "Read", { file_path: join(long, "docs", "last.md") }),
        stream.result("t2", "l"),
      ],
    });
    const seen = renderEvidence(run.evidence);
    expect(seen.docs).toEqual(["start.md", "next.md"]);
    expect(seen.docsText).toContain(`${"n".repeat(10)} [manni shortened this for the judge; the reader received 90 more characters]`);
  });
});

describe("taskBrief", () => {
  it("is the task, the start and a newcomer when the run has no journey or persona", () => {
    run = recordedPass();
    expect(taskBrief(run.evidence)).toBe(
      "Fix the failing docs check.\nStart here: meta/fix/index.mdx\n\n" +
        "The reader: someone new to this product, with the task above and no other context.",
    );
  });

  it("adds the trigger, the success criteria and who the reader plays", () => {
    run = recordedPass({
      task: "Fix a failing metadata check fast",
      journey: {
        id: "t1",
        file: "journeys/t1.md",
        title: "Fix a failing metadata check fast",
        titleLocation: { file: "journeys/t1.md", line: 3 },
        trigger: "The docs check failed.",
        successCriteria: { text: "The check passes.", location: { file: "journeys/t1.md", line: 6 } },
        personas: ["theo"],
        evals: [],
      },
      persona: {
        id: "theo",
        file: "personas/theo.md",
        title: "Theo",
        description: "A contributor fixing a failure",
        proficiency: ["git"],
        prerequisites: [],
        goals: [],
        pains: [],
        constraints: [],
      },
    });
    expect(taskBrief(run.evidence)).toBe(
      [
        "Fix a failing metadata check fast",
        "What started this: The docs check failed.",
        "You're done when: The check passes.",
        "Start here: meta/fix/index.mdx",
        "",
        "The reader: Theo. A contributor fixing a failure",
        "Already good at: git",
      ].join("\n"),
    );
  });
});
