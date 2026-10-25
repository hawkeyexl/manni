/// <reference lib="webworker" />
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from "d3-force";

interface LayoutNode extends SimulationNodeDatum {
  id: string;
}
interface LayoutRequest {
  token: number;
  nodes: LayoutNode[];
  edges: { source: string; target: string }[];
}
self.onmessage = (event: MessageEvent<LayoutRequest>) => {
  const { token, nodes, edges } = event.data;
  const simulation = forceSimulation(nodes)
    .force(
      "link",
      forceLink<LayoutNode, { source: string; target: string }>(edges)
        .id((n) => n.id)
        .distance(100),
    )
    .force("charge", forceManyBody().strength(-170))
    .force("collision", forceCollide(30))
    .force("center", forceCenter(0, 0))
    .stop();
  simulation.tick(180);
  self.postMessage({
    token,
    nodes: nodes.map((n) => ({ id: n.id, x: n.x ?? 0, y: n.y ?? 0 })),
  });
};
