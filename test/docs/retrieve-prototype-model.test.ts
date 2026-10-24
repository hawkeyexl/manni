import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Chunk {
  choices: { delta?: { content?: string }; finish_reason?: "stop" | "length" | null }[];
}
interface Model {
  answer(input: { messages: { role: "user"; content: string }[] }, update: (text: string) => void): Promise<string>;
  stop(): void;
  dispose(): void;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isModel(value: unknown): value is Model {
  return isRecord(value) && typeof value.answer === "function" && typeof value.stop === "function" && typeof value.dispose === "function";
}
function deferred<T>() {
  let finish: (value: T) => void = () => { throw new Error("Deferred promise was not initialized."); };
  const promise = new Promise<T>((complete) => { finish = complete; });
  return { promise, resolve: (value: T) => { finish(value); } };
}
function chunks(values: Chunk[]) {
  let index = 0;
  const next = vi.fn((): Promise<IteratorResult<Chunk>> => {
    const value = values[index++];
    return Promise.resolve(value ? { done: false, value } : { done: true, value: undefined });
  });
  const returned = vi.fn((): Promise<IteratorResult<Chunk>> => Promise.resolve({ done: true, value: undefined }));
  const stream: AsyncIterableIterator<Chunk> = {
    next, return: returned,
    [Symbol.asyncIterator](): AsyncIterableIterator<Chunk> { return this; },
  };
  return { stream, next, returned };
}
const reset = vi.fn<() => Promise<void>>();
const create = vi.fn<() => Promise<AsyncIterable<Chunk>>>();
const interrupt = vi.fn<() => void>();
const factory = vi.fn(() => Promise.resolve({ resetChat: reset, chat: { completions: { create } }, interruptGenerate: interrupt }));
class WorkerStub {
  static instances: WorkerStub[] = [];
  terminate = vi.fn();
  constructor() { WorkerStub.instances.push(this); }
}

/** Exercise the real browser adapter without resolving docs-only packages in root CI. */
function adapter() {
  const cache = new Map<string, Record<string, unknown>>();
  function moduleAt(name: string): Record<string, unknown> {
    const cached = cache.get(name);
    if (cached) return cached;
    const filename = resolve(`docs/src/components/${name}.ts`);
    const source = readFileSync(filename, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      transformers: { before: [(context) => {
        const visit = (node: ts.Node): ts.Node => {
          if (ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === "url") {
            return context.factory.createStringLiteral(pathToFileURL(filename).href);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (file) => ts.visitNode(file, visit, ts.isSourceFile);
      }] },
    });
    const exports: Record<string, unknown> = {};
    cache.set(name, exports);
    runInNewContext(compiled.outputText, {
      exports, Worker: WorkerStub, URL, DOMException,
      require: (specifier: string): unknown => {
        if (specifier === "@mlc-ai/web-llm") return { CreateWebWorkerMLCEngine: factory };
        const local = /^\.\/(retrieve-prototype-(?:settings|answer))(?:\.js)?$/.exec(specifier)?.[1];
        if (local) return moduleAt(local);
        throw new Error(`Unexpected adapter dependency: ${specifier}`);
      },
    }, { filename });
    return exports;
  }
  const load = moduleAt("retrieve-prototype-model").loadLocalModel;
  if (typeof load !== "function") throw new Error("The adapter must export loadLocalModel.");
  return async (signal = new AbortController().signal): Promise<Model> => {
    const pending: unknown = Reflect.apply(load, undefined, [() => {}, signal]);
    const model: unknown = await pending;
    if (!isModel(model)) throw new Error("The model must expose answer, stop and dispose.");
    return model;
  };
}
const input = { messages: [{ role: "user" as const, content: "How many matches?" }] };

beforeEach(() => {
  vi.clearAllMocks();
  WorkerStub.instances = [];
  reset.mockResolvedValue(undefined);
  create.mockResolvedValue(chunks([]).stream);
  factory.mockImplementation(() => Promise.resolve({ resetChat: reset, chat: { completions: { create } }, interruptGenerate: interrupt }));
});

describe("the real browser model adapter's request lifecycle", () => {
  it("does not start a request after Stop during reset", async () => {
    const pending = deferred<undefined>();
    reset.mockReturnValue(pending.promise);
    const model = await adapter()();
    const answer = model.answer(input, vi.fn());
    model.stop();
    pending.resolve(undefined);
    await expect(answer).resolves.toBe("");
    expect(create).not.toHaveBeenCalled();
    expect(interrupt).toHaveBeenCalledOnce();
  });

  it("closes an initialized stream without advancing it after Stop during the create handshake", async () => {
    const entered = deferred<undefined>();
    const pending = deferred<AsyncIterable<Chunk>>();
    const stream = chunks([{ choices: [{ delta: { content: "late answer" } }] }]);
    create.mockImplementation(() => { entered.resolve(undefined); return pending.promise; });
    const update = vi.fn();
    const model = await adapter()();
    const answer = model.answer(input, update);
    await entered.promise;
    model.stop();
    pending.resolve(stream.stream);
    await expect(answer).resolves.toBe("");
    expect(stream.next).not.toHaveBeenCalled();
    expect(stream.returned).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not display a pending chunk after Stop during streaming and closes the iterator", async () => {
    const entered = deferred<undefined>();
    const pending = deferred<IteratorResult<Chunk>>();
    const stream = chunks([]);
    stream.next
      .mockResolvedValueOnce({ done: false, value: { choices: [{ delta: { content: "first" } }] } })
      .mockImplementationOnce(() => { entered.resolve(undefined); return pending.promise; });
    create.mockResolvedValue(stream.stream);
    const update = vi.fn();
    const model = await adapter()();
    const answer = model.answer(input, update);
    await entered.promise;
    model.stop();
    pending.resolve({ done: false, value: { choices: [{ delta: { content: "after Stop" } }] } });
    await expect(answer).resolves.toBe("first");
    expect(update.mock.calls).toEqual([["first"]]);
    expect(stream.next).toHaveBeenCalledTimes(2);
    expect(stream.returned).toHaveBeenCalledOnce();
  });

  it("surfaces length-truncated output as incomplete and closes the iterator", async () => {
    const stream = chunks([
      { choices: [{ delta: { content: "A partial answer" } }] },
      { choices: [{ delta: {}, finish_reason: "length" }] },
    ]);
    create.mockResolvedValue(stream.stream);
    const model = await adapter()();
    const update = vi.fn();
    await expect(model.answer(input, update)).rejects.toThrow(/output limit.*incomplete/i);
    expect(stream.returned).toHaveBeenCalledOnce();
  });

  it("returns normal output, strips only empty transport markers, and keeps the model disposable", async () => {
    const stream = chunks([
      { choices: [{ delta: { content: "<think>\n\n</think>\n\n3" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
    create.mockResolvedValue(stream.stream);
    const model = await adapter()();
    await expect(model.answer(input, vi.fn())).resolves.toBe("3");
    expect(reset).toHaveBeenCalledWith(false);
    model.dispose();
    expect(WorkerStub.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it("closes a stream that emits genuine reasoning rather than hiding it", async () => {
    const stream = chunks([{ choices: [{ delta: { content: "<think>Reasoning" } }] }]);
    create.mockResolvedValue(stream.stream);
    const model = await adapter()();
    await expect(model.answer(input, vi.fn())).rejects.toThrow(/emitted reasoning/i);
    expect(stream.returned).toHaveBeenCalledOnce();
  });

  it("closes the stream when the SDK rejects a chunk request", async () => {
    const stream = chunks([]);
    stream.next.mockRejectedValueOnce(new Error("GPU request failed"));
    create.mockResolvedValue(stream.stream);
    const model = await adapter()();
    await expect(model.answer(input, vi.fn())).rejects.toThrow("GPU request failed");
    expect(stream.returned).toHaveBeenCalledOnce();
  });

  it("terminates a worker after a model-load failure", async () => {
    factory.mockRejectedValue(new Error("GPU unavailable"));
    await expect(adapter()()).rejects.toThrow("GPU unavailable");
    expect(WorkerStub.instances[0]?.terminate).toHaveBeenCalledOnce();
  });
});
