import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../../src/graph/core/analyze.js";
import { withExternalMetadata } from "../../../src/graph/core/external.js";
import type { MetaPageView } from "../../../src/meta/internal.js";
import type { ExtractedMetadata } from "../../../src/meta/types.js";

/** A view that merges nothing and records the format each page arrived as. */
function recordingView(formats: string[]): MetaPageView {
  const view: Pick<MetaPageView, "merge"> = {
    merge: (_label: string, extracted: ExtractedMetadata) => {
      formats.push(extracted.format);
      return Promise.resolve({
        extracted,
        collisions: [],
        joins: [],
        locate: () => undefined,
      });
    },
  };
  return view as unknown as MetaPageView;
}

describe("withExternalMetadata", () => {
  it("hands meta each page in the format graph parsed it as", async () => {
    const paths = new Set(["docs/a.md", "docs/b.mdx"]);
    const docs = [...paths].map((p) => analyzeDoc("---\ntitle: T\n---\n", p, paths));
    const formats: string[] = [];
    await withExternalMetadata(docs, recordingView(formats));
    expect(formats).toEqual(["markdown", "mdx"]);
  });
});
