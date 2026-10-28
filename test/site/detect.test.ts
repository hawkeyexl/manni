/**
 * `resolvePlan`: from a directory to the commands `manni site` runs. Each
 * fixture under test/fixtures/site/ holds a framework's markers and nothing
 * else. Tests copy one into a temp directory with its own `.git`, so the
 * lockfile and node_modules walks stop there instead of reaching this repo's
 * own package-lock.json and node_modules. node_modules is built at runtime
 * because the repo's .gitignore would keep a committed one out of CI.
 */
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectFramework, resolveAnnotateSite, resolvePlan } from "../../src/site/core/detect.js";
import { FlareError } from "../../src/shared/flare/index.js";
import type { MadbuildHost } from "../../src/shared/flare/madbuild.js";
import { SiteError } from "../../src/site/errors.js";
import type { Plan, Step, Verb } from "../../src/site/types.js";
import { resetWarnings } from "../../src/shared/warn.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures", "site");

let root: string | undefined;

interface SiteOptions {
  /** Where under the temp root the fixture goes. Default: the root itself. */
  at?: string;
  /** Extra files, relative to the temp root. */
  files?: Record<string, string>;
  /** Packages to "install" under `<at>/node_modules`. */
  install?: string[];
}

function site(fixture: string, opts: SiteOptions = {}): string {
  root = realpathSync(mkdtempSync(join(tmpdir(), "manni-site-")));
  mkdirSync(join(root, ".git"));
  const at = join(root, opts.at ?? ".");
  cpSync(join(FIXTURES, fixture), at, { recursive: true });
  for (const [rel, content] of Object.entries(opts.files ?? {})) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content, "utf8");
  }
  for (const pkg of opts.install ?? []) {
    mkdirSync(join(at, "node_modules", pkg), { recursive: true });
    writeFileSync(join(at, "node_modules", pkg, "package.json"), "{}", "utf8");
  }
  return root;
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

type Opts = Partial<Parameters<typeof resolvePlan>[1]>;

function plan(verb: Verb, cwd: string, opts: Opts = {}): Plan {
  return resolvePlan(verb, { cwd, passthrough: [], ...opts });
}

function steps(verb: Verb, cwd: string, opts: Opts = {}): Step[] {
  return plan(verb, cwd, opts).steps.map((s) => s.step);
}

function argv(verb: Verb, cwd: string, opts: Opts = {}): string[][] {
  return steps(verb, cwd, opts).map((s) => (s.kind === "exec" ? s.argv : [s.kind]));
}

function error(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SiteError);
    return (e as Error).message;
  }
  throw new Error("expected a SiteError");
}

