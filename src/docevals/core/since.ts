/**
 * `--since <ref>`: which pages changed, in absolute-path terms the engine can
 * compare against a discovered `PageFile` (ADR 01040).
 *
 * Two invocations, both through the injected `ExecFn` so the suite never runs
 * git. `rev-parse --show-toplevel` doubles as the is-this-a-repo check and
 * supplies the anchor the diff's paths are relative to.
 *
 * The anchor is the whole point. `git diff --name-only` prints paths relative
 * to the repository top level, while `PageFile.file` is relative to the
 * *discovery* root — the two differ whenever the config lives in a
 * subdirectory. Comparing them directly does not throw; it simply matches
 * nothing, so every page reads as unchanged and the run exits 0 having
 * evaluated nothing. Reconciling in absolute space is what makes that
 * impossible rather than merely unlikely.
 */
import { resolve } from "node:path";
import { DocevalsError } from "../types.js";
import { outputTail } from "../graders/exec.js";
import type { ExecFn, ExecResult } from "../graders/types.js";

/** git can be slow on a cold index, but not this slow. */
const GIT_TIMEOUT_MS = 30_000;

/**
 * The comparison key for one absolute path.
 *
 * Lowercased on win32, and that is load-bearing rather than defensive: git
 * reports the case recorded in its index, fast-glob reports the case on disk,
 * and the two sources can also disagree about the drive letter. None of those
 * differences is a different file on Windows, but every one of them is a
 * different string.
 *
 * Keyed on the platform rather than on case-insensitivity in general, because
 * the latter cannot be detected reliably — a case-insensitive APFS or a
 * case-sensitive Windows volume both exist. This is the Windows-specific
 * behaviour the code actually implements, not a claim about every such
 * filesystem.
 */
export function changedKey(absPath: string): string {
  const abs = resolve(absPath);
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

/** `outputTail` caps at 400 chars; git stderr on a broken repo is unbounded. */
function stderrOf(result: ExecResult): string {
  return outputTail(result) || "(no output)";
}

/**
 * Run one git invocation, raising the two failures whose repair is the same
 * whichever command produced them. A non-zero exit is left to the caller,
 * because *that* repair differs: a bad repository and a bad ref send the
 * reader to different places.
 */
async function git(
  exec: ExecFn,
  args: string[],
  root: string,
): Promise<ExecResult> {
  const result = await exec(args, { cwd: root, timeoutMs: GIT_TIMEOUT_MS });
  if (result.spawnError) {
    throw new DocevalsError(
      `--since needs git on PATH: could not run git (${result.spawnError}). ` +
        `Install git, or drop --since to evaluate the whole corpus.`,
    );
  }
  if (result.timedOut) {
    throw new DocevalsError(
      `--since timed out: \`${args.join(" ")}\` took longer than ` +
        `${GIT_TIMEOUT_MS / 1000}s in ${root}.`,
    );
  }
  return result;
}

/**
 * Absolute-path keys for every file that differs between `ref` and `HEAD`.
 *
 * `ref...HEAD` (three dots) diffs against the merge base, which is what a pull
 * request means by "changed": commits that landed on the base branch after this
 * one forked are not this branch's changes. It also means **uncommitted
 * working-tree edits are not included** — correct for CI, surprising locally.
 */
export async function changedFilesSince(
  ref: string,
  root: string,
  exec: ExecFn,
): Promise<Set<string>> {
  // A ref that parses as a git option is not a ref. `--output=x` sends the diff
  // to a file and leaves stdout empty, so the changed set comes back empty and
  // the run exits 0 having scoped everything out — the silent green this flag
  // must never produce. `--` does not help: the left side of `A...B` is parsed
  // before any separator, so the shape has to be rejected outright.
  if (ref.startsWith("-")) {
    throw new DocevalsError(
      `--since "${ref}" is not a ref: a value starting with "-" is read by git as ` +
        `an option, which would silently produce an empty diff.`,
    );
  }
  // Git reads an omitted left side of `A...B` as HEAD, so a blank ref diffs
  // HEAD against HEAD — exit 0, empty diff, every eval scoped out, exit 0. The
  // blank arrives by accident: `--since "${{ github.base_ref }}"` renders empty
  // on a push event, and an unset shell variable expands to nothing.
  if (ref.trim() === "") {
    throw new DocevalsError(
      `--since was given an empty ref. Git would read that as HEAD and scope the ` +
        `run to nothing, which exits 0 having checked nothing. If this came from a ` +
        `CI expression, the variable is unset on this event.`,
    );
  }
  const top = await git(exec, ["git", "rev-parse", "--show-toplevel"], root);
  if (top.code !== 0) {
    throw new DocevalsError(
      `--since requires a git repository, and ${root} is not a git repository ` +
        `(or git cannot read it). git said: ${stderrOf(top)}`,
    );
  }
  const topLevel = top.stdout.trim();

  // `-z` is mandatory. Without it, `core.quotePath` C-escapes any path with a
  // non-ASCII byte — `"docs/caf\303\251.md"` — and the escaped form matches no
  // discovered page. Nothing errors; the page is simply never evaluated.
  const diff = await git(
    exec,
    ["git", "--no-pager", "diff", "--name-only", "-z", `${ref}...HEAD`],
    root,
  );
  if (diff.code !== 0) {
    throw new DocevalsError(
      `--since ${ref}: git could not resolve "${ref}...HEAD". ` +
        `In CI this is usually a shallow clone — actions/checkout defaults to ` +
        `fetch-depth: 1, which fetches no other branch, so set fetch-depth: 0 ` +
        `(or fetch ${ref} explicitly) before using --since. ` +
        `git said: ${stderrOf(diff)}`,
    );
  }

  const changed = new Set<string>();
  // NUL-*terminated*, not NUL-separated: the last entry is followed by a
  // separator, so the split ends in an empty string.
  for (const rel of diff.stdout.split("\0")) {
    if (rel === "") continue;
    changed.add(changedKey(resolve(topLevel, rel)));
  }
  return changed;
}
