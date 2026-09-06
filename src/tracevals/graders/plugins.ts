/**
 * Grader plugins: modules named by `tracevals.plugins` or `--require`, imported
 * before evals are planned so a `registerGrader` call from outside this package
 * lands before the registry is read (ADR 01017).
 *
 * Loading is deliberately loud. A specifier that will not import is a
 * `TracevalsError` rather than a skip, because a run that quietly went ahead
 * without the plugin reports `unknown grader kind` — a message that reads like
 * a typo in an artifact and sends the reader to the wrong file entirely.
 *
 * The code being loaded is named by the *evaluating* repo's config, not by the
 * evaluated trace's artifacts. That is a strictly smaller surface than the
 * `command` grader already accepts (ADR 01011); the ADR states the comparison.
 */
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BUILTIN_GRADER_KINDS,
  graderFor,
  listGraderKinds,
  registerGrader,
} from "./registry.js";
import { TracevalsError } from "../types.js";
import type { TraceGrader } from "./types.js";

/** What a plugin's `register` export is handed. */
export interface GraderPluginApi {
  registerGrader: (grader: TraceGrader) => void;
}

export type GraderPluginRegister = (
  api: GraderPluginApi,
) => void | Promise<void>;

export interface LoadGraderPluginsOptions {
  /** Module specifiers in load order; a later one wins a colliding kind. */
  plugins: string[];
  /** Directory holding manni.config.yaml. Specifiers resolve against it. */
  configDir: string;
}

export interface LoadedGraderPlugins {
  /** Specifiers newly imported by this call; already-loaded ones are omitted. */
  loaded: string[];
  /** Non-fatal problems: a plugin that registered nothing, or took a kind over. */
  warnings: string[];
}

/**
 * Every module location loaded so far in this process, so a plugin is loaded
 * exactly once however many times it is named — across calls, not just within
 * one.
 *
 * ESM already gives that guarantee to a plugin that registers while it is
 * imported: the second `import()` returns the cached module and its body does
 * not re-run. A plugin exporting `register` would otherwise get called again on
 * every load, so the two shapes would disagree — a batch that evaluates N
 * traces in one process would re-register on each, and report N-1 spurious
 * "replaced the grader" warnings. Tracking it here makes them agree.
 */
const alreadyLoaded = new Set<string>();

/** `./x`, `../x`, and their backslash spellings — never a bare package name. */
const RELATIVE = /^\.\.?[/\\]/;

interface Located {
  /** What `import()` is given. */
  href: string;
  /** What the error message shows, when it says more than the specifier. */
  shown?: string;
}

/**
 * Where a specifier points.
 *
 * Paths resolve against the **config file's directory**, not `process.cwd()`,
 * so a committed config naming `./tracevals/graders.mjs` means the same thing
 * from any working directory — including a CI step that runs the CLI from the
 * repository root against a project one level down.
 *
 * A bare name goes through Node's own algorithm rooted at that same directory,
 * so a plugin installed beside the config beats one installed beside this
 * package. If nothing resolves there the bare specifier is handed to `import()`
 * unchanged, which gives a plugin sitting next to manni itself a
 * chance and keeps the failure message worded the way the user wrote it.
 */
function locate(specifier: string, configDir: string): Located {
  if (specifier.startsWith("file:")) return { href: specifier };
  if (RELATIVE.test(specifier) || isAbsolute(specifier)) {
    const path = resolve(configDir, specifier);
    return { href: pathToFileURL(path).href, shown: path };
  }
  try {
    // createRequire needs an absolute filename; the "package.json" leaf never
    // has to exist — it only anchors the node_modules walk to configDir.
    const path = createRequire(join(resolve(configDir), "package.json")).resolve(
      specifier,
    );
    return { href: pathToFileURL(path).href, shown: path };
  } catch {
    return { href: specifier };
  }
}

/**
 * Two supported shapes, in this order:
 *
 * - `export function register({ registerGrader })` (also `export default`) —
 *   the registrar is handed in, so the plugin needs no import of this package
 *   and cannot bind to the wrong copy of it.
 * - Nothing exported, having called `registerGrader` at import time. That is
 *   what the extend guide has always documented, and it keeps working; it just
 *   depends on the specifier resolving to the copy of the registry the process
 *   is running.
 */
function registrarIn(
  mod: Record<string, unknown>,
): GraderPluginRegister | undefined {
  if (typeof mod.register === "function") {
    return mod.register as GraderPluginRegister;
  }
  if (typeof mod.default === "function") {
    return mod.default as GraderPluginRegister;
  }
  return undefined;
}

function snapshot(): Map<string, TraceGrader> {
  return new Map(listGraderKinds().map((kind) => [kind, graderFor(kind)!]));
}

/** What one plugin changed, phrased for the report's warnings list. */
function changesSince(
  specifier: string,
  before: Map<string, TraceGrader>,
): string[] {
  const added: string[] = [];
  const replaced: string[] = [];
  for (const kind of listGraderKinds()) {
    const previous = before.get(kind);
    if (previous === undefined) added.push(kind);
    else if (previous !== graderFor(kind)) replaced.push(kind);
  }

  const warnings: string[] = [];
  if (added.length === 0 && replaced.length === 0) {
    warnings.push(
      `grader plugin "${specifier}" registered no grader kinds — export a ` +
        `\`register({ registerGrader })\` function, or call registerGrader while ` +
        `the module is imported. Any eval naming a custom grader will report ` +
        `\`unknown grader kind\`.`,
    );
  }
  for (const kind of replaced) {
    warnings.push(
      BUILTIN_GRADER_KINDS.has(kind)
        ? `grader plugin "${specifier}" replaced the built-in grader "${kind}"; ` +
          `every eval declaring that kind now runs the plugin's implementation`
        : `grader plugin "${specifier}" replaced the grader "${kind}" registered ` +
          `by an earlier plugin`,
    );
  }
  return warnings;
}

/**
 * Import each plugin in order and let it register. Throws `TracevalsError`
 * (exit 2) on the first specifier that will not load; returns warnings for the
 * problems that are real but not fatal.
 */
export async function loadGraderPlugins(
  options: LoadGraderPluginsOptions,
): Promise<LoadedGraderPlugins> {
  const loaded: string[] = [];
  const warnings: string[] = [];

  for (const specifier of options.plugins) {
    const { href, shown } = locate(specifier, options.configDir);
    if (alreadyLoaded.has(href)) continue;

    const before = snapshot();
    let mod: Record<string, unknown>;
    try {
      mod = (await import(href)) as Record<string, unknown>;
    } catch (err) {
      throw new TracevalsError(
        `could not load grader plugin "${specifier}"` +
          (shown !== undefined ? ` (resolved to ${shown})` : "") +
          `: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const register = registrarIn(mod);
    if (register !== undefined) {
      try {
        await register({ registerGrader });
      } catch (err) {
        throw new TracevalsError(
          `grader plugin "${specifier}" threw while registering: ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    // Marked only once it is actually in: a failed load throws, and a retry
    // must not find the specifier recorded as already handled.
    alreadyLoaded.add(href);
    warnings.push(...changesSince(specifier, before));
    loaded.push(specifier);
  }

  return { loaded, warnings };
}
