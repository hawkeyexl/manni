/**
 * `manni cite salt set` and `manni cite salt rotate`.
 *
 * `set` writes `cite.salt` into the family file, generating one when none is
 * given, and refuses to overwrite a configured salt: replacing it without
 * re-keying every obfuscated citation would turn each of them `missing`, and
 * `rotate` is the command that re-keys them.
 *
 * `rotate` re-keys every `~token` citation in the given pages under a new
 * salt and then writes it where the old one lives. A salt from `cite.salt`
 * is replaced in the config. A salt from `MANNI_CITE_SALT` rotates through
 * the environment: `--to` is required, the pages are re-keyed under it, and
 * the config is never touched, because in the public-docs layout the config
 * is the public file the secret exists to stay out of. The run is atomic
 * across the pages and the config. Every page is rewritten in memory first,
 * and nothing reaches disk until every entry re-keyed, because a salt
 * written beside a citation that still holds the old key would leave that
 * citation `missing` on the next check. An entry whose pin no longer holds
 * today is re-keyed from the lines at its commit when git can show them (the
 * search the classifier already runs), else skipped with `update --accept`
 * named as the repair.
 */
import { resolve } from "node:path";
import { writeFileAtomic } from "../../meta/index.js";
import { STDIN_TOKEN } from "../../meta/internal.js";
import { historyOf } from "../core/classify.js";
import { SALT_ENV, parseCiteConfig, readCiteConfigFile, resolveSalt } from "../core/config.js";
import { writeSaltToConfig } from "../core/config-write.js";
import { hashLines, sliceLines, splitLines } from "../core/hash.js";
import { readPage } from "../core/page.js";
import { formatSrc, parseSrc } from "../core/range.js";
import { buildSourceIndex, generateSalt, obfuscatePath, readSource } from "../core/sources.js";
import { rewriteInlineFields, spliceEntryField } from "../core/write.js";
import { CiteError } from "../errors.js";
import type {
  Citation,
  CitationOrigin,
  GitClient,
  SaltRotateOptions,
  SaltRotatePage,
  SaltRotateRewrite,
  SaltRotateRun,
  SaltRotateSkip,
  SaltSetOptions,
  SaltSetResult,
  SourceIndex,
  SourceRange,
} from "../types.js";
import { prepareRun, readTarget } from "./check.js";

const NO_CONFIG = "No manni.config.yaml found. Create one, or name it with -c.";
const ENV_WINS = `${SALT_ENV} is set and wins over cite.salt for every run.`;
const EMPTY = "The salt must not be empty.";
const NO_SALT = "No salt is configured; nothing to rotate. Run `manni cite salt set` first.";
/** An environment salt cannot be generated: the tool has no way to put it in the secret. */
const ENV_NEEDS_TO = `The salt comes from ${SALT_ENV}; pass --to <value>, re-key with it, then update the secret. Nothing is written to config.`;
const MISSING = "missing (no tracked file matches under the current salt)";
const CHANGED = "changed; run `manni cite update --accept` before rotating";

/** A typed salt is a string the operator chose; the empty one is no salt at all. */
function assertSalt(value: string): string {
  if (value === "") throw new CiteError(EMPTY);
  return value;
}

export async function runSaltSet(opts: SaltSetOptions): Promise<SaltSetResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const env = opts.env ?? process.env;
  const file = await readCiteConfigFile(opts.configPath, cwd);
  if (file === null) throw new CiteError(NO_CONFIG);
  // Parsed before anything else, so a config the tool refuses is refused here too.
  const config = parseCiteConfig(file.value, file.source);
  if (config.salt !== undefined) {
    throw new CiteError(
      `A salt is already configured in ${file.source}. Run \`manni cite salt rotate\` to replace it and re-key every obfuscated citation.`,
    );
  }
  const value = opts.value === undefined ? generateSalt() : assertSalt(opts.value);
  if (env[SALT_ENV] !== undefined) opts.onWarn?.(ENV_WINS);
  const result: SaltSetResult = { source: file.source, path: file.path, written: false };
  if (opts.dryRun === true) return result;
  await writeSaltToConfig(file, value);
  return { ...result, written: true };
}

/** The lines a citation's pin was minted over, found today or at its commit; else why not. */
type Keyed =
  | { kind: "ok"; joined: string; resolvedPath: string }
  | { kind: "skip"; reason: string };

interface KeyedInput {
  root: string;
  index: SourceIndex;
  git: GitClient;
  useGit: boolean;
  oldSalt: string;
  pageCommit?: string;
}

async function keyedLines(input: KeyedInput, citation: Citation, range: SourceRange): Promise<Keyed> {
  const source = await readSource(input.root, input.index, range);
  if (source.kind === "missing") return { kind: "skip", reason: MISSING };
  let joined: string | undefined;
  try {
    joined = sliceLines(splitLines(source.text), range);
  } catch {
    // The range runs past the end of the file as it is now.
    joined = undefined;
  }
  if (joined !== undefined && hashLines(joined, input.oldSalt) === citation.integrity) {
    return { kind: "ok", joined, resolvedPath: source.resolvedPath };
  }
  // Not at those lines today. The classifier's history search finds the
  // lines the pin was minted over at the recorded commit, wherever they sat
  // in the file then; a pin that held there is re-keyed over those lines, so
  // a `changed` citation stays exactly as changed under the new salt.
  const commit = citation.commit ?? input.pageCommit;
  if (input.useGit && commit !== undefined && (await input.git.available())) {
    const history = await historyOf(
      input.git,
      commit,
      source.resolvedPath,
      range,
      citation.integrity,
      input.oldSalt,
      undefined,
    );
    if (history.kind === "original") {
      return { kind: "ok", joined: history.lines.join("\n"), resolvedPath: source.resolvedPath };
    }
  }
  return { kind: "skip", reason: CHANGED };
}

