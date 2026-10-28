/**
 * Reading one of a Flare project's XML files: a project, a target, a variable
 * set.
 */
import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";

type XmlDocument = ReturnType<DOMParser["parseFromString"]>;
/** xmldom's `Element`, reached through the parser's own types. */
export type XmlElement = NonNullable<XmlDocument["documentElement"]>;

/**
 * The root element of `file`, or `null` when it cannot be read or is not
 * XML. Flare writes a byte order mark, which the parser does not skip.
 *
 * A damaged file reads as an empty one rather than stopping the run. What it
 * would have defined is then missing, and the run says so where that matters.
 */
export function readRoot(file: string): XmlElement | null {
  try {
    const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const doc = new DOMParser({ onError: () => undefined }).parseFromString(text, "text/xml");
    return doc.documentElement;
  } catch {
    return null;
  }
}

