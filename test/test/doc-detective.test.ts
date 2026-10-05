/**
 * How `doc-detective` is started. On Windows an npm global install puts a
 * `.cmd` shim on PATH, and `cmd.exe` caps the shim's command line at 8191
 * characters, so the bin script beside it is run with node directly.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TestError } from "../../src/test/errors.js";
import { assertFitsCommandLine, launchFor } from "../../src/test/core/doc-detective.js";

const BIN = join("C:", "nodejs");
const SHIM = join(BIN, "doc-detective.cmd");
const SCRIPT = join(BIN, "node_modules", "doc-detective", "bin", "doc-detective.js");

describe("launchFor", () => {
  it("runs the bare name off Windows", () => {
    expect(launchFor(["-i", "a.md"], { platform: "linux", path: "/usr/bin", isFile: () => true })).toEqual({
      command: "doc-detective",
      args: ["-i", "a.md"],
      viaShim: false,
    });
  });

  it("runs the shim's bin script with node on Windows", () => {
    const files = new Set([SHIM, SCRIPT]);
    const launch = launchFor(["-i", "a.md"], {
      platform: "win32",
      path: `C:\\elsewhere;${BIN}`,
      isFile: (p) => files.has(p),
    });
    expect(launch).toEqual({ command: process.execPath, args: [SCRIPT, "-i", "a.md"], viaShim: false });
  });

  it("falls back to the shim when no bin script sits beside it", () => {
    const launch = launchFor(["-i", "a.md"], {
      platform: "win32",
      path: BIN,
      isFile: (p) => p === SHIM,
    });
    expect(launch).toEqual({ command: "doc-detective", args: ["-i", "a.md"], viaShim: true });
  });
});

describe("assertFitsCommandLine", () => {
  const LIMIT =
    "the selected inputs exceed the command-line limit. Narrow the collection, or set input in the Doc Detective config.";

  it("lets an ordinary command line through", () => {
    expect(() => {
      assertFitsCommandLine({ command: "node", args: ["-i", "a.md"], viaShim: false }, "win32");
    }).not.toThrow();
  });

  it("refuses one past the cap on Windows", () => {
    const long = "x".repeat(40_000);
    expect(() => {
      assertFitsCommandLine({ command: "node", args: ["-i", long], viaShim: false }, "win32");
    }).toThrow(new TestError(LIMIT));
  });

  it("holds a shim to cmd.exe's lower cap", () => {
    const long = "x".repeat(9_000);
    expect(() => {
      assertFitsCommandLine({ command: "doc-detective", args: ["-i", long], viaShim: true }, "win32");
    }).toThrow(new TestError(LIMIT));
  });

  it("has no cap to hold off Windows", () => {
    const long = "x".repeat(40_000);
    expect(() => {
      assertFitsCommandLine({ command: "doc-detective", args: ["-i", long], viaShim: false }, "linux");
    }).not.toThrow();
  });
});
