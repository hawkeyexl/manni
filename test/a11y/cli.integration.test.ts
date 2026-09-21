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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findBrowser } from "../../src/a11y/core/analyzer.js";
import { startSchemaServer, type RouteFn, type SchemaServer } from "../helpers/schema-server.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const manni = resolve(root, "dist", "cli.js");
const site = resolve(root, "test", "fixtures", "a11y", "site");
/** A site whose sitemap parses and names only another host's pages (#77). */
const offhostSite = resolve(root, "test", "fixtures", "a11y", "offhost-sitemap");
const a11yConfig = resolve(root, "test", "fixtures", "a11y", "config");
/** `a11y.crawl: false`, so only `--crawl` can crawl a run that reads it. */
const crawlFalse = resolve(a11yConfig, "crawl-false.yaml");
/** `a11y.maxPages: 1`, so only `--no-max-pages` can uncap a run that reads it. */
const maxPagesOne = resolve(a11yConfig, "max-pages-1.yaml");
/** `a11y.exclude: ["/about.html"]`, so a typed `--exclude` has a list to replace. */
const excludeAbout = resolve(a11yConfig, "exclude-about.yaml");

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
/**
 * Runs from a directory outside the repository, not from `root`. The repo's own
 * manni.config.yaml carries an `a11y:` section (the docs-site dogfood), and
 * config discovery would find it from `root` and apply its `severity` floor
 * and `urls` to every case here. A temp directory has no `.git` above it, so
 * discovery looks in that one directory and finds nothing; every case then
 * sees the built-in defaults unless it names a flag.
 */
const cwd = mkdtempSync(join(tmpdir(), "manni-a11y-cli-"));

/**
 * A second working directory, carrying a family file that declares `guides`
 * with a `url:` and `blog` without one. The seed errors of proposal 0041's
 * rule 12 need a config to name, and `cwd` above has to stay empty so every
 * other case keeps seeing the built-in defaults. Discovery from a temp
 * directory looks in that one directory, so the file is found and reported
 * under the name the user would type.
 */
const collectionsCwd = mkdtempSync(join(tmpdir(), "manni-a11y-collections-"));
writeFileSync(
  join(collectionsCwd, "manni.config.yaml"),
  [
    "collections:",
    "  - name: guides",
    "    paths: [docs/guides]",
    "    url: https://docs.example.com/guides/",
    "  - name: blog",
    "    paths: [docs/blog]",
    "",
  ].join("\n"),
  "utf8",
);

/**
 * The child's own timeout, deliberately below every case's vitest timeout. The
 * two used to be the same 120s, so a child that had to be killed was killed at
 * the exact moment vitest gave up, and nothing was left to report the kill.
 * Under it, a killed child still returns through `close` and
 * `parseJsonRun` names the status.
 */
const CHILD_TIMEOUT = 90_000;

