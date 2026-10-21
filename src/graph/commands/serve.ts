/**
 * `manni graph serve` (proposal 0090): the chunk artifact over MCP, on stdio.
 *
 * Four tools, `lookup`, `retrieve`, `traverse` and `impact`, each answered by
 * the command core its CLI twin runs (`lookupIn`, `retrieveIn`, `traverseIn`)
 * over one artifact opened at start. Nothing here retrieves.
 *
 * The SDK is an optional peer, imported only when this command runs. Its
 * high-level `registerTool` takes zod shapes, so the tools are served through
 * the underlying protocol server with plain JSON Schemas, validated here.
 *
 * A CLI usage error comes back as a refusal carrying the CLI's text, never as
 * `isError`. `--withhold` tightens every call's floor, and no tool argument
 * can loosen it: no input schema names `withhold`.
 */
import type { Readable, Writable } from "node:stream";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import pkg from "../../../package.json" with { type: "json" };
import { errorMessage } from "../../shared/errors.js";
import { notice } from "../../shared/warn.js";
import type { WithholdReason } from "../runtime/chunks.js";
import type { LookupResult, PassageBundle, WhereCondition } from "../runtime/retrieve.js";
import { GraphError } from "../types.js";
import { lookupIn, openArtifact, retrieveIn, traverseIn, type Artifact, type ArtifactOptions } from "./retrieve.js";

export interface ServeOptions extends ArtifactOptions {
  /** Tightens the trust floor for every call. */
  withhold?: WithholdReason[];
}

/** The SDK pieces serve uses, as one injectable seam. */
export interface McpSdk {
  McpServer: typeof McpServer;
  StdioServerTransport: typeof StdioServerTransport;
  ListToolsRequestSchema: typeof ListToolsRequestSchema;
  CallToolRequestSchema: typeof CallToolRequestSchema;
}

export interface ServeSeams {
  /** Injection seam for tests: load the SDK, or fail as a missing package does. */
  loadSdk?: () => Promise<McpSdk>;
  /** Injection seams for tests: the streams served over, `process.stdin` and `process.stdout` by default. */
  stdin?: Readable;
  stdout?: Writable;
}

