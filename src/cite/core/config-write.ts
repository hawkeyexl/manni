/**
 * Writing `cite.salt` back into the family file, in place.
 *
 * `parseDocument` keeps comments and key order, as meta's `schemas vendor`
 * relies on, so a documented config comes back documented. Only the one
 * scalar is set; the `cite:` section is created when the file has none. The
 * result is re-read the way the loader reads it before it reaches disk,
 * because a config the tool itself cannot read is worse than a refused write.
 */
import { parseDocument, parse as parseYaml } from "yaml";
import { writeFileAtomic } from "../../meta/index.js";
import type { ConfigFile } from "../../shared/config-file.js";
import { CiteError } from "../errors.js";
import { CITE_SECTION, parseCiteConfig } from "./config.js";

/** The file's text with `cite.salt` set to `salt`, comments and other keys kept. */
export function writeConfigSalt(file: ConfigFile, salt: string): string {
  const doc = parseDocument(file.text);
  // An explicit `-c` file with no `cite:` key is read whole as the section
  // (see `readConfigFile`), so its salt sits at the top level.
  const path = file.wrapped ? [CITE_SECTION, "salt"] : ["salt"];
  // An empty section (`cite:` with nothing under it) is a null scalar, which
  // `setIn` cannot descend into; replace it with the one-key mapping instead.
  if (file.wrapped && doc.getIn([CITE_SECTION]) === null) {
    doc.setIn([CITE_SECTION], { salt });
  } else {
    doc.setIn(path, salt);
  }
  const text = doc.toString();

  // Read back what is about to be written, through the tool's own parser.
  const raw: unknown = parseYaml(text);
  const slice =
    file.wrapped && raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)[CITE_SECTION]
      : raw;
  if (parseCiteConfig(slice, file.source).salt !== salt) {
    throw new CiteError(`Could not write cite.salt to ${file.source}; add the key by hand.`);
  }
  return text;
}

/** Write `cite.salt` into the file on disk, atomically. Returns the new text. */
export async function writeSaltToConfig(file: ConfigFile, salt: string): Promise<string> {
  const text = writeConfigSalt(file, salt);
  await writeFileAtomic(file.path, text);
  return text;
}