/** The fields a report row carries to name the entry: its id, or where it sits. */
function whereOf(citation: Citation, origin: CitationOrigin): Pick<SaltRotateRewrite, "id" | "index" | "line"> {
  const where: Pick<SaltRotateRewrite, "id" | "index" | "line"> = {};
  if (citation.id !== undefined) where.id = citation.id;
  if (origin.kind === "frontmatter") {
    where.index = origin.index;
    if (origin.line !== undefined) where.line = origin.line;
  } else {
    where.line = origin.line;
  }
  return where;
}

export async function runSaltRotate(opts: SaltRotateOptions): Promise<SaltRotateRun> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const env = opts.env ?? process.env;
  if (opts.inputs.includes(STDIN_TOKEN)) {
    throw new CiteError("salt rotate cannot read from stdin: a rotated page is written back to its file.");
  }
  // The config is where the old salt is read from, and where a config salt
  // is replaced, so it has to exist before any page is read; and the old salt
  // has to exist, or there is nothing keyed.
  const file = await readCiteConfigFile(opts.configPath, cwd);
  if (file === null) throw new CiteError(NO_CONFIG);
  const { salt: oldSalt, saltSource } = resolveSalt(env, parseCiteConfig(file.value, file.source));
  if (oldSalt === "" || saltSource === "none") throw new CiteError(NO_SALT);
  // An environment salt rotates through the environment. The tool cannot
  // write the secret, so a generated value would exist nowhere but a page.
  const fromEnv = saltSource === "env";
  if (fromEnv && opts.to === undefined) throw new CiteError(ENV_NEEDS_TO);
  const newSalt = opts.to === undefined ? generateSalt() : assertSalt(opts.to);

  // The same front half as `check` and `update`, over the same env, so the
  // source index it built is the old salt's.
  const { run, files, forced, pageOptions } = await prepareRun({ ...opts, env }, "rotated", "rotate", true);
  const git = pageOptions.git !== false;
  const client = pageOptions.gitClient;
  if (client === undefined) throw new CiteError("salt rotate needs a git client; this is a bug.");
  const index =
    pageOptions.sourceIndex ?? (await buildSourceIndex(run.root, oldSalt, { gitClient: client, git }));

  const rekeyOne = async (label: string, content: string): Promise<{ page: SaltRotatePage; after: string }> => {
    const page = readPage(label, content, forced === undefined ? undefined : { format: forced.name });
    const input: KeyedInput = { root: run.root, index, git: client, useGit: git, oldSalt };
    if (page.commit !== undefined) input.pageCommit = page.commit;
    const rewritten: SaltRotateRewrite[] = [];
    const skipped: SaltRotateSkip[] = [];
    let after = content;
    for (const { citation, origin } of page.citations) {
      const range = parseSrc(citation.src);
      // A plain path carries nothing the salt keys.
      if (!range.obfuscated) continue;
      const where = whereOf(citation, origin);
      const keyed = await keyedLines(input, citation, range);
      if (keyed.kind === "skip") {
        skipped.push({ ...where, src: citation.src, reason: keyed.reason });
        continue;
      }
      const to = formatSrc({ ...range, path: obfuscatePath(keyed.resolvedPath, newSalt) });
      const integrity = hashLines(keyed.joined, newSalt);
      if (origin.kind === "frontmatter") {
        after = spliceEntryField(after, page.format, origin.index, "src", to);
        after = spliceEntryField(after, page.format, origin.index, "integrity", integrity);
      } else {
        after = rewriteInlineFields(after, page.format, label, origin.line, { src: to, integrity });
      }
      rewritten.push({ ...where, from: citation.src, to });
    }
    return { page: { file: label, rewritten, skipped, written: false }, after };
  };

  const results: { page: SaltRotatePage; after: string; path: string }[] = [];
  for (const label of files) {
    const path = resolve(run.base, label);
    results.push({ ...(await rekeyOne(label, await readTarget(run, label))), path });
  }

  const rekeyed = results.reduce((n, r) => n + r.page.rewritten.length, 0);
  const skipped = results.reduce((n, r) => n + r.page.skipped.length, 0);
  const undone = skipped > 0;
  // Nothing is written while anything is skipped: a half-rotated corpus
  // would read as `missing` under whichever salt the config then carried.
  const write = !undone && opts.dryRun !== true;
  if (write) {
    for (const result of results) {
      if (result.page.rewritten.length === 0) continue;
      await writeFileAtomic(result.path, result.after);
      result.page.written = true;
    }
    // A config salt is replaced where it lives. An environment salt is the
    // operator's to update, in the secret, and never reaches the config.
    if (!fromEnv) await writeSaltToConfig(file, newSalt);
  }

  return {
    pages: results.map((r) => r.page),
    rekeyed,
    skipped,
    saltWritten: write && !fromEnv,
    saltSource,
    source: file.source,
    dryRun: opts.dryRun === true,
    exitCode: undone ? 1 : 0,
  };
}
