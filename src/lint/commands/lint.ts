/**
 * `lint` command core. Resolves targets, picks a parser per file, resolves a
 * template per file, and returns structured results. Free of CLI/IO plumbing so
 * it can be driven directly from tests and from the programmatic API.
 *
 * Template selection is per file, not per run: a page declares what it is
 * (`type: how-to`) and the template follows. `--template` still exists and
 * still overrides everything, but it is no longer required, which is what lets
 * one invocation lint a whole tree of mixed doctypes.
 */
import { readFile } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { errorMessage, ToolError } from "../../shared/errors.js";
import {
  LintError,
  type DocumentParser,
  type DocumentTree,
  type FileResult,
  type Finding,
  type Position,
} from "../types.js";
import {
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "../parsers/index.js";
import type { Template, TemplateFile } from "../core/template.js";
import {
  classifyRef,
  refRelativeTo,
  listBuiltins,
  loadResolvedTemplate,
  loadTemplateFile,
} from "../core/template-registry.js";
import {
  buildTypeIndex,
  knownTypes,
  resolveTemplateRef,
  FILE_TEMPLATE_KEY,
  type Resolution,
  type TemplateOverride,
  type TypeIndexEntry,
} from "../core/resolve-template.js";
import { validateDocument } from "../core/validator.js";
import {
  resolveStructureTool,
  structureTools,
  type StructureToolDescriptor,
} from "../tools/index.js";
import {
  ditaOt,
  runDitaOtValidate,
  type DitaOtMessage,
} from "../tools/dita-ot.js";
import { ditaOtHome } from "../../shared/tools.js";
import {
  assertNonEmpty,
  gitignoreOptions,
  resolveTargetSet,
  STDIN_TOKEN,
} from "../../meta/internal.js";
import { isErrorSeverity } from "../../meta/index.js";
import { resolveLintRun, type LintConfig } from "../core/config.js";

/** File label used for a document read from stdin. */
export const STDIN_LABEL = "<stdin>";

export interface LintOptions {
  /**
   * Positional inputs: files, directories, or globs. `-` reads stdin. Empty
   * falls back to the `collections:` the config declares (proposal 0041).
   */
  inputs: string[];
  /** `--collection <name>`, repeatable: the collections this run covers. */
  collection?: string[];
  /**
   * `--tool`: which tool performs the structure job. Overrides the config's
   * own `lint.structure.tool`, and defaults to manni's engine.
   */
  tool?: string;
  /** `--template`: a built-in id, a path, or a name inside `templates`. */
  template?: string;
  /**
   * `--templates`: template files whose `types:` join the routing table. A bare
   * `--template <name>` is resolved as a name inside the *last* of them, which
   * is the pairing the manni docevals adapter invokes. Last, not first, to
   * agree with `buildTypeIndex`: a later file overrides an earlier one there,
   * so resolving a bare name against the first would make one name mean two
   * different templates depending on how it was written.
   */
  templates?: string | string[];
  /** `--as`: force an input format, by parser name. */
  as?: string;
  /** `--ext`: extensions kept during directory and glob expansion. */
  exts?: string[];
  /** `--exclude`: globs removed from directory/glob expansion. */
  exclude?: string[];
  cwd?: string;
  /** Content for the `-` input, injected by the CLI and by tests. */
  stdinContent?: string;
  /** `--explain`: record how each file's template was chosen. */
  explain?: boolean;
  /** Repo policy: first matching glob wins. Overrides the config's own. */
  overrides?: TemplateOverride[];
  /** Applied when a page declares no doctype. Overrides the config's own. */
  defaultTemplate?: string;
  /** Explicit doctype -> template ref map. Overrides the config's own. */
  types?: Record<string, string>;
  /** `--allow-empty`: zero matched files is a success, not an error. */
  allowEmpty?: boolean;
  /** `--no-gitignore`: only an explicit `false` travels, so config can decide. */
  respectGitignore?: boolean;
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`: skip discovery and run on the built-in defaults. */
  noConfig?: boolean;
  /** Told which config governed the run, and where it came from. */
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
  /** Told what the run had to say beside its findings. */
  onNotice?: (message: string) => void;
  /**
   * The DITA-OT seam, injected by tests, as `term lint` injects Vale's.
   *
   * There is no JVM and no DITA-OT on a CI runner of ours, so the only way to
   * exercise this branch end to end is to hand it the process boundary. The
   * shipped default is the real one.
   */
  runDitaOt?: typeof runDitaOtValidate;
}

/** Extensions that make a bare `--template` value a filename, not a name. */
const TEMPLATE_FILE_EXTENSIONS = [".yaml", ".yml", ".json"];

/**
 * Run a family helper, rethrowing the error it raises as this tool's.
 *
 * The walker and its guards are meta's, and they throw `DocmetaError` - a
 * sibling of `LintError`, not a parent of it. `runLint` is exported from
 * `src/index.ts` and called in process by manni docevals, so a caller doing
 * the documented thing, `catch (err) { if (err instanceof LintError) … }`,
 * missed the two most ordinary operational failures there are: a mistyped path
 * and a pattern matching nothing. The message is the walker's own, which is
 * the part the user reads; only the class changes.
 */
async function asLintError<T>(run: () => T | Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof LintError) throw err;
    // A `ToolError` from any sibling is operational and already worded for a
    // user. Anything else is a bug and keeps its class and its stack.
    if (err instanceof ToolError) throw new LintError(err.message);
    throw err;
  }
}

/** `--templates` accepts one path or several; normalize to a list. */
function templateFiles(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The options a tool can own, in the order the guard reports them, each paired
 * with how to tell that the caller passed it.
 *
 * `--templates` reads `opts` alone. A `templates:` key in the config describes
 * the repo rather than the invocation, so a repo that has written one must not
 * be refused the moment it points a different tool at the same tree.
 */
const TOOL_OPTIONS: {
  spelling: string;
  given: (opts: LintOptions) => boolean;
}[] = [
  { spelling: "--template", given: (o) => o.template !== undefined },
  {
    spelling: "--templates",
    given: (o) => templateFiles(o.templates).length > 0,
  },
  { spelling: "--explain", given: (o) => o.explain === true },
  { spelling: "--as", given: (o) => o.as !== undefined },
];

/**
 * The options some other registered tool owns and this one does not, each with
 * the tool that does own it.
 *
 * Derived rather than written out per tool, because a hand-written chain is a
 * list the next tool has to remember to join - and the failure mode of
 * forgetting is a silently ignored option, which is a run that reports success
 * having done something other than what was asked.
 */
function foreignOptions(
  tool: StructureToolDescriptor,
): Map<string, StructureToolDescriptor> {
  const foreign = new Map<string, StructureToolDescriptor>();
  for (const other of structureTools()) {
    // By identity, not by name: the registry holds one descriptor per name, so
    // the tool this run resolved *is* its entry, and comparing the names is a
    // tautology to the compiler while `LintTool` carries one of them.
    if (other === tool) continue;
    for (const spelling of other.ownedOptions) {
      if (tool.ownedOptions.includes(spelling)) continue;
      if (!foreign.has(spelling)) foreign.set(spelling, other);
    }
  }
  return foreign;
}

/**
 * Refuse an option that belongs to a tool this run is not performing the job
 * with. One message, naming the first offending option.
 *
 * Ignoring it instead would be the quietest kind of wrong answer: the flag
 * reads as applied, the run exits 0, and nothing says the template, the format
 * override or the explanation was dropped on the floor.
 */
function assertOptionsOwned(
  opts: LintOptions,
  tool: StructureToolDescriptor,
  usingStdin: boolean,
): void {
  const foreign = foreignOptions(tool);
  if (foreign.size === 0) return;

  for (const { spelling, given } of TOOL_OPTIONS) {
    const owner = foreign.get(spelling);
    if (owner === undefined || !given(opts)) continue;
    throw new LintError(
      `${spelling} is an option of the ${owner.name} tool; ` +
        `the structure job's tool is ${tool.name}.`,
    );
  }

  // Stdin last, and in its own words: "option" is the wrong noun for a pipe,
  // and the advice a reader needs is what to pass instead.
  if (usingStdin && foreign.has(STDIN_TOKEN)) {
    throw new LintError(`${tool.name} cannot read stdin. Name files or a map.`);
  }
}

