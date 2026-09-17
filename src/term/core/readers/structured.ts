/**
 * Readers for constructs whose parser gives structure directly: page
 * metadata through meta's extractors, manifests, DITA, DocBook and HTML.
 */
import type { TermReader } from "../../types.js";
import { ditaGlossentryReader, ditaGlossgroupReader } from "./dita.js";
import { docbookGlossaryReader } from "./docbook.js";
import { htmlDfnReader, htmlDlReader } from "./html.js";
import { manifestReader } from "./manifest.js";
import { pageReader } from "./page.js";

export const STRUCTURED_READERS: readonly TermReader[] = [
  pageReader,
  manifestReader,
  ditaGlossentryReader,
  ditaGlossgroupReader,
  docbookGlossaryReader,
  htmlDlReader,
  htmlDfnReader,
];
