/**
 * The release job's "Move the major tag" step.
 *
 * `uses: hawkeyexl/manni@vN` resolves only because this step force-moves the
 * `vN` tag after each stable release. The 2.0.0 release published to npm,
 * created `v2.0.0` and the GitHub release, then failed in a post-publish step
 * of `@semantic-release/github`. The tag step was gated on the Release step
 * succeeding, so it was skipped and `v2` was never created: a release that
 * reached every consumer, and an Action reference that resolved to nothing.
 *
 * So the step runs unless the job was cancelled, and proves for itself what the
 * old gate assumed: that a release happened, that it is stable, that npm serves
 * the version, and that its tag is on the remote. These tests run the step's
 * own script, extracted from the workflow, with `node`, `npm`, `git` and
 * `sleep` stubbed as shell functions, so they cannot pass against a script the
 * workflow no longer ships.
 */
import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { spawnText } from "./helpers/spawn.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  name?: string;
  if?: string;
  run?: string;
}

/** The "Move the major tag" step, located by name in the parsed workflow. */
function tagStep(): Step {
  const workflow = parseYaml(
    readFileSync(join(repoRoot, ".github/workflows/release.yml"), "utf8"),
  ) as { jobs: Record<string, { steps?: Step[] }> };
  const step = workflow.jobs["release"]?.steps?.find(
    (s) => s.name === "Move the major tag",
  );
  if (step?.run === undefined) {
    throw new Error('release.yml has no "Move the major tag" step with a `run:`');
  }
  return step;
}

