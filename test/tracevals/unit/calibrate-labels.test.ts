/**
 * The calibration labels sidecar (ADR 01022).
 *
 * Labels are ground truth, so every way of getting one wrong has to be loud:
 * a silently-dropped label deflates the disagreement count, which is the one
 * number the whole command exists to report.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLabels, parseLabels } from "../../../src/tracevals/calibrate/labels.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

let tmpDir: string;
beforeAll(async () => {
  tmpDir = await mkdtemp(join(".tmp", "labels-"));
});
afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const good = `
version: 1
labels:
  - trace: traces/a.jsonl
    artifact: fix-bug
    eval: forbidden-tool
    expected: fail
    note: The Bash call was git status.
  - trace: traces/b.jsonl
    artifact: CLAUDE.md
    type: project-rules
    eval: eval-1
    expected: pass
`;

describe("parseLabels", () => {
  it("reads every field and resolves trace paths against the labels file", () => {
    const labels = parseLabels(good, join("proj", "tracevals", "labels.yaml"));
    expect(labels).toHaveLength(2);
    expect(labels[0]?.artifact).toBe("fix-bug");
    expect(labels[0]?.eval).toBe("forbidden-tool");
    expect(labels[0]?.expected).toBe("fail");
    expect(labels[0]?.note).toBe("The Bash call was git status.");
    // Relative to the file that declares it, exactly as `plugins` resolves
    // against the config file rather than the working directory.
    expect(labels[0]?.traceFile).toBe(
      join(process.cwd(), "proj", "tracevals", "traces", "a.jsonl"),
    );
    expect(labels[1]?.type).toBe("project-rules");
  });

  it("accepts every artifact type the resolver can produce", () => {
    // `slash-command` is a fourth `ArtifactType` (ADR 01023). Leaving it out of
    // the enum is not a cosmetic gap: `joinLabels` indexes each result under
    // both a typed and an untyped key, and one name can resolve to both a
    // slash command and a skill in one run — so without the disambiguator the
    // label silently joins to whichever was indexed last.
    for (const type of [
      "skill",
      "agent",
      "project-rules",
      "slash-command",
    ] as const) {
      const text = good.replace("type: project-rules", `type: ${type}`);
      expect(parseLabels(text, "labels.yaml")[1]?.type).toBe(type);
    }
  });

  it("rejects an unknown expected outcome", () => {
    const text = good.replace("expected: fail", "expected: maybe");
    expect(() => parseLabels(text, "labels.yaml")).toThrow(TracevalsError);
    expect(() => parseLabels(text, "labels.yaml")).toThrow(/expected/);
  });

  it("rejects an unknown member rather than ignoring it", () => {
    const text = `${good}    reason: typo for note\n`;
    expect(() => parseLabels(text, "labels.yaml")).toThrow(TracevalsError);
  });

  it("rejects a missing version and an unsupported one", () => {
    expect(() => parseLabels("labels: []", "labels.yaml")).toThrow(
      TracevalsError,
    );
    expect(() =>
      parseLabels(good.replace("version: 1", "version: 2"), "labels.yaml"),
    ).toThrow(TracevalsError);
  });

  it("rejects an empty label set — it measures nothing", () => {
    expect(() => parseLabels("version: 1\nlabels: []", "labels.yaml")).toThrow(
      /at least one label/,
    );
  });

  it("rejects two labels for the same trace, artifact, and eval", () => {
    const text = `${good}
  - trace: traces/a.jsonl
    artifact: fix-bug
    eval: forbidden-tool
    expected: pass
`;
    expect(() => parseLabels(text, "labels.yaml")).toThrow(/duplicate label/);
  });

  it("rejects unparseable YAML as an operational error", () => {
    expect(() => parseLabels("version: 1\nlabels: [", "labels.yaml")).toThrow(
      TracevalsError,
    );
  });
});

describe("loadLabels", () => {
  it("reads the file from disk", async () => {
    const file = join(tmpDir, "labels.yaml");
    await writeFile(file, good, "utf-8");
    const labels = await loadLabels(file);
    expect(labels).toHaveLength(2);
  });

  it("names the file it could not read", async () => {
    await expect(loadLabels(join(tmpDir, "nope.yaml"))).rejects.toThrow(
      /nope\.yaml/,
    );
  });
});
