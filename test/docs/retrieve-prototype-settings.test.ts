import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  formatPlaygroundSettings,
  MODEL_ID,
  MODEL_LABEL,
  MODEL_LOAD_OPTIONS,
  MODEL_REQUEST_OPTIONS,
} from "../../docs/src/components/retrieve-prototype-settings.js";

function call(code: string, expression: string): ts.CallExpression {
  const file = ts.createSourceFile("settings.ts", code, ts.ScriptTarget.ESNext, true);
  let found: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === expression) found = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error(`Missing call ${expression}`);
  return found;
}

function jsonArgument(code: string, expression: string, index: number): unknown {
  const argument = call(code, expression).arguments[index];
  if (!argument) throw new Error(`Missing argument ${index} on ${expression}`);
  const value: unknown = JSON.parse(argument.getText());
  return value;
}

describe("the playground's current settings example", () => {
  it("keeps the evaluated model profile and sampler available without importing the model runtime", () => {
    expect(MODEL_ID).toBe("Qwen3-1.7B-q4f32_1-MLC");
    expect(MODEL_LABEL).toBe("Qwen3 1.7B");
    expect(MODEL_LOAD_OPTIONS).toEqual({ context_window_size: 4096 });
    expect(MODEL_REQUEST_OPTIONS).toEqual({
      stream: true, temperature: 0.7, top_p: 0.8, seed: 42,
      presence_penalty: 0, frequency_penalty: 0, repetition_penalty: 1,
      extra_body: { enable_thinking: false }, max_tokens: 384,
    });
    const source = readFileSync("docs/src/components/retrieve-prototype-settings.ts", "utf8");
    const file = ts.createSourceFile("settings.ts", source, ts.ScriptTarget.ESNext, true);
    expect(file.statements.filter(ts.isImportDeclaration).every((item) => item.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword)).toBe(true);
  });

  it("shows the current lookup question and manifest while excluding unsupported lookup options", () => {
    const code = formatPlaygroundSettings({ manifest: "/manni/graph/chunks.json", operation: "lookup", argument: "Rotate the key?", options: { depth: 9 } });
    expect(code).toContain('from "@hawkeyexl/manni/graph/runtime"');
    expect(code).toContain('from "@mlc-ai/web-llm"');
    expect(jsonArgument(code, "createRetriever", 0)).toEqual({ manifest: "/manni/graph/chunks.json", embed: false });
    expect(jsonArgument(code, "docs.lookup", 0)).toBe("Rotate the key?");
    expect(call(code, "docs.lookup").arguments).toHaveLength(1);
  });

  it("updates retrieve scope and budget and enforces the actual lexical mode", () => {
    const code = formatPlaygroundSettings({
      manifest: "/graph/chunks.json", operation: "retrieve", argument: "Which page?",
      options: { lang: "en", depth: 2, maxChars: 1200, mode: "hybrid", where: [{ field: "type", value: "how-to" }], withhold: ["drifted"] },
    });
    expect(jsonArgument(code, "docs.retrieve", 1)).toEqual({
      lang: "en", depth: 2, maxChars: 1200, mode: "lexical", where: [{ field: "type", value: "how-to" }], withhold: ["drifted"],
    });
    const changed = formatPlaygroundSettings({ manifest: "/graph/chunks.json", operation: "retrieve", argument: "A new question", options: { depth: 3 } });
    expect(jsonArgument(changed, "docs.retrieve", 0)).toBe("A new question");
    expect(jsonArgument(changed, "docs.retrieve", 1)).toEqual({ depth: 3, mode: "lexical" });
  });

  it.each(["traverse", "impact"] as const)("shows the current %s node and walk options", (operation) => {
    const options = { lang: "en", depth: 2, limit: 7, maxChars: 900, withhold: ["failing"] };
    const code = formatPlaygroundSettings({ manifest: "/graph/chunks.json", operation, argument: "urn:manni:graph:doc/key", options });
    expect(jsonArgument(code, `docs.${operation}`, 0)).toBe("urn:manni:graph:doc/key");
    expect(jsonArgument(code, `docs.${operation}`, 1)).toEqual(options);
    expect(options).not.toHaveProperty("mode");
  });

  it("round-trips quotes, newlines and literal markup as data in the displayed code", () => {
    const argument = 'A "quoted" question\n</script><script>literal text</script>';
    const manifest = '/graph/"new\nchunks.json';
    const code = formatPlaygroundSettings({ manifest, operation: "lookup", argument });
    expect(jsonArgument(code, "docs.lookup", 0)).toBe(argument);
    expect(jsonArgument(code, "createRetriever", 0)).toEqual({ manifest, embed: false });
    const compiled = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    expect(compiled.diagnostics).toEqual([]);
  });

  it("renders the same model load and answer settings that the adapter consumes", () => {
    const code = formatPlaygroundSettings({ manifest: "/graph/chunks.json", operation: "lookup", argument: "Question" });
    const engine = call(code, "CreateWebWorkerMLCEngine");
    expect(engine.arguments[0]?.getText()).toBe("worker");
    expect(jsonArgument(code, "CreateWebWorkerMLCEngine", 1)).toBe(MODEL_ID);
    expect(jsonArgument(code, "CreateWebWorkerMLCEngine", 3)).toEqual(MODEL_LOAD_OPTIONS);
    const request = call(code, "engine.chat.completions.create").arguments[0];
    if (!request || !ts.isObjectLiteralExpression(request)) throw new Error("The example must show the answer request object.");
    expect(request.properties.some((property) => ts.isShorthandPropertyAssignment(property) && property.name.text === "messages")).toBe(true);
    const properties = request.properties.filter((property) => !ts.isShorthandPropertyAssignment(property)).map((property) => property.getText());
    const shown: unknown = JSON.parse(`{${properties.join(",")}}`);
    expect(shown).toEqual(MODEL_REQUEST_OPTIONS);
  });
});
