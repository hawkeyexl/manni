/**
 * The package as a consumer receives it.
 *
 * Every other test runs the CLI out of the working tree, where everything
 * resolves because everything is there. That cannot see the class of defect
 * that only exists in the published artifact: a path missing from `files`, a
 * `bin` pointing at something that was never built, an `exports` map that works
 * in the repo and nowhere else, or a bundled schema the code reaches by a path
 * that does not survive packing.
 *
 * So this packs the tarball with `npm pack` and runs the CLI out of the
 * extracted bytes. Extraction goes under `.tmp/` inside the repo on purpose:
 * Node then resolves runtime dependencies by walking up to the repo's own
 * `node_modules`, which keeps the test hermetic — no registry, no network — while
 * still exercising exactly the files that would ship (ADR 01026).
 */
import { execSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const corpus = join(root, "test", "kg", "fixtures", "corpus");
const stage = join(root, ".tmp", "packaged");

/**
 * npm ships as a .cmd shim on Windows, and Node 24 refuses to spawn a .cmd
 * through execFile at all (EINVAL — the batch-injection hardening). So the one
 * npm call here goes through a shell as a quoted command string, which both
 * cmd.exe and sh accept. Every other subprocess is a real executable and goes
 * through `run` below, which needs no shell.
 */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

/** The extracted package root: <stage>/package, as npm lays a tarball out. */
let pkgRoot: string;

/**
 * Run a command and capture both streams on both paths.
 *
 * The failure path always merged stderr in; the success path returned
 * `execFileSync`'s stdout alone and dropped it. dockg puts its warnings on
 * stderr and still exits 0 (ADR 01010), so that shape silently discards exactly
 * the output a degraded-but-successful run produces.
 */
function run(
  cmd: string,
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; output: string; status: number } {
  // spawnSync, not execFileSync: the latter hands stderr back only when the
  // command throws, so there is no success path on which to read it. Only
  // `tar` and `node` come through here — no `npm.cmd`, which would need a
  // shell on Windows.
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd });
  const stdout = r.stdout ?? "";
  // `r.error` is set when the executable itself could not be spawned (tar not
  // installed, say). Both streams are empty then, so without it the caller's
  // failure message would be blank — the one case where it is the only thing
  // that could explain the failure.
  const stderr = [
    r.stderr ?? "",
    r.error ? `spawn failed: ${r.error.message}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { stdout, stderr, output: stdout + stderr, status: r.status ?? -1 };
}

beforeAll(() => {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });

  // --ignore-scripts: packing must not run `prepare` (husky) or a build. The
  // tarball is made from dist/ as it stands, which is what `npm run build`
  // produced for this test run.
  try {
    execSync(
      `${NPM} pack --ignore-scripts --pack-destination "${stage}" --silent`,
      { cwd: root, encoding: "utf8", stdio: "pipe" },
    );
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`npm pack failed: ${err.stderr ?? err.stdout ?? ""}`, {
      cause: e,
    });
  }

  const tgz = readdirSync(stage).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`no tarball in ${stage}`);

  // Bare filename with cwd, not an absolute path: GNU tar reads `C:\…` as a
  // remote host spec and fails with "Cannot connect to C:".
  const extracted = run("tar", ["-xzf", tgz], stage);
  // `output`, not `stdout`: tar reports its failures on stderr, which the old
  // helper discarded on the path where the message would have been useful.
  if (extracted.status !== 0)
    throw new Error(`tar failed: ${extracted.output}`);

  pkgRoot = join(stage, "package");
}, 120_000);

/** Run the packaged CLI. */
function cli(
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; output: string; status: number } {
  return run(process.execPath, [join(pkgRoot, "dist", "cli.js"), "kg", ...args], cwd);
}

describe("the packaged tarball", () => {
  it("contains every path `files` promises, and the bin target", () => {
    const manifest = JSON.parse(
      readFileSync(join(pkgRoot, "package.json"), "utf8"),
    ) as { files: string[]; bin: Record<string, string> };

    for (const entry of manifest.files) {
      expect(existsSync(join(pkgRoot, entry)), `files entry ${entry}`).toBe(
        true,
      );
    }
    for (const [name, target] of Object.entries(manifest.bin)) {
      expect(existsSync(join(pkgRoot, target)), `bin ${name} → ${target}`).toBe(
        true,
      );
    }
  });

  it("resolves every path its `exports` map names", () => {
    const manifest = JSON.parse(
      readFileSync(join(pkgRoot, "package.json"), "utf8"),
    ) as { exports: Record<string, Record<string, string> | string> };

    for (const [subpath, entry] of Object.entries(manifest.exports)) {
      const targets =
        typeof entry === "string" ? [entry] : Object.values(entry);
      for (const target of targets) {
        expect(
          existsSync(join(pkgRoot, target)),
          `exports ${subpath} → ${target}`,
        ).toBe(true);
      }
    }
  });

  it("builds the corpus byte-identically to the in-repo CLI", () => {
    const out = mkdtempSync(join(tmpdir(), "dockg-packaged-"));
    const packedOut = join(out, "packed.ttl");
    const repoOut = join(out, "repo.ttl");

    expect(cli(["build", "--out", packedOut], corpus).status).toBe(0);
    expect(
      run(
        process.execPath,
        [join(root, "dist", "cli.js"), "kg", "build", "--out", repoOut],
        corpus,
      ).status,
    ).toBe(0);

    expect(readFileSync(packedOut, "utf8")).toBe(readFileSync(repoOut, "utf8"));
  });

  it("finds its bundled shapes — the `check` default resolves after packing", () => {
    // check with no --shapes falls back to bundledShapesPath(), which resolves
    // relative to the installed package. If `shapes/` were dropped from `files`,
    // or the version filename bumped without the directory shipping, this is
    // where it surfaces — as an operational error rather than a silent pass.
    //
    // The graph goes to a temp path rather than the fixture's configured
    // `out`: test/kg/fixtures/ is byte-sensitive and nothing here may write into it.
    const out = mkdtempSync(join(tmpdir(), "dockg-packaged-check-"));
    const graph = join(out, "graph.ttl");
    expect(cli(["build", "--out", graph], corpus).status).toBe(0);

    const { stdout, status } = cli(["check", "-g", graph], corpus);
    expect(status, stdout).toBe(0);
    expect(stdout).toMatch(/\d+ violations?, \d+ warnings?/);
  });

  it("finds its bundled kg schema — the `validate` default resolves after packing", () => {
    const { stdout, status } = cli(["validate"], corpus);
    expect(status, stdout).toBe(0);
    expect(stdout).toContain("files checked");
  });

  it("exports every format from the packaged bytes", () => {
    const out = mkdtempSync(join(tmpdir(), "dockg-packaged-fmt-"));
    const graph = join(out, "graph.ttl");
    expect(cli(["build", "--out", graph], corpus).status).toBe(0);

    for (const [format, file] of [
      ["jsonld", "graph.jsonld"],
      ["search", "search.json"],
      ["iirds", "package.iirds"],
    ] as const) {
      const target = join(out, file);
      const { stdout, status } = cli(
        ["export", "-f", format, "-g", graph, "-o", target],
        corpus,
      );
      expect(status, `${format}: ${stdout}`).toBe(0);
      expect(existsSync(target), `${format} wrote nothing`).toBe(true);
    }
  });

  it("reports the same version the repo manifest declares", () => {
    const { stdout, status } = cli(["--version"], root);
    expect(status).toBe(0);
    const version = (
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    expect(stdout.trim()).toBe(version);
  });
});
