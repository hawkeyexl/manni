/**
 * Where docevals writes each key it owns (proposal 0047, §3 and §4).
 *
 * Chunk 1 made reading follow a key's location: a manifest that owns `evals`
 * supplies them, and everything downstream sees them as the page's own. A
 * tool that reads that way and writes to the page anyway puts the value in
 * two places at once, which `meta validate` then reports as an
 * `external:owned` collision on every page it touched.
 *
 * So every write goes through the rule `manni meta fill` already follows:
 *
 *  - a **local manifest** of one of the page's collections owns the key: the
 *    value is spliced into the page's entry there, and nothing else in the
 *    file changes;
 *  - the manifest **joins on a field the page lacks**: there is no entry to
 *    hold the value, and the write is refused for that file, in meta's own
 *    sentence;
 *  - a **URL manifest** owns it: nothing can be written to a fetched file,
 *    and for an eval key that is the refusal chunk 1 already makes at load;
 *  - **no manifest owns it**: the page keeps it, with the offer (P1) and the
 *    warnings (W1, W2) meta's writers use when the schema prefers external
 *    metadata.
 *
 * The rule is meta's, and so is every helper that decides it: `keyHome`,
 * `offerExternalHomes`, `externalWriteWarnings` and `spliceManifestValue`,
 * all reached through `src/meta/internal.ts`. What is docevals' own is the
 * preference, which comes from the evals draft rather than from a validator:
 * the vocabulary this tool implements marks its three keys, so the answer is
 * in the schema docevals already bundles.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LOCATION_KEYWORD,
  Validator,
  writeFileAtomic,
} from "../../meta/index.js";
import {
  externalWriteWarnings,
  keyHome,
  offerExternalHomes,
  readManifestValue,
  spliceManifestValue,
  type ExternalWrite,
  type ProposedHome,
  type RelocateResult,
  type RelocationContext,
} from "../../meta/internal.js";
import { isMissing } from "../../shared/manifest-cas.js";
import type { Confirm } from "../../shared/prompt.js";
import { errorMessage } from "../../shared/errors.js";
import { DocevalsError } from "../types.js";
import { frontmatterSchema } from "../schema.js";
import type { DocevalsConfig } from "./config.js";
import { urlManifestRefusal } from "./external.js";

/** The page key holding the eval list, the one docevals appends to and edits. */
export const EVALS_KEY = "evals";

/** The key `fill` records machine-proposed evals in (proposal 0046). */
export const META_PROVENANCE_KEY = "meta-provenance";

/**
 * Whether the evals draft marks `key` as belonging in external metadata.
 *
 * Read from the bundled draft rather than from a resolved schema set. Every
 * docevals page is validated against that draft (`core/resolve.ts`), so it is
 * the schema that governs these keys, and a preference read from it cannot
 * disagree with the one `meta validate` reads. A key the draft does not mark
 * stays on the page with no warning.
 */
export function prefersExternal(key: string): boolean {
  const properties = frontmatterSchema.properties;
  if (typeof properties !== "object" || properties === null) return false;
  const property = (properties as Record<string, unknown>)[key];
  if (typeof property !== "object" || property === null) return false;
  return (property as Record<string, unknown>)[LOCATION_KEYWORD] === "external";
}

/** Where one key of one page goes. */
export type WriteHome =
  /** The page's own frontmatter. `proposed` is the home relocation would give it. */
  | { kind: "page"; prefersExternal: boolean; proposed: ProposedHome }
  /** The page's entry in a local manifest. */
  | {
      kind: "manifest";
      /** As the run reports it. */
      file: string;
      absPath: string;
      /** `path`, or the page field the manifest joins on. */
      join: string;
      entry: string;
      /**
       * The manifest is the page's own, resolved from a `{page}` pattern
       * (proposal 0058). It may not exist yet: the first write creates it,
       * and a read of it before then holds nothing.
       */
      perPage: boolean;
    }
  /** A manifest joins on a field this page does not carry. */
  | { kind: "no-entry"; message: string }
  /** A URL manifest owns the key; nothing fetched can be written. */
  | { kind: "url"; collection: string; file: string };

