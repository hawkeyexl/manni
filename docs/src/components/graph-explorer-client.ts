import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import { drawGraph, nodeShape } from "./graph-explorer-canvas";
import {
  filterMetadata,
  metadataFields,
  metadataValues,
  metadataOperators,
} from "./graph-explorer-filters";
import { fullscreenControls } from "./graph-explorer-fullscreen";
import {
  graphLabels,
  labelSize,
  typeStyle,
} from "./graph-explorer-presentation";
import { parseChunksManifest } from "../../../src/graph/runtime/retrieve.js";
import type { ChunksManifest } from "../../../src/graph/runtime/chunks.js";
import {
  authoringMetadata,
  defaults,
  explorerModel,
  filterNodes,
  kinds,
  neighborhood,
  nearestNode,
  nearestEdge,
  sameConnection,
  hoverNeighborhood,
  highlightSeed,
  readState,
  relationLabel,
  sourceLinks,
  writeState,
  type ExplorerModel,
  type ExplorerNode,
  type ExplorerEdge,
} from "./graph-explorer-model";

interface Positioned {
  id: string;
  x: number;
  y: number;
}
const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
};

export function startExplorer(root: HTMLElement): void {
  if (root.dataset.started) return;
  root.dataset.started = "true";
  const get = <T extends Element = HTMLElement>(selector: string): T => {
    const result = root.querySelector<T>(selector);
    if (!result) throw new Error(`Missing explorer control: ${selector}`);
    return result;
  };
  const base = root.dataset.base ?? "/manni/";
  const dataUrl = `${base.replace(/\/$/, "")}/explorer-data/`;
  const input = get<HTMLInputElement>('input[type="search"]');
  const status = get("[data-status]");
  const results = get("[data-results]");
  const inspector = get("[data-inspector]");
  const svg = get<SVGSVGElement>("[data-graph]");
  const canvas = get("[data-canvas]");
  const drawing = get<HTMLCanvasElement>("[data-drawing]");
  const scene = get<SVGGElement>("[data-scene]");
  const labelLayer = get<SVGGElement>("[data-labels]");
  const edgeTooltip = get<HTMLElement>("[data-edge-tooltip]");
  const fullscreen = fullscreenControls(
    root,
    get<HTMLButtonElement>('[data-action="fullscreen"]'),
  );
  let state = readState(location.hash);
  let model: ExplorerModel = { nodes: [], edges: [] };
  let manifest: ChunksManifest | undefined;
  let authoring = new Map<string, Record<string, unknown>>();
  let loadVersion = 0;
  let layoutVersion = 0;
  let shown = 30;
  let positions = new Map<string, Positioned>();
  let visible: ExplorerNode[] = [];
  let matches: ExplorerNode[] = [];
  let canvasEdges: ExplorerEdge[] = [];
  let graphEdges: ExplorerEdge[] = [];
  let hoveredEdge: ExplorerEdge | undefined;
  let nodeTitles = new Map<string, string>();
  let drawFrame = 0;
  let selectedButton: Element | null = null;
  let worker: Worker | undefined;
  let loaded = false;
  let fields: string[] = [];
  let metadataUiKey = "";
  let activeTab = "details";
  let hovered = "";
  let scale = 1;
  let needsFit = true;
  let transform = zoomIdentity;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const zoomer = zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.01, 8])
    .on("zoom", (event) => {
      showEdge(undefined);
      transform = event.transform;
      scale = transform.k;
      setHoveredNode("");
      select(scene).attr("transform", transform.toString());
      select(scene)
        .selectAll(".gx-hit")
        .attr("r", 22 / scale);
      renderSvgLabels();
      select(scene)
        .selectAll(".gx-edge-label")
        .style("font-size", `${Math.max(12, labelSize(scale) - 2) / scale}px`)
        .style("stroke-width", `${4 / scale}px`)
        .attr(
          "visibility",
          scale > 2.5 || visible.length <= 12 ? "visible" : "hidden",
        );
      scheduleCanvas();
    });
  select(svg).call(zoomer).on("dblclick.zoom", null);

  function scheduleCanvas(): void {
    if (drawing.hidden || state.view !== "graph" || drawFrame) return;
    drawFrame = requestAnimationFrame(() => {
      drawFrame = 0;
      if (!drawing.hidden && state.view === "graph")
        drawGraph(
          drawing,
          visible,
          canvasEdges,
          positions,
          transform,
          state.node,
          hovered,
          hoveredEdge,
          state.highlight,
        );
    });
  }

  svg.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const bounds = svg.getBoundingClientRect();
    const [x, y] = transform.invert([
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    ]);
    const id = nearestNode(visible, positions, x, y, Math.max(16, 22 / scale));
    if (id) {
      showEdge(undefined);
      choose(id);
    } else {
      clearHighlight();
      showEdge(
        nearestEdge(graphEdges, positions, x, y, 10 / scale),
        event.clientX,
        event.clientY,
      );
    }
  });
  svg.addEventListener("pointermove", (event) => {
    if (event.buttons) return;
    const bounds = svg.getBoundingClientRect();
    const [x, y] = transform.invert([
      event.clientX - bounds.left,
      event.clientY - bounds.top,
    ]);
    const next =
      nearestNode(visible, positions, x, y, Math.max(16, 22 / scale)) ?? "";
    if (next !== hovered) {
      setHoveredNode(next);
      svg.style.cursor = next ? "pointer" : "grab";
    }
    const edge = next
      ? undefined
      : nearestEdge(graphEdges, positions, x, y, 8 / scale);
    showEdge(edge, event.clientX, event.clientY);
    if (edge) svg.style.cursor = "help";
  });
  svg.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") showEdge(undefined);
    setHoveredNode("");
  });

  function updateSvgHover(): void {
    const highlight = highlightSeed(visible, state.highlight, hovered);
    root.dataset.highlightNode = highlight;
    if (!drawing.hidden) return;
    const related = hoverNeighborhood(graphEdges, highlight);
    select(scene)
      .selectAll<SVGGElement, ExplorerNode>(".gx-node")
      .classed(
        "is-muted",
        (node) => Boolean(highlight) && !related.has(node.id),
      )
      .classed("is-hovered", (node) => node.id === highlight)
      .classed(
        "is-neighbor",
        (node) =>
          Boolean(highlight) && related.has(node.id) && node.id !== highlight,
      );
    select(scene)
      .selectAll<SVGLineElement, ExplorerEdge>(".gx-link, .gx-edge-label")
      .classed(
        "is-muted",
        (edge) =>
          Boolean(highlight) &&
          edge.source !== highlight &&
          edge.target !== highlight,
      )
      .classed(
        "is-connected",
        (edge) =>
          Boolean(highlight) &&
          (edge.source === highlight || edge.target === highlight),
      );
  }

  function setHoveredNode(id: string): void {
    if (id === hovered) return;
    hovered = id;
    if (id) root.dataset.hoverNode = id;
    else delete root.dataset.hoverNode;
    updateSvgHover();
    renderSvgLabels();
    scheduleCanvas();
  }

  function showEdge(
    edge: ExplorerEdge | undefined,
    clientX = 0,
    clientY = 0,
  ): void {
    const changed =
      edge?.source !== hoveredEdge?.source ||
      edge?.target !== hoveredEdge?.target ||
      edge?.predicate !== hoveredEdge?.predicate;
    hoveredEdge = edge;
    edgeTooltip.hidden = !edge;
    if (changed) {
      select(scene)
        .selectAll<SVGLineElement, ExplorerEdge>(".gx-link")
        .classed("hovered", (item) => sameConnection(edge, item));
      scheduleCanvas();
    }
    if (!edge) return;
    if (changed) {
      const connections = graphEdges.filter((item) =>
        sameConnection(edge, item),
      );
      get("[data-edge-name]").textContent =
        connections.length > 1
          ? `${connections.length} relationships`
          : relationLabel(edge.predicate);
      const details = get("[data-edge-details]");
      details.replaceChildren();
      for (const item of connections) {
        const row = element(
          "div",
          `${nodeTitles.get(item.source) ?? item.source} → ${relationLabel(item.predicate)} → ${nodeTitles.get(item.target) ?? item.target}`,
          "gx-edge-route",
        );
        row.append(element("small", item.predicate));
        details.append(row);
      }
    }
    const bounds = canvas.getBoundingClientRect();
    edgeTooltip.style.left = `${Math.max(8, Math.min(bounds.width - edgeTooltip.offsetWidth - 8, clientX - bounds.left + 14))}px`;
    edgeTooltip.style.top = `${Math.max(8, Math.min(bounds.height - edgeTooltip.offsetHeight - 8, clientY - bounds.top + 14))}px`;
  }
  const themeObserver = new MutationObserver(() => {
    renderSvgLabels();
    scheduleCanvas();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  function renderSvgLabels(): void {
    labelLayer.replaceChildren();
    if (!drawing.hidden || state.view !== "graph") return;
    const context = drawing.getContext("2d");
    if (!context) return;
    const fontSize = labelSize(scale);
    context.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
    const highlight = highlightSeed(visible, state.highlight, hovered);
    const related = highlight
      ? hoverNeighborhood(graphEdges, highlight)
      : undefined;
    const labels = graphLabels(
      related ? visible.filter((node) => related.has(node.id)) : visible,
      positions,
      transform,
      canvas.clientWidth,
      canvas.clientHeight,
      related && !related.has(state.node) ? "" : state.node,
      highlight,
      (value) => context.measureText(value).width,
    );
    const groups = select(labelLayer)
      .selectAll("g")
      .data([...labels].reverse())
      .join("g")
      .attr("class", "gx-label")
      .attr("data-node-type", (label) => label.kind)
      .attr("style", (label) => typeStyle(label.kind))
      .attr("transform", (label) => `translate(${label.x},${label.y})`);
    groups
      .append("rect")
      .attr("width", (label) => label.width)
      .attr("height", (label) => label.height)
      .attr("rx", 4)
      .attr("stroke-width", (label) => (label.active ? 2 : 1));
    groups.each(function (label) {
      const text = select(this)
        .append("text")
        .attr("x", 8)
        .attr("y", fontSize + 6)
        .style("font-size", `${fontSize}px`);
      label.lines.forEach((line, index) =>
        text
          .append("tspan")
          .attr("x", 8)
          .attr("dy", index === 0 ? 0 : fontSize + 5)
          .text(line),
      );
    });
  }

  function colorType(target: HTMLElement, kind: string): void {
    target.dataset.nodeType = kind;
    target.style.cssText = typeStyle(kind);
  }

  function changeMetadata(): void {
    shown = 30;
    needsFit = true;
    save();
    render();
  }

  function renderMetadata(): void {
    const contentType = get<HTMLSelectElement>("[data-content-type]");
    if (
      state.contentType &&
      ![...contentType.options].some(
        (option) => option.value === state.contentType,
      )
    )
      contentType.add(
        new Option(
          `${state.contentType} (not in this dataset)`,
          state.contentType,
        ),
      );
    contentType.value = state.contentType;
    const key = JSON.stringify(state.metadata);
    if (key === metadataUiKey) return;
    metadataUiKey = key;
    const container = get("[data-metadata-rows]");
    const active =
      document.activeElement instanceof HTMLElement &&
      container.contains(document.activeElement)
        ? document.activeElement
        : null;
    const focusedRow =
      active?.closest<HTMLElement>("[data-filter-row]")?.dataset.filterRow;
    const focusedPart = active?.dataset.filterPart;
    container.replaceChildren();
    const displayField = (field: string) =>
      field
        .slice(1)
        .split("/")
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
        .join(" › ");
    state.metadata.forEach((filter, index) => {
      const row = element("div", "", "gx-filter-row");
      row.dataset.filterRow = String(index);
      const labeled = (label: string, control: HTMLElement) => {
        const wrapper = element("label", label);
        wrapper.append(control);
        row.append(wrapper);
      };
      const field = element("select");
      field.dataset.filterPart = "field";
      field.setAttribute("aria-label", `Metadata filter ${index + 1} field`);
      field.append(
        new Option("Choose a field", ""),
        ...fields.map((value) => new Option(displayField(value), value)),
      );
      if (filter.field && !fields.includes(filter.field))
        field.add(
          new Option(
            `${displayField(filter.field)} (not in dataset)`,
            filter.field,
          ),
        );
      field.value = filter.field;
      labeled("Field", field);
      const operator = element("select");
      operator.dataset.filterPart = "operator";
      operator.setAttribute(
        "aria-label",
        `Metadata filter ${index + 1} condition`,
      );
      const operatorLabels = {
        is: "Is",
        contains: "Contains text",
        present: "Is present",
        missing: "Is missing",
      };
      operator.append(
        ...metadataOperators.map(
          (value) => new Option(operatorLabels[value], value),
        ),
      );
      operator.value = filter.operator;
      labeled("Condition", operator);
      const value = element("input");
      value.type = "text";
      value.value = filter.value;
      value.dataset.filterPart = "value";
      value.setAttribute("aria-label", `Metadata filter ${index + 1} value`);
      value.setAttribute("list", `gx-metadata-values-${index}`);
      value.placeholder = "Choose or enter a value";
      labeled("Value", value);
      const valueLabel = value.parentElement;
      if (valueLabel)
        valueLabel.hidden =
          filter.operator === "present" || filter.operator === "missing";
      const suggestions = element("datalist");
      suggestions.id = `gx-metadata-values-${index}`;
      suggestions.append(
        ...metadataValues(authoring, filter.field)
          .slice(0, 100)
          .map((item) => new Option(item, item)),
      );
      row.append(suggestions);
      const update = () => {
        const condition =
          metadataOperators.find((item) => item === operator.value) ?? "is";
        state.metadata[index] = {
          field: field.value,
          operator: condition,
          value: value.value,
        };
        changeMetadata();
      };
      field.addEventListener("change", update);
      operator.addEventListener("change", update);
      value.addEventListener("change", update);
      value.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          update();
        }
      });
      const remove = element("button", "Remove filter");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove metadata filter ${index + 1}`);
      remove.addEventListener("click", () => {
        state.metadata.splice(index, 1);
        changeMetadata();
      });
      row.append(remove);
      container.append(row);
    });
    if (focusedRow && focusedPart)
      container
        .querySelector<HTMLElement>(
          `[data-filter-row="${focusedRow}"] [data-filter-part="${focusedPart}"]`,
        )
        ?.focus({ preventScroll: true });
  }

  function fit(): void {
    const points = visible
      .map((n) => positions.get(n.id))
      .filter((n): n is Positioned => n !== undefined);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!points.length || !width || !height) return;
    const x0 = Math.min(...points.map((n) => n.x)) - 100;
    const x1 = Math.max(...points.map((n) => n.x)) + 100;
    const y0 = Math.min(...points.map((n) => n.y)) - 50;
    const y1 = Math.max(...points.map((n) => n.y)) + 50;
    const k = Math.min(2, width / (x1 - x0 + 50), height / (y1 - y0 + 60));
    select(svg).call(
      zoomer.transform,
      zoomIdentity
        .translate(width / 2, height / 2)
        .scale(k)
        .translate(-(x0 + x1) / 2, -(y0 + y1) / 2),
    );
  }

  function save(replace = false): void {
    const next = writeState(state);
    if (location.hash !== next)
      history[replace ? "replaceState" : "pushState"](null, "", next);
    get<HTMLButtonElement>('[data-action="back"]').disabled =
      history.length <= 1;
  }

  function choose(id: string, moveFocus = true): void {
    setHoveredNode("");
    showEdge(undefined);
    selectedButton = document.activeElement;
    state.node = id;
    state.highlight = id;
    state.focus = id;
    state.q = "";
    shown = 30;
    needsFit = true;
    save();
    render();
    if (moveFocus)
      get<HTMLElement>("[data-node-title]").focus({ preventScroll: true });
  }

  function clearHighlight(): void {
    state.highlight = "";
    setHoveredNode("");
    save();
    updateSvgHover();
    renderSvgLabels();
    scheduleCanvas();
  }

  function renderResults(): void {
    results.replaceChildren();
    for (const node of matches.slice(0, shown)) {
      const item = element("li");
      const button = element("button", node.title, "gx-result");
      button.type = "button";
      colorType(button, node.kind);
      button.setAttribute("aria-current", String(node.id === state.node));
      button.append(
        element(
          "small",
          `${node.kind} · ${node.path || node.id.split("/").at(-1)}`,
        ),
      );
      button.addEventListener("click", () => choose(node.id));
      item.append(button);
      results.append(item);
    }
    get("[data-result-count]").textContent = String(matches.length);
    get<HTMLButtonElement>('[data-action="more"]').hidden =
      shown >= matches.length;
  }

  function setTab(name: string, focus = false): void {
    activeTab = name;
    root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
      const active = button.dataset.tab === name;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    root.querySelectorAll<HTMLElement>("[data-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
  }

  function renderInspector(): void {
    const node = model.nodes.find((n) => n.id === state.node);
    inspector.hidden = !state.node;
    if (!state.node) return;
    get("[data-node-title]").textContent =
      node?.title ?? "This node isn’t in the current graph.";
    get("[data-node-kind]").textContent = node?.kind ?? "Unknown node";
    colorType(get<HTMLElement>("[data-node-kind]"), node?.kind ?? "Other");
    get<HTMLButtonElement>('[data-action="focus"]').disabled = !node;
    for (const name of ["details", "connections", "metadata"])
      get(`[data-panel="${name}"]`).replaceChildren();
    if (!node) return;
    const details = get('[data-panel="details"]');
    details.append(
      element(
        "p",
        node.description ||
          "Select Connections to follow this node’s relationships.",
      ),
    );
    const links = sourceLinks(node.path, base, manifest?.commit ?? "main");
    const row = element("div");
    for (const [label, href] of [
      ["Open page", links.page],
      ["View source ↗", links.source],
    ]) {
      if (!href) continue;
      const link = element("a", label);
      link.href =
        label === "Open page" &&
        node.kind === "Section" &&
        node.id.includes("#")
          ? `${href}#${node.id.split("#").slice(1).join("#")}`
          : href;
      if (href.startsWith("https:")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      row.append(link, element("br"));
    }
    details.append(row, element("p", node.path || node.id));
    const metadata = node.path
      ? (authoring.get(node.path) ?? manifest?.pages[node.path]?.metadata)
      : undefined;
    if (metadata) {
      const box = element("details");
      box.append(
        element("summary", "Author-facing page metadata"),
        element("pre", JSON.stringify(metadata, null, 2)),
      );
      details.append(box);
    }
    const connections = get('[data-panel="connections"]');
    const edges = model.edges.filter(
      (e) => e.source === node.id || e.target === node.id,
    );
    connections.append(
      element("p", `${edges.length} incoming and outgoing connections`),
    );
    for (const edge of edges) {
      const outgoing = edge.source === node.id;
      const other = model.nodes.find(
        (n) => n.id === (outgoing ? edge.target : edge.source),
      );
      if (!other) continue;
      const button = element("button", other.title, "gx-connection");
      button.type = "button";
      button.prepend(
        element(
          "small",
          outgoing
            ? `OUT → ${relationLabel(edge.predicate)}`
            : `IN ← ${relationLabel(edge.predicate)}`,
        ),
      );
      button.title = edge.predicate;
      button.addEventListener("click", () => choose(other.id));
      connections.append(button);
    }
    const panel = get('[data-panel="metadata"]');
    const list = element("dl");
    list.append(element("dt", "Node IRI"), element("dd", node.id));
    for (const prop of node.properties)
      list.append(
        element("dt", prop.predicate),
        element("dd", prop.values.join("\n")),
      );
    panel.append(list);
    if (metadata)
      panel.append(
        element("h4", "Page metadata"),
        element("pre", JSON.stringify(metadata, null, 2)),
      );
    setTab(activeTab);
  }

  function paint(): void {
    root.dataset.highlightNode = highlightSeed(
      visible,
      state.highlight,
      hovered,
    );
    if (state.view !== "graph") return;
    scene.replaceChildren();
    const ids = new Set(visible.map((n) => n.id));
    const edges = model.edges.filter(
      (e) =>
        ids.has(e.source) &&
        ids.has(e.target) &&
        (!state.relation || e.predicate === state.relation),
    );
    graphEdges = edges;
    drawing.hidden = visible.length <= 300;
    svg.setAttribute(
      "aria-label",
      `${visible.length.toLocaleString()} nodes in the graph. Pan or zoom and tap a node to inspect it. List view provides keyboard navigation.`,
    );
    if (!drawing.hidden) {
      labelLayer.replaceChildren();
      canvasEdges = edges;
      if (needsFit) {
        fit();
        needsFit = false;
      }
      scheduleCanvas();
      status.textContent = `Showing all ${visible.length.toLocaleString()} matching nodes · ${edges.length.toLocaleString()} connections`;
      return;
    }
    status.textContent = `Showing all ${visible.length.toLocaleString()} matching nodes · ${edges.length.toLocaleString()} connections`;
    const group = select(scene);
    group
      .append("g")
      .attr("aria-hidden", "true")
      .selectAll("line")
      .data(edges)
      .join("line")
      .attr(
        "class",
        (e) =>
          `gx-link${e.source === state.node || e.target === state.node ? " active" : ""}`,
      )
      .attr("x1", (e) => positions.get(e.source)?.x ?? 0)
      .attr("y1", (e) => positions.get(e.source)?.y ?? 0)
      .attr("x2", (e) => positions.get(e.target)?.x ?? 0)
      .attr("y2", (e) => positions.get(e.target)?.y ?? 0)
      .attr("marker-end", "url(#gx-arrow)");
    const labels = edges
      .filter((e) => e.source === state.node || e.target === state.node)
      .slice(0, 8);
    group
      .append("g")
      .attr("aria-hidden", "true")
      .selectAll("text")
      .data(labels)
      .join("text")
      .attr("class", "gx-edge-label")
      .style("font-size", `${Math.max(12, labelSize(scale) - 2) / scale}px`)
      .style("stroke-width", `${4 / scale}px`)
      .attr(
        "visibility",
        scale > 2.5 || visible.length <= 12 ? "visible" : "hidden",
      )
      .attr("text-anchor", "middle")
      .attr(
        "x",
        (e) =>
          ((positions.get(e.source)?.x ?? 0) +
            (positions.get(e.target)?.x ?? 0)) /
          2,
      )
      .attr(
        "y",
        (e) =>
          ((positions.get(e.source)?.y ?? 0) +
            (positions.get(e.target)?.y ?? 0)) /
            2 -
          6,
      )
      .text((e) => relationLabel(e.predicate));
    const edgeTargets = group
      .append("g")
      .attr("role", "group")
      .attr("aria-label", "Connections");
    const showFocusedEdge = (target: SVGLineElement, edge: ExplorerEdge) => {
      const bounds = target.getBoundingClientRect();
      showEdge(
        edge,
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
    };
    edgeTargets
      .selectAll<SVGLineElement, ExplorerEdge>("line")
      .data(edges)
      .join("line")
      .attr("class", "gx-edge-hit")
      .attr("data-predicate", (edge) => edge.predicate)
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-describedby", "gx-edge-tooltip")
      .attr(
        "aria-label",
        (edge) =>
          `${nodeTitles.get(edge.source) ?? edge.source} → ${relationLabel(edge.predicate)} → ${nodeTitles.get(edge.target) ?? edge.target}. Show relationship.`,
      )
      .attr("x1", (edge) => positions.get(edge.source)?.x ?? 0)
      .attr("y1", (edge) => positions.get(edge.source)?.y ?? 0)
      .attr("x2", (edge) => positions.get(edge.target)?.x ?? 0)
      .attr("y2", (edge) => positions.get(edge.target)?.y ?? 0)
      .on("pointerenter pointermove", (event: PointerEvent, edge) => {
        if (!event.buttons) showEdge(edge, event.clientX, event.clientY);
      })
      .on("pointerleave", (event: PointerEvent) => {
        if (event.pointerType !== "touch") showEdge(undefined);
      })
      .on("focus", function (_event, edge) {
        setHoveredNode("");
        showFocusedEdge(this, edge);
      })
      .on("blur", () => showEdge(undefined))
      .on("click", (event: MouseEvent, edge) => {
        event.stopPropagation();
        clearHighlight();
        const bounds = svg.getBoundingClientRect();
        const [x, y] = transform.invert([
          event.clientX - bounds.left,
          event.clientY - bounds.top,
        ]);
        showEdge(
          nearestEdge(graphEdges, positions, x, y, 10 / scale) ?? edge,
          event.clientX,
          event.clientY,
        );
      })
      .on("keydown", function (event: KeyboardEvent, edge) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showFocusedEdge(this, edge);
        }
      });
    const nodes = group
      .append("g")
      .selectAll<SVGGElement, ExplorerNode>("g")
      .data(visible)
      .join("g")
      .attr("class", (n) => `gx-node${n.id === state.node ? " selected" : ""}`)
      .attr("data-node-id", (n) => n.id)
      .attr("data-node-type", (n) => n.kind)
      .attr("style", (n) => typeStyle(n.kind))
      .attr("role", "button")
      .attr("tabindex", "0")
      .attr("aria-label", (n) => `${n.title}, ${n.kind}. Inspect node.`)
      .attr("aria-pressed", (n) => String(n.id === state.node))
      .attr(
        "transform",
        (n) =>
          `translate(${positions.get(n.id)?.x ?? 0},${positions.get(n.id)?.y ?? 0})`,
      )
      .on("click", (event: MouseEvent, n) => {
        event.stopPropagation();
        choose(n.id);
      })
      .on("mouseenter", (_event, n) => {
        setHoveredNode(n.id);
      })
      .on("mouseleave", () => {
        setHoveredNode("");
      })
      .on("focus", (_event, n) => {
        setHoveredNode(n.id);
      })
      .on("blur", () => {
        setHoveredNode("");
      })
      .on("keydown", (event: KeyboardEvent, n) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          choose(n.id);
        }
      });
    nodes
      .append("circle")
      .attr("class", "gx-hit")
      .attr("r", 22 / scale);
    nodes
      .append("path")
      .attr("class", "gx-shape")
      .attr("d", (n) => nodeShape(n.kind));
    nodes.append("circle").attr("class", "gx-selection").attr("r", 17);
    nodes.append("title").text((n) => `${n.title} (${n.kind})`);
    if (needsFit) {
      fit();
      needsFit = false;
    }
    updateSvgHover();
    renderSvgLabels();
  }

  function layout(): void {
    const token = ++layoutVersion;
    status.textContent = `Laying out ${visible.length.toLocaleString()} nodes…`;
    const ids = new Set(visible.map((n) => n.id));
    const edges = model.edges.filter(
      (e) =>
        ids.has(e.source) &&
        ids.has(e.target) &&
        (!state.relation || e.predicate === state.relation),
    );
    const nodes = visible.map((n) => positions.get(n.id) ?? { id: n.id });
    if (!worker) {
      // The graph remains useful where workers are blocked: a deterministic grid.
      positions = new Map(
        nodes.map((n, i) => [
          n.id,
          {
            id: n.id,
            x: (i % Math.ceil(Math.sqrt(nodes.length))) * 100,
            y: Math.floor(i / Math.ceil(Math.sqrt(nodes.length))) * 80,
          },
        ]),
      );
      needsFit = true;
      paint();
      return;
    }
    worker.postMessage({
      token,
      nodes,
      edges: edges.map((e) => ({ source: e.source, target: e.target })),
    });
  }

  function render(): void {
    setHoveredNode("");
    showEdge(undefined);
    input.value = state.q;
    get<HTMLSelectElement>("[data-depth]").value = String(state.depth);
    get<HTMLSelectElement>("[data-relation]").value = state.relation;
    renderMetadata();
    root.querySelectorAll<HTMLInputElement>("[data-kind]").forEach((box) => {
      box.checked = state.types.includes(box.value);
    });
    root.dataset.view = state.view;
    root
      .querySelectorAll<HTMLButtonElement>("[data-view]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.view === state.view)),
      );
    const focused = model.nodes.find((n) => n.id === state.focus);
    get("[data-scope]").textContent = focused
      ? `Around ${focused.title}`
      : "Whole graph";
    get<HTMLButtonElement>('[data-action="unfocus"]').hidden = !state.focus;
    let candidates = state.focus
      ? neighborhood(model, state.focus, state.depth, state.relation)
      : model.nodes;
    if (state.relation && !state.focus) {
      const connected = new Set(
        model.edges
          .filter((e) => e.predicate === state.relation)
          .flatMap((e) => [e.source, e.target]),
      );
      candidates = candidates.filter((n) => connected.has(n.id));
    }
    matches = filterNodes(candidates, state.q, state.types, state.relation);
    matches = filterMetadata(
      matches,
      authoring,
      state.contentType,
      state.metadata,
    );
    visible = matches;
    get("[data-empty]").hidden = matches.length > 0 || !loaded;
    canvas.hidden = matches.length === 0;
    status.textContent = !loaded
      ? "Loading graph…"
      : `${matches.length.toLocaleString()} matching nodes · ${state.focus ? `${state.depth} connection${state.depth === 1 ? "" : "s"} in either direction` : "select a node to follow its connections"}`;
    renderResults();
    renderInspector();
    if (state.view === "graph" && matches.length) layout();
  }

  async function load(): Promise<void> {
    const version = ++loadVersion;
    get<HTMLButtonElement>('[data-action="retry"]').hidden = true;
    status.textContent = "Loading graph…";
    try {
      const response = await fetch(`${dataUrl}graph.jsonld`);
      if (!response.ok) throw new Error("Graph unavailable");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("Invalid graph");
      const next = explorerModel(data);
      const metadataResponse = await fetch(`${dataUrl}chunks.json`);
      if (!metadataResponse.ok) throw new Error("Metadata unavailable");
      const metadata = parseChunksManifest(await metadataResponse.text());
      const authorResponse = await fetch(`${dataUrl}authoring.json`);
      if (!authorResponse.ok) throw new Error("Authoring metadata unavailable");
      const authorData: unknown = await authorResponse.json();
      const authorMetadata = authoringMetadata(authorData);
      if (version !== loadVersion) return;
      model = next;
      nodeTitles = new Map(model.nodes.map((node) => [node.id, node.title]));
      manifest = metadata;
      authoring = authorMetadata;
      fields = metadataFields(authoring);
      metadataUiKey = "";
      const contentType = get<HTMLSelectElement>("[data-content-type]");
      contentType.replaceChildren(
        new Option("Any content type", ""),
        ...metadataValues(authoring, "/type").map((value) => {
          const count = [...authoring.values()].filter(
            (data) => String(data.type) === value,
          ).length;
          return new Option(`${value} (${count} pages)`, value);
        }),
      );
      loaded = true;
      const relations = [
        ...new Set(model.edges.map((e) => e.predicate)),
      ].sort();
      const relationSelect = get<HTMLSelectElement>("[data-relation]");
      relationSelect.replaceChildren(
        new Option("All relationships", ""),
        ...relations.map((r) => new Option(`${relationLabel(r)} (${r})`, r)),
      );
      if (state.relation && !relations.includes(state.relation))
        state.relation = "";
      const typeBox = get("[data-types]");
      typeBox.replaceChildren();
      for (const kind of kinds) {
        const count = model.nodes.filter((n) => n.kind === kind).length;
        if (!count) continue;
        const label = element("label");
        colorType(label, kind);
        const box = element("input");
        box.type = "checkbox";
        box.value = kind;
        box.dataset.kind = "";
        box.addEventListener("change", () => {
          state.types = [
            ...root.querySelectorAll<HTMLInputElement>("[data-kind]:checked"),
          ].map((b) => b.value);
          shown = 30;
          needsFit = true;
          save();
          render();
        });
        label.append(box, element("span", `${kind} ${count}`));
        typeBox.append(label);
      }
      const records = model.nodes.filter((n) =>
        ["Persona", "Audience", "Journey"].includes(n.kind),
      );
      get("[data-total]").textContent =
        `${model.nodes.length.toLocaleString()} nodes · ${model.edges.length.toLocaleString()} connections · ${records.length} strategy records`;
      // Begin at the worked example, keeping an explicit shared URL authoritative.
      if (!location.hash) {
        const sara = model.nodes.find(
          (n) => n.kind === "Persona" && n.id.endsWith("/sara"),
        );
        if (sara) {
          state.focus = sara.id;
          state.node = sara.id;
          state.depth = 1;
          state.types = ["Audience", "Persona", "Journey"];
          save(true);
        }
      }
      render();
    } catch {
      if (version !== loadVersion) return;
      status.textContent = "Couldn’t load the graph. Retry.";
      get<HTMLButtonElement>('[data-action="retry"]').hidden = false;
    }
  }

  try {
    worker = new Worker(
      new URL("./graph-explorer-layout.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (
      event: MessageEvent<{ token: number; nodes: Positioned[] }>,
    ) => {
      if (event.data.token !== layoutVersion) return;
      for (const node of event.data.nodes) positions.set(node.id, node);
      paint();
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = undefined;
      layout();
    };
  } catch {
    /* Grid layout is the compatibility fallback. */
  }
  const mobile = matchMedia(
    "(max-width: 767px), (max-width: 1000px) and (max-height: 500px)",
  );
  const updateFilters = () => {
    get<HTMLDetailsElement>(".gx-filters").open = !mobile.matches;
  };
  updateFilters();
  mobile.addEventListener("change", updateFilters);
  let viewportWidth = canvas.clientWidth;
  let viewportHeight = canvas.clientHeight;
  const resize = new ResizeObserver(() => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height || state.view !== "graph") return;
    if (needsFit) fit();
    else if (width !== viewportWidth || height !== viewportHeight)
      select(svg).call(
        zoomer.transform,
        zoomIdentity
          .translate(
            transform.x + (width - viewportWidth) / 2,
            transform.y + (height - viewportHeight) / 2,
          )
          .scale(scale),
      );
    viewportWidth = width;
    viewportHeight = height;
    renderSvgLabels();
    scheduleCanvas();
  });
  resize.observe(canvas);
  let debounce: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = input.value;
      shown = 30;
      needsFit = true;
      save(true);
      render();
    }, 160);
  });
  get<HTMLSelectElement>("[data-depth]").addEventListener("change", (event) => {
    state.depth = (event.target as HTMLSelectElement).value === "2" ? 2 : 1;
    needsFit = true;
    save();
    render();
  });
  get<HTMLSelectElement>("[data-content-type]").addEventListener(
    "change",
    (event) => {
      state.contentType = (event.target as HTMLSelectElement).value;
      changeMetadata();
    },
  );
  get<HTMLSelectElement>("[data-relation]").addEventListener(
    "change",
    (event) => {
      state.relation = (event.target as HTMLSelectElement).value;
      shown = 30;
      needsFit = true;
      save();
      render();
    },
  );
  root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      state.view = b.dataset.view === "list" ? "list" : "graph";
      save();
      render();
    }),
  );
  root
    .querySelectorAll<HTMLButtonElement>("[data-tab]")
    .forEach((b, i, buttons) => {
      b.addEventListener("click", () => setTab(b.dataset.tab ?? "details"));
      b.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (i + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
                buttons.length;
        setTab(buttons[next]?.dataset.tab ?? "details", true);
      });
    });
  const close = () => {
    state.node = "";
    save();
    inspector.hidden = true;
    renderResults();
    paint();
    if (
      selectedButton?.isConnected &&
      (selectedButton instanceof HTMLElement ||
        selectedButton instanceof SVGElement)
    )
      selectedButton.focus({ preventScroll: true });
    else input.focus({ preventScroll: true });
  };
  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) =>
    button.addEventListener("click", () => {
      switch (button.dataset.action) {
        case "back":
          history.back();
          break;
        case "fullscreen":
          if (!root.dataset.expanded && mobile.matches)
            get<HTMLDetailsElement>(".gx-filters").open = false;
          void fullscreen.toggle();
          break;
        case "reset":
        case "everything":
          state = defaults();
          shown = 30;
          needsFit = true;
          save();
          render();
          break;
        case "add-filter":
          state.metadata.push({ field: "", operator: "is", value: "" });
          changeMetadata();
          get<HTMLElement>(
            `[data-filter-row="${state.metadata.length - 1}"] [data-filter-part="field"]`,
          ).focus();
          break;
        case "clear":
          state.q = "";
          state.types = [];
          state.relation = "";
          state.contentType = "";
          state.metadata = [];
          shown = 30;
          needsFit = true;
          save();
          render();
          break;
        case "unfocus":
          state.focus = "";
          needsFit = true;
          save();
          render();
          break;
        case "focus":
          state.focus = state.node;
          state.q = "";
          state.types = [];
          shown = 30;
          needsFit = true;
          save();
          render();
          break;
        case "close":
          close();
          break;
        case "more":
          shown += 30;
          renderResults();
          break;
        case "retry":
          void load();
          break;
        case "fit":
          fit();
          break;
        case "zoom-in":
          select(svg).call(zoomer.scaleBy, 1.4);
          break;
        case "zoom-out":
          select(svg).call(zoomer.scaleBy, 1 / 1.4);
          break;
      }
    }),
  );
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !edgeTooltip.hidden) {
      showEdge(undefined);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape" && !inspector.hidden) close();
  });
  const dismissRelationship = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !edgeTooltip.hidden) showEdge(undefined);
  };
  document.addEventListener("keydown", dismissRelationship);
  const restore = () => {
    state = readState(location.hash);
    needsFit = true;
    shown = 30;
    if (loaded) render();
  };
  window.addEventListener("popstate", restore);
  window.addEventListener("hashchange", restore);
  // No simulation or transitions run on the main thread, including reduced-motion mode.
  if (reducedMotion.matches) root.dataset.reducedMotion = "true";
  document.addEventListener(
    "astro:before-swap",
    () => {
      worker?.terminate();
      fullscreen.dispose();
      document.removeEventListener("keydown", dismissRelationship);
      cancelAnimationFrame(drawFrame);
      themeObserver.disconnect();
      resize.disconnect();
      mobile.removeEventListener("change", updateFilters);
      clearTimeout(debounce);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    },
    { once: true },
  );
  void load();
}
