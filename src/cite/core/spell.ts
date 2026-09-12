/**
 * How a citation reads on a terminal. A pin is sixty-four hex digits and a
 * ciphertext is longer still, so both are abbreviated for a person, and every
 * report and every `add` line abbreviates them the same way.
 */

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
 * `~AQx7…:2`: an encrypted source, abbreviated, with its line suffix kept. A
 * plain path is spelled in full, because that is what a reader has to find.
 */
export function shortSrc(src: string): string {
  if (!src.startsWith("~")) return src;
  const colon = src.indexOf(":");
  const token = colon === -1 ? src : src.slice(0, colon);
  const lines = colon === -1 ? "" : src.slice(colon);
  return token.length <= 5 ? src : `${token.slice(0, 5)}…${lines}`;
}
