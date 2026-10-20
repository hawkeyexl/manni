/**
 * `manni meta schemas show` output (proposal 0089): an outline of what a
 * schema asks for, the schema as loaded, or a frontmatter skeleton to start
 * a page from.
 */
import type { ShownProperty, ShownSchema } from "../commands/schemas.js";
import { firstSentence } from "../core/guidance.js";
import { formatList } from "./index.js";

export const SHOW_FORMATS = ["pretty", "json", "markdown"] as const;
export type ShowFormat = (typeof SHOW_FORMATS)[number];

/** `"pretty, json, or markdown"`, for messages and help text. */
export const SHOW_FORMAT_LIST = formatList(SHOW_FORMATS);

export function isShowFormat(value: string): value is ShowFormat {
  return (SHOW_FORMATS as readonly string[]).includes(value);
}

/** `required, string or array, minLength 1`: the facts after a property's key. */
function facts(p: ShownProperty): string {
  return [
    p.required ? "required" : "optional",
    ...(p.types.length > 0 ? [p.types.join(" or ")] : []),
    ...(p.values !== undefined ? [`one of: ${p.values.map((v) => JSON.stringify(v)).join(", ")}`] : []),
    ...(p.format !== undefined ? [`format ${p.format}`] : []),
    ...(p.pattern !== undefined ? [`pattern /${p.pattern}/`] : []),
    ...p.bounds.map(([k, n]) => `${k} ${String(n)}`),
  ].join(", ");
}

function pretty(s: ShownSchema): string {
  const lines = [s.title === null ? s.id : `${s.id}  ${s.title}`];
  if (s.description !== null) lines.push(s.description);
  if (s.guide !== null) lines.push(`Guide: ${s.guide}`);
  lines.push("");
  for (const p of s.properties) {
    lines.push(`  ${p.key}  ${facts(p)}`);
    if (p.description !== null) lines.push(`    ${p.description}`);
  }
  return `${lines.join("\n")}\n`;
}

/** A key as YAML reads it back: bare when it is plainly a name, else quoted. */
const yamlKey = (key: string): string => (/^[A-Za-z0-9_.-]+$/.test(key) ? key : JSON.stringify(key));

function markdown(s: ShownSchema): string {
  const lines = ["---", s.title === null ? `# ${s.id}` : `# ${s.id}, ${s.title}`];
  if (s.guide !== null) lines.push(`# Guide: ${s.guide}`);
  for (const p of s.properties) {
    if (p.external) continue;
    if (p.description !== null) lines.push(`# ${firstSentence(p.description)}`);
    const first = p.values?.[0];
    const value = p.values === undefined ? "" : ` ${JSON.stringify(first)}`;
    lines.push(`${p.required ? "" : "# "}${yamlKey(p.key)}:${value}`);
  }
  lines.push("---");
  return `${lines.join("\n")}\n`;
}

export function renderSchemaShow(s: ShownSchema, format: ShowFormat): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(s.schema, null, 2)}\n`;
    case "markdown":
      return markdown(s);
    case "pretty":
      return pretty(s);
  }
}
