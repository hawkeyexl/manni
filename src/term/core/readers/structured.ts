/**
 * Readers for constructs whose parser gives structure directly: page
 * metadata through meta's extractors, manifests, DITA, DocBook, HTML, TBX, SKOS
 * and Flare glossaries.
 */
import type { TermReader } from "../../types.js";
import { ditaGlossentryReader, ditaGlossgroupReader } from "./dita.js";
import { docbookGlossaryReader } from "./docbook.js";
import { flareGlossaryReader } from "./flare-glossary.js";
import { htmlDfnReader, htmlDlReader } from "./html.js";
import { manifestReader } from "./manifest.js";
import { pageReader } from "./page.js";
import { skosReader } from "./skos.js";
import { tbxEntryReader } from "./tbx.js";

export const STRUCTURED_READERS: readonly TermReader[] = [
  pageReader,
  manifestReader,
  ditaGlossentryReader,
  ditaGlossgroupReader,
  docbookGlossaryReader,
  htmlDlReader,
  htmlDfnReader,
  tbxEntryReader,
  skosReader,
  flareGlossaryReader,
];
