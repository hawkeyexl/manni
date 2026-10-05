/**
 * A subagent's `agent-<id>.meta.json` must be a JSON object. An array is
 * `typeof "object"` too, so it slipped past the guard, merged with every
 * member undefined, and the "not an object" warning never fired.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseTraceFile } from "../../../src/tracevals/trace/claude.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "manni-tracevals-sidecar-shape-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const line = (record: unknown): string => `${JSON.stringify(record)}\n`;

async function writeSession(meta: string): Promise<string> {
  const session = join(dir, "session.jsonl");
  await writeFile(
    session,
    line({
      parentUuid: null,
      isSidechain: false,
      uuid: "u1",
      timestamp: "2026-08-20T09:59:00.000Z",
      sessionId: "44444444-4444-4444-4444-444444444444",
      cwd: "/work/demo-project",
      type: "user",
      message: { role: "user", content: "go" },
    }),
    "utf-8",
  );
  const subagents = join(dir, "session", "subagents");
  await mkdir(subagents, { recursive: true });
  await writeFile(join(subagents, "agent-shape.meta.json"), meta, "utf-8");
  await writeFile(
    join(subagents, "agent-shape.jsonl"),
    line({
      parentUuid: null,
      isSidechain: true,
      uuid: "s1",
      timestamp: "2026-08-20T10:00:00.000Z",
      sessionId: "44444444-4444-4444-4444-444444444444",
      cwd: "/work/demo-project",
      type: "user",
      message: { role: "user", content: "survey" },
    }),
    "utf-8",
  );
  return session;
}

const NOT_AN_OBJECT =
  "subagent metadata agent-shape.meta.json is unreadable or not an object, " +
  "so that branch was not merged";

describe("subagent metadata shape", () => {
  it("refuses a meta file that is a JSON array", async () => {
    const trace = await parseTraceFile(await writeSession("[]"));
    expect(trace.warnings).toContain(NOT_AN_OBJECT);
  });

  it("refuses a meta file that is JSON null", async () => {
    const trace = await parseTraceFile(await writeSession("null"));
    expect(trace.warnings).toContain(NOT_AN_OBJECT);
  });
});
