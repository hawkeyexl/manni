/**
 * Every term reader, in the order `term formats` lists them. Split across two
 * files by how a construct is parsed, so the two groups change independently.
 */
import type { TermConstruct, TermReader } from "../../types.js";
import { STRUCTURED_READERS } from "./structured.js";
import { TEXT_READERS } from "./text.js";

export const TERM_READERS: readonly TermReader[] = [...STRUCTURED_READERS, ...TEXT_READERS];

/** The readers offered a file of `format`. */
export function readersForFormat(
  format: string,
  readers: readonly TermReader[] = TERM_READERS,
): TermReader[] {
  return readers.filter((reader) => reader.formats.includes(format));
}

/** The one reader for a construct, which is the one that writes it back in place. */
export function readerForConstruct(
  construct: TermConstruct,
  readers: readonly TermReader[] = TERM_READERS,
): TermReader | undefined {
  return readers.find((reader) => reader.construct === construct);
}
