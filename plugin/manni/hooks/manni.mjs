// Runs the manni a hook should run, with the hook's arguments, stdin and
// exit code passed straight through.
//
// In order:
// 1. the project's own build when the project is @hawkeyexl/manni, since a
//    package cannot depend on itself;
// 2. the copy the project installed, found the way Node finds a dependency,
//    by walking up through node_modules;
// 3. a global install, under `npm root -g`;
// 4. where the project has a manni config, `npx --yes` at the plugin's own
//    version, which downloads it into npx's cache once.
// Otherwise it exits quietly. No step before 4 touches the network:
// `npx --no` would ask the registry on every hook in every repository
// without manni. Running node on a found bin also skips npx's start-up.
//
// Plain ESM with no dependencies: the plugin ships as files, not a package.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE = "@hawkeyexl/manni";
const project = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const windows = process.platform === "win32";

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

function globalInstall() {
  // npm is a .cmd shim on Windows, which only a shell can start.
  const out = spawnSync(windows ? "npm root -g" : "npm", windows ? [] : ["root", "-g"], {
    encoding: "utf8",
    shell: windows,
    windowsHide: true,
  });
  const root = out.status === 0 ? out.stdout.trim() : "";
  if (root === "") return undefined;
  const manifest = join(root, PACKAGE, "package.json");
  return existsSync(manifest) ? binOf(manifest) : undefined;
}

/** Whether the project has a manni config, found as manni finds one: up to the repository root. */
function configured() {
  for (const d of upward(project)) {
    if (existsSync(join(d, "manni.config.yaml")) || existsSync(join(d, "manni.config.yml"))) return true;
    if (existsSync(join(d, ".git"))) return false;
  }
  return false;
}

/** The plugin's own version, which the release keeps equal to manni's. */
function pluginVersion() {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json");
  const version = readJson(manifest)?.version;
  return typeof version === "string" ? version : undefined;
}

const args = process.argv.slice(2);
const cli = ownBuild() ?? installed() ?? globalInstall();
let child;
if (cli !== undefined) {
  child = spawn(process.execPath, [cli, ...args], { stdio: "inherit" });
} else if (configured()) {
  const version = pluginVersion();
  const spec = version === undefined ? PACKAGE : `${PACKAGE}@${version}`;
  // The words are the hook's own fixed arguments and a package spec, so
  // nothing needs quoting for the shell Windows needs to start npx.
  const words = ["--yes", spec, ...args];
  child = windows
    ? spawn(`npx ${words.join(" ")}`, { stdio: "inherit", shell: true })
    : spawn("npx", words, { stdio: "inherit" });
}
if (child === undefined) process.exit(0);
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
