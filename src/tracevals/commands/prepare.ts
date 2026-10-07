/**
 * `manni tracevals prepare`: fetch what judging needs and warm the rules
 * cache (proposal 0079). The SessionStart hook runs it in the background, and
 * a person or a CI runner can too.
 *
 * Under a hook envelope nothing goes to stdout, because a SessionStart hook's
 * stdout becomes model context. The report goes to stderr instead, as
 * `capture` does.
 */
import { resolve } from "node:path";
import type { InferenceProvider } from "@hawkeyexl/inference";
import { DEFAULT_KEEP_ALIVE_MS } from "../../shared/providers.js";
import { parseHookPayload, readStdin } from "../capture/hook.js";
import { discoverConfig } from "../core/config.js";
import { resolveSelectionIdentity, selectHookProvider } from "../judge/provider.js";
import { NOT_SET_UP, renderPrepare } from "../reporters/conformance.js";
import type { SummaryFormat } from "../reporters/index.js";
import { hostSetting, warmModel, type HostApi } from "../rules/host.js";
import { libraryLocalModels, type LocalModels } from "../rules/local.js";
import { resolveAlwaysSources } from "../rules/sources.js";
import { TracevalsError } from "../types.js";
import {
  extraction,
  firstLine,
  isNetworkProvider,
  rulesCacheFor,
  type Identity,
} from "./conformance.js";

export interface PrepareModel {
  role: "hook" | "extraction";
  provider: string;
  model: string;
  state: "downloaded" | "ready" | "loaded" | "hosted";
  /** Size on disk; null for a hosted model. */
  bytes: number | null;
}

export interface PrepareReport {
  models: PrepareModel[];
  /** Null when not set up, or under `--offline` with a hosted extraction model. */
  extraction: {
    provider: string;
    model: string;
    extracted: number;
    cached: number;
    rules: number;
  } | null;
  warnings: string[];
  exitCode: number;
}

export interface PrepareOptions {
  /** The hook payload. Undefined reads stdin; "" means there was none. */
  stdin?: string;
  /** Project root; default the envelope's cwd, else the current directory. */
  project?: string;
  noCache?: boolean;
  /** Refuse network providers, so only local models are fetched. */
  offline?: boolean;
  format?: SummaryFormat;
  /** Directory holding manni.config.yaml; defaults to the project root. */
  configDir?: string;
  config?: string;
  noConfig?: boolean;
  env?: Record<string, string | undefined>;
  /** Test seams. */
  localModels?: LocalModels;
  extractor?: InferenceProvider;
  /** The model host's calls, in place of the library's. */
  hostApi?: HostApi;
}

export interface PrepareResult {
  report: PrepareReport;
  rendered: string;
  /** Empty under a hook envelope. */
  stdout: string;
  /** The report, under a hook envelope. */
  stderr: string;
  exitCode: number;
}

export async function runPrepare(options: PrepareOptions = {}): Promise<PrepareResult> {
  const raw = options.stdin ?? (await readStdin());
  const hookMode = raw.trim() !== "";
  const payload = hookMode ? parseHookPayload(raw) : {};
  const root = resolve(options.project ?? payload.cwd ?? process.cwd());
  const { config, dir: configDir } = await discoverConfig(options.configDir ?? root, {
    ...(options.config === undefined ? {} : { configPath: options.config }),
    ...(options.noConfig === undefined ? {} : { noConfig: options.noConfig }),
  });

  const finish = (report: PrepareReport, prose: string): PrepareResult => {
    const rendered = options.format === "json" ? JSON.stringify(report, null, 2) : prose;
    return {
      report,
      rendered,
      stdout: hookMode ? "" : rendered,
      stderr: hookMode ? rendered : "",
      exitCode: report.exitCode,
    };
  };

  const conformance = config.conformance;
  if (conformance === null) {
    return finish({ models: [], extraction: null, warnings: [NOT_SET_UP], exitCode: 0 }, NOT_SET_UP);
  }

  const local = options.localModels ?? libraryLocalModels(config.providers);
  const keepAlive = config.providers["llama-cpp"]?.keepAlive;
  const ex = await extraction(
    config,
    rulesCacheFor(config, configDir, options.noCache === true),
    options.extractor,
    hostSetting(hookMode, payload.sessionId, keepAlive),
  );
  const roles: [PrepareModel["role"], Identity][] = [
    ["hook", await resolveSelectionIdentity(config, selectHookProvider(config))],
    ["extraction", ex.identity],
  ];

  // Step 1: each local model on disk, fetched once however many roles use it.
  const ensured = new Map<string, ReturnType<LocalModels["ensure"]>>();
  const models: PrepareModel[] = [];
  for (const [role, id] of roles) {
    if (id.provider !== "llama-cpp") {
      models.push({ role, provider: id.provider, model: id.model, state: "hosted", bytes: null });
      continue;
    }
    let fetching = ensured.get(id.model);
    if (fetching === undefined) {
      fetching = local.ensure(id.model);
      ensured.set(id.model, fetching);
    }
    let result: Awaited<typeof fetching>;
    try {
      result = await fetching;
    } catch (err) {
      throw new TracevalsError(`could not download ${id.model}: ${firstLine(err)}`);
    }
    const entry: PrepareModel = { role, provider: id.provider, model: id.model, state: result.state, bytes: result.bytes };
    // Step 2: under SessionStart, the session's lease and a warm model.
    if (
      role === "hook" &&
      payload.hookEvent === "SessionStart" &&
      payload.sessionId !== undefined &&
      (await warmModel(
        {
          sessionId: payload.sessionId,
          model: id.model,
          keepAliveMs: keepAlive ?? DEFAULT_KEEP_ALIVE_MS,
          ...(config.providers["llama-cpp"]?.modelsDir !== undefined
            ? { modelsDirectory: config.providers["llama-cpp"].modelsDir }
            : {}),
        },
        options.hostApi,
      ))
    ) {
      entry.state = "loaded";
    }
    models.push(entry);
  }

  // Step 3: the rules of every source that applies to every session.
  const report: PrepareReport = { models, extraction: null, warnings: [], exitCode: 0 };
  if (options.offline !== true || !isNetworkProvider(ex.identity.provider)) {
    const resolved = await resolveAlwaysSources({
      projectDir: root,
      ...(options.project !== undefined ? { projectRoot: root } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      include: conformance.include,
      exclude: conformance.exclude,
    });
    report.warnings.push(...resolved.warnings);
    const summary = { provider: ex.identity.provider, model: ex.identity.model, extracted: 0, cached: 0, rules: 0 };
    for (const source of resolved.sources) {
      if (source.declaredRules !== undefined) continue;
      if (!ex.needs(source)) {
        summary.cached += 1;
        continue;
      }
      const { rules } = await ex.rulesOf(source);
      summary.extracted += 1;
      summary.rules += rules.length;
    }
    report.extraction = summary;
  }
  return finish(report, renderPrepare(report));
}
