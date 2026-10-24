import type { Operation } from "./retrieve-prototype-data.js";

/** Shared by the displayed settings and the lazily loaded model adapter. */
export const MODEL_ID = "Qwen3-1.7B-q4f32_1-MLC";
export const MODEL_LABEL = "Qwen3 1.7B";
export const MODEL_LOAD_OPTIONS = { context_window_size: 4096 } as const;
export const MODEL_REQUEST_OPTIONS = {
  stream: true,
  temperature: 0.7,
  top_p: 0.8,
  seed: 42,
  presence_penalty: 0,
  frequency_penalty: 0,
  repetition_penalty: 1,
  extra_body: { enable_thinking: false },
  max_tokens: 384,
} as const;

/** Plain text for the current controls; the host supplies worker and messages. */
export function formatPlaygroundSettings(input: {
  manifest: string;
  operation: Operation;
  argument: string;
  options?: object;
}): string {
  const options = input.operation === "retrieve"
    ? { ...input.options, mode: "lexical" }
    : input.options ?? {};
  const argumentsText = JSON.stringify(input.argument) + (input.operation === "lookup" ? "" : `, ${JSON.stringify(options, null, 2)}`);
  const request = JSON.stringify(MODEL_REQUEST_OPTIONS, null, 2).replace("{", "{\n  messages,");
  return [
    'import { createRetriever } from "@hawkeyexl/manni/graph/runtime";',
    'import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";',
    "",
    `const docs = await createRetriever(${JSON.stringify({ manifest: input.manifest, embed: false }, null, 2)});`,
    `const result = await docs.${input.operation}(${argumentsText});`,
    "",
    "// The host supplies a WebLLM worker and bounded evidence messages from this result.",
    "const engine = await CreateWebWorkerMLCEngine(",
    "  worker,",
    `  ${JSON.stringify(MODEL_ID)},`,
    "  {},",
    `  ${JSON.stringify(MODEL_LOAD_OPTIONS, null, 2)}`,
    ");",
    "await engine.resetChat(false);",
    `const response = await engine.chat.completions.create(${request});`,
  ].join("\n");
}
