/**
 * Choosing the provider and model, and mapping the connection settings onto
 * the library's `ProviderSpec`. The providers themselves are the shared
 * inference library's and are tested there; the names, refusals, detection,
 * the level-bound precedence and the settings mapping are
 * `src/shared/providers.ts`, shared with `manni meta fill`. What manni
 * docevals still owns is which levels it reads (flag, eval, `docevals`, the
 * family's `providers:`) and the judge-shaped options, so that is what these
 * pin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWarnings } from "../../../src/shared/warn.js";
import { resolve } from "node:path";
import { DEFAULT_MODELS } from "@hawkeyexl/inference";
import { parseDocevalsConfig } from "../helpers/config.js";
import { parseConfig } from "../../../src/docevals/core/config.js";
import {
  assertProviderSelection,
  makeProvider,
  providerSpecFor,
  resolveProviderIdentity,
  selectProvider,
} from "../../../src/docevals/judge/provider.js";
import { PROVIDERS } from "../../../src/shared/providers.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const PATH = "/fake/manni.config.yaml";
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const NAMES = Object.keys(DEFAULT_MODELS).join(", ");

/** A family file: the top-level `providers:` body, and a `docevals:` body. */
function family(providers: string[], docevals: string[] = []) {
  return parseConfig(
    [
      "providers:",
      ...providers.map((l) => `  ${l}`),
      "docevals:",
      ...(docevals.length === 0 ? ["  {}"] : docevals.map((l) => `  ${l}`)),
      "",
    ].join("\n"),
    PATH,
  );
}

describe("selectProvider", () => {
  it("defaults to auto with no model", () => {
    const config = parseDocevalsConfig("", PATH);
    expect(selectProvider(config)).toEqual({ provider: "auto", model: undefined });
  });

  it("reads the flat config keys", () => {
    const config = parseDocevalsConfig("provider: openai\nmodel: some-model\n", PATH);
    expect(selectProvider(config)).toEqual({ provider: "openai", model: "some-model" });
  });

  it("lets a flag beat the config, and carries the config's model only to its own provider", () => {
    const config = parseDocevalsConfig("provider: openai\nmodel: some-model\n", PATH);
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
    const config = parseDocevalsConfig("provider: openai\n", PATH);
    expect(selectProvider(config, {}, { provider: "claude-cli", model: "m" })).toEqual({
      provider: "claude-cli",
      model: "m",
    });
    expect(
      selectProvider(config, { provider: "anthropic", model: "f" }, { provider: "claude-cli", model: "m" }),
    ).toEqual({ provider: "anthropic", model: "f" });
  });

  it("does not carry the config's model to a provider an eval names", () => {
    // The config's model belongs to the config's provider. An eval asking for
    // another provider takes that provider's default, not a model it cannot run.
    const config = parseDocevalsConfig("provider: anthropic\nmodel: a-model\n", PATH);
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
    const config = family(["provider: openai", "model: family-model"]);
    expect(selectProvider(config)).toEqual({ provider: "openai", model: "family-model" });
  });

  it("lets docevals.provider beat the family's, without the family's model", () => {
    const config = family(["provider: openai", "model: family-model"], ["provider: anthropic"]);
    expect(selectProvider(config)).toEqual({ provider: "anthropic", model: undefined });
  });

  it("lets an explicit docevals.provider: auto beat a named family provider", () => {
    const config = family(["provider: openai"], ["provider: auto"]);
    expect(selectProvider(config)).toEqual({ provider: "auto", model: undefined });
  });

  it("gives docevals.model to the family's provider when docevals names none", () => {
    const config = family(["provider: openai", "model: family-model"], ["model: tool-model"]);
    expect(selectProvider(config)).toEqual({ provider: "openai", model: "tool-model" });
  });

  it("lets an eval beat the family's provider, and a flag beat both", () => {
    const config = family(["provider: openai", "model: family-model"]);
    expect(selectProvider(config, {}, { provider: "claude-cli" })).toEqual({
      provider: "claude-cli",
      model: undefined,
    });
    expect(selectProvider(config, { provider: "anthropic" }, { provider: "claude-cli" })).toEqual({
      provider: "anthropic",
      model: undefined,
    });
  });
});

