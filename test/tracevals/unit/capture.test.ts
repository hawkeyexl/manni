import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MANIFEST_VERSION,
  checkContent,
  findManifest,
  manifestPathFor,
  readManifest,
  writeManifest,
  type SessionManifest,
} from "../../../src/tracevals/capture/manifest.js";
import { buildManifest } from "../../../src/tracevals/capture/build.js";
import { parseHookPayload, readStdin } from "../../../src/tracevals/capture/hook.js";
import { runCapture } from "../../../src/tracevals/commands/capture.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

// ── The hook envelope ────────────────────────────────────────────

describe("parseHookPayload", () => {
  it("reads the four fields Claude Code documents on every hook input", () => {
    const payload = parseHookPayload(
      JSON.stringify({
        session_id: "abc123",
        transcript_path: "/home/u/.claude/projects/x/abc123.jsonl",
        cwd: "/home/u/proj",
        hook_event_name: "SessionStart",
        permission_mode: "default",
      }),
    );
    expect(payload.sessionId).toBe("abc123");
    expect(payload.transcriptPath).toBe(
      "/home/u/.claude/projects/x/abc123.jsonl",
    );
    expect(payload.cwd).toBe("/home/u/proj");
    expect(payload.hookEvent).toBe("SessionStart");
  });

  // The docs name this field two ways across versions, so nothing may depend
  // on one spelling. It is provenance, never a key.
  it.each([
    ["how", "startup"],
    ["source", "resume"],
    ["reason", "clear"],
    ["why", "logout"],
  ])("records the start/end reason spelled %s", (key, value) => {
    const payload = parseHookPayload(
      JSON.stringify({ session_id: "s", [key]: value }),
    );
    expect(payload.reason).toBe(value);
  });

  it("tolerates a payload carrying none of the optional members", () => {
    const payload = parseHookPayload(JSON.stringify({ session_id: "s" }));
    expect(payload.sessionId).toBe("s");
    expect(payload.cwd).toBeUndefined();
    expect(payload.reason).toBeUndefined();
  });

  it("rejects text that is not a JSON object", () => {
    expect(() => parseHookPayload("not json")).toThrow(TracevalsError);
    expect(() => parseHookPayload("[1,2]")).toThrow(TracevalsError);
    expect(() => parseHookPayload("null")).toThrow(TracevalsError);
  });

  it("ignores members whose type is wrong rather than trusting them", () => {
    const payload = parseHookPayload(
      JSON.stringify({ session_id: 42, cwd: { nested: true } }),
    );
    expect(payload.sessionId).toBeUndefined();
    expect(payload.cwd).toBeUndefined();
  });
});

