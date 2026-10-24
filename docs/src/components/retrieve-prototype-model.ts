import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import { hasModelReasoning, modelAnswerText } from "./retrieve-prototype-answer";
import type { buildAnswerInput } from "./retrieve-prototype-data";

export const MODEL_ID = "Qwen3-1.7B-q4f32_1-MLC";

export async function loadLocalModel(progress: (text: string) => void, signal: AbortSignal) {
  signal.throwIfAborted();
  const worker = new Worker(new URL("./retrieve-prototype.worker.ts", import.meta.url), { type: "module" });
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      worker.terminate();
      reject(new DOMException("Model loading cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    const engine = await Promise.race([
      CreateWebWorkerMLCEngine(worker, MODEL_ID, {
        initProgressCallback: (report) => progress(report.text),
      }, { context_window_size: 4096 }),
      cancelled,
    ]);
    let stopRequested = false;
    return {
      async answer(input: ReturnType<typeof buildAnswerInput>, update: (text: string) => void) {
        // Each request starts from the displayed snapshot, without chat history.
        stopRequested = false;
        await engine.resetChat(false);
        if (stopRequested) return "";
        const stream = await engine.chat.completions.create({
          messages: input.messages, stream: true,
          temperature: 0.7, top_p: 0.8, seed: 42,
          presence_penalty: 0, frequency_penalty: 0, repetition_penalty: 1,
          extra_body: { enable_thinking: false },
          max_tokens: 384,
        });
        let text = "";
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          text += delta?.content ?? "";
          if (hasModelReasoning(text) || (delta && "reasoning_content" in delta && typeof delta.reasoning_content === "string" && delta.reasoning_content.trim() !== "")) {
            throw new Error("The model emitted reasoning while direct answers were requested. Try again.");
          }
          update(modelAnswerText(text));
        }
        return modelAnswerText(text);
      },
      stop: () => { stopRequested = true; engine.interruptGenerate(); },
      dispose: () => worker.terminate(),
    };
  } catch (error) {
    worker.terminate();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
