/**
 * From a directory to the commands `manni site` runs (proposal 0082). The
 * site is found, its framework read from marker files (detect, don't switch),
 * and each verb resolved to argv, a `site.commands` override, or the built-in
 * static server. Everything that can fail before a process starts fails here.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import type { CollectionConfig } from "../../shared/collections.js";
import { FAMILY_CONFIG_NAMES } from "../../shared/config-file.js";
import { searchPath } from "../../shared/git-root.js";
import { warn } from "../../shared/warn.js";
import { SiteError } from "../errors.js";
import type { Plan, PlannedStep, Verb } from "../types.js";
import { loadSiteConfig, type SiteConfig } from "./config.js";

export interface ResolveOptions {
  cwd: string;
  /** The positional `[dir]`, relative to `cwd`. */
  dir?: string;
  configPath?: string;
  /** `--port` as typed; validated here. */
  port?: string;
  host?: string;
  /** Everything after `--`. */
  passthrough: string[];
}

/** A command: Node frameworks name the script they prefer over the binary. */
interface Cmd {
  script?: string;
  argv: string[];
}

interface Site {
  dir: string;
  scripts: Record<string, unknown>;
  deps: Set<string>;
}

interface Framework {
  name: string;
  /** The marker that matched, for messages, or `null`. */
  marker: (site: Site) => string | null;
  /** How the binary is reached: a package manager, uv/poetry, bundler, or PATH. */
  runner: "node" | "python" | "ruby" | "path";
  /** Node only: the package that provides the binary. */
  pkg?: (site: Site) => string;
  commands: (site: Site) => { start: Cmd; build?: Cmd; preview?: Cmd; out?: string };
  /** `-a` means one `-a host:port`; `null` means the server takes no host. */
  hostFlag: "--host" | "--hostname" | "--bind" | "-a" | null;
  defaultPort: number;
  /** Where the built site is and how a page maps into it; absent when the build is not local. */
  layout?: (site: Site) => Layout;
}

/**
 * A framework's built site (proposal 0095, decision 3). `<path>` is a page's
 * path below `content`, without its extension, and an `index` page maps to
 * its directory: `dir` serves `<path>/index.html`, `html` serves
 * `<path>.html`. `unified` frameworks render through unified, so the rehype
 * plugin can stamp their blocks.
 */
export interface Layout {
  out: string;
  content: string;
  route: "dir" | "html";
  /** Prepended to `<path>`: Docusaurus serves its docs under `docs/`. */
  prefix?: string;
  unified?: true;
}

const has = (dir: string, ...parts: string[]): boolean => existsSync(join(dir, ...parts));
const read = (path: string): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const dep = (name: string) => (s: Site) => (s.deps.has(name) ? name : null);
const node = (bin: string, start: string, build: string, preview: string, args: string[] = []) => ({
  start: { script: start, argv: [bin, "dev", ...args] },
  build: { script: build, argv: [bin, "build", ...args] },
  preview: { script: preview, argv: [bin, "preview", ...args] },
});
const next = () => ({
  start: { script: "dev", argv: ["next", "dev"] },
  build: { script: "build", argv: ["next", "build"] },
  preview: { script: "start", argv: ["next", "start"] },
});

function mintlify(s: Site): string | null {
  if (has(s.dir, "mint.json")) return "mint.json";
  try {
    const doc = JSON.parse(read(join(s.dir, "docs.json"))) as Record<string, unknown>;
    const schema = doc.$schema;
    // Without Mintlify's $schema, it takes the pair its docs.json requires: a theme and a navigation.
    const shaped = typeof doc.theme === "string" && typeof doc.navigation === "object" && doc.navigation !== null;
    if ((typeof schema === "string" && schema.includes("mintlify")) || shaped) {
      return "docs.json";
    }
  } catch {
    // No docs.json, or not JSON: not Mintlify.
  }
  return null;
}

// Both the MkDocs and Zensical markers ask, so each site is answered once.
const zensicalSeen = new WeakMap<Site, string | null>();

function zensical(s: Site): string | null {
  const seen = zensicalSeen.get(s);
  if (seen !== undefined) return seen;
  const found = zensicalMarker(s);
  zensicalSeen.set(s, found);
  return found;
}

