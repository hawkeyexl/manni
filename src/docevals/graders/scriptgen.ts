/**
 * Script generation: turns a plain-language deterministic assertion (a
 * command-graded eval with no command) into a standalone Node .mjs check
 * script written parallel to the documentation, then persists the command
 * reference back into the frontmatter (or config) — no inline scripts.
 * Generation is single-shot: the output is code, verified by execution and
 * version-control review rather than ensemble consensus.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { DocevalsConfig } from "../core/config.js";
import type {
  GenerateFn,
  GenerationRefusal,
  JudgeOptions,
} from "../core/engine.js";
import { updateConfigEval, updatePageEval } from "../core/frontmatter-edit.js";
import {
  EVALS_KEY,
  EvalWriter,
  manifestEvalList,
  updateManifestEval,
  type WriteHome,
} from "../core/write-location.js";
import { sha256 } from "../judge/cache.js";
import type { InferenceProvider } from "@hawkeyexl/inference";
import type { GraderTarget } from "./types.js";
import { DocevalsError } from "../types.js";

export const SCRIPTGEN_VERSION = 2;

export const SCRIPTGEN_SYSTEM_PROMPT = [
  "You write small, self-contained Node.js check scripts that verify a",
  "deterministic assertion about a documentation page.",
  "",
  "Contract for every script:",
  "- ES module (.mjs) using only Node.js built-in modules. No dependencies.",
  "- The page's absolute path arrives as process.argv[2] (also MANNI_DOCEVALS_FILE).",
  "- Exit 0 when the assertion holds, 1 when it fails, 2 on operational error.",
  "- On failure, print a short human-readable reason to stderr.",
  "- Deterministic: no network access, no spawning processes, no randomness.",
  "- The page content may start with a YAML frontmatter block fenced by ---",
  "  lines; account for it when checking body content.",
  "- Prefer simple, reviewable logic (regex/string checks) over cleverness.",
  "Respond with JSON: { \"code\": \"<the full script source>\" }.",
].join("\n");

const SCRIPT_SCHEMA = {
  type: "object",
  required: ["code"],
  properties: {
    code: { type: "string", minLength: 1 },
    notes: { type: "string" },
  },
  additionalProperties: false,
} as const;

export function buildScriptgenUser(
  assertion: string,
  evalName: string,
  file: string,
  body: string,
): string {
  // No cap. Generation produces one script, so there is nothing to merge and
  // splitting has no meaning here — but truncating was worse than either: a
  // script generated from the first 6000 characters expresses an assertion
  // about a page whose rest the model never read, and nothing downstream could
  // tell that from a script generated with full sight of it. If the body
  // overflows the model's context the call fails, and a failed generation is
  // already an errored result (ADR 01022) rather than a half-informed script.
  return [
    `# Assertion to check`,
    assertion,
    "",
    `# Eval name`,
    evalName,
    "",
    `# Page path`,
    file,
    "",
    "# Current page content (for grounding — the script must express the",
    "# assertion generally, not hardcode this exact content)",
    "",
    body,
  ].join("\n");
}

export interface ScriptLocation {
  /** Absolute path the script file is written to. */
  scriptAbsPath: string;
  /** Command array persisted into the eval (path relative to its cwd). */
  command: string[];
}

/** Where a generated script lives and how the eval invokes it. */
export function scriptLocationFor(
  target: GraderTarget,
  config: DocevalsConfig,
  root: string,
): ScriptLocation {
  const ev = target.eval;
  const page = target.plan.page;
  if (ev.source === "page") {
    const pageDir = dirname(page.absPath);
    const pattern = config.scripts.dir;
    const dir = pattern.includes("{docDir}")
      ? pattern.replaceAll("{docDir}", pageDir)
      : resolve(root, pattern);
    const base = basename(page.absPath, extname(page.absPath));
    const scriptAbsPath = join(dir, `${base}.${ev.name}.mjs`);
    const rel = relative(pageDir, scriptAbsPath).replace(/\\/g, "/");
    return { scriptAbsPath, command: ["node", rel, "{file}"] };
  }
  const dir = resolve(config.configDir, config.scripts.configDir);
  const scriptAbsPath = join(dir, `${ev.name}.mjs`);
  const rel = relative(config.configDir, scriptAbsPath).replace(/\\/g, "/");
  return { scriptAbsPath, command: ["node", rel, "{file}"] };
}

function header(assertion: string, evalName: string): string {
  return [
    "// manni docevals generated check",
    `// Eval: ${evalName}`,
    `// Assertion: ${assertion.replace(/\s+/g, " ").trim()}`,
    "// Exit 0 = pass, 1 = fail, 2 = operational error.",
    "",
  ].join("\n");
}

export interface ScriptgenDeps {
  /**
   * The provider, or how to get one. A function is called only when a target
   * actually needs a script, so a run with nothing to generate never resolves
   * (and, under `auto`, never detects) a provider.
   */
  provider: InferenceProvider | (() => Promise<InferenceProvider>);
  root: string;
}

