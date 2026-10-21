/**
 * `manni graph serve` (proposal 0090, PR 3): the MCP server over stdio,
 * driven by the SDK's own client against the built CLI. Hermetic: the
 * retrieval fixture, mock vectors, no network.
 *
 * Every tool answers through the same command core as its CLI twin, so each
 * result is compared with what the CLI prints for the same inputs.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runServe } from "../../../src/graph/commands/serve.js";
import { GraphError } from "../../../src/graph/types.js";
import { spawnText } from "../../helpers/spawn.js";
import { removeTempRepo } from "../../helpers/temp-repo.js";
import { INDEX, QUESTION, ROTATE, retrieveArtifact } from "../helpers/retrieve-artifact.js";

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

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

/** The result in both forms, which must agree. */
function both(r: ToolResult): Record<string, unknown> {
  expect(r.content).toHaveLength(1);
  const text = r.content[0]?.text ?? "";
  expect(r.structuredContent).toEqual(JSON.parse(text));
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
});

describe("graph serve: tools/call", () => {
  it("lookup takes only the question and returns what graph lookup prints", async () => {
    const result = both(await call("lookup", { question: QUESTION }));
    const cli = JSON.parse(graph(["lookup", QUESTION, "-f", "json"]).stdout) as unknown;
    expect(result).toEqual(cli);
    expect(result.language).toBe("en");
  });

  it("retrieve, traverse and impact return what their CLI twins print", async () => {
    const retrieved = both(
      await call("retrieve", { question: QUESTION, lang: "en", depth: 2, maxChars: 20000, where: { tags: ["security", "keys"] } }),
    );
    expect(retrieved).toEqual(
      JSON.parse(
        graph([
          "retrieve", QUESTION, "--lang", "en", "-d", "2", "--max-chars", "20000",
          "--where", "tags=security", "--where", "tags=keys", "-f", "json",
        ]).stdout,
      ),
    );

    const walked = both(await call("traverse", { node: ROTATE, depth: 2, maxChars: 20000 }));
    expect(walked).toEqual(
      JSON.parse(graph(["traverse", ROTATE, "--context", "-d", "2", "--max-chars", "20000", "-f", "json"]).stdout),
    );

    const impact = both(await call("impact", { node: ROTATE }));
    expect(impact).toEqual(JSON.parse(graph(["traverse", ROTATE, "--impact", "--context", "-f", "json"]).stdout));
  });

  it("answers a CLI usage error with a refusal, never isError", async () => {
    const lang = await call("retrieve", { question: QUESTION });
    expect(lang.isError ?? false).toBe(false);
    expect(both(lang).refusal).toEqual({
      reason: "lang-required",
      detail: "This corpus has more than one localization (de, en) — pass --lang to choose one.",
    });

    const node = await call("traverse", { node: "urn:manni:graph:doc/nowhere.md" });
    expect(node.isError ?? false).toBe(false);
    expect((both(node).refusal as { reason: string }).reason).toBe("unknown-node");

    const scope = await call("impact", { node: ROTATE, variant: "nope" });
    expect((both(scope).refusal as { reason: string; detail: string }).detail).toMatch(/^Unknown product variant: nope/);

    const fr = await call("retrieve", { question: QUESTION, lang: "fr" });
    expect(fr.isError ?? false).toBe(false);
    expect(both(fr).refusal).toEqual({ reason: "unknown-scope", detail: 'No index for language "fr" — this corpus has de, en.' });
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
  it("keeps the SDK an optional peer, imported by bare specifier", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    expect(pkg.dependencies?.["@modelcontextprotocol/sdk"]).toBeUndefined();
    expect(pkg.peerDependencies?.["@modelcontextprotocol/sdk"]).toBeDefined();
    expect(pkg.peerDependenciesMeta?.["@modelcontextprotocol/sdk"]?.optional).toBe(true);
    // The Node build splits chunks, so the import lands in whichever one holds serve.
    const built = readdirSync(join(root, "dist"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(root, "dist", f), "utf8"))
      .join("\n");
    expect(built).toMatch(/import\(\s*["'`]@modelcontextprotocol\/sdk\/server\/mcp\.js["'`]\s*\)/);
    expect(built).not.toMatch(/class McpServer\b/);
  });
});
