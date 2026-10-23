/**
 * `manni graph serve` (proposal 0090, PR 3): the MCP server over stdio,
 * driven by the SDK's own client against the built CLI. Hermetic: the
 * retrieval fixture, mock vectors, no network.
 *
 * Every tool answers through the same command core as its CLI twin, so each
 * result is compared with what the CLI prints for the same inputs, as
 * `fitAnswer` compacts it under the default graph.serve.maxChars.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runServe } from "../../../src/graph/commands/serve.js";
import { fitAnswer, type ServedLookup } from "../../../src/graph/commands/serve-fit.js";
import type { LookupResult, PassageBundle } from "../../../src/graph/runtime/retrieve.js";
import { createMockEmbedder } from "../../../src/graph/embed/mock.js";
import type { QueryEmbedder } from "../../../src/graph/runtime/entry.js";
import { GraphError } from "../../../src/graph/types.js";
import { spawnText } from "../../helpers/spawn.js";
import { removeTempRepo, writeFile } from "../../helpers/temp-repo.js";
import { INDEX, QUESTION, ROTATE, retrieveArtifact, retrieveRepo } from "../helpers/retrieve-artifact.js";

const root = join(import.meta.dirname, "..", "..", "..");
const cli = join(root, "dist", "cli.js");

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: { type: string; text?: string }[];
}

let dir: string;
let client: Client;
let stderr = "";

beforeAll(async () => {
  dir = await retrieveArtifact();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "graph", "serve"],
    cwd: dir,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  client = new Client({ name: "serve-test", version: "0.0.0" });
  await client.connect(transport);
}, 60_000);

afterAll(async () => {
  await client.close();
  removeTempRepo(dir);
});

function graph(args: string[], input?: string): { stdout: string; stderr: string; status: number } {
  const r = spawnText(
    spawnSync(process.execPath, [cli, "graph", ...args], {
      encoding: "utf8",
      cwd: dir,
      ...(input === undefined ? {} : { input }),
    }),
  );
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

const toolOf = new WeakMap<object, string>();
/** Tools whose results, refusals among them, were validated against their outputSchema. */
const validated = new Set<string>();
let refusalsValidated = 0;

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  toolOf.set(r, name);
  return r;
}

/** The result in both forms, which must agree, and valid against the outputSchema tools/list declares. */
async function both(r: ToolResult): Promise<Record<string, unknown>> {
  expect(r.content).toHaveLength(1);
  const text = r.content[0]?.text ?? "";
  expect(r.structuredContent).toEqual(JSON.parse(text));
  const name = toolOf.get(r) ?? "";
  const tool = (await client.listTools()).tools.find((t) => t.name === name);
  expect(tool?.outputSchema, name).toBeDefined();
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(tool?.outputSchema ?? {});
  expect(validate(r.structuredContent), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
  validated.add(name);
  if (r.structuredContent?.refusal !== undefined) refusalsValidated++;
  return r.structuredContent ?? {};
}

describe("graph serve: tools/list", () => {
  it("lists the four tools in order, read-only and closed-world", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["lookup", "retrieve", "traverse", "impact"]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(Object.keys(tool.inputSchema.properties ?? {})).not.toContain("withhold");
      expect(tool.outputSchema).toBeDefined();
      expect(tool.description).toBeTruthy();
    }
  });

  it("gives each tool section 6's inputs", async () => {
    const { tools } = await client.listTools();
    const shape = Object.fromEntries(
      tools.map((t) => [t.name, { props: Object.keys(t.inputSchema.properties ?? {}).sort(), required: t.inputSchema.required }]),
    );
    expect(shape).toEqual({
      lookup: { props: ["question"], required: ["question"] },
      retrieve: {
        props: ["depth", "lang", "maxChars", "question", "softwareSubject", "variant", "where"],
        required: ["question"],
      },
      traverse: {
        props: ["depth", "lang", "limit", "maxChars", "node", "predicates", "reverse", "softwareSubject", "variant", "where"],
        required: ["node"],
      },
      impact: {
        props: ["depth", "lang", "limit", "maxChars", "node", "softwareSubject", "variant", "where"],
        required: ["node"],
      },
    });
    expect(tools[0]?.description).toMatch(/^Start here\. Pass the reader's question\./);
  });

  it("says on stderr what it serves, from where", () => {
    expect(stderr).toBe(
      `manni: serving lookup, retrieve, traverse and impact over stdio from ${INDEX}/chunks.json.\n`,
    );
  });

  it("reports the package's version as its own", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    expect(client.getServerVersion()).toMatchObject({ name: "manni-graph", version: pkg.version });
  });
});

