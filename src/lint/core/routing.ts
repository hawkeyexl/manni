/**
 * Which template describes which page, assembled once per run.
 *
 * `manni lint` routes every page through this, and so does `manni docevals`,
 * which grades a template's `evals` on the pages it routes. One routing for
 * both is the point: a page linted against one template and graded against
 * another would be two answers to "what is this page".
 *
 * `buildTemplateRouting` settles the run-wide part: the template files, the
 * doctype index, and `--template`. `routePage` settles one page's ref from its
 * frontmatter, including the two things the raw resolution leaves to its
 * caller: a relative `$template` is re-based beside the page, and a `$template`
 * naming a URL is refused.
 */
import { resolve } from "node:path";
import type { Template, TemplateFile } from "./template.js";
import type { LintConfig } from "./config.js";
import {
  classifyRef,
  listBuiltins,
  loadResolvedTemplate,
  loadTemplate,
  loadTemplateFile,
  refRelativeTo,
} from "./template-registry.js";
import {
  buildTypeIndex,
  resolveTemplateRef,
  FILE_TEMPLATE_KEY,
  type Resolution,
  type TemplateOverride,
  type TypeIndexEntry,
} from "./resolve-template.js";

/** Extensions that make a bare `--template` value a file, not a name. */
const TEMPLATE_FILE_EXTENSIONS = [".yaml", ".yml", ".json"];

export interface TemplateRouting {
  typeIndex: Map<string, TypeIndexEntry>;
  /** Cached; returns the template with its `extends` chain merged. */
  getTemplate: (ref: string) => Promise<Template>;
  templatePaths: string[];
  cliTemplate?: string;
  overrides?: TemplateOverride[];
  defaultTemplate?: string;
}

export interface RoutedPage {
  resolution: Resolution;
  /** The ref to load: null when unrouted; a `$template` ref re-based beside the page. */
  ref: string | null;
  /** Set when `$template` names a URL: the existing refusal message text. ref is null then. */
  refusal?: string;
}

