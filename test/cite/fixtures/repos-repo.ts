/**
 * Three sibling checkouts in one temp directory, built at test time
 * (proposal 0100): `docs` cites `api` and `sdk` by name. No `.git` is
 * committed, because a nested repository would arrive on CI empty.
 *
 * `docs/pages/limits.md` pins `api:lib/limits.ts:2`, `sdk:src/client.ts:2`
 * and `api:README.md:3`. `sdk` has a `README.md` too, whose line 3 differs,
 * so the third pin holds only where its repo says it is.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashLines, hashRange } from "../../../src/cite/core/hash.js";
import { commitAll, removeTempRepo, writeFile } from "../../helpers/temp-repo.js";

export const API_LIMITS = "lib/limits.ts";
export const API_LIMITS_TEXT = "export const limits = {\n  timeoutMs: 30_000,\n};\n";
export const SDK_CLIENT = "src/client.ts";
export const SDK_CLIENT_TEXT =
  "export function get(url: string) {\n  return retry(() => fetch(url), { attempts: 3 });\n}\n";

/** A README whose line 3 names the Node version. */
export function readme(node: number): string {
  return `# Readme\n\nRequires Node ${String(node)}.\n`;
}

export const PAGE = "pages/limits.md";

/** One entry of a page, with the sentence its claim pins. */
export interface EntrySpec {
  id: string;
  sentence: string;
  repo?: string;
  file: string;
  lines: number;
  integrity: string;
  commit?: string;
}

/**
 * A page whose body is one sentence per entry, each pinned by `claim.lines`.
 * Every frontmatter field sits on one line, so the body starts at the same
 * line whatever the hashes are.
 */
export function citedPage(entries: readonly EntrySpec[]): string {
  const front: string[] = ["---", "title: Limits", "citations:"];
  const body: string[] = ["# Limits", ""];
  const bodyLineOf = (i: number): number => body.length + 1 + i * 2;
  for (const [i, entry] of entries.entries()) {
    front.push(
      `  - id: ${entry.id}`,
      "    claim:",
      `      lines: ${String(bodyLineOf(i))}`,
      `      integrity: ${hashLines(entry.sentence)}`,
      "    source:",
      ...(entry.repo === undefined ? [] : [`      repo: ${entry.repo}`]),
      `      file: ${entry.file}`,
      `      lines: ${String(entry.lines)}`,
      `      integrity: ${entry.integrity}`,
      ...(entry.commit === undefined ? [] : [`      commit-sha: ${entry.commit}`]),
    );
  }
  front.push("---");
  for (const entry of entries) body.push(entry.sentence, "");
  return [...front, ...body].join("\n");
}

export interface ReposRepo {
  /** The temp directory holding all three. */
  dir: string;
  docs: string;
  api: string;
  sdk: string;
  /** HEAD of each source checkout when the pins were minted. */
  minted: { api: string; sdk: string };
  /** The three entries the page carries. */
  entries: EntrySpec[];
}

/** A checkout with these files, committed once. `git: false` leaves it a plain directory. */
export function makeCheckout(dir: string, files: Record<string, string>, opts: { git?: boolean } = {}): string | undefined {
  for (const [rel, text] of Object.entries(files)) writeFile(dir, rel, text);
  if (opts.git === false) return undefined;
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir, stdio: "ignore" });
  return commitAll(dir, "start");
}

export const API_FILES = { [API_LIMITS]: API_LIMITS_TEXT, "README.md": readme(24) };
export const SDK_FILES = { [SDK_CLIENT]: SDK_CLIENT_TEXT, "README.md": readme(22) };

/** A fresh temp directory, symlink-resolved as git reports it. */
function tempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "manni-cite-repos-")));
}

/**
 * The three checkouts are built once per test file and copied for each test.
 * A copy keeps every commit, so `minted` holds. Building them spawns git
 * some twenty times, which a busy Windows runner made slower than a test's
 * timeout. `removeReposTemplates` clears them in `afterAll`.
 */
const templates = new Map<string, ReposRepo>();

/** `docs`, `api` and `sdk`, with the page minted against the other two. */
export function reposRepo(opts: { sdkGit?: boolean } = {}): ReposRepo {
  const key = opts.sdkGit === false ? "no-sdk-git" : "git";
  let template = templates.get(key);
  if (template === undefined) {
    template = buildReposRepo(tempDir(), opts);
    templates.set(key, template);
  }
  const dir = tempDir();
  cpSync(template.dir, dir, { recursive: true });
  return {
    dir,
    docs: join(dir, "docs"),
    api: join(dir, "api"),
    sdk: join(dir, "sdk"),
    minted: { ...template.minted },
    entries: template.entries.map((entry) => ({ ...entry })),
  };
}

/** Remove the templates `reposRepo` copies from. Call it in `afterAll`. */
export function removeReposTemplates(): void {
  for (const template of templates.values()) removeTempRepo(template.dir);
  templates.clear();
}

function buildReposRepo(dir: string, opts: { sdkGit?: boolean }): ReposRepo {
  const docs = join(dir, "docs");
  const api = join(dir, "api");
  const sdk = join(dir, "sdk");
  const apiHead = makeCheckout(api, API_FILES) ?? "";
  const sdkHead = makeCheckout(sdk, SDK_FILES, { git: opts.sdkGit !== false });
  const entries: EntrySpec[] = [
    {
      id: "timeout",
      sentence: "Requests time out after 30 seconds.",
      repo: "api",
      file: API_LIMITS,
      lines: 2,
      integrity: hashRange(API_LIMITS_TEXT, { start: 2, end: 2 }),
      commit: apiHead,
    },
    {
      id: "retries",
      sentence: "The SDK retries a request three times.",
      repo: "sdk",
      file: SDK_CLIENT,
      lines: 2,
      integrity: hashRange(SDK_CLIENT_TEXT, { start: 2, end: 2 }),
      ...(sdkHead === undefined ? {} : { commit: sdkHead }),
    },
    {
      id: "node",
      sentence: "The API requires Node 24.",
      repo: "api",
      file: "README.md",
      lines: 3,
      integrity: hashRange(readme(24), { start: 3, end: 3 }),
      commit: apiHead,
    },
  ];
  // The docs checkout has a README of its own, so the `api` pin on
  // `README.md` would not hold had it resolved under the root.
  makeCheckout(docs, { [PAGE]: citedPage(entries), "README.md": readme(20) });
  return { dir, docs, api, sdk, minted: { api: apiHead, sdk: sdkHead ?? "" }, entries };
}

/** Rewrite one line of a file in a checkout and commit it. Returns the new HEAD. */
export function editLine(checkout: string, rel: string, original: string, line: number, text: string): string {
  const lines = original.split("\n");
  lines[line - 1] = text;
  writeFile(checkout, rel, lines.join("\n"));
  return commitAll(checkout, `edit ${rel}:${String(line)}`);
}

/** A page with no citations yet, its one sentence at file line 5, for `add`. */
export const NEW_PAGE = "pages/new.md";
export const NEW_PAGE_TEXT = "---\ntitle: New\n---\n\nRequests time out after 30 seconds.\n";

/** Write these files into a checkout and commit them, so its index tracks them. Returns the new HEAD. */
export function track(checkout: string, files: Record<string, string>): string {
  for (const [rel, text] of Object.entries(files)) writeFile(checkout, rel, text);
  return commitAll(checkout, `track ${Object.keys(files).join(", ")}`);
}