describe("readStdin", () => {
  /** A pipe standing in for stdin, so the shape is the real one. */
  function pipe(): PassThrough & { isTTY?: boolean } {
    return new PassThrough();
  }

  it("reads a payload written and closed, the way a hook writes one", async () => {
    const stream = pipe();
    const read = readStdin(stream as unknown as NodeJS.ReadStream);
    stream.end('{"session_id":"s"}');
    expect(await read).toBe('{"session_id":"s"}');
  });

  it("gives up on a stream nobody ever writes to", async () => {
    // The failure this exists for: a script or CI runner that does not redirect
    // stdin hands `capture` an inherited pipe that never emits and never ends.
    // Waiting on it forever is a hang, and it hangs the session's own start.
    const stream = pipe();
    const started = Date.now();
    const out = await readStdin(stream as unknown as NodeJS.ReadStream, {
      timeoutMs: 40,
    });
    expect(out).toBe("");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("returns what arrived when the stream stalls mid-payload", async () => {
    const stream = pipe();
    const read = readStdin(stream as unknown as NodeJS.ReadStream, {
      timeoutMs: 40,
    });
    stream.write("{partial");
    expect(await read).toBe("{partial");
  });

  it("reads nothing from a TTY, where a person is typing", async () => {
    const stream = pipe();
    stream.isTTY = true;
    expect(await readStdin(stream as unknown as NodeJS.ReadStream)).toBe("");
  });

  it("refuses a stream far too large to be a hook envelope", async () => {
    const stream = pipe();
    const read = readStdin(stream as unknown as NodeJS.ReadStream, {
      maxBytes: 16,
    });
    stream.write("x".repeat(64));
    await expect(read).rejects.toThrow(TracevalsError);
  });
});

// ── Building and reading a manifest ──────────────────────────────

describe("buildManifest", () => {
  let dir: string;

  beforeEach(async () => {
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "capture-"));
    await mkdir(join(dir, ".claude", "skills", "demo"), { recursive: true });
    await writeFile(join(dir, "CLAUDE.md"), "# Rules\n", "utf-8");
    await writeFile(
      join(dir, ".claude", "skills", "demo", "SKILL.md"),
      "---\nname: demo\n---\n\n# Demo\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("hashes every instruction artifact in the project", async () => {
    const manifest = await buildManifest({ sessionId: "s1", root: dir });
    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.sessionId).toBe("s1");
    const names = manifest.artifacts.map((a) => a.name).sort();
    expect(names).toEqual(["CLAUDE.md", "demo"]);
    for (const entry of manifest.artifacts) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      // Relative and POSIX, so the manifest survives a checkout somewhere else.
      expect(entry.path.startsWith("/")).toBe(false);
      expect(entry.path).not.toContain("\\");
    }
  });

  it("carries a device identifier that is not the hostname", async () => {
    const manifest = await buildManifest({ sessionId: "s1", root: dir });
    expect(manifest.device.id).toMatch(/^[0-9a-f]{16}$/);
    expect(manifest.device.platform).toBe(process.platform);
  });

  it("records the git SHA when the project is a repository", async () => {
    // The worktree this suite runs in is one, so `.` answers.
    const manifest = await buildManifest({ sessionId: "s1", root: "." });
    expect(manifest.git?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("degrades to no git block outside a repository", async () => {
    const manifest = await buildManifest({ sessionId: "s1", root: dir });
    // A temp dir under .tmp/ is inside this repo, so assert only that the
    // absence path does not throw and the shape stays honest.
    expect(manifest.git === undefined || typeof manifest.git.sha === "string").toBe(
      true,
    );
  });

  it("applies the judge.redact patterns to the config and to the machine's paths", async () => {
    const manifest = await buildManifest({
      sessionId: "s1",
      root: dir,
      redact: ["capture-"],
      config: { note: "a capture-secret value", plugins: ["./capture-plugin.mjs"] },
    });
    expect(JSON.stringify(manifest.config)).toContain("[redacted]");
    expect(JSON.stringify(manifest.config)).not.toContain("capture-secret");
    // `root` is an absolute path on the capturing machine, so it goes through
    // the redactor too. The temp dir is named `capture-…`, which the pattern
    // above matches.
    expect(manifest.root).toContain("[redacted]");
  });

  it("never redacts a join key — that would turn an exact check into a silent skip", async () => {
    const manifest = await buildManifest({
      sessionId: "s1",
      root: dir,
      // Deliberately matches everything a lazier design would have scrubbed.
      redact: ["CLAUDE|SKILL|demo|[0-9a-f]{8}"],
    });
    const rules = manifest.artifacts.find((a) => a.name === "CLAUDE.md");
    expect(rules?.path).toBe("CLAUDE.md");
    expect(rules?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sessionId).toBe("s1");
  });

  it("round-trips through write and read", async () => {
    const manifest = await buildManifest({ sessionId: "s1", root: dir });
    const path = manifestPathFor(join(dir, ".manni/tracevals/sessions"), "s1");
    await writeManifest(path, manifest);
    const back = await readManifest(path);
    expect(back?.sessionId).toBe("s1");
    expect(back?.artifacts).toHaveLength(manifest.artifacts.length);
  });

  it("reads nothing rather than throwing for an absent or corrupt file", async () => {
    expect(await readManifest(join(dir, "nope.json"))).toBeNull();
    await writeFile(join(dir, "bad.json"), "{oops", "utf-8");
    expect(await readManifest(join(dir, "bad.json"))).toBeNull();
  });

  it("refuses a manifest from a newer format version", async () => {
    const path = join(dir, "future.json");
    await writeFile(
      path,
      JSON.stringify({ version: MANIFEST_VERSION + 1, sessionId: "s1", artifacts: [] }),
      "utf-8",
    );
    expect(await readManifest(path)).toBeNull();
  });

  /**
   * A half-read manifest is worse than no manifest. An entry with no `path`, or
   * a `sha256` that is not a string, puts `undefined` — or a number — into the
   * comparison map, and the comparison then reports **`mismatch`**: "this
   * artifact changed since the session", the most alarming thing the feature
   * can say, off nothing but the file's own corruption.
   */
  describe("a malformed artifact entry makes the whole file unusable", () => {
    async function read(artifacts: unknown): Promise<SessionManifest | null> {
      const path = join(dir, "malformed.json");
      await writeFile(
        path,
        JSON.stringify({
          version: MANIFEST_VERSION,
          sessionId: "s1",
          capturedAt: "2026-06-01T00:00:00.000Z",
          hookEvent: "SessionStart",
          root: "/proj",
          device: { id: "0123456789abcdef", platform: "linux" },
          tool: { name: "manni-tracevals", version: "0.0.0" },
          artifacts,
          config: {},
        }),
        "utf-8",
      );
      return readManifest(path);
    }

    const good = {
      name: "CLAUDE.md",
      type: "project-rules",
      path: "CLAUDE.md",
      sha256: "a".repeat(64),
      bytes: 7,
    };

    it.each([
      ["a recorded digest that is not a string", [{ ...good, sha256: 12345 }]],
      ["no recorded digest at all", [{ ...good, sha256: undefined }]],
      ["no path to join on", [{ ...good, path: undefined }]],
      ["an empty path", [{ ...good, path: "" }]],
      ["a name that is not a string", [{ ...good, name: 7 }]],
      ["a byte count that is not a number", [{ ...good, bytes: "7" }]],
      ["an entry that is not an object", ["CLAUDE.md"]],
      ["a null entry", [null]],
      ["one good entry and one bad", [good, { ...good, path: "AGENTS.md", sha256: null }]],
    ])("refuses %s", async (_label, artifacts) => {
      expect(await read(artifacts)).toBeNull();
    });

    it("still reads a well-formed one", async () => {
      const manifest = await read([good]);
      expect(manifest?.artifacts).toHaveLength(1);
      // And the point of the guard: nothing malformed reaches the comparison,
      // so the only `mismatch` it can report is a real one.
      expect(
        checkContent(manifest as SessionManifest, new Map([["CLAUDE.md", "a".repeat(64)]]))
          .status,
      ).toBe("match");
    });
  });

  it("refuses one whose consumed members are the wrong type", async () => {
    // `root` is the base the join is keyed on, and `capturedAt` is printed in
    // the report. Neither is optional, and half a manifest is not evidence.
    for (const bad of [{ root: 42 }, { capturedAt: { when: "then" } }]) {
      const path = join(dir, "wrong-type.json");
      await writeFile(
        path,
        JSON.stringify({
          version: MANIFEST_VERSION,
          sessionId: "s1",
          capturedAt: "2026-06-01T00:00:00.000Z",
          root: "/proj",
          artifacts: [],
          ...bad,
        }),
        "utf-8",
      );
      expect(await readManifest(path)).toBeNull();
    }
  });
});

// ── Comparing content ────────────────────────────────────────────

describe("checkContent", () => {
  const manifest = (): SessionManifest => ({
    version: MANIFEST_VERSION,
    sessionId: "s1",
    capturedAt: "2026-06-01T00:00:00.000Z",
    hookEvent: "SessionStart",
    root: "/proj",
    device: { id: "0123456789abcdef", platform: "linux" },
    tool: { name: "manni-tracevals", version: "0.0.0" },
    artifacts: [
      { name: "CLAUDE.md", type: "project-rules", path: "CLAUDE.md", sha256: "a".repeat(64), bytes: 7 },
    ],
    config: {},
  });

  it("reports skipped with a reason when the manifest has no entry", () => {
    const check = checkContent(manifest(), new Map([["OTHER.md", "b".repeat(64)]]));
    expect(check.status).toBe("skipped");
    expect(check.reason).toMatch(/not recorded/i);
  });

  it("matches when every covered file hashes to what was recorded", () => {
    const check = checkContent(manifest(), new Map([["CLAUDE.md", "a".repeat(64)]]));
    expect(check.status).toBe("match");
    expect(check.expected).toBe("a".repeat(64));
  });

  /**
   * `expected` means "what the manifest claimed" in every branch, so it has to
   * be read off the manifest in every branch. On a match the two digests are
   * equal by construction, which is exactly why the source has to be pinned
   * here rather than left to coincide: nothing else would ever notice.
   */
  it("reports the manifest's own digest as `expected`, not a re-read of the file", () => {
    const recorded = manifest();
    const check = checkContent(
      recorded,
      // A view that answers a *second* traversal differently. The digests are
      // compared during the first one; anything that goes back to `actual` to
      // fill in `expected` is reporting the file, not the manifest.
      shifting("CLAUDE.md", "a".repeat(64), "f".repeat(64)),
    );
    expect(check.status).toBe("match");
    expect(check.expected).toBe(recorded.artifacts[0]?.sha256);
    expect(check.actual).toBe("a".repeat(64));
  });

  it("mismatches when a covered file hashes to something else", () => {
    const check = checkContent(manifest(), new Map([["CLAUDE.md", "c".repeat(64)]]));
    expect(check.status).toBe("mismatch");
    expect(check.expected).toBe("a".repeat(64));
    expect(check.actual).toBe("c".repeat(64));
  });

  it("takes the mismatch when an aggregated entry covers a recorded and an unrecorded file", () => {
    // project-rules aggregates several files: one changed file makes the row
    // changed, whatever the manifest says about the others.
    const check = checkContent(
      manifest(),
      new Map([
        ["CLAUDE.md", "c".repeat(64)],
        ["AGENTS.md", "d".repeat(64)],
      ]),
    );
    expect(check.status).toBe("mismatch");
  });

  it("skips rather than matching when only some covered files were recorded", () => {
    const check = checkContent(
      manifest(),
      new Map([
        ["CLAUDE.md", "a".repeat(64)],
        ["AGENTS.md", "d".repeat(64)],
      ]),
    );
    expect(check.status).toBe("skipped");
  });
});

/**
 * A `ReadonlyMap` whose entries change after the first traversal. It exists to
 * separate "the value the comparison used" from "a value read back out of
 * `actual` afterwards" — two things a single traversal keeps identical, which
 * is why the digest's source cannot be pinned with a plain `Map`.
 */
function shifting(
  key: string,
  first: string,
  later: string,
): ReadonlyMap<string, string> {
  let traversals = 0;
  const snapshot = (): Map<string, string> =>
    new Map([[key, traversals++ === 0 ? first : later]]);
  return {
    size: 1,
    get: (k: string) => (k === key ? first : undefined),
    has: (k: string) => k === key,
    keys: () => snapshot().keys(),
    values: () => snapshot().values(),
    entries: () => snapshot().entries(),
    forEach: (fn: (v: string, k: string, m: ReadonlyMap<string, string>) => void) => {
      snapshot().forEach(fn);
    },
    [Symbol.iterator]: () => snapshot()[Symbol.iterator](),
  };
}

// ── Finding one beside a trace ───────────────────────────────────

describe("findManifest", () => {
  let dir: string;

  beforeEach(async () => {
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "find-"));
    await mkdir(join(dir, "traces"), { recursive: true });
    await writeFile(join(dir, "traces", "t.jsonl"), "{}\n", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function put(path: string, sessionId: string): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    await writeManifest(
      path,
      await buildManifest({ sessionId, root: dir }),
    );
  }

  it("finds nothing when nothing was captured", async () => {
    const found = await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      sessionId: "s1",
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
    });
    expect(found).toBeNull();
  });

  it("finds the canonical one under the project", async () => {
    await put(join(dir, ".manni", "tracevals", "sessions", "s1.json"), "s1");
    const found = await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      sessionId: "s1",
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
    });
    expect(found?.manifest.sessionId).toBe("s1");
  });

  it("prefers one placed deliberately beside the trace", async () => {
    await put(join(dir, ".manni", "tracevals", "sessions", "s1.json"), "s1");
    await put(join(dir, "traces", "t.manifest.json"), "s1");
    const found = await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      sessionId: "s1",
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
    });
    expect(found?.path.endsWith("t.manifest.json")).toBe(true);
  });

  it("refuses a manifest recorded for a different session", async () => {
    await put(join(dir, "traces", "t.manifest.json"), "OTHER");
    const found = await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      sessionId: "s1",
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
    });
    // A claim about another session is not evidence about this one.
    expect(found).toBeNull();
  });

  /**
   * A trace that records no session id — a legacy `claude -p` stream-json
   * transcript with no `system/init` line, say — gives the guard nothing to
   * check against. Discovery is convention, so an unverifiable sibling is a
   * manifest that *may* belong to any session at all; using it is the one way
   * a manifest could produce a confidently wrong answer.
   */
  it("refuses a discovered manifest when the trace records no session id", async () => {
    await put(join(dir, "traces", "t.manifest.json"), "s1");
    const found = await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
    });
    expect(found).toBeNull();
  });

  it("says which manifest it refused and why", async () => {
    await put(join(dir, "traces", "t.manifest.json"), "s1");
    const refused: string[] = [];
    await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
      onRefused: (path, reason) => refused.push(`${path}: ${reason}`),
    });
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatch(/t\.manifest\.json/);
    expect(refused[0]).toMatch(/records no session id/);
  });

  it("reports a foreign session id as the reason it refused", async () => {
    await put(join(dir, "traces", "t.manifest.json"), "OTHER");
    const refused: string[] = [];
    await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      sessionId: "s1",
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
      onRefused: (path, reason) => refused.push(`${path}: ${reason}`),
    });
    expect(refused[0]).toMatch(/recorded for a different session/);
  });

  /**
   * Naming a file is the caller's own assertion that it belongs to this trace,
   * and it is the only assertion available for a format that records no id.
   * Refusing it would make `--manifest` structurally unusable there.
   */
  it("uses an explicitly named manifest when the trace records no session id", async () => {
    await put(join(dir, "named.json"), "s1");
    const found = await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
      explicit: join(dir, "named.json"),
    });
    expect(found?.manifest.sessionId).toBe("s1");
  });

  it("still refuses an explicitly named manifest that contradicts the trace", async () => {
    await put(join(dir, "named.json"), "OTHER");
    const found = await findManifest({
      tracePath: join(dir, "traces", "t.jsonl"),
      sessionId: "s1",
      projectDir: dir,
      captureDir: ".manni/tracevals/sessions",
      explicit: join(dir, "named.json"),
    });
    expect(found).toBeNull();
  });
});