const hasBash = (() => {
  try {
    execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

interface Scenario {
  /** `steps.before.outputs.version`; empty when that step never ran. */
  before: string;
  /** What package.json says after the Release step. */
  after: string;
  /** The version `npm view` prints, or null when npm does not serve it. */
  npmServes: string | null;
  /** Whether `git ls-remote` finds `refs/tags/v<after>` on the remote. */
  tagOnRemote: boolean;
}

interface Result {
  status: number;
  stdout: string;
  /** Every stub invocation, one `<command> <args…>` line each. */
  calls: string[];
}

/** A value as one single-quoted shell word, whatever it contains. */
const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

function runStep(s: Scenario): Result {
  const dir = mkdtempSync(join(tmpdir(), "manni-major-tag-"));
  try {
    const log = join(dir, "calls");
    // Stubs are shell functions defined ahead of the step's script, not
    // executables on PATH. A function wins over any PATH lookup, and PATH order
    // cannot be trusted: on the Windows runners `bash` is Git for Windows'
    // launcher, which puts its own `/usr/bin` and `/mingw64/bin` ahead of
    // anything the test prepends, so a PATH stub named `git` or `sleep` lost to
    // the real one. The script under test is still the workflow's own.
    const prelude = [
      `__log() { printf '%s\\n' "$*" >> ${shellQuote(log.replace(/\\/g, "/"))}; }`,
      "node() {",
      '  __log "node $*"',
      '  case "$*" in',
      `    *.name*) echo ${shellQuote("@hawkeyexl/manni")} ;;`,
      `    *.version*) echo ${shellQuote(s.after)} ;;`,
      "  esac",
      "}",
      "npm() {",
      '  __log "npm $*"',
      s.npmServes === null ? "  return 1" : `  echo ${shellQuote(s.npmServes)}`,
      "}",
      "git() {",
      '  __log "git $*"',
      `  if [ "$1" = ls-remote ]; then return ${s.tagOnRemote ? "0" : "2"}; fi`,
      "}",
      'sleep() { __log "sleep $*"; }',
      "",
    ].join("\n");

    writeFileSync(join(dir, "run.sh"), prelude + (tagStep().run ?? ""), "utf8");
    const res = spawnText(
      spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "run.sh")], {
        encoding: "utf8",
        env: {
          ...process.env,
          VERSION_BEFORE: s.before,
          GH_TOKEN: "token",
          GITHUB_REPOSITORY: "hawkeyexl/manni",
        },
      }),
    );
    return {
      status: res.status ?? -1,
      stdout: `${res.stdout ?? ""}${res.stderr ?? ""}`,
      calls: existsSync(log)
        ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "")
        : [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Whether the script moved a tag: a `git tag -f` or a push. */
const moved = (r: Result): boolean =>
  r.calls.some((c) => c.startsWith("git tag") || c.startsWith("git push"));

describe("the major tag step's gate", () => {
  it("runs after a failed Release step, but not after a cancellation", () => {
    // `always()` would also run on cancel; `success()`, the default, is what
    // skipped the tag when a post-publish plugin step failed.
    const gate = tagStep().if ?? "";
    expect(gate).toContain("!cancelled()");
    expect(gate).not.toContain("always()");
    expect(gate).toContain("github.ref == 'refs/heads/main'");
  });
});

describe.skipIf(!hasBash)("the major tag step's script", () => {
  it("moves the major tag to a stable version npm serves and the remote has tagged", () => {
    const r = runStep({ before: "2.0.0", after: "2.0.1", npmServes: "2.0.1", tagOnRemote: true });
    expect(r.status, r.stdout).toBe(0);
    expect(r.calls).toContain("npm view @hawkeyexl/manni@2.0.1 version");
    expect(r.calls).toContain("git tag -f v2 v2.0.1");
    expect(r.calls.some((c) => c.startsWith("git push") && c.endsWith("refs/tags/v2"))).toBe(true);
  });

  it("leaves the tag alone when the Release step never recorded a version", () => {
    // A failure before the `before` step leaves its output empty, and the old
    // comparison would have read that as "the version changed".
    const r = runStep({ before: "", after: "2.0.0", npmServes: "2.0.0", tagOnRemote: true });
    expect(r.status, r.stdout).toBe(0);
    expect(moved(r)).toBe(false);
  });

  it("leaves the tag alone when nothing was released", () => {
    const r = runStep({ before: "2.0.0", after: "2.0.0", npmServes: "2.0.0", tagOnRemote: true });
    expect(r.status, r.stdout).toBe(0);
    expect(moved(r)).toBe(false);
  });

  it("leaves the tag alone for a prerelease", () => {
    const r = runStep({ before: "2.0.0", after: "2.1.0-next.1", npmServes: "2.1.0-next.1", tagOnRemote: true });
    expect(r.status, r.stdout).toBe(0);
    expect(moved(r)).toBe(false);
  });

  it("fails without moving the tag when npm never serves the version", () => {
    // semantic-release bumps package.json in `prepare`, before `publish`, so a
    // publish failure still changes the version. That tree was never released.
    const r = runStep({ before: "2.0.0", after: "2.0.1", npmServes: null, tagOnRemote: true });
    expect(r.status).toBe(1);
    expect(moved(r)).toBe(false);
    expect(r.stdout).toContain("::error::");
    expect(r.calls.filter((c) => c.startsWith("npm view")).length).toBe(5);
    // Four waits between five tries, all stubbed: a real `sleep` here is what
    // timed these tests out on the Windows runners.
    expect(r.calls.filter((c) => c.startsWith("sleep")).length).toBe(4);
  });

  it("fails without moving the tag when npm serves a different version", () => {
    // Older npm printed nothing and exited 0 for a missing version, so the
    // printed version is compared rather than the exit status trusted.
    const r = runStep({ before: "2.0.0", after: "2.0.1", npmServes: "", tagOnRemote: true });
    expect(r.status).toBe(1);
    expect(moved(r)).toBe(false);
  });

  it("fails without moving the tag when the version tag is not on the remote", () => {
    const r = runStep({ before: "2.0.0", after: "2.0.1", npmServes: "2.0.1", tagOnRemote: false });
    expect(r.status).toBe(1);
    expect(moved(r)).toBe(false);
    expect(r.stdout).toContain("::error::");
  });
});