/** What the CLI prints for `args`, as serve sends it under the default cap. */
function served(args: string[]): unknown {
  return fitAnswer(JSON.parse(graph([...args, "-f", "json"]).stdout) as LookupResult | PassageBundle, 40000);
}

/** Every passage of a lookup, in its three sections. */
const passagesOf = (r: ServedLookup) => [...r.matches.passages, ...r.traversal.passages, ...r.impact.passages];

describe("graph serve: tools/call", () => {
  it("lookup takes only the question and returns what graph lookup prints, compacted", async () => {
    const result = await both(await call("lookup", { question: QUESTION }));
    expect(result).toEqual(served(["lookup", QUESTION]));
    expect(result.language).toBe("en");
    const lookup = result as unknown as ServedLookup;
    expect(Object.keys(lookup.trace).sort()).toEqual(["entry", "filtered", "withheld"]);
    for (const p of passagesOf(lookup)) if (p.text === null) expect(p, p.iri).not.toHaveProperty("provenance");
    const texted = new Set(passagesOf(lookup).filter((p) => p.text !== null).map((p) => p.page));
    expect(Object.keys(lookup.pages).sort()).toEqual([...texted].sort());
  });

  it("leaves graph lookup -f json the full result, trace and all", () => {
    const cli = JSON.parse(graph(["lookup", QUESTION, "-f", "json"]).stdout) as LookupResult;
    expect(cli.trace).toHaveProperty("hops");
    expect(cli.trace).toHaveProperty("resolutions");
    expect(cli.trace.hops.length).toBeGreaterThan(0);
  });

  it("retrieve, traverse and impact return what their CLI twins print", async () => {
    const retrieved = await both(
      await call("retrieve", { question: QUESTION, lang: "en", depth: 2, maxChars: 20000, where: { tags: ["security", "keys"] } }),
    );
    expect(retrieved).toEqual(
      served([
        "retrieve", QUESTION, "--lang", "en", "-d", "2", "--max-chars", "20000",
        "--where", "tags=security", "--where", "tags=keys",
      ]),
    );

    const walked = await both(await call("traverse", { node: ROTATE, depth: 2, maxChars: 20000 }));
    expect(walked).toEqual(served(["traverse", ROTATE, "--context", "-d", "2", "--max-chars", "20000"]));

    const impact = await both(await call("impact", { node: ROTATE }));
    expect(impact).toEqual(served(["traverse", ROTATE, "--impact", "--context"]));
  });

  it("answers a CLI usage error with a refusal, never isError", async () => {
    const lang = await call("retrieve", { question: QUESTION });
    expect(lang.isError ?? false).toBe(false);
    expect((await both(lang)).refusal).toEqual({
      reason: "lang-required",
      detail: "This corpus has more than one localization (de, en) — pass --lang to choose one.",
    });

    const node = await call("traverse", { node: "urn:manni:graph:doc/nowhere.md" });
    expect(node.isError ?? false).toBe(false);
    expect(((await both(node)).refusal as { reason: string }).reason).toBe("unknown-node");

    const scope = await call("impact", { node: ROTATE, variant: "nope" });
    expect(((await both(scope)).refusal as { reason: string; detail: string }).detail).toMatch(/^Unknown product variant: nope/);

    const fr = await call("retrieve", { question: QUESTION, lang: "fr" });
    expect(fr.isError ?? false).toBe(false);
    expect((await both(fr)).refusal).toEqual({ reason: "unknown-scope", detail: 'No index for language "fr" — this corpus has de, en.' });
  });

  it("validated every tool's results, refusals included, against its declared outputSchema", () => {
    expect([...validated].sort()).toEqual(["impact", "lookup", "retrieve", "traverse"]);
    expect(refusalsValidated).toBeGreaterThan(0);
  });

  it("rejects an argument its schema does not name, withhold among them", async () => {
    for (const [name, args] of [
      ["lookup", { question: QUESTION, withhold: ["drifted"] }],
      ["lookup", { question: QUESTION, lang: "en" }],
      ["retrieve", { question: QUESTION, withhold: ["drifted"] }],
      ["traverse", { node: ROTATE, withhold: ["drifted"] }],
      ["impact", { node: ROTATE, withhold: ["drifted"] }],
    ] as const) {
      const r = await call(name, args);
      expect(r.isError, name).toBe(true);
      expect(r.content[0]?.text).toMatch(/^Invalid arguments for (lookup|retrieve|traverse|impact): /);
    }
  });
});

