/**
 * Choosing the provider and model for `manni kg fill`, and mapping the
 * family's connection settings onto the library's `ProviderSpec`.
 *
 * The providers themselves are the shared inference library's and are tested
 * there; the names, the refusals, detection, the level-bound precedence and
 * the settings mapping are `src/shared/providers.ts`, the code
 * `manni meta fill` and `manni docevals` run. What kg still owns is which
 * levels it reads: a flag, then `kg.provider`/`kg.model`, then the family's
 * top-level `providers:`, then `auto` (proposal 0051 §3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseConfig } from "../../../src/kg/core/config.js";
import {
  assertProviderSelection,
  providerSpecFor,
  resolveProviderIdentity,
  selectProvider,
} from "../../../src/kg/llm/provider.js";
import { PROVIDERS } from "../../../src/shared/providers.js";
import { resetWarnings } from "../../../src/shared/warn.js";
import { KgError } from "../../../src/kg/types.js";

const PATH = "/fake/manni.config.yaml";
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** The providers a message offers, and the same list plus `auto`. */
const NAMES = "anthropic, openai, claude-cli, llama-cpp";
const LISTED = `${NAMES}, auto`;

/** A family file: a top-level `providers:` body and a `kg:` body. */
function family(providers: string[], kg: string[] = []) {
  return parseConfig(
    [
      ...(providers.length === 0
        ? []
        : ["providers:", ...providers.map((l) => `  ${l}`)]),
      "kg:",
      ...(kg.length === 0 ? ["  {}"] : kg.map((l) => `  ${l}`)),
      "",
    ].join("\n"),
    PATH,
  );
}

describe("selectProvider", () => {
  it("defaults to auto with no model", () => {
    expect(selectProvider(family([]))).toEqual({
      provider: "auto",
      model: undefined,
    });
  });

  it("reads the section keys kg.provider and kg.model", () => {
    expect(
      selectProvider(family([], ["provider: openai", "model: some-model"])),
    ).toEqual({ provider: "openai", model: "some-model" });
  });

  it("falls back to the family providers: map", () => {
    expect(
      selectProvider(family(["provider: openai", "model: family-model"])),
    ).toEqual({ provider: "openai", model: "family-model" });
  });

  it("prefers kg.provider over providers.provider", () => {
    const config = family(
      ["provider: openai", "model: family-model"],
      ["provider: anthropic"],
    );
    // The family's model belongs to the family's provider, which lost, so it
    // is not lent to the winner (shared level-bound precedence).
    expect(selectProvider(config)).toEqual({
      provider: "anthropic",
      model: undefined,
    });
  });

  it("prefers --provider over every configured level", () => {
    const config = family(["provider: openai"], ["provider: anthropic"]);
    expect(selectProvider(config, { provider: "claude-cli" })).toEqual({
      provider: "claude-cli",
      model: undefined,
    });
  });

  it("--local forces llama-cpp and names what it replaced", () => {
    const config = family([], ["provider: anthropic"]);
    expect(selectProvider(config, { local: true })).toEqual({
      provider: "llama-cpp",
      model: undefined,
      replaced: { provider: "anthropic", source: "kg.provider" },
    });
  });

  it("--local names a family-level provider it replaced", () => {
    const config = family(["provider: openai"]);
    expect(selectProvider(config, { local: true })).toMatchObject({
      provider: "llama-cpp",
      replaced: { provider: "openai", source: "providers.provider" },
    });
  });

  it("refuses --local beside a hosted --provider, as a KgError", () => {
    expect(() =>
      selectProvider(family([]), { local: true, provider: "anthropic" }),
    ).toThrow(KgError);
    expect(() =>
      selectProvider(family([]), { local: true, provider: "anthropic" }),
    ).toThrow(
      "--local and --provider anthropic contradict each other: --local runs inference on " +
        "this machine with llama-cpp. Drop one of them.",
    );
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

  it("refuses an unknown provider with the family's message", () => {
    const refuse = (): void => {
      assertProviderSelection({ provider: "gemini", model: undefined });
    };
    expect(refuse).toThrow(KgError);
    expect(refuse).toThrow(`Unknown provider "gemini". Available: ${LISTED}.`);
  });

  it("refuses a model under auto, naming kg.provider", () => {
    const refuse = (): void => {
      assertProviderSelection({ provider: "auto", model: "some-model" });
    };
    expect(refuse).toThrow(KgError);
    expect(refuse).toThrow(
      `Model "some-model" was given without a provider: a model name does not say ` +
        `which provider owns it. Set --provider or kg.provider to one of ${NAMES}, ` +
        `or drop the model to take the detected provider's default.`,
    );
  });
});

describe("providerSpecFor", () => {
  it("takes anthropic's connection settings from the family map", () => {
    const config = family(["anthropic:", "  apiKeyEnv: MY_KEY"]);
    const spec = providerSpecFor(config, {
      provider: "anthropic",
      model: "m",
    });
    expect(spec).toMatchObject({
      provider: "anthropic",
      model: "m",
      apiKeyEnv: "MY_KEY",
    });
  });

  it("takes openai's baseUrl from the family map", () => {
    const config = family(["openai:", "  baseUrl: http://localhost:11434/v1"]);
    const spec = providerSpecFor(config, { provider: "openai", model: null });
    expect(spec).toMatchObject({
      provider: "openai",
      baseUrl: "http://localhost:11434/v1",
    });
  });

  it("takes claude-cli's command from the family map", () => {
    const config = family(["claude-cli:", "  command: my-claude"]);
    const spec = providerSpecFor(config, {
      provider: "claude-cli",
      model: null,
    });
    expect(spec).toMatchObject({ provider: "claude-cli", command: "my-claude" });
  });
});

describe("resolveProviderIdentity", () => {
  it("resolves --local to llama-cpp without detecting, and says so once", async () => {
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
      const config = family([], ["provider: anthropic"]);
      const flags = { local: true, model: "granite-4.1-3b-q2" };
      await expect(resolveProviderIdentity(config, flags)).resolves.toEqual({
        provider: "llama-cpp",
        model: "granite-4.1-3b-q2",
      });
      await resolveProviderIdentity(config, flags);
      expect(written).toEqual([
        'manni: --local: using llama-cpp instead of "anthropic" from kg.provider.\n',
      ]);
    } finally {
      spy.mockRestore();
      resetWarnings();
    }
  });

  it("resolves a named provider without reaching the network", async () => {
    const config = family([], ["provider: mock"]);
    await expect(resolveProviderIdentity(config)).resolves.toMatchObject({
      provider: "mock",
    });
  });
});
