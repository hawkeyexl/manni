/**
 * `manni docevals promote` — the grader hierarchy in tool form: review ai-graded
 * evals, ask the LLM which are expressible as deterministic checks, and (with
 * --write) rewrite them as command-graded evals backed by generated scripts.
 * Never runs automatically as part of `manni docevals run`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { loadConfig } from "../core/config.js";
import { discoverPages } from "../core/discover.js";
import { resolvePages } from "../core/resolve.js";
import {
  hasEditableEval,
  updateConfigEval,
  updatePageEval,
} from "../core/frontmatter-edit.js";
import { sha256 } from "../judge/cache.js";
import { makeProvider } from "../judge/provider.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import {
  SCRIPTGEN_SYSTEM_PROMPT,
  buildScriptgenUser,
  scriptLocationFor,
} from "../graders/scriptgen.js";
import type { GraderTarget } from "../graders/types.js";

const PROMOTE_SCHEMA = {
  type: "object",
  required: ["promotable", "rationale"],
  properties: {
    promotable: {
      type: "boolean",
      description:
        "True only when the assertion can be fully checked by a deterministic script with no semantic judgment.",
    },
    rationale: { type: "string" },
    code: {
      type: "string",
      description: "The check script source, required when promotable is true.",
    },
  },
  additionalProperties: false,
} as const;

const PROMOTE_SYSTEM = [
  "You review documentation eval assertions and decide whether each can be",
  "verified by a deterministic script instead of LLM judgment. Promote only",
  "assertions that are fully checkable with string/regex/structural logic —",
  "anything requiring semantic interpretation stays with the LLM judge.",
  "",
  SCRIPTGEN_SYSTEM_PROMPT,
  "",
  'Respond with JSON: { "promotable": bool, "rationale": "...", "code": "..." }',
  "(omit code when not promotable).",
].join("\n");

export interface PromoteOptions {
  config?: string;
  write?: boolean;
  provider?: string;
  model?: string;
  cwd?: string;
  /** Injectable provider for tests and programmatic use. */
  providerInstance?: InferenceProvider;
}

export interface PromoteProposal {
  file: string;
  evalName: string;
  source: "page" | "config";
  promotable: boolean;
  rationale: string;
  scriptPath?: string;
  applied: boolean;
}

async function assess(
  provider: InferenceProvider,
  target: GraderTarget,
): Promise<{ promotable: boolean; rationale: string; code?: string }> {
  try {
    const response = await provider.completeJSON({
      system: PROMOTE_SYSTEM,
      user: buildScriptgenUser(
        target.eval.assertion ?? "",
        target.eval.name,
        target.plan.page.file,
        target.plan.page.body,
      ),
      schema: PROMOTE_SCHEMA,
      temperature: 0,
    });
    const json = response.json as {
      promotable?: unknown;
      rationale?: unknown;
      code?: unknown;
    };
    return {
      promotable: json.promotable === true,
      rationale: typeof json.rationale === "string" ? json.rationale : "",
      code: typeof json.code === "string" ? json.code : undefined,
    };
  } catch (e) {
    return {
      promotable: false,
      rationale: `assessment failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function runPromote(
  globs: string[],
  options: PromoteOptions = {},
): Promise<PromoteProposal[]> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(options.config, cwd);
  const pages = discoverPages(config, globs, cwd);
  const plans = resolvePages(pages, config);

  // Built on first use, not up front. A corpus with no ai-graded evals has
  // nothing to assess, and demanding an API key to be told so is the same
  // needless gate `fill` already avoids by resolving identity lazily.
  let provider: InferenceProvider | undefined = options.providerInstance;
  const getProvider = (): InferenceProvider =>
    (provider ??= makeProvider(config, {
      provider: options.provider,
      model: options.model,
    }));

  const proposals: PromoteProposal[] = [];
  const seenConfigEvals = new Set<string>();

  for (const plan of plans) {
    if (plan.skip || plan.problems.some((p) => p.level === "error")) continue;
    for (const ev of plan.evals) {
      if (ev.skip || ev.grader !== "ai" || !ev.assertion) continue;
      if (ev.source === "config") {
        if (seenConfigEvals.has(ev.name)) continue;
        seenConfigEvals.add(ev.name);
      }

      const target: GraderTarget = { plan, eval: ev };
      const assessment = await assess(getProvider(), target);
      const proposal: PromoteProposal = {
        file: plan.page.file,
        evalName: ev.name,
        source: ev.source,
        promotable: assessment.promotable,
        rationale: assessment.rationale,
        applied: false,
      };

      if (assessment.promotable && assessment.code && options.write) {
        const location = scriptLocationFor(target, config, cwd);
        mkdirSync(dirname(location.scriptAbsPath), { recursive: true });
        writeFileSync(location.scriptAbsPath, assessment.code);
        proposal.scriptPath = relative(cwd, location.scriptAbsPath).replace(
          /\\/g,
          "/",
        );
        const updates = {
          grader: "command",
          command: location.command,
          // The kebab key `applyUpdates` actually reads. This was the
          // pre-1.0 `generated: { assertionHash }` wrapper, which the update
          // type does not consume, so promoted evals were written with no
          // hash and never went stale when their assertion changed
          // (renamed by ADR 01009).
          "generated-assertion-hash": sha256(ev.assertion),
        };
        if (
          ev.source === "page" &&
          hasEditableEval(plan.page.content, ev.name)
        ) {
          const updated = updatePageEval(
            readFileSync(plan.page.absPath, "utf8"),
            plan.page.file,
            ev.name,
            updates,
          );
          writeFileSync(plan.page.absPath, updated);
          proposal.applied = true;
        } else if (ev.source === "config") {
          const updated = updateConfigEval(
            readFileSync(config.configPath, "utf8"),
            config.configPath,
            ev.name,
            updates,
          );
          writeFileSync(config.configPath, updated);
          proposal.applied = true;
        }
      }
      proposals.push(proposal);
    }
  }
  return proposals;
}