/** meta's sentence for a page a joined manifest has no entry for. */
export function noEntryMessage(
  label: string,
  join: string,
  file: string,
  key: string,
): string {
  return `${label} carries no ${join}, which ${file} joins on, so its ${key} has no entry there.`;
}

/** What `offer` reports back while it asks. */
export interface OfferHooks {
  confirm: Confirm;
  onNotice?: (message: string) => void;
  onRelocated?: (result: RelocateResult) => void;
}

/**
 * The run's writer: where each key goes, and the manifest splices that put it
 * there. One per run, because the relocation context it reads is the config
 * as the run found it, and an accepted offer changes that config.
 */
export class EvalWriter {
  private readonly landed: ExternalWrite[] = [];

  private constructor(
    private readonly ctx: RelocationContext,
    private readonly configSource: string,
  ) {}

  /**
   * Build the writer for a run. `targets` are the positional paths as typed,
   * which is where a page in no collection gets its proposed home from; a run
   * that took its paths from the collections passes none.
   *
   * The context is built from the config docevals already loaded rather than
   * by loading it again through meta. A `manni.config.yaml` carrying only a
   * `docevals:` key is a single-tool file to the metadata tool, which refuses
   * it; docevals reads it every run, and where its own evals go cannot depend
   * on whether a sibling can read the same file. The collections are the
   * declared ones, since a page named by path is still a member of whatever
   * contains it. `config: null` leaves the page's schema set to the page,
   * which is enough: the keys this writer homes are named outright in the
   * relocation it plans.
   */
  static for(
    config: DocevalsConfig,
    cwd: string,
    targets: readonly string[],
  ): EvalWriter {
    const noConfig = config.configSource === null;
    const collections = config.collections;
    return new EvalWriter(
      {
        cwd,
        // Page labels are relative to the run's discovery root, so a manifest
        // path this writer reports is spelled against the same directory
        // `core/external.ts` reports a merged value's source against.
        base: cwd,
        noConfig,
        config: null,
        ...(noConfig ? {} : { configDir: config.configDir, configPath: config.configPath }),
        collections,
        declaredCollections: collections,
        targets,
        validator: new Validator(),
      },
      config.configSource ?? cwd,
    );
  }

  /** Where `key` of the page labelled `label` goes. `data` is its metadata. */
  async homeFor(
    label: string,
    data: Readonly<Record<string, unknown>>,
    key: string,
  ): Promise<WriteHome> {
    const home = await keyHome(this.ctx, label, data, key);
    if (home.kind === "url") {
      return { kind: "url", collection: home.collection, file: home.file };
    }
    if (home.kind === "manifest") {
      if (home.entry === undefined) {
        return {
          kind: "no-entry",
          message: noEntryMessage(label, home.join, home.file, key),
        };
      }
      return {
        kind: "manifest",
        file: home.file,
        absPath: home.absPath,
        join: home.join,
        entry: home.entry,
        perPage: home.perPage,
      };
    }
    return { kind: "page", prefersExternal: prefersExternal(key), proposed: home.home };
  }

  /**
   * The refusal for an eval key a URL manifest owns, in chunk 1's wording. A
   * run reaches it only where the load-time refusal could not: a manifest
   * declared for a collection whose pages this run never merged.
   */
  urlRefusal(home: { collection: string }, key: string): DocevalsError {
    return new DocevalsError(urlManifestRefusal(this.configSource, home.collection, key));
  }

  /** Record that `key` stayed on the page, for the W1 and W2 lines. */
  stayedOnPage(label: string, key: string, proposed: ProposedHome): void {
    this.landed.push({ label, key, home: proposed });
  }

  /** The W1 and W2 lines for everything that stayed on a page. Without the prefix. */
  warnings(dryRun: boolean): string[] {
    return this.landed.length === 0 ? [] : externalWriteWarnings(this.landed, dryRun);
  }

