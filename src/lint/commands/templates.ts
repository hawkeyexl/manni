/**
 * `templates` command cores.
 *
 * `runTemplates` reports the templates a run could resolve: the built-ins, plus
 * the named templates in any files given by `--templates` or by
 * `lint.templates` in the config, with the doctypes each serves.
 *
 * The `types` column is the part worth printing. It is what frontmatter
 * routing will match a page against, so seeing it is how someone works out
 * which `type:` value to write in a page - or that no template claims the one
 * they already wrote.
 *
 * `runTemplatesInfer` writes a first template from a page that already has the
 * shape its author wants. The inference itself is `../core/infer.ts`; what
 * lives here is the plumbing around it - which parser reads the page, what the
 * template is called, and where the file goes.
 *
 * Both return data; `src/lint/reporters/index.ts` renders the listing, and an
 * inferred template is already the text it will be written as.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { errorMessage, ToolError } from "../../shared/errors.js";
import { writeTextAtomic } from "../../shared/write-file.js";
import { LintError } from "../types.js";
import type { DocumentParser, DocumentTree } from "../types.js";
import {
  parserByName,
  parserForExtension,
  supportedExtensions,
} from "../parsers/index.js";
import {
  assertTemplateName,
  inferTemplateFile,
  isInferFormat,
  renderTemplateFile,
  type InferFormat,
} from "../core/infer.js";
import type { TemplateFile } from "../core/template.js";
import { resolveLintRun } from "../core/config.js";
import {
  listBuiltins,
  loadTemplateFile,
} from "../core/template-registry.js";

/** `TemplateInfo.source` for a template that ships with the tool. */
export const BUILTIN_SOURCE = "builtin";

export interface TemplateInfo {
  /** The ref to pass to `--template`. */
  id: string;
  /**
   * Human-readable title. Empty for templates read from a user file: the
   * template DSL has no title field, only the built-in registry carries one.
   */
  title: string;
  /** Doctypes the template serves, matched against a page `type`. */
  types: string[];
  /** `builtin`, or the template file this entry came from. */
  source: string;
}

export interface TemplatesInfo {
  templates: TemplateInfo[];
}

export interface TemplatesOptions {
  /** Template files whose entries join the built-ins. */
  templates?: string | string[];
}

export async function runTemplates(
  opts: TemplatesOptions = {},
): Promise<TemplatesInfo> {
  const templates: TemplateInfo[] = listBuiltins().map((builtin) => ({
    id: builtin.id,
    title: builtin.title,
    types: builtin.types,
    source: BUILTIN_SOURCE,
  }));

  // Listed after the built-ins, in the order supplied - the same order
  // `buildTypeIndex` applies them in, so a later entry claiming the same
  // doctype is the one that would win.
  const paths =
    opts.templates == null
      ? []
      : Array.isArray(opts.templates)
        ? opts.templates
        : [opts.templates];

  for (const path of paths) {
    const file = await loadTemplateFile(path);
    for (const [id, template] of Object.entries(file.templates ?? {})) {
      templates.push({
        id,
        title: "",
        types: template.types ?? [],
        source: path,
      });
    }
  }

  return { templates };
}

/* -------------------------------------------------------------------------- *
 * infer
 * -------------------------------------------------------------------------- */

/** The token that means stdin, in every command of the family. */
const STDIN = "-";

/** What a page read from stdin is called when nothing else names it. */
const STDIN_NAME = "stdin";