export interface LintSummary {
  /** Files actually linted. Always `passed + failed`; skips are counted apart. */
  checked: number;
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * A `FileResult` plus the human-readable reason a file was skipped.
 *
 * `types.ts` pins the fields manni docevals reads off the JSON reporter, so
 * this diagnostic lives here instead: it exists for pretty output, and the
 * JSON reporter never emits it.
 */
export interface LintFileResult extends FileResult {
  /** Why the file was skipped, in words. Set only alongside `skipped`. */
  reason?: string;
  /** How the template was chosen. Present when `--explain` asked for it. */
  resolution?: Resolution;
  /**
   * What the alignment block is rendered from. Present when `--explain` asked
   * for it, and only for a file that routed to a template.
   *
   * Nested rather than flat, because `FileResult.template` is already taken by
   * the template's *ref* - the string a reader sees on the routing line. A
   * loaded `Template` beside it under the same name would be two things called
   * one thing, and the reporter would read whichever it got.
   */
  alignment?: { tree: DocumentTree; template: Template };
}

export interface LintRun {
  results: LintFileResult[];
  summary: LintSummary;
}

/** Zero-width span at the top of a file, for findings with nowhere better. */
function origin(): Position {
  return {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 1, offset: 0 },
  };
}

function skip(
  file: string,
  reason: string,
  cause: FileResult["skipped"] = "unsupported-format",
): LintFileResult {
  return {
    file,
    // `success` means "linted and produced no findings". A file that was never
    // linted is neither passing nor failing, and calling it a pass would hide
    // the gap from anyone reading CI output.
    success: false,
    findings: [],
    template: null,
    skipped: cause,
    reason,
  };
}