/** `--templates` / `templates:` as a list, whichever shape it arrived in. */
export function templateFiles(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * A template ref, loaded once per run however many pages route to it.
 *
 * The registry deliberately leaves `extends` unresolved, so the merge happens
 * here. Skipping it would make inheritance silently inert: a template that
 * inherits every one of its sections would check nothing and report a clean
 * pass.
 */
function templateLoader(): (ref: string) => Promise<Template> {
  const cache = new Map<string, Promise<Template>>();
  return (ref) => {
    let pending = cache.get(ref);
    if (!pending) {
      pending = loadResolvedTemplate(ref);
      cache.set(ref, pending);
    }
    return pending;
  };
}

/**
 * Normalize `--template` into a ref the registry understands.
 *
 * `--templates t.yaml --template how-to` is the pairing the manni docevals
 * adapter invokes, and it means "the template named how-to inside t.yaml".
 * A ref that already names a file, a URL, or a built-in is passed through.
 */
function cliTemplateRef(
  template: string | undefined,
  templatePaths: string[],
): string | undefined {
  if (!template) return undefined;
  // A ref that names itself is passed through. Sniffing for `#`, `/` and `\`
  // missed built-in ids, which contain none of them, so `-t tgdp:how-to:1.6`
  // silently became a lookup for a template of that name inside the first
  // `--templates` file the moment one was given.
  if (template.includes("#")) return template;
  if (classifyRef(template).kind !== "file") return template;
  if (template.includes("/") || template.includes("\\")) return template;
  // A bare filename names a file even without a separator: `--template
  // custom.yaml` means that file, not a template called "custom.yaml" inside
  // some other one.
  if (TEMPLATE_FILE_EXTENSIONS.some((e) => template.toLowerCase().endsWith(e))) {
    return template;
  }
  if (templatePaths.length === 0) return template;

  // A bare name is a name inside a `--templates` file. Search them last-first,
  // matching `buildTypeIndex`, so the file that wins routing also wins here.
  return `${templatePaths[templatePaths.length - 1] ?? ""}#${template}`;
}

/**
 * Assemble the run's routing. Each CLI value overrides the config's own, and
 * `config` is expected already rebased, so its paths name real files.
 */
export async function buildTemplateRouting(params: {
  config: LintConfig;
  templates?: string[];
  types?: Record<string, string>;
  overrides?: TemplateOverride[];
  defaultTemplate?: string;
  cliTemplate?: string;
}): Promise<TemplateRouting> {
  const { config } = params;

  // The doctype -> template map. Built-ins go in first and user templates
  // overwrite them, so overriding `how-to` for a repo is one file with
  // `types: [how-to]` in it - no config entry, no flag.
  const templatePaths = templateFiles(params.templates ?? config.templates);
  const getTemplate = templateLoader();

  const userFiles: { ref: string; file: TemplateFile }[] = [];
  for (const ref of templatePaths) {
    const file = await loadTemplateFile(ref);
    // `extends` is resolved before `types` is read. A template that inherits
    // its doctypes declares none of its own, so reading the raw file routes
    // nothing to it - the override loads, merges, and is silently inert while
    // the page goes to the built-in it meant to replace. The loader is cached,
    // so this costs nothing the lint would not already pay.
    const templates: Record<string, Template> = {};
    for (const name of Object.keys(file.templates ?? {})) {
      templates[name] = await getTemplate(`${ref}#${name}`);
    }
    userFiles.push({ ref, file: { ...file, templates } });
  }

  const typeIndex = buildTypeIndex({
    builtins: listBuiltins(),
    userFiles,
    explicitTypes: params.types ?? config.types,
  });

  return {
    typeIndex,
    getTemplate,
    templatePaths,
    cliTemplate: cliTemplateRef(params.cliTemplate, templatePaths),
    overrides: params.overrides ?? config.overrides,
    // `template:` in config is the default for a page that declares no type -
    // the bottom of the chain, not the top. `--template` is the top.
    defaultTemplate: params.defaultTemplate ?? config.template,
  };
}

/** Route one page by its frontmatter. */
export function routePage(
  routing: TemplateRouting,
  page: {
    filePath: string;
    absolutePath: string;
    frontmatter: Record<string, unknown> | null;
  },
): RoutedPage {
  const resolution = resolveTemplateRef({
    filePath: page.filePath,
    absolutePath: page.absolutePath,
    frontmatter: page.frontmatter,
    cliTemplate: routing.cliTemplate,
    overrides: routing.overrides,
    typeIndex: routing.typeIndex,
    defaultTemplate: routing.defaultTemplate,
  });
  if (resolution.ref === null || resolution.stage !== "frontmatter-template") {
    return { resolution, ref: resolution.ref };
  }

  // A page may not send the linter to a URL of its own choosing.
  //
  // `type` comes out of the document too, but it only *selects* from the
  // routing table the operator assembled - a page can ask for a template on
  // offer, not introduce one. `$template` names a reference directly, which
  // makes it the one stage where a document says where a template comes from,
  // and documents are exactly what this tool is pointed at untrusted: a docset
  // from a fork, a contributor's branch, a vendored copy.
  // Left open, one line of frontmatter makes the linting host issue an
  // arbitrary request, which on CI means from inside the build network. The
  // `$ref` hole this mirrors was closed in the template loader; this is the
  // same hole one level up, where the ref itself is attacker-chosen.
  //
  // Refused rather than ignored, because silently falling through to `type`
  // would lint the page against something other than what it asked for and say
  // nothing. An operator who does want a remote template still has every other
  // stage: name it in `templates:`, map it under `types:`, or pass --template.
  if (classifyRef(resolution.ref).kind === "url") {
    return {
      resolution,
      ref: null,
      refusal:
        `${FILE_TEMPLATE_KEY} may not name a URL ("${resolution.ref}"): a document ` +
        `must not choose what the linter fetches. Declare it in manni.config.yaml ` +
        `under "templates:" or "types:", or pass it with --template.`,
    };
  }

  // A relative `$template` means "beside this page", not "beside wherever the
  // tool happened to be invoked from". `extends` already follows that rule, and
  // for the same reason: resolved against the process cwd, `$template:
  // ./house.yaml` in `docs/guide.md` found the file only when the run started
  // in `docs/` - so the page routed correctly from one directory and reported
  // "Template file not found" from every other, including from CI.
  return { resolution, ref: refRelativeTo(page.absolutePath, resolution.ref) };
}

/**
 * The local files a template is read from: `ref`'s own and each one in its
 * `extends` chain, absolute and forward-slashed, each once. Built-in ids and
 * URLs are left out. Relative `extends` are re-based exactly as
 * `loadResolvedTemplate` re-bases them.
 */
export async function templateSources(ref: string): Promise<string[]> {
  const sources: string[] = [];
  const seen = new Set<string>([ref]);
  let current: string | undefined = ref;
  while (current !== undefined) {
    const hash = current.lastIndexOf("#");
    const base = hash === -1 ? current : current.slice(0, hash);
    if (classifyRef(base).kind === "file") {
      const path = resolve(base).replace(/\\/g, "/");
      if (!sources.includes(path)) sources.push(path);
    }
    const parent: string | undefined = (await loadTemplate(current)).extends;
    const next: string | undefined =
      parent === undefined ? undefined : refRelativeTo(current, parent);
    // `loadResolvedTemplate` refuses a cycle with its own message; here a ref
    // seen twice simply ends the walk.
    current = next !== undefined && !seen.has(next) ? next : undefined;
    if (next !== undefined) seen.add(next);
  }
  return sources;
}
