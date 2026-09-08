/**
 * A URL form of `sidecars[].file` (proposal 0038).
 *
 * The rules under test:
 *
 *  - A public manifest is a plain GET: one public repository's pages take
 *    keys from a file in another, with no token anywhere.
 *  - A private one sends the bearer token `tokenEnv` names, to the origin the
 *    config named and nowhere else: a cross-origin redirect drops it.
 *  - Fetched every run, never cached; a fetch that fails is exit 2 naming the
 *    URL and the status, never the token; `--offline` refuses up front.
 *  - The merged result is indistinguishable from a local manifest, and a
 *    finding on a fetched value names the URL and the manifest line.
 */
import { afterEach, describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { startSchemaServer, type SchemaServer } from "./helpers/schema-server.js";
import { fetchSidecar, sidecarUrlProblem } from "../src/meta/core/sidecar-fetch.js";
import { loadSidecars } from "../src/meta/core/sidecars.js";
import { parseConfig } from "../src/meta/core/config.js";
import { runValidate } from "../src/meta/commands/validate.js";
import { DocmetaError } from "../src/meta/types.js";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = resolve(here, "fixtures", "sidecars");

const MANIFEST = [
  "# served, not read",
  "docs/auth.md:",
  "  source: remote/auth.md",
  "  jira: PLAT-1",
  "docs/billing.md:",
  "  jira: nope",
  "docs/ops.md:",
  "  jira: PLAT-9",
].join("\n");

let server: SchemaServer | undefined;
let second: SchemaServer | undefined;
afterEach(async () => {
  await server?.close();
  await second?.close();
  server = undefined;
  second = undefined;
});

describe("sidecar URLs: what a config may name", () => {
  it("accepts https, and http on a loopback host only", () => {
    expect(sidecarUrlProblem("https://example.com/m.yaml")).toBeNull();
    expect(sidecarUrlProblem("http://127.0.0.1:8080/m.yaml")).toBeNull();
    expect(sidecarUrlProblem("http://localhost/m.yaml")).toBeNull();
    expect(sidecarUrlProblem("http://example.com/m.yaml")).toMatch(/plain http/);
  });

  it("refuses a credential inside the URL, pointing at tokenEnv", () => {
    expect(sidecarUrlProblem("https://user:secret@example.com/m.yaml")).toMatch(
      /credential in the URL.*tokenEnv/,
    );
  });

  it("refuses tokenEnv on a path, where it would do nothing", () => {
    expect(() =>
      parseConfig(
        ["sidecars:", "  - file: ./m.yaml", "    keys: [jira]", "    tokenEnv: T"].join("\n"),
        "manni.config.yaml",
      ),
    ).toThrow(/tokenEnv is set, but "file" is a path/);
  });

  it("parses a URL entry with and without tokenEnv", () => {
    const cfg = parseConfig(
      [
        "sidecars:",
        "  - file: https://example.com/public.yaml",
        "    keys: [team]",
        "  - file: https://example.com/private.yaml",
        "    keys: [jira]",
        "    tokenEnv: PRIVATE_DOCS_TOKEN",
      ].join("\n"),
      "manni.config.yaml",
    );
    expect(cfg.sidecars).toEqual([
      { file: "https://example.com/public.yaml", keys: ["team"] },
      { file: "https://example.com/private.yaml", keys: ["jira"], tokenEnv: "PRIVATE_DOCS_TOKEN" },
    ]);
  });

  it("refuses a plain-http URL and a URL with userinfo at parse time", () => {
    const bad = (file: string) =>
      parseConfig(["sidecars:", `  - file: ${file}`, "    keys: [jira]"].join("\n"), "c.yaml");
    expect(() => bad("http://example.com/m.yaml")).toThrow(/sidecars\[0\]\.file is plain http/);
    expect(() => bad("https://u:p@example.com/m.yaml")).toThrow(/carries a credential/);
  });
});

describe("sidecar URLs: fetching", () => {
  it("fetches a public manifest anonymously", async () => {
    server = await startSchemaServer({ "/m.yaml": { body: MANIFEST, contentType: "text/plain" } });
    const text = await fetchSidecar(`${server.url}/m.yaml`);
    expect(text).toBe(MANIFEST);
    const auth = server.requests()[0]?.headers.authorization;
    expect(auth).toBeUndefined();
  });

  it("sends the bearer token tokenEnv names, and nothing about it in a failure", async () => {
    server = await startSchemaServer({
      "/m.yaml": { body: MANIFEST, contentType: "text/plain" },
      "/gone.yaml": { status: 404, body: "no" },
    });
    const env = { PRIVATE_DOCS_TOKEN: "s3cret" };
    await fetchSidecar(`${server.url}/m.yaml`, { tokenEnv: "PRIVATE_DOCS_TOKEN", env });
    expect(server.requests()[0]?.headers.authorization).toBe("Bearer s3cret");

    let message = "";
    try {
      await fetchSidecar(`${server.url}/gone.yaml`, { tokenEnv: "PRIVATE_DOCS_TOKEN", env });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/gone\.yaml could not be fetched: HTTP 404/);
    expect(message).not.toContain("s3cret");
  });

  it("is an operational error when the named variable is not set", async () => {
    server = await startSchemaServer({ "/m.yaml": { body: MANIFEST } });
    await expect(
      fetchSidecar(`${server.url}/m.yaml`, { tokenEnv: "NOPE", env: {} }),
    ).rejects.toThrow(/environment variable NOPE named by "tokenEnv" is not set/);
  });

  it("hints at a missing token on an anonymous 404", async () => {
    server = await startSchemaServer({ "/p.yaml": { status: 404, body: "no" } });
    await expect(fetchSidecar(`${server.url}/p.yaml`)).rejects.toThrow(
      /HTTP 404 \(a private file answers 404 without a token; set "tokenEnv"\)/,
    );
  });

  it("refuses under --offline before touching the network", async () => {
    server = await startSchemaServer({ "/m.yaml": { body: MANIFEST } });
    await expect(
      fetchSidecar(`${server.url}/m.yaml`, { offline: true }),
    ).rejects.toThrow(/is remote and the run is offline/);
    expect(server.hits("/m.yaml")).toBe(0);
  });

  it("retries once on a 5xx and then succeeds", async () => {
    server = await startSchemaServer({
      "/flaky.yaml": (hit) =>
        hit === 1 ? { status: 503, body: "later" } : { body: MANIFEST, contentType: "text/plain" },
    });
    const text = await fetchSidecar(`${server.url}/flaky.yaml`);
    expect(text).toBe(MANIFEST);
    expect(server.hits("/flaky.yaml")).toBe(2);
  });

  it("does not retry a 4xx", async () => {
    server = await startSchemaServer({ "/m.yaml": { status: 403, body: "no" } });
    await expect(fetchSidecar(`${server.url}/m.yaml`)).rejects.toThrow(/HTTP 403/);
    expect(server.hits("/m.yaml")).toBe(1);
  });

  it("keeps the token on a same-origin redirect and drops it across origins", async () => {
    second = await startSchemaServer({
      "/elsewhere.yaml": { body: MANIFEST, contentType: "text/plain" },
    });
    const away = `${second.url}/elsewhere.yaml`;
    server = await startSchemaServer({
      "/same.yaml": { status: 302, headers: { location: "/target.yaml" }, body: "" },
      "/target.yaml": { body: MANIFEST, contentType: "text/plain" },
      "/cross.yaml": { status: 302, headers: { location: away }, body: "" },
    });
    const env = { T: "tok" };
    await fetchSidecar(`${server.url}/same.yaml`, { tokenEnv: "T", env });
    const sameHop = server.requests().find((r) => r.path === "/target.yaml");
    expect(sameHop?.headers.authorization).toBe("Bearer tok");

    await fetchSidecar(`${server.url}/cross.yaml`, { tokenEnv: "T", env });
    const crossHop = second.requests().find((r) => r.path === "/elsewhere.yaml");
    expect(crossHop).toBeDefined();
    expect(crossHop?.headers.authorization).toBeUndefined();
  });

  it("caps the body", async () => {
    server = await startSchemaServer({
      "/big.yaml": { streamChunks: { text: "x".repeat(1024), count: 64 } },
    });
    await expect(
      fetchSidecar(`${server.url}/big.yaml`, { maxBytes: 4096 }),
    ).rejects.toThrow(/too large/);
  });

  it("reports a timeout by name", async () => {
    server = await startSchemaServer({ "/slow.yaml": { body: MANIFEST, delayMs: 500 } });
    await expect(
      fetchSidecar(`${server.url}/slow.yaml`, { timeoutMs: 50 }),
    ).rejects.toThrow(/timed out after 50ms/);
  });
});

describe("sidecar URLs: through the loader and validate", () => {
  it("loads a remote manifest under the same rules as a local one, reported as the URL", async () => {
    server = await startSchemaServer({ "/m.yaml": { body: MANIFEST, contentType: "text/plain" } });
    const url = `${server.url}/m.yaml`;
    const index = await loadSidecars(
      { sidecars: [{ file: url, keys: ["source", "jira"] }] },
      { configDir: corpus, base: corpus },
    );
    expect(index?.owners.get("jira")).toBe(url);
    expect(index?.byPath.get(resolve(corpus, "docs/auth.md"))?.get("jira")).toEqual({
      value: "PLAT-1",
      file: url,
      line: 4,
    });
    expect(server.hits("/m.yaml")).toBe(1);
  });

  it("is fetched again on the next run, never cached", async () => {
    server = await startSchemaServer({ "/m.yaml": { body: MANIFEST } });
    const cfg = { sidecars: [{ file: `${server.url}/m.yaml`, keys: ["source", "jira"] }] };
    await loadSidecars(cfg, { configDir: corpus, base: corpus });
    await loadSidecars(cfg, { configDir: corpus, base: corpus });
    expect(server.hits("/m.yaml")).toBe(2);
  });

  it("refuses a remote manifest under --offline, exit 2, before reading a local one", async () => {
    server = await startSchemaServer({ "/m.yaml": { body: MANIFEST } });
    await expect(
      loadSidecars(
        {
          sidecars: [
            { file: `${server.url}/m.yaml`, keys: ["jira"] },
            { file: "./docs-meta.yaml", keys: ["source"] },
          ],
        },
        { configDir: corpus, base: corpus, offline: true },
      ),
    ).rejects.toThrow(DocmetaError);
    expect(server.hits("/m.yaml")).toBe(0);
  });

  it("validate attributes a bad remote value to the URL and line, and honours --offline", async () => {
    server = await startSchemaServer({ "/m.yaml": { body: MANIFEST, contentType: "text/plain" } });
    const url = `${server.url}/m.yaml`;
    // A private checkout of its own: the fixture pages copied beside a config
    // whose manifest is the served one, so the manifest's `docs/…` keys
    // resolve from this config directory exactly as a local manifest's would.
    const dir = mkdtempSync(join(tmpdir(), "manni-sidecar-url-"));
    try {
      cpSync(join(corpus, "docs"), join(dir, "docs"), { recursive: true });
      const schema = resolve(corpus, "private.schema.json").replace(/\\/g, "/");
      writeFileSync(
        join(dir, "manni.config.yaml"),
        [
          "meta:",
          '  paths: ["docs/**/*.md"]',
          "  sidecars:",
          `    - file: ${url}`,
          "      keys: [source, jira]",
          "  overrides:",
          '    - files: "docs/**/*.md"',
          `      schemas: ["${schema}"]`,
        ].join("\n"),
      );
      const configPath = join(dir, "manni.config.yaml");
      const r = await runValidate({ cwd: dir, configPath, inputs: [] });
      const byFile = new Map(r.results.map((x) => [x.file, x]));
      expect(byFile.get("docs/auth.md")?.ok).toBe(true);
      expect(byFile.get("docs/billing.md")?.errors[0]).toMatchObject({
        keyword: "pattern",
        file: url,
        line: 6,
      });
      expect(byFile.get("docs/ops.md")?.errors[0]?.message).toMatch(
        new RegExp(`owned by sidecar ${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
      expect(byFile.get("docs/new.md")?.errors.map((e) => e.keyword)).toEqual(["required"]);
      expect(server.hits("/m.yaml")).toBe(1);

      await expect(
        runValidate({ cwd: dir, configPath, inputs: [], offline: true }),
      ).rejects.toThrow(/is remote and the run is offline/);
      expect(server.hits("/m.yaml")).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
