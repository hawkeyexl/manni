/**
 * JSON output for `key rotate`: every page and every local external-metadata
 * manifest with something encrypted in it, each value's full ciphertext
 * before and after, and the counts. The key is never in it.
 */
import type { KeyRotateResult } from "../types.js";

export function renderRotateJson(result: KeyRotateResult): string {
  return JSON.stringify(
    {
      pages: result.pages,
      manifests: result.manifests,
      reencrypted: result.reencrypted,
      skipped: result.skipped,
      keyWritten: result.keyWritten,
    },
    null,
    2,
  );
}
