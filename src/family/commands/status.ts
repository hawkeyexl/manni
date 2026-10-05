/**
 * `manni status`: what is set up here, and so what `manni check` runs.
 *
 * It reads the same table `check` does (`in-play.ts`), counting what the
 * content declares where a domain is in play by declaration: the pages that
 * name their own `$schema`, carry citations or resolve evals, and the terms.
 * It checks nothing, so it exits 0 whatever it finds.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import { errorMessage } from "../../shared/errors.js";
import { extractorForExtension } from "../../meta/extractors/index.js";
import type { Envelope } from "../core/envelope.js";
import {
  COMMANDS,
  DOMAINS,
  NOT_CHECKED,
  NOT_SET_UP,
  collectionsOf,
  listMembers,
  loadFamily,
  plural,
  type Domain,
  type Family,
} from "../core/in-play.js";

export const STATUS_FORMATS = ["pretty", "json"] as const;
export type StatusFormat = (typeof STATUS_FORMATS)[number];

export type DomainState = "in-play" | "not-set-up" | "not-checked" | "unknown";

export interface DomainRow {
  name: string;
  status: DomainState;
  reason: string;
}

export interface StatusReport {
  version: string;
  /** The config file, as discovery found it or as it was typed. */
  config: string;
  collections: { name: string; files: number }[];
  domains: DomainRow[];
}

export interface StatusOptions {
  cwd?: string;
  configPath?: string;
}

/** `1 page names`, `3 pages name`: a count and the verb that agrees with it. */
function pages(n: number, one: string, many: string): string {
  return n === 1 ? `1 page ${one}` : `${String(n)} pages ${many}`;
}

/** The pages naming their own `$schema`, read the way `meta validate` extracts them. */
function ownSchemaCount(cwd: string, members: readonly string[]): number {
  let n = 0;
  for (const label of members) {
    const extractor = extractorForExtension(extname(label));
    if (extractor === undefined) continue;
    try {
      const { data } = extractor.extract(readFileSync(resolve(cwd, label), "utf8"), label);
      if (data.$schema !== undefined) n++;
    } catch {
      // A page that does not parse names nothing; `meta validate` reports it.
    }
  }
  return n;
}

/**
 * The pages carrying citations, read the way `cite check` reads them: its
 * targets, its manifests, its entry rules. Nothing is classified, so no claim
 * or source is looked at and no git history is read.
 */
async function citedPages(cwd: string, configPath: string): Promise<number> {
  // Imported where they run, so `manni check` never loads them.
  const { prepareRun, readTarget } = await import("../../cite/commands/check.js");
  const { readPage } = await import("../../cite/core/page.js");
  const prepared = await prepareRun({ inputs: [], configPath, cwd, checkSources: false }, "checked", "check");
  let n = 0;
  for (const file of prepared.files) {
    const content = await readTarget(prepared.run, file);
    const { citations } = (await prepared.setupFor(file, content)).options;
    const read = readPage(file, content, { markers: false, ...(citations === undefined ? {} : { citations }) });
    if (read.citations.length > 0) n++;
  }
  return n;
}

async function row(domain: Domain, family: Family, cwd: string, members: readonly string[]): Promise<DomainRow> {
  const configPath = family.configPath;
  const inPlay = (reason: string): DomainRow => ({ name: domain, status: "in-play", reason });
  const notSetUp: DomainRow = { name: domain, status: "not-set-up", reason: NOT_SET_UP[domain] };
  const section = family.sections.has(domain);
  switch (domain) {
    case "meta": {
      if (section) return inPlay("meta: section");
      const n = ownSchemaCount(cwd, members);
      return n > 0 ? inPlay(pages(n, "names its own $schema", "name their own $schema")) : notSetUp;
    }
    case "cite": {
      const n = await citedPages(cwd, configPath);
      return n > 0 ? inPlay(pages(n, "carries citations", "carry citations")) : notSetUp;
    }
    case "docevals": {
      const { runList: listEvals } = await import("../../docevals/commands/list.js");
      const { plans } = await listEvals([], { config: configPath, cwd });
      const n = plans.filter((p) => !p.skip && p.evals.length > 0).length;
      if (n === 0) return notSetUp;
      return inPlay(section ? "docevals: section" : pages(n, "declares evals", "declare evals"));
    }
    case "term": {
      const { runList: listTerms } = await import("../../term/commands/list.js");
      const { terms } = await listTerms({ inputs: [], configPath, cwd, allowEmpty: true });
      return terms.length > 0 ? inPlay(plural(terms.length, "term")) : notSetUp;
    }
    case "lint":
    case "graph":
      return section ? inPlay(`${domain}: section`) : notSetUp;
  }
}

