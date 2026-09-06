/**
 * `manni docevals generate` — generate check scripts for command-graded evals that
 * have a plain-language assertion but no command yet (or whose assertion
 * changed since generation), without running any evals.
 */
import { loadConfig } from "../core/config.js";
import { discoverPages } from "../core/discover.js";
import { resolvePages } from "../core/resolve.js";
import { makeGenerateScripts } from "../graders/scriptgen.js";
import { makeProvider } from "../judge/provider.js";
import { sha256 } from "../judge/cache.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import type { GraderTarget } from "../graders/types.js";

export interface GenerateOptions {
  config?: string;
  provider?: string;
  model?: string;
  cwd?: string;
  /** Injectable provider for tests and programmatic use. */
  providerInstance?: InferenceProvider;
}

export interface GenerateRun {
  generatedPaths: string[];
  targets: number;
}

export async function runGenerate(
  globs: string[],
  options: GenerateOptions = {},
): Promise<GenerateRun> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(options.config, cwd);
  const pages = discoverPages(config, globs, cwd);
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
  if (targets.length === 0) return { generatedPaths: [], targets: 0 };

  const provider: InferenceProvider =
    options.providerInstance ??
    makeProvider(config, {
      provider: options.provider,
      model: options.model,
    });
  const generate = makeGenerateScripts({ provider, root: cwd });
  const { generatedPaths } = await generate(targets, config, {});
  return { generatedPaths, targets: targets.length };
}