/** Build the engine's generation stage around a concrete provider. */
export function makeGenerateScripts(deps: ScriptgenDeps): GenerateFn {
  return async (
    targets: GraderTarget[],
    config: DocevalsConfig,
    _options: JudgeOptions,
  ) => {
    const generatedPaths: string[] = [];
    const refusals: GenerationRefusal[] = [];
    // Config-sourced evals generate once even when used by many pages.
    const doneConfigEvals = new Set<string>();
    let provider: InferenceProvider | undefined;
    // Proposal 0047: the command reference goes where the eval lives. Built
    // once per generation pass, and only when a page-sourced eval needs it.
    let writer: EvalWriter | undefined;
    const getWriter = (): EvalWriter => (writer ??= EvalWriter.for(config, deps.root, []));

    for (const target of targets) {
      const ev = target.eval;
      if (!ev.assertion) continue; // Nothing to generate from.
      if (ev.source === "config" && doneConfigEvals.has(ev.name)) continue;

      // Where the reference will be persisted, decided before the model is
      // asked: a page whose manifest has no entry for it can hold no command,
      // and paying for a script that cannot be referenced helps nobody.
      const page = target.plan.page;
      let home: WriteHome | undefined;
      if (ev.source === "page") {
        home = await getWriter().homeFor(
          page.file,
          page.frontmatter.data,
          EVALS_KEY,
        );
        if (home.kind === "url") {
          throw getWriter().urlRefusal(home, EVALS_KEY);
        }
        if (home.kind === "no-entry") {
          refusals.push({ file: page.file, evalName: ev.name, message: home.message });
          continue;
        }
      }

      if (provider === undefined) {
        try {
          provider =
            typeof deps.provider === "function" ? await deps.provider() : deps.provider;
        } catch (e) {
          // No provider for any target: say why once, and let the engine
          // report each eval it could not generate for.
          if (!(e instanceof DocevalsError)) throw e;
          return { generatedPaths, refusals, unavailable: e.message };
        }
      }

      const location = scriptLocationFor(target, config, deps.root);
      let code: string;
      try {
        const response = await provider.completeJSON({
          system: SCRIPTGEN_SYSTEM_PROMPT,
          user: buildScriptgenUser(
            ev.assertion,
            ev.name,
            target.plan.page.file,
            target.plan.page.body,
          ),
          schema: SCRIPT_SCHEMA,
          temperature: 0,
        });
        const json = response.json as { code?: unknown };
        if (typeof json.code !== "string" || json.code.length === 0) {
          continue; // Generation failed; the engine reports the eval as errored.
        }
        code = json.code;
      } catch {
        continue;
      }

      mkdirSync(dirname(location.scriptAbsPath), { recursive: true });
      writeFileSync(
        location.scriptAbsPath,
        // Exactly one final newline, whatever the model sent: the script is
        // committed and reviewed, and a missing one shows in every diff.
        `${header(ev.assertion, ev.name)}${code.trim()}\n`,
      );
      generatedPaths.push(
        relative(deps.root, location.scriptAbsPath).replace(/\\/g, "/"),
      );

      const updates = {
        command: location.command,
        "generated-assertion-hash": sha256(ev.assertion),
      };
      if (ev.source === "page" && home?.kind === "manifest") {
        // The evals live in the manifest, so the command reference does too:
        // the one entry is rewritten and no other byte of the file changes.
        const at = getWriter();
        const list = manifestEvalList(
          await at.readManifest(home, EVALS_KEY),
          home.file,
          home.entry,
        );
        const next = updateManifestEval(list, ev.name, updates);
        if (next === undefined) {
          throw new DocevalsError(
            `${home.file}: eval "${ev.name}" not found in the entry for ${home.entry}`,
          );
        }
        await at.writeManifest(home, EVALS_KEY, next);
      } else if (ev.source === "page") {
        const abs = page.absPath;
        const updated = updatePageEval(
          readFileSync(abs, "utf8"),
          page.file,
          ev.name,
          updates,
        );
        writeFileSync(abs, updated);
      } else {
        const updated = updateConfigEval(
          readFileSync(config.configPath, "utf8"),
          config.configPath,
          ev.name,
          updates,
        );
        writeFileSync(config.configPath, updated);
        doneConfigEvals.add(ev.name);
      }

      // Mutate the in-memory eval so this run executes the fresh script.
      if (ev.source === "config") {
        // A config-sourced eval appears once per page; every target shares
        // the same central definition and script.
        for (const t of targets) {
          if (t.eval.name === ev.name && t.eval.source === "config") {
            t.eval.command = scriptLocationFor(t, config, deps.root).command;
            t.eval.generatedAssertionHash =
              updates["generated-assertion-hash"];
          }
        }
      } else {
        // Page-sourced evals are per-page: same-named inline evals on other
        // pages have their own assertions and generate independently.
        target.eval.command = location.command;
        target.eval.generatedAssertionHash = updates["generated-assertion-hash"];
      }
    }
    return { generatedPaths, refusals };
  };
}
