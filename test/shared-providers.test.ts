/**
 * Provider selection shared by every tool that sends content to a model.
 *
 * `manni meta fill` and `manni docevals` read a provider and a model from a
 * flag or their own config key, and the names they accept, the refusals, and
 * the detection are one implementation. The config key is the only thing a
 * caller supplies, so each tool's message names the key its user wrote.
 */
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODELS, DEFAULT_OPENAI_BASE_URL } from "@hawkeyexl/inference";
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  assertKnownProvider,
  assertModelHasProvider,
  parseProviders,
  providerSpecFor,
  resolveIdentity,
  selectProvider,
  type ProviderConnections,
  type ProvidersConfig,
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

describe("parseProviders", () => {
  const SOURCE = "manni.config.yaml";
  const DIR = resolve("/repo");
  const parse = (value: unknown): ProvidersConfig =>
    parseProviders(value, SOURCE, DIR, toError);
  const refusal = (value: unknown): string => {
    try {
      parse(value);
    } catch (err) {
      expect(err).toBeInstanceOf(ToolFailure);
      return (err as Error).message;
    }
    throw new Error("expected a refusal");
  };

  it("reads every key, applying no defaults of its own", () => {
    expect(
      parse({
        provider: "openai",
        model: "gpt-x",
        anthropic: { apiKeyEnv: "A_KEY" },
        openai: { baseUrl: "http://127.0.0.1:1/v1", apiKeyEnv: "O_KEY" },
        "claude-cli": { command: "claude-next" },
        "llama-cpp": { modelsDir: "weights", thoughtTokens: 64 },
      }),
    ).toEqual({
      provider: "openai",
      model: "gpt-x",
      anthropic: { apiKeyEnv: "A_KEY" },
      openai: { baseUrl: "http://127.0.0.1:1/v1", apiKeyEnv: "O_KEY" },
      "claude-cli": { command: "claude-next" },
      "llama-cpp": { modelsDir: join(DIR, "weights"), thoughtTokens: 64 },
    });
  });

  it("reads an empty map, and a null one, as nothing set", () => {
    expect(parse({})).toEqual({});
    expect(parse(null)).toEqual({});
  });

  it("resolves a relative modelsDir from the config file's directory, and keeps an absolute one", () => {
    expect(parse({ "llama-cpp": { modelsDir: "../weights" } })["llama-cpp"]?.modelsDir).toBe(
      resolve(DIR, "../weights"),
    );
    const absolute = resolve("/elsewhere/weights");
    expect(parse({ "llama-cpp": { modelsDir: absolute } })["llama-cpp"]?.modelsDir).toBe(absolute);
  });

  it("accepts auto with no model", () => {
    expect(parse({ provider: "auto" })).toEqual({ provider: "auto" });
  });

  it("refuses a value that is not a mapping", () => {
    expect(refusal("anthropic")).toBe(`${SOURCE}: "providers" must be a mapping.`);
    expect(refusal(["anthropic"])).toBe(`${SOURCE}: "providers" must be a mapping.`);
  });

  it("refuses an unknown key, listing the supported ones", () => {
    expect(refusal({ gemini: {} })).toBe(
      `${SOURCE}: "providers" has unknown key "gemini". Supported keys: provider, model, anthropic, openai, claude-cli, llama-cpp.`,
    );
  });

  it("refuses an unknown key under each provider, listing that provider's keys", () => {
    expect(refusal({ anthropic: { baseUrl: "x" } })).toBe(
      `${SOURCE}: "providers.anthropic" has unknown key "baseUrl". Supported keys: apiKeyEnv.`,
    );
    expect(refusal({ openai: { model: "x" } })).toBe(
      `${SOURCE}: "providers.openai" has unknown key "model". Supported keys: baseUrl, apiKeyEnv.`,
    );
    expect(refusal({ "claude-cli": { x: 1 } })).toBe(
      `${SOURCE}: "providers.claude-cli" has unknown key "x". Supported keys: command.`,
    );
    expect(refusal({ "llama-cpp": { "models-dir": "w" } })).toBe(
      `${SOURCE}: "providers.llama-cpp" has unknown key "models-dir". Supported keys: modelsDir, thoughtTokens.`,
    );
  });

  it("refuses a provider section that is not a mapping", () => {
    expect(refusal({ openai: "http://localhost" })).toBe(
      `${SOURCE}: "providers.openai" must be a mapping.`,
    );
  });

  it("refuses a setting that is not a string", () => {
    expect(refusal({ openai: { baseUrl: 8080 } })).toBe(
      `${SOURCE}: "providers.openai.baseUrl" must be a string.`,
    );
    expect(refusal({ anthropic: { apiKeyEnv: true } })).toBe(
      `${SOURCE}: "providers.anthropic.apiKeyEnv" must be a string.`,
    );
    expect(refusal({ "claude-cli": { command: ["claude"] } })).toBe(
      `${SOURCE}: "providers.claude-cli.command" must be a string.`,
    );
    expect(refusal({ "llama-cpp": { modelsDir: 1 } })).toBe(
      `${SOURCE}: "providers.llama-cpp.modelsDir" must be a string.`,
    );
    expect(refusal({ provider: 1 })).toBe(`${SOURCE}: "providers.provider" must be a string.`);
    expect(refusal({ provider: "openai", model: 4 })).toBe(
      `${SOURCE}: "providers.model" must be a string.`,
    );
  });

  it("refuses a thoughtTokens that is not a whole number of 0 or more", () => {
    expect(refusal({ "llama-cpp": { thoughtTokens: -1 } })).toBe(
      `${SOURCE}: "providers.llama-cpp.thoughtTokens" must be a whole number of 0 or more, got -1.`,
    );
    expect(refusal({ "llama-cpp": { thoughtTokens: 1.5 } })).toBe(
      `${SOURCE}: "providers.llama-cpp.thoughtTokens" must be a whole number of 0 or more, got 1.5.`,
    );
    expect(refusal({ "llama-cpp": { thoughtTokens: "64" } })).toBe(
      `${SOURCE}: "providers.llama-cpp.thoughtTokens" must be a whole number of 0 or more, got "64".`,
    );
  });

  it("refuses an unknown provider name with the shared message", () => {
    expect(refusal({ provider: "gemini" })).toBe(
      `${SOURCE}: Unknown provider "gemini". Available: ${[...PROVIDERS].join(", ")}.`,
    );
  });

  it("refuses a model with no provider, or under auto", () => {
    const message =
      `${SOURCE}: "providers.model" was given without a provider: a model name does not say ` +
      `which provider owns it. Set providers.provider to one of anthropic, openai, claude-cli, ` +
      `llama-cpp, or drop the model to take the detected provider's default.`;
    expect(refusal({ model: "gpt-x" })).toBe(message);
    expect(refusal({ provider: "auto", model: "gpt-x" })).toBe(message);
  });
});