describe("Node frameworks", () => {
  it("runs Starlight's own scripts through npm, with npm's -- before the flags", () => {
    const dir = site("starlight", { install: ["astro"] });
    expect(argv("start", dir)).toEqual([["npm", "run", "dev"]]);
    expect(argv("build", dir)).toEqual([["npm", "run", "build"]]);
    expect(argv("preview", dir)).toEqual([
      ["npm", "run", "build"],
      ["npm", "run", "preview"],
    ]);
    expect(
      argv("start", dir, { port: "4000", host: "0.0.0.0", passthrough: ["--open"] }),
    ).toEqual([["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "4000", "--open"]]);
  });

  it("runs every step in the site directory", () => {
    const dir = site("starlight", { at: "docs", install: ["astro"] });
    for (const step of steps("preview", dir)) {
      expect(step).toMatchObject({ kind: "exec", cwd: join(dir, "docs") });
    }
  });

  it("announces the framework, the directory and the command", () => {
    const dir = site("nested", { files: { "docs/node_modules/astro/package.json": "{}" } });
    const [first] = plan("start", dir).steps;
    expect(first?.announce).toBe("Starlight in docs/. Running npm run dev");
    expect(first?.display).toBe("npm run dev");
    expect(first?.notFound).toBe(
      "npm not found on PATH. Install npm, or set site.commands.start.",
    );
  });

  it("accepts a Yarn Plug'n'Play install, which has no node_modules", () => {
    const dir = site("nested", { files: { "docs/.pnp.cjs": "", "docs/yarn.lock": "" } });
    expect(argv("start", dir)).toEqual([["yarn", "run", "dev"]]);
  });

  it("does not take a prototype key for a package manager", () => {
    const dir = site("nested", {
      files: {
        "docs/package.json": JSON.stringify({
          packageManager: "constructor@1",
          scripts: { dev: "astro dev" },
          dependencies: { "@astrojs/starlight": "*" },
        }),
        "docs/pnpm-lock.yaml": "",
        "docs/node_modules/astro/package.json": "{}",
      },
    });
    expect(argv("start", dir)).toEqual([["pnpm", "run", "dev"]]);
  });

  it("runs the binary through npx when package.json has no script", () => {
    const dir = site("docusaurus", { install: ["@docusaurus/core"] });
    expect(argv("start", dir, { port: "3001" })).toEqual([
      ["npx", "docusaurus", "start", "--port", "3001"],
    ]);
    expect(argv("preview", dir)).toEqual([
      ["npx", "docusaurus", "build"],
      ["npx", "docusaurus", "serve"],
    ]);
  });

  it("passes VitePress its root when it is a subdirectory", () => {
    const dir = site("vitepress", { install: ["vitepress"] });
    expect(argv("start", dir)).toEqual([["npx", "vitepress", "dev", "docs"]]);
  });

  it("spells Next's host flag --hostname, for Nextra and Fumadocs alike", () => {
    const nextra = site("nextra", { install: ["next"] });
    expect(argv("start", nextra, { host: "0.0.0.0" })).toEqual([
      ["npx", "next", "dev", "--hostname", "0.0.0.0"],
    ]);
    const fumadocs = site("fumadocs", { install: ["next"] });
    expect(argv("preview", fumadocs)).toEqual([
      ["npx", "next", "build"],
      ["npx", "next", "start"],
    ]);
  });

  it("finds Rspress by its scoped package", () => {
    const dir = site("rspress", { install: ["@rspress/core"] });
    expect(argv("start", dir)).toEqual([["npx", "rspress", "dev"]]);
  });

  it("takes pnpm from the lockfile, with no -- before the flags", () => {
    const dir = site("pnpm", { install: ["astro"] });
    expect(argv("start", dir, { port: "4000" })).toEqual([["pnpm", "run", "dev", "--port", "4000"]]);
  });

  it("walks up to the git root for the lockfile", () => {
    const dir = site("nested", {
      files: { "pnpm-lock.yaml": "", "docs/node_modules/astro/package.json": "{}" },
    });
    expect(argv("start", dir)).toEqual([["pnpm", "run", "dev"]]);
  });

  it("prefers the packageManager field over a lockfile", () => {
    const dir = site("nested", {
      files: {
        "package.json": '{ "packageManager": "yarn@4.0.0" }',
        "package-lock.json": "{}",
        "docs/node_modules/astro/package.json": "{}",
      },
    });
    expect(argv("start", dir)).toEqual([["yarn", "run", "dev"]]);
  });

  it("finds a package hoisted to the workspace root", () => {
    const dir = site("nested", { files: { "node_modules/astro/package.json": "{}" } });
    expect(argv("start", dir)).toEqual([["npm", "run", "dev"]]);
  });

  it("refuses to run when the framework's package is not installed", () => {
    const dir = site("starlight", { at: "docs", files: { "package-lock.json": "{}" } });
    expect(error(() => plan("start", dir))).toBe(
      "astro is not installed for docs/. Run npm ci in docs/ first.",
    );
  });
});

describe("Mintlify and Fern", () => {
  it("runs mint dev, with --port only when one is chosen", () => {
    const dir = site("mintlify");
    expect(argv("start", dir)).toEqual([["mint", "dev"]]);
    expect(argv("start", dir, { port: "3000" })).toEqual([["mint", "dev", "--port", "3000"]]);
    expect(plan("start", dir).steps[0]?.notFound).toBe(
      "mint not found on PATH. Install Mintlify's CLI, or set site.commands.start.",
    );
  });

  it("knows Mintlify's docs.json by its $schema", () => {
    expect(argv("start", site("mintlify-docs-json"))).toEqual([["mint", "dev"]]);
  });

  it("knows a docs.json without $schema by its theme and navigation", () => {
    const dir = site("nothing", {
      files: { "docs.json": JSON.stringify({ theme: "mint", navigation: { tabs: [] } }) },
    });
    expect(argv("start", dir)).toEqual([["mint", "dev"]]);
  });

  it("does not take any docs.json with a theme for Mintlify", () => {
    const dir = site("nothing", { files: { "docs.json": JSON.stringify({ theme: "classic" }) } });
    expect(error(() => plan("start", dir))).toMatch(/^no docs site found in /);
  });

  it("has no local build", () => {
    const dir = site("mintlify");
    const message = "Mintlify has no local build. Run manni site start, or set site.commands.build.";
    expect(error(() => plan("build", dir))).toBe(message);
    expect(error(() => plan("preview", dir))).toBe(message);
  });

  it("refuses --host", () => {
    expect(error(() => plan("start", site("mintlify"), { host: "0.0.0.0" }))).toBe(
      "Mintlify's dev server takes no host option. Drop --host.",
    );
  });

  it("runs Fern from the folder above fern/, however the directory is named", () => {
    const dir = site("fern");
    expect(steps("start", dir)).toEqual([{ kind: "exec", argv: ["fern", "docs", "dev"], cwd: dir }]);
    expect(steps("start", dir, { dir: "fern" })).toEqual(steps("start", dir));
  });
});

describe("Python, Hugo and Jekyll", () => {
  it("passes MkDocs host and port as one -a", () => {
    const dir = site("mkdocs");
    expect(argv("start", dir)).toEqual([["mkdocs", "serve"]]);
    expect(argv("start", dir, { port: "9000" })).toEqual([
      ["mkdocs", "serve", "-a", "127.0.0.1:9000"],
    ]);
  });

  it("previews MkDocs with the built-in server over site/", () => {
    const dir = site("mkdocs");
    const planned = plan("preview", dir).steps;
    expect(planned.map((s) => s.step)).toEqual([
      { kind: "exec", argv: ["mkdocs", "build"], cwd: dir },
      { kind: "static", root: join(dir, "site"), host: "127.0.0.1", port: 8000, base: "/" },
    ]);
    expect(planned[1]?.announce).toBe("");
  });

  it("prefixes uv run when uv.lock is present", () => {
    expect(argv("start", site("uv"))).toEqual([["uv", "run", "mkdocs", "serve"]]);
  });

  it("knows Zensical by zensical.toml, or by mkdocs.yml with zensical required", () => {
    expect(argv("start", site("zensical"))).toEqual([["zensical", "serve"]]);
    expect(argv("start", site("mkdocs-zensical"))).toEqual([["zensical", "serve"]]);
  });

  it("finds Sphinx's source/ and builds under it", () => {
    const dir = site("sphinx");
    expect(argv("start", dir)).toEqual([["sphinx-autobuild", "source", "source/_build/html"]]);
    expect(steps("preview", dir)).toEqual([
      { kind: "exec", argv: ["sphinx-build", "-M", "html", "source", "source/_build"], cwd: dir },
      {
        kind: "static",
        root: join(dir, "source", "_build", "html"),
        host: "127.0.0.1",
        port: 8000,
        base: "/",
      },
    ]);
  });

  it("binds Hugo with --bind and serves public/", () => {
    const dir = site("hugo");
    expect(argv("start", dir, { host: "0.0.0.0" })).toEqual([
      ["hugo", "server", "--bind", "0.0.0.0"],
    ]);
    expect(steps("preview", dir)).toEqual([
      { kind: "exec", argv: ["hugo"], cwd: dir },
      { kind: "static", root: join(dir, "public"), host: "127.0.0.1", port: 1313, base: "/" },
    ]);
  });

  it("runs Jekyll under bundle exec and serves _site/", () => {
    const dir = site("jekyll");
    expect(argv("start", dir)).toEqual([["bundle", "exec", "jekyll", "serve"]]);
    expect(steps("preview", dir)[1]).toMatchObject({ kind: "static", root: join(dir, "_site"), port: 4000 });
  });

  it("appends passthrough args to the verb's own step", () => {
    const dir = site("hugo");
    expect(argv("start", dir, { passthrough: ["--minify"] })).toEqual([
      ["hugo", "server", "--minify"],
    ]);
  });

  it("refuses passthrough args for the built-in server", () => {
    const dir = site("hugo");
    expect(() => steps("preview", dir, { passthrough: ["--minify"] })).toThrow(
      "Hugo previews through manni's built-in server, which takes no extra arguments. Drop the arguments after --.",
    );
  });
});

describe("the collection url", () => {
  let stderr: string[];
  beforeEach(() => {
    resetWarnings();
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supplies the host and port when it is local", () => {
    const dir = site("collection-url", { files: { "docs/node_modules/astro/package.json": "{}" } });
    const [first] = plan("start", dir).steps;
    expect(first?.announce).toBe(
      "Starlight in docs/. Running npm run dev -- --host 127.0.0.1 --port 4321",
    );
  });

  it("loses to the flags", () => {
    const dir = site("collection-url", { files: { "docs/node_modules/astro/package.json": "{}" } });
    expect(argv("preview", dir, { port: "5000" })[1]).toEqual([
      "npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", "5000",
    ]);
  });

  it("is ignored by build", () => {
    const dir = site("collection-url", { files: { "docs/node_modules/astro/package.json": "{}" } });
    expect(argv("build", dir)).toEqual([["npm", "run", "build"]]);
  });

  it("mounts the built-in server at its path", () => {
    const dir = site("mkdocs", {
      files: {
        "manni.config.yaml":
          "collections:\n  - name: site\n    paths: [docs]\n    url: http://localhost:8123/handbook/\n",
      },
    });
    expect(steps("preview", dir)[1]).toEqual({
      kind: "static",
      root: join(dir, "site"),
      host: "localhost",
      port: 8123,
      base: "/handbook/",
    });
  });

  it("mounts at the path that collections on one server share", () => {
    const dir = site("mkdocs", {
      files: {
        "manni.config.yaml":
          "collections:\n  - name: guides\n    paths: [docs/guides]\n    url: http://localhost:8123/handbook/guides/\n  - name: api\n    paths: [docs/api]\n    url: http://localhost:8123/handbook/api/\n",
      },
    });
    expect(steps("preview", dir)[1]).toMatchObject({ kind: "static", port: 8123, base: "/handbook/" });
  });

  it("keeps the url's path when --port and --host are both given", () => {
    const dir = site("mkdocs", {
      files: {
        "manni.config.yaml":
          "collections:\n  - name: site\n    paths: [docs]\n    url: http://localhost:8123/handbook/\n",
      },
    });
    expect(steps("preview", dir, { port: "8001", host: "0.0.0.0" })[1]).toEqual({
      kind: "static",
      root: join(dir, "site"),
      host: "0.0.0.0",
      port: 8001,
      base: "/handbook/",
    });
  });

  it("is not local on a public host", () => {
    const dir = site("mkdocs", {
      files: {
        "manni.config.yaml":
          "collections:\n  - name: site\n    paths: [docs]\n    url: https://docs.example.com/\n",
      },
    });
    expect(argv("start", dir)).toEqual([["mkdocs", "serve"]]);
  });

  it("warns and falls back to the framework's default when local urls disagree", () => {
    const dir = site("starlight", {
      install: ["astro"],
      files: {
        "manni.config.yaml": [
          "collections:",
          "  - name: site",
          "    paths: [docs]",
          "    url: http://127.0.0.1:4321/",
          "  - name: api",
          "    paths: [api]",
          "    url: http://127.0.0.1:4322/",
          "",
        ].join("\n"),
      },
    });
    expect(argv("start", dir)).toEqual([["npm", "run", "dev"]]);
    expect(stderr.join("")).toContain(
      "collections site and api name different local URLs. Using Starlight's default port; pass --port to pick one.",
    );
  });
});

describe("site.commands", () => {
  it("replaces the detected command, in the detected directory", () => {
    const dir = site("override");
    const [first] = plan("start", dir).steps;
    expect(first?.step).toEqual({
      kind: "shell",
      command: "pnpm dev --port 4000",
      cwd: join(dir, "docs"),
    });
    expect(first?.announce).toBe("Running site.commands.start in docs/: pnpm dev --port 4000");
    expect(first?.display).toBe("pnpm dev --port 4000");
  });

  it("refuses --port and --host, which it cannot place", () => {
    const dir = site("override");
    expect(error(() => plan("start", dir, { port: "4000" }))).toBe(
      "--port does not apply to site.commands.start. Put the port in that command.",
    );
    expect(error(() => plan("start", dir, { host: "0.0.0.0" }))).toBe(
      "--host does not apply to site.commands.start. Put the host in that command.",
    );
  });

  it("quotes passthrough args that the shell would split", () => {
    const dir = site("override");
    const [first] = plan("start", dir, { passthrough: ["--title", "My Docs"] }).steps;
    const quoted = process.platform === "win32" ? '"My Docs"' : "'My Docs'";
    expect(first?.step).toMatchObject({ command: `pnpm dev --port 4000 --title ${quoted}` });
  });

  it("names a prefix binary, not the framework, when the prefix is missing", () => {
    const dir = site("mkdocs", { files: { "uv.lock": "" } });
    expect(plan("start", dir).steps[0]?.notFound).toBe(
      "uv not found on PATH. Install uv, or set site.commands.start.",
    );
    expect(plan("start", site("mkdocs")).steps[0]?.notFound).toBe(
      "mkdocs not found on PATH. Install MkDocs's CLI, or set site.commands.start.",
    );
  });

  it("runs in the config file's directory when nothing is detected", () => {
    const dir = site("nothing", {
      files: { "manni.config.yaml": "site:\n  commands:\n    build: make html\n" },
    });
    expect(steps("build", dir)).toEqual([{ kind: "shell", command: "make html", cwd: dir }]);
  });

  it("leaves the other verbs detected: preview builds with the override", () => {
    const dir = site("mkdocs", {
      files: { "manni.config.yaml": "site:\n  commands:\n    build: make docs\n" },
    });
    expect(steps("preview", dir)).toEqual([
      { kind: "shell", command: "make docs", cwd: dir },
      { kind: "static", root: join(dir, "site"), host: "127.0.0.1", port: 8000, base: "/" },
    ]);
  });

  it("takes the site directory from site.dir", () => {
    const dir = site("hugo", {
      at: "handbook",
      files: { "manni.config.yaml": "site:\n  dir: handbook\n" },
    });
    expect(steps("build", dir)).toEqual([{ kind: "exec", argv: ["hugo"], cwd: join(dir, "handbook") }]);
  });

  it("reads -c", () => {
    const dir = site("hugo", {
      files: { "ci/manni.config.yaml": "site:\n  commands:\n    build: hugo --minify\n" },
    });
    expect(steps("build", dir, { configPath: "ci/manni.config.yaml", dir: "." })).toEqual([
      { kind: "shell", command: "hugo --minify", cwd: dir },
    ]);
  });
});

describe("refusals", () => {
  it("says where it looked when nothing is found", () => {
    expect(error(() => plan("start", site("nothing")))).toBe(
      "no docs site found in ./, docs/, website/ or site/. Pass the site's directory, or set site.commands.start in manni.config.yaml.",
    );
  });

  it("names a directory with no markers", () => {
    const dir = site("nothing", { at: "website" });
    expect(error(() => plan("build", dir, { dir: "website" }))).toBe(
      "no docs framework detected in website/. Set site.commands.build in manni.config.yaml.",
    );
  });

  it("names a directory that does not exist", () => {
    expect(error(() => plan("start", site("nothing"), { dir: "website" }))).toBe(
      "website/ does not exist.",
    );
  });

  it("names both sites when one directory holds two", () => {
    const dir = site("ambiguous", { at: "docs" });
    expect(error(() => plan("start", dir))).toBe(
      "docs/ holds more than one docs site: Docusaurus (@docusaurus/core), MkDocs (mkdocs.yml). Set site.commands.start in manni.config.yaml.",
    );
  });

  it.each(["abc", "0", "65536", "1.5", ""])("refuses --port %j", (port) => {
    expect(error(() => plan("start", site("hugo"), { port }))).toBe(
      `--port must be an integer from 1 to 65535, got "${port}".`,
    );
  });
});

describe("site.out and site.annotate.after-build (proposal 0095)", () => {
  it("serves site.out with the built-in server", () => {
    const dir = site("mkdocs", { files: { "manni.config.yaml": "site:\n  out: build/html\n" } });
    expect(steps("preview", dir)[1]).toMatchObject({ kind: "static", root: join(dir, "build", "html") });
  });

  it("annotates after the build when after-build is true, and before preview serves", () => {
    const dir = site("mkdocs", { files: { "manni.config.yaml": "site:\n  annotate:\n    after-build: true\n" } });
    expect(steps("build", dir).map((s) => s.kind)).toEqual(["exec", "annotate"]);
    expect(steps("preview", dir).map((s) => s.kind)).toEqual(["exec", "annotate", "static"]);
    expect(steps("build", dir)[1]).toEqual({ kind: "annotate", cwd: dir, dir });
  });

  it("never annotates start, nor build when after-build is unset", () => {
    const on = site("mkdocs", { files: { "manni.config.yaml": "site:\n  annotate:\n    after-build: true\n" } });
    expect(steps("start", on).map((s) => s.kind)).toEqual(["exec"]);
    rmSync(join(on, "manni.config.yaml"));
    expect(steps("build", on).map((s) => s.kind)).toEqual(["exec"]);
  });
});

describe("Flare (proposal 0125, decision 22)", () => {
  interface HostOptions {
    platform?: NodeJS.Platform;
    env?: Record<string, string>;
    files?: string[];
    dirs?: Record<string, string[]>;
  }

  /** A host where `files` exist and `dirs` list, and nothing else: never the real madbuild. */
  function flareHost(opts: HostOptions = {}): MadbuildHost {
    const files = new Set(opts.files ?? []);
    return {
      platform: opts.platform ?? "win32",
      env: { USERNAME: "maya", ...opts.env },
      isFile: (path) => files.has(path),
      readdir: (path) => opts.dirs?.[path] ?? [],
      username: () => "maya",
    };
  }

  const onPath = flareHost({
    platform: "linux",
    env: { PATH: "/opt/flare" },
    files: ["/opt/flare/madbuild"],
  });
  const target = (name: string): Record<string, string> => ({
    "manni.config.yaml": `tools:\n  flare:\n    target: ${name}\n`,
  });

  it("is detected by a .flprj", () => {
    const dir = site("flare");
    expect(detectFramework(dir)).toBe("Flare");
  });

  it("builds the named target with madbuild, in the project folder", () => {
    const dir = site("flare", { files: target("Print") });
    const [first] = plan("build", dir, { flareHost: onPath }).steps;
    expect(first?.step).toEqual({
      kind: "exec",
      argv: ["madbuild", "-project", "Widget.flprj", "-target", "Print"],
      cwd: dir,
    });
    expect(first?.announce).toBe("Flare in ./. Running madbuild -project Widget.flprj -target Print");
  });

  it("builds the only target when none is named", () => {
    const dir = site("flare-one-target");
    expect(argv("build", dir, { flareHost: onPath })).toEqual([
      ["madbuild", "-project", "Widget.flprj", "-target", "HTML5"],
    ]);
  });

  it("refuses several targets with none named", () => {
    const dir = site("flare");
    expect(error(() => plan("build", dir, { flareHost: onPath }))).toBe(
      "Widget.flprj has 2 targets. Name the one to build with tools.flare.target.",
    );
  });

  it("reads the output folder's account from the system when USERNAME is not set", () => {
    const dir = site("flare", { files: target("HTML5") });
    const host: MadbuildHost = { ...onPath, env: { PATH: "/opt/flare" }, username: () => "devin" };
    expect(error(() => plan("preview", dir, { flareHost: host }))).toBe(
      "No Flare output at Output/devin/HTML5. Run manni site build first.",
    );
  });

  // A container with no user database: os.userInfo() throws there, and the host answers nothing.
  it("refuses cleanly when neither USERNAME nor the system names a user", () => {
    const dir = site("flare", { files: target("HTML5") });
    const host: MadbuildHost = { ...onPath, env: { PATH: "/opt/flare" }, username: () => undefined };
    expect(error(() => plan("preview", dir, { flareHost: host }))).toBe(
      "manni cannot tell whose Output folder to read, because USERNAME is not set and the system names no user. Set USERNAME to the account that runs madbuild.",
    );
  });

  it("refuses a project with no targets, without asking for a name", () => {
    const dir = site("flare-no-targets");
    expect(error(() => plan("build", dir, { flareHost: onPath }))).toBe(
      "Widget.flprj has no targets, so there is nothing to build. Add a target in Flare.",
    );
  });

  // The project's own refusal, which lint and graph print too: a FlareError, exit 2 like a SiteError.
  it("refuses a named target the project does not have", () => {
    const dir = site("flare", { files: target("Web") });
    expect(() => plan("build", dir, { flareHost: onPath })).toThrow(
      new FlareError('tools.flare.target "Web" names no target in Widget.flprj. Its targets are HTML5 and Print.'),
    );
    expect(() => plan("build", dir, { flareHost: onPath })).toThrow(FlareError);
  });

  describe("finding madbuild", () => {
    const programFiles = "C:\\Program Files\\MadCap Software";
    const install = (name: string): string => `${programFiles}\\${name}\\Flare.app\\madbuild.exe`;
    const madbuild = (host: MadbuildHost, files: Record<string, string> = target("HTML5")): string | undefined => {
      const dir = site("flare", { files });
      return argv("build", dir, { flareHost: host })[0]?.[0];
    };

    it("takes PATH first, through PATHEXT on Windows", () => {
      const host = flareHost({
        env: { PATH: "C:\\Flare\\bin", PATHEXT: ".EXE;.CMD", ProgramFiles: "C:\\Program Files" },
        files: ["C:\\Flare\\bin\\madbuild.CMD", install("MadCap Flare 21")],
        dirs: { [programFiles]: ["MadCap Flare 21"] },
      });
      expect(madbuild(host)).toBe("madbuild");
    });

    it("takes tools.flare.home next, resolved against the config file", () => {
      let dir = "";
      const host: MadbuildHost = {
        ...flareHost({ dirs: { [programFiles]: ["MadCap Flare 21"] } }),
        isFile: (path) => path === join(dir, "flare-home", "madbuild.exe") || path === install("MadCap Flare 21"),
      };
      dir = site("flare", {
        files: { "manni.config.yaml": "tools:\n  flare:\n    target: HTML5\n    home: flare-home\n" },
      });
      expect(argv("build", dir, { flareHost: host })[0]?.[0]).toBe(join(dir, "flare-home", "madbuild.exe"));
    });

    it("takes the newest install under Program Files by its version, not its spelling", () => {
      const names = ["MadCap Flare 9", "MadCap Flare 21", "MadCap Flare 19", "MadCap Software Other"];
      const host = flareHost({
        files: names.map(install),
        dirs: { [programFiles]: names },
      });
      expect(madbuild(host)).toBe(install("MadCap Flare 21"));

      const years = ["MadCap Flare 2023", "MadCap Flare 2024 r2", "MadCap Flare 2024"];
      expect(madbuild(flareHost({ files: years.map(install), dirs: { [programFiles]: years } }))).toBe(
        install("MadCap Flare 2024 r2"),
      );
    });

    it("skips an install folder with no madbuild.exe", () => {
      const host = flareHost({
        files: [install("MadCap Flare 19")],
        dirs: { [programFiles]: ["MadCap Flare 19", "MadCap Flare 21"] },
      });
      expect(madbuild(host)).toBe(install("MadCap Flare 19"));
    });

    it("refuses when none is found, and looks under Program Files only on Windows", () => {
      const host = flareHost({
        platform: "linux",
        files: [install("MadCap Flare 21")],
        dirs: { [programFiles]: ["MadCap Flare 21"] },
      });
      const dir = site("flare", { files: target("HTML5") });
      expect(error(() => plan("build", dir, { flareHost: host }))).toBe(
        "madbuild was not found. Install MadCap Flare, or set tools.flare.home to the folder that holds madbuild.exe.",
      );
    });
  });

  it("previews the last build with the built-in server on 4321, with no madbuild", () => {
    const dir = site("flare", { files: { ...target("HTML5"), "Output/maya/HTML5/Default.htm": "" } });
    expect(steps("preview", dir, { flareHost: flareHost() })).toEqual([
      { kind: "static", root: join(dir, "Output", "maya", "HTML5"), host: "127.0.0.1", port: 4321, base: "/" },
    ]);
  });

  it("refuses to preview a target that has not been built", () => {
    const dir = site("flare", { files: target("HTML5") });
    expect(error(() => plan("preview", dir, { flareHost: flareHost() }))).toBe(
      "No Flare output at Output/maya/HTML5. Run manni site build first.",
    );
  });

  it("has no development server", () => {
    const dir = site("flare", { files: target("HTML5") });
    expect(error(() => plan("start", dir, { flareHost: onPath }))).toBe(
      "Flare has no development server. Run manni site build, then manni site preview.",
    );
  });

  it("is not annotated", () => {
    const dir = site("flare", { files: target("HTML5") });
    expect(error(() => resolveAnnotateSite({ cwd: dir }))).toBe("manni site annotate does not read Flare output.");
  });
});
