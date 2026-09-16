/** json-output: validate the session's final assistant text as JSON. */
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import type { TraceGrader } from "./types.js";
import { rejectWhen } from "./when.js";
import { fail, finding, optionsError, pass } from "./util.js";

/**
 * One Ajv instance per compile, keyed by the schema's own text.
 *
 * A shared instance keeps every `$id` it has seen, so a schema declaring one
 * compiles on the first trace and throws `schema with key or id "…" already
 * exists` on traces 2..N — erroring every trace after the first in a batch run
 * or a `calibrate` sweep, for a schema that was correct all along. Keying the
 * cache on the schema *content* means an identical schema compiles once and a
 * different one gets a clean registry, which is the property `$id` reuse
 * actually needs.
 */
const compiled = new Map<string, ValidateFunction>();

function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  const key = JSON.stringify(schema);
  const hit = compiled.get(key);
  if (hit !== undefined) return hit;
  const built = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  compiled.set(key, built);
  return built;
}

/**
 * Shape-only. Compiling here as well would double the work for an option set
 * that `grade()` compiles anyway, and a schema that fails to compile is a
 * grade-time `error` with the compiler's own message.
 */
function validateOptions(options: Record<string, unknown>): string | undefined {
  const schema = options.schema;
  if (
    schema === undefined ||
    schema === null ||
    typeof schema !== "object" ||
    Array.isArray(schema)
  ) {
    return "options.schema is required and must be a JSON Schema object";
  }
  return rejectWhen("json-output", options);
}

export const jsonOutputGrader: TraceGrader = {
  kind: "json-output",
  validateOptions,
  grade({ trace, plan }) {
    const options = plan.options ?? {};
    const invalid = validateOptions(options);
    if (invalid !== undefined) return optionsError("json-output", invalid);
    const schema = options.schema;

    const last = trace.assistantTexts.at(-1);
    if (last === undefined) {
      return fail(plan, "session produced no assistant text to validate");
    }
    let data: unknown;
    try {
      data = JSON.parse(last);
    } catch {
      return fail(plan, "final assistant output is not valid JSON");
    }

    let validate: ValidateFunction;
    try {
      validate = compileSchema(schema as Record<string, unknown>);
    } catch (err) {
      return optionsError(
        "json-output",
        `schema failed to compile: ${(err as Error).message}`,
      );
    }
    if (validate(data)) return pass;
    return {
      findings: (validate.errors ?? []).map((e) =>
        finding(plan, `${e.instancePath || "/"} ${e.message ?? "invalid"}`),
      ),
    };
  },
};
