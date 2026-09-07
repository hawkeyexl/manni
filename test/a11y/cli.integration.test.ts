/**
 * `manni a11y check` end to end, against the built `dist/cli.js` and a real
 * browser. The fixture site under `test/fixtures/a11y/site/` is served from an
 * ephemeral local port; `__ORIGIN__` in its robots.txt and sitemaps is filled
 * in with that port at serve time, so the sitemap's `<loc>`s point back at the
 * server the crawl is walking.
 *
 * The browser-backed block skips cleanly when `findBrowser()` finds nothing to
 * launch. The usage errors need no browser and always run: every one of them
 * has to be raised before the analyzer is ever asked to launch.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findBrowser } from "../../src/a11y/core/analyzer.js";
import { startSchemaServer, type RouteFn, type SchemaServer } from "../helpers/schema-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const site = resolve(root, "test", "fixtures", "a11y", "site");

const browser = await findBrowser();

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

/**
 * Asynchronous on purpose. The fixture server runs on this worker's event
 * loop, and a `spawnSync` here would block that loop for the child's whole
 * life, so the browser's requests would never be answered and every page
 * would time out.
 */
function run(args: string[], timeout = 120_000): Promise<Run> {
  return new Promise((done) => {
    const child = spawn("node", [manni, "a11y", ...args], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      timeout,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      done({ stdout, stderr, status });
    });
  });
}

const FILES: Record<string, string> = {
  "/index.html": "text/html; charset=utf-8",
  "/about.html": "text/html; charset=utf-8",
  "/orphan.html": "text/html; charset=utf-8",
  "/robots.txt": "text/plain; charset=utf-8",
  "/sitemap.xml": "application/xml; charset=utf-8",
  "/sitemap-index.xml": "application/xml; charset=utf-8",
};

/**
 * The fixture site as routes. The port is only known once the server listens,
 * and the bodies need it, so each route is a function that fills `__ORIGIN__`
 * in at request time from the origin recorded after `listen`.
 */
async function serveSite(): Promise<SchemaServer> {
  let origin = "";
  const routes: Record<string, RouteFn> = {
    "/styles.css": () => ({ body: "body { margin: 0 }", contentType: "text/css" }),
  };
  for (const [path, contentType] of Object.entries(FILES)) {
    const raw = readFileSync(resolve(site, path.slice(1)), "utf8");
    routes[path] = () => ({ body: raw.replaceAll("__ORIGIN__", origin), contentType });
  }
  const server = await startSchemaServer(routes);
  origin = server.url;
  return server;
}

interface JsonRun {
  results: { url: string; violations: { id: string }[]; score: number | null; error?: string }[];
  summary: {
    checked: number;
    discovered: number;
    skipped: number;
    duplicates: number;
    failed: number;
  };
}