describe("graph serve: graph.serve.maxChars", () => {
  it("reduces passages to references until the answer fits, and leaves the CLI's result whole", async () => {
    const whole = JSON.stringify(served(["lookup", QUESTION])).length;
    const cap = Math.floor(whole / 2);
    const config = readFileSync(join(dir, "manni.config.yaml"), "utf8").trimEnd();
    writeFile(dir, "small.config.yaml", `${config}
  serve:
    maxChars: ${String(cap)}
`);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "graph", "serve", "-c", "small.config.yaml"],
      cwd: dir,
      stderr: "pipe",
    });
    const small = new Client({ name: "serve-test", version: "0.0.0" });
    await small.connect(transport);
    try {
      const r = (await small.callTool({ name: "lookup", arguments: { question: QUESTION } })) as ToolResult;
      toolOf.set(r, "lookup");
      const result = (await both(r)) as unknown as ServedLookup;
      expect(r.content[0]?.text?.length).toBeLessThanOrEqual(cap);
      const references = passagesOf(result).filter((p) => p.text === null && p.truncated === true);
      expect(references.length).toBeGreaterThan(0);
      for (const p of references) expect(p, p.iri).not.toHaveProperty("provenance");
      expect(result.impact.truncated).toBe(true);
      const texted = new Set(passagesOf(result).filter((p) => p.text !== null).map((p) => p.page));
      expect(Object.keys(result.pages).sort()).toEqual([...texted].sort());
    } finally {
      await small.close();
    }

    const full = JSON.parse(graph(["lookup", QUESTION, "-c", "small.config.yaml", "-f", "json"]).stdout) as LookupResult;
    expect(full).toEqual(JSON.parse(graph(["lookup", QUESTION, "-f", "json"]).stdout));
    expect(full.trace.hops.length).toBeGreaterThan(0);
  }, 60_000);
});

