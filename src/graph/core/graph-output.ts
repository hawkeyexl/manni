/**
 * `x-manni-graph-output` (proposal 0051 §5), on graph's side of the seam.
 *
 * Which fields belong in a published graph is a property of the field, not of
 * this tool, so it is recorded where the field is defined. The keyword is a
 * boolean beside a top-level property, registered on every Ajv `manni meta`
 * builds and read back through `Validator.graphOutputPreferences`. Absent means
 * `true`: every field is harvested. A mark nested inside `graph` is ignored, as
 * 0047 rule 2 ignores an `x-manni-location` there — the mark governs a
 * top-level key, and `graph` is the top-level key.
 *
 * The filter runs once, before `deriveGraph`, because all four published
 * outputs descend from what derivation produces: `emitTurtle` writes the graph,
 * and JSON-LD, the iiRDS package and the search index are all built by reading
 * that graph back. Dropping the field here keeps it out of every one of them.
 *
 * Encrypted values (proposal 0045) are harvested like any other value. graph
 * never decrypts, so what lands in the graph is the `~…` token, which says a
 * value exists and nothing about what it is. A field that should not reach a
 * published graph at all is marked `false` — one mechanism for "keep this out
 * of the output", rather than one rule for encryption and another for
 * everything else (0051 stress test 4).
 */
import { metaSchemaSets } from "../../meta/internal.js";
import { errorMessage } from "../../shared/errors.js";
import { GraphError } from "../types.js";
import type { DocModel } from "../types.js";

/** Which config a build runs under, as its flags said. */
export interface GraphOutputSource {
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`. */
  noConfig?: boolean;
}

/**
 * `docs`, with every top-level frontmatter key its schemas mark
 * `x-manni-graph-output: false` removed.
 *
 * A page's schemas are the set `manni meta validate` resolves for it (proposal
 * 0074): its own `$schema`, then meta's overrides, `schemas:`, `strict` and
 * the default set, read from meta's section of the same config. graph keeps
 * no schema set of its own, so one config answers both what a page is checked
 * against and what its published graph may carry.
 *
 * A document whose schemas mark nothing is returned as it came in, so the
 * common case allocates nothing.
 */
export async function suppressGraphOutput(
  docs: readonly DocModel[],
  source: GraphOutputSource,
  cwd: string,
): Promise<DocModel[]> {
  let sets: Awaited<ReturnType<typeof metaSchemaSets>>;
  try {
    sets = await metaSchemaSets({
      cwd,
      ...(source.configPath === undefined ? {} : { configPath: source.configPath }),
      ...(source.noConfig === undefined ? {} : { noConfig: source.noConfig }),
    });
  } catch (e) {
    throw new GraphError(`cannot read which fields the graph may carry: ${errorMessage(e)}`);
  }

  const out: DocModel[] = [];
  for (const doc of docs) {
    let preferences: Map<string, boolean>;
    try {
      const refs = sets.refsFor(doc.path, doc.frontmatter);
      preferences = await sets.validator.graphOutputPreferences(doc.frontmatter, refs);
    } catch (e) {
      // Loudly, and for the whole run. The schema is what decides which fields
      // a published graph may carry; a graph built while it could not be read
      // is a graph nobody checked, and quietly building one is the failure
      // this keyword exists to prevent.
      throw new GraphError(
        `${doc.path}: cannot read which fields the graph may carry: ${errorMessage(e)}`,
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
    for (const key of suppressed) Reflect.deleteProperty(frontmatter, key);
    out.push({ ...doc, frontmatter });
  }
  return out;
}
