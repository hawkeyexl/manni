
// Manual opt-in browser/WebGPU evaluation. Downloads models; never in npm test.
/* global window, Worker */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const MODELS = [
  "Qwen3-1.7B-q4f32_1-MLC",
  "Qwen3.5-2B-q4f32_1-MLC",
  "Qwen3.5-0.8B-q4f32_1-MLC",
  "Llama-3.2-1B-Instruct-q4f32_1-MLC",
];
const CONFIGURATION = { contextWindow: 4096, maxTokens: 384, seed: 42 };
const REFERENCES = {
  qwen3: "https://huggingface.co/Qwen/Qwen3-1.7B",
  qwen35: "https://huggingface.co/Qwen/Qwen3.5-2B",
  webllm: "https://github.com/mlc-ai/web-llm",
};
const digest = (value) => createHash("sha256").update(value).digest("hex");
const round = (value) => Math.round(value * 100) / 100;
const displayPath = (value) => path.relative(ROOT, value).split(path.sep).join("/");
const errorMessage = (error) => error instanceof Error ? error.message : String(error);
const withoutQuery = (value) => {
  const url = new URL(value);
  return url.origin + url.pathname;
};
const median = (values) => {
  const sorted = values.filter((value) => typeof value === "number").toSorted((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
};

function modelSettings(id) {
  if (id.startsWith("Qwen3-")) {
    return {
      sampling: { temperature: 0.7, top_p: 0.8, presence_penalty: 0, frequency_penalty: 0, repetition_penalty: 1 },
      thinking: { mode: "disabled", extra_body: { enable_thinking: false } },
      samplingSource: REFERENCES.qwen3,
      unsupportedRecommendedParameters: { top_k: 20, min_p: 0 },
    };
  }
  if (id.startsWith("Qwen3.5-")) {
    return {
      sampling: { temperature: 1, top_p: 1, presence_penalty: 2, frequency_penalty: 0, repetition_penalty: 1 },
      thinking: { mode: "default-nonthinking", extra_body: null },
      samplingSource: REFERENCES.qwen35,
      unsupportedRecommendedParameters: { top_k: 20, min_p: 0 },
    };
  }
  return {
    sampling: { temperature: 0, top_p: 1, presence_penalty: 0, frequency_penalty: 0, repetition_penalty: 1 },
    thinking: { mode: "not-applicable", extra_body: null },
    samplingSource: "Prior Llama 1B playground baseline",
    unsupportedRecommendedParameters: {},
  };
}

export function summaryFor(cases, total) {
  const finished = cases.filter((item) => item.status === "completed");
  return {
    total, completed: finished.length,
    passed: finished.filter((item) => item.grade.pass).length,
    failed: finished.filter((item) => !item.grade.pass).length,
    critical: finished.filter((item) => item.grade.critical).length,
    executionErrors: cases.filter((item) => item.status !== "completed").length,
    medianFirstTokenMs: median(finished.map((item) => item.latency.firstTokenMs)),
    medianTotalMs: median(finished.map((item) => item.latency.totalMs)),
  };
}

export function compactReport(report) {
  const lines = [
    "# Graph playground model evaluation", "",
    `Fixture SHA-256: ${report.fixture.sha256}. WebLLM ${report.environment.webllmVersion}; ${report.environment.browser}.`, "",
    "These are single seeded runs of the committed cases, with identical messages and model-specific documented sampling. They are a small regression set, not a general model-quality benchmark.", "",
    "| Model | Status | Pass | Critical failures | Median first token | Median total | Load | Observed response-body bytes | Cache before | Configured VRAM MB |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|---:|",
  ];
  for (const model of report.models) {
    const result = model.summary ?? summaryFor([], report.fixture.cases);
    lines.push(`| ${model.id} | ${model.status} | ${result.passed}/${result.total} | ${result.critical} | ${result.medianFirstTokenMs ?? "n/a"} ms | ${result.medianTotalMs ?? "n/a"} ms | ${model.loadMs ?? "n/a"} ms | ${model.download?.responseBodyBytes ?? "n/a"} | ${model.cacheBefore === true ? "warm" : model.cacheBefore === false ? "cold" : "unknown"} | ${model.record?.vram_required_MB ?? "n/a"} |`);
  }
  lines.push("", "Configured VRAM is the SDK registry estimate, not a measurement. Download bytes are Playwright's observed external HTTP response-body bytes; they exclude cached tensors and may be incomplete when the browser cannot report a response size. SDK cumulative fetched MB is recorded separately in JSON.", "");
  for (const model of report.models) {
    lines.push(`## ${model.id}`, "");
    if (model.error) lines.push(`Execution error: ${model.error}`, "");
    for (const item of model.cases) {
      if (item.status !== "completed" || !item.grade.pass) {
        lines.push(`- ${item.id}: ${item.status === "completed" ? item.grade.issues.join("; ") : item.error}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const parsed = parseArgs({ options: {
    help: { type: "boolean", short: "h" }, models: { type: "string" },
    fixture: { type: "string", default: "test/fixtures/retrieve-prototype/model-evaluation.json" },
    out: { type: "string", default: ".tmp/graph-playground-model-evaluation.json" },
    profile: { type: "string", default: ".tmp/graph-playground-evaluation-browser" },
    channel: { type: "string", default: "msedge" }, port: { type: "string", default: "4338" },
    "case-timeout-ms": { type: "string", default: "120000" },
    "load-timeout-ms": { type: "string", default: "300000" },
  } });
  if (parsed.values.help) {
    process.stdout.write(`Manual graph playground model evaluation (network and WebGPU required).

Usage: node scripts/evaluate-graph-playground.mjs [options]

  --models <list>           comma-separated candidate IDs; defaults to all four
  --fixture <path>          frozen case fixture, relative to repository root
  --out <path>              JSON report (summary uses the same basename)
  --profile <path>          persistent browser cache directory
  --channel <name>          installed browser channel; default msedge
  --port <number>           local SDK server; default 4338 (stable cache origin)
  --case-timeout-ms <ms>    per-case execution ceiling; default 120000
  --load-timeout-ms <ms>    model-load ceiling; default 300000
  -h, --help                print this help without running models

Models:
${MODELS.map((id) => `  ${id}`).join("\n")}

Exit 0: complete report, including answer-quality failures.
Exit 1: report saved with model/case execution failures.
Exit 2: usage, fixture, browser or local-server setup failure.
`);
    return 0;
  }
  const ids = parsed.values.models?.split(",").map((value) => value.trim()) ?? MODELS;
  if (ids.length === 0 || ids.some((id) => !MODELS.includes(id)) || new Set(ids).size !== ids.length) {
    throw new Error("--models must name each supported candidate at most once, comma-separated.");
  }
  const numberOption = (name) => {
    const value = Number(parsed.values[name]);
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`--${name} must be a positive integer.`);
    return value;
  };
  const port = numberOption("port");
  if (port > 65535) throw new Error("--port must be at most 65535.");
  const caseTimeout = numberOption("case-timeout-ms");
  const loadTimeout = numberOption("load-timeout-ms");
  const fixturePath = path.resolve(ROOT, parsed.values.fixture);
  const outPath = path.resolve(ROOT, parsed.values.out);
  const summaryPath = outPath.replace(/\.json$/i, "") + "-summary.md";
  const profile = path.resolve(ROOT, parsed.values.profile);
  const fixtureText = await readFile(fixturePath, "utf8");
  const fixture = JSON.parse(fixtureText);
  const { gradeAnswer, validateEvaluationFixture } = await import("./lib/graph-playground-evaluation.mjs");
  const { modelAnswerText, hasModelReasoning } = await import("../docs/src/components/retrieve-prototype-answer.ts");
  const grading = {
    grader: { path: "scripts/lib/graph-playground-evaluation.mjs", sha256: digest(await readFile(path.join(ROOT, "scripts/lib/graph-playground-evaluation.mjs"))) },
    formatter: { path: "docs/src/components/retrieve-prototype-answer.ts", sha256: digest(await readFile(path.join(ROOT, "docs/src/components/retrieve-prototype-answer.ts"))) },
    protocol: { disallowTruncation: true, allowLeadingEmptyThinkingPrefix: true, disallowActualReasoning: true },
    appliedAt: new Date().toISOString(),
  };
  const validation = validateEvaluationFixture(fixture);
  if (validation.length) throw new Error(`Invalid evaluation fixture: ${validation.join("; ")}`);
  if (fixture.cases.length !== 20) throw new Error("The fixed evaluation fixture must contain exactly 20 cases.");
  const sdkDirectory = path.join(ROOT, "docs/node_modules/@mlc-ai/web-llm");
  const sdkPath = path.join(sdkDirectory, "lib/index.js");
  const sdkPackage = JSON.parse(await readFile(path.join(sdkDirectory, "package.json"), "utf8"));
  await stat(sdkPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  await mkdir(profile, { recursive: true });
  const origin = `http://127.0.0.1:${port}`;
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", origin).pathname;
    if (pathname === "/webllm.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      createReadStream(sdkPath).pipe(response);
    } else if (pathname === "/worker.js") {
      response.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
      response.end('import { WebWorkerMLCEngineHandler } from "/webllm.js"; const handler = new WebWorkerMLCEngineHandler(); self.onmessage = event => handler.onmessage(event);');
    } else if (pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><title>Manual graph model evaluation</title><p>Manual WebGPU model evaluation.</p>");
    } else { response.writeHead(404); response.end("Not found"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  let context;
  let active;
  const pendingNetwork = [];
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), completedAt: null,
    fixture: { path: displayPath(fixturePath), sha256: digest(fixtureText), provenance: fixture.provenance, cases: fixture.cases.length },
    environment: { node: process.version, platform: process.platform, arch: process.arch, systemMemoryBytes: os.totalmem(), browser: null, webllmVersion: sdkPackage.version, gpu: null },
    configuration: { ...CONFIGURATION, models: ids, channel: parsed.values.channel, profile: displayPath(profile), origin, references: REFERENCES },
    grading, models: [], summary: null,
  };
  const save = async () => {
    await writeFile(outPath, JSON.stringify(report, null, 2) + "\n");
    await writeFile(summaryPath, compactReport(report));
  };
  const withTimeout = async (promise, milliseconds, label) => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms.`)), milliseconds);
      })]);
    } finally { clearTimeout(timer); }
  };
  try {
    context = await chromium.launchPersistentContext(profile, { channel: parsed.values.channel, headless: true });
    report.environment.browser = await context.browser()?.version() ?? parsed.values.channel;
    context.on("requestfinished", (request) => {
      const current = active;
      if (!current || request.url().startsWith(origin)) return;
      pendingNetwork.push((async () => {
        try {
          const sizes = await request.sizes();
          const response = await request.response();
          current.download.requests.push({
            url: withoutQuery(request.url()), status: response?.status() ?? null,
            responseBodyBytes: sizes.responseBodySize >= 0 ? sizes.responseBodySize : null,
            requestBodyBytes: sizes.requestBodySize >= 0 ? sizes.requestBodySize : null,
          });
        } catch (error) {
          current.download.unreportedRequests.push({ url: withoutQuery(request.url()), error: errorMessage(error) });
        }
      })());
    });
    context.on("requestfailed", (request) => {
      if (active && !request.url().startsWith(origin)) active.download.failedRequests.push({ url: withoutQuery(request.url()), error: request.failure()?.errorText ?? "Request failed" });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => { if (active) active.browserErrors.push(errorMessage(error)); });
    page.on("console", (message) => {
      if (message.type() !== "log" || !message.text().startsWith("EVAL_PROGRESS ")) return;
      try {
        const item = JSON.parse(message.text().slice("EVAL_PROGRESS ".length));
        if (active) {
          active.progress.push(item);
          const match = /Fetching param cache.*?:\s*([\d.]+)MB fetched/.exec(item.text);
          if (match) active.download.sdkCumulativeFetchedMB = Math.max(active.download.sdkCumulativeFetchedMB, Number(match[1]));
        }
        process.stdout.write(`[${active?.id ?? "model"}] ${item.text}\n`);
      } catch { // Malformed progress cannot change model results.
      }
    });
    await page.goto(origin);
    report.environment.userAgent = await page.evaluate(() => navigator.userAgent);
    report.environment.gpu = await page.evaluate(async () => {
      if (!navigator.gpu) throw new Error("The browser exposes no WebGPU.");
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("The browser could not acquire a WebGPU adapter.");
      const info = adapter.info;
      return {
        vendor: info?.vendor ?? null, architecture: info?.architecture ?? null,
        device: info?.device ?? null, description: info?.description ?? null,
        isFallbackAdapter: adapter.isFallbackAdapter ?? null, features: [...adapter.features].sort(),
        limits: { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize },
      };
    });
    await page.evaluate(async () => { window.evaluationSdk = await import("/webllm.js"); });
    for (const id of ids) {
      const settings = modelSettings(id);
      const result = {
        id, status: "loading", ...settings, record: null, cacheBefore: null, loadMs: null,
        download: { responseBodyBytes: 0, requestCount: 0, sdkCumulativeFetchedMB: 0, requests: [], unreportedRequests: [], failedRequests: [] },
        progress: [], browserErrors: [], cases: [], summary: null,
      };
      report.models.push(result); active = result; await save();
      try {
        result.quantization = "q4f32_1";
        result.record = await page.evaluate((modelId) => window.evaluationSdk.prebuiltAppConfig.model_list.find((record) => record.model_id === modelId) ?? null, id);
        if (!result.record) throw new Error("Installed WebLLM registry does not contain " + id + ".");
        result.cacheBefore = await page.evaluate((modelId) => window.evaluationSdk.hasModelInCache(modelId).catch(() => null), id);
        const started = performance.now();
        const loaded = await withTimeout(page.evaluate(async ({ id, contextWindow }) => {
          const sdk = window.evaluationSdk;
          const record = sdk.prebuiltAppConfig.model_list.find((model) => model.model_id === id);
          if (!record) throw new Error(`Installed WebLLM registry does not contain ${id}.`);
          const cacheBefore = await sdk.hasModelInCache(id).catch(() => null);
          const worker = new Worker("/worker.js", { type: "module" });
          window.evaluationWorker = worker;
          window.evaluationEngine = await sdk.CreateWebWorkerMLCEngine(worker, id, {
            initProgressCallback: (progress) => console.log("EVAL_PROGRESS " + JSON.stringify({ at: new Date().toISOString(), text: progress.text })),
          }, { context_window_size: contextWindow });
          return { record, cacheBefore, gpuVendor: await window.evaluationEngine.getGPUVendor() };
        }, { id, contextWindow: CONFIGURATION.contextWindow }), loadTimeout, `Loading ${id}`);
        result.loadMs = round(performance.now() - started);
        result.record = loaded.record; result.cacheBefore = loaded.cacheBefore; result.gpuVendor = loaded.gpuVendor;
        result.status = "running";
        let consecutiveErrors = 0;
        for (const testCase of fixture.cases) {
          const item = { id: testCase.id, operation: testCase.operation, question: testCase.question, input: testCase.input, inputSha256: digest(JSON.stringify(testCase.input.messages)), expected: testCase.expected, status: "running" };
          result.cases.push(item);
          try {
            const response = await withTimeout(page.evaluate(async ({ messages, settings, seed, maxTokens }) => {
              const engine = window.evaluationEngine;
              // Each case starts with fresh KV/chat state before measuring.
              await engine.resetChat(false);
              const started = performance.now();
              let firstTokenMs = null;
              let answer = "";
              let finishReason = null;
              let reasoning = "";
              let usage = null;
              const request = {
                messages, ...settings.sampling, seed, max_tokens: maxTokens,
                stream: true, stream_options: { include_usage: true },
                ...(settings.thinking.extra_body ? { extra_body: settings.thinking.extra_body } : {}),
              };
              const stream = await engine.chat.completions.create(request);
              for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta.content ?? "";
                if (content && firstTokenMs === null) firstTokenMs = performance.now() - started;
                answer += content;
                reasoning += chunk.choices[0]?.delta.reasoning_content ?? "";
                finishReason = chunk.choices[0]?.finish_reason ?? finishReason;
                if (chunk.usage) usage = chunk.usage;
              }
              return { answer, reasoning, thinkingOutputDetected: reasoning.length > 0 || /<\/?think>/.test(answer), finishReason, usage, latency: { firstTokenMs, totalMs: performance.now() - started }, request };
            }, { messages: testCase.input.messages, settings, seed: CONFIGURATION.seed, maxTokens: CONFIGURATION.maxTokens }), caseTimeout, `${id} / ${testCase.id}`);
            Object.assign(item, response, {
              status: "completed",
              latency: { firstTokenMs: response.latency.firstTokenMs === null ? null : round(response.latency.firstTokenMs), totalMs: round(response.latency.totalMs) },
              rawAnswer: response.answer, visibleAnswer: modelAnswerText(response.answer),
              thinkingOutputDetected: hasModelReasoning(response.answer) || response.reasoning.trim().length > 0,
              grade: gradeAnswer(testCase, modelAnswerText(response.answer)),
            });
            const protocolIssues = [];
            if (response.finishReason === "length") protocolIssues.push("Output exhausted the fixed 384-token budget.");
            if (item.thinkingOutputDetected) protocolIssues.push("Unexpected thinking output under the nonthinking protocol.");
            if (protocolIssues.length) item.grade = { ...item.grade, pass: false, issues: [...item.grade.issues, ...protocolIssues], protocolIssues };
            consecutiveErrors = 0;
            process.stdout.write(`${id} ${testCase.id} ${item.grade.pass ? "PASS" : "FAIL"} (${item.latency.totalMs} ms)\n`);
          } catch (error) {
            item.status = "error"; item.error = errorMessage(error); consecutiveErrors += 1;
            process.stderr.write(`${id} ${testCase.id}: ${item.error}\n`);
          }
          result.summary = summaryFor(result.cases, fixture.cases.length); await save();
          if (consecutiveErrors >= 3 || item.error?.includes("exceeded")) {
            result.error = "Model execution stopped after a timeout or three consecutive case errors."; break;
          }
        }
        result.status = result.cases.length === fixture.cases.length && result.cases.every((item) => item.status === "completed") ? "completed" : "execution-error";
      } catch (error) {
        result.status = result.cases.length ? "execution-error" : "load-error"; result.error = errorMessage(error);
        process.stderr.write(`${id} could not complete: ${result.error}\n`);
      } finally {
        // Unload, then always terminate the worker before the next model loads.
        await withTimeout(page.evaluate(async () => {
          try { await window.evaluationEngine?.unload(); }
          finally { window.evaluationWorker?.terminate(); window.evaluationWorker = null; window.evaluationEngine = null; }
        }), 10000, `Unloading ${id}`).catch(async () => {
          await page.evaluate(() => { window.evaluationWorker?.terminate(); window.evaluationWorker = null; window.evaluationEngine = null; }).catch(() => {});
        });
        await Promise.allSettled(pendingNetwork.splice(0));
        result.download.responseBodyBytes = result.download.requests.reduce((sum, request) => sum + (request.responseBodyBytes ?? 0), 0);
        result.download.requestCount = result.download.requests.length;
        result.summary = summaryFor(result.cases, fixture.cases.length); await save(); active = null;
      }
    }
    report.completedAt = new Date().toISOString();
    report.summary = {
      selectedModels: ids.length, completedModels: report.models.filter((model) => model.status === "completed").length,
      executionFailedModels: report.models.filter((model) => model.status !== "completed").length, caseCount: fixture.cases.length,
    };
    await save();
    process.stdout.write(`Model evaluation complete: ${report.summary.completedModels}/${ids.length} models; report ${displayPath(outPath)}\n`);
    return report.summary.executionFailedModels ? 1 : 0;
  } finally {
    await context?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`graph-playground-evaluation: ${errorMessage(error)}\n`); process.exitCode = 2; }
}