describe("selectProvider under --local", () => {
  it("overrides docevals.provider, naming it as the source replaced", () => {
    const config = parseDocevalsConfig("provider: anthropic\nmodel: claude-x\n", PATH);
    expect(selectProvider(config, { local: true })).toEqual({
      provider: "llama-cpp",
      model: undefined,
      replaced: { provider: "anthropic", source: "docevals.provider" },
    });
  });

  it("overrides the family's providers.provider, naming it", () => {
    const config = family(["provider: openai"]);
    expect(selectProvider(config, { local: true })).toEqual({
      provider: "llama-cpp",
      model: undefined,
      replaced: { provider: "openai", source: "providers.provider" },
    });
  });

  it("overrides an eval's own provider, naming the origin the caller gives", () => {
    const config = parseDocevalsConfig("provider: anthropic\n", PATH);
    expect(
      selectProvider(
        config,
        { local: true },
        { provider: "openai", origin: 'eval "clear" in docs/a.md' },
      ).replaced,
    ).toEqual({ provider: "openai", source: 'eval "clear" in docs/a.md' });
  });

  it("keeps docevals.model when docevals.provider is llama-cpp", () => {
    const config = parseDocevalsConfig("provider: llama-cpp\nmodel: granite-4.1-3b-q2\n", PATH);
    expect(selectProvider(config, { local: true })).toEqual({
      provider: "llama-cpp",
      model: "granite-4.1-3b-q2",
    });
  });

  it("refuses --provider naming a hosted provider, as a DocevalsError", () => {
    const config = parseDocevalsConfig("", PATH);
    expect(() => selectProvider(config, { local: true, provider: "anthropic" })).toThrow(
      new DocevalsError(
        "--local and --provider anthropic contradict each other: --local runs inference on " +
          "this machine with llama-cpp. Drop one of them.",
      ),
    );
  });

  it("resolves to llama-cpp without detecting, naming the replaced choice once", async () => {
    const written: string[] = [];
    resetWarnings();
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    try {
      process.env["ANTHROPIC_API_KEY"] = "test-key";
      const config = parseDocevalsConfig("provider: anthropic\n", PATH);
      const flags = { local: true, model: "granite-4.1-3b-q2" };
      await expect(resolveProviderIdentity(config, flags)).resolves.toEqual({
        provider: "llama-cpp",
        model: "granite-4.1-3b-q2",
      });
      await resolveProviderIdentity(config, flags);
      expect(written).toEqual([
        'manni: --local: using llama-cpp instead of "anthropic" from docevals.provider.\n',
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
      expect(() => { assertProviderSelection({ provider, model: undefined }); }).not.toThrow();
    }
  });

  it("refuses an unknown provider with meta's message, as a DocevalsError", () => {
    const refuse = (): void => { assertProviderSelection({ provider: "gemini", model: undefined }); };
    expect(refuse).toThrow(DocevalsError);
    expect(refuse).toThrow(
      `Unknown provider "gemini". Available: ${[...PROVIDERS].join(", ")}.`,
    );
  });

  it("refuses a model under auto, naming docevals.provider", () => {
    const refuse = (): void => { assertProviderSelection({ provider: "auto", model: "some-model" }); };
    expect(refuse).toThrow(DocevalsError);
    expect(refuse).toThrow(
      `Model "some-model" was given without a provider: a model name does not say ` +
        `which provider owns it. Set --provider or docevals.provider to one of ${NAMES}, ` +
        `or drop the model to take the detected provider's default.`,
    );
  });
});

describe("providerSpecFor", () => {
  it("maps anthropic's connection settings from providers: and keeps a verdict-shaped tool name", () => {
    const config = family(["anthropic:", "  apiKeyEnv: MY_KEY"]);
    const spec = providerSpecFor(config, { provider: "anthropic", model: "m" });
    expect(spec.provider).toBe("anthropic");
    expect(spec.model).toBe("m");
    expect(spec.apiKeyEnv).toBe("MY_KEY");
    // The forced tool's name is prompt surface; a verdict-shaped one steers
    // the model better than the library's generic default.
    expect(spec.anthropic?.toolName).toBe("record_verdict");
  });

  it("maps openai's baseUrl and apiKeyEnv, and names the schema a verdict", () => {
    const config = family(["openai:", "  baseUrl: http://localhost:11434/v1", "  apiKeyEnv: O_KEY"]);
    const spec = providerSpecFor(config, { provider: "openai", model: null });
    expect(spec.baseUrl).toBe("http://localhost:11434/v1");
    expect(spec.apiKeyEnv).toBe("O_KEY");
    expect(spec.model).toBeNull();
    expect(spec.openai?.schemaName).toBe("verdict");
  });

  it("maps claude-cli's command", () => {
    const config = family(["claude-cli:", "  command: claude-next"]);
    expect(providerSpecFor(config, { provider: "claude-cli", model: null }).command).toBe(
      "claude-next",
    );
  });

  it("maps llama-cpp's modelsDir, resolved from the config's directory, and thoughtTokens", () => {
    const config = family(["llama-cpp:", "  modelsDir: weights", "  thoughtTokens: 64"]);
    expect(providerSpecFor(config, { provider: "llama-cpp", model: null }).llamaCpp).toEqual({
      thoughtTokens: 64,
      modelsDirectory: resolve("/fake", "weights"),
    });
  });
});

describe("resolveProviderIdentity", () => {
  it("resolves a named provider to the library's default model, needing no key", async () => {
    // The RESOLVED model, not a copy of it: cache keys are built from this, so
    // a library default that changes must change the key.
    delete process.env["ANTHROPIC_API_KEY"];
    for (const provider of ["anthropic", "openai", "claude-cli"] as const) {
      const config = parseDocevalsConfig(`provider: ${provider}\n`, PATH);
      await expect(resolveProviderIdentity(config)).resolves.toEqual({
        provider,
        model: DEFAULT_MODELS[provider],
      });
    }
  });

  it("detects under auto, as meta fill does", async () => {
    // Only an OpenAI key present, so `openai` can only come from detecting.
    process.env["ANTHROPIC_API_KEY"] = "";
    process.env["OPENAI_API_KEY"] = "x";
    const config = parseDocevalsConfig("", PATH);
    await expect(resolveProviderIdentity(config)).resolves.toEqual({
      provider: "openai",
      model: DEFAULT_MODELS.openai,
    });
  });

  it("hands detection the family's connection settings", async () => {
    // No key for either hosted provider: only a configured baseUrl makes
    // openai usable, so `openai` can only come from detection seeing it.
    process.env["ANTHROPIC_API_KEY"] = "";
    process.env["OPENAI_API_KEY"] = "";
    const config = family(["openai:", "  baseUrl: http://127.0.0.1:1/v1"]);
    await expect(resolveProviderIdentity(config)).resolves.toEqual({
      provider: "openai",
      model: DEFAULT_MODELS.openai,
    });
  });

  it("refuses before detecting when the selection is invalid", async () => {
    const config = parseDocevalsConfig("model: some-model\n", PATH);
    await expect(resolveProviderIdentity(config)).rejects.toThrow(/docevals\.provider/);
    await expect(resolveProviderIdentity(config, { provider: "gemini" })).rejects.toThrow(
      /Unknown provider "gemini"/,
    );
  });
});

describe("makeProvider", () => {
  it("constructs the selected provider with the resolved model", async () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    const config = parseDocevalsConfig("provider: anthropic\n", PATH);
    const provider = await makeProvider(config);
    expect(provider.provider()).toBe("anthropic");
    expect(provider.modelName()).toBe(DEFAULT_MODELS.anthropic);
  });

  it("raises a DocevalsError for a missing key, not the library's own error type", async () => {
    // `run` degrades to deterministic-only evals when provider construction
    // fails, but only for a DocevalsError — it rethrows anything else, and
    // cli.ts fail() maps only DocevalsError to exit 2.
    delete process.env["ANTHROPIC_API_KEY"];
    const config = parseDocevalsConfig("provider: anthropic\n", PATH);
    await expect(makeProvider(config)).rejects.toThrow(DocevalsError);
    await expect(makeProvider(config)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("honours a custom apiKeyEnv from providers:", async () => {
    delete process.env["ANTHROPIC_API_KEY"];
    process.env["MY_KEY"] = "test-key";
    const config = family(["anthropic:", "  apiKeyEnv: MY_KEY"], ["provider: anthropic"]);
    expect((await makeProvider(config)).provider()).toBe("anthropic");
  });

  it("builds an eval's own choice over the config's", async () => {
    const config = parseDocevalsConfig("provider: anthropic\n", PATH);
    const provider = await makeProvider(config, {}, { provider: "mock", model: "pinned" });
    expect(provider.provider()).toBe("mock");
    expect(provider.modelName()).toBe("pinned");
  });
});
