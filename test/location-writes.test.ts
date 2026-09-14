/**
 * The W1 and W2 wording (proposal 0047) that `derive`, `fill` and `query`
 * share: one formatter, singular for one key and plural for several.
 */
import { describe, expect, it } from "vitest";
import { externalWriteWarning } from "../src/meta/core/location-writes.js";
import type { ProposedHome } from "../src/meta/core/relocation.js";

const inSite: ProposedHome = {
  kind: "collection",
  collection: "site",
  manifest: "site.metadata.yaml",
  createsManifest: true,
  createsCollection: false,
};
const noConfig: ProposedHome = { kind: "none", reason: "no-config", collections: 0 };
const noneOfTwo: ProposedHome = { kind: "none", reason: "collections", collections: 2 };

describe("externalWriteWarning", () => {
  it("W1 in a collection: singular for one key, plural for several", () => {
    expect(externalWriteWarning({ verb: "wrote", keys: ["owner"], pages: 2, home: inSite, createsHome: false })).toBe(
      "wrote owner to 2 pages in collection site; the schema prefers external metadata, and no manifest owns it. Run manni meta relocate to move it.",
    );
    expect(
      externalWriteWarning({ verb: "would write", keys: ["owner", "team"], pages: 1, home: inSite, createsHome: false }),
    ).toBe(
      "would write owner, team to 1 page in collection site; their schemas prefer external metadata, and no manifest owns them. Run manni meta relocate to move them.",
    );
  });

  it("W1 where relocate would create the home", () => {
    expect(externalWriteWarning({ verb: "wrote", keys: ["owner"], pages: 1, home: inSite, createsHome: true })).toBe(
      "wrote owner to 1 page; the schema prefers external metadata. Run manni meta relocate to give it a manifest.",
    );
    expect(
      externalWriteWarning({ verb: "wrote", keys: ["owner", "team"], pages: 3, home: inSite, createsHome: true }),
    ).toBe(
      "wrote owner, team to 3 pages; their schemas prefer external metadata. Run manni meta relocate to give them a manifest.",
    );
  });

  it("W2 under --no-config", () => {
    expect(externalWriteWarning({ verb: "wrote", keys: ["owner"], pages: 1, home: noConfig, createsHome: false })).toBe(
      "wrote owner to 1 page; the schema prefers external metadata, and --no-config leaves it no manifest.",
    );
    expect(
      externalWriteWarning({ verb: "wrote", keys: ["owner", "team"], pages: 2, home: noConfig, createsHome: false }),
    ).toBe(
      "wrote owner, team to 2 pages; their schemas prefer external metadata, and --no-config leaves them no manifest.",
    );
  });

  it("W2 for pages in none of several collections", () => {
    expect(externalWriteWarning({ verb: "wrote", keys: ["owner"], pages: 1, home: noneOfTwo, createsHome: false })).toBe(
      "wrote owner to 1 page that is in none of the 2 collections; the schema prefers external metadata, and only a collection has a manifest.",
    );
    expect(
      externalWriteWarning({ verb: "wrote", keys: ["owner", "team"], pages: 2, home: noneOfTwo, createsHome: false }),
    ).toBe(
      "wrote owner, team to 2 pages that are in none of the 2 collections; their schemas prefer external metadata, and only a collection has a manifest.",
    );
  });
});