function zensicalMarker(s: Site): string | null {
  if (has(s.dir, "zensical.toml")) return "zensical.toml";
  if (!has(s.dir, "mkdocs.yml")) return null;
  let files: string[];
  try {
    files = readdirSync(s.dir).filter((f) => /^requirements.*\.txt$/.test(f) || f === "pyproject.toml");
  } catch {
    // An unlistable directory names no Python deps; it reads as plain MkDocs.
    return null;
  }
  return files.some((f) => /\bzensical\b/.test(read(join(s.dir, f)))) ? "mkdocs.yml" : null;
}

const sphinxSource = (s: Site): string => (has(s.dir, "conf.py") ? "." : "source");
const vitepressRoot = (s: Site): string => (has(s.dir, ".vitepress") || !has(s.dir, "docs", ".vitepress") ? "." : "docs");

/** Detected frameworks, in the order an ambiguity lists them. */
const FRAMEWORKS: Framework[] = [
  {
    name: "Mintlify",
    marker: mintlify,
    runner: "path",
    commands: () => ({ start: { argv: ["mint", "dev"] } }),
    hostFlag: null,
    defaultPort: 3000,
  },
  {
    name: "Fern",
    marker: (s) => (has(s.dir, "fern", "fern.config.json") ? "fern/fern.config.json" : null),
    runner: "path",
    commands: () => ({ start: { argv: ["fern", "docs", "dev"] } }),
    hostFlag: null,
    defaultPort: 3000,
  },
  {
    name: "Starlight",
    marker: dep("@astrojs/starlight"),
    runner: "node",
    pkg: () => "astro",
    commands: () => node("astro", "dev", "build", "preview"),
    layout: () => ({ out: "dist", content: "src/content/docs", route: "dir", unified: true }),
    hostFlag: "--host",
    defaultPort: 4321,
  },
  {
    name: "Docusaurus",
    marker: dep("@docusaurus/core"),
    runner: "node",
    pkg: () => "@docusaurus/core",
    commands: () => ({
      start: { script: "start", argv: ["docusaurus", "start"] },
      build: { script: "build", argv: ["docusaurus", "build"] },
      preview: { script: "serve", argv: ["docusaurus", "serve"] },
    }),
    layout: () => ({ out: "build", content: "docs", route: "dir", prefix: "docs/", unified: true }),
    hostFlag: "--host",
    defaultPort: 3000,
  },
  {
    name: "VitePress",
    marker: dep("vitepress"),
    runner: "node",
    pkg: () => "vitepress",
    commands: (s) => node("vitepress", "docs:dev", "docs:build", "docs:preview", vitepressRoot(s) === "." ? [] : ["docs"]),
    layout: (s) => {
      const src = vitepressRoot(s);
      return { out: posix.join(src, ".vitepress", "dist"), content: src, route: "html" };
    },
    hostFlag: "--host",
    defaultPort: 5173,
  },
  {
    name: "Nextra",
    marker: dep("nextra"),
    runner: "node",
    pkg: () => "next",
    commands: next,
    layout: () => ({ out: "out", content: "pages", route: "html", unified: true }),
    hostFlag: "--hostname",
    defaultPort: 3000,
  },
  {
    name: "Fumadocs",
    marker: dep("fumadocs-core"),
    runner: "node",
    pkg: () => "next",
    commands: next,
    layout: () => ({ out: "out", content: "content/docs", route: "html", prefix: "docs/", unified: true }),
    hostFlag: "--hostname",
    defaultPort: 3000,
  },
  {
    name: "Rspress",
    marker: (s) => dep("rspress")(s) ?? dep("@rspress/core")(s),
    runner: "node",
    pkg: (s) => (s.deps.has("rspress") ? "rspress" : "@rspress/core"),
    commands: () => node("rspress", "dev", "build", "preview"),
    layout: () => ({ out: "doc_build", content: "docs", route: "html", unified: true }),
    hostFlag: "--host",
    defaultPort: 3000,
  },
  {
    name: "MkDocs",
    marker: (s) => (has(s.dir, "mkdocs.yml") && zensical(s) === null ? "mkdocs.yml" : null),
    runner: "python",
    commands: () => ({ start: { argv: ["mkdocs", "serve"] }, build: { argv: ["mkdocs", "build"] }, out: "site" }),
    layout: () => ({ out: "site", content: "docs", route: "dir" }),
    hostFlag: "-a",
    defaultPort: 8000,
  },
  {
    name: "Zensical",
    marker: zensical,
    runner: "python",
    commands: () => ({ start: { argv: ["zensical", "serve"] }, build: { argv: ["zensical", "build"] }, out: "site" }),
    layout: () => ({ out: "site", content: "docs", route: "dir" }),
    hostFlag: "-a",
    defaultPort: 8000,
  },
  {
    name: "Sphinx",
    marker: (s) => (has(s.dir, "conf.py") ? "conf.py" : has(s.dir, "source", "conf.py") ? "source/conf.py" : null),
    runner: "python",
    commands: (s) => {
      const src = sphinxSource(s);
      return {
        start: { argv: ["sphinx-autobuild", src, posix.join(src, "_build", "html")] },
        build: { argv: ["sphinx-build", "-M", "html", src, posix.join(src, "_build")] },
        out: posix.join(src, "_build", "html"),
      };
    },
    layout: (s) => ({ out: posix.join(sphinxSource(s), "_build", "html"), content: sphinxSource(s), route: "html" }),
    hostFlag: "--host",
    defaultPort: 8000,
  },
  {
    name: "Hugo",
    marker: (s) => ["hugo.toml", "hugo.yaml", "hugo.json"].find((f) => has(s.dir, f)) ?? null,
    runner: "path",
    commands: () => ({ start: { argv: ["hugo", "server"] }, build: { argv: ["hugo"] }, out: "public" }),
    layout: () => ({ out: "public", content: "content", route: "dir" }),
    hostFlag: "--bind",
    defaultPort: 1313,
  },
  {
    name: "Jekyll",
    marker: (s) =>
      has(s.dir, "_config.yml") && /\b(jekyll|github-pages)\b/.test(read(join(s.dir, "Gemfile")))
        ? "_config.yml"
        : null,
    runner: "ruby",
    commands: () => ({ start: { argv: ["jekyll", "serve"] }, build: { argv: ["jekyll", "build"] }, out: "_site" }),
    layout: () => ({ out: "_site", content: ".", route: "html" }),
    hostFlag: "--host",
    defaultPort: 4000,
  },
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const STATIC_HOST = "127.0.0.1";
// Only the name error messages show; discovery reads FAMILY_CONFIG_NAMES itself.
const CONFIG_NAME = FAMILY_CONFIG_NAMES[0] ?? "manni.config.yaml";

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
const LOCKFILES: [string, PackageManager][] = [
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
];
const EXEC: Record<PackageManager, string[]> = {
  npm: ["npx"],
  pnpm: ["pnpm", "exec"],
  yarn: ["yarn"],
  bun: ["bun", "x"],
};

function readPackageJson(dir: string): Record<string, unknown> | null {
  const text = read(join(dir, "package.json"));
  if (text === "") return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};

function siteAt(dir: string): Site {
  const pkg = readPackageJson(dir);
  return {
    dir,
    scripts: record(pkg?.scripts),
    deps: new Set([...Object.keys(record(pkg?.dependencies)), ...Object.keys(record(pkg?.devDependencies))]),
  };
}

/** `packageManager:` from the nearest package.json carrying it, then the nearest lockfile, then npm. */
function packageManager(dir: string): PackageManager {
  const chain = searchPath(dir);
  for (const d of chain) {
    const field = readPackageJson(d)?.packageManager;
    const name = typeof field === "string" ? field.split("@")[0] : undefined;
    if (name !== undefined && Object.hasOwn(EXEC, name)) return name as PackageManager;
  }
  for (const d of chain) {
    const hit = LOCKFILES.find(([file]) => has(d, file));
    if (hit) return hit[1];
  }
  return "npm";
}

function pythonPrefix(dir: string): string[] {
  for (const d of searchPath(dir)) {
    if (has(d, "uv.lock")) return ["uv", "run"];
    if (has(d, "poetry.lock")) return ["poetry", "run"];
  }
  return [];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function parsePort(raw: string): number {
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1 && port <= 65535)) {
    throw new SiteError(`--port must be an integer from 1 to 65535, got "${raw}".`);
  }
  return port;
}

