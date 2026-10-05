/**
 * Starting a Windows `.bat` or `.cmd` launcher without a shell string.
 *
 * Node refuses to spawn a `.bat` or `.cmd` without a shell, and `shell: true`
 * joins the argv into one string **with no quoting at all**. An argv carrying
 * user-supplied paths makes that a command-injection hole, not a convenience.
 * The documented alternative is this one: run `cmd.exe` directly, do the
 * quoting here, and pass the whole command as one verbatim argument. `/s` then
 * strips exactly the outer pair of quotes, which is why the string is wrapped a
 * second time. The next reader will find `shell: true` simpler; it is also the
 * version with the hole in it.
 *
 * Shared by `lint`'s DITA-OT seam (`dita.bat`) and `docs`' runner (`npm.cmd`
 * and every other Node CLI shim).
 */

/** How a launcher is actually started. */
export interface LauncherCommandLine {
  command: string;
  argv: string[];
  /** Windows: the argv is already one quoted string and must not be re-quoted. */
  verbatim: boolean;
}

function isBatchFile(launcher: string): boolean {
  const lower = launcher.toLowerCase();
  return lower.endsWith(".bat") || lower.endsWith(".cmd");
}

/**
 * How to start `launcher` with `args`, given what it is. A `"` inside a Windows
 * path is impossible (the character is not legal in a filename), so a token
 * carrying one is a shape this cannot quote safely. `refuse` builds the error
 * thrown for it, in the calling domain's own class and words.
 */
export function launcherCommandLine(
  launcher: string,
  args: string[],
  refuse: (value: string) => Error,
): LauncherCommandLine {
  if (!isBatchFile(launcher)) {
    return { command: launcher, argv: args, verbatim: false };
  }
  const quote = (value: string): string => {
    if (value.includes('"')) throw refuse(value);
    return `"${value}"`;
  };
  const line = [launcher, ...args].map(quote).join(" ");
  return {
    command: process.env["COMSPEC"] ?? "cmd.exe",
    argv: ["/d", "/s", "/c", `"${line}"`],
    verbatim: true,
  };
}
