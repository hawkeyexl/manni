/**
 * How a value on a native metadata path is typed: the AsciiDoc header, the
 * reStructuredText docinfo field list, XML attributes and element text, and
 * HTML `<meta>` and head elements.
 *
 * Its own module rather than a copy in each reader, for the reason
 * `date-value.ts` gives: a second copy is a second chance for the readers to
 * disagree, and the disagreement would be silent.
 */
import { parse as parseYamlScalar } from "yaml";

/** Parse a raw value as a YAML scalar, falling back to the string. */
export function typeValue(raw: string): unknown {
  // An explicitly empty value (`title=""`, `content=""`) is the empty string,
  // not the YAML `null` that parsing "" would yield.
  if (raw === "") return "";
  let value: unknown;
  try {
    value = parseYamlScalar(raw);
  } catch {
    return raw;
  }
  // A collection is read only in flow style, the one style the writers emit.
  // Prose such as `Note: this` or `- a` parses as a block mapping or sequence
  // that nobody wrote, so it stays the string it reads as.
  if (typeof value === "object" && value !== null && !/^[[{]/.test(raw.trim())) {
    return raw;
  }
  return value;
}
