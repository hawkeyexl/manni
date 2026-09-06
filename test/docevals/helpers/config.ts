/**
 * Test helper for building configs against the shared moose config file.
 *
 * `manni.config.yaml` is shared by the whole tool family, so a docevals config
 * lives under a `docevals:` key rather than at the root. Tests care about the
 * settings, not the nesting, so they write a bare docevals body and this helper
 * indents it into place. Keeping that in one spot means the namespace can move
 * without touching every test.
 *
 * `test/unit/config.test.ts` deliberately does *not* use this — it pins the
 * file contract itself, including the root-level behavior.
 */
import { parseConfig, type DocevalsConfig } from "../../../src/docevals/core/config.js";

export const FAKE_CONFIG_PATH = "/fake/manni.config.yaml";

/** Nest a bare docevals config body under the `docevals:` namespace key. */
export function nestUnderDocevals(body: string): string {
  const indented = body
    .split("\n")
    .map((line) => (line.trim() === "" ? line : `  ${line}`))
    .join("\n");
  return `docevals:\n${indented}\n`;
}

/** Parse a bare docevals config body as if it were a `manni.config.yaml`. */
export function parseDocevalsConfig(
  body: string,
  configPath: string = FAKE_CONFIG_PATH,
): DocevalsConfig {
  return parseConfig(nestUnderDocevals(body), configPath);
}