export interface TemplatesInferOptions {
  /** The one page to infer from: a path, or `-` for stdin. */
  page: string;
  /** `--as`: force an input format, by parser name. */
  as?: string;
  /** `--name`: what to call the template. Defaults to the page's own doctype. */
  name?: string;
  /** `-f/--format`: how the file is written. Defaults to `yaml`. */
  format?: InferFormat;
  /** `-o/--out`: write here instead of returning text for stdout. */
  out?: string;
  /** `--force`: replace an existing `--out`. */
  force?: boolean;
  cwd?: string;
  /** Content for the `-` page, injected by the CLI and by tests. */
  stdinContent?: string;
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`: skip discovery. */
  noConfig?: boolean;
  /** Told which config governed the run, and where it came from. */
  onConfigLoaded?: (info: { path: string; dir: string }) => void;
}

export interface TemplatesInferResult {
  /** The name the template was written under. */
  name: string;
  /** The inferred file, for a caller that wants the data rather than the text. */
  file: TemplateFile;
  /** The serialized template file, exactly as written. */
  text: string;
  /** Where it was written. Absent without `--out`. */
  written?: string;
}

/**
 * The parser that reads this page.
 *
 * Resolved before anything is read, as `runLint` does it: a typo in `--as`
 * should fail immediately rather than after a file was opened it was going to
 * mis-parse anyway. A name no parser answers to is unknown whatever it was
 * meant to name, so the message points at the one command that lists them.
 */
function parserFor(page: string, as: string | undefined): DocumentParser {
  if (as !== undefined) {
    const forced = parserByName(as);
    if (forced) return forced;
    throw new LintError(
      `Unknown format "${as}". Run "manni lint tools" to see the formats manni lint reads.`,
    );
  }
  if (page === STDIN) {
    throw new LintError(
      "Reading from stdin (-) requires --as <format> to choose a parser.",
    );
  }
  const ext = extname(page);
  const parser = parserForExtension(ext);
  if (parser) return parser;
  throw new LintError(
    `no parser is registered for "${ext || page}". Supported extensions: ` +
      `${supportedExtensions().join(", ")}. Use --as to override.`,
  );
}

/**
 * What the template is called: `--name`, else the page's own doctype, else the
 * file's stem.
 *
 * The doctype first because that is the handle the page already carries, and
 * the one `types:` will route on once the author adds it. A file read from
 * stdin has no stem, so it falls back to a word rather than to `-`.
 */
function defaultName(tree: DocumentTree, page: string): string {
  const declared = tree.frontmatter?.["type"];
  if (typeof declared === "string" && declared.trim().length > 0) {
    return declared.trim();
  }
  if (page === STDIN) return STDIN_NAME;
  return basename(page, extname(page)) || STDIN_NAME;
}

/**
 * Infer a template from one page.
 *
 * One page, never a set. A template is a generalisation, and this makes exactly
 * the generalisation one exemplar supports; inferring from several would mean
 * deciding which differences are variation and which are mistakes, which is the
 * author's judgment and not the tool's.
 */
export async function runTemplatesInfer(
  opts: TemplatesInferOptions,
): Promise<TemplatesInferResult> {
  const format = opts.format ?? "yaml";
  if (!isInferFormat(format)) {
    throw new LintError(
      `Unknown --format "${String(format)}". Use yaml or json.`,
    );
  }

  // Which config governs the run, said once, the way every other lint verb
  // says it. With a page typed on the command line the base stays the working
  // directory, so the path means what it looked like it meant.
  const run = await resolveLintRun({
    cwd: opts.cwd ?? process.cwd(),
    ...(opts.configPath === undefined ? {} : { configPath: opts.configPath }),
    ...(opts.noConfig === undefined ? {} : { noConfig: opts.noConfig }),
    inputs: [opts.page],
    ...(opts.onConfigLoaded === undefined
      ? {}
      : { onConfigLoaded: opts.onConfigLoaded }),
  });
  const cwd = run.base;

  const parser = parserFor(opts.page, opts.as);
  // A name the schema cannot hold is refused before the page is read, beside
  // the other refusals: a run that is going to fail should leave the working
  // tree, and the reader's terminal, exactly as it found them.
  if (opts.name !== undefined) assertTemplateName(opts.name);

  // Every refusal happens before the write, and the `--out` guard happens
  // before the read - the ordering `meta schemas infer` established. The path
  // is echoed as it was typed, because that is the string the reader will edit.
  let absOut: string | undefined;
  if (opts.out !== undefined) {
    absOut = resolve(cwd, opts.out);
    if (opts.force !== true && existsSync(absOut)) {
      throw new LintError(`${opts.out} exists. Pass --force to overwrite it.`);
    }
  }

  let content: string;
  if (opts.page === STDIN) {
    content = opts.stdinContent ?? "";
  } else {
    try {
      content = await readFile(resolve(cwd, opts.page), "utf8");
    } catch (err) {
      // The OS message travels verbatim: "permission denied" and "no such
      // file" send the reader to different places, and this cannot tell which.
      throw new LintError(
        `"${opts.page}" could not be read: ${errorMessage(err)}`,
      );
    }
  }

  let tree: DocumentTree;
  try {
    tree = parser.parse(content, opts.page === STDIN ? "<stdin>" : opts.page);
  } catch (err) {
    // A page that will not parse has no shape to infer, and the parser's own
    // message already names the file and the syntax it choked on.
    if (err instanceof ToolError) throw new LintError(err.message);
    throw err;
  }

  const name = opts.name ?? defaultName(tree, opts.page);
  const file = inferTemplateFile(tree, name);
  const text = renderTemplateFile(file, format);

  if (absOut === undefined) return { name, file, text };

  await mkdir(dirname(absOut), { recursive: true });
  await writeTextAtomic(absOut, text);
  return { name, file, text, written: opts.out };
}
