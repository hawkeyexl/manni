/**
 * `manni cite check`: resolve targets, check every page, settle the baseline.
 *
 * The run shape is meta's `validate`: `resolveCiteRun` → `resolveTargetSet` /
 * `assertNonEmpty` → one `checkCitations` per page → `settleBaseline`. One git
 * client and one source index are built for the run and handed to every page,
 * so a thousand pages against one root cost one `git ls-files`. `prepareRun`
 * is the shared front half; `update` runs the same one.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isErrorSeverity,
  supportedExtensions,
  type FieldError,
  type FingerprintContext,
  type MetadataExtractor,
  type RunSummary,
} from "../../meta/index.js";
import {
  assertNonEmpty,
  extractorByName,
  gitignoreOptions,
  resolveBaselineRequest,
  resolveTargetSet,
  settleBaseline,
  STDIN_LABEL,
  STDIN_TOKEN,
} from "../../meta/internal.js";
import { toValidationResult } from "../core/adapt.js";
import { checkCitations } from "../core/check-page.js";
import { DEFAULT_CITE_BASELINE_PATH, resolveCiteRun } from "../core/config.js";
import { GIT_UNAVAILABLE_HISTORY, gitClient } from "../core/git.js";
import { buildSourceIndex } from "../core/sources.js";
import { CiteError } from "../errors.js";
import type {
  CheckOptions,
  CheckPageOptions,
  CheckRun,
  CiteRun,
  GitClient,
  PageCitationReport,
  SourceIndex,
} from "../types.js";

/** What `check` and `update` settle before touching a page. */
export interface PreparedRun {
  cwd: string;
  run: CiteRun;
  /** Files to process, posix and relative to `run.base`. */
  files: string[];
  gitignoreSkipped: number;
  usingStdin: boolean;
  /** The `--as` extractor, validated. */
  forced?: MetadataExtractor;
  /** What every `checkCitations` call in the run shares: root, key, table, client, index. */
  pageOptions: CheckPageOptions;
  /** The git client every page shares, the one in `pageOptions`. */
  git: GitClient;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function indexFor(root: string, client: GitClient): Promise<SourceIndex> {
  try {
    return await buildSourceIndex(root, { gitClient: client });
  } catch (error) {
    if (isEnoent(error)) throw new CiteError(`Root directory not found: ${root}.`);
    throw error;
  }
}

/**
 * The front half of a run: which config governs it, which files it covers,
 * and the clients every page shares. `action` is the past-tense verb the
 * empty-set error uses ("checked"), `verb` the imperative one ("check").
 */
export async function prepareRun(
  opts: CheckOptions,
  action: string,
  verb: string,
  requireSources = false,
): Promise<PreparedRun> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const run = await resolveCiteRun({
    cwd,
    configPath: opts.configPath,
    noConfig: opts.noConfig,
    inputs: opts.inputs,
    collection: opts.collection,
    root: opts.root,
    onConfigLoaded: opts.onConfigLoaded,
    onNotice: opts.onNotice,
    env: opts.env,
  });
  const { config, inputs, base } = run;

  const checkSources = opts.checkSources ?? config?.checkSources ?? true;
  if (requireSources && !checkSources) {
    throw new CiteError(`${verb} needs the sources: drop --no-check-sources (or \`checkSources: false\`).`);
  }
  if (inputs.length === 0) {
    throw new CiteError(
      `No files to ${verb}. Pass paths/globs, or declare a collection under \`collections:\` in manni.config.yaml.`,
    );
  }

  const usingStdin = inputs.includes(STDIN_TOKEN);
  const forced = opts.as === undefined ? undefined : extractorByName(opts.as);
  if (opts.as !== undefined && forced?.implemented !== true) {
    throw new CiteError(
      `Unknown format "${opts.as}". Supported extensions: ${supportedExtensions().join(", ")}.`,
    );
  }
  if (usingStdin && forced === undefined) {
    throw new CiteError("Reading from stdin (`-`) requires --as <format> to choose an extractor.");
  }

  const exts = opts.exts ?? forced?.extensions;
  const fileInputs = inputs.filter((input) => input !== STDIN_TOKEN);
  const allowEmpty = opts.allowEmpty ?? config?.allowEmpty;
  // A collection's `exclude:` shapes the collection, so it applies when the
  // inputs came from the collections and never to a path the operator typed.
  // `--exclude` filters either way; the union is deduplicated, first spelling wins.
  const exclude = [
    ...new Set([
      ...(opts.exclude ?? []),
      ...(run.fromCollections ? run.collections.flatMap((c) => c.exclude) : []),
    ]),
  ];
  const { files, gitignoreSkipped } = await resolveTargetSet({
    inputs: fileInputs,
    exts,
    exclude,
    cwd: base,
    allowEmpty,
    ...gitignoreOptions({
      flag: opts.respectGitignore,
      configured: config?.respectGitignore,
      onNotice: opts.onNotice,
    }),
  });
  assertNonEmpty({ files, inputs: fileInputs, usingStdin, allowEmpty, exclude, exts, gitignoreSkipped, action });