// ── The command ──────────────────────────────────────────────────

describe("runCapture", () => {
  let dir: string;

  beforeEach(async () => {
    await mkdir(".tmp", { recursive: true });
    dir = await mkdtemp(join(".tmp", "cmd-"));
    await writeFile(join(dir, "CLAUDE.md"), "# Rules\n", "utf-8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the manifest the hook payload names", async () => {
    const result = await runCapture({
      stdin: JSON.stringify({
        session_id: "s1",
        cwd: dir,
        hook_event_name: "SessionStart",
        how: "startup",
        transcript_path: "/somewhere/s1.jsonl",
      }),
      configDir: dir,
    });
    expect(result.exitCode).toBe(0);
    const written = JSON.parse(await readFile(result.path, "utf-8"));
    expect(written.sessionId).toBe("s1");
    expect(written.hookEvent).toBe("SessionStart");
    expect(written.reason).toBe("startup");
    expect(result.path.replace(/\\/g, "/")).toContain(
      ".manni/tracevals/sessions/s1.json",
    );
  });

  it("never writes to stdout when it read a hook payload", async () => {
    // SessionStart stdout is injected into the model's context, so a report
    // there would be a side effect on the session being observed.
    const result = await runCapture({
      stdin: JSON.stringify({ session_id: "s1", cwd: dir }),
      configDir: dir,
    });
    expect(result.stdout).toBe("");
    expect(result.rendered).toContain("s1");
  });

  it("renders to stdout for a hand-run invocation", async () => {
    const result = await runCapture({
      stdin: "",
      sessionId: "s2",
      project: dir,
      configDir: dir,
    });
    expect(result.stdout).toContain("s2");
  });

  it("refuses to guess a session id", async () => {
    await expect(runCapture({ stdin: "{}", configDir: dir })).rejects.toThrow(
      TracevalsError,
    );
  });

  it("takes the project from the payload's cwd, not the process", async () => {
    const result = await runCapture({
      stdin: JSON.stringify({ session_id: "s1", cwd: dir }),
      configDir: dir,
    });
    const written = JSON.parse(await readFile(result.path, "utf-8"));
    expect(written.artifacts.map((a: { name: string }) => a.name)).toContain(
      "CLAUDE.md",
    );
  });

  it("writes where --out says, so a manifest can travel beside its trace", async () => {
    const out = join(dir, "traces", "t.manifest.json");
    const result = await runCapture({
      stdin: "",
      sessionId: "s3",
      project: dir,
      out,
      configDir: dir,
    });
    expect(result.path).toBe(out);
    expect(JSON.parse(await readFile(out, "utf-8")).sessionId).toBe("s3");
  });
});
