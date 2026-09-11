/**
 * Pretty output for `key set` and `key rotate`. A ciphertext is shown as `~`
 * and its first four characters, then `…`, with a citation's line suffix
 * after it: `~AQx7…`, `~AQm4…:2`. The full values are in `-f json`; the key
 * is in neither. Colour via `shouldColor`; never under `--no-color`/`NO_COLOR`.
 */
import { palette } from "../../shared/color.js";
import type { KeyRotateResult, KeySetResult, RotatedValue, SkippedValue } from "../types.js";

export interface PrettyOptions {
  color: boolean;
}

/** Said at the end of a writing rotation when a citation baseline exists. */
export const BASELINE_NOTICE =
  "The citation baseline fingerprints id-less encrypted citations by their pin; re-record it with `manni cite check --write-baseline`.";

const NARROWED =
  "Key not written: this run covered part of the family. Finish with a whole run under the same key: `manni key rotate --to <the same value>`.";
const FROM_ENV =
  "Key not written: it comes from MANNI_ENCRYPTION_KEY. Update the secret to the value you passed.";

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/** What `set` says: the file, never the key. */
export function setMessage(result: KeySetResult): string {
  return result.dryRun
    ? `Would write encryptionKey to ${result.source}.`
    : `Encryption key written to ${result.source}.`;
}

/** `~AQx7…`, and a citation's line suffix after it: `~AQm4…:2`. */
export function shortCiphertext(value: string): string {
  // base64url has no `:`, so the first one starts the line suffix.
  const colon = value.indexOf(":");
  const token = colon === -1 ? value : value.slice(0, colon);
  const suffix = colon === -1 ? "" : value.slice(colon);
  return `${token.slice(0, 5)}…${suffix}`;
}

/** A metadata value by its pointer; a citation by its id, else where it sits. */
function nameOf(row: RotatedValue | SkippedValue): string {
  if (row.kind === "metadata") return row.pointer;
  if (row.id !== undefined) return row.id;
  if (row.index !== undefined) return `/citations/${String(row.index)}`;
  return `line ${String(row.line ?? 0)}`;
}

function closing(result: KeyRotateResult): string | undefined {
  switch (result.outcome) {
    case "written":
      return result.configSource === undefined
        ? undefined
        : `Encryption key written to ${result.configSource}.`;
    case "finished":
      // Said before the counts: the key was written by the run that stopped.
      return undefined;
    case "narrowed":
      return NARROWED;
    case "env":
      return FROM_ENV;
    case "skipped":
      return result.skipped === 1
        ? "Key not written: 1 value could not be re-encrypted. Fix it and rotate again."
        : `Key not written: ${String(result.skipped)} values could not be re-encrypted. Fix them and rotate again.`;
    case "dry-run":
      return "Dry run: nothing written.";
  }
}

export function renderRotatePretty(result: KeyRotateResult, opts: PrettyOptions): string {
  const c = palette(opts.color);
  const lines: string[] = [];
  for (const page of result.pages) {
    for (const row of page.rewritten) {
      // A metadata value has no line suffix; two spaces keep its arrow in the
      // column a `:L` suffix would take.
      const gap = row.kind === "metadata" ? "  " : " ";
      lines.push(
        `${page.file}: ${nameOf(row)}  ${c.dim(shortCiphertext(row.from))}${gap}-> ${shortCiphertext(row.to)}`,
      );
    }
    for (const row of page.skipped) {
      lines.push(`${page.file}: ${nameOf(row)}  ${c.red("skipped:")} ${row.message}`);
    }
  }
  if (result.outcome === "finished" && result.configSource !== undefined) {
    lines.push(`Finished the interrupted rotation in ${result.configSource}.`);
  }
  const files = result.pages.filter((page) => page.rewritten.length > 0).length;
  lines.push(
    `${plural(result.reencrypted, "value")} re-encrypted in ${plural(files, "file")}, ${String(result.skipped)} skipped`,
  );
  const last = closing(result);
  if (last !== undefined) lines.push(result.outcome === "skipped" ? c.red(last) : last);
  if (result.baselineStale) lines.push(BASELINE_NOTICE);
  return lines.join("\n");
}