  /**
   * Ask P1 once per collection the flagged writes would be homed in. Returns
   * true when a relocation was applied, which leaves the caller's config,
   * pages and this writer stale: rebuild all three before writing.
   */
  async offer(writes: readonly ExternalWrite[], hooks: OfferHooks): Promise<boolean> {
    if (writes.length === 0) return false;
    const applied = await offerExternalHomes(this.ctx, writes, hooks);
    return applied.size > 0;
  }

  /** The value the manifest holds for this page's entry, or `undefined`. */
  async readManifest(
    home: { absPath: string; entry: string; join: string; perPage: boolean },
    key: string,
  ): Promise<unknown> {
    return readManifestValue(await this.text(home.absPath, home.perPage), {
      entry: home.entry,
      key,
      join: home.join,
    });
  }

  /** Write `value` into this page's entry, changing no other byte of the file. */
  async writeManifest(
    home: { absPath: string; entry: string; join: string; file: string; perPage: boolean },
    key: string,
    value: unknown,
  ): Promise<void> {
    const text = await this.text(home.absPath, home.perPage);
    let spliced: string;
    try {
      spliced = spliceManifestValue(text, {
        entry: home.entry,
        key,
        value,
        join: home.join,
        file: home.file,
      }).text;
    } catch (e) {
      // meta's refusal, in this tool's error class, exactly as cite reports it.
      throw new DocevalsError(errorMessage(e));
    }
    // A per-page manifest may be the first file in its directory.
    if (spliced !== text) {
      await writeFileAtomic(home.absPath, spliced, { createParents: true });
    }
  }

  /**
   * The manifest's bytes. A per-page manifest that is not on disk yet is a
   * page with nothing recorded, held as empty text and created by the write,
   * exactly as `manni meta fill` holds one. A missing concrete manifest is
   * refused, as it always was.
   */
  private async text(absPath: string, perPage: boolean): Promise<string> {
    try {
      return await readFile(absPath, "utf8");
    } catch (e) {
      if (perPage && isMissing(e)) return "";
      throw new DocevalsError(
        `${resolve(absPath)} could not be read: ${errorMessage(e)}`,
      );
    }
  }
}

/**
 * The eval list a manifest holds, as a list. An entry whose `evals` is a
 * string shorthand, or anything else, is refused rather than rewritten: the
 * page's own shorthand is refused the same way, and expanding one is the
 * author's call rather than a silent side effect of adding an eval.
 */
export function manifestEvalList(value: unknown, file: string, entry: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return [...(value as readonly unknown[])];
  throw new DocevalsError(
    `${file}: the evals key of ${entry} is not a list — expand the string ` +
      `shorthand into a list before appending`,
  );
}

/** The updates `generate` and `promote` persist onto one eval entry. */
export interface ManifestEvalUpdates {
  grader?: string;
  command?: string[];
  "generated-assertion-hash"?: string;
}

/**
 * Apply `updates` to the entry named `name` in a manifest's eval list, and
 * return the new list. `undefined` when the list holds no such entry, which
 * is a caller's refusal rather than a silent no-op.
 */
export function updateManifestEval(
  list: readonly unknown[],
  name: string,
  updates: ManifestEvalUpdates,
): unknown[] | undefined {
  const index = list.findIndex((item) => named(item) === name);
  const held = index === -1 ? undefined : list[index];
  if (held === undefined) return undefined;
  // Only the fields actually being set. An `undefined` in the value would be
  // dropped on the way to YAML and then fail the splice's read-back, which
  // compares what it wrote against what the file now holds.
  const set: Record<string, unknown> = { ...(held as Record<string, unknown>) };
  if (updates.grader !== undefined) set.grader = updates.grader;
  if (updates.command !== undefined) set.command = updates.command;
  const hash = updates["generated-assertion-hash"];
  if (hash !== undefined) set["generated-assertion-hash"] = hash;
  const next = [...list];
  next[index] = set;
  return next;
}

/** The id a manifest's eval entry answers to, or `undefined` for a shorthand. */
function named(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
  const entry = item as Record<string, unknown>;
  const id = entry.id ?? entry.use;
  return typeof id === "string" ? id : undefined;
}
