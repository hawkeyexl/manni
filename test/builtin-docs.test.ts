/**
 * Every built-in schema has exactly one reference page.
 *
 * A page under `docs/src/content/docs/meta/reference/schemas/` claims an id
 * with a body line of its own, `**Built-in id:** \`<id>\`` or, for a strict
 * overlay documented on its vocabulary's page, `**Strict overlay id:**
 * \`<id>\``. The registry is the source of truth. A built-in with no page, an
 * id claimed by two pages, or a page naming an id the registry does not ship
 * each fail here rather than in a reader's 404.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve, relative } from "node:path";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinGuide, listBuiltins } from "../src/meta/core/schema-registry.js";

const GUIDE_BASE = "https://hawkeyexl.github.io/manni/meta/reference/schemas/";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const pagesDir = resolve(root, "docs/src/content/docs/meta/reference/schemas");

const CLAIM = /^\*\*(?:Built-in id|Strict overlay id):\*\* `([^`]+)`\s*$/;

function mdxFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) out.push(...mdxFiles(full));
    else if (name.endsWith(".mdx") || name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** id → the pages (relative to the repo root) whose body claims it. */
function claims(): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const file of mdxFiles(pagesDir)) {
    const page = relative(root, file).replaceAll("\\", "/");
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const id = CLAIM.exec(line)?.[1];
      if (id === undefined) continue;
      byId.set(id, [...(byId.get(id) ?? []), page]);
    }
  }
  return byId;
}

describe("built-in schema reference pages", () => {
  const registered = listBuiltins().map((b) => b.id);
  const claimed = claims();

  it("gives every registered built-in exactly one page", () => {
    const problems: string[] = [];
    for (const id of registered) {
      const pages = claimed.get(id) ?? [];
      if (pages.length !== 1) {
        problems.push(
          `${id}: ${pages.length === 0 ? "no page" : pages.join(", ")}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("links each finding's guide to the page that claims its id", () => {
    // The slug table beside PUBLISHED_PATHS is what a finding's `Guide:`
    // line links; it has to land on the page whose body claims the id.
    const wrong: string[] = [];
    for (const id of registered) {
      const page = claimed.get(id)?.[0];
      const slug = page?.split("/").pop()?.replace(/\.mdx?$/, "");
      const want = slug === undefined ? null : `${GUIDE_BASE}${slug}/`;
      if (builtinGuide(id) !== want) wrong.push(`${id}: ${String(builtinGuide(id))} != ${String(want)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("names no id the registry does not ship", () => {
    const known = new Set(registered);
    const unknown = [...claimed.entries()]
      .filter(([id]) => !known.has(id))
      .map(([id, pages]) => `${id}: ${pages.join(", ")}`);
    expect(unknown).toEqual([]);
  });
});
