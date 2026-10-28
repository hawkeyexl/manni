/**
 * Finding MadCap Flare's command-line builder, `madbuild` (proposal 0125,
 * decision 22): on PATH, then in the folder `tools.flare.home` names, then in
 * the newest Flare install under Program Files. The host is injected, so the
 * search is asserted on every OS without Flare installed.
 */
import { readdirSync } from "node:fs";
import { join, win32 } from "node:path";
import { findOnPath, realPathHost, type PathHost } from "../find-on-path.js";

export interface MadbuildHost extends PathHost {
  /** The names in a folder, or none when it cannot be read. */
  readdir: (path: string) => string[];
}

export const realMadbuildHost: MadbuildHost = {
  ...realPathHost,
  readdir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
};

export const MADBUILD_NOT_FOUND =
  "madbuild was not found. Install MadCap Flare, or set tools.flare.home to the folder that holds madbuild.exe.";

/** The numbers in an install folder's name, so `MadCap Flare 2024 r2` reads as [2024, 2]. */
const versionOf = (name: string): number[] => (name.match(/\d+/g) ?? []).map(Number);

/** Newest first: compared number by number, so 21 beats 19 and 9. */
function newestFirst(a: string, b: string): number {
  const x = versionOf(a);
  const y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * madbuild, as the argv's first word: the bare name when PATH has it, so the
 * runner resolves it as the shell would, else the absolute path. `home` is
 * `tools.flare.home`, already absolute. `undefined` when none is found.
 */
export function findMadbuild(home: string | undefined, host: MadbuildHost = realMadbuildHost): string | undefined {
  if (findOnPath("madbuild", ".", host) !== undefined) return "madbuild";
  if (home !== undefined) {
    const exe = join(home, "madbuild.exe");
    if (host.isFile(exe)) return exe;
  }
  if (host.platform !== "win32") return undefined;
  const software = win32.join(host.env["ProgramFiles"] ?? "C:\\Program Files", "MadCap Software");
  const installs = host
    .readdir(software)
    .filter((name) => /^MadCap Flare \d/i.test(name))
    .sort(newestFirst);
  for (const name of installs) {
    const exe = win32.join(software, name, "Flare.app", "madbuild.exe");
    if (host.isFile(exe)) return exe;
  }
  return undefined;
}
