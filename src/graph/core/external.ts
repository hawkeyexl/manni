/**
 * A page's metadata as `manni meta validate` reads it: its frontmatter, plus
 * every key an external-metadata manifest of one of its collections owns
 * (proposals 0037, 0041, 0047, 0058 and 0068).
 *
 * A corpus that keeps `owner`, `last-updated` or `meta-provenance` in a
 * `{page}.meta.yaml` beside each page would otherwise read to graph as a set
 * of pages that declare none of them. So graph reads through meta's merge,
 * not a loader of its own: the join, ownership and keyless-manifest rules are
 * the ones `meta validate` applies, and so are its refusals, which reach the
 * user in meta's words and exit 2.
 *
 * The config is meta's section of the file the run is under, the same one
 * graph already reads the output marks from (proposal 0074). `--no-config`
 * declares no collection, so no manifest is read, exactly as meta reads none.
 * A page read from stdin belongs to no collection, so no manifest supplies it.
 *
 * Encrypted values (proposal 0045) are merged as the manifest holds them.
 * graph never decrypts, so the graph carries the `~…` token.
 */
import { resolve } from "node:path";
import { metaPageView, type MetaPageView } from "../../meta/internal.js";
import { errorMessage } from "../../shared/errors.js";
import { GraphError, type DocModel } from "../types.js";
import type { DocFormat } from "./analyze.js";
import { STDIN_PATH } from "./iri.js";

/** Which config a run reads meta's section of, as its flags said. */
export interface MetaViewSource {
  /** `-c/--config`. */
  configPath?: string;
  /** `--no-config`. */
  noConfig?: boolean;
}

/**
 * Meta's view of the run's pages. `paths` are the run's documents relative
 * to `base` (`documentBase`), and the view's labels are too. `-c` stays
 * relative to `cwd`, where it was typed. A `{page}` manifest is read for
 * exactly these. A manifest meta refuses is refused here in meta's sentence,
 * as an operational error.
 */
export async function openMetaView(
  source: MetaViewSource,
  cwd: string,
  paths: readonly string[],
  base = cwd,
): Promise<MetaPageView> {
  try {
    return await metaPageView({
      cwd: base,
      ...(source.configPath === undefined
        ? {}
        : { configPath: resolve(cwd, source.configPath) }),
      ...(source.noConfig === undefined ? {} : { noConfig: source.noConfig }),
      pages: paths.filter((p) => p !== STDIN_PATH).map((p) => resolve(base, p)),
    });
  } catch (e) {
    throw new GraphError(errorMessage(e));
  }
}

/** A page's own metadata and what its manifests add to it. */
export interface MergedPage {
  /** The page's metadata with every manifest-supplied key in place. */
  data: Record<string, unknown>;
  /** The top-level keys a manifest supplied, with their merged values. */
  supplied: Record<string, unknown>;
}

/** The `/key` pointer of a top-level key, RFC 6901 escaped. */
function pointerOf(key: string): string {
  return `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

/**
 * Merge one page's frontmatter with its manifests. `present` is whether the
 * page has a frontmatter block at all, and `format` is what graph parsed it as.
 */
export async function mergePage(
  view: MetaPageView,
  path: string,
  frontmatter: Record<string, unknown>,
  present: boolean,
  format: DocFormat,
): Promise<MergedPage> {
  let merged;
  try {
    merged = await view.merge(path, {
      data: frontmatter,
      present,
      format,
      lineFor: () => undefined,
    });
  } catch (e) {
    throw new GraphError(errorMessage(e));
  }
  const data = merged.extracted.data;
  const supplied: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (merged.locate(pointerOf(key)) !== undefined) supplied[key] = data[key];
  }
  return { data, supplied };
}

/** `docs`, each with its manifests' values merged into its frontmatter. */
export async function withExternalMetadata(
  docs: readonly DocModel[],
  view: MetaPageView,
): Promise<DocModel[]> {
  const out: DocModel[] = [];
  for (const doc of docs) {
    const { data } = await mergePage(
      view,
      doc.path,
      doc.frontmatter,
      doc.frontmatterPresent,
      doc.format,
    );
    // A run with no manifest hands the page's own object back, so the common
    // case allocates nothing.
    out.push(data === doc.frontmatter ? doc : { ...doc, frontmatter: data });
  }
  return out;
}