export async function runStatus(opts: StatusOptions = {}): Promise<StatusReport> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const family = await loadFamily(cwd, opts.configPath);
  const members = family.collections.length === 0 ? [] : await listMembers(family, cwd);
  const domains: DomainRow[] = [];
  for (const domain of DOMAINS) {
    // `check` only reads collection members, so with no collections every
    // domain has nothing to check, whatever sections the config carries.
    if (family.collections.length === 0) {
      domains.push({ name: domain, status: "not-set-up", reason: "no collections: in manni.config.yaml" });
      continue;
    }
    try {
      domains.push(await row(domain, family, cwd, members));
    } catch (err) {
      // Status checks nothing, so a domain that cannot read its own setup is
      // reported in its row rather than ending the run, as unknown: whether it is
      // set up is the thing it could not read.
      const message = errorMessage(err).split("\n", 1)[0] ?? "";
      domains.push({ name: domain, status: "unknown", reason: `manni ${COMMANDS[domain]} could not run: ${message}` });
    }
  }
  for (const [name, reason] of NOT_CHECKED) domains.push({ name, status: "not-checked", reason });
  return {
    version: pkg.version,
    config: family.file.source,
    collections: family.collections.map((c) => ({
      name: c.name,
      files: members.filter((label) => collectionsOf(family, cwd, label).includes(c.name)).length,
    })),
    domains,
  };
}

const STATE_LABEL: Readonly<Record<DomainState, string>> = {
  "in-play": "in play",
  "not-set-up": "not set up",
  "not-checked": "not checked",
  unknown: "unknown",
};

export function renderStatus(report: StatusReport, format: StatusFormat): string {
  if (format === "json") return JSON.stringify(report, null, 2);
  const head = [
    `manni ${report.version}`,
    `config ${report.config}`,
    ...report.collections.map((c) => `collection ${c.name} (${plural(c.files, "file")})`),
  ].join("   ");
  const rows = report.domains.map(
    (d) => `${d.name.padEnd(11)}${STATE_LABEL[d.status].padEnd(14)}${d.reason}`,
  );
  return [head, "", ...rows].join("\n");
}

/**
 * The plugin skill the briefing points an agent at, as `<plugin>:<skill>`.
 * `test/plugin.test.ts` checks both halves against `plugin/manni`.
 */
export const FIX_SKILL = "manni:fix";

/** The set-wide checks a stop runs when a collection document changed, as the briefing names them. */
const PAGE_WIDE: ReadonlyArray<readonly [Domain, string]> = [
  ["term", "the glossary"],
  ["graph", "the graph"],
];

/** `a`, `a or b`, `a, b or c`: a list in prose, joined by `conjunction`. */
function prose(items: readonly string[], conjunction: string): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1) ?? ""}`;
}

/** What an agent is told at the start of a session, after the table. */
export function agentLines(report: StatusReport): string {
  const names = prose(report.collections.map((c) => c.name), "or");
  const inPlay = new Set(report.domains.filter((d) => d.status === "in-play").map((d) => d.name));
  // A stop checks every citation whenever the tree changed: a source edit can drift any of them.
  const plus = inPlay.has("cite") ? ", plus every citation" : "";
  const pageWide = PAGE_WIDE.filter(([domain]) => inPlay.has(domain)).map(([, what]) => what);
  const also = pageWide.length === 0 ? "" : ` It checks ${prose(pageWide, "and")} too when you changed a page.`;
  return [
    `After you edit a file in ${names}, manni check runs on it, and errors come back to you at once.`,
    `Before you finish, manni check runs on every file you changed${plus}.${also} You get one repair pass.`,
    `The ${FIX_SKILL} skill says how to repair each finding.`,
  ].join("\n");
}

/** A model id as Claude Code spells one, and nothing a shell would read as more. */
const MODEL_ID = /^[A-Za-z0-9._:/@-]+$/;

/**
 * Append `export MANNI_GENERATED_BY=<model>` to `$CLAUDE_ENV_FILE`, so every
 * command the session runs records which model wrote what. Only when the
 * envelope names the model, the file is offered, and nobody set the variable.
 */
export function exportGeneratedBy(envelope: Envelope, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = env.CLAUDE_ENV_FILE;
  // A context-window suffix such as `[1m]` is a session setting, not the model.
  const model = envelope.model?.replace(/\[[^\]]*\]$/, "");
  if (model === undefined || !MODEL_ID.test(model)) return false;
  if (file === undefined || file === "" || env.MANNI_GENERATED_BY !== undefined) return false;
  const existing = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lead = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(file, `${lead}export MANNI_GENERATED_BY=${model}\n`, "utf8");
  return true;
}
