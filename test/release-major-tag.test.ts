/**
 * The release workflow's `major-tag` job and its "Move the major tag" step.
 *
 * `uses: hawkeyexl/manni@vN` resolves only because this step force-moves the
 * `vN` tag after each stable release. The 2.0.0 release published to npm,
 * created `v2.0.0` and the GitHub release, then failed in a post-publish step
 * of `@semantic-release/github`. The tag step was gated on the Release step
 * succeeding, so it was skipped and `v2` was never created: a release that
 * reached every consumer, and an Action reference that resolved to nothing.
 *
 * So the job runs unless the run was cancelled, and proves for itself what the
 * old gate assumed: that a release happened, that it is stable, that npm serves
 * the version, and that its tag is on the remote. These tests run the step's
 * own script, extracted from the workflow, with `node`, `npm`, `git` and
 * `sleep` stubbed as shell functions, so they cannot pass against a script the
 * workflow no longer ships.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { spawnText } from "./helpers/spawn.js";
import { bash, hasBash } from "./helpers/bash.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  id?: string;
  name?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

interface Job {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps?: Step[];
}

/** Every job in the parsed workflow, by id. */
function jobs(): Record<string, Job> {
  const workflow = parseYaml(
    readFileSync(join(repoRoot, ".github/workflows/release.yml"), "utf8"),
  ) as { jobs: Record<string, Job> };
  return workflow.jobs;
}

/** The `major-tag` job, which holds the step and its gate. */
function tagJob(): Job {
  const job = jobs()["major-tag"];
  if (job === undefined) throw new Error("release.yml has no `major-tag` job");
  return job;
}

/** The "Move the major tag" step, located by name in the parsed workflow. */
function tagStep(): Step {
  const step = tagJob().steps?.find((s) => s.name === "Move the major tag");
  if (step?.run === undefined) {
    throw new Error('release.yml has no "Move the major tag" step with a `run:`');
  }
  return step;
}

