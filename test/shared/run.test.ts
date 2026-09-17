import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { endOutputOnClosedReader } from "../../src/shared/run.js";

function streamError(code: string): Error {
  return Object.assign(new Error(`${code}: write`), { code });
}

describe("endOutputOnClosedReader", () => {
  it("swallows EPIPE on each stream it is given", () => {
    const out = new EventEmitter();
    const err = new EventEmitter();
    endOutputOnClosedReader([out, err]);
    expect(() => out.emit("error", streamError("EPIPE"))).not.toThrow();
    expect(() => err.emit("error", streamError("EPIPE"))).not.toThrow();
  });

  it("lets any other stream error surface", () => {
    const out = new EventEmitter();
    endOutputOnClosedReader([out]);
    expect(() => out.emit("error", streamError("EIO"))).toThrow(/EIO/);
  });
});
