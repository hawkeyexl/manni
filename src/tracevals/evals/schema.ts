/**
 * The artifact vocabulary `manni tracevals` implements:
 * `manni:artifact-evals:1.0.0-proposal.4`, the draft proposal 0023 publishes
 * for review. Artifacts are validated against the draft itself, imported from
 * `docs/proposals/` and bundled into the build, so the built CLI never reads
 * `docs/` — or any `schemas/` directory — at runtime.
 *
 * tracevals ships no copy of the schema. A copy is a second artifact to keep
 * in step with the draft, and the two it used to publish had already drifted
 * from it: they kept `eval-provenance` and the `info` severity after 0046
 * removed both. A consumer who wants to validate artifacts with
 * `manni meta validate` copies the draft into their repository, as the
 * citations vocabulary's consumers do, or validates against the object below.
 *
 * The validator is this tool's own Ajv rather than meta's `Validator`, which
 * takes refs it can load rather than a schema object. Violations are converted
 * to `FieldError` here so everything downstream — the planner, the reporters —
 * sees the one finding shape the family reports.
 */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { DefinedError, ErrorObject } from "ajv";
import type { FieldError } from "../../meta/index.js";
import schema from "../../../docs/proposals/0023/schemas/artifact-evals/1.0.0-proposal.4.json" with { type: "json" };

/** The artifact-evals draft, for validators that accept an inline schema. */
export const artifactEvalsSchema = schema as unknown as Record<string, unknown>;

/** The draft's `$id`: `manni:artifact-evals:1.0.0-proposal.4`. */
export const ARTIFACT_EVALS_SCHEMA_ID: string = schema.$id;

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
// proposal.4 marks `metadata` `x-manni-location: external` (0047). The mark is
// an annotation for `manni meta relocate`, not a constraint, so it is
// registered rather than validated — but it has to be registered, or Ajv's
// strict mode refuses to compile the draft at all.
ajv.addKeyword({ keyword: "x-manni-location" });
const validateArtifact = ajv.compile(artifactEvalsSchema);

/**
 * The stable identifier inside a violation, when its keyword names a *thing*.
 * Keywords whose parameter is a schema-authored value (`pattern`'s regex,
 * `enum`'s list) are deliberately left without one: including those would
 * change a finding's identity every time the schema author edited the rule.
 */
function subjectOf(e: DefinedError): string | undefined {
  switch (e.keyword) {
    case "required":
      return e.params.missingProperty;
    case "additionalProperties":
      return e.params.additionalProperty;
    case "format":
      return e.params.format;
    case "type":
      return e.params.type;
    default:
      return undefined;
  }
}

/**
 * Validate an artifact's whole front matter against the draft. The schema is
 * document-rooted — `metadata` stays open so other tools' members pass
 * untouched — which is why it is handed the entire object rather than the
 * `evals` value alone.
 */
export function artifactEvalsErrors(
  data: Record<string, unknown>,
  lineFor: (pointer: string) => number | undefined,
): FieldError[] {
  if (validateArtifact(data)) return [];
  const errors: FieldError[] = [];
  for (const raw of validateArtifact.errors ?? []) {
    errors.push(toFieldError(raw, lineFor));
  }
  return errors;
}

function toFieldError(
  e: ErrorObject,
  lineFor: (pointer: string) => number | undefined,
): FieldError {
  const subject = subjectOf(e as DefinedError);
  // `required` and `additionalProperties` point `instancePath` at the *parent*
  // and name the property in the message, so the property is spelled out
  // rather than left to the reader to find.
  const message =
    subject !== undefined && (e.keyword === "required" || e.keyword === "additionalProperties")
      ? `${e.message ?? "is invalid"} ("${subject}")`
      : (e.message ?? "is invalid");
  const line = lineFor(e.instancePath);
  return {
    schema: ARTIFACT_EVALS_SCHEMA_ID,
    instancePath: e.instancePath,
    message,
    keyword: e.keyword,
    ...(subject !== undefined ? { subject } : {}),
    ...(line !== undefined ? { line } : {}),
  };
}