async function importSdk(): Promise<McpSdk> {
  // Literal specifiers, so the Node build leaves them bare: an optional peer.
  const [mcp, stdio, types] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/mcp.js"),
    import("@modelcontextprotocol/sdk/server/stdio.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);
  return {
    McpServer: mcp.McpServer,
    StdioServerTransport: stdio.StdioServerTransport,
    ListToolsRequestSchema: types.ListToolsRequestSchema,
    CallToolRequestSchema: types.CallToolRequestSchema,
  };
}

// ---- schemas ----------------------------------------------------------------

type Schema = Record<string, unknown>;

const text = (description: string): Schema => ({ type: "string", minLength: 1, description });
const count = (minimum: number, description: string): Schema => ({ type: "integer", minimum, description });

const QUESTION = text("The reader's question, in their words.");
const NODE = text("The IRI of the node to start from, as a passage's iri gives it.");
const LANG = text("The localization, as a BCP-47 tag. Required when the docs have more than one.");
const VARIANT = text("Only passages for this product variant: its IRI, title or slug.");
const SUBJECT = text("Only passages about this software subject.");
const MAX_CHARS = count(1, "The character budget for passage text. Defaults to graph.retrieve.maxChars.");
const LIMIT = count(1, "Stop after this many nodes.");
const WHERE: Schema = {
  type: "object",
  description:
    "Only passages whose metadata holds each field's value. A list asks for every value, and a list field matches when it contains the value.",
  additionalProperties: {
    oneOf: [
      { type: "string", minLength: 1 },
      { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
    ],
  },
};

const input = (properties: Record<string, Schema>, requiredField: string): Schema => ({
  type: "object",
  properties,
  required: [requiredField],
  additionalProperties: false,
});

const REFUSAL: Schema = {
  type: "object",
  properties: {
    reason: {
      type: "string",
      enum: ["no-route", "no-content", "withheld", "lang-required", "unknown-node", "unknown-scope"],
    },
    detail: { type: "string" },
  },
  required: ["reason", "detail"],
};
const PROOF: Schema = { type: "object", description: "The provenance record: pins, dates and eval verdicts." };
const TRACE: Schema = {
  type: "object",
  required: ["entry", "hops", "exclusions", "resolutions", "withheld", "filtered"],
};
const CITATIONS: Schema = {
  type: "array",
  items: { type: "object", properties: { iri: { type: "string" }, sourceUrl: { type: "string" } }, required: ["iri", "sourceUrl"] },
};
const PAGES: Schema = { type: "object", additionalProperties: { type: "object", required: ["metadata"] } };
const NULLABLE_TEXT: Schema = { type: ["string", "null"] };

const BUNDLE: Schema = {
  type: "object",
  properties: {
    question: { type: "string" },
    node: { type: "string" },
    language: NULLABLE_TEXT,
    context: {
      type: "array",
      items: {
        type: "object",
        properties: {
          iri: { type: "string" },
          title: { type: "string" },
          text: { type: "string" },
          page: { type: "string" },
          depth: { type: "integer" },
          role: { type: "string", enum: ["match", "context", "dependent"] },
          provenance: PROOF,
        },
        required: ["iri", "text", "page", "depth", "role", "provenance"],
      },
    },
    citations: CITATIONS,
    pages: PAGES,
    trace: TRACE,
    refusal: REFUSAL,
    truncated: { type: "boolean" },
  },
  required: ["language", "context", "citations", "pages", "trace", "truncated"],
  additionalProperties: false,
};

const PASSAGE = (extra: Record<string, Schema>, required: string[]): Schema => ({
  type: "object",
  properties: {
    iri: { type: "string" },
    title: { type: "string" },
    page: { type: "string" },
    lines: { type: "string" },
    text: NULLABLE_TEXT,
    truncated: { type: "boolean" },
    provenance: PROOF,
    ...extra,
  },
  required: ["iri", "page", "text", "truncated", "provenance", ...required],
});
const EDGES: Schema = {
  type: "array",
  items: {
    type: "object",
    properties: { from: { type: "string" }, predicate: { type: "string" }, to: { type: "string" } },
    required: ["from", "predicate", "to"],
  },
};
const WALK: Schema = {
  type: "object",
  properties: {
    passages: { type: "array", items: PASSAGE({ depth: { type: "integer" } }, ["depth"]) },
    edges: EDGES,
    truncated: { type: "boolean" },
  },
  required: ["passages", "edges", "truncated"],
};

const LOOKUP_RESULT: Schema = {
  type: "object",
  properties: {
    question: { type: "string" },
    language: NULLABLE_TEXT,
    matches: {
      type: "object",
      properties: {
        passages: {
          type: "array",
          items: PASSAGE({ rank: { type: "integer" }, score: { type: "object", required: ["fused"] } }, ["rank", "score"]),
        },
        truncated: { type: "boolean" },
      },
      required: ["passages", "truncated"],
    },
    traversal: WALK,
    impact: WALK,
    pages: PAGES,
    citations: CITATIONS,
    trace: TRACE,
    refusal: REFUSAL,
  },
  required: ["question", "language", "matches", "traversal", "impact", "pages", "citations", "trace"],
  additionalProperties: false,
};

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

/** The four tools, in the order `tools/list` gives them. */
const TOOLS = [
  {
    name: "lookup",
    description:
      "Start here. Pass the reader's question. You get three full result sets. Every match is ranked with its scores. " +
      "Every passage reached by following links outward from the matches comes back, and so does every passage that depends on the matches. " +
      "Each set has its edges, and each passage has its source and proof: pin status, dates and eval verdicts. " +
      "A refusal means nothing in the docs answers it.",
    inputSchema: input({ question: QUESTION }, "question"),
    outputSchema: LOOKUP_RESULT,
    annotations: READ_ONLY,
  },
  {
    name: "retrieve",
    description: "Like lookup, with control over language, scope, depth and budget.",
    inputSchema: input(
      {
        question: QUESTION,
        lang: LANG,
        variant: VARIANT,
        softwareSubject: SUBJECT,
        depth: count(0, "Hops out from each match. Defaults to graph.retrieve.depth."),
        maxChars: MAX_CHARS,
        where: WHERE,
      },
      "question",
    ),
    outputSchema: BUNDLE,
    annotations: READ_ONLY,
  },
  {
    name: "traverse",
    description: "Walk the graph from one node and return the passages it reaches.",
    inputSchema: input(
      {
        node: NODE,
        depth: count(0, "Hops out from the node."),
        predicates: {
          type: "array",
          items: { type: "string", minLength: 1 },
          description: "Follow only these predicates, as prefixed names or IRIs.",
        },
        reverse: { type: "boolean", description: "Follow edges into the node rather than out of it." },
        lang: LANG,
        variant: VARIANT,
        softwareSubject: SUBJECT,
        limit: LIMIT,
        maxChars: MAX_CHARS,
        where: WHERE,
      },
      "node",
    ),
    outputSchema: BUNDLE,
    annotations: READ_ONLY,
  },
  {
    name: "impact",
    description: "List the passages that depend on a node. Use it before changing a page.",
    inputSchema: input(
      {
        node: NODE,
        depth: { ...count(0, "Hops in from the node."), default: 3 },
        lang: LANG,
        variant: VARIANT,
        softwareSubject: SUBJECT,
        limit: LIMIT,
        maxChars: MAX_CHARS,
        where: WHERE,
      },
      "node",
    ),
    outputSchema: BUNDLE,
    annotations: READ_ONLY,
  },
] as const;

type ToolName = (typeof TOOLS)[number]["name"];

// ---- calls ------------------------------------------------------------------

interface Args {
  question?: string;
  node?: string;
  lang?: string;
  variant?: string;
  softwareSubject?: string;
  depth?: number;
  maxChars?: number;
  limit?: number;
  predicates?: string[];
  reverse?: boolean;
  where?: Record<string, string | string[]>;
}

/** The object form an agent writes, as the CLI's repeated `--where`: one condition per value, all ANDed. */
function whereOf(where: Args["where"]): WhereCondition[] | undefined {
  if (where === undefined) return undefined;
  return Object.entries(where).flatMap(([field, value]) =>
    (Array.isArray(value) ? value : [value]).map((v) => ({ field, value: v })),
  );
}

const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

async function answer(
  artifact: Artifact,
  name: ToolName,
  args: Args,
  withhold: WithholdReason[] | undefined,
): Promise<LookupResult | PassageBundle> {
  const scope = defined({ lang: args.lang, variant: args.variant, subject: args.softwareSubject, withhold });
  const head = name === "retrieve" || name === "lookup" ? { question: args.question ?? "" } : { node: args.node ?? "" };
  try {
    switch (name) {
      case "lookup":
        return await lookupIn(artifact, { question: args.question ?? "", ...defined({ withhold }) });
      case "retrieve":
        return await retrieveIn(artifact, {
          question: args.question ?? "",
          ...scope,
          ...defined({ depth: args.depth, maxChars: args.maxChars, where: whereOf(args.where) }),
        });
      case "traverse":
      case "impact":
        return await traverseIn(artifact, {
          node: args.node ?? "",
          ...scope,
          ...(name === "impact" ? { impact: true } : {}),
          ...defined({
            depth: args.depth,
            predicates: args.predicates,
            reverse: args.reverse,
            limit: args.limit,
            maxChars: args.maxChars,
            where: whereOf(args.where),
          }),
        });
    }
  } catch (e) {
    if (!(e instanceof GraphError) || e.refusal === undefined) throw e;
    // A CLI usage error is an answer here: a refusal with the CLI's own text.
    const refused: PassageBundle = {
      ...head,
      language: null,
      context: [],
      citations: [],
      pages: {},
      trace: { entry: { candidates: [] }, hops: [], exclusions: [], resolutions: [], withheld: [], filtered: [] },
      refusal: { reason: e.refusal, detail: e.message },
      truncated: false,
    };
    return refused;
  }
}

/**
 * Serve until stdin closes. Resolves then, so the bin exits 0. A missing SDK,
 * a missing artifact or one built from another graph rejects with a
 * `GraphError`, exit 2, before anything is served.
 */
export async function runServe(opts: ServeOptions, seams: ServeSeams = {}): Promise<void> {
  let sdk: McpSdk;
  try {
    sdk = await (seams.loadSdk ?? importSdk)();
  } catch {
    throw new GraphError(
      "graph serve needs the optional @modelcontextprotocol/sdk package; run npm install @modelcontextprotocol/sdk.",
    );
  }
  const artifact = await openArtifact(opts);

  const ajv = new Ajv2020({ allErrors: false, strict: false });
  const validators = new Map(TOOLS.map((t) => [t.name as string, ajv.compile(t.inputSchema)]));
  const server = new sdk.McpServer(
    { name: "manni-graph", version: pkg.version },
    { capabilities: { tools: {} } },
  );
  const pending = new Set<Promise<unknown>>();

  server.server.setRequestHandler(sdk.ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({ ...t })),
  }));
  server.server.setRequestHandler(sdk.CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    const validate = validators.get(name);
    const fault = (message: string): { isError: true; content: { type: "text"; text: string }[] } => ({
      isError: true,
      content: [{ type: "text", text: message }],
    });
    if (validate === undefined) return fault(`Unknown tool ${name}; this server has lookup, retrieve, traverse and impact.`);
    if (!validate(args)) {
      const first = validate.errors?.[0];
      const where = first?.instancePath === "" || first === undefined ? "arguments" : first.instancePath.slice(1);
      const why = first?.keyword === "additionalProperties"
        ? `${String((first.params as { additionalProperty?: string }).additionalProperty)} is not an argument`
        : `${where} ${first?.message ?? "is invalid"}`;
      return fault(`Invalid arguments for ${name}: ${why}.`);
    }
    const work = answer(artifact, name as ToolName, args, opts.withhold);
    pending.add(work);
    try {
      const result = await work;
      return {
        structuredContent: { ...result },
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (e) {
      // A stale row or a model mismatch mid-session: the CLI's words, and the session goes on.
      return fault(errorMessage(e));
    } finally {
      pending.delete(work);
    }
  });

  const stdin = seams.stdin ?? process.stdin;
  const transport = new sdk.StdioServerTransport(stdin, seams.stdout ?? process.stdout);
  const closed = new Promise<void>((done) => {
    stdin.once("end", done);
    stdin.once("close", done);
  });
  await server.connect(transport);
  notice(`serving lookup, retrieve, traverse and impact over stdio from ${artifact.label}.`);
  await closed;
  await Promise.allSettled([...pending]);
  // The SDK writes each reply a few microtasks after its handler returns, and
  // closing aborts any reply not yet written. One macrotask lets them all out.
  await new Promise((done) => setImmediate(done));
  await server.close();
}
