/**
 * The config → ProviderSpec mapping. The providers themselves are the shared
 * inference library's and are tested there; what manni docevals still owns is which
 * of its own config keys mean what, so that is what these pin.
 */
import { afterEach, describe, expect, it } from "vitest";
import { resolveProviderIdentity as resolveLibIdentity } from "@hawkeyexl/inference";
import { parseDocevalsConfig } from "../helpers/config.js";
import {
  makeProvider,
  providerSpecFor,
  resolveProviderIdentity,
} from "../../../src/docevals/judge/provider.js";
import { DocevalsError } from "../../../src/docevals/types.js";

const PATH = "/fake/manni.config.yaml";
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("providerSpecFor", () => {
  it("maps the anthropic section and keeps a verdict-shaped tool name", () => {
    const config = parseDocevalsConfig(
      "version: 1\nprovider:\n  default: anthropic\n  anthropic:\n    model: claude-haiku-4-5\n    api-key-env: MY_KEY\n",
      PATH,
    );
    const spec = providerSpecFor(config);
    expect(spec.provider).toBe("anthropic");
    expect(spec.model).toBe("claude-haiku-4-5");
    expect(spec.apiKeyEnv).toBe("MY_KEY");
    // The forced tool's name is prompt surface; a verdict-shaped one steers
    // the model better than the library's generic default.
    expect(spec.anthropic?.toolName).toBe("record_verdict");
  });

  it("maps the openai section including baseUrl", () => {
    const config = parseDocevalsConfig(
      "version: 1\nprovider:\n  openai:\n    base-url: http://localhost:11434/v1\n    model: qwen2.5\n",
      PATH,
    );
    const spec = providerSpecFor(config, { provider: "openai" });
    expect(spec.baseUrl).toBe("http://localhost:11434/v1");
    expect(spec.model).toBe("qwen2.5");
  });

  it("maps the claude-cli section including the command", () => {
    const config = parseDocevalsConfig(
      "version: 1\nprovider:\n  claude-cli:\n    command: claude-next\n",
      PATH,
    );
    expect(providerSpecFor(config, { provider: "claude-cli" }).command).toBe(
      "claude-next",
    );
  });

  it("lets a CLI --model override the configured model", () => {
    const config = parseDocevalsConfig("version: 1\n", PATH);
    expect(providerSpecFor(config, { model: "gpt-4o" }).model).toBe("gpt-4o");
  });

  it("rejects an unknown provider name", () => {
    const config = parseDocevalsConfig("version: 1\n", PATH);
    expect(() => providerSpecFor(config, { provider: "gemini" })).toThrow(
      DocevalsError,
    );
  });
});

describe("resolveProviderIdentity", () => {
  it("resolves identity without constructing the provider or needing a key", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const config = parseDocevalsConfig("version: 1\n", PATH);
    expect(resolveProviderIdentity(config)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
  });

  it("agrees with the library's resolver for every configured provider", () => {
    const config = parseDocevalsConfig("version: 1\n", PATH);
    for (const name of ["anthropic", "openai", "claude-cli"] as const) {
      const spec = providerSpecFor(config, { provider: name });
      expect(resolveProviderIdentity(config, { provider: name })).toEqual(
        resolveLibIdentity(spec),
      );
    }
  });
});

describe("makeProvider", () => {
  it("constructs the configured provider", () => {
    process.env["ANTHROPIC_API_KEY"] = "test-key";
    const config = parseDocevalsConfig("version: 1\n", PATH);
    expect(makeProvider(config).provider()).toBe("anthropic");
  });

  it("surfaces a missing API key rather than failing later mid-run", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    const config = parseDocevalsConfig("version: 1\n", PATH);
    expect(() => makeProvider(config)).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("raises a DocevalsError, not the library's own error type", () => {
    // `run` degrades to deterministic-only evals when provider construction
    // fails, but only for a DocevalsError — it rethrows anything else, and
    // cli.ts fail() maps only DocevalsError to exit 2. A foreign error type
    // turns "no API key configured" from a warning into an unhandled stack
    // trace on the standard `manni docevals run --deterministic-only` CI path.
    delete process.env["ANTHROPIC_API_KEY"];
    const config = parseDocevalsConfig("version: 1\n", PATH);
    expect(() => makeProvider(config)).toThrow(DocevalsError);
  });

  it("raises a DocevalsError for an unknown provider too", () => {
    const config = parseDocevalsConfig("version: 1\n", PATH);
    expect(() =>
      makeProvider(config, { provider: "gemini" }),
    ).toThrow(DocevalsError);
  });

  it("honours a custom apiKeyEnv", () => {
    delete process.env["ANTHROPIC_API_KEY"];
    process.env["MY_KEY"] = "test-key";
    const config = parseDocevalsConfig(
      "version: 1\nprovider:\n  anthropic:\n    api-key-env: MY_KEY\n",
      PATH,
    );
    expect(makeProvider(config).provider()).toBe("anthropic");
  });
});