function run(args: string[], timeout = CHILD_TIMEOUT, dir = cwd): Promise<Run> {
  return new Promise((done) => {
    const child = spawn("node", [manni, "a11y", ...args], {
      cwd: dir,
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

const OFFHOST_FILES: Record<string, string> = {
  "/index.html": "text/html; charset=utf-8",
  "/about.html": "text/html; charset=utf-8",
  "/robots.txt": "text/plain; charset=utf-8",
  "/sitemap.xml": "application/xml; charset=utf-8",
};

/**
 * A fixture directory as routes. The port is only known once the server
 * listens, and the bodies need it, so each route is a function that fills
 * `__ORIGIN__` in at request time from the origin recorded after `listen`.
 */
async function serveFixture(
  dir: string,
  files: Record<string, string>,
  extra: Record<string, RouteFn> = {},
): Promise<SchemaServer> {
  let origin = "";
  const routes: Record<string, RouteFn> = { ...extra };
  for (const [path, contentType] of Object.entries(files)) {
    const raw = readFileSync(resolve(dir, path.slice(1)), "utf8");
    routes[path] = () => ({ body: raw.replaceAll("__ORIGIN__", origin), contentType });
  }
  const server = await startSchemaServer(routes);
  origin = server.url;
  return server;
}

function serveSite(): Promise<SchemaServer> {
  return serveFixture(site, FILES, {
    "/styles.css": () => ({ body: "body { margin: 0 }", contentType: "text/css" }),
  });
}

function serveOffhostSite(): Promise<SchemaServer> {
  return serveFixture(offhostSite, OFFHOST_FILES);
}

interface JsonRun {
  results: {
    url: string;
    source: string;
    violations: { id: string; severity: string; impact: string }[];
    score: number | null;
    error?: string;
  }[];
  summary: {
    checked: number;
    discovered: number;
    skipped: number;
    duplicates: number;
    excluded: number;
    failed: number;
    bySeverity: Record<string, number>;
    sitemap: string | null;
    sitemapPages: number;
  };
}

/**
 * A report run's stdout, parsed only once the run itself looks sound.
 *
 * `JSON.parse` on its own turns any failed run into `Unexpected end of JSON
 * input`, which names neither the exit status nor the cause. A Chromium that
 * crashes, is killed, or launches too slowly is the likeliest reason a report
 * is missing here, and that has to read as a browser failure rather than as
 * malformed JSON. A clean run exits 0 and a run with violations exits 1; both
 * print a report, so anything else means no report was written.
 */
function parseJsonRun(result: Run): JsonRun {
  const status =
    result.status === null ? "no exit status (killed)" : `exit ${String(result.status)}`;
  const tail = result.stderr.trim().slice(-500) || "(stderr empty)";
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`manni a11y check failed: ${status}. stderr: ${tail}`);
  }
  if (result.stdout.trim() === "") {
    throw new Error(`manni a11y check wrote no report: ${status}. stderr: ${tail}`);
  }
  return JSON.parse(result.stdout) as JsonRun;
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

  it("with no URLs, no collection url and no config is an operational error", async () => {
    const r = await run(["check", "--no-config"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /^manni: No URLs to check\. Pass one or more, set url: on a collection, or set a11y\.urls in manni\.config\.yaml\./,
    );
  });

  it("parseJsonRun reports a failed command as a failed command", async () => {
    // The regression this pins: every JSON case used to call
    // `JSON.parse(r.stdout)` straight. A run that dies before printing
    // anything then fails as `SyntaxError: Unexpected end of JSON input`,
    // naming neither the exit status nor the reason, so a killed Chromium read
    // as malformed JSON. This run is the cheap stand-in: it exits non-zero
    // with an empty stdout and a real message on stderr.
    const r = await run(["check", "--no-config"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(() => parseJsonRun(r)).toThrow(/exit 2/);
    expect(() => parseJsonRun(r)).toThrow(/No URLs to check/);
  });

  it("refuses --collection together with positional URLs", async () => {
    const r = await run(
      ["check", "--collection", "guides", "https://x.example/"],
      CHILD_TIMEOUT,
      collectionsCwd,
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /^manni: --collection selects a configured collection; it cannot be combined with URLs\./,
    );
  });

  it("refuses a --collection that declares no url:", async () => {
    const r = await run(["check", "--collection", "blog"], CHILD_TIMEOUT, collectionsCwd);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^manni: collection "blog" has no url: to check\./);
  });

  it("refuses an unknown --collection, listing what is configured", async () => {
    const r = await run(["check", "--collection", "gides"], CHILD_TIMEOUT, collectionsCwd);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /^manni: no collection named "gides" in manni\.config\.yaml\. Configured: guides, blog\./,
    );
  });

  // The same sentence `manni meta` uses for the same combination: the flag
  // selects from a config file, so the absence of one is the thing to report,
  // not the name.
  it("refuses --collection when the config is refused", async () => {
    const r = await run(
      ["check", "--collection", "guides", "--no-config"],
      CHILD_TIMEOUT,
      collectionsCwd,
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /^manni: --collection needs a config file to select from\./,
    );
  });

  it("documents --collection and the collection fallback on the seeds", async () => {
    const r = await run(["check", "--help"]);
    expect(r.status).toBe(0);
    // commander wraps a long description, so match across whitespace.
    expect(r.stdout).toMatch(/--collection <name>\s+configured collection to run over; repeatable/);
    // Commander lists the variadic under Arguments as the bare name.
    expect(r.stdout).toMatch(
      /urls\s+http\(s\) seed URLs; falls back to a collection's url:\s+or\s+a11y\.urls in manni\.config\.yaml/,
    );
  });

  it("rejects an unknown --format", async () => {
    const r = await run(["check", "https://x.example/", "-f", "sarif"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni: Unknown --format "sarif"\. Use pretty \| json \| github\./);
  });

  it("rejects an unknown --severity, axe's own words included", async () => {
    for (const bad of ["high", "serious"]) {
      const r = await run(["check", "https://x.example/", "--severity", bad]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(
        new RegExp(`^manni: Unknown --severity "${bad}"\\. Use notice \\| warning \\| error\\.`),
      );
    }
  });

  it("documents --severity on the family scale with notice as the default", async () => {
    const r = await run(["check", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /--severity <level>\s+minimum severity reported: notice \| warning \| error\s+\(default: "notice"\)/,
    );
  });

  it("rejects a --max-pages below 1 or not an integer", async () => {
    for (const bad of ["0", "-3", "2.5", "many", "01"]) {
      const r = await run(["check", "https://x.example/", "--max-pages", bad]);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^manni: --max-pages must be an integer >= 1\./);
    }
  }, 30_000);

  it("rejects a --timeout below 1", async () => {
    const r = await run(["check", "https://x.example/", "--timeout", "0"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^manni: --timeout must be an integer >= 1\./);
  });

  it("documents --max-pages as opt-in, with no default cap", async () => {
    const r = await run(["check", "--help"]);
    expect(r.status).toBe(0);
    // commander wraps a long description onto continuation lines, so match
    // across whitespace rather than within one line.
    expect(r.stdout).toMatch(
      /--max-pages <n>\s+cap on pages checked; the rest are reported as skipped\s+\(default: no cap\)/,
    );
    expect(r.stdout).not.toMatch(/--max-pages[^\n]*\n?[^\n]*default: "?\d/);
  });

  it("documents --crawl and --no-max-pages beside the flags they undo", async () => {
    const r = await run(["check", "--help"]);
    expect(r.status).toBe(0);
    // commander wraps a long description at a width it picks from the
    // stream, so every gap here is `\s+` rather than a literal space.
    expect(r.stdout).toMatch(
      /--crawl\s+crawl\s+from\s+the\s+given\s+URLs:\s+sitemap\s+and\s+link\s+following\s+\(default\)/,
    );
    expect(r.stdout).toMatch(
      /--no-max-pages\s+check\s+every\s+page\s+found,\s+ignoring\s+a\s+configured\s+maxPages/,
    );
    // Both halves of each pair are on the screen, not just the negation.
    expect(r.stdout).toMatch(/--no-crawl\s+check\s+exactly\s+the\s+given\s+URLs/);
  });

  it("rejects an --exclude pattern that cannot match a path", async () => {
    const r = await run(["check", "https://x.example/", "--exclude", "proposals/**"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /^manni: --exclude "proposals\/\*\*" must start with "\/": it matches a URL path\./,
    );
  });

  it("refuses a seed its own --exclude pattern excludes", async () => {
    const r = await run([
      "check",
      "https://example.com/proposals/",
      "--exclude",
      "/proposals/**",
    ]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(
      /^manni: --exclude "\/proposals\/\*\*" excludes the seed https:\/\/example\.com\/proposals\/\./,
    );
  });

  it("names every excluded seed before exiting, not just the first", async () => {
    const r = await run([
      "check",
      "https://example.com/proposals/",
      "https://example.com/blog/",
      "--exclude",
      "/proposals/**",
      "--exclude",
      "/blog/**",
    ]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr.trimEnd().split("\n")).toEqual([
      'manni: --exclude "/proposals/**" excludes the seed https://example.com/proposals/.',
      'manni: --exclude "/blog/**" excludes the seed https://example.com/blog/.',
    ]);
  });

  it("refuses a seed a configured pattern excludes, naming the file and the key", async () => {
    // No --exclude is typed, so the message must not mention one. The fixture
    // holds `a11y.exclude: ["/about.html"]` as its only entry.
    const r = await run([
      "check",
      "https://example.com/about.html",
      "-c",
      excludeAbout,
    ]);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain(
      'a11y.exclude[0]" excludes the seed https://example.com/about.html.',
    );
    expect(r.stderr).not.toContain("--exclude");
  });

  it("wants a value for --exclude", async () => {
    const r = await run(["check", "https://x.example/", "--exclude"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/option '--exclude <glob>' argument missing/);
  });

  it("documents --exclude as repeatable, one glob per occurrence", async () => {
    const r = await run(["check", "--help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(
      /--exclude <glob>\s+URL path glob to keep out of the crawl; repeatable/,
    );
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
    // The sitemap supplied every discovered page, so the header names it and
    // says nothing else. Pinned whole: this is the line #77 must not disturb.
    expect(r.stdout.split("\n")[0]).toBe(
      `Checked 3 of 3 pages (sitemap: ${server.url}/sitemap.xml)`,
    );
  }, 120_000);

  it("treats the seed's spelling and the sitemap's as one page across a trailing slash", async () => {
    // The fixture server answers `/index.html/` with a 404 page, which still
    // loads. The sitemap lists `/index.html`, and that spelling must not be
    // checked as a second page.
    const r = await run(["check", `${server.url}/index.html/`, "-f", "json"]);
    const json = parseJsonRun(r);
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
    const json = parseJsonRun(r);
    expect(json.results.map((p) => p.url)).toEqual([`${server.url}/index.html`]);
    expect(json.summary.checked).toBe(1);
    expect(json.summary.failed).toBe(0);
    expect(json.results[0]?.score).toBe(100);
  }, 120_000);

  it("--max-pages caps the run and reports the rest as skipped", async () => {
    const r = await run(["check", `${server.url}/index.html`, "--max-pages", "1", "-f", "json"]);
    const json = parseJsonRun(r);
    expect(json.summary.checked).toBe(1);
    expect(json.summary.skipped).toBeGreaterThanOrEqual(1);
    expect(r.stdout).not.toContain("about.html");
  }, 120_000);

  it("--crawl turns a configured crawl: false back on for one run", async () => {
    const off = await run(["check", `${server.url}/index.html`, "-c", crawlFalse, "-f", "json"]);
    const capped = parseJsonRun(off);
    expect(capped.summary.checked).toBe(1);

    const on = await run([
      "check",
      `${server.url}/index.html`,
      "-c",
      crawlFalse,
      "--crawl",
      "-f",
      "json",
    ]);
    const json = parseJsonRun(on);
    expect(json.summary.checked).toBe(3);
    expect(json.results.map((p) => p.url)).toContain(`${server.url}/about.html`);
  }, 120_000);

  it("--no-max-pages removes a configured maxPages for one run", async () => {
    const off = await run(["check", `${server.url}/index.html`, "-c", maxPagesOne, "-f", "json"]);
    const capped = parseJsonRun(off);
    expect(capped.summary.checked).toBe(1);
    expect(capped.summary.skipped).toBeGreaterThanOrEqual(1);

    const on = await run([
      "check",
      `${server.url}/index.html`,
      "-c",
      maxPagesOne,
      "--no-max-pages",
      "-f",
      "json",
    ]);
    const json = parseJsonRun(on);
    expect(json.summary.checked).toBe(3);
    expect(json.summary.skipped).toBe(0);
  }, 120_000);

  it("--crawl and --no-max-pages change nothing when config sets neither key", async () => {
    const r = await run([
      "check",
      `${server.url}/index.html`,
      "--crawl",
      "--no-max-pages",
      "-f",
      "json",
    ]);
    const json = parseJsonRun(r);
    expect(json.summary.checked).toBe(3);
    expect(json.summary.discovered).toBe(3);
    expect(json.summary.skipped).toBe(0);
  }, 120_000);

  it("takes the last of --max-pages and --no-max-pages, the way commander does", async () => {
    // The pair behaves like --crawl/--no-crawl above, and for the same reason:
    // both halves write the one `maxPages` option, so commander keeps whichever
    // was written last. Pinned here because the two pairs are the only place
    // the tool relies on that, and a regression would be silent.
    const capped = await run([
      "check",
      `${server.url}/index.html`,
      "--no-max-pages",
      "--max-pages",
      "1",
      "-f",
      "json",
    ]);
    const cappedJson = parseJsonRun(capped);
    expect(cappedJson.summary.checked).toBe(1);
    expect(cappedJson.summary.skipped).toBe(2);

    const uncapped = await run([
      "check",
      `${server.url}/index.html`,
      "--max-pages",
      "1",
      "--no-max-pages",
      "-f",
      "json",
    ]);
    const uncappedJson = parseJsonRun(uncapped);
    expect(uncappedJson.summary.checked).toBe(3);
    expect(uncappedJson.summary.skipped).toBe(0);
    // 240s, not the 120s every other case gets. This is the only case that
    // runs two real crawls of the three-page fixture, and it took 75 of its
    // 120 seconds on a loaded macOS runner before it flaked. Two children may
    // each need up to CHILD_TIMEOUT, so the vitest budget has to clear
    // 2 x 90s for a kill to be reported rather than raced.
  }, 240_000);

  it("--exclude keeps a page out and counts it beside the discovered total", async () => {
    const r = await run([
      "check",
      `${server.url}/index.html`,
      "--exclude",
      "/about.html",
      "-f",
      "json",
    ]);
    const json = JSON.parse(r.stdout) as JsonRun;
    expect(json.results.map((p) => p.url)).toEqual([
      `${server.url}/index.html`,
      `${server.url}/orphan.html`,
    ]);
    expect(json.summary).toMatchObject({ discovered: 2, checked: 2, excluded: 1 });
    // The identity holds: an excluded URL never entered the frontier.
    const { checked, skipped, duplicates, discovered } = json.summary;
    expect(checked + skipped + duplicates).toBe(discovered);
  }, 120_000);

  it("takes one glob per --exclude occurrence and never splits on a comma", async () => {
    const repeated = await run([
      "check",
      `${server.url}/index.html`,
      "--exclude",
      "/about.html",
      "--exclude",
      "/orphan.html",
      "-f",
      "json",
    ]);
    const repeatedJson = JSON.parse(repeated.stdout) as JsonRun;
    expect(repeatedJson.summary).toMatchObject({ checked: 1, excluded: 2 });

    // One value with a comma in it is one pattern, which matches no path here,
    // so nothing is excluded and every page is checked.
    const commas = await run([
      "check",
      `${server.url}/index.html`,
      "--exclude",
      "/about.html,/orphan.html",
      "-f",
      "json",
    ]);
    const commasJson = JSON.parse(commas.stdout) as JsonRun;
    expect(commasJson.summary).toMatchObject({ checked: 3, excluded: 0 });
  }, 180_000);

  it("a typed --exclude replaces a11y.exclude rather than adding to it", async () => {
    const fromConfig = await run([
      "check",
      `${server.url}/index.html`,
      "-c",
      excludeAbout,
      "-f",
      "json",
    ]);
    const configJson = JSON.parse(fromConfig.stdout) as JsonRun;
    expect(configJson.results.map((p) => p.url)).toEqual([
      `${server.url}/index.html`,
      `${server.url}/orphan.html`,
    ]);
    expect(configJson.summary.excluded).toBe(1);

    const overridden = await run([
      "check",
      `${server.url}/index.html`,
      "-c",
      excludeAbout,
      "--exclude",
      "/orphan.html",
      "-f",
      "json",
    ]);
    const overriddenJson = JSON.parse(overridden.stdout) as JsonRun;
    // about.html is checked again: the flag replaced the config's list.
    expect(overriddenJson.results.map((p) => p.url)).toEqual([
      `${server.url}/index.html`,
      `${server.url}/about.html`,
    ]);
    expect(overriddenJson.summary.excluded).toBe(1);
  }, 180_000);

  it("the pretty footer says how much was excluded, and --progress says it once", async () => {
    const r = await run([
      "check",
      `${server.url}/index.html`,
      "--exclude",
      "/about.html",
      "--exclude",
      "/orphan.html",
      "--progress",
    ]);
    expect(r.stdout.trimEnd().split("\n").at(-1)).toBe(
      "0 violations on 0 of 1 pages; 2 excluded",
    );
    const lines = r.stderr.trimEnd().split("\n");
    expect(lines).toContain("manni: excluded 2 pages (2 patterns)");
    expect(lines.filter((l) => l.includes("excluded"))).toHaveLength(1);
    // The exclusion line lands once discovery has settled, before the browser.
    expect(lines.indexOf("manni: excluded 2 pages (2 patterns)")).toBeLessThan(
      lines.indexOf("manni: starting browser"),
    );
  }, 120_000);

  it("says nothing about exclusions on a run that excludes nothing", async () => {
    const r = await run(["check", `${server.url}/index.html`, "--progress"]);
    expect(r.stdout).not.toContain("excluded");
    expect(r.stderr).not.toContain("excluded");
  }, 120_000);

  it("takes the last of --crawl and --no-crawl, the way commander does", async () => {
    const off = await run([
      "check",
      `${server.url}/index.html`,
      "--crawl",
      "--no-crawl",
      "-f",
      "json",
    ]);
    expect(parseJsonRun(off).summary.checked).toBe(1);

    const on = await run([
      "check",
      `${server.url}/index.html`,
      "--no-crawl",
      "--crawl",
      "-f",
      "json",
    ]);
    expect(parseJsonRun(on).summary.checked).toBe(3);
  }, 120_000);

  it("--severity error keeps every finding on the about page, and each carries axe's impact", async () => {
    // The fixture's four findings are critical (image-alt, button-name) and
    // serious (color-contrast, html-has-lang) in axe's scale, and both map to
    // `error`. So the floor drops nothing here; what it proves is the map,
    // and that axe's word survives beside the family one.
    const r = await run([
      "check",
      `${server.url}/about.html`,
      "--no-crawl",
      "--severity",
      "error",
      "-f",
      "json",
    ]);
    expect(r.status).toBe(1);
    const json = parseJsonRun(r);
    const found = Object.fromEntries(
      (json.results[0]?.violations ?? []).map((v) => [v.id, [v.severity, v.impact]]),
    );
    expect(found).toMatchObject({
      "image-alt": ["error", "critical"],
      "button-name": ["error", "critical"],
      "color-contrast": ["error", "serious"],
      "html-has-lang": ["error", "serious"],
    });
    expect(json.summary.bySeverity).toEqual({ notice: 0, warning: 0, error: 4 });
  }, 120_000);

  it("the pretty report leads with the family level and keeps axe's word after the rule", async () => {
    const r = await run(["check", `${server.url}/about.html`, "--no-crawl"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^✗ \S+about\.html  score \d+  4 errors$/m);
    expect(r.stdout).toMatch(/^    error  image-alt \(axe: critical\)  \d+ nodes?  /m);
    expect(r.stdout).toMatch(/^    error  color-contrast \(axe: serious\)  /m);
    expect(r.stdout).not.toMatch(/^    (critical|serious) /m);
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
    const json = parseJsonRun(r);
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
    // Every line is a workflow command at one of GitHub's three levels, which
    // are the family's own. The fixture's findings are all critical or serious
    // in axe's scale, so every one is `error` and lands as `::error`;
    // `color-contrast` is the serious one.
    const lines = bad.stdout.trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^::(error|warning|notice) title=a11y\//);
    expect(bad.stdout).toMatch(/^::error title=a11y\/image-alt::/m);
    expect(bad.stdout).toMatch(/^::error title=a11y\/color-contrast::/m);
    const ok = await run(["check", `${server.url}/index.html`, "--no-crawl", "-f", "github"]);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe("");
  }, 120_000);
});

/**
 * Issue #77, end to end: a sitemap that is found, parses, and supplies no page
 * the crawl can use, because every `<loc>` in it names another host. The run
 * must credit the links that actually did the work, and still say which
 * sitemap it read, since "found one, it was useless" is the thing a person
 * debugging a short crawl wants to know.
 */
describe.skipIf(browser === null)("a sitemap that supplied no pages (built bin, real browser)", () => {
  let server: SchemaServer;

  beforeAll(async () => {
    if (!existsSync(manni)) execSync("npm run build", { cwd: root, stdio: "ignore" });
    server = await serveOffhostSite();
  }, 180_000);

  afterAll(async () => {
    await server.close();
  });

  it("names the sitemap, its zero pages, and the links that found the site", async () => {
    const r = await run(["check", `${server.url}/index.html`]);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n")[0]).toBe(
      `Checked 2 of 2 pages (sitemap: ${server.url}/sitemap.xml, 0 pages; followed links)`,
    );
    expect(r.stdout).toContain(`${server.url}/about.html`);
    expect(r.stdout).not.toContain("published.example");
  }, 120_000);

  it("agrees with itself: stdout, stderr and the JSON all report zero", async () => {
    const r = await run(["check", `${server.url}/index.html`, "-f", "json", "--progress"]);
    expect(r.stderr).toContain(`manni: sitemap ${server.url}/sitemap.xml (0 pages)`);
    const json = parseJsonRun(r);
    expect(json.summary.sitemap).toBe(`${server.url}/sitemap.xml`);
    expect(json.summary.sitemapPages).toBe(0);
    // The contradiction in #77: every page carries `link`, never `sitemap`.
    expect(json.results.map((p) => p.source)).toEqual(["seed", "link"]);
  }, 120_000);
});