function parseFinding(message: string): Finding {
  return {
    type: "parse_error",
    heading: null,
    message,
    position: origin(),
    severity: "error",
  };
}

/**
 * A template ref, loaded once per run however many pages route to it.
 *
 * The registry deliberately leaves `extends` unresolved, so the merge happens
 * here. Skipping it would make inheritance silently inert: a template that
 * inherits every one of its sections would check nothing and report a clean
 * pass. `resolveExtends` is a no-op on a template without `extends`.
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
 * Which file a template came from and what it is called there.
 *
 * The validator and the matcher both name the template in messages - the
 * state-cap failure, and the warning about a rule a format cannot answer - and
 * neither can work either out from a `Template` object, which carries no
 * record of where it was loaded from. The ref does: `./templates.yaml#how-to`
 * is a file and a name, and a built-in id is both at once.
 */
function templateIdentity(ref: string): { source: string; template: string } {
  const hash = ref.lastIndexOf("#");
  if (hash === -1) return { source: ref, template: ref };
  return { source: ref.slice(0, hash), template: ref.slice(hash + 1) };
}

/** The finding a page gets when it declares a doctype nothing serves. */
function unknownTypeFinding(
  resolution: Resolution,
  typeIndex: Map<string, TypeIndexEntry>,
  position: Position,
): Finding {
  const suggestions = resolution.suggestions ?? [];
  const known = resolution.knownTypes ?? knownTypes(typeIndex);
  const hint = suggestions.length
    ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(", ")}?`
    : ` Known doctypes: ${known.join(", ") || "(none)"}.`;
  // `unknownType` is set whenever the cause is `unknown-type`, but the type
  // says `string | undefined` and only the resolver enforces the pairing. The
  // fallback keeps a future break from printing `type "undefined"`, which
  // would send the reader looking for a doctype they never wrote.
  const declared = resolution.unknownType ?? "(none recorded)";
  return {
    type: "unknown_type",
    heading: null,
    message:
      `No template serves type "${declared}".${hint} ` +
      `Declare it on a template with "types:", then pass that file with --templates.`,
    position,
    severity: "error",
  };
}

interface LintContext {
  getTemplate: (ref: string) => Promise<Template>;
  /** Absolute, forward-slashed form of a display path, for override globs. */
  absoluteOf?: (file: string) => string;
  typeIndex: Map<string, TypeIndexEntry>;
  cliTemplate?: string;
  overrides?: TemplateOverride[];
  defaultTemplate?: string;
  explain: boolean;
}

async function lintOne(
  label: string,
  content: string,
  parser: DocumentParser,
  ctx: LintContext,
): Promise<LintFileResult> {
  let tree: DocumentTree;
  try {
    tree = parser.parse(content, label);
  } catch (err) {
    // A file that will not parse is that file's problem, not the run's: it is
    // reported and the run continues, so one broken page cannot hide the
    // findings in the other 199.
    return {
      file: label,
      success: false,
      findings: [parseFinding(errorMessage(err))],
      template: null,
    };
  }

  // Routing needs the frontmatter, so it happens after the parse rather than
  // before the read - which is also what makes `--explain` able to say what the
  // page actually declared.
  const resolution = resolveTemplateRef({
    filePath: label,
    absolutePath: ctx.absoluteOf?.(label),
    frontmatter: tree.frontmatter,
    cliTemplate: ctx.cliTemplate,
    overrides: ctx.overrides,
    typeIndex: ctx.typeIndex,
    defaultTemplate: ctx.defaultTemplate,
  });
  const withResolution = <T extends LintFileResult>(result: T): T =>
    ctx.explain ? { ...result, resolution } : result;

  // Anchor anything said about the frontmatter at the frontmatter.
  const metaPosition = tree.frontmatterPosition ?? origin();

  if (resolution.ref === null) {
    if (resolution.cause === "unknown-type") {
      // A declared type that resolves to nothing is a typo or a gap. Skipping
      // would mean a page silently stops being checked, which is the one
      // outcome worse than a false positive.
      return withResolution({
        file: label,
        success: false,
        findings: [unknownTypeFinding(resolution, ctx.typeIndex, metaPosition)],
        template: null,
      });
    }
    // An untyped page is manni meta's complaint, not this tool's - its OKF
    // schema already requires `type`. Skipping is what lets manni lint be
    // pointed at a whole tree on day one.
    return withResolution(
      skip(
        label,
        "no type in frontmatter and no template resolved",
        "no-template",
      ),
    );
  }

  /** A broken template, reported against this page rather than thrown. */
  const brokenTemplate = (err: unknown): LintFileResult =>
    withResolution({
      file: label,
      success: false,
      findings: [
        {
          type: "template_error",
          heading: null,
          message: errorMessage(err),
          position: metaPosition,
          severity: "error",
        },
      ],
      template: resolution.ref,
    });

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
  if (
    resolution.stage === "frontmatter-template" &&
    classifyRef(resolution.ref).kind === "url"
  ) {
    return brokenTemplate(
      new LintError(
        `${FILE_TEMPLATE_KEY} may not name a URL ("${resolution.ref}"): a document ` +
          `must not choose what the linter fetches. Declare it in manni.config.yaml ` +
          `under "templates:" or "types:", or pass it with --template.`,
      ),
    );
  }

  // A relative `$template` means "beside this page", not "beside wherever the
  // tool happened to be invoked from". `extends` already follows that rule, and
  // for the same reason: resolved against the process cwd, `$template:
  // ./house.yaml` in `docs/guide.md` found the file only when the run started
  // in `docs/` - so the page routed correctly from one directory and reported
  // "Template file not found" from every other, including from CI.
  const ref =
    resolution.stage === "frontmatter-template"
      ? refRelativeTo(ctx.absoluteOf?.(label) ?? label, resolution.ref)
      : resolution.ref;

  let template: Template;
  try {
    template = await ctx.getTemplate(ref);
  } catch (err) {
    // One unloadable template must not abort a run over a whole tree; it is
    // reported against the pages that route to it.
    return brokenTemplate(err);
  }

  // `--explain` stops here, having promised to "lint nothing".
  //
  // The line is drawn after loading rather than before it, because loading is
  // part of the answer the flag exists to give: "which template, and why" is
  // not answered by naming a ref that does not resolve, and a broken
  // `--templates` path is exactly the surprise someone runs `--explain` to
  // find. Loading is also cheap in the way validation is not - templates are
  // cached, so a tree of one doctype loads once, while `validateDocument` runs
  // per file and its findings are then discarded unrendered.
  if (ctx.explain) {
    return withResolution({
      file: label,
      success: true,
      findings: [],
      template: resolution.ref,
      // The tree and the loaded template, for the alignment block. Both are
      // already in hand here, and neither survives this function otherwise.
      alignment: { tree, template },
    });
  }

  let findings: Finding[];
  try {
    findings = validateDocument(tree, template, {
      ...templateIdentity(ref),
      kinds: parser.kinds,
    });
  } catch (err) {
    // Validation can raise for the same reason loading can: a template the
    // author got wrong - an uncompilable `heading.pattern` is the live case.
    // Without this the raise escapes `runLint` and kills the run, so one bad
    // pattern hides the findings in every other page, which is the outcome the
    // load path above exists to prevent.
    if (err instanceof LintError) return brokenTemplate(err);
    throw err;
  }

  return withResolution({
    file: label,
    // "Linted and found nothing wrong", which is not the same as "produced no
    // findings". A `warning` - today, a rule this file's format cannot answer -
    // says something about the run rather than about the document, and the
    // exit code follows `success`, so counting it as a failure would turn a
    // docset of mixed formats permanently red. The family's rule, and the one
    // meta and cite already apply: `ok` is "no error-severity finding".
    success: !findings.some(isErrorSeverity),
    findings,
    template: resolution.ref,
  });
}

