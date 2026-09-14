/**
 * What a writer (`derive`, `fill`) does with a value its schema prefers in
 * external metadata when no manifest owns the key (proposal 0047).
 *
 * On a terminal, one question per collection (P1) offers the relocation that
 * gives the key a manifest, and a yes applies it before anything is written.
 * Off a terminal, declined, or under a dry run, the value is written to the
 * page as before, and one warning per collection (W1), or per set of pages
 * with no possible home (W2), says so. The planning and the prompt's wording
 * are `relocation.ts`'s; this module is the writers' shared use of them.
 */
import { LineCounter, isMap, isNode, isScalar, parseDocument } from "yaml";
import type { Confirm } from "../../shared/prompt.js";
import {
  applyRelocation,
  offerPrompt,
  planRelocation,
  relocationOffers,
  type ProposedHome,
  type RelocateResult,
  type RelocationContext,
} from "./relocation.js";
import { PATH_JOIN } from "./external-metadata.js";

/** One key a writer is about to set on one page, which prefers external metadata and has no manifest. */
export interface ExternalWrite {
  label: string;
  key: string;
  home: ProposedHome;
}

const dedupe = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
const pages = (n: number): string => `${String(n)} page${n === 1 ? "" : "s"}`;

/**
 * Ask P1 once per collection the writes would be homed in, and apply each
 * relocation the user accepts. Returns the collections whose relocation was
 * applied; their keys now have a manifest, and the caller re-reads what the
 * relocation changed before writing. Writes with no possible home are never
 * offered.
 */
export async function offerExternalHomes(
  ctx: RelocationContext,
  writes: readonly ExternalWrite[],
  hooks: {
    confirm: Confirm;
    onNotice?: (message: string) => void;
    onRelocated?: (result: RelocateResult) => void;
  },
): Promise<Set<string>> {
  const applied = new Set<string>();
  const groups = new Map<string, ExternalWrite[]>();
  for (const w of writes) {
    if (w.home.kind !== "collection") continue;
    const group = groups.get(w.home.collection) ?? [];
    group.push(w);
    groups.set(w.home.collection, group);
  }
  for (const [collection, group] of groups) {
    const require = new Map<string, string[]>();
    for (const w of group) {
      const keys = require.get(w.label) ?? [];
      if (!keys.includes(w.key)) keys.push(w.key);
      require.set(w.label, keys);
    }
    // Planned against the config as it stands now: an earlier collection's
    // accepted relocation may have created the config file.
    const plan = await planRelocation(ctx, {
      files: [...require.keys()],
      fields: dedupe(group.map((w) => w.key)),
      require,
    });
    const offers = relocationOffers(plan);
    if (offers.length === 0) continue;
    let yes = true;
    for (const offer of offers) {
      const { notice, question } = offerPrompt(offer, "write");
      hooks.onNotice?.(notice);
      if (!(await hooks.confirm(question))) {
        yes = false;
        break;
      }
    }
    if (!yes) continue;
    const result = await applyRelocation(ctx, plan);
    hooks.onRelocated?.(result);
    applied.add(collection);
  }
  return applied;
}

/**
 * The W1 and W2 lines for the writes that landed on a page, or would under a
 * dry run: one per collection, one for the pages in none of several
 * collections, and one under `--no-config`. Without the `manni: ` prefix,
 * which `warn()` adds.
 */
export function externalWriteWarnings(
  writes: readonly ExternalWrite[],
  dryRun: boolean,
): string[] {
  const verb = dryRun ? "would write" : "wrote";
  const groups = new Map<string, ExternalWrite[]>();
  const groupOf = (w: ExternalWrite): string =>
    w.home.kind === "collection" ? `c:${w.home.collection}` : `n:${w.home.reason}`;
  for (const w of writes) {
    const id = groupOf(w);
    groups.set(id, [...(groups.get(id) ?? []), w]);
  }
  const out: string[] = [];
  for (const group of groups.values()) {
    const [first] = group;
    /* c8 ignore next -- a group holds at least one write. */
    if (first === undefined) continue;
    out.push(
      externalWriteWarning({
        verb,
        keys: dedupe(group.map((w) => w.key)),
        pages: new Set(group.map((w) => w.label)).size,
        home: first.home,
        createsHome: group.some(
          (w) => w.home.kind === "collection" && (w.home.createsCollection || w.home.addsPath !== undefined),
        ),
      }),
    );
  }
  return out;
}

/**
 * One W1 or W2 line, without the `manni: ` prefix: `keys` were written (or
 * would be) to `pages` pages whose home is `home`. `createsHome` says
 * relocate would create the collection, manifest or path that gives them a
 * manifest. Where it would only add a path to a collection whose manifest
 * already exists, the line says so rather than promising a manifest. One key
 * reads in the singular, several in the plural.
 */
export function externalWriteWarning(line: {
  verb: "wrote" | "would write";
  keys: readonly string[];
  pages: number;
  home: ProposedHome;
  createsHome: boolean;
}): string {
  const { verb, keys, home } = line;
  const one = keys.length === 1;
  const head = `${verb} ${keys.join(", ")} to ${pages(line.pages)}`;
  const prefer = one ? "the schema prefers external metadata" : "their schemas prefer external metadata";
  const them = one ? "it" : "them";
  if (home.kind === "collection") {
    if (!line.createsHome) {
      return `${head} in collection ${home.collection}; ${prefer}, and no manifest owns ${them}. Run manni meta relocate to move ${them}.`;
    }
    // Whether the collection has a manifest is the collection's, so any write in the group answers it.
    return home.createsCollection || home.createsManifest
      ? `${head}; ${prefer}. Run manni meta relocate to give ${them} a manifest.`
      : `${head}; ${prefer}. Run manni meta relocate to add ${them} to collection ${home.collection}.`;
  }
  return home.reason === "no-config"
    ? `${head}; ${prefer}, and --no-config leaves ${them} no manifest.`
    : `${head} that ${line.pages === 1 ? "is" : "are"} in none of the ${String(home.collections)} collections; ${prefer}, and only a collection has a manifest.`;
}

/**
 * The 1-based line of `key` in the entry for `entry`, in a manifest's text:
 * where a writer's report points after the write. A path entry matches
 * however the manifest spells it (`./docs/a.md` is `docs/a.md`).
 */
export function manifestKeyLine(
  text: string,
  entry: string,
  key: string,
  join: string,
): number | undefined {
  const norm = (e: string): string =>
    join === PATH_JOIN ? e.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/") : e;
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc, uniqueKeys: false });
  const root = doc.contents;
  if (!isMap(root)) return undefined;
  for (const pair of root.items) {
    const spelled = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    if (norm(spelled) !== norm(entry) || !isMap(pair.value)) continue;
    for (const kv of pair.value.items) {
      const name = isScalar(kv.key) ? String(kv.key.value) : String(kv.key);
      const range = isNode(kv.key) ? kv.key.range : undefined;
      if (name === key && range) return lc.linePos(range[0]).line;
    }
  }
  return undefined;
}