describe("selectProvider", () => {
  it("is auto with no model when nothing is stated", () => {
    expect(selectProvider({}, [{}, {}])).toEqual({ provider: "auto", model: undefined });
  });

  it("takes the provider from the highest level that states one", () => {
    const tool = { provider: "openai" };
    const family = { provider: "anthropic" };
    expect(selectProvider({}, [{}, family])).toEqual({ provider: "anthropic", model: undefined });
    expect(selectProvider({}, [tool, family])).toEqual({ provider: "openai", model: undefined });
    expect(selectProvider({ provider: "claude-cli" }, [tool, family])).toEqual({
      provider: "claude-cli",
      model: undefined,
    });
  });

  it("lets an explicit auto at a higher level beat a named provider below it", () => {
    expect(selectProvider({}, [{ provider: "auto" }, { provider: "anthropic" }])).toEqual({
      provider: "auto",
      model: undefined,
    });
  });

  it("takes the model from the level the provider came from", () => {
    expect(
      selectProvider({}, [{}, { provider: "anthropic", model: "family-model" }]),
    ).toEqual({ provider: "anthropic", model: "family-model" });
    expect(
      selectProvider({}, [
        { provider: "openai", model: "tool-model" },
        { provider: "anthropic", model: "family-model" },
      ]),
    ).toEqual({ provider: "openai", model: "tool-model" });
  });

  it("does not carry a model to a provider another level named", () => {
    // The family's model belongs to the family's provider.
    expect(
      selectProvider({}, [{ provider: "openai" }, { provider: "anthropic", model: "family-model" }]),
    ).toEqual({ provider: "openai", model: undefined });
    // Nor does a flag's provider inherit a model named for another.
    expect(
      selectProvider({ provider: "anthropic" }, [{ provider: "openai", model: "tool-model" }]),
    ).toEqual({ provider: "anthropic", model: undefined });
  });

  it("carries a model whose level names the provider in force", () => {
    expect(
      selectProvider({ provider: "openai" }, [{ provider: "openai", model: "tool-model" }]),
    ).toEqual({ provider: "openai", model: "tool-model" });
  });

  it("lets a level that names no provider give its model to the provider in force", () => {
    expect(
      selectProvider({}, [{ model: "tool-model" }, { provider: "anthropic", model: "family-model" }]),
    ).toEqual({ provider: "anthropic", model: "tool-model" });
    expect(selectProvider({ provider: "openai" }, [{ model: "tool-model" }])).toEqual({
      provider: "openai",
      model: "tool-model",
    });
  });

  it("applies the flag's model to whichever provider wins", () => {
    expect(
      selectProvider({ model: "flag-model" }, [{}, { provider: "anthropic", model: "family-model" }]),
    ).toEqual({ provider: "anthropic", model: "flag-model" });
  });
});