/** Everything manni's branch needs, settled once by the shared prefix. */
interface ManniRun {
  opts: LintOptions;
  config: LintConfig;
  /** The directory the resolved files are relative to. */
  cwd: string;
  /** The files the shared target resolution produced. */
  files: string[];
  /** The parser `--as` forced, when it did. */
  forcedParser?: DocumentParser;
  /** Whether `-` rode among the inputs. */
  usingStdin: boolean;
}

/**
 * Lint with manni's own engine.
 *
 * Everything below this line is manni's and nobody else's: the template files,
 * the doctype index, the parser registry, and the guard that fires when a run
 * checks nothing. The loading in particular has to sit here rather than in the
 * shared prefix, because it is file I/O a tool that reads no templates must
 * not be made to pay - and a missing `templates:` entry is then the loader's
 * error under manni and nothing at all under anybody else.
 */
async function lintWithManni(run: ManniRun): Promise<LintFileResult[]> {
  const { opts, config, cwd, files, forcedParser, usingStdin } = run;

  // The doctype -> template map. Built-ins go in first and user templates
  // overwrite them, so overriding `how-to` for a repo is one file with
  // `types: [how-to]` in it - no config entry, no flag.
  const templatePaths = templateFiles(opts.templates ?? config.templates);
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
    explicitTypes: opts.types ?? config.types,
  });

  const ctx: LintContext = {
    getTemplate,
    absoluteOf: (file) => resolve(cwd, file).replace(/\\/g, "/"),
    typeIndex,
    cliTemplate: cliTemplateRef(opts.template, templatePaths),
    overrides: opts.overrides ?? config.overrides,
    // `template:` in config is the default for a page that declares no type -
    // the bottom of the chain, not the top. `--template` is the top.
    defaultTemplate: opts.defaultTemplate ?? config.template,
    explain: opts.explain === true,
  };

  // `--template` applies to every file, so a ref that will not load is bad
  // usage, not a property of any page. Resolved before a single page is linted
  // so it exits 2 with one message, rather than becoming an identical
  // `template_error` finding on all 200 pages and exiting 1 - which reads to
  // CI as "the docs are wrong".
  if (ctx.cliTemplate != null) await getTemplate(ctx.cliTemplate);

  const results: LintFileResult[] = [];

  // `forcedParser` is set whenever `usingStdin` is - the shared prefix refused
  // the run otherwise - but only that guard knows it, so the pair is tested
  // rather than asserted.
  if (usingStdin && forcedParser) {
    results.push(
      await lintOne(STDIN_LABEL, opts.stdinContent ?? "", forcedParser, ctx),
    );
  }

  for (const file of files) {
    const ext = extname(file);
    const parser = forcedParser ?? parserForExtension(ext);
    // The parser is chosen before the read, not after, because a file nothing
    // can parse must not depend on being readable to be reported. Reading
    // first pulls every skipped file into memory for nothing, and an
    // unreadable one - a denied permission, a file a doc build moved mid-run -
    // throws out of this loop, so a `.xyz` nobody asked us to parse takes the
    // whole run down with it: exit 2 and no verdict for any of the pages after
    // it, instead of one skip line and a report.
    if (!parser) {
      results.push(
        skip(
          file,
          `no parser is registered for "${ext || file}". Supported extensions: ${supportedExtensions().join(", ")}. Use --as to override.`,
        ),
      );
      continue;
    }
    let content: string;
    try {
      content = await readFile(resolve(cwd, file), "utf8");
    } catch (err) {
      // The read is the other thing that can fail per file, and it failed out
      // of the loop: a denied permission, a symlink loop, or a page a doc
      // build moved between `resolveTargetSet` and here threw straight through
      // `runLint` to `fail()`. Exit 2, no report, and every result already
      // gathered discarded - which is exactly what moving the parser lookup
      // before the read was meant to prevent, one step further along.
      //
      // The OS message travels verbatim: "permission denied" and "no such
      // file" send the reader to different places, and this code cannot tell
      // which it was.
      results.push(
        skip(file, `could not be read: ${errorMessage(err)}`, "unreadable"),
      );
      continue;
    }
    results.push(await lintOne(file, content, parser, ctx));
  }

  return results;
}

