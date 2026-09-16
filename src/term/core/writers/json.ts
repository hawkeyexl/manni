/**
 * `term write -f json`: the set as `{ "terms": [...] }`, one object per term
 * holding its id, its language when it has one, and every record field in the
 * vocabulary's order. It is the shape `term list -f json` prints, so it holds
 * every field.
 */
import { TERM_FIELDS, type TermShape, type TermWriter } from "../../types.js";
import { droppedFields, requireShape } from "./render-util.js";

export const jsonWriter: TermWriter = {
  format: "json",
  shapes: ["file"],
  holds: (_shape: TermShape) => TERM_FIELDS,
  render(terms, target) {
    requireShape("json", target, "file");
    const entries = terms.map((term) => {
      const entry: Record<string, unknown> = { id: term.id };
      if (term.language !== undefined) entry["language"] = term.language;
      for (const field of TERM_FIELDS) {
        const value = term.record[field];
        if (value !== undefined) entry[field] = value;
      }
      return entry;
    });
    const content = `${JSON.stringify({ terms: entries }, null, 2)}\n`;
    return {
      files: [{ path: target.path, content }],
      removals: [],
      dropped: droppedFields(terms, TERM_FIELDS),
      skipped: [],
    };
  },
};
