/**
 * `manni docevals generate` — generate check scripts for command-graded evals that
 * have a plain-language assertion but no command yet (or whose assertion
 * changed since generation), without running any evals.
 */
import { loadRunConfig } from "../core/config.js";
import {
  discoverPages,
  documentSet,
  runConfigOptions,
  type DocumentInputOptions,
} from "../core/discover.js";
import { withExternalMetadata } from "../core/external.js";
import { resolvePages } from "../core/resolve.js";
import { makeGenerateScripts } from "../graders/scriptgen.js";
import {
  assertProviderSelection,
  makeProvider,
  selectProvider,
} from "../judge/provider.js";
import { sha256 } from "../judge/cache.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import type { GraderTarget } from "../graders/types.js";
import type { GenerationRefusal } from "../core/engine.js";

export interface GenerateOptions extends DocumentInputOptions {
  provider?: string;
  model?: string;
  /** Run inference on this machine, with llama-cpp, over any configured or eval-level provider. */
  local?: boolean;
  cwd?: string;
  /** Injectable provider for tests and programmatic use. */
  providerInstance?: InferenceProvider;
}

export interface GenerateRun {
  generatedPaths: string[];
  targets: number;
  /**
   * Evals whose command reference had nowhere to go (proposal 0047): the
   * manifest that owns the page's evals joins on a field the page lacks. Each
   * counts against `targets`, so the run reports a partial generation, and the
   * sentence says which page and why.
   */
  refusals: GenerationRefusal[];
}

export async function runGenerate(
  paths: string[],
  options: GenerateOptions = {},
): Promise<GenerateRun> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadRunConfig(runConfigOptions(paths, options), cwd);
  const flags = { provider: options.provider, model: options.model, local: options.local };
  // Checked before discovery, and even when nothing needs generating: a typo
  // is a usage error on every run, not only on the runs that reach a model.
  assertProviderSelection(selectProvider(config, flags));
  const pages = await withExternalMetadata(
    discoverPages(config, documentSet(paths, options, "read"), cwd),
    config,
    cwd,
  );
  const plans = resolvePages(pages, config);

  const targets: GraderTarget[] = [];
  // A config-defined eval is one eval however many pages reference it, and
  // `makeGenerateScripts` already treats it that way (its `doneConfigEvals`
  // set writes one script). Counting it per page made the two disagree, and
  // `src/cli.ts` reads that disagreement as a partial generation: it printed
  // "Generated 1/2" and exited 1 on a completely successful run. `runPromote`
  // has carried the same guard from the start.
  const seenConfigEvals = new Set<string>();
  for (const plan of plans) {
    if (plan.skip || plan.problems.some((p) => p.level === "error")) continue;
    for (const ev of plan.evals) {
      if (ev.skip || ev.grader !== "command") continue;
      const missing = !ev.command;
      const stale =
        ev.command != null &&
        ev.generatedAssertionHash != null &&
        ev.assertion != null &&
        ev.generatedAssertionHash !== sha256(ev.assertion);
      if ((missing || stale) && ev.assertion) {
        if (ev.source === "config") {
          if (seenConfigEvals.has(ev.name)) continue;
          seenConfigEvals.add(ev.name);
        }
        targets.push({ plan, eval: ev });
      }
    }
  }
  // Nothing to generate: return before a provider is built, so a corpus with
  // no outstanding scripts needs no API key to be told so.
  if (targets.length === 0) return { generatedPaths: [], targets: 0, refusals: [] };

  const provider: InferenceProvider =
    options.providerInstance ?? (await makeProvider(config, flags));
  const generate = makeGenerateScripts({ provider, root: cwd });
  const { generatedPaths, refusals } = await generate(targets, config, {});
  return { generatedPaths, targets: targets.length, refusals: refusals ?? [] };
}