/**
 * One argument for the shell an override runs in, so `-- --title "My Docs"`
 * stays one argument. Plain tokens pass unchanged.
 */
function shellQuote(arg: string): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg;
  // cmd.exe doubles a quote inside quotes; POSIX closes, escapes and reopens.
  return process.platform === "win32" ? `"${arg.replace(/"/g, '""')}"` : `'${arg.replace(/'/g, "'\\''")}'`;
}

const andList = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;

interface Address {
  host?: string;
  port?: number;
  base: string;
}

/** The host, port and path a local collection `url:` names, when they agree. */
function collectionAddress(collections: CollectionConfig[], framework: string, portFlag: boolean): Address {
  const local = collections.flatMap((c) => {
    if (c.url === undefined) return [];
    const url = new URL(c.url);
    if (!LOCAL_HOSTS.has(url.hostname)) return [];
    const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
    return [{ name: c.name, host: url.hostname.replace(/^\[|\]$/g, ""), port, base: url.pathname }];
  });
  const [first] = local;
  if (first === undefined) return { base: "/" };
  if (local.some((l) => l.host !== first.host || l.port !== first.port)) {
    if (!portFlag) {
      warn(
        `collections ${andList(local.map((l) => l.name))} name different local URLs. Using ${framework}'s default port; pass --port to pick one.`,
      );
    }
    return { base: "/" };
  }
  // Collections on one server are sections of one site: it mounts where they all live.
  return { ...first, base: sharedPath(local.map((l) => l.base)) };
}

