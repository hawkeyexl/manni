/**
 * The one question a write asks when it needs an encryption key and there is
 * none (proposal 0045): generate one, and write it where the next run will
 * find it.
 *
 * Only on a terminal. Off one, a write that needs a key refuses (exit 2) with
 * the same line and no question, because a prompt nobody can answer is a hung
 * CI job. The CLI decides by passing `terminalConfirm()`; the command cores
 * take the `Confirm` as an option, so tests inject the answer.
 *
 * What the user reads, in order, on stderr:
 *
 *   manni: /owner must be encrypted, and no encryption key is available.
 *   manni: manni.config.yaml is not ignored by git: … (only when it is not)
 *   Generate a key and write it to manni.config.yaml? [y/N] y
 *   Encryption key written to manni.config.yaml.
 *
 * The first two are diagnostics, prefixed by the caller's `notice`. The
 * question and its answer are a dialogue with the terminal, so neither
 * carries the prefix: the confirmation line is written straight to stderr.
 */
import { createInterface } from "node:readline";
import type { ConfigFile } from "./config-file.js";
import { generateEncryptionKey } from "./encryption.js";
import {
  ENCRYPTION_KEY_ENV,
  committedKeyWarning,
  isIgnoredByGit,
  resolveEncryptionKey,
  writeEncryptionKey,
} from "./encryption-key.js";

/** Ask a yes/no question; `true` only for a yes. */
export type Confirm = (question: string) => Promise<boolean>;

/**
 * A `Confirm` over any pair of streams. `question` is printed followed by
 * `[y/N] `; `y` or `yes` in any case is yes, and anything else, an empty
 * answer, end of input or Ctrl-C is no. When the input ends without an
 * answer, the prompt's line is ended so the next diagnostic starts clean.
 */
export function readlineConfirm(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Confirm {
  return (question) =>
    new Promise<boolean>((resolvePromise) => {
      const rl = createInterface({ input, output });
      let settled = false;
      const finish = (answer: boolean, endLine: boolean): void => {
        if (settled) return;
        settled = true;
        if (endLine) output.write("\n");
        rl.close();
        resolvePromise(answer);
      };
      rl.on("close", () => {
        finish(false, true);
      });
      rl.on("SIGINT", () => {
        finish(false, true);
      });
      rl.question(`${question}[y/N] `, (answer) => {
        finish(/^y(?:es)?$/i.test(answer.trim()), false);
      });
    });
}

/**
 * The terminal's `Confirm`, asking on stderr so stdout stays the report's.
 * `undefined` unless stdin and stderr are both terminals.
 */
export function terminalConfirm(): Confirm | undefined {
  // Typed `boolean`, but `undefined` on a pipe; negation covers both.
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    return undefined;
  }
  return readlineConfirm(process.stdin, process.stderr);
}

export interface EnsureKeyOptions {
  /** What must be encrypted, e.g. `/owner` or `src/limits.ts:2`. */
  subject: string;
  cwd: string;
  /** The running tool's discovered config, if any. */
  file: ConfigFile | null;
  env?: NodeJS.ProcessEnv;
  /** Injected; the CLI passes `terminalConfirm()`. Absent means no question. */
  confirm?: Confirm;
  /** A stderr diagnostic; the caller adds the `manni: ` prefix. */
  notice: (message: string) => void;
  toError: (m: string) => Error;
}

/**
 * The key a write encrypts with. The resolved one when there is one;
 * otherwise, on a terminal, a fresh key written to the config after a yes.
 *
 * With no `confirm`, or on a no, this throws the refusal and writes nothing.
 * Off a terminal the refusal is the only output: the notices lead up to a
 * question, and there is none to lead up to.
 *
 * After a write the caller's `file` is stale (its `text` and `encryptionKey`
 * predate the key): use the returned key, and rediscover before rewriting the
 * file for any other reason.
 */
export async function ensureEncryptionKey(
  opts: EnsureKeyOptions,
): Promise<{ key: string; written?: { source: string; created: boolean } }> {
  const { subject, cwd, file, confirm, notice, toError } = opts;
  const resolved = resolveEncryptionKey({ env: opts.env, file, toError });
  if (resolved.key !== undefined) return { key: resolved.key };

  const missing = `${subject} must be encrypted, and no encryption key is available.`;
  const refusal = `${missing} Run \`manni key set\`, or set ${ENCRYPTION_KEY_ENV}.`;
  if (confirm === undefined) throw toError(refusal);

  notice(missing);
  const key = generateEncryptionKey();
  // Name the target before asking about it. This also refuses a single-tool
  // file before any question is put.
  const target = await writeEncryptionKey({ file, key, cwd, toError, dryRun: true });
  if (isIgnoredByGit(target.path) === false) {
    notice(committedKeyWarning(target.source));
  }
  if (!(await confirm(`Generate a key and write it to ${target.source}? `))) {
    throw toError(refusal);
  }
  const written = await writeEncryptionKey({ file, key, cwd, toError });
  process.stderr.write(
    written.created
      ? `Created ${written.source} with an encryption key.\n`
      : `Encryption key written to ${written.source}.\n`,
  );
  return { key, written: { source: written.source, created: written.created } };
}
