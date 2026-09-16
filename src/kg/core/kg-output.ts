/**
 * `x-manni-kg-output` (proposal 0051 §5), on kg's side of the seam.
 *
 * Which fields belong in a published graph is a property of the field, not of
 * this tool, so it is recorded where the field is defined. The keyword is a
 * boolean beside a top-level property, registered on every Ajv `manni meta`
 * builds and read back through `Validator.kgOutputPreferences`. Absent means
 * `true`: every field is harvested. A mark nested inside `kg` is ignored, as
 * 0047 rule 2 ignores an `x-manni-location` there — the mark governs a
 * top-level key, and `kg` is the top-level key.
 *
 * The filter runs once, before `deriveGraph`, because all four published
 * outputs descend from what derivation produces: `emitTurtle` writes the graph,
 * and JSON-LD, the iiRDS package and the search index are all built by reading
 * that graph back. Dropping the field here keeps it out of every one of them.
 *
 * Encrypted values (proposal 0045) are harvested like any other value. kg
 * never decrypts, so what lands in the graph is the `~…` token, which says a
 * value exists and nothing about what it is. A field that should not reach a
 * published graph at all is marked `false` — one mechanism for "keep this out
 * of the output", rather than one rule for encryption and another for
 * everything else (0051 stress test 4).
 */
import { Validator } from "../../meta/index.js";
import { errorMessage } from "../../shared/errors.js";
import { FRONTMATTER_SCHEMA_ID, frontmatterSchema } from "../schema.js";
import { KgError } from "../types.js";
import type { KgConfig } from "./config.js";
import type { DocModel } from "../types.js";

/**
 * The schema set a page is judged by, as kg spells it: the operator's
 * `validate.schemas` when they set one, else the bundled draft.
 *
 * The draft is handed over as an object rather than by ref. 0023's ids are
 * unregistered on purpose while the vocabulary is under review, so
 * `manni:kg:1.0.0-proposal.3` resolves to nothing a user could type — which is
 * exactly what `LoadSchemaOptions.inlineSchemas` is for.
 */
function schemaRefs(config: KgConfig): string[] {
  return config.validate.schemas.length > 0
    ? config.validate.schemas
    : [FRONTMATTER_SCHEMA_ID];
}

/**
 * `docs`, with every top-level frontmatter key its schemas mark
 * `x-manni-kg-output: false` removed.
 *
 * A document whose schemas mark nothing is returned as it came in, so the
 * common case allocates nothing and the derived graph is bit-for-bit what it
 * was before this existed.
 */
export async function suppressKgOutput(
  docs: readonly DocModel[],
  config: KgConfig,
  cwd: string,
): Promise<DocModel[]> {
  const refs = schemaRefs(config);
  const validator = new Validator({
    fileBase: cwd,
    inlineSchemas: new Map([[FRONTMATTER_SCHEMA_ID, frontmatterSchema]]),
  });

  const out: DocModel[] = [];
  for (const doc of docs) {
    let preferences: Map<string, boolean>;
    try {
      preferences = await validator.kgOutputPreferences(doc.frontmatter, refs);
    } catch (e) {
      // Loudly, and for the whole run. The schema is what decides which fields
      // a published graph may carry; a graph built while it could not be read
      // is a graph nobody checked, and quietly building one is the failure
      // this keyword exists to prevent.
      throw new KgError(
        `${doc.path}: cannot read which fields the graph may carry — ${errorMessage(e)}`,
      );
    }

    const suppressed = [...preferences]
      .filter(([, allowed]) => !allowed)
      .map(([key]) => key);
    if (suppressed.length === 0) {
      out.push(doc);
      continue;
    }

    const frontmatter: Record<string, unknown> = { ...doc.frontmatter };
    for (const key of suppressed) delete frontmatter[key];
    out.push({ ...doc, frontmatter });
  }
  return out;
}