/** Everything the DITA-OT branch needs, and nothing else. */
interface DitaOtRun {
  /** The directory the resolved files are relative to. */
  cwd: string;
  /** The files the shared target resolution produced, as it spelled them. */
  files: string[];
  /** `tools.dita-ot.home`, resolved; undefined means the `dita` on PATH. */
  home?: string;
  onNotice?: (message: string) => void;
  /** The seam. The shipped default starts the real launcher. */
  validate: typeof runDitaOtValidate;
}

/** One DITA-OT message as a finding. */
function ditaOtFinding(message: DitaOtMessage): Finding {
  // The code is the finding's `type`, so `ruleId` yields
  // `manni:lint/structure/DOTX010E` and the JSON reporter publishes the code
  // DITA-OT's own message reference is indexed by.
  const point =
    message.line === undefined
      ? null
      : {
          line: message.line,
          // The log calls the column `row`; see `readMessage` in the seam.
          column: message.column ?? 1,
          // DITA-OT reports no byte offset, and nothing downstream needs one.
          offset: 0,
        };
  return {
    type: message.code,
    heading: null,
    message: message.message,
    position: point === null ? origin() : { start: point, end: point },
    severity: message.severity,
  };
}

/**
 * Lint with DITA Open Toolkit.
 *
 * One invocation per target, and the log is the verdict. A map's log speaks
 * about the topics it reached, so the findings are grouped by the file each
 * message named rather than by the file the run was pointed at - which is how
 * one map target produces a result per topic.
 */
