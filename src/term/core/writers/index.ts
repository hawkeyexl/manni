/** Every term writer, one per `term write -f` value. */
import type { TermWriteFormat, TermWriter } from "../../types.js";
import { DOCUMENT_WRITERS } from "./documents.js";
import { INTERCHANGE_WRITERS } from "./interchange.js";

export const TERM_WRITERS: readonly TermWriter[] = [...DOCUMENT_WRITERS, ...INTERCHANGE_WRITERS];

export function writerFor(
  format: TermWriteFormat,
  writers: readonly TermWriter[] = TERM_WRITERS,
): TermWriter | undefined {
  return writers.find((writer) => writer.format === format);
}
