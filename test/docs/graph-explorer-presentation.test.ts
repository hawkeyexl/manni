import { describe, expect, it } from "vitest";
import {
  kinds,
  explorerModel,
} from "../../docs/src/components/graph-explorer-model.js";
import {
  typeColor,
  labelSize,
  graphLabels,
} from "../../docs/src/components/graph-explorer-presentation.js";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/graph-explorer/graph.jsonld", import.meta.url),
    "utf8",
  ),
) as object;
const contrast = (a: string, b: string) => {
  const luminance = (hex: string) => {
    const values = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return (
      (values[0] ?? 0) * 0.2126 +
      (values[1] ?? 0) * 0.7152 +
      (values[2] ?? 0) * 0.0722
    );
  };
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
};

describe("graph presentation", () => {
  it("gives every node type a distinct, contrasting color in each theme", () => {
    for (const dark of [false, true]) {
      const colors = kinds.map((kind) => typeColor(kind, dark));
      expect(new Set(colors).size).toBe(kinds.length);
      for (const color of colors)
        expect(
          contrast(color, dark ? "#171717" : "#ffffff"),
        ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("enlarges text on zoom while keeping a legible minimum and bounded maximum", () => {
    expect(labelSize(0.1)).toBeGreaterThanOrEqual(14);
    expect(labelSize(4)).toBeGreaterThan(labelSize(1));
    expect(labelSize(8)).toBeLessThanOrEqual(20);
  });
  it("prioritizes selection, avoids overlapping labels, and wraps long titles", () => {
    const nodes = explorerModel(fixture).nodes;
    const first = nodes[0];
    const second = nodes[1];
    if (!first || !second) throw new Error("fixture needs two nodes");
    first.title =
      "A longer document title that should wrap into readable words";
    const positions = new Map([
      [first.id, { x: 100, y: 100 }],
      [second.id, { x: 100, y: 100 }],
    ]);
    const labels = graphLabels(
      nodes,
      positions,
      { x: 0, y: 0, k: 2 },
      800,
      500,
      first.id,
      "",
      (text) => text.length * 9,
    );
    expect(labels[0]?.id).toBe(first.id);
    expect(labels[0]?.lines.length).toBeGreaterThan(1);
    expect(labels).toHaveLength(1);
    const label = labels[0];
    expect(
      label && label.x >= 0 && label.y >= 0 && label.x + label.width <= 800,
    ).toBe(true);
  });
});