/** The longest leading run of whole path segments every path shares, as `/a/b/`. */
function sharedPath(paths: string[]): string {
  const split = paths.map((p) => p.split("/").filter((s) => s !== ""));
  const [head = [], ...rest] = split;
  const shared: string[] = [];
  for (const [i, segment] of head.entries()) {
    if (!rest.every((p) => p[i] === segment)) break;
    shared.push(segment);
  }
  return shared.length === 0 ? "/" : `/${shared.join("/")}/`;
}

function addressArgs(fw: Framework, host: string | undefined, port: number | undefined): string[] {
  if (fw.hostFlag === "-a") {
    if (host === undefined && port === undefined) return [];
    const h = host ?? STATIC_HOST;
    return ["-a", `${h.includes(":") ? `[${h}]` : h}:${String(port ?? fw.defaultPort)}`];
  }
  return [
    ...(host !== undefined && fw.hostFlag !== null ? [fw.hostFlag, host] : []),
    ...(port !== undefined ? ["--port", String(port)] : []),
  ];
}

/**
 * The framework of the one docs site found in `base` or the folders `site`
 * searches beside it (`docs/`, `website/`, `site/`), or `null` when none is
 * found or a folder holds more than one.
 */
export function detectFramework(base: string): string | null {
  for (const dir of [base, join(base, "docs"), join(base, "website"), join(base, "site")]) {
    if (!isDirectory(dir)) continue;
    const site = siteAt(dir);
    const names = FRAMEWORKS.filter((fw) => fw.marker(site) !== null).map((fw) => fw.name);
    if (names.length > 0) return names.length === 1 ? (names[0] ?? null) : null;
  }
  return null;
}

/**
 * The site: `[dir]`, else `site.dir`, else the first folder searched that a
 * framework marks. `site` is `null` when the search finds none, and
 * `notFound` then says where it looked.
 */
function findSite(
  config: SiteConfig,
  cwd: string,
  dir: string | undefined,
  shown: (dir: string) => string,
): { site: Site | null; base: string; notFound: string } {
  const base = config.configDir ?? resolve(cwd);
  const explicit = dir !== undefined ? resolve(cwd, dir) : config.dir;
  if (explicit !== undefined) {
    if (!isDirectory(explicit)) throw new SiteError(`${shown(explicit)} does not exist.`);
    // Fern's site is the folder above `fern/`, wherever the user points.
    const at = has(explicit, "fern.config.json") && !has(explicit, "fern", "fern.config.json") ? dirname(explicit) : explicit;
    return { site: siteAt(at), base, notFound: "" };
  }
  const candidates = [base, join(base, "docs"), join(base, "website"), join(base, "site")];
  for (const candidate of candidates) {
    if (!isDirectory(candidate)) continue;
    const site = siteAt(candidate);
    if (FRAMEWORKS.some((fw) => fw.marker(site) !== null)) return { site, base, notFound: "" };
  }
  const names = candidates.map(shown);
  return { site: null, base, notFound: `no docs site found in ${names.slice(0, -1).join(", ")} or ${names.at(-1) ?? ""}.` };
}

function matchesOf(site: Site): { fw: Framework; marker: string }[] {
  return FRAMEWORKS.flatMap((fw) => {
    const marker = fw.marker(site);
    return marker === null ? [] : [{ fw, marker }];
  });
}

