/**
 * config.fill → ProviderSpec, the mapping dockg owns (ADR 01021 left the
 * providers themselves upstream).
 *
 * The local provider is the reason this file exists. Its library default model
 * is the selector `auto`, which resolves against the machine's memory and so
 * cannot be resolved synchronously — and dockg's chain is synchronous on
 * purpose, because `makeProvider` is re-exported from src/index.ts and making
 * it async would be a breaking change to dockg's own API (ADR 01031).
 */
import { describe, expect, it } from "vitest";
import { parseConfig } from "../../../src/kg/core/config.js";
import { providerSpecFor } from "../../../src/kg/llm/provider.js";
import { DockgError } from "../../../src/kg/types.js";

function config(yaml: string) {
  return parseConfig(`version: 1\n${yaml}`, "/tmp/dockg.config.yaml");
}

describe("providerSpecFor", () => {
  it("passes the configured provider through", () => {
    const spec = providerSpecFor(config("fill:\n  provider: openai\n"));
    expect(spec.provider).toBe("openai");
  });

  it("lets a CLI override win over config", () => {
    const spec = providerSpecFor(config("fill:\n  provider: openai\n"), {
      provider: "mock",
    });
    expect(spec.provider).toBe("mock");
  });

  it("omits a null model rather than passing it through", () => {
    // null in config means "the provider's default", which is what omitting
    // the key means to the library.
    const spec = providerSpecFor(config("fill:\n  provider: mock\n"));
    expect(spec.model).toBeUndefined();
  });

  it("builds a spec for the local provider when a model is named", () => {
    const spec = providerSpecFor(
      config("fill:\n  provider: llama-cpp\n  model: granite-4.1-3b-q2\n"),
    );
    expect(spec.provider).toBe("llama-cpp");
    expect(spec.model).toBe("granite-4.1-3b-q2");
  });

  it("refuses the local provider with no model, in dockg's own words", () => {
    // The library would throw about a selector the user never typed. This says
    // what to do instead.
    expect(() =>
      providerSpecFor(config("fill:\n  provider: llama-cpp\n")),
    ).toThrow(DockgError);
    expect(() =>
      providerSpecFor(config("fill:\n  provider: llama-cpp\n")),
    ).toThrow(/no fill\.model is set/);
  });

  it("accepts a model given only on the command line", () => {
    const spec = providerSpecFor(config("fill:\n  provider: llama-cpp\n"), {
      model: "qwen3.5-4b",
    });
    expect(spec.model).toBe("qwen3.5-4b");
  });
});
