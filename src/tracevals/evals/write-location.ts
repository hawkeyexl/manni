/**
 * Where `manni tracevals fill` writes an artifact's `metadata` block
 * (proposal 0047, §3 and §4).
 *
 * Every write goes through the rule `manni meta fill` and `manni docevals
 * fill` already follow, decided by meta's `keyHome`:
 *
 *  - a **local manifest** of one of the artifact's collections owns the
 *    block: the value is spliced into the artifact's entry there. A `{page}`
 *    manifest (proposal 0058) resolves to the artifact's own file, which the
 *    first write creates. A keyless manifest (proposal 0068) owns the block
 *    when the artifact's schemas mark it external;
 *  - the manifest **joins on a field the artifact lacks**: there is no entry
 *    to hold the block, and the write is refused for that artifact;
 *  - a **URL manifest** owns it: nothing fetched can be written;
 *  - **no manifest owns it**: the artifact keeps it, with the offer (P1) and
 *    the warnings (W1, W2) meta's writers use.
 *
 * The marks a keyless manifest owns by are read from meta's section of the
 * same family file the reader (`external.ts`) reads them from, so reading and
 * writing agree on where the block lives.
 */
import { relative, resolve } from "node:path";
import { errorMessage } from "../../shared/errors.js";
import { readManifestOrEmpty } from "../../shared/manifest-cas.js";
import type { Confirm } from "../../shared/prompt.js";
import {
  keyHome,
  marksValidator,
  metaSection,
  offerExternalHomes,
  readManifestValue,
  spliceManifestValue,
  type ExternalWrite,
  type ProposedHome,
  type RelocateResult,
  type RelocationContext,
} from "../../meta/internal.js";
import {
  DocmetaError,
  writeFileAtomic,
  type CollectionConfig,
  type DocmetaConfig,
} from "../../meta/index.js";
import { TracevalsError } from "../types.js";
import { METADATA_KEY } from "./external.js";

/** Where one artifact's `metadata` block goes. */
export type MetadataHome =
  /** The artifact's own front matter. `proposed` is the home relocation would give it. */
  | { kind: "page"; proposed: ProposedHome }
  /** The artifact's entry in a local manifest. */
  | {
      kind: "manifest";
      /** As the run reports it. */
      file: string;
      absPath: string;
      /** `path`, or the artifact field the manifest joins on. */
      join: string;
      entry: string;
      /** A `{page}` manifest, which may not exist yet. */
      perPage: boolean;
    }
  /** A manifest joins on a field this artifact does not carry. */
  | { kind: "no-entry"; file: string; join: string }
  /** A URL manifest owns the block. */
  | { kind: "url"; file: string };

/** What `offer` reports back while it asks. */
export interface OfferHooks {
  confirm: Confirm;
  onNotice?: (message: string) => void;
  onRelocated?: (result: RelocateResult) => void;
}

export interface MetadataWriterOptions {
  /** Every collection the config declares. An accepted offer edits these in place. */
  collections: CollectionConfig[];
  /** The config file's directory; artifact entries resolve from it. */
  configDir: string;
  /** The config file; absent when there is none, and then nothing has a home. */
  configPath: string | undefined;
  /** The working directory the positional paths were typed in. */
  cwd: string;
  /** The positional paths as typed, where a created collection's `paths:` come from. */
  targets: readonly string[];
}

/** `<artifact> carries no <join>, which <file> joins on, so its metadata has no entry there.` */
export function noEntryRefusal(label: string, join: string, file: string): string {
  return `${label}: ${METADATA_KEY} is owned by ${file}, which joins on "${join}", and this artifact carries no ${join}.`;
}

/**
 * The run's writer. One per run, because the relocation context it reads is
 * the config as the run found it, and an accepted offer changes that config.
 */
export class MetadataWriter {
  private constructor(private readonly ctx: RelocationContext) {}

  static async for(opts: MetadataWriterOptions): Promise<MetadataWriter> {
    const { configDir, configPath } = opts;
    const config = configPath === undefined ? null : await metaConfig(configPath, configDir);
    return new MetadataWriter({
      // Artifact labels are absolute, and a manifest is reported relative to
      // the config directory, the way `external.ts` reports one it read.
      cwd: configDir,
      base: configDir,
      noConfig: configPath === undefined,
      config,
      ...(configPath === undefined ? {} : { configDir, configPath }),
      collections: opts.collections,
      declaredCollections: opts.collections,
      targets: opts.targets.map((t) => relative(configDir, resolve(opts.cwd, t)) || "."),
      validator: marksValidator({ config, cwd: configDir, configDir })(),
    });
  }

  /** Where the `metadata` block of the artifact `label` goes. `data` is its own front matter. */
  async homeFor(label: string, data: Readonly<Record<string, unknown>>): Promise<MetadataHome> {
    const home = await keyHome(this.ctx, label, data, METADATA_KEY);
    if (home.kind === "url") return { kind: "url", file: home.file };
    if (home.kind === "manifest") {
      if (home.entry === undefined) {
        return { kind: "no-entry", file: home.file, join: home.join };
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
    return { kind: "page", proposed: home.home };
  }

  /**
   * Ask P1 once per collection the flagged writes would be homed in. Returns
   * true when a relocation was applied, which leaves the caller's config,
   * artifacts and this writer stale: rebuild all three before writing.
   */
  async offer(writes: readonly ExternalWrite[], hooks: OfferHooks): Promise<boolean> {
    if (writes.length === 0) return false;
    const applied = await offerExternalHomes(this.ctx, writes, hooks);
    return applied.size > 0;
  }

  /**
   * Replace this artifact's `metadata` block in its manifest entry with what
   * `update` makes of the block the file holds now. The file is read just
   * before the write, so a block another run wrote meanwhile is extended
   * rather than lost, and no other byte of the file changes.
   */
  async write(
    home: Extract<MetadataHome, { kind: "manifest" }>,
    update: (current: unknown) => unknown,
  ): Promise<void> {
    let text: string;
    try {
      text = await readManifestOrEmpty(home.absPath, home.perPage);
    } catch (e) {
      throw new TracevalsError(`${home.file} could not be read: ${errorMessage(e)}`);
    }
    const at = { entry: home.entry, key: METADATA_KEY, join: home.join };
    let spliced: string;
    try {
      spliced = spliceManifestValue(text, {
        ...at,
        value: update(readManifestValue(text, at)),
        file: home.file,
      }).text;
    } catch (e) {
      // meta's refusal, in this tool's error class.
      throw new TracevalsError(errorMessage(e));
    }
    // A per-page manifest may be the first file in its directory.
    if (spliced !== text) {
      await writeFileAtomic(home.absPath, spliced, { createParents: true });
    }
  }
}

/**
 * Meta's section of the family file. A file meta cannot read as its own is
 * still tracevals' file, and meta's default set decides the marks then.
 */
async function metaConfig(configPath: string, configDir: string): Promise<DocmetaConfig | null> {
  try {
    return await metaSection(configPath, configDir);
  } catch (err) {
    if (err instanceof DocmetaError) return null;
    throw err;
  }
}
