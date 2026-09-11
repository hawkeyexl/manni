/**
 * `manni key set [value]`: write the family encryption key (proposal 0045).
 *
 * Refusals, each exit 2 and none echoing a value: a value of the wrong shape;
 * `MANNI_ENCRYPTION_KEY` set, because it wins and the written key would never
 * be read; a rotation left unfinished; a key already configured, because
 * replacing one in place strands every value encrypted under it (`rotate` is
 * what replaces a key); and a new `manni.config.yaml` beside a legacy
 * `docmeta.config.yaml`, which the new file would hide from `manni meta`.
 *
 * It warns, and still writes, when git would publish the file.
 */
import { existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { LEGACY_CONFIG_NAMES } from "../../meta/internal.js";
import {
  ENCRYPTION_KEY_ENV,
  committedKeyWarning,
  isIgnoredByGit,
  writeEncryptionKey,
} from "../../shared/encryption-key.js";
import { generateEncryptionKey, isValidEncryptionKey } from "../../shared/encryption.js";
import { readSetConfig, toKeyError, unfinishedRotation } from "../core/config.js";
import { KeyError } from "../errors.js";
import type { KeySetOptions, KeySetResult } from "../types.js";

const BAD_VALUE =
  "The key must be at least 32 hex or base64url characters. Run `manni key set` with no value to generate one.";
const ENV_SET = `${ENCRYPTION_KEY_ENV} is set, so a key written to config would never be read. Unset it, or keep the key in the secret.`;

const alreadyConfigured = (source: string): string =>
  `An encryption key is already configured in ${source}. Run \`manni key rotate\` to replace it and re-encrypt every value.`;

/**
 * A new family file beside a legacy per-tool file hides it: discovery reads
 * the family file first in a directory, and one holding only a key is every
 * tool's config, so `manni meta` would stop reading the options it had.
 */
function refuseBesideLegacy(path: string, cwd: string): void {
  const dir = dirname(path);
  const name = basename(path);
  for (const legacy of LEGACY_CONFIG_NAMES) {
    const found = join(dir, legacy);
    if (!existsSync(found)) continue;
    const source = relative(cwd, found).replace(/\\/g, "/");
    throw new KeyError(
      `${source} is a single-tool config; a ${name} beside it would hide it. Move its keys under meta: in ${name} first.`,
    );
  }
}

export async function runKeySet(opts: KeySetOptions): Promise<KeySetResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const env = opts.env ?? process.env;
  if (opts.value !== undefined && !isValidEncryptionKey(opts.value)) {
    throw new KeyError(BAD_VALUE);
  }
  // Empty counts as unset, as `resolveEncryptionKey` has it.
  const fromEnv = env[ENCRYPTION_KEY_ENV];
  if (fromEnv !== undefined && fromEnv !== "") throw new KeyError(ENV_SET);

  const file = await readSetConfig(opts.configPath, cwd);
  if (file?.encryptionKeyPrevious !== undefined) {
    throw new KeyError(unfinishedRotation(file.source));
  }
  if (file?.encryptionKey !== undefined) {
    throw new KeyError(alreadyConfigured(file.source));
  }

  const generated = opts.value === undefined;
  const key = opts.value ?? generateEncryptionKey();
  const dryRun = opts.dryRun === true;
  // Name the target before writing to it: the legacy check and the git
  // warning are both about the file the key is about to land in.
  const target = await writeEncryptionKey({ file, key, cwd, toError: toKeyError, dryRun: true });
  if (target.created) refuseBesideLegacy(target.path, cwd);
  if (isIgnoredByGit(target.path) === false) {
    opts.onNotice?.(committedKeyWarning(target.source));
  }
  if (!dryRun) await writeEncryptionKey({ file, key, cwd, toError: toKeyError });
  return { path: target.path, source: target.source, created: target.created, generated, dryRun };
}
