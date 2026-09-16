/**
 * Choosing the provider and model. The providers themselves are the shared
 * inference library's; the names, the refusals, `--local`, detection and the
 * level-bound precedence are `src/shared/providers.ts`, the same code
 * `manni meta fill` and `manni docevals` run. What manni tracevals still owns
 * is which levels it reads — a flag, an eval's own `provider:`/`model:`,
 * `tracevals.provider`/`model`, then the family's `providers:` — and the
 * judge-shaped options, so that is what these pin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../../src/tracevals/core/config.js";
import {
  assertProviderSelection,
  makeJudgeProvider,
  providerSpecFor,
  resolveProviderIdentity,
  selectProvider,
} from "../../../src/tracevals/judge/provider.js";
import { PROVIDERS, type ProvidersConfig } from "../../../src/shared/providers.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import { TracevalsError } from "../../../src/tracevals/types.js";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const NAMES = "anthropic, openai, claude-cli, llama-cpp";
const LISTED = `${NAMES}, auto`;

/** A parsed section, with the family's top-level `providers:` beside it. */
function family(
  providers: ProvidersConfig,
  tracevals: Record<string, unknown> = {},
) {
  return parseConfig(tracevals, { source: "manni.config.yaml", providers });
}

describe("selectProvider", () => {
  it("defaults to auto with no model", () => {
    expect(selectProvider(parseConfig({}))).toEqual({
      provider: "auto",
      model: undefined,
    });
  });

  it("reads tracevals.provider and tracevals.model", () => {
    const config = parseConfig({ provider: "openai", model: "some-model" });
    expect(selectProvider(config)).toEqual({
      provider: "openai",
      model: "some-model",
    });
  });

  it("lets a flag beat the config, carrying the config's model only to its own provider", () => {
    const config = parseConfig({ provider: "openai", model: "some-model" });
    expect(selectProvider(config, { provider: "anthropic" })).toEqual({
      provider: "anthropic",
      model: undefined,
    });
    expect(selectProvider(config, { provider: "openai" })).toEqual({
      provider: "openai",
      model: "some-model",
    });
    expect(selectProvider(config, { model: "other" })).toEqual({
      provider: "openai",
      model: "other",
    });
  });

  it("lets an eval beat the config, and a flag beat the eval", () => {
    const config = parseConfig({ provider: "openai" });
    expect(selectProvider(config, {}, { provider: "claude-cli", model: "m" })).toEqual({
      provider: "claude-cli",
      model: "m",
    });
    expect(
      selectProvider(
        config,
        { provider: "anthropic", model: "f" },
        { provider: "claude-cli", model: "m" },
      ),
    ).toEqual({ provider: "anthropic", model: "f" });
  });

  it("does not carry the config's model to a provider an eval names", () => {
    const config = parseConfig({ provider: "anthropic", model: "a-model" });
    expect(selectProvider(config, {}, { provider: "openai" })).toEqual({
      provider: "openai",
      model: undefined,
    });
    expect(selectProvider(config, {}, { provider: "anthropic" })).toEqual({
      provider: "anthropic",
      model: "a-model",
    });
  });

  it("falls back to the family's providers.provider and its model", () => {
    const config = family({ provider: "openai", model: "family-model" });
    expect(selectProvider(config)).toEqual({
      provider: "openai",
      model: "family-model",
    });
  });

  it("lets tracevals.provider beat the family's, without the family's model", () => {
    const config = family(
      { provider: "openai", model: "family-model" },
      { provider: "anthropic" },
    );
    expect(selectProvider(config)).toEqual({
      provider: "anthropic",
      model: undefined,
    });
  });

  it("gives tracevals.model to the family's provider when tracevals names none", () => {
    const config = family(
      { provider: "openai", model: "family-model" },
      { model: "tool-model" },
    );
    expect(selectProvider(config)).toEqual({
      provider: "openai",
      model: "tool-model",
    });
  });
});