interface Scenario {
  /** `release`'s `version-before` output; empty when that step never ran. */
  before: string;
  /** `release`'s `version-after` output; empty when that step never ran. */
  after: string;
  /** The version `npm view` prints, or null when npm does not serve it. */
  npmServes: string | null;
  /** The first `npm view` attempt that serves it; earlier ones fail. Default 1. */
  npmServesFromAttempt?: number;
  /** Whether the version-list read path includes the version. Default false. */
  listIncludesVersion?: boolean;
  /** Whether `git ls-remote` finds `refs/tags/v<after>` on the remote. */
  tagOnRemote: boolean;
  /** `needs.release.result`, which the job's gate narrows to these two. Default success. */
  releaseResult?: "success" | "failure";
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
      // No `.version` answer: this job's checkout holds the version the run
      // started from, so the script must take the released one from
      // `VERSION_AFTER`, and reading package.json for it would get nothing.
      "node() {",
      '  __log "node $*"',
      '  case "$*" in',
      `    *.name*) echo ${shellQuote("@hawkeyexl/manni")} ;;`,
      "  esac",
      "}",
      // Each `npm view` runs in a command substitution, a subshell, so the
      // attempt count comes from the call log rather than a shell variable.
      //
      // The step reads the registry two ways per attempt and the stub answers
      // them apart: `npm view <name>@<version> version` is the exact-version
      // document, `npm view <name> versions --json` the version list. They hit
      // different registry caches, so either one alone has to be enough, and a
      // stub that answered both at once could not show that.
      "npm() {",
      '  __log "npm $*"',
      '  case "$*" in',
      "    *versions*)",
      ...(s.listIncludesVersion === true
        ? [`      printf '["0.0.1","%s"]\\n' ${shellQuote(s.after)}`]
        : ["      return 1"]),
      "      ;;",
      "    *)",
      ...(s.npmServes === null
        ? ["      return 1"]
        : [
            `      if [ "$(grep -c ' version$' ${shellQuote(log.replace(/\\/g, "/"))})" -lt ${String(s.npmServesFromAttempt ?? 1)} ]; then return 1; fi`,
            `      echo ${shellQuote(s.npmServes)}`,
          ]),
      "      ;;",
      "  esac",
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
      spawnSync(bash, ["--noprofile", "--norc", "-eo", "pipefail", join(dir, "run.sh")], {
        encoding: "utf8",
        env: {
          ...process.env,
          VERSION_BEFORE: s.before,
          VERSION_AFTER: s.after,
          RELEASE_RESULT: s.releaseResult ?? "success",
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

/** The exact-version `npm view <name>@<version> version` reads. */
const docReads = (r: Result): string[] =>
  r.calls.filter((c) => c.startsWith("npm view") && c.endsWith(" version"));

/** Whether the script moved a tag: a `git tag -f` or a push. */
const moved = (r: Result): boolean =>
  r.calls.some((c) => c.startsWith("git tag") || c.startsWith("git push"));

describe("the major tag job's gate", () => {
  it("runs after a failed release, but not after a cancellation", () => {
    // `always()` would also run on cancel; `success()`, the default, is what
    // skipped the tag when a post-publish plugin step failed.
    const job = tagJob();
    expect(job.needs).toBe("release");
    const gate = job.if ?? "";
    expect(gate).toContain("!cancelled()");
    expect(gate).not.toContain("always()");
    expect(gate).toContain("github.ref == 'refs/heads/main'");
    // A skipped release is the release commit or a failed shard, and neither
    // released anything.
    expect(gate).toContain("needs.release.result != 'skipped'");
  });

  it("reads both versions from the release job's outputs", () => {
    // Its own checkout holds the version the run started from, so the
    // released one has to come from the job that released it.
    const env = tagStep().env ?? {};
    expect(env["VERSION_BEFORE"]).toBe("${{ needs.release.outputs.version-before }}");
    expect(env["VERSION_AFTER"]).toBe("${{ needs.release.outputs.version-after }}");

    const release = jobs()["release"];
    expect(release?.outputs?.["version-before"]).toBe("${{ steps.before.outputs.version }}");
    expect(release?.outputs?.["version-after"]).toBe("${{ steps.after.outputs.version }}");
    // Recorded after a failed Release step too: 2.0.0 failed after publishing.
    const after = release?.steps?.find((s) => s.id === "after");
    expect(after?.if ?? "").toContain("!cancelled()");
  });

  it("reads whether the release job failed", () => {
    // Without it, a publish that failed reads as npm lagging one that landed.
    expect(tagStep().env?.["RELEASE_RESULT"]).toBe("${{ needs.release.result }}");
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

  it("leaves the tag alone, with a warning, when the release never recorded where it ended", () => {
    // A release cancelled between `before` and `after` may have published, so
    // this one is worth a warning rather than a notice.
    const r = runStep({ before: "2.0.0", after: "", npmServes: "2.0.1", tagOnRemote: true });
    expect(r.status, r.stdout).toBe(0);
    expect(moved(r)).toBe(false);
    expect(r.stdout).toContain("::warning::The release never recorded the version it ended on");
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
    // The message reports propagation, names what is known, and does not claim
    // the release is half-published: 2.7.0 failed this step with that claim
    // while npm was serving it as `latest` and `v2.7.0` was on the remote.
    expect(r.stdout).toContain(
      "npm did not serve @hawkeyexl/manni@2.0.1 within 20 minutes",
    );
    expect(r.stdout).toContain("usually npm lagging the publish");
    expect(r.stdout).toContain("the v2.0.1 tag is on the remote");
    expect(r.stdout).not.toContain("half-published");
    // Recovery is one copy-paste, with the version already substituted.
    expect(r.stdout).toContain(
      "git fetch origin --tags && git tag -f v2 v2.0.1 && git push --force origin refs/tags/v2",
    );
    // Twenty-four attempts over about twenty minutes, backing off 5s to 60s.
    // Two reads an attempt, so 48 registry reads across twenty minutes where
    // the first, flat budget spent 30 across five and then gave up on 2.7.0.
    expect(r.calls.filter((c) => c.startsWith("npm view")).length).toBe(48);
    expect(docReads(r)).toHaveLength(24);
    // The waits are all stubbed: a real `sleep` here is what timed these tests
    // out on the Windows runners.
    const waits = r.calls.filter((c) => c.startsWith("sleep"));
    expect(waits).toEqual([
      "sleep 5",
      "sleep 10",
      "sleep 20",
      "sleep 40",
      ...Array<string>(19).fill("sleep 60"),
    ]);
  });

  it("says the publish failed when the release job failed and npm never serves the version", () => {
    // 4.17.0: semantic-release pushed the release commit and `v4.17.0`, then
    // `npm publish` failed with ENEEDAUTH during an npm outage. This step
    // waited twenty minutes and blamed registry lag for a package that was
    // never going to appear.
    const r = runStep({
      before: "2.0.0",
      after: "2.0.1",
      npmServes: null,
      tagOnRemote: true,
      releaseResult: "failure",
    });
    expect(r.status).toBe(1);
    expect(moved(r)).toBe(false);
    expect(r.stdout).toContain(
      "::error::npm did not serve @hawkeyexl/manni@2.0.1 within 20 minutes, and the release job failed, so its publish most likely failed too.",
    );
    expect(r.stdout).toContain("The v2.0.1 tag is on the remote with no package behind it.");
    expect(r.stdout).toContain("The next feat: or fix: merge releases the version after it");
    expect(r.stdout).not.toContain("usually npm lagging the publish");
    // No by-hand tag move: it waits for a version npm will never serve.
    expect(r.stdout).not.toContain("git tag -f v2 v2.0.1");
    // Still the full wait. 2.0.0 failed after it published, so a failed job
    // alone does not mean npm will never serve the version.
    expect(docReads(r)).toHaveLength(24);
  });

  it("says nothing was published when the release job failed before the version tag", () => {
    const r = runStep({
      before: "2.0.0",
      after: "2.0.1",
      npmServes: null,
      tagOnRemote: false,
      releaseResult: "failure",
    });
    expect(r.status).toBe(1);
    expect(moved(r)).toBe(false);
    expect(r.stdout).toContain(
      "the release job failed before it pushed the v2.0.1 tag, so nothing was published.",
    );
    expect(r.stdout).not.toContain("usually npm lagging the publish");
  });

  it("still moves the tag when the release job failed after publishing", () => {
    // 2.0.0: published, tagged, then failed in a post-publish step.
    const r = runStep({
      before: "1.9.0",
      after: "2.0.0",
      npmServes: "2.0.0",
      tagOnRemote: true,
      releaseResult: "failure",
    });
    expect(r.status, r.stdout).toBe(0);
    expect(r.calls).toContain("git tag -f v2 v2.0.0");
  });

  it("names the missing version tag when neither npm nor the remote has it", () => {
    const r = runStep({ before: "2.0.0", after: "2.0.1", npmServes: null, tagOnRemote: false });
    expect(r.status).toBe(1);
    expect(moved(r)).toBe(false);
    expect(r.stdout).toContain("the remote has no v2.0.1 tag either");
  });

  it("accepts a version the version list serves while the exact-version read lags", () => {
    // The two reads hit different registry caches, so one can be current while
    // the other still answers for a version that is not there. Either one
    // showing it is proof enough that the publish landed.
    const r = runStep({
      before: "2.0.0",
      after: "2.0.1",
      npmServes: null,
      listIncludesVersion: true,
      tagOnRemote: true,
    });
    expect(r.status, r.stdout).toBe(0);
    expect(r.calls).toContain("npm view @hawkeyexl/manni@2.0.1 version");
    expect(r.calls).toContain("npm view @hawkeyexl/manni versions --json");
    expect(r.calls).toContain("git tag -f v2 v2.0.1");
    expect(r.calls.filter((c) => c.startsWith("sleep"))).toHaveLength(0);
  });

  it("moves the tag once npm starts serving the version partway through the wait", () => {
    const r = runStep({
      before: "2.0.0",
      after: "2.0.1",
      npmServes: "2.0.1",
      npmServesFromAttempt: 7,
      tagOnRemote: true,
    });
    expect(r.status, r.stdout).toBe(0);
    expect(docReads(r)).toHaveLength(7);
    expect(r.calls.filter((c) => c.startsWith("sleep"))).toHaveLength(6);
    expect(r.calls).toContain("git tag -f v2 v2.0.1");
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
    // Its own message. npm serving the version while no tag exists really is a
    // half-published release, and reads nothing like the registry lagging.
    expect(r.stdout).toContain(
      "npm serves @hawkeyexl/manni@2.0.1, but the remote has no v2.0.1 tag",
    );
    expect(r.stdout).toContain("half-published");
    expect(r.stdout).not.toContain("did not serve");
    // Recovery here creates the version tag first, then moves the major tag.
    expect(r.stdout).toContain(
      "git fetch origin && git tag v2.0.1 origin/main && git push origin refs/tags/v2.0.1 && git tag -f v2 v2.0.1 && git push --force origin refs/tags/v2",
    );
  });
});