async function lintWithDitaOt(run: DitaOtRun): Promise<LintFileResult[]> {
  const { cwd, files, onNotice } = run;

  /**
   * Only the formats this tool says it reads are handed to it.
   *
   * `manni lint tools` prints that list, and the rule the registry documents
   * is that a listed format is one that is read. Passing anything else on and
   * reporting whatever came back meant a `notes.md` named on the command line
   * came out as a clean pass, because DITA-OT shrugged and logged nothing to
   * disagree with. The manni branch skips a format no parser claims; this is
   * the same answer for the same reason.
   */
  const readable = ditaOt.formats().flatMap((format) => format.extensions);
  const reads = new Set(readable.map((ext) => ext.toLowerCase()));
  const targets: string[] = [];
  const unreadable: LintFileResult[] = [];
  for (const file of files) {
    if (reads.has(extname(file).toLowerCase())) targets.push(file);
    else {
      unreadable.push(
        skip(
          file,
          `dita-ot does not read "${extname(file) || file}". It reads ${readable.join(", ")}.`,
        ),
      );
    }
  }

  // The label the run resolved is what the report says, whatever spelling the
  // absolute path comes back with.
  const labels = new Map(targets.map((file) => [resolve(cwd, file), file]));
  const labelOf = (absolute: string): string => {
    const known = labels.get(absolute);
    if (known !== undefined) return known;
    const near = relative(cwd, absolute).replace(/\\/g, "/");
    return near === "" ? absolute : near;
  };

  for (const file of targets) {
    // Checked, not skipped: a topic on its own is validated, it just resolves
    // fewer references than the same topic reached through its map. Calling it
    // a skip would say nothing was checked, which is false.
    if (extname(file).toLowerCase() !== ".ditamap") {
      onNotice?.(
        `checked ${file} without a map; references outside it are not resolved.`,
      );
    }
  }

  // Nothing this tool can read is not a run: starting a JVM per target for an
  // empty list would be work with no answer at the end of it.
  if (targets.length === 0) return unreadable;

  const results = await run.validate({
    targets: targets.map((file) => resolve(cwd, file)),
    cwd,
    ...(run.home === undefined ? {} : { home: run.home }),
  });

  // Seeded with the targets, so a target DITA-OT had nothing to say about is a
  // result that passed rather than a file missing from the report.
  const byFile = new Map<string, Finding[]>(targets.map((file) => [file, []]));
  const findingsFor = (file: string): Finding[] => {
    let list = byFile.get(file);
    if (list === undefined) {
      list = [];
      byFile.set(file, list);
    }
    return list;
  };

  // A topic DITA-OT names that nobody targeted becomes a result of its own, so
  // `checked` can exceed the number of paths the user typed. That is the
  // answer, not an inflation of it: pointing at a map is how you ask about the
  // topics it gathers, and a finding against `topic.dita` has to be reported
  // against `topic.dita` for anyone to fix it. One map in, two files checked.
  for (const { target, messages } of results) {
    const invoked = labelOf(target);
    for (const message of messages) {
      // A message with no location belongs to the target the run was invoked
      // on, at a zero-width origin: DITA-OT's semantic messages routinely
      // carry no file, and discarding them would drop real errors.
      const file =
        message.file === undefined
          ? invoked
          : labelOf(resolve(cwd, message.file));
      findingsFor(file).push(ditaOtFinding(message));
    }
  }

  return [
    ...unreadable,
    ...[...byFile].map(([file, findings]) => ({
      file,
      // The family's rule, as manni's branch applies it: `ok` is "no
      // error-severity finding", so a warning-only file stays green.
      success: !findings.some(isErrorSeverity),
      findings,
      template: null,
    })),
  ];
}