const shownFrom =
  (cwd: string) =>
  (dir: string): string => {
    const rel = relative(cwd, dir).replace(/\\/g, "/");
    return rel === "" ? "./" : `${rel}/`;
  };

/** The site `manni site annotate` reads, and its framework's layout when one is detected. */
export interface AnnotateSite {
  /** Absolute. */
  dir: string;
  /** `docs/`, for messages. */
  where: string;
  framework: string | null;
  layout: Layout | null;
  config: SiteConfig;
}

/**
 * Find the site to annotate (proposal 0095). A framework is needed only for
 * its default output, so `--out` or `site.out` stands in for one.
 */
export function resolveAnnotateSite(opts: { cwd: string; dir?: string; configPath?: string; out?: string }): AnnotateSite {
  const config = loadSiteConfig(opts.cwd, opts.configPath);
  const shown = shownFrom(opts.cwd);
  const outGiven = (opts.out ?? config.out) !== undefined;
  const located = findSite(config, opts.cwd, opts.dir, shown);
  if (located.site === null && !outGiven) {
    throw new SiteError(`${located.notFound} Pass the site's directory, or pass --out.`);
  }
  const site = located.site ?? siteAt(located.base);
  const where = shown(site.dir);
  const matches = matchesOf(site);
  if (matches.length > 1 && !outGiven) {
    const list = matches.map((m) => `${m.fw.name} (${m.marker})`).join(", ");
    throw new SiteError(`${where} holds more than one docs site: ${list}. Pass --out, or set site.out in ${CONFIG_NAME}.`);
  }
  const fw = matches.length === 1 ? matches[0]?.fw : undefined;
  if (fw !== undefined && fw.layout === undefined) {
    throw new SiteError(`${fw.name} builds on its own host, so there is no local site to annotate.`);
  }
  if (fw === undefined && !outGiven) {
    throw new SiteError(`no docs framework detected in ${where}. Pass --out, or set site.out in ${CONFIG_NAME}.`);
  }
  return { dir: site.dir, where, framework: fw?.name ?? null, layout: fw?.layout?.(site) ?? null, config };
}

