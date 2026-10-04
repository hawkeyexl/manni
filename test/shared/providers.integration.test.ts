/**
 * The family's top-level `providers:` map, against the built `dist/cli.js`:
 * one declaration that `manni meta fill` and `manni docevals` both read.
 *
 * The connection settings are observed where they matter, at the endpoint:
 * `providers.openai.baseUrl` points at a local stub that answers every
 * completion with a 400 and records the request, so each run proves the URL
 * and the key's environment variable reached the provider it constructed.
 * Nothing leaves the machine.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
/** The providers a message lists: every one a user would pick, and not the test double. */
const LISTED = "anthropic, openai, claude-cli, llama-cpp, auto";
import { startSchemaServer, type SchemaServer } from "../helpers/schema-server.js";

const ROOT = resolve(import.meta.dirname, "../..");
const MANNI = join(ROOT, "dist", "cli.js");
const KEY_ENV = "MANNI_TEST_OPENAI_KEY";

interface Run {
  stdout: string;
  stderr: string;
  status: number | null;
}

/** Spawn without blocking, so the stub server in this process can answer. */
function manni(args: string[], cwd: string): Promise<Run> {
  return new Promise((done, fail) => {
    const child = spawn("node", [MANNI, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: "1", [KEY_ENV]: "sk-from-custom-env" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", fail);
    child.on("close", (status) => {
      done({ stdout, stderr, status });
    });
  });
}

/** A fresh directory outside the repository, holding `files`. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "manni-providers-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/** A page carrying one ai eval, as a bare assertion. */
const EVAL_PAGE = ["---", "title: Sample", "evals:", "  - The page says hello.", "---", "", "# Sample", "", "Hello.", ""].join("\n");

describe("providers: in manni.config.yaml", () => {
  let server: SchemaServer;

  beforeEach(async () => {
    server = await startSchemaServer({
      "/v1/chat/completions": { status: 400, json: { error: { message: "stub endpoint" } } },
    });
  });

  afterEach(async () => {
    await server.close();
  });

  const providers = (): string =>
    [
      "providers:",
      "  provider: openai",
      "  openai:",
      `    baseUrl: ${server.url}/v1`,
      `    apiKeyEnv: ${KEY_ENV}`,
      "",
    ].join("\n");

  it("meta fill constructs the provider with providers.openai's baseUrl and apiKeyEnv", async () => {
    const dir = project({
      "manni.config.yaml": providers(),
      "plain.md": "# No frontmatter\n\nBody.\n",
    });
    const r = await manni(
      ["meta", "fill", "plain.md", "--fields", "title", "--dry-run", "--no-cache", "-f", "json"],
      dir,
    );
    const report = JSON.parse(r.stdout) as { provider: string; results: { error?: string }[] };
    expect(report.provider).toBe("openai");
    expect(report.results[0]?.error).toMatch(/stub endpoint/);
    expect(r.status).toBe(1);
    expect(server.requests().length).toBeGreaterThan(0);
    for (const request of server.requests()) {
      expect(request.path).toBe("/v1/chat/completions");
      expect(request.headers.authorization).toBe("Bearer sk-from-custom-env");
    }
  }, 60000);

  it("docevals reads the same map from a file of collections: and providers: only", async () => {
    const dir = project({
      "manni.config.yaml": [
        "collections:",
        "  - name: pages",
        "    paths:",
        '      - "*.md"',
        providers(),
      ].join("\n"),
      "page.md": EVAL_PAGE,
    });
    const r = await manni(["docevals", "run", "--no-generate", "-f", "json"], dir);
    expect(r.stderr).not.toMatch(/Invalid config|No files/);
    expect(server.requests().length).toBeGreaterThan(0);
    for (const request of server.requests()) {
      expect(request.path).toBe("/v1/chat/completions");
      expect(request.headers.authorization).toBe("Bearer sk-from-custom-env");
    }
  }, 60000);
});

describe("providers: refusals", () => {
  it("refuses docevals.providers, exit 2", async () => {
    const dir = project({
      "manni.config.yaml": ["docevals:", "  providers:", "    anthropic:", "      apiKeyEnv: KEY", ""].join("\n"),
    });
    const r = await manni(["docevals", "list"], dir);
    expect(r.stderr).toBe(
      'manni: manni.config.yaml: "providers" is no longer a docevals key. Provider settings are declared once for every tool, under a top-level providers: map. See https://hawkeyexl.github.io/manni/meta/reference/configuration/#providers\n',
    );
    expect(r.status).toBe(2);
  });

  it("discovers a file holding only providers:, and refuses what it says in both tools, exit 2", async () => {
    // Were `providers:` not a family key, discovery would pass over this file
    // and both runs would go ahead on defaults.
    const dir = project({ "manni.config.yaml": "providers:\n  provider: gemini\n" });
    const expected = `manni: manni.config.yaml: Unknown provider "gemini". Available: ${LISTED}.\n`;
    const fill = await manni(["meta", "fill", "missing.md", "--dry-run"], dir);
    expect(fill.stderr).toBe(expected);
    expect(fill.status).toBe(2);
    const list = await manni(["docevals", "list"], dir);
    expect(list.stderr).toBe(expected);
    expect(list.status).toBe(2);
  });

  it("refuses providers.model without providers.provider, exit 2", async () => {
    const dir = project({ "manni.config.yaml": "providers:\n  model: gpt-x\n" });
    const r = await manni(["docevals", "list"], dir);
    expect(r.stderr).toBe(
      `manni: manni.config.yaml: "providers.model" was given without a provider: a model name does not say which provider owns it. Set providers.provider to one of anthropic, openai, claude-cli, llama-cpp, or drop the model to take the detected provider's default.\n`,
    );
    expect(r.status).toBe(2);
  });
});
