/**
 * Which config file `manni key` reads and writes. `key` has no section of its
 * own (proposal 0045): the key it manages sits at the top of the family file,
 * beside `collections:`.
 *
 * - `set` writes the nearest family file whatever it carries, or the one `-c`
 *   names, read as a family file (`findFamilyConfigFile`,
 *   `readFamilyConfigFile`).
 * - `rotate` reads its key and collections from the file every sibling
 *   without a section there would read them from: the nearest family file
 *   carrying `collections:` or `encryptionKey:`. That is discovery with a
 *   section name nothing uses.
 */
import {
  findConfigFile,
  findFamilyConfigFile,
  readConfigFile,
  readFamilyConfigFile,
  type ConfigFile,
  type ConfigFileOptions,
} from "../../shared/config-file.js";
import { KeyError } from "../errors.js";

export const toKeyError = (message: string): KeyError => new KeyError(message);

const KEY_CONFIG: ConfigFileOptions = {
  section: "key",
  // The key never had a file of its own.
  legacyNames: [],
  toError: toKeyError,
};

/** The config `rotate` reads the current key and the collections from. */
export function readRotateConfig(
  configPath: string | undefined,
  cwd: string,
): Promise<ConfigFile | null> {
  return configPath === undefined
    ? findConfigFile(cwd, KEY_CONFIG)
    : readConfigFile(configPath, cwd, KEY_CONFIG);
}

/** The config `set` writes to; `null` when discovery finds no family file. */
export function readSetConfig(
  configPath: string | undefined,
  cwd: string,
): Promise<ConfigFile | null> {
  return configPath === undefined
    ? findFamilyConfigFile(cwd, toKeyError)
    : readFamilyConfigFile(configPath, cwd, toKeyError);
}

/** The refusal while `encryptionKeyPrevious:` says a rotation is unfinished. */
export const unfinishedRotation = (source: string): string =>
  `A rotation is unfinished in ${source}. Run \`manni key rotate\` with no --to to finish it.`;
