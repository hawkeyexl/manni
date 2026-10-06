// Runs the manni a hook should run, with the hook's arguments, stdin and
// exit code passed straight through.
//
// In order: the project's own build when the project is @hawkeyexl/manni,
// since a package cannot depend on itself and npx would find some other
// copy; then the copy the project installed, found the way Node finds a
// dependency, by walking up through node_modules; then `npx --no`, which
// also finds a global install. Running node on a found bin skips npx's own
// start-up, which every hook would otherwise pay.
//
// Plain ESM with no dependencies: the plugin ships as files, not a package.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const PACKAGE = "@hawkeyexl/manni";
const project = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** The `manni` bin a package.json names, when that file exists. */
function binOf(manifest) {
  const bin = readJson(manifest)?.bin;
  const rel = typeof bin === "string" ? bin : bin?.manni;
  if (typeof rel !== "string") return undefined;
  const path = join(dirname(manifest), rel);
  return existsSync(path) ? path : undefined;
}

/** Each directory from the project up to the root. */
function* upward(dir) {
  for (let d = dir; ; d = dirname(d)) {
    yield d;
    if (dirname(d) === d) return;
  }
}

function ownBuild() {
  for (const d of upward(project)) {
    const manifest = join(d, "package.json");
    if (!existsSync(manifest)) continue;
    // The nearest package.json decides: this project is manni or it is not.
    return readJson(manifest)?.name === PACKAGE ? binOf(manifest) : undefined;
  }
  return undefined;
}

function installed() {
  for (const d of upward(project)) {
    const manifest = join(d, "node_modules", PACKAGE, "package.json");
    if (existsSync(manifest)) return binOf(manifest);
  }
  return undefined;
}

const args = process.argv.slice(2);
const cli = ownBuild() ?? installed();
const child =
  cli === undefined
    ? // npx is a .cmd shim on Windows, which only a shell can start. The
      // arguments are the hook's own fixed words, so nothing needs quoting.
      spawn("npx", ["--no", PACKAGE, ...args], { stdio: "inherit", shell: process.platform === "win32" })
    : spawn(process.execPath, [cli, ...args], { stdio: "inherit" });
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