/**
 * A run that found files and checked none of them is the worst thing this tool
 * can do quietly: it exits 0 and reads as a clean bill of health for a docset
 * nothing looked at. A repo that adopts manni lint in CI before backfilling
 * `type:` keys would get a permanently green job.
 *
 * This replaces a guard that tested `typeIndex.size === 0` before any file was
 * read. That could never fire - the index is always seeded with the built-ins
 * - so it protected nothing. Counting the outcome does.
 *
 * `--explain` is exempt: showing why nothing routed is exactly its job.
 */
function assertSomethingWasChecked(
  results: LintFileResult[],
  explain: boolean,
  tool: StructureToolDescriptor,
): void {
  const skipped = results.filter((r) => r.skipped != null).length;
  const checked = results.length - skipped;
  if (explain || checked > 0 || skipped === 0) return;

  // The advice has to follow the cause. The guard fires on any skip, but it
  // used to describe routing only - so a run over files no parser claims was
  // told to add a `type:` key, which changes nothing about an extension the
  // tool cannot read. Advice the reader cannot act on is only half a guard.
  const unrouted = results.filter((r) => r.skipped === "no-template").length;
  const unsupported = results.filter(
    (r) => r.skipped === "unsupported-format",
  ).length;
  const unreadable = results.filter((r) => r.skipped === "unreadable").length;
  const advice = [
    unrouted > 0
      ? `${unrouted} had no template: give a page a "type:" that a template ` +
        `serves, pass -t/--template <ref>, or set "lint.template" as a default.`
      : null,
    unsupported > 0
      ? // `--as` belongs to manni's engine, so offering it to someone running
        // another tool is advice that answers with a usage error. The formats
        // line is true for every tool, because every tool declares one.
        `${unsupported} ${unsupported === 1 ? "is" : "are"} in a format ` +
        `${tool.name} does not read: ` +
        (tool.ownedOptions.includes("--as")
          ? `pass --as <format> to force one, or target files in a format `
          : `target files in a format `) +
        `"manni lint tools" lists.`
      : null,
    unreadable > 0
      ? `${unreadable} could not be read: check the permissions on those ` +
        `paths, or drop them from the run with --exclude <glob>.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join(" ");

  throw new LintError(
    `Nothing was checked: all ${skipped} file(s) were skipped. ${advice} ` +
      `Run "manni lint structure <paths> --explain" to see how each file resolved.`,
  );
}

export async function runLint(opts: LintOptions): Promise<LintRun> {
  // Which config governs the run, and what it covers: positional paths, or
  // the `collections:` the family file declares. One base per run, so a
  // collection's globs resolve beside the config that wrote them.
  const run = await resolveLintRun({
    cwd: opts.cwd ?? process.cwd(),
    configPath: opts.configPath,
    noConfig: opts.noConfig,
    inputs: opts.inputs,
    collection: opts.collection,
    onConfigLoaded: opts.onConfigLoaded,
  });
  const config: LintConfig = run.config;
  const cwd = run.base;

  if (run.inputs.length === 0) {
    throw new LintError(
      "No files to check. Pass paths/globs, or declare a collection under `collections:` in manni.config.yaml.",
    );
  }

  // Which tool performs the structure job: `--tool` first, then the config's
  // `lint.structure.tool`, then manni's own engine. Settled before anything is
  // read, because it decides what "anything" even is - the extensions a walk
  // collects, and which of the options below the run may carry at all.
  const tool = resolveStructureTool(
    opts.tool ?? config.structure?.tool ?? "manni",
  );

  const usingStdin = run.inputs.includes(STDIN_TOKEN);
  assertOptionsOwned(opts, tool, usingStdin);

  // Resolve `--as` before anything is read: a typo should fail immediately,
  // not after walking a tree of files it was going to mis-parse anyway.
  //
  // A name no parser answers to is unknown, whatever it is meant to name: the
  // formats `manni lint tools` lists are exactly the ones `--as` accepts.
  const forcedParser = opts.as != null ? parserByName(opts.as) : undefined;
  if (opts.as != null && !forcedParser) {
    throw new LintError(
      `Unknown format "${opts.as}". Run "manni lint tools" to see the formats manni lint reads.`,
    );
  }

  // Before the targets are resolved, as cite does: a mistyped path beside `-`
  // was reported as "File not found", which names the wrong mistake when the
  // run could not have read stdin either way.
  if (usingStdin && !forcedParser) {
    throw new LintError(
      "Reading from stdin (-) requires --as <format> to choose a parser.",
    );
  }

  const fileInputs = run.inputs.filter((input) => input !== STDIN_TOKEN);
  // The resolved tool's own walk set is the default, not the walker's. Left
  // undefined, the family walker falls back to the *metadata* tool's extractor
  // extensions, which sweep in every format that tool reads - `.xml` among
  // them, where manni lint's registry honours `walkExtensions` and
  // deliberately walks `.dita` and not `.xml`, so an ordinary `pom.xml` cannot
  // fail a clean tree. Read off the descriptor rather than off that registry
  // directly, so a tool with input formats of its own walks for those.
  // Resolved here rather than at the walk, so `assertNonEmpty` names the same
  // set it filtered with.
  const exts = opts.exts ?? forcedParser?.extensions ?? tool.walkExtensions();
  const allowEmpty = opts.allowEmpty ?? config.allowEmpty;
  // A collection's `exclude:` shapes the collection, so it applies when the
  // inputs came from the collections and never to a path the operator typed.
  // `--exclude` filters either way; the union is deduplicated.
  const exclude = [
    ...new Set([
      ...(opts.exclude ?? []),
      ...(run.fromCollections ? run.collections.flatMap((c) => c.exclude) : []),
    ]),
  ];
  const { files, gitignoreSkipped } = await asLintError(() =>
    resolveTargetSet({
      inputs: fileInputs,
      exts,
      exclude,
      cwd,
      allowEmpty,
      ...gitignoreOptions({
        flag: opts.respectGitignore,
        onNotice: opts.onNotice,
      }),
    }),
  );
  // Resolving zero files is an operational error, not a pass: with no files
  // there is no verdict, and exit 0 would read as a clean bill of health.
  await asLintError(() => {
    assertNonEmpty({
      files,
      inputs: fileInputs,
      usingStdin,
      allowEmpty,
      exclude,
      exts,
      gitignoreSkipped,
      action: "linted",
    });
  });

  // The branch per tool. Reaching the refusal is an internal fault rather than
  // user error - every name the registry does not carry was refused by
  // `resolveStructureTool` above - and it is a `LintError` for that reason: a
  // bare `Error` escapes the bin runner and exits 1, the code that means "the
  // documents have findings".
  const name: string = tool.name;
  let results: LintFileResult[];
  if (name === "manni") {
    results = await lintWithManni({
      opts,
      config,
      cwd,
      files,
      forcedParser,
      usingStdin,
    });
  } else if (name === "dita-ot") {
    // `tools:` is the family's key, not the `lint:` section's, so the home is
    // resolved against the directory of the config that declared it.
    const home = ditaOtHome(run.tools, run.configDir ?? cwd);
    results = await lintWithDitaOt({
      cwd,
      files,
      ...(home === undefined ? {} : { home }),
      ...(opts.onNotice === undefined ? {} : { onNotice: opts.onNotice }),
      validate: opts.runDitaOt ?? runDitaOtValidate,
    });
  } else {
    throw new LintError(`No implementation is registered for the ${name} tool.`);
  }

  // Every tool, not just manni's. A run that resolved files and checked none
  // of them exits 0 and reads as a clean bill of health, which is the worst
  // thing this command can do quietly. It sat inside the manni branch until
  // `dita-ot` started skipping the formats it does not read, at which point
  // `manni lint structure notes.md` reported "0 files checked, 1 skipped" and
  // exited 0. One call here is one the next tool cannot forget to make.
  assertSomethingWasChecked(results, opts.explain === true, tool);

  const skipped = results.filter((r) => r.skipped != null).length;
  const failed = results.filter((r) => r.skipped == null && !r.success).length;
  const checked = results.length - skipped;

  return {
    results,
    summary: { checked, passed: checked - failed, failed, skipped },
  };
}
