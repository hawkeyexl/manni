/**
 * A Flare meta tag set read as a JSON Schema (proposal 0125, decision 20).
 *
 * A `.flmeta` file is accepted wherever a schema ref is. Each `<meta>` is a
 * property, every tag is a string, and an `Enum` tag matches one or more of
 * its values joined by commas, which is how Flare writes a multi-value list.
 * It also matches the empty string, which is how Flare writes a tag that is
 * not set (`content=""`).
 * Nothing is required, because Flare requires nothing, and other keys are
 * left to the other schemas of the set.
 */
import { DOMParser } from "@xmldom/xmldom";
import { DocmetaError } from "../types.js";

/** Whether a schema ref names a meta tag set, by its extension. */
export function isFlareMetaRef(ref: string): boolean {
  return /\.flmeta$/i.test(ref);
}

/** `value` as a regex literal. */
function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The JSON Schema a meta tag set's text reads as. `ref` is the schema ref as
 * written, which the refusal names.
 */
export function flareMetaSchema(text: string, ref: string): Record<string, unknown> {
  let root: ReturnType<DOMParser["parseFromString"]>["documentElement"] = null;
  try {
    // Flare writes a byte order mark, which the parser does not skip.
    root = new DOMParser({ onError: () => undefined })
      .parseFromString(text.replace(/^﻿/, ""), "text/xml").documentElement;
  } catch {
    // Not XML: there is no root element to name.
  }
  if (root?.nodeName !== "CatapultMetaTagSet") {
    throw new DocmetaError(
      `${ref} is not a Flare meta tag set: its root element is ${root?.nodeName ?? "missing"}.`,
    );
  }

  const properties: Record<string, Record<string, unknown>> = {};
  // A set's tags are the root's own children; anything nested is not one.
  for (const tag of Array.from(root.getElementsByTagName("meta")).filter((t) => t.parentNode === root)) {
    const name = tag.getAttribute("name");
    if (!name) continue;
    const property: Record<string, unknown> = { type: "string" };
    const desc = tag.getAttribute("desc");
    if (desc) property.description = desc;
    if (tag.getAttribute("type") === "Enum") {
      const values = (tag.getAttribute("enum") ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== "");
      // A list tag that lists nothing constrains nothing; an empty group would
      // match commas alone and reject every real value.
      if (values.length > 0) {
        const one = `(${values.map(escape).join("|")})`;
        property.pattern = `^(${one}(,${one})*)?$`;
      }
    }
    properties[name] = property;
  }

  const schema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
  };
  const title = root.getAttribute("name");
  if (title) schema.title = title;
  const description = root.getAttribute("desc");
  if (description) schema.description = description;
  schema.properties = properties;
  return schema;
}
