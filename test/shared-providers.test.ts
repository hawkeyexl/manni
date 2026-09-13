/**
 * Provider selection shared by every tool that sends content to a model.
 *
 * `manni meta fill` and `manni docevals` read a provider and a model from a
 * flag or their own config key, and the names they accept, the refusals, and
 * the detection are one implementation. The config key is the only thing a
 * caller supplies, so each tool's message names the key its user wrote.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS } from "@hawkeyexl/inference";
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  assertKnownProvider,
  assertModelHasProvider,
  resolveIdentity,
} from "../src/shared/providers.js";

class ToolFailure extends Error {}
const toError = (message: string): Error => new ToolFailure(message);

describe("PROVIDERS", () => {
  it("is the library's provider names plus auto", () => {
    expect([...PROVIDERS]).toEqual([...Object.keys(DEFAULT_MODELS), "auto"]);
  });

  it("defaults to auto", () => {
    expect(DEFAULT_PROVIDER).toBe("auto");
  });
});

describe("assertKnownProvider", () => {
  it("accepts every listed name", () => {
    for (const name of PROVIDERS) {
      expect(() => { assertKnownProvider(name, toError); }).not.toThrow();
    }
  });

  it("refuses an unknown name in the caller's error class, listing the names", () => {
    expect(() => { assertKnownProvider("gemini", toError); }).toThrow(ToolFailure);
    expect(() => { assertKnownProvider("gemini", toError); }).toThrow(
      `Unknown provider "gemini". Available: ${[...PROVIDERS].join(", ")}.`,
    );
  });
});

describe("assertModelHasProvider", () => {
  it("allows a model under a named provider, and no model under auto", () => {
    expect(() => { assertModelHasProvider("openai", "m", "fill.provider", toError); }).not.toThrow();
    expect(() => { assertModelHasProvider("auto", undefined, "fill.provider", toError); }).not.toThrow();
  });

  it("refuses a model under auto, naming the caller's config key", () => {
    const names = Object.keys(DEFAULT_MODELS).join(", ");
    for (const key of ["fill.provider", "docevals.provider"]) {
      expect(() => { assertModelHasProvider("auto", "some-model", key, toError); }).toThrow(
        `Model "some-model" was given without a provider: a model name does not say ` +
          `which provider owns it. Set --provider or ${key} to one of ${names}, ` +
          `or drop the model to take the detected provider's default.`,
      );
    }
    expect(() => { assertModelHasProvider("auto", "m", "k", toError); }).toThrow(ToolFailure);
  });
});

describe("resolveIdentity", () => {
  it("returns the named provider's default model when none is given", async () => {
    await expect(
      resolveIdentity({ provider: "openai", model: null }, toError),
    ).resolves.toEqual({ provider: "openai", model: DEFAULT_MODELS.openai });
  });

  it("detects under auto, never returning auto itself", async () => {
    const saved = { ...process.env };
    try {
      process.env["ANTHROPIC_API_KEY"] = "";
      process.env["OPENAI_API_KEY"] = "x";
      const identity = await resolveIdentity({ provider: "auto", model: null }, toError);
      expect(identity).toEqual({ provider: "openai", model: DEFAULT_MODELS.openai });
    } finally {
      process.env = saved;
    }
  });
});
