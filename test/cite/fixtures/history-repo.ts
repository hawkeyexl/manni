/**
 * A repository whose pins go stale and recover, built at test time for
 * `cite history` (proposal 0092). No `.git` is committed: a nested repository
 * would arrive on CI as an empty directory.
 *
 * The story: mint, move, change, tag, re-pin, restore, rename, remove. Each
 * pin lives in its own source file so its events are its own. Every commit is
 * dated an hour after the one before, so durations are exact.
 */
import { hashRange } from "../../../src/cite/core/hash.js";
import { commit, git, makeTempRepo, mergeBranch, writeFile } from "../../helpers/temp-repo.js";

/** `hours` after the first commit, as ISO 8601. */
export const at = (hours: number): string => new Date(Date.UTC(2026, 0, 1, 12) + hours * 3_600_000).toISOString();

/** The same instant as JSON output spells it: to the second. */
export const iso = (hours: number): string => at(hours).replace(".000Z", "Z");

/** Twenty numbered lines, with some rewritten, after an optional lead. */
export function source(name: string, edit: (n: number) => string | undefined = () => undefined, lead = ""): string {
  const lines: string[] = [];
  for (let n = 1; n <= 20; n++) lines.push(edit(n) ?? `export const ${name}_${String(n)} = ${String(n)};`);
  return `${lead}${lines.join("\n")}\n`;
}

export interface Pin {
  id: string;
  file: string;
  lines: string;
  integrity: string;
  commit?: string;
}

/** The pin over `start`-`end` of `text`. */
export function pin(id: string, file: string, text: string, start: number, end: number, extra: Partial<Pin> = {}): Pin {
  return { id, file, lines: `${String(start)}-${String(end)}`, integrity: hashRange(text, { start, end }), ...extra };
}

/** A page whose frontmatter carries the pins. */
export function page(pins: readonly Pin[]): string {
  const lines = ["---", "citations:"];
  for (const p of pins) {
    lines.push(`  - id: ${p.id}`, "    source:", `      file: "${p.file}"`, `      lines: ${p.lines}`, `      integrity: ${p.integrity}`);
    if (p.commit !== undefined) lines.push(`      commit-sha: ${p.commit}`);
  }
  lines.push("---", "Pinned prose.", "");
  return lines.join("\n");
}

/** The config the story commits first: one collection over `docs/`. */
export const CONFIG = 'collections:\n  - name: site\n    paths: ["docs/**/*.md"]\n';

export interface Story {
  repo: string;
  /** Each commit by name: c1 to c7 on the trunk, `side` and `merge`. */
  c: Record<string, string>;
}

export function story(): Story {
  const a = source("A");
  const b = source("B");
  const cText = source("C");
  const d = source("D");
  const e = source("E");
  const z = source("Z");
  const repo = makeTempRepo({
    files: {
      "manni.config.yaml": CONFIG,
      "src/a.ts": a,
      "src/b.ts": b,
      "src/c.ts": cText,
      "src/d.ts": d,
      "src/e.ts": e,
      "src/z.ts": z,
    },
  });
  const pins = {
    alpha: pin("alpha", "src/a.ts", a, 10, 12),
    beta: pin("beta", "src/b.ts", b, 3, 4),
    gamma: pin("gamma", "src/c.ts", cText, 5, 6),
    delta: pin("delta", "src/d.ts", d, 7, 8),
    epsilon: pin("epsilon", "src/e.ts", e, 2, 3),
    zeta: pin("zeta", "src/z.ts", z, 1, 2, { commit: "aaaaaaa" }),
  };
  const all = (): Pin[] => Object.values(pins);
  writeFile(repo, "docs/page.md", page(all()));
  const c: Record<string, string> = {};
  c.c1 = commit(repo, "mint", { authorDate: at(0) });

  // A move (two lines above alpha's), and a whitespace-only edit inside epsilon's.
  writeFile(repo, "src/a.ts", source("A", undefined, "// one\n// two\n"));
  writeFile(repo, "src/e.ts", source("E", (n) => (n === 2 ? "export const E_2 = 2;  " : undefined)));
  c.c2 = commit(repo, "move a, respace e", { authorDate: at(1) });

  // Alpha's, beta's and gamma's text changes.
  const aChanged = source("A", (n) => (n === 11 ? "export const A_11 = 1100;" : undefined), "// one\n// two\n");
  writeFile(repo, "src/a.ts", aChanged);
  writeFile(repo, "src/b.ts", source("B", (n) => (n === 3 ? "export const B_3 = 300;" : undefined)));
  writeFile(repo, "src/c.ts", source("C", (n) => (n === 5 ? "export const C_5 = 500;" : undefined)));
  c.c3 = commit(repo, "change a, b, c", { authorDate: at(2) });
  git(repo, ["tag", "v1.0.0"]);

  // A prerelease branch the trunk never takes.
  git(repo, ["checkout", "-q", "-b", "rc"]);
  writeFile(repo, "rc.txt", "rc\n");
  commit(repo, "rc", { authorDate: at(2.5) });
  git(repo, ["tag", "v9.0.0-rc.1"]);
  git(repo, ["checkout", "-q", "-"]);

  // Alpha re-pinned, beta's and epsilon's sources restored, zeta's commit-sha alone changed.
  pins.alpha = pin("alpha", "src/a.ts", aChanged, 12, 14);
  pins.zeta = { ...pins.zeta, commit: "bbbbbbb" };
  writeFile(repo, "src/b.ts", b);
  writeFile(repo, "src/e.ts", e);
  writeFile(repo, "docs/page.md", page(all()));
  c.c4 = commit(repo, "re-pin a, restore b and e", { authorDate: at(3) });

  // The page renamed, its text unchanged.
  git(repo, ["mv", "docs/page.md", "docs/guide.md"]);
  c.c5 = commit(repo, "rename the page", { authorDate: at(4) });
  git(repo, ["tag", "v1.1.0"]);

  // A side branch with its own release tag, merged later.
  git(repo, ["checkout", "-q", "-b", "side"]);
  writeFile(repo, "side.txt", "side\n");
  c.side = commit(repo, "side work", { authorDate: at(4.5) });
  git(repo, ["tag", "v1.2.0"]);
  git(repo, ["checkout", "-q", "-"]);

  // Gamma removed; delta's source changes and stays changed.
  const { gamma: _gone, ...kept } = pins;
  writeFile(repo, "docs/guide.md", page(Object.values(kept)));
  writeFile(repo, "src/d.ts", source("D", (n) => (n === 7 ? "export const D_7 = 700;" : undefined)));
  c.c6 = commit(repo, "remove gamma, change d", { authorDate: at(5) });
  c.merge = mergeBranch(repo, "side", at(6));
  writeFile(repo, "notes.txt", "notes\n");
  c.c7 = commit(repo, "notes", { authorDate: at(7) });
  return { repo, c };
}