export function resolvePlan(verb: Verb, opts: ResolveOptions): Plan {
  const config = loadSiteConfig(opts.cwd, opts.configPath);
  const shown = shownFrom(opts.cwd);

  // The verb whose step takes --port and --host; `build` takes neither.
  const serving = verb === "build" ? null : verb;
  const flagPort = serving !== null && opts.port !== undefined ? parsePort(opts.port) : undefined;
  const flagHost = serving !== null ? opts.host : undefined;
  if (serving !== null && config.commands[serving] !== undefined) {
    if (flagPort !== undefined) {
      throw new SiteError(`--port does not apply to site.commands.${serving}. Put the port in that command.`);
    }
    if (flagHost !== undefined) {
      throw new SiteError(`--host does not apply to site.commands.${serving}. Put the host in that command.`);
    }
  }

  const needed: Verb[] = verb === "preview" ? ["build", "preview"] : [verb];
  const missing = needed.find((v) => config.commands[v] === undefined);
  const key = `site.commands.${missing ?? verb} in ${CONFIG_NAME}`;
  const setIt = `Set ${key}.`;

  const located = findSite(config, opts.cwd, opts.dir, shown);
  if (located.site === null && missing !== undefined) {
    throw new SiteError(`${located.notFound} Pass the site's directory, or set ${key}.`);
  }
  const found = located.site ?? siteAt(located.base);
  const where = shown(found.dir);

  // Which framework, only when some step needs one.
  const matches = matchesOf(found);
  let fw: Framework | undefined;
  if (missing !== undefined) {
    if (matches.length === 0) throw new SiteError(`no docs framework detected in ${where}. ${setIt}`);
    if (matches.length > 1) {
      const list = matches.map((m) => `${m.fw.name} (${m.marker})`).join(", ");
      throw new SiteError(`${where} holds more than one docs site: ${list}. ${setIt}`);
    }
    fw = matches[0]?.fw;
  }

  const steps = needed.flatMap((v): PlannedStep[] => {
    const step = planStep(v);
    // Annotate joins the build it follows, before preview serves it (proposal 0095).
    if (v !== "build" || !config.afterBuild) return [step];
    return [
      step,
      {
        announce: "",
        display: "manni site annotate",
        notFound: "",
        step: {
          kind: "annotate",
          cwd: opts.cwd,
          dir: found.dir,
          ...(opts.configPath === undefined ? {} : { configPath: opts.configPath }),
        },
      },
    ];
  });
  return { steps };

  function planStep(v: Verb): PlannedStep {
    const override = config.commands[v];
    const isServe = v === serving;
    // Passthrough goes to the verb's own step: the serve step, for preview.
    const extra = v === verb ? opts.passthrough : [];
    if (override !== undefined) {
      const command = [override, ...extra.map(shellQuote)].join(" ");
      return {
        announce: `Running site.commands.${v} in ${where}: ${command}`,
        display: command,
        notFound: "",
        step: { kind: "shell", command, cwd: found.dir },
      };
    }
    if (fw === undefined) throw new SiteError(`no docs framework detected in ${where}. ${setIt}`);
    const cmds = fw.commands(found);
    const cmd = cmds[v];
    if (v === "build" && cmd === undefined) {
      throw new SiteError(`${fw.name} has no local build. Run manni site start, or set site.commands.build.`);
    }

    let address: Address = { base: "/" };
    if (isServe) {
      if (flagHost !== undefined && fw.hostFlag === null) {
        throw new SiteError(`${fw.name}'s dev server takes no host option. Drop --host.`);
      }
      // Always read the url: its path is the mount point even when both flags set host and port.
      const url = collectionAddress(config.collections, fw.name, flagPort !== undefined);
      address = { host: flagHost ?? url.host, port: flagPort ?? url.port, base: url.base };
    }

    if (cmd === undefined) {
      if (cmds.out === undefined) {
        throw new SiteError(`${fw.name} has no local preview. Run manni site start, or set site.commands.preview.`);
      }
      if (extra.length > 0) {
        throw new SiteError(`${fw.name} previews through manni's built-in server, which takes no extra arguments. Drop the arguments after --.`);
      }
      return {
        announce: "",
        display: "",
        notFound: "",
        step: {
          kind: "static",
          root: join(found.dir, config.out ?? cmds.out),
          host: address.host ?? STATIC_HOST,
          port: address.port ?? fw.defaultPort,
          base: address.base,
        },
      };
    }

    const flags = [...(isServe ? addressArgs(fw, address.host, address.port) : []), ...extra];
    let argv: string[];
    if (fw.runner === "node") {
      const pm = packageManager(found.dir);
      requireInstalled(fw, found, pm, where);
      argv =
        cmd.script !== undefined && cmd.script in found.scripts
          ? [pm, "run", cmd.script, ...(pm === "npm" && flags.length > 0 ? ["--"] : []), ...flags]
          : [...EXEC[pm], ...cmd.argv, ...flags];
    } else {
      const prefix = fw.runner === "python" ? pythonPrefix(found.dir) : fw.runner === "ruby" ? ["bundle", "exec"] : [];
      argv = [...prefix, ...cmd.argv, ...flags];
    }
    const display = argv.join(" ");
    const bin = argv[0] ?? "";
    // A prefix manni added (npm, uv, bundle...) is its own install, not the framework's.
    const install = bin === cmd.argv[0] ? `${fw.name}'s CLI` : bin;
    return {
      announce: `${fw.name} in ${where}. Running ${display}`,
      display,
      notFound: `${bin} not found on PATH. Install ${install}, or set site.commands.${v}.`,
      step: { kind: "exec", argv, cwd: found.dir },
    };
  }
}

/**
 * The framework's package must resolve from the site, as Node would find it.
 * ponytail: the walk stops at the git root, not the filesystem root, so a
 * package installed above the repository is reported missing. Widen it if
 * anyone keeps node_modules outside their checkout.
 */
function requireInstalled(fw: Framework, site: Site, pm: PackageManager, where: string): void {
  const pkg = fw.pkg?.(site);
  if (pkg === undefined) return;
  const chain = searchPath(site.dir);
  if (chain.some((d) => has(d, "node_modules", pkg, "package.json"))) return;
  // Yarn Plug'n'Play keeps no node_modules; its loader resolves the package.
  if (chain.some((d) => has(d, ".pnp.cjs") || has(d, ".pnp.js"))) return;
  const npmLock = chain.some((d) => has(d, "package-lock.json") || has(d, "npm-shrinkwrap.json"));
  const install = pm === "npm" ? (npmLock ? "npm ci" : "npm install") : `${pm} install`;
  throw new SiteError(`${pkg} is not installed for ${where}. Run ${install} in ${where} first.`);
}
