/**
 * The name the running bin was invoked as, for stderr prefixes.
 *
 * One package ships two bins: `manni`, and `docmeta` for the scripts written
 * before the rename. A diagnostic should name the command the user typed, so
 * the prefix is settled once by whichever entry point ran (`runProgram`) and
 * read by whoever writes to stderr. Library callers never set it, and get the
 * primary bin's name.
 */
let name = "manni";

export function programName(): string {
  return name;
}

export function setProgramName(value: string): void {
  name = value;
}
