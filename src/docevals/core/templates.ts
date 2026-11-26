/**
 * Template evals: each page also carries the `evals` of the template `manni
 * lint` routes it to.
 *
 * Routing is lint's own (`buildTemplateRouting` / `routePage`), over the
 * `lint:` section of the file this run already resolved, so a page cannot be
 * linted against one template and graded against another. It reads the page
 * the way lint does: lint parses the file and merges no manifest, so a `type`
 * or `$template` a manifest supplied does not route here either.
 *
 * Done once per run, before resolution, as `external.ts` merges manifests: the
 * result rides on each `PageFile` as `template`, so the synchronous
 * `resolvePage` stays synchronous and nothing downstream loads a template
 * again. Every failure to read a template is exit 2 before any page is graded.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { ToolError } from "../../shared/errors.js";
import {
  buildTemplateRouting,
  parseConfig as parseLintConfig,
  rebaseConfig,
  routePage,
  templateSources,
  type RoutedPage,
  type TemplateEvalEntry,
} from "../../lint/index.js";
import { DocevalsError } from "../types.js";
import type { DocevalsConfig } from "./config.js";
import type { PageFile } from "./discover.js";

/** What a page's routed template contributes to its plan. */
export interface PageTemplate {
  /**
   * The ref as routed, for people: a local file relative to the run's
   * directory with forward slashes, `#name` kept; a built-in id or URL as
   * written. Null when refused.
   */
  ref: string | null;
  /** Which routing stage decided: `type` and `frontmatter-template` have a line. */
  stage: RoutedPage["resolution"]["stage"];
  /** The template's evals, `extends` already merged. */
  entries: readonly TemplateEvalEntry[];
  /** Absolute local files of the template and its `extends` chain, for `--since`. */
  sources: readonly string[];
  /** lint's refusal, when `$template` names a URL. */
  refusal?: string;
}

/** The routing input lint takes for one page. */
export interface RouteInput {
  filePath: string;
  absolutePath: string;
  frontmatter: Record<string, unknown> | null;
}

/** One run's routing. Injected by tests. */
export interface TemplateRouter {
  route(page: RouteInput): RoutedPage;
  load(ref: string): Promise<{ evals: readonly TemplateEvalEntry[]; sources: readonly string[] }>;
}

export type LoadTemplateRouter = (config: DocevalsConfig) => Promise<TemplateRouter>;

/** lint's message, in docevals' error class, so every command exits 2 with it. */
async function asDocevalsError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ToolError && !(e instanceof DocevalsError)) {
      throw new DocevalsError(e.message);
    }
    throw e;
  }
}

/**
 * lint's routing over the `lint:` section of the file docevals resolved, or
 * `{}` when no file governs the run. Built-in templates route by `type` either
 * way.
 */
export const lintRouter: LoadTemplateRouter = async (config) => {
  const routing = await asDocevalsError(() => {
    const source = config.configSource;
    const lint =
      source === null || !existsSync(config.configPath)
        ? {}
        : rebaseConfig({
            config: parseLintConfig(readFileSync(config.configPath, "utf8"), source),
            path: config.configPath,
          });
    return buildTemplateRouting({ config: lint });
  });
  return {
    route: (page) => routePage(routing, page),
    load: (ref) =>
      asDocevalsError(async () => ({
        evals: (await routing.getTemplate(ref)).evals ?? [],
        sources: await templateSources(ref),
      })),
  };
};

/**
 * A routed ref as a user reads it. lint re-bases every local ref to an
 * absolute path before routing; the loading keeps that, and what is printed is
 * relative to `base` when it sits inside it. A template outside `base` keeps
 * its absolute path, which reads better than a climb of `../`. A built-in id or
 * a URL is never absolute.
 */
export function displayRef(ref: string, base: string): string {
  const hash = ref.lastIndexOf("#");
  const file = hash === -1 ? ref : ref.slice(0, hash);
  if (!isAbsolute(file)) return ref;
  const rel = relative(base, file);
  const shown = rel.startsWith("..") || isAbsolute(rel) ? file : rel;
  return shown.replace(/\\/g, "/") + (hash === -1 ? "" : ref.slice(hash));
}

/** The two keys lint routes on, which lint reads only from the page itself. */
const ROUTING_KEYS = ["type", "$template"] as const;

/** The page's frontmatter as lint sees it: without what a manifest supplied. */
function ownFrontmatter(page: PageFile): Record<string, unknown> {
  const data = page.frontmatter.data;
  const locate = page.external?.locate;
  if (locate === undefined) return data;
  const own = { ...data };
  for (const key of ROUTING_KEYS) {
    if (locate(`/${key}`) !== undefined) Reflect.deleteProperty(own, key);
  }
  return own;
}

/**
 * Every page of a run, each with the template lint routes it to. Unrouted
 * pages come back untouched. Each distinct template is loaded once, and a
 * remaining `use:` naming no `docevals.evals` entry is exit 2.
 */
export async function withTemplateEvals(
  pages: PageFile[],
  config: DocevalsConfig,
  base: string,
  load: LoadTemplateRouter = lintRouter,
): Promise<PageFile[]> {
  const router = await load(config);
  const loaded = new Map<string, Awaited<ReturnType<TemplateRouter["load"]>>>();
  const out: PageFile[] = [];
  for (const page of pages) {
    if (page.extractError !== undefined) {
      out.push(page);
      continue;
    }
    const routed = router.route({
      filePath: page.file,
      absolutePath: page.absPath,
      frontmatter: ownFrontmatter(page),
    });
    const stage = routed.resolution.stage;
    if (routed.refusal !== undefined) {
      out.push({
        ...page,
        template: { ref: null, stage, entries: [], sources: [], refusal: routed.refusal },
      });
      continue;
    }
    if (routed.ref === null) {
      out.push(page);
      continue;
    }
    const ref = displayRef(routed.ref, base);
    let template = loaded.get(routed.ref);
    if (template === undefined) {
      template = await router.load(routed.ref);
      assertUsesDefined(ref, template.evals, config);
      loaded.set(routed.ref, template);
    }
    out.push({
      ...page,
      template: {
        ref,
        stage,
        entries: template.evals,
        sources: template.sources,
      },
    });
  }
  return out;
}

/** A `use:` left after lint's merge names a `docevals.evals` entry, or nothing. */
function assertUsesDefined(
  ref: string,
  entries: readonly TemplateEvalEntry[],
  config: DocevalsConfig,
): void {
  for (const entry of entries) {
    if (typeof entry === "string" || typeof entry.use !== "string") continue;
    if (Object.hasOwn(config.evals, entry.use)) continue;
    throw new DocevalsError(
      `${ref}: evals use "${entry.use}", which no template it extends and no ` +
        `docevals.evals entry in ${config.configSource ?? config.configPath} defines`,
    );
  }
}
