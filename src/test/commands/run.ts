/**
 * `manni test run`: run Doc Detective and read its verdict from its results.
 *
 * Input precedence is positional paths, then `--collection`, then Doc
 * Detective's own config `input`. Without `--collection`, manni's collections
 * are not read: Doc Detective's config is this tool's default input.
 *
 * Doc Detective exits 0 when tests fail, so the exit code only says whether it
 * ran. The verdict is the results file it writes under `-o`, which is a temp
 * directory removed afterwards.
 */
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import fg from "fast-glob";
import picomatch from "picomatch";
import { selectCollections } from "../../shared/collections.js";
import { findConfigFile, readConfigFile, type ConfigFile } from "../../shared/config-file.js";
import { ToolError } from "../../shared/errors.js";
import { outputTail } from "../../shared/exec.js";
import { docDetectiveConfigPath } from "../../shared/tools.js";
import { notFoundMessage, resolveTargetSet, STDIN_TOKEN } from "../../meta/internal.js";
import { NOT_ON_PATH, realSpawn, type DocDetectiveSpawn } from "../core/doc-detective.js";
import {
  anyFailed,
  collectFindings,
  parseResults,
  testCounts,
  type DocDetectiveResults,
  type ResultCounts,
  type TestFinding,
} from "../core/results.js";
import { TestError } from "../errors.js";

export interface RunTestOptions {
  /** Positional files, directories and globs. */
  paths?: string[];
  /** `--collection <name>`, repeatable. */
  collection?: string[];
  /** `-c, --config`: a manni config file. */
  configPath?: string;
  cwd?: string;
  /** Finding no tests, or no inputs, is a pass. */
  allowEmpty?: boolean;
  /** Stream Doc Detective's output to stderr as it runs. */
  progress?: boolean;
  /** Test seam: how Doc Detective is started. */
  spawn?: DocDetectiveSpawn;
}

export interface TestRunResult {
  /** Doc Detective's results object as it wrote it; `null` when it found no tests. */
  results: DocDetectiveResults | null;
  /** Every FAIL and WARNING step. */
  findings: TestFinding[];
  /** The test-level counts. */
  tests: ResultCounts;
  /** 1 when anything failed. */
  exitCode: 0 | 1;
}

/** What Doc Detective finds on its own in the working directory. */
const DOC_DETECTIVE_CONFIG_NAMES = [".doc-detective.json", ".doc-detective.yaml", ".doc-detective.yml"];

const DEFAULT_IGNORE = ["**/node_modules/**", "**/.git/**"];

const NO_RESULTS = "Doc Detective wrote no results to read. Run doc-detective directly to see why.";

/** A run with nothing to report; a fresh object each time, so no caller shares one. */
function empty(results: DocDetectiveResults | null = null): TestRunResult {
  return { results, findings: [], tests: { pass: 0, fail: 0, warning: 0, skipped: 0 }, exitCode: 0 };
}

const toError = (message: string): Error => new TestError(message);

/** A sibling's `ToolError` (meta's walk, say) reported as this domain's. */
async function asTestError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof ToolError && !(err instanceof TestError)) throw new TestError(err.message);
    throw err;
  }
}

async function loadConfig(cwd: string, configPath: string | undefined): Promise<ConfigFile | null> {
  const opts = { section: "test", legacyNames: [], toError };
  return configPath === undefined
    ? findConfigFile(cwd, opts)
    : readConfigFile(configPath, cwd, opts);
}

/**
 * Positional inputs as Doc Detective takes them. Files and directories go as
 * typed, and Doc Detective walks a directory itself. A glob is expanded here.
 * A name that does not exist is refused, because Doc Detective skips one in
 * silence.
 */
async function positionalInputs(paths: string[], cwd: string, allowEmpty: boolean): Promise<string[]> {
  const inputs: string[] = [];
  const missing: string[] = [];
  for (const path of paths) {
    const posix = path.replace(/\\/g, "/");
    if (existsSync(resolve(cwd, posix))) {
      inputs.push(path);
    } else if (picomatch.scan(posix).isGlob) {
      const found = await fg(posix, { cwd, ignore: DEFAULT_IGNORE, onlyFiles: true, dot: false });
      inputs.push(...found.sort());
    } else {
      missing.push(posix);
    }
  }
  if (missing.length > 0 && !allowEmpty) throw new TestError(notFoundMessage(missing));
  return inputs;
}

