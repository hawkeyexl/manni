import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteError } from "../../src/site/errors.js";
import { runPlan } from "../../src/site/core/run.js";
import type { PlannedStep, Step } from "../../src/site/types.js";

const node = process.execPath;
const cwd = process.cwd();

function planned(step: Step, display = "the child"): PlannedStep {
  return { announce: "", display, notFound: `${display} not found on PATH.`, step };
}

function nodeStep(script: string, display?: string): PlannedStep {
  return planned({ kind: "exec", argv: [node, "-e", script], cwd }, display);
}

let stderr = "";

beforeEach(() => {
  stderr = "";
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("running a plan", () => {
  it("resolves 0 when the child exits 0, after announcing it", async () => {
    const step = { ...nodeStep("process.exit(0)"), announce: "Starlight in docs/. Running x" };
    await expect(runPlan({ steps: [step] })).resolves.toBe(0);
    expect(stderr).toBe("manni: Starlight in docs/. Running x\n");
  });

  it("prints nothing for an empty announce", async () => {
    await runPlan({ steps: [nodeStep("")] });
    expect(stderr).toBe("");
  });

  it("names the command and its code when the final step fails", async () => {
    const run = runPlan({ steps: [nodeStep("process.exit(3)", "npm run build")] });
    await expect(run).rejects.toThrow(SiteError);
    await expect(run).rejects.toThrow("npm run build exited with code 3.");
  });

  it("stops at a failing step before the next one runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-run-"));
    const marker = join(dir, "ran").replaceAll("\\", "/");
    try {
      const run = runPlan({
        steps: [
          nodeStep("process.exit(1)", "npm run build"),
          nodeStep(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`),
        ],
      });
      await expect(run).rejects.toThrow("npm run build exited with code 1.");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the steps in order when each exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manni-run-"));
    const log = join(dir, "log").replaceAll("\\", "/");
    const append = (n: number) =>
      nodeStep(`require("node:fs").appendFileSync(${JSON.stringify(log)}, "${String(n)}")`);
    try {
      await expect(runPlan({ steps: [append(1), append(2)] })).resolves.toBe(0);
      expect(readFileSync(log, "utf8")).toBe("12");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs a shell step through the shell", async () => {
    // `&&` only means something to a shell, on both platforms.
    const command = `"${node}" -e "process.exit(0)" && "${node}" -e "process.exit(4)"`;
    const run = runPlan({ steps: [planned({ kind: "shell", command, cwd }, "pnpm dev")] });
    await expect(run).rejects.toThrow("pnpm dev exited with code 4.");
  });

  it("reports a binary that is not on PATH with the step's own message", async () => {
    const step = planned(
      { kind: "exec", argv: ["manni-no-such-binary-3f9c", "dev"], cwd },
      "mint dev",
    );
    const run = runPlan({ steps: [step] });
    await expect(run).rejects.toThrow(SiteError);
    await expect(run).rejects.toThrow("mint dev not found on PATH.");
  });

  it("treats the final step's exit after SIGINT as a clean stop", async () => {
    // The terminal delivers Ctrl-C to the child itself; the parent only waits.
    const run = runPlan({ steps: [nodeStep("setTimeout(() => process.exit(130), 1500)")] });
    await new Promise((done) => setTimeout(done, 300));
    process.emit("SIGINT");
    await expect(run).resolves.toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(0);
  });

  it("forwards SIGTERM to the final step and resolves 0", async () => {
    const run = runPlan({ steps: [nodeStep("setInterval(() => {}, 1000)")] });
    await new Promise((done) => setTimeout(done, 300));
    process.emit("SIGTERM");
    await expect(run).resolves.toBe(0);
    expect(process.listenerCount("SIGTERM")).toBe(0);
  });

  it("forwards SIGTERM during the build and runs no later step", async () => {
    const marker = join(tmpdir(), `manni-run-${String(process.pid)}-never`);
    const run = runPlan({
      steps: [
        nodeStep("setInterval(() => {}, 1000)", "npm run build"),
        nodeStep(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`),
      ],
    });
    await new Promise((done) => setTimeout(done, 300));
    process.emit("SIGTERM");
    await expect(run).resolves.toBe(0);
    expect(existsSync(marker)).toBe(false);
    expect(process.listenerCount("SIGTERM")).toBe(0);
  });

  it.skipIf(process.platform === "win32")(
    "names the signal when the child is killed by one we did not send",
    async () => {
      const run = runPlan({
        steps: [nodeStep('process.kill(process.pid, "SIGKILL")', "mkdocs serve")],
      });
      await expect(run).rejects.toThrow("mkdocs serve was stopped by SIGKILL.");
    },
  );
});

describe("finding a binary on PATH", () => {
  let dir = "";
  let path: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "manni run "));
    path = process.env["PATH"];
    process.env["PATH"] = `${dir}${delimiter}${path ?? ""}`;
  });

  afterEach(() => {
    process.env["PATH"] = path;
    rmSync(dir, { recursive: true, force: true });
  });

  // npm, astro and most Node CLIs are `.cmd` shims on Windows, which Node will
  // not start without cmd.exe. The directory has a space in it, so the
  // launcher's own path has to survive the quoting.
  it.skipIf(process.platform !== "win32")(
    "finds a .cmd through PATHEXT and starts it through cmd.exe, quoted",
    async () => {
      writeFileSync(join(dir, "exit-with.cmd"), "@exit /b %~1\r\n");
      await expect(
        runPlan({ steps: [planned({ kind: "exec", argv: ["exit-with", "0"], cwd })] }),
      ).resolves.toBe(0);
      await expect(
        runPlan({
          steps: [planned({ kind: "exec", argv: ["exit-with", "5"], cwd }, "exit-with 5")],
        }),
      ).rejects.toThrow("exit-with 5 exited with code 5.");
    },
  );

  it.skipIf(process.platform === "win32")("finds an executable script", async () => {
    const script = join(dir, "exit-with");
    writeFileSync(script, '#!/bin/sh\nexit "$1"\n');
    chmodSync(script, 0o755);
    await expect(
      runPlan({ steps: [planned({ kind: "exec", argv: ["exit-with", "0"], cwd })] }),
    ).resolves.toBe(0);
  });

  it.skipIf(process.platform === "win32")("skips a file that is not executable", async () => {
    writeFileSync(join(dir, "not-executable"), "#!/bin/sh\nexit 0\n");
    const step = planned({ kind: "exec", argv: ["not-executable"], cwd }, "not-executable");
    await expect(runPlan({ steps: [step] })).rejects.toThrow("not-executable not found on PATH.");
  });
});
