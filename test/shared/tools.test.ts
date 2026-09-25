/**
 * `tools:`, the family-level home for an outside tool's settings (proposal
 * 0052, in the shape lint's 0050 recorded). Each tool gets a namespace of its
 * own keys. Vale's one key names its config file, and DITA Open Toolkit's
 * names the directory it is installed in.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ditaOtHome, parseTools, valeConfigPath } from "../../src/shared/tools.js";

const SOURCE = "manni.config.yaml";
const toError = (message: string): Error => new Error(message);
const parse = (raw: unknown) => parseTools(raw, SOURCE, toError);

describe("parseTools", () => {
  it("reads Vale's config path", () => {
    expect(parse({ vale: { config: ".vale.ini" } })).toEqual({
      vale: { config: ".vale.ini" },
    });
  });

  it("accepts a Vale namespace with no keys", () => {
    expect(parse({ vale: {} })).toEqual({ vale: {} });
  });

  it("accepts an empty tools mapping", () => {
    expect(parse({})).toEqual({});
  });

  it("treats a bare `tools:` as no tools", () => {
    expect(parse(null)).toEqual({});
  });

  it.each([
    ["a list", ["vale"]],
    ["a string", "vale"],
  ])("refuses tools given as %s", (_label, raw) => {
    expect(() => parse(raw)).toThrow(`${SOURCE}: "tools" must be a mapping.`);
  });

  it("refuses a tool it does not know, naming the ones it does", () => {
    expect(() => parse({ prettier: {} })).toThrow(
      `${SOURCE}: tools has unknown key "prettier". Supported keys: vale, dita-ot.`,
    );
  });

  it("refuses a Vale namespace that is not a mapping", () => {
    expect(() => parse({ vale: ".vale.ini" })).toThrow(
      `${SOURCE}: tools.vale must be a mapping.`,
    );
  });

  it("refuses a Vale key it does not know", () => {
    expect(() => parse({ vale: { command: ["vale"] } })).toThrow(
      `${SOURCE}: tools.vale has unknown key "command". Supported keys: config.`,
    );
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["a number", 3],
    ["a list", [".vale.ini"]],
  ])("refuses a Vale config path that is %s", (_label, config) => {
    expect(() => parse({ vale: { config } })).toThrow(
      `${SOURCE}: tools.vale.config must be a non-empty string.`,
    );
  });
});

describe("valeConfigPath", () => {
  // `ConfigFile.dir` is always absolute.
  const dir = join(process.cwd(), "repo", "root");

  it("resolves the config path against the config file's directory", () => {
    expect(valeConfigPath({ vale: { config: ".vale.ini" } }, dir)).toBe(
      join(dir, ".vale.ini"),
    );
  });

  it("keeps an absolute path as written", () => {
    const absolute = join(process.cwd(), "styles", ".vale.ini");
    expect(valeConfigPath({ vale: { config: absolute } }, dir)).toBe(absolute);
  });

  it("is undefined when no path is set, so Vale finds its own", () => {
    expect(valeConfigPath({}, dir)).toBeUndefined();
    expect(valeConfigPath({ vale: {} }, dir)).toBeUndefined();
  });
});

describe("parseTools: DITA Open Toolkit", () => {
  it("reads the installation directory", () => {
    expect(parse({ "dita-ot": { home: "/opt/dita-ot" } })).toEqual({
      "dita-ot": { home: "/opt/dita-ot" },
    });
  });

  it("reads it beside Vale, because a namespace is per tool", () => {
    expect(
      parse({ vale: { config: ".vale.ini" }, "dita-ot": { home: "/opt/dita-ot" } }),
    ).toEqual({
      vale: { config: ".vale.ini" },
      "dita-ot": { home: "/opt/dita-ot" },
    });
  });

  it("accepts the namespace with no keys", () => {
    expect(parse({ "dita-ot": {} })).toEqual({ "dita-ot": {} });
  });

  it("refuses a key it never reads", () => {
    expect(() => parse({ "dita-ot": { path: "/opt/dita-ot" } })).toThrow(
      `${SOURCE}: tools.dita-ot has unknown key "path". Supported keys: home.`,
    );
  });

  it("refuses a home that is not a usable string", () => {
    for (const home of ["", "   ", 7, null, []]) {
      expect(() => parse({ "dita-ot": { home } })).toThrow(
        `${SOURCE}: tools.dita-ot.home must be a non-empty string.`,
      );
    }
  });

  it("refuses a namespace that is not a mapping", () => {
    expect(() => parse({ "dita-ot": "/opt/dita-ot" })).toThrow(
      `${SOURCE}: tools.dita-ot must be a mapping.`,
    );
  });
});

describe("ditaOtHome", () => {
  const dir = join(process.cwd(), "repo", "root");

  it("resolves a relative home against the config file's directory", () => {
    expect(ditaOtHome({ "dita-ot": { home: "vendor/dita-ot" } }, dir)).toBe(
      join(dir, "vendor", "dita-ot"),
    );
  });

  it("keeps an absolute home as written", () => {
    const absolute = join(process.cwd(), "opt", "dita-ot");
    expect(ditaOtHome({ "dita-ot": { home: absolute } }, dir)).toBe(absolute);
  });

  // Unset means the `dita` on PATH, which is how a person runs it.
  it("is undefined when no home is set", () => {
    expect(ditaOtHome({}, dir)).toBeUndefined();
    expect(ditaOtHome({ "dita-ot": {} }, dir)).toBeUndefined();
  });
});
