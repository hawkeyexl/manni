/**
 * A violation's **rule identity**, shared by the SARIF `ruleId` and the JUnit
 * `<failure type>`.
 *
 * Built from `schema` + `keyword` and nothing else. `message` is Ajv-generated
 * prose, so a rule id derived from it would rename itself on any Ajv upgrade
 * and every historical alert in the consumer would close and reopen as new.
 * That is the same reasoning `src/core/baseline.ts` applies to fingerprints,
 * and for the same reason: these are the durable half of a violation.
 */
import type { FieldError } from "../types.js";
import { canonicalSchemaRef, type FingerprintContext } from "../core/baseline.js";

/** The `schema` label the command layer stamps on its own failures. */
const SYNTHETIC_SCHEMA = "(parse)";

/** A document whose metadata block could not be parsed. */
export const PARSE_ERROR_RULE = "manni/parse-error";

/** A document no schema set could be resolved for. */
export const SCHEMA_ERROR_RULE = "manni/schema-error";

/**
 * A document carrying a key a manifest owns (proposal 0037). Not a
 * synthetic-schema special case: `external:owned` is a builtin-shaped ref
 * like `check:<name>`, so the ordinary join produces this id.
 */
export const EXTERNAL_OWNED_RULE = "external:owned/external";

/**
 * Two documents carry the same value of a manifest's join field (proposal
 * 0039), so one manifest entry matched both.
 */
export const EXTERNAL_DUPLICATE_RULE = "external:duplicate/external";

/** What each reserved rule means, for the consumer's rule listing. */
export const RESERVED_RULES: Record<string, string> = {
  [PARSE_ERROR_RULE]: "The document's metadata block could not be parsed.",
  [SCHEMA_ERROR_RULE]: "No schema set could be resolved for the document.",
  [EXTERNAL_OWNED_RULE]:
    "The document carries a key a manifest owns; the manifest is the only place that key may be set.",
  [EXTERNAL_DUPLICATE_RULE]:
    "Two documents carry the same value of a manifest's join field, so one manifest entry matched both.",
};

/**
 * The rule id for one violation.
 *
 * docmeta's own failures carry `schema: "(parse)"` and no real keyword, so the
 * naive join yields `(parse)/parse` — a rule id that names an implementation
 * detail and reads as garbage in a security tab. They get reserved ids instead.
 *
 * With a `frame`, the schema reference is canonicalized exactly as a
 * fingerprint's is, so a local-file schema does not produce one rule id from
 * the repository root and a different, machine-specific one from `docs/`.
 */
export function ruleIdFor(e: FieldError, frame?: FingerprintContext): string {
  if (e.schema === SYNTHETIC_SCHEMA) {
    if (e.keyword === "parse") return PARSE_ERROR_RULE;
    if (e.keyword === "schema") return SCHEMA_ERROR_RULE;
  }
  return `${canonicalSchemaRef(e.schema, frame)}/${e.keyword}`;
}

/** `""` is the whole document; every reporter spells that the same way. */
export function fieldLabel(instancePath: string): string {
  return instancePath === "" ? "(root)" : instancePath;
}
