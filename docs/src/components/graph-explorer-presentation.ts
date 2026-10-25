import type { ExplorerNode } from "./graph-explorer-model.js";

// Data categories use their own colors; the blue brand accent still marks controls.
const palette: Record<string, { light: string; dark: string }> = {
  Document: { light: "#0969da", dark: "#79b8ff" },
  Section: { light: "#087f8c", dark: "#64d8cb" },
  Concept: { light: "#8250df", dark: "#c4a0ff" },
  Audience: { light: "#9a5800", dark: "#ffbf69" },
  Persona: { light: "#c12b78", dark: "#ff94c2" },
  Journey: { light: "#287a3b", dark: "#7cdb9a" },
  Other: { light: "#59636e", dark: "#b7c1ce" },
};
export const typeColor = (kind: string, dark: boolean): string =>
  palette[kind]?.[dark ? "dark" : "light"] ?? (dark ? "#b7c1ce" : "#59636e");
export const typeStyle = (kind: string): string =>
  `--gx-type-light:${typeColor(kind, false)};--gx-type-dark:${typeColor(kind, true)}`;
export const labelSize = (scale: number): number =>
  Math.min(20, Math.max(14, 14 + Math.log2(Math.max(1, scale)) * 2));

export interface GraphLabel {
  id: string;
  kind: string;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  active: boolean;
}

function wrap(
  title: string,
  width: number,
  limit: number,
  measure: (text: string) => number,
): string[] {
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let line = "";
  let index = 0;
  while (index < words.length) {
    const word = words[index] ?? "";
    const trial = line ? `${line} ${word}` : word;
    if (measure(trial) <= width) {
      line = trial;
      index++;
      continue;
    }
    if (!line) {
      line = word;
      index++;
    }
    lines.push(line);
    line = "";
    if (lines.length === limit) break;
  }
  if (line && lines.length < limit) lines.push(line);
  if (!lines.length) lines.push(title);
  const lastIndex = lines.length - 1;
  let last = lines[lastIndex] ?? "";
  const shortened = index < words.length || measure(last) > width;
  if (shortened) {
    while (last && measure(`${last}…`) > width) last = last.slice(0, -1);
    lines[lastIndex] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** Place readable labels in screen pixels, independent of graph scale. Selection wins collisions. */
export function graphLabels(
  nodes: ExplorerNode[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  transform: { x: number; y: number; k: number },
  width: number,
  height: number,
  selected: string,
  hovered: string,
  measure: (text: string) => number,
): GraphLabel[] {
  const labels: GraphLabel[] = [];
  const size = labelSize(transform.k);
  const candidates = [...nodes].sort(
    (a, b) =>
      Number(b.id === selected) - Number(a.id === selected) ||
      Number(b.id === hovered) - Number(a.id === hovered),
  );
  for (const node of candidates) {
    const active = node.id === selected || node.id === hovered;
    if (!active && transform.k < 0.65 && nodes.length > 35) continue;
    const point = positions.get(node.id);
    if (!point) continue;
    const px = point.x * transform.k + transform.x;
    const py = point.y * transform.k + transform.y;
    if (px < 0 || px > width || py < 0 || py > height) continue;
    const lines = wrap(
      node.title,
      Math.max(40, Math.min(310, width - 32)),
      active ? 3 : transform.k >= 1.2 ? 2 : 1,
      measure,
    );
    const boxWidth = Math.min(width - 12, Math.max(...lines.map(measure)) + 16);
    const boxHeight = lines.length * (size + 5) + 12;
    const offset = 12 * transform.k + 8;
    const x = Math.max(
      6,
      Math.min(
        width - boxWidth - 6,
        px + offset + boxWidth > width ? px - offset - boxWidth : px + offset,
      ),
    );
    const y = Math.max(6, Math.min(height - boxHeight - 6, py - boxHeight / 2));
    if (
      labels.some(
        (label) =>
          x < label.x + label.width + 5 &&
          x + boxWidth + 5 > label.x &&
          y < label.y + label.height + 5 &&
          y + boxHeight + 5 > label.y,
      )
    )
      continue;
    labels.push({
      id: node.id,
      kind: node.kind,
      lines,
      x,
      y,
      width: boxWidth,
      height: boxHeight,
      fontSize: size,
      active,
    });
  }
  return labels;
}
