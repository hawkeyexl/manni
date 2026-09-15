/**
 * validate's P2 offer (proposal 0047) never words one collection's changes
 * under another collection's question. A plan whose offers name no collection
 * of the group is skipped, not answered with its first offer.
 *
 * No fixture makes the planner return only another collection's offer, so
 * the plan is stubbed: the real plan, with every offer relabelled.
 */
import { describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runValidate } from "../src/meta/commands/validate.js";
import { offerRelocation } from "../src/meta/commands/validate-offer.js";

vi.mock("../src/meta/core/relocation.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/meta/core/relocation.js")>();
  return {
    ...mod,
    planRelocation: async (...args: Parameters<typeof mod.planRelocation>) => {
      const plan = await mod.planRelocation(...args);
      return { ...plan, offers: plan.offers.map((o) => ({ ...o, collection: "elsewhere" })) };
    },
  };
});

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "location", "validate-both");

describe("validate: the P2 offer matches the group's collection", () => {
  it("asks nothing when the plan has no offer for the group's collection", async () => {
    const { results } = await runValidate({ inputs: [], cwd: fixture, env: {} });
    const asked: string[] = [];
    let out = "";
    const applied = await offerRelocation({
      results,
      inputs: [],
      cwd: fixture,
      env: {},
      confirm: (q) => {
        asked.push(q);
        return Promise.resolve(false);
      },
      output: {
        write: (chunk: string) => {
          out += chunk;
          return true;
        },
      },
    });
    expect(asked).toEqual([]);
    expect(out).toBe("");
    expect(applied).toEqual([]);
  });
});
