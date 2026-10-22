/**
 * How a citation reads on a terminal. A pin is sixty-four hex digits and a
 * ciphertext is longer still, so both are abbreviated for a person, and every
 * report and every `add` line abbreviates them the same way.
 */
import type { PageLines } from "../types.js";

/** `sha256-78af1d33…`, `hmac-sha256-5e0c1a2b…`: the prefix and eight hex digits. */
export function shortPin(integrity: string): string {
  const m = /^((?:hmac-)?sha256-)([0-9a-f]{8})/i.exec(integrity);
  const prefix = m?.[1];
  const digits = m?.[2];
  if (prefix === undefined || digits === undefined) return integrity;
  return `${prefix}${digits}…`;
}

/** The seven characters a person reads a commit by. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/**
 * `~AQx7…:2`, `sdk:~AQx7…:2`: an encrypted source, abbreviated, with its repo
 * and line suffix kept. A plain path is spelled in full, because that is what
 * a reader has to find.
 */
export function shortSrc(src: string): string {
  const m = /^((?:[a-z0-9][a-z0-9-]*:)?)(~[^:]*)(.*)$/.exec(src);
  const repo = m?.[1];
  const token = m?.[2];
  const lines = m?.[3];
  if (repo === undefined || token === undefined || lines === undefined || token.length <= 5) return src;
  return `${repo}${token.slice(0, 5)}…${lines}`;
}

/** The widest a quoted line of a file is printed at. */
const LINE_WIDTH = 60;

/**
 * A line of a file as a report quotes it: whitespace collapsed to single
 * spaces, then sixty characters and an ellipsis. The report is one line, so
 * neither an indented source line nor a long one decides how it reads.
 */
export function shortLine(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= LINE_WIDTH ? one : `${one.slice(0, LINE_WIDTH)}…`;
}

/**
 * `line 9`, or `lines 9-12`: where on a page a span sits. Every refusal,
 * report and message that names one reads it this way, so `add`, `update`
 * and the reporters spell it once.
 */
export function spellAt(lines: PageLines): string {
  return lines.start === lines.end
    ? `line ${String(lines.start)}`
    : `lines ${String(lines.start)}-${String(lines.end)}`;
}

/** `a`, `a and b`, `a, b and c`: a list as a sentence reads it, or with `or`. */
export function listOf(values: readonly string[], conjunction: "and" | "or" = "and"): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} ${conjunction} ${values[values.length - 1] ?? ""}`;
}