describe("selectProvider under --local", () => {
  it("overrides tracevals.provider, naming it as the source replaced", () => {
    const config = parseConfig({ provider: "anthropic", model: "claude-x" });
    expect(selectProvider(config, { local: true })).toEqual({
      provider: "llama-cpp",
      model: undefined,
      replaced: { provider: "anthropic", source: "tracevals.provider" },
    });
  });

  it("overrides the family's providers.provider, naming it", () => {
    const config = family({ provider: "openai" });
    expect(selectProvider(config, { local: true })).toEqual({
      provider: "llama-cpp",
      model: undefined,
      replaced: { provider: "openai", source: "providers.provider" },
    });
  });

  it("overrides an eval's own provider, naming the origin the caller gives", () => {
    const config = parseConfig({ provider: "anthropic" });
    expect(
      selectProvider(
        config,
        { local: true },
        { provider: "openai", origin: 'eval "used-read" in SKILL.md' },
      ).replaced,
    ).toEqual({ provider: "openai", source: 'eval "used-read" in SKILL.md' });
  });

  it("keeps tracevals.model when tracevals.provider is llama-cpp", () => {
    const config = parseConfig({ provider: "llama-cpp", model: "granite-4.1-3b-q2" });
    expect(selectProvider(config, { local: true })).toEqual({
      provider: "llama-cpp",
      model: "granite-4.1-3b-q2",
    });
  });

  it("refuses --provider naming a hosted provider, as a TracevalsError", () => {
    expect(() =>
      selectProvider(parseConfig({}), { local: true, provider: "anthropic" }),
    ).toThrow(
      new TracevalsError(
        "--local and --provider anthropic contradict each other: --local runs inference on " +
          "this machine with llama-cpp. Drop one of them.",
      ),
    );
  });

  it("names the replaced choice once, and never detects", async () => {
    const written: string[] = [];
    resetWarnings();
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        written.push(String(chunk));
        return true;
      });
    try {
      process.env["ANTHROPIC_API_KEY"] = "test-key";
      const config = parseConfig({ provider: "anthropic" });
      const flags = { local: true, model: "granite-4.1-3b-q2" };
      await expect(resolveProviderIdentity(config, flags)).resolves.toEqual({
        provider: "llama-cpp",
        model: "granite-4.1-3b-q2",
      });
      await resolveProviderIdentity(config, flags);
      expect(written).toEqual([
        'manni: --local: using llama-cpp instead of "anthropic" from tracevals.provider.\n',
      ]);
    } finally {
      spy.mockRestore();
      resetWarnings();
    }
  });
});

describe("assertProviderSelection", () => {
  it("accepts every name the shared list offers", () => {
    for (const provider of PROVIDERS) {
      expect(() => {
        assertProviderSelection({ provider, model: undefined });
      }).not.toThrow();
    }
  });

  it("refuses an unknown provider, as a TracevalsError, without naming mock", () => {
    const refuse = (): void => {
      assertProviderSelection({ provider: "gemini", model: undefined });
    };
    expect(refuse).toThrow(TracevalsError);
    expect(refuse).toThrow(`Unknown provider "gemini". Available: ${LISTED}.`);
  });

  it("refuses a model under auto, naming tracevals.provider", () => {
    const refuse = (): void => {
      assertProviderSelection({ provider: "auto", model: "some-model" });
    };
    expect(refuse).toThrow(TracevalsError);
    expect(refuse).toThrow(
      `Model "some-model" was given without a provider: a model name does not say ` +
        `which provider owns it. Set --provider or tracevals.provider to one of ${NAMES}, ` +
        `or drop the model to take the detected provider's default.`,
    );
  });
});

describe("providerSpecFor", () => {
  it("maps the family's connection settings, and keeps a verdict-shaped tool name", () => {
    const config = family({ anthropic: { apiKeyEnv: "MY_KEY" } });
    const spec = providerSpecFor(config, { provider: "anthropic", model: "m" });
    expect(spec).toMatchObject({
      provider: "anthropic",
      model: "m",
      apiKeyEnv: "MY_KEY",
      anthropic: { toolName: "record_verdict" },
    });
  });

  it("pins no model of its own: an unnamed model stays null for the library to fill", () => {
    const spec = providerSpecFor(parseConfig({}), {
      provider: "claude-cli",
      model: null,
    });
    expect(spec.model).toBeNull();
    expect(spec).toMatchObject({ provider: "claude-cli", command: "claude" });
  });

  it("seeds the mock seam with caller-supplied responses", async () => {
    const provider = await makeJudgeProvider(
      parseConfig({}),
      { provider: "mock" },
      {},
      { mockResponses: [{ json: { custom: true } }] },
    );
    const response = await provider.completeJSON({
      system: "s",
      user: "u",
      schema: {},
      temperature: 0,
    });
    expect(response.json).toEqual({ custom: true });
  });
});

describe("makeJudgeProvider", () => {
  it("builds the mock seam without touching the network or a key", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const provider = await makeJudgeProvider(parseConfig({}), { provider: "mock" });
    expect(provider.provider()).toBe("mock");
  });

  it("wraps a construction failure as an operational error", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const config = parseConfig({ provider: "anthropic" });
    await expect(makeJudgeProvider(config)).rejects.toThrow(TracevalsError);
  });

  it("rejects an unknown --provider value from the CLI", async () => {
    await expect(
      makeJudgeProvider(parseConfig({}), { provider: "gemini" }),
    ).rejects.toThrow(TracevalsError);
  });
});
