import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";
import type { buildAnswerInput } from "./retrieve-prototype-data";

export const MODEL_ID = "Llama-3.2-1B-Instruct-q4f32_1-MLC";

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
    return {
      async answer(input: ReturnType<typeof buildAnswerInput>, update: (text: string) => void) {
        // Each request starts from the displayed snapshot, without chat history.
        const stream = await engine.chat.completions.create({
          messages: input.messages, stream: true, temperature: 0,
          max_tokens: 384,
        });
        let text = "";
        for await (const chunk of stream) {
          text += chunk.choices[0]?.delta.content ?? "";
          update(text);
        }
        return text;
      },
      stop: () => engine.interruptGenerate(),
      dispose: () => worker.terminate(),
    };
  } catch (error) {
    worker.terminate();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