describe("manni a11y check (usage errors, no browser needed)", () => {
  beforeAll(() => {
    if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
  }, 180_000);

  it("rejects a seed that is not an http(s) URL", async () => {
    const r = await run(["check", "not-a-url"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^manni: Not an http\(s\) URL: "not-a-url"\./);
  });

  it("with no URLs and no config is an operational error", async () => {
    const r = await run(["check", "--no-config"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni: No URLs to check\./);
  });

  it("rejects an unknown --format", async () => {
    const r = await run(["check", "https://x.example/", "-f", "sarif"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni: Unknown --format "sarif"\. Use pretty \| json \| github\./);
  });

  it("rejects an unknown --impact", async () => {
    const r = await run(["check", "https://x.example/", "--impact", "high"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(
      /^manni: Unknown --impact "high"\. Use minor \| moderate \| serious \| critical\./,
    );
  });

  it("rejects a --max-pages below 1 or not an integer", async () => {
    for (const bad of ["0", "-3", "2.5", "many", "01"]) {
      const r = await run(["check", "https://x.example/", "--max-pages", bad]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^manni: --max-pages must be an integer >= 1\./);
    }
  });

  it("rejects a --timeout below 1", async () => {
    const r = await run(["check", "https://x.example/", "--timeout", "0"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni: --timeout must be an integer >= 1\./);
  });

  it("a11y alone is a usage error with no default subcommand", async () => {
    const r = await run([]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    // commander answers a missing subcommand with the help screen on stderr.
    expect(r.stderr).toMatch(/^Usage: manni a11y /m);
    expect(r.stderr).toMatch(/^\s+check\b/m);
  });
});

describe.skipIf(browser === null)("manni a11y check (built bin, real browser)", () => {
  let server: SchemaServer;

  beforeAll(async () => {
    if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
    server = await serveSite();
  }, 180_000);

  afterAll(async () => {
    await server.close();
  });

  it("crawls the fixture site from its front page and stays on the host", async () => {
    const r = await run(["check", `${server.url}/index.html`]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`sitemap: ${server.url}/sitemap.xml`);
    expect(r.stdout).toContain(`${server.url}/index.html`);
    expect(r.stdout).toContain(`${server.url}/about.html`);
    // Linked from nowhere; only the sitemap knows it.
    expect(r.stdout).toContain(`${server.url}/orphan.html`);
    expect(r.stdout).not.toContain("example.org");
    expect(r.stdout).not.toContain("styles.css");
    for (const rule of ["html-has-lang", "image-alt", "button-name", "color-contrast"]) {
      expect(r.stdout).toContain(rule);
    }
    expect(r.stdout).toMatch(/score \d+/);
    expect(r.stdout).toMatch(/^Checked 3 of 3 pages/m);
  }, 120_000);

  it("treats the seed's spelling and the sitemap's as one page across a trailing slash", async () => {
    // The fixture server answers `/index.html/` with a 404 page, which still
    // loads. The sitemap lists `/index.html`, and that spelling must not be
    // checked as a second page.
    const r = await run(["check", `${server.url}/index.html/`, "-f", "json"]);
    const json = JSON.parse(r.stdout) as JsonRun;
    const urls = json.results.map((p) => p.url);
    expect(urls[0]).toBe(`${server.url}/index.html/`);
    expect(urls).not.toContain(`${server.url}/index.html`);
    expect(urls).toContain(`${server.url}/about.html`);
    expect(json.summary.checked).toBe(3);
    expect(json.summary.discovered).toBe(3);
    expect(json.summary.duplicates).toBe(0);
  }, 120_000);

  it("--no-crawl checks exactly the given page", async () => {
    const r = await run(["check", `${server.url}/index.html`, "--no-crawl", "-f", "json"]);
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as JsonRun;
    expect(json.results.map((p) => p.url)).toEqual([`${server.url}/index.html`]);
    expect(json.summary.checked).toBe(1);
    expect(json.summary.failed).toBe(0);
    expect(json.results[0]?.score).toBe(100);
  }, 120_000);

  it("--max-pages caps the run and reports the rest as skipped", async () => {
    const r = await run(["check", `${server.url}/index.html`, "--max-pages", "1", "-f", "json"]);
    const json = JSON.parse(r.stdout) as JsonRun;
    expect(json.summary.checked).toBe(1);
    expect(json.summary.skipped).toBeGreaterThanOrEqual(1);
    expect(r.stdout).not.toContain("about.html");
  }, 120_000);

  it("--impact critical drops the findings below it", async () => {
    const r = await run(["check", `${server.url}/about.html`, "--no-crawl", "--impact", "critical"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("image-alt");
    expect(r.stdout).not.toContain("color-contrast");
    expect(r.stdout).not.toContain("html-has-lang");
  }, 120_000);

  it("--progress reports each page on stderr and leaves stdout to the report", async () => {
    // stderr is a pipe here, so this is the plain, one-line-per-event form.
    const r = await run(["check", `${server.url}/index.html`, "-f", "json", "--progress"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("manni: starting browser\n");
    expect(r.stderr).toContain(`manni: sitemap ${server.url}/sitemap.xml (`);
    expect(r.stderr).toContain(`manni: [1/`);
    expect(r.stderr).toMatch(/^manni: checked 3 pages, 0 skipped$/m);
    expect(r.stderr).not.toContain("\x1b");
    // The report is still the whole of stdout.
    const json = JSON.parse(r.stdout) as JsonRun;
    expect(json.summary.checked).toBe(3);
  }, 120_000);

  it("--no-progress says nothing on stderr", async () => {
    const r = await run(["check", `${server.url}/index.html`, "--no-crawl", "--no-progress"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  }, 120_000);

  it("reports no progress by default when stderr is not a terminal", async () => {
    const r = await run(["check", `${server.url}/index.html`, "--no-crawl"]);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  }, 120_000);

  it("--format github annotates each violation and says nothing when clean", async () => {
    const bad = await run(["check", `${server.url}/about.html`, "--no-crawl", "-f", "github"]);
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/^::error title=a11y\/image-alt::/m);
    const ok = await run(["check", `${server.url}/index.html`, "--no-crawl", "-f", "github"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe("");
  }, 120_000);
});