describe("graph serve: the process", () => {
  it("exits 0 when stdin closes", () => {
    const r = graph(["serve"], "");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("refuses a missing artifact or one from another graph, exit 2", () => {
    const missing = graph(["serve", "-i", "nowhere"], "");
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe("manni: nowhere/chunks.json does not exist; run manni graph publish.\n");

    copyFileSync(join(dir, INDEX, "graph.ttl"), join(dir, "other.ttl"));
    appendFileSync(join(dir, "other.ttl"), '\n<urn:x> <urn:y> "z" .\n', "utf8");
    const stale = graph(["serve", "-g", "other.ttl", "-i", INDEX], "");
    expect(stale.status).toBe(2);
    expect(stale.stderr).toBe(`manni: ${INDEX}/chunks.json was built from another graph; run manni graph publish.\n`);
  });

  it("refuses a bad --withhold, exit 2", () => {
    const r = graph(["serve", "--withhold", "stale"], "");
    expect(r.status).toBe(2);
    expect(r.stderr).toBe("manni: --withhold takes drifted or failing, and got stale.\n");
  });

  it("answers every call still in flight when stdin closes, then resolves", async () => {
    // Both lookups block in the query embedder until stdin has closed.
    const mock = createMockEmbedder();
    let started = 0;
    let bothStarted = (): void => undefined;
    const inFlight = new Promise<void>((done) => (bothStarted = done));
    let release = (): void => undefined;
    const gate = new Promise<void>((done) => (release = done));
    const embedder: QueryEmbedder = {
      model: mock.model,
      dtype: mock.dtype,
      async embed(text) {
        if (++started === 2) bothStarted();
        await gate;
        return mock.embed(text);
      },
    };
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = "";
    stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    const run = runServe({ cwd: dir, embedder }, { stdin, stdout });

    const send = (message: object): boolean => stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "serve-test", version: "0.0.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "lookup", arguments: { question: QUESTION } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "lookup", arguments: { question: "rotate" } } });
    await inFlight;
    stdin.end();
    await new Promise((done) => setImmediate(done));
    release();
    await run;

    const replies = out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { id?: number; result?: ToolResult });
    // Concurrent calls answer in whichever order they finish.
    expect(replies.map((r) => r.id ?? 0).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    for (const id of [2, 3]) {
      const reply = replies.find((r) => r.id === id);
      expect(reply?.result?.isError).toBeUndefined();
      expect(reply?.result?.structuredContent).toHaveProperty("matches");
    }
  });

  it("names the package to install when the SDK is missing", async () => {
    const run = runServe(
      { cwd: dir },
      { loadSdk: () => Promise.reject(new Error("Cannot find package '@modelcontextprotocol/sdk'")) },
    );
    await expect(run).rejects.toThrow(GraphError);
    await expect(run).rejects.toThrow(
      "graph serve needs the optional @modelcontextprotocol/sdk package; run npm install @modelcontextprotocol/sdk.",
    );
  });
});

describe("graph serve: packaging", () => {
  it("keeps the SDK an optional dependency, imported by bare specifier", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    expect(pkg.optionalDependencies?.["@modelcontextprotocol/sdk"]).toBeDefined();
    expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(pkg.devDependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(pkg.peerDependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
    // The Node build splits chunks, so the import lands in whichever one holds serve.
    const built = readdirSync(join(root, "dist"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(root, "dist", f), "utf8"))
      .join("\n");
    expect(built).toMatch(/import\(\s*["'`]@modelcontextprotocol\/sdk\/server\/mcp\.js["'`]\s*\)/);
    expect(built).not.toMatch(/class McpServer\b/);
  });
});

describe("graph serve --publish", () => {
  const serving = (label: string): string =>
    `manni: serving lookup, retrieve, traverse and impact over stdio from ${label}.\n`;
  const PUBLISHED = /^manni: published the graph in \d+\.\ds\.$/m;
  const REPUBLISHING = "manni: republishing the graph: the checkout changed since the last publish.\n";

  let repo: string;
  let outside: string;

  beforeAll(() => {
    repo = retrieveRepo();
    outside = mkdtempSync(join(tmpdir(), "manni-serve-publish-"));
  });
  afterAll(() => {
    removeTempRepo(repo);
    removeTempRepo(outside);
  });

  /** A `serve --publish` client, and what the server has said on stderr so far. */
  async function start(args: string[] = []): Promise<{ client: Client; stderr: () => string }> {
    let said = "";
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "graph", "serve", "--publish", ...args],
      cwd: repo,
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => (said += chunk.toString("utf8")));
    const c = new Client({ name: "serve-test", version: "0.0.0" });
    await c.connect(transport);
    return { client: c, stderr: () => said };
  }

  /** stderr, once it holds `text`: it travels on its own pipe, beside the replies. */
  async function until(stderr: () => string, text: string | RegExp): Promise<string> {
    for (let i = 0; i < 200; i++) {
      const said = stderr();
      if (typeof text === "string" ? said.includes(text) : text.test(said)) return said;
      await new Promise((done) => setTimeout(done, 50));
    }
    return stderr();
  }

  async function lookupOver(c: Client, question: string): Promise<ToolResult> {
    return (await c.callTool({ name: "lookup", arguments: { question } })) as ToolResult;
  }

  it("connects at once, publishes a missing artifact, then answers from it", async () => {
    const { client: c, stderr } = await start();
    // tools/list answers before the publish behind the handshake has finished.
    expect((await c.listTools()).tools).toHaveLength(4);
    expect(stderr()).not.toMatch(PUBLISHED);

    const r = await lookupOver(c, QUESTION);
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toHaveProperty("matches");
    const said = await until(stderr, serving(`${INDEX}/chunks.json`));
    await c.close();

    const lines = said.split("\n");
    const reason = lines.indexOf(`manni: publishing the graph before serving it: ${INDEX}/chunks.json does not exist.`);
    const published = lines.findIndex((l) => PUBLISHED.test(l));
    const served = lines.indexOf(serving(`${INDEX}/chunks.json`).trimEnd());
    expect(reason).toBeGreaterThanOrEqual(0);
    // The reason is openArtifact's message without its advice to publish.
    expect(said).not.toMatch(/before serving it: .*run manni graph publish/);
    expect(published).toBeGreaterThan(reason);
    expect(served).toBeGreaterThan(published);
    expect(existsSync(join(repo, INDEX, "chunks.json"))).toBe(true);
  }, 60_000);

  it("serves a fresh artifact over a clean tree without publishing, and republishes once after an edit", async () => {
    const { client: c, stderr } = await start();
    expect(JSON.stringify((await lookupOver(c, "zebra crossing")).structuredContent)).not.toContain("zebra.md");
    await lookupOver(c, QUESTION);
    expect(await until(stderr, "serving")).toBe(serving(`${INDEX}/chunks.json`));

    writeFile(
      repo,
      "docs/en/zebra.md",
      "---\ntitle: Zebra crossing\n---\n\n# Zebra crossing\n\nA zebra crossing lets people cross the road.\n",
    );
    const after = await lookupOver(c, "zebra crossing");
    expect(after.isError).toBeUndefined();
    expect(JSON.stringify(after.structuredContent)).toContain("zebra.md");
    const said = await until(stderr, PUBLISHED);
    expect(said.startsWith(`${serving(`${INDEX}/chunks.json`)}${REPUBLISHING}`)).toBe(true);
    expect(said).toMatch(PUBLISHED);

    // No change since: no second publish.
    await lookupOver(c, QUESTION);
    await c.close();
    expect(stderr().split(REPUBLISHING)).toHaveLength(2);
  }, 60_000);

  it("publishes into -i and serves from there", async () => {
    const label = relative(repo, join(outside, "chunks.json")).split("\\").join("/");
    const { client: c, stderr } = await start(["-i", outside]);
    const r = await lookupOver(c, QUESTION);
    expect(r.isError).toBeUndefined();
    const said = await until(stderr, serving(label));
    await c.close();
    expect(said).toContain(`manni: publishing the graph before serving it: ${label} does not exist.\n`);
    expect(existsSync(join(outside, "graph.ttl"))).toBe(true);
    expect(existsSync(join(outside, "chunks.json"))).toBe(true);
  }, 60_000);

  it("refuses --graph, exit 2", () => {
    const r = spawnText(
      spawnSync(process.execPath, [cli, "graph", "serve", "--publish", "-g", "x.ttl"], {
        encoding: "utf8",
        cwd: repo,
        input: "",
      }),
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(
      "manni: --publish writes graph.ttl into the index directory, so it cannot be combined with --graph. Use --index to choose the directory.\n",
    );
  });

  it("answers every call with isError when the start-up publish fails, and exits 2", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    let out = "";
    stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    const run = runServe(
      { cwd: repo, index: join(outside, "never"), publish: true },
      { stdin, stdout, publish: () => Promise.reject(new GraphError("graph publish stopped at build: the page is broken.")) },
    );
    const send = (message: object): boolean => stdin.write(`${JSON.stringify(message)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "serve-test", version: "0.0.0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "lookup", arguments: { question: QUESTION } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "impact", arguments: { node: ROTATE } } });
    for (let i = 0; i < 200 && out.split("\n").filter((l) => l !== "").length < 3; i++) {
      await new Promise((done) => setTimeout(done, 25));
    }
    stdin.end();
    await expect(run).resolves.toBe(2);

    const replies = out
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { id?: number; result?: ToolResult });
    for (const id of [2, 3]) {
      const reply = replies.find((r) => r.id === id);
      expect(reply?.result?.isError).toBe(true);
      expect(reply?.result?.content[0]?.text).toBe(
        "graph publish stopped at build: the page is broken. Run manni graph publish to see the whole report.",
      );
    }
  });
});
