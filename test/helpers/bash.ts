import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The bash the shell-script suites run their scripts with.
 *
 * On Windows, the `bash` a bare name finds is often WSL's launcher in
 * `System32`, ahead of Git for Windows on PATH. It answers `bash -c true`, so
 * probing that alone says bash is here. But it reads a script's path as a
 * Linux path and drops the backslashes of a Windows one, so every script the
 * suites write to a temp directory fails with "No such file or directory".
 * Git for Windows' bash is the one the Windows CI runners use. It sits beside
 * git itself. `git --exec-path` is `<root>/<arch>/libexec/git-core`, where
 * `<arch>` is `mingw64` on x64 and `clangarm64` on arm64, so the install
 * root is three levels up and bash is `<root>/bin/bash.exe`. An install laid
 * out any other way fails the `existsSync` below and falls back to PATH.
 *
 * Elsewhere, and when git cannot be asked, it is plain `bash` from PATH.
 */
export const bash: string = (() => {
  if (process.platform !== "win32") return "bash";
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const gitBash = join(execPath, "..", "..", "..", "bin", "bash.exe");
    if (existsSync(gitBash)) return gitBash;
  } catch {
    // No git to ask: fall back to whatever PATH finds.
  }
  return "bash";
})();

/** Whether `bash` runs at all, so a suite can skip where it does not. */
export const hasBash: boolean = (() => {
  try {
    execFileSync(bash, ["-c", "true"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
