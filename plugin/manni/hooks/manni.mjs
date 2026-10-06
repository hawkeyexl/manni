// Runs the manni a hook should run, with the hook's arguments, stdin and
// exit code passed straight through.
//
// In order:
// 1. the project's own build when the project is @hawkeyexl/manni, since a
//    package cannot depend on itself. Before it is built, nothing runs;
// 2. the copy the project installed, found the way Node finds a dependency,
//    by walking up through node_modules;
// 3. a global install in npm's default global directory;
// and only where the project has a manni config:
// 4. a global install wherever `npm root -g` says, which costs an npm start;
// 5. `npx --yes` at the plugin's own version, which downloads it into npx's
//    cache once.
// Otherwise it exits quietly. No step before 5 touches the network:
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

/**
 * In manni's own checkout, its bin once built and `false` before: the
 * published release would check the branch with code it does not have.
 * `undefined` anywhere else.
 */
function ownBuild() {
  for (const d of upward(project)) {
    const manifest = join(d, "package.json");
    if (!existsSync(manifest)) continue;
    // The nearest package.json decides: this project is manni or it is not.
    return readJson(manifest)?.name === PACKAGE ? (binOf(manifest) ?? false) : undefined;
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

/** A global install in `root`, the directory global packages live in. */
function globalIn(root) {
  const manifest = join(root, PACKAGE, "package.json");
  return root !== "" && existsSync(manifest) ? binOf(manifest) : undefined;
}

/** Where npm puts global packages by default, worked out without starting npm. */
function defaultGlobalRoot() {
  const prefix =
    process.env.npm_config_prefix ?? (windows ? dirname(process.execPath) : dirname(dirname(process.execPath)));
  return windows ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules");
}

/** What `npm root -g` says, for a prefix set only in an npmrc. Costs an npm start-up. */
function npmGlobalRoot() {
  // npm is a .cmd shim on Windows, which only a shell can start.
  const out = spawnSync(windows ? "npm root -g" : "npm", windows ? [] : ["root", "-g"], {
    encoding: "utf8",
    shell: windows,
    windowsHide: true,
  });
  return out.status === 0 ? out.stdout.trim() : "";
}

/**
 * npx, with no shell between it and the arguments: a skill passes the
 * agent's paths, which may hold a space or a cmd metacharacter. On Windows
 * npx is a .cmd shim, so its own script runs under node instead.
 */
function npx(words) {
  const script = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (windows && existsSync(script)) return spawn(process.execPath, [script, ...words], { stdio: "inherit" });
  if (!windows) return spawn("npx", words, { stdio: "inherit" });
  // Last resort on an unusual Windows layout: each word quoted for cmd.
  const quoted = words.map((w) => `"${w.replaceAll('"', '""')}"`).join(" ");
  return spawn(`npx ${quoted}`, { stdio: "inherit", shell: true });
}

/** Whether the project has a manni config, found as manni finds one: up to the repository root. */
function configured() {
  for (const d of upward(project)) {
    if (existsSync(join(d, "manni.config.yaml")) || existsSync(join(d, "manni.config.yml"))) return true;
    if (existsSync(join(d, ".git"))) return false;
  }
  return false;
}

/**
 * The plugin's own version, which the release keeps equal to manni's. Every
 * installed plugin carries its plugin.json; were it missing, the caller asks
 * for the bare package, so npx fetches the latest release, not a match.
 */
function pluginVersion() {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json");
  const version = readJson(manifest)?.version;
  return typeof version === "string" ? version : undefined;
}

function launch() {
  const args = process.argv.slice(2);
  const own = ownBuild();
  if (own === false) return undefined;
  const run = (cli) => spawn(process.execPath, [cli, ...args], { stdio: "inherit" });
  const found = own ?? installed() ?? globalIn(defaultGlobalRoot());
  if (found !== undefined) return run(found);
  // Without a config manni has nothing to do here, so neither an npm
  // start-up nor a download is worth paying for.
  if (!configured()) return undefined;
  const configuredGlobal = globalIn(npmGlobalRoot());
  if (configuredGlobal !== undefined) return run(configuredGlobal);
  const version = pluginVersion();
  return npx(["--yes", version === undefined ? PACKAGE : `${PACKAGE}@${version}`, ...args]);
}

const child = launch();
if (child === undefined) process.exit(0);
child.on("error", () => {
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