  // Git is used whenever it is there: on PATH, with the root inside a work
  // tree. Where it is not, the index is a walk and history is off, and a page
  // whose citations wanted history says so (see `checkCitations`).
  const git = opts.gitClient ?? gitClient(run.root);
  const pageOptions: CheckPageOptions = {
    root: run.root,
    checkSources,
    key: run.key,
    severity: config?.severity,
    gitClient: git,
  };
  if (checkSources) pageOptions.sourceIndex = await indexFor(run.root, git);

  return { cwd, run, files, gitignoreSkipped, usingStdin, forced, pageOptions, git };
}

/** Read a resolved target, as the run labelled it. */
export function readTarget(run: CiteRun, file: string): Promise<string> {
  return readFile(resolve(run.base, file), "utf8");
}

/**
 * Run-level notices are said once per run, however many pages raised them.
 * `also` is what the run has to say beyond its pages: said after them, and
 * not again when a page already said it.
 */
export function sayNotices(
  pages: readonly PageCitationReport[],
  onNotice: CheckOptions["onNotice"],
  also: readonly string[] = [],
): void {
  const said = new Set<string>();
  for (const notice of [...pages.flatMap((page) => page.notices), ...also]) {
    if (said.has(notice)) continue;
    said.add(notice);
    onNotice?.(notice);
  }
}

export async function runCheck(opts: CheckOptions): Promise<CheckRun> {
  const { cwd, run, files, gitignoreSkipped, usingStdin, forced, pageOptions, git } = await prepareRun(
    opts,
    "checked",
    "check",
  );

  const pages: PageCitationReport[] = [];
  const checkOne = async (label: string, content: string): Promise<void> => {
    pages.push(await checkCitations({ file: label, content, format: forced?.name }, pageOptions));
  };
  if (usingStdin) await checkOne(STDIN_LABEL, opts.stdinContent ?? "");
  for (const file of files) await checkOne(file, await readTarget(run, file));
  // `--show-diff` wants history whatever the pages carry. With the sources
  // off nothing is classified, so nothing wants git.
  const wantsDiff = opts.showDiff === true && pageOptions.checkSources !== false && !(await git.available());
  sayNotices(pages, opts.onNotice, wantsDiff ? [GIT_UNAVAILABLE_HISTORY] : []);

  const results = pages.map(toValidationResult);
  // Fingerprints must not depend on where the command was run from, so they
  // are measured from the config's directory when one governs the run.
  const frame: FingerprintContext = { cwd, base: run.configDir ?? cwd, runBase: run.base };
  const request = resolveBaselineRequest(opts, run.config?.baseline, run.configDir, cwd, {
    current: DEFAULT_CITE_BASELINE_PATH,
  });
  // The ratchet's own not-found error names `meta validate`; this tool's
  // baseline is recorded by its own command, so the advice has to say so.
  if (request !== null && !request.write && !existsSync(request.absPath)) {
    throw new CiteError(
      `Baseline "${request.label}" not found. Record one with \`manni cite check --write-baseline\`, or drop --baseline.`,
    );
  }
  const { results: reported, baseline } = await settleBaseline(results, request, frame);

  const failed = reported.filter((r) => !r.ok).length;
  const count = (keep: (e: FieldError) => boolean): number =>
    reported.reduce((n, r) => n + r.errors.filter(keep).length, 0);
  const warnings = count((e) => e.severity === "warning");
  const notices = count((e) => e.severity === "notice");
  const summary: RunSummary = {
    files: reported.length,
    passed: reported.length - failed,
    failed,
    errors: count(isErrorSeverity),
    // Omitted at zero, as meta's summary has them, so the JSON shape of a
    // clean run is the one every consumer of `meta validate` already reads.
    ...(warnings > 0 ? { warnings } : {}),
    ...(notices > 0 ? { notices } : {}),
    ...(gitignoreSkipped > 0 ? { gitignoreSkipped } : {}),
    ...(baseline ? { baseline } : {}),
  };

  return { results: reported, summary, frame, pages, warnings, notices };
}
