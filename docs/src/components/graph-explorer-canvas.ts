import {
  sameConnection,
  hoverNeighborhood,
  highlightSeed,
  type ExplorerEdge,
  type ExplorerNode,
} from "./graph-explorer-model";
import {
  graphLabels,
  labelSize,
  typeColor,
} from "./graph-explorer-presentation";

export interface GraphPoint {
  id: string;
  x: number;
  y: number;
}
export interface CanvasTransform {
  x: number;
  y: number;
  k: number;
}

export const nodeShape = (kind: string): string =>
  ({
    Document: "M-10,-10H10V10H-10Z",
    Section: "M-12,-6H12V6H-12Z",
    Journey: "M0,-13L13,0L0,13L-13,0Z",
    Audience: "M-12,0L-6,-10H6L12,0L6,10H-6Z",
    Concept: "M0,-12L12,10H-12Z",
  })[kind] ?? "M10,0A10,10,0,1,1,-10,0A10,10,0,1,1,10,0";

const paths = new Map<string, Path2D>();

/** One canvas draws every node and edge. The list remains the keyboard-accessible equivalent. */
export function drawGraph(
  canvas: HTMLCanvasElement,
  nodes: ExplorerNode[],
  edges: ExplorerEdge[],
  positions: ReadonlyMap<string, GraphPoint>,
  transform: CanvasTransform,
  selected: string,
  hovered = "",
  hoveredEdge?: ExplorerEdge,
  pinned = "",
): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(
    ratio * transform.k,
    0,
    0,
    ratio * transform.k,
    ratio * transform.x,
    ratio * transform.y,
  );
  const style = getComputedStyle(canvas);
  const muted = style.getPropertyValue("--gx-muted").trim();
  const accent = style.getPropertyValue("--gx-accent").trim();
  const background = style.getPropertyValue("--gx-bg").trim();
  const text = style.getPropertyValue("--gx-text").trim();
  const dark = document.documentElement.dataset.theme === "dark";
  const highlight = highlightSeed(nodes, pinned, hovered);
  const related = highlight ? hoverNeighborhood(edges, highlight) : undefined;
  for (const active of [false, true]) {
    context.beginPath();
    let count = 0;
    for (const edge of edges) {
      if (
        (highlight
          ? edge.source === highlight || edge.target === highlight
          : edge.source === selected ||
            edge.target === selected ||
            sameConnection(hoveredEdge, edge)) !== active
      )
        continue;
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      if (!from || !to) continue;
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      count++;
    }
    if (!count) continue;
    context.strokeStyle = active ? accent : muted;
    context.globalAlpha = active ? 0.95 : related ? 0.035 : 0.22;
    context.lineWidth = (active ? (related ? 2 : 1.4) : 0.5) / transform.k;
    context.stroke();
  }
  context.globalAlpha = 1;
  const viewportLeft = -transform.x / transform.k;
  const viewportTop = -transform.y / transform.k;
  const viewportRight = (width - transform.x) / transform.k;
  const viewportBottom = (height - transform.y) / transform.k;
  const ordered = related
    ? [
        ...nodes.filter((node) => !related.has(node.id)),
        ...nodes.filter((node) => related.has(node.id)),
      ]
    : nodes;
  for (const node of ordered) {
    const point = positions.get(node.id);
    if (!point) continue;
    if (
      point.x < viewportLeft - 200 ||
      point.x > viewportRight + 200 ||
      point.y < viewportTop - 30 ||
      point.y > viewportBottom + 30
    )
      continue;
    let path = paths.get(node.kind);
    if (!path) {
      path = new Path2D(nodeShape(node.kind));
      paths.set(node.kind, path);
    }
    context.save();
    context.globalAlpha = related && !related.has(node.id) ? 0.13 : 1;
    context.translate(point.x, point.y);
    const active = node.id === selected;
    context.fillStyle = typeColor(node.kind, dark);
    context.strokeStyle = typeColor(node.kind, dark);
    context.lineWidth = Math.max(1.5, 0.7 / transform.k);
    context.fill(path);
    context.stroke(path);
    if (active || node.id === highlight) {
      context.beginPath();
      context.arc(0, 0, 17, 0, Math.PI * 2);
      context.strokeStyle = accent;
      context.lineWidth = 2.5 / transform.k;
      context.stroke();
    }
    context.restore();
  }
  context.globalAlpha = 1;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  if (
    hoveredEdge &&
    (!related ||
      hoveredEdge.source === highlight ||
      hoveredEdge.target === highlight)
  ) {
    const from = positions.get(hoveredEdge.source);
    const to = positions.get(hoveredEdge.target);
    if (from && to) {
      const dx = (to.x - from.x) * transform.k;
      const dy = (to.y - from.y) * transform.k;
      const length = Math.hypot(dx, dy);
      if (length > 20) {
        const ux = dx / length;
        const uy = dy / length;
        const gap = Math.min(14 * transform.k + 3, length / 3);
        const tipX = to.x * transform.k + transform.x - ux * gap;
        const tipY = to.y * transform.k + transform.y - uy * gap;
        context.strokeStyle = accent;
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(
          from.x * transform.k + transform.x,
          from.y * transform.k + transform.y,
        );
        context.lineTo(
          to.x * transform.k + transform.x,
          to.y * transform.k + transform.y,
        );
        context.stroke();
        context.fillStyle = accent;
        context.beginPath();
        context.moveTo(tipX, tipY);
        context.lineTo(tipX - ux * 9 - uy * 4, tipY - uy * 9 + ux * 4);
        context.lineTo(tipX - ux * 9 + uy * 4, tipY - uy * 9 - ux * 4);
        context.closePath();
        context.fill();
      }
    }
  }
  const fontSize = labelSize(transform.k);
  context.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
  const labels = graphLabels(
    related ? nodes.filter((node) => related.has(node.id)) : nodes,
    positions,
    transform,
    width,
    height,
    related && !related.has(selected) ? "" : selected,
    highlight,
    (value) => context.measureText(value).width,
  );
  for (const label of [...labels].reverse()) {
    context.fillStyle = background;
    context.strokeStyle = typeColor(label.kind, dark);
    context.lineWidth = label.active ? 2 : 1;
    context.beginPath();
    context.roundRect(label.x, label.y, label.width, label.height, 4);
    context.fill();
    context.stroke();
    context.fillStyle = text;
    for (const [index, line] of label.lines.entries())
      context.fillText(
        line,
        label.x + 8,
        label.y + 6 + fontSize + index * (fontSize + 5),
      );
  }
  canvas.dataset.labelFont = String(fontSize);
  canvas.dataset.labelCount = String(labels.length);
  canvas.dataset.nodeCount = String(nodes.length);
  canvas.dataset.edgeCount = String(edges.length);
  canvas.dataset.hoverNode = hovered;
  canvas.dataset.highlightNode = highlight;
  canvas.dataset.highlightedNodes = String(related?.size ?? 0);
  canvas.dataset.dimmedNodes = String(
    related ? nodes.filter((node) => !related.has(node.id)).length : 0,
  );
}