/** The selected collections' files, minus their excludes, relative to `cwd`. */
async function collectionInputs(
  file: ConfigFile,
  names: string[],
  cwd: string,
  allowEmpty: boolean,
): Promise<string[]> {
  const collections = selectCollections(file.collections, names, file.source, toError);
  const { files } = await asTestError(() =>
    resolveTargetSet({
      inputs: collections.flatMap((c) => c.paths),
      exclude: collections.flatMap((c) => c.exclude),
      cwd: file.dir,
      allowEmpty,
    }),
  );
  return files.map((f) => relative(cwd, resolve(file.dir, f)).replace(/\\/g, "/"));
}

async function readResults(outDir: string): Promise<DocDetectiveResults | null> {
  const names = (await readdir(outDir)).filter((n) => /^testResults-.*\.json$/.test(n)).sort();
  const last = names.at(-1);
  if (last === undefined) throw new TestError(NO_RESULTS);
  const results = parseResults(await readFile(join(outDir, last), "utf8"));
  if (results === undefined) throw new TestError(NO_RESULTS);
  return results;
}

export async function runTest(opts: RunTestOptions = {}): Promise<TestRunResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const paths = opts.paths ?? [];
  const wanted = opts.collection ?? [];
  const allowEmpty = opts.allowEmpty ?? false;

  if (paths.includes(STDIN_TOKEN)) {
    throw new TestError("test run reads files; Doc Detective has no stdin. Pass a path.");
  }
  // lint's two sentences: a collection is a set the operator did not type, so
  // it composes with no typed path, and only a config can define one.
  if (wanted.length > 0 && paths.length > 0) {
    throw new TestError(
      "--collection selects a configured collection; it cannot be combined with paths.",
    );
  }
  const file = await loadConfig(cwd, opts.configPath);
  if (wanted.length > 0 && file === null) {
    throw new TestError("--collection needs a config file to select from.");
  }

  const ddConfig = file === null ? undefined : docDetectiveConfigPath(file.tools, file.dir);
  if (file !== null && ddConfig !== undefined && !existsSync(ddConfig)) {
    const written = file.tools["doc-detective"]?.config ?? ddConfig;
    throw new TestError(`${file.source}: tools.doc-detective.config "${written}" does not exist.`);
  }

  let inputs: string[] | undefined;
  if (paths.length > 0) {
    inputs = await positionalInputs(paths, cwd, allowEmpty);
    if (inputs.length === 0) {
      if (allowEmpty) return empty();
      const tried = paths.map((p) => `"${p}"`).join(", ");
      throw new TestError(
        `No files matched. Patterns tried: ${tried}. Pass --allow-empty if that is expected.`,
      );
    }
  } else if (file !== null && wanted.length > 0) {
    inputs = await collectionInputs(file, wanted, cwd, allowEmpty);
    if (inputs.length === 0) {
      if (allowEmpty) return empty();
      throw new TestError("--collection matched no files. Pass --allow-empty if that is expected.");
    }
  } else if (
    ddConfig === undefined &&
    !DOC_DETECTIVE_CONFIG_NAMES.some((name) => existsSync(join(cwd, name)))
  ) {
    throw new TestError(
      "test run needs paths or a Doc Detective config. Pass paths, or add .doc-detective.json.",
    );
  }

  const outDir = await mkdtemp(join(tmpdir(), "manni-test-"));
  try {
    const args = [
      // ponytail: Doc Detective splits -i on commas, so a path holding a comma
      // is two inputs. Upgrade path: a generated config whose input is a list.
      ...(inputs === undefined ? [] : ["-i", inputs.join(",")]),
      ...(ddConfig === undefined ? [] : ["-c", ddConfig]),
      "-r",
      "json",
      "-o",
      outDir,
    ];
    const run = await (opts.spawn ?? realSpawn)(args, { cwd, progress: opts.progress ?? false });
    if (run.spawnError !== undefined) throw new TestError(NOT_ON_PATH);
    if (run.code !== 0) {
      const how = run.code === null ? "killed before exiting" : `exit ${String(run.code)}`;
      throw new TestError(`Doc Detective failed (${how}):\n${outputTail(run)}`);
    }

    const results = await readResults(outDir);
    const tests = testCounts(results);
    const total = tests.pass + tests.fail + tests.warning + tests.skipped;
    // A `null` results file counts as zero tests, so `total` covers it.
    if (total === 0) {
      if (allowEmpty) return empty(results);
      throw new TestError(
        "Doc Detective found no tests in the inputs. Pass --allow-empty if that is expected.",
      );
    }
    return {
      results,
      findings: collectFindings(results, cwd),
      tests,
      exitCode: anyFailed(results) ? 1 : 0,
    };
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}