describe("providerSpecFor", () => {
  const CONNECTIONS: ProviderConnections = {
    anthropic: { apiKeyEnv: "A_KEY" },
    openai: { baseUrl: "http://127.0.0.1:1/v1", apiKeyEnv: "O_KEY" },
    "claude-cli": { command: "claude-next" },
    "llama-cpp": { modelsDir: "/weights", thoughtTokens: 64 },
  };

  it("hands each named provider its own connection settings", () => {
    expect(providerSpecFor(CONNECTIONS, { provider: "anthropic", model: "m" })).toEqual({
      provider: "anthropic",
      model: "m",
      apiKeyEnv: "A_KEY",
    });
    expect(providerSpecFor(CONNECTIONS, { provider: "openai", model: null })).toEqual({
      provider: "openai",
      model: null,
      apiKeyEnv: "O_KEY",
      baseUrl: "http://127.0.0.1:1/v1",
    });
    expect(providerSpecFor(CONNECTIONS, { provider: "claude-cli", model: null })).toEqual({
      provider: "claude-cli",
      model: null,
      command: "claude-next",
    });
    expect(providerSpecFor(CONNECTIONS, { provider: "llama-cpp", model: null })).toEqual({
      provider: "llama-cpp",
      model: null,
      llamaCpp: { thoughtTokens: 64, modelsDirectory: "/weights" },
    });
    expect(providerSpecFor(CONNECTIONS, { provider: "mock", model: "m" })).toEqual({
      provider: "mock",
      model: "m",
    });
  });

  it("fills the documented defaults when nothing is set", () => {
    expect(providerSpecFor({}, { provider: "anthropic", model: null })).toMatchObject({
      apiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(providerSpecFor({}, { provider: "openai", model: null })).toMatchObject({
      apiKeyEnv: "OPENAI_API_KEY",
      baseUrl: DEFAULT_OPENAI_BASE_URL,
    });
    expect(providerSpecFor({}, { provider: "claude-cli", model: null })).toMatchObject({
      command: "claude",
    });
    expect(providerSpecFor({}, { provider: "llama-cpp", model: null }).llamaCpp).toEqual({
      thoughtTokens: 0,
    });
  });

  it("hands detection under auto every setting it reads", () => {
    expect(providerSpecFor(CONNECTIONS, { provider: "auto", model: null })).toEqual({
      provider: "auto",
      model: null,
      baseUrl: "http://127.0.0.1:1/v1",
      command: "claude-next",
      llamaCpp: { thoughtTokens: 64, modelsDirectory: "/weights" },
    });
  });

  it("hands detection no baseUrl the user did not set", () => {
    // The library counts a baseUrl as a reason openai is usable, so the
    // default endpoint must not reach detection: it would select openai on a
    // machine that has no key for it.
    expect(providerSpecFor({}, { provider: "auto", model: null })).toEqual({
      provider: "auto",
      model: null,
    });
  });

  it("lets detection see a configured baseUrl", async () => {
    const saved = { ...process.env };
    try {
      process.env["ANTHROPIC_API_KEY"] = "";
      process.env["OPENAI_API_KEY"] = "";
      const spec = providerSpecFor(
        { openai: { baseUrl: "http://127.0.0.1:1/v1" } },
        { provider: "auto", model: null },
      );
      await expect(resolveIdentity(spec, toError)).resolves.toEqual({
        provider: "openai",
        model: DEFAULT_MODELS.openai,
      });
    } finally {
      process.env = saved;
    }
  });
});
