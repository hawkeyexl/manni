/**
 * Where a command resolves, the way the OS would find it. Shared by `site`'s
 * runner and the Flare madbuild search, with the host injectable so a test
 * asserts Windows' PATHEXT rules on any OS.
 */
import { accessSync, constants, statSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface PathHost {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** A file this process may run: on POSIX, one with its execute bit set. */
  isFile: (path: string) => boolean;
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export const realPathHost: PathHost = { platform: process.platform, env: process.env, isFile: isExecutable };

/**
 * Where `name` resolves: a name with a separator against `cwd`, a bare one
 * along PATH. On Windows a name without one of PATHEXT's extensions is tried
 * with each in turn, so `npm` finds `npm.cmd`.
 */
export function findOnPath(name: string, cwd: string, host: PathHost = realPathHost): string | undefined {
  const win = host.platform === "win32";
  const path = win ? win32 : posix;
  const exts = win ? (host.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "") : [];
  const lower = name.toLowerCase();
  const names = win && !exts.some((e) => lower.endsWith(e.toLowerCase())) ? exts.map((e) => name + e) : [name];
  const dirs = /[\\/]/.test(name)
    ? [cwd]
    : (host.env["PATH"] ?? "").split(path.delimiter).filter((d) => d !== "");
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = path.resolve(dir, candidate);
      if (host.isFile(full)) return full;
    }
  }
  return undefined;
}
