/** Optional browser dogfood; start the docs preview and generate explorer-data first. */
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium, webkit } from "playwright-core";
import AxeBuilder from "@axe-core/playwright";

const url =
  process.env.EXPLORER_URL ?? "http://127.0.0.1:4328/manni/graph/explore/";
const directory = ".manni/explorer-qa";
await mkdir(directory, { recursive: true });
const report = [];
const corpusMetadata = JSON.parse(
  await readFile("docs/public/explorer-data/authoring.json", "utf8"),
);
for (const [name, engine, options] of [
  ["chromium", chromium, { channel: "chrome" }],
  ["webkit", webkit, {}],
]) {
  const browser = await engine.launch({ headless: true, ...options });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: "reduce",
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    const root = page.locator("[data-graph-explorer]");
    await root
      .locator("[data-total]")
      .filter({ hasText: "strategy records" })
      .waitFor();
    assert.equal(await root.locator("[data-scope]").innerText(), "Whole graph");
    const landingTotal = Number(
      (await root.locator("[data-total]").innerText())
        .split(" ")[0]
        .replaceAll(",", ""),
    );
    await root
      .locator(`[data-drawing][data-node-count="${landingTotal}"]`)
      .waitFor({ state: "visible" });
    assert.equal(await root.locator("[data-kind]:checked").count(), 0);
    assert.equal(await root.locator("[data-inspector]").isVisible(), false);
    await page.screenshot({
      path: `${directory}/${name}-landing-whole-graph.png`,
    });
    const randomButton = root.getByRole("button", {
      name: "Random node",
      exact: true,
    });
    assert((await randomButton.innerText()).includes("🎲"));
    await randomButton.click();
    const randomState = new URLSearchParams(new URL(page.url()).hash.slice(1));
    assert(randomState.get("node"));
    assert.equal(randomState.get("focus"), randomState.get("node"));
    assert.equal(randomState.get("highlight"), randomState.get("node"));
    await root.locator("[data-inspector]").waitFor({ state: "visible" });
    const headingOrder = await new AxeBuilder({ page })
      .withRules(["heading-order"])
      .analyze();
    assert.deepEqual(
      headingOrder.violations.map((violation) => violation.id),
      [],
    );
    const outsidePath =
      "docs/src/content/docs/lint/set-up/write-a-template.mdx";
    const outsideNode = `https://hawkeyexl.github.io/manni/id/doc/${outsidePath}`;
    const scopedSearch = new URLSearchParams({
      focus: "https://hawkeyexl.github.io/manni/id/scheme",
      q: outsidePath,
      type: "Document",
      depth: "1",
      view: "graph",
    });
    await page.goto(`${url.split("#")[0]}#${scopedSearch}`);
    await root.locator("[data-empty]").waitFor({ state: "visible" });
    assert.equal(await randomButton.isDisabled(), false);
    await randomButton.click();
    const outsideSelection = new URLSearchParams(
      new URL(page.url()).hash.slice(1),
    );
    assert.equal(outsideSelection.get("node"), outsideNode);
    assert.equal(outsideSelection.get("focus"), outsideNode);
    assert.equal(outsideSelection.get("type"), "Document");
    const saraId = "https://hawkeyexl.github.io/manni/id/strategy/persona/sara";
    const exampleState = new URLSearchParams({
      node: saraId,
      focus: saraId,
      depth: "1",
      view: "graph",
    });
    for (const kind of ["Audience", "Persona", "Journey"])
      exampleState.append("type", kind);
    await page.goto(`${url.split("#")[0]}#${exampleState}`);
    await root.locator(".gx-node").first().waitFor();
    assert((await root.locator(".gx-node").count()) > 0);
    const typeFills = await root
      .locator(".gx-node")
      .evaluateAll((nodes) =>
        Object.fromEntries(
          nodes.map((node) => [
            node.getAttribute("data-node-type"),
            globalThis.getComputedStyle(node.querySelector(".gx-shape")).fill,
          ]),
        ),
      );
    assert(new Set(Object.values(typeFills)).size >= 3);
    const initialLabels = await root.locator(".gx-label text").count();
    assert(initialLabels > 0);
    const hoverNode = root
      .locator('.gx-node[data-node-type="Journey"]')
      .first();
    const hoverId = await hoverNode.getAttribute("data-node-id");
    const beforeHover = page.url();
    await hoverNode.hover();
    assert.equal(await root.getAttribute("data-hover-node"), hoverId);
    assert.equal(await root.locator(".gx-node.is-hovered").count(), 1);
    assert((await root.locator(".gx-node.is-neighbor").count()) > 0);
    assert((await root.locator(".gx-node.is-muted").count()) > 0);
    assert((await root.locator(".gx-link.is-connected").count()) > 0);
    assert((await root.locator(".gx-link.is-muted").count()) > 0);
    const opacity = await root
      .locator(".gx-node.is-muted")
      .first()
      .evaluate((node) => globalThis.getComputedStyle(node).opacity);
    assert(Number(opacity) < 0.3);
    assert.equal(page.url(), beforeHover);
    await page.screenshot({ path: `${directory}/${name}-node-hover.png` });
    await root.getByRole("searchbox", { name: "Search nodes" }).hover();
    assert.equal(await root.locator(".gx-node.is-muted").count(), 0);
    await hoverNode.focus();
    assert((await root.locator(".gx-node.is-muted").count()) > 0);
    await root.getByRole("searchbox", { name: "Search nodes" }).focus();
    assert.equal(await root.locator(".gx-node.is-muted").count(), 0);
    await hoverNode.click();
    assert.equal(
      new URLSearchParams(new URL(page.url()).hash.slice(1)).get("focus"),
      hoverId,
    );
    await root.locator("[data-depth]").selectOption("2");
    await root
      .locator("[data-status]")
      .filter({ hasText: "Showing all" })
      .waitFor();
    await root.getByRole("searchbox", { name: "Search nodes" }).hover();
    assert.equal(await root.getAttribute("data-highlight-node"), hoverId);
    assert((await root.locator(".gx-node.is-muted").count()) > 0);
    const otherNode = root.locator('.gx-node[data-node-type="Journey"]').nth(1);
    const otherId = await otherNode.getAttribute("data-node-id");
    await otherNode.hover({ force: true });
    assert.equal(await root.getAttribute("data-highlight-node"), hoverId);
    await otherNode.press("Enter");
    assert.equal(
      new URLSearchParams(new URL(page.url()).hash.slice(1)).get("focus"),
      otherId,
    );
    await root
      .locator("[data-status]")
      .filter({ hasText: "Showing all" })
      .waitFor();
    await root.getByRole("searchbox", { name: "Search nodes" }).hover();
    assert.equal(await root.getAttribute("data-highlight-node"), otherId);
    await root.getByRole("button", { name: "Close node details" }).click();
    assert.equal(await root.getAttribute("data-highlight-node"), otherId);
    assert((await root.locator(".gx-node.is-muted").count()) > 0);
    await page.screenshot({ path: `${directory}/${name}-node-pinned.png` });
    await page.reload();
    await root.locator(".gx-node.is-muted").first().waitFor();
    assert.equal(await root.getAttribute("data-highlight-node"), otherId);
    assert.equal(
      await root
        .getByRole("button", { name: "Clear highlight", exact: true })
        .count(),
      0,
    );
    await root.locator("[data-graph]").click({ position: { x: 8, y: 8 } });
    assert.equal(await root.locator(".gx-node.is-muted").count(), 0);
    assert(!new URL(page.url()).hash.includes("highlight="));
    await root.locator("[data-depth]").selectOption("1");
    await root
      .locator("[data-status]")
      .filter({ hasText: "Showing all" })
      .waitFor();
    await root.locator(".gx-node").first().press("Enter");
    await root
      .locator("[data-status]")
      .filter({ hasText: "Showing all" })
      .waitFor();
    await root.getByRole("button", { name: "Close node details" }).click();
    assert(new URL(page.url()).hash.includes("highlight="));
    const connection = root.locator(".gx-edge-hit").first();
    const connectionPoint = await root
      .locator(".gx-edge-hit")
      .evaluateAll((lines) => {
        for (const line of lines) {
          const matrix = line.getScreenCTM();
          const svg = line.ownerSVGElement;
          if (!matrix || !svg) continue;
          const from = new globalThis.DOMPoint(
            Number(line.getAttribute("x1")),
            Number(line.getAttribute("y1")),
          ).matrixTransform(matrix);
          const to = new globalThis.DOMPoint(
            Number(line.getAttribute("x2")),
            Number(line.getAttribute("y2")),
          ).matrixTransform(matrix);
          if (Math.hypot(to.x - from.x, to.y - from.y) < 120) continue;
          for (const fraction of [0.25, 0.75, 0.5]) {
            const x = from.x + (to.x - from.x) * fraction;
            const y = from.y + (to.y - from.y) * fraction;
            const target = globalThis.document.elementFromPoint(x, y);
            if (!target || !svg.contains(target) || target.closest(".gx-node"))
              continue;
            const bounds = svg.getBoundingClientRect();
            return {
              x: x - bounds.left,
              y: y - bounds.top,
              predicate: line.getAttribute("data-predicate"),
            };
          }
        }
        return null;
      });
    assert(connectionPoint);
    await root.locator("[data-graph]").tap({ position: connectionPoint });
    assert(!new URL(page.url()).hash.includes("highlight="));
    assert.equal(await root.locator(".gx-node.is-muted").count(), 0);
    const predicate = connectionPoint.predicate;
    await root.locator("[data-graph]").hover({ position: connectionPoint });
    await root.locator("[data-edge-tooltip]").waitFor({ state: "visible" });
    assert(
      (await root.locator("[data-edge-tooltip]").innerText()).includes(
        predicate,
      ),
    );
    assert.match(await root.locator("[data-edge-tooltip]").innerText(), /→/);
    await root.screenshot({ path: `${directory}/${name}-relationship.png` });
    await connection.press("Escape");
    await root.locator("[data-edge-tooltip]").waitFor({ state: "hidden" });
    await root.locator("[data-graph]").tap({ position: connectionPoint });
    await root.locator("[data-edge-tooltip]").waitFor({ state: "visible" });
    await connection.press("Escape");
    await root.screenshot({ path: `${directory}/${name}-desktop.png` });
    const beforeFullscreen = page.url();
    const beforeScale = (
      await root.locator("[data-scene]").getAttribute("transform")
    )?.match(/scale\(([^)]+)\)/)?.[1];
    await root.getByRole("button", { name: "Fullscreen", exact: true }).click();
    await root
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .waitFor();
    await page.waitForFunction(() => {
      const bounds = globalThis.document
        .querySelector("[data-graph-explorer]")
        ?.getBoundingClientRect();
      return (
        bounds &&
        Math.abs(bounds.width - globalThis.innerWidth) < 2 &&
        Math.abs(bounds.height - globalThis.innerHeight) < 2 &&
        bounds.y === 0
      );
    });
    assert.equal(
      (await root.locator("[data-scene]").getAttribute("transform"))?.match(
        /scale\(([^)]+)\)/,
      )?.[1],
      beforeScale,
    );
    assert(
      await page.evaluate(() =>
        globalThis.document
          .querySelector("[data-graph-explorer]")
          ?.contains(globalThis.document.elementFromPoint(10, 10)),
      ),
    );
    await root.screenshot({ path: `${directory}/${name}-fullscreen.png` });
    const fullscreenAxe = await new AxeBuilder({ page })
      .include(".graph-explorer")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      fullscreenAxe.violations.map((item) => item.id),
      [],
    );
    await root
      .getByRole("button", { name: "Exit fullscreen", exact: true })
      .press("Escape");
    await root
      .getByRole("button", { name: "Fullscreen", exact: true })
      .waitFor();
    assert.equal(page.url(), beforeFullscreen);
    await root
      .getByRole("button", { name: "Show everything", exact: true })
      .click();
    await root.locator('[data-kind][value="Document"]').check();
    await root.locator("[data-content-type]").selectOption("how-to");
    const howToCount = corpusMetadata.filter(
      (record) => record.values.type === "how-to",
    ).length;
    assert(howToCount > 0);
    assert.equal(
      Number(await root.locator("[data-result-count]").innerText()),
      howToCount,
    );
    await root
      .getByRole("button", { name: "Add metadata filter", exact: true })
      .click();
    await root
      .getByLabel("Metadata filter 1 field", { exact: true })
      .selectOption("/language");
    await root
      .getByLabel("Metadata filter 1 value", { exact: true })
      .fill("en");
    await root
      .getByLabel("Metadata filter 1 value", { exact: true })
      .press("Enter");
    const englishHowToCount = corpusMetadata.filter(
      (record) =>
        record.values.type === "how-to" && record.values.language === "en",
    ).length;
    assert.equal(
      Number(await root.locator("[data-result-count]").innerText()),
      englishHowToCount,
    );
    const metadataUrl = page.url();
    await page.addInitScript(() =>
      Object.defineProperty(globalThis.document, "fullscreenEnabled", {
        get: () => false,
        configurable: true,
      }),
    );
    await page.reload();
    await root
      .locator("[data-total]")
      .filter({ hasText: "strategy records" })
      .waitFor();
    assert.equal(
      await root.locator("[data-content-type]").inputValue(),
      "how-to",
    );
    assert.equal(
      await root
        .getByLabel("Metadata filter 1 value", { exact: true })
        .inputValue(),
      "en",
    );
    assert.equal(page.url(), metadataUrl);
    await root.screenshot({ path: `${directory}/${name}-how-to.png` });
    await root
      .locator("[data-status]")
      .filter({ hasText: "Showing all" })
      .waitFor();
    const filteredRandomIds = await root
      .locator(".gx-node")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("data-node-id")),
      );
    await randomButton.click();
    const filteredRandomState = new URLSearchParams(
      new URL(page.url()).hash.slice(1),
    );
    assert(filteredRandomIds.includes(filteredRandomState.get("node")));
    assert.equal(filteredRandomState.get("contentType"), "how-to");
    assert.equal(filteredRandomState.getAll("meta").length, 1);
    await root
      .getByRole("button", { name: "Remove metadata filter 1", exact: true })
      .click();
    assert.equal(await root.locator("[data-filter-row]").count(), 0);
    await root
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    assert.equal(await root.locator("[data-content-type]").inputValue(), "");
    const expectedNodes = Number(
      (await root.locator("[data-total]").innerText())
        .split(" ")[0]
        .replaceAll(",", ""),
    );
    await root
      .getByRole("button", { name: "Show everything", exact: true })
      .click();
    await root
      .locator(`[data-drawing][data-node-count="${expectedNodes}"]`)
      .waitFor({ state: "visible", timeout: 30000 });
    assert.equal(
      await root.getByRole("searchbox", { name: "Search nodes" }).inputValue(),
      "",
    );
    assert.equal(await root.locator("[data-kind]:checked").count(), 0);
    assert.match(
      await root.locator("[data-status]").innerText(),
      /Showing all/,
    );
    await root.screenshot({ path: `${directory}/${name}-everything.png` });
    const initialFont = Number(
      await root.locator("[data-drawing]").getAttribute("data-label-font"),
    );
    for (let step = 0; step < 13; step++)
      await root.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.waitForFunction(
      () =>
        Number(
          globalThis.document
            .querySelector("[data-drawing]")
            ?.getAttribute("data-label-font"),
        ) > 16,
    );
    const enlargedFont = Number(
      await root.locator("[data-drawing]").getAttribute("data-label-font"),
    );
    assert(enlargedFont > initialFont);
    assert(
      Number(
        await root.locator("[data-drawing]").getAttribute("data-label-count"),
      ) > 0,
    );
    await root.screenshot({ path: `${directory}/${name}-labels.png` });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          ),
        ),
    );
    const canvasNode = await root
      .locator("[data-drawing]")
      .evaluate((surface) => {
        const context = surface.getContext("2d");
        if (!context) return null;
        const width = surface.width;
        const height = surface.height;
        const ratio = width / surface.clientWidth;
        const pixels = context.getImageData(0, 0, width, height).data;
        for (let y = 26; y < height - 26; y += 3)
          for (let x = 26; x < width - 26; x += 3) {
            const offset = (y * width + x) * 4;
            const red = pixels[offset];
            const green = pixels[offset + 1];
            const blue = pixels[offset + 2];
            if (
              pixels[offset + 3] < 245 ||
              Math.max(red, green, blue) - Math.min(red, green, blue) < 45
            )
              continue;
            let solid = true;
            for (let dy = -2; dy <= 2; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                const index = ((y + dy) * width + x + dx) * 4;
                if (
                  pixels[index + 3] < 245 ||
                  Math.abs(pixels[index] - red) +
                    Math.abs(pixels[index + 1] - green) +
                    Math.abs(pixels[index + 2] - blue) >
                    12
                )
                  solid = false;
              }
            if (solid) return { x: x / ratio, y: y / ratio };
          }
        return null;
      });
    assert(canvasNode, "A visible colored node is required for hover testing");
    const beforeCanvasHover = page.url();
    await root.locator("[data-graph]").hover({ position: canvasNode });
    await page.waitForFunction(() =>
      Boolean(
        globalThis.document
          .querySelector("[data-drawing]")
          ?.getAttribute("data-hover-node"),
      ),
    );
    assert(
      Number(
        await root
          .locator("[data-drawing]")
          .getAttribute("data-highlighted-nodes"),
      ) >= 1,
    );
    assert(
      Number(
        await root.locator("[data-drawing]").getAttribute("data-dimmed-nodes"),
      ) > 0,
    );
    assert.equal(page.url(), beforeCanvasHover);
    await page.screenshot({
      path: `${directory}/${name}-canvas-node-hover.png`,
    });
    await root.getByRole("searchbox", { name: "Search nodes" }).hover();
    await page.waitForFunction(
      () =>
        globalThis.document
          .querySelector("[data-drawing]")
          ?.getAttribute("data-dimmed-nodes") === "0",
    );
    await root.locator("[data-graph]").click({ position: canvasNode });
    const pinnedCanvasId = new URLSearchParams(
      new URL(page.url()).hash.slice(1),
    ).get("highlight");
    assert(pinnedCanvasId);
    assert.equal(
      new URLSearchParams(new URL(page.url()).hash.slice(1)).get("focus"),
      pinnedCanvasId,
    );
    await root
      .locator("[data-status]")
      .filter({ hasText: "Showing all" })
      .waitFor();
    await page.screenshot({ path: `${directory}/${name}-node-focused.png` });
    await root
      .getByRole("button", { name: "Show whole graph", exact: true })
      .click();
    await root
      .locator("[data-status]")
      .filter({ hasText: "Showing all" })
      .waitFor();
    await root
      .locator(`[data-drawing][data-node-count="${expectedNodes}"]`)
      .waitFor({ state: "visible" });
    await root.getByRole("searchbox", { name: "Search nodes" }).hover();
    await page.waitForFunction(
      (id) =>
        globalThis.document
          .querySelector("[data-drawing]")
          ?.getAttribute("data-highlight-node") === id,
      pinnedCanvasId,
    );
    assert(
      Number(
        await root.locator("[data-drawing]").getAttribute("data-dimmed-nodes"),
      ) > 0,
    );
    await root.getByRole("button", { name: "Zoom out", exact: true }).click();
    await root.getByRole("button", { name: "Close node details" }).click();
    await page.waitForFunction(
      (id) =>
        globalThis.document
          .querySelector("[data-drawing]")
          ?.getAttribute("data-highlight-node") === id,
      pinnedCanvasId,
    );
    await page.screenshot({
      path: `${directory}/${name}-canvas-node-pinned.png`,
    });
    const panBounds = await root.locator("[data-graph]").boundingBox();
    assert(panBounds);
    await page.mouse.move(panBounds.x + 8, panBounds.y + 8);
    await page.mouse.down();
    await page.mouse.move(panBounds.x + 70, panBounds.y + 50, { steps: 5 });
    await page.mouse.up();
    assert(new URL(page.url()).hash.includes("highlight="));
    await root.getByRole("button", { name: "Fit graph", exact: true }).click();
    await root.locator("[data-graph]").tap({ position: { x: 8, y: 8 } });
    await page.waitForFunction(
      () =>
        globalThis.document
          .querySelector("[data-drawing]")
          ?.getAttribute("data-dimmed-nodes") === "0",
    );
    assert(!new URL(page.url()).hash.includes("highlight="));
    for (let i = 0; i < 12; i++)
      await root.getByRole("button", { name: "Zoom in", exact: true }).click();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() =>
            globalThis.requestAnimationFrame(resolve),
          ),
        ),
    );
    const edgePoint = await root
      .locator("[data-drawing]")
      .evaluate((surface) => {
        const context = surface.getContext("2d");
        if (!context) return null;
        const width = surface.width;
        const height = surface.height;
        const ratio = width / surface.clientWidth;
        const pixels = context.getImageData(0, 0, width, height).data;
        const sums = new Int32Array((width + 1) * (height + 1));
        for (let y = 0; y < height; y++) {
          let row = 0;
          for (let x = 0; x < width; x++) {
            if (pixels[(y * width + x) * 4 + 3] > 100) row++;
            sums[(y + 1) * (width + 1) + x + 1] =
              sums[y * (width + 1) + x + 1] + row;
          }
        }
        const radius = Math.ceil(26 * ratio);
        for (let y = radius; y < height - radius; y += 3)
          for (let x = radius; x < width - radius; x += 3) {
            const alpha = pixels[(y * width + x) * 4 + 3];
            if (alpha < 8 || alpha > 90) continue;
            const blocked =
              sums[(y + radius) * (width + 1) + x + radius] -
              sums[(y - radius) * (width + 1) + x + radius] -
              sums[(y + radius) * (width + 1) + x - radius] +
              sums[(y - radius) * (width + 1) + x - radius];
            if (!blocked) return { x: x / ratio, y: y / ratio };
          }
        return null;
      });
    assert(
      edgePoint,
      "A visible connection away from node hit targets is required",
    );
    await root.locator("[data-graph]").hover({ position: edgePoint });
    await root
      .locator("[data-edge-tooltip]")
      .waitFor({ state: "visible", timeout: 5000 });
    assert.match(await root.locator("[data-edge-tooltip]").innerText(), /→/);
    await root.screenshot({
      path: `${directory}/${name}-canvas-relationship.png`,
    });
    await root.getByRole("button", { name: "Fit graph", exact: true }).click();
    const wholeBounds = await root.locator("[data-graph]").boundingBox();
    assert(wholeBounds);
    await root.locator("[data-graph]").click({
      position: { x: wholeBounds.width / 2, y: wholeBounds.height / 2 },
    });
    await root.locator("[data-inspector]").waitFor({ state: "visible" });
    assert.doesNotMatch(
      await root.locator("[data-node-title]").innerText(),
      /isn’t in/,
    );
    await root
      .getByRole("button", { name: "Show everything", exact: true })
      .click();
    const everythingUrl = page.url();
    await page.reload();
    await root
      .locator(`[data-drawing][data-node-count="${expectedNodes}"]`)
      .waitFor({ state: "visible", timeout: 30000 });
    assert.equal(page.url(), everythingUrl);
    await root.getByRole("searchbox", { name: "Search nodes" }).fill("Devin");
    const persona = root
      .locator(".gx-result")
      .filter({ hasText: "Persona · docs/content-strategy/personas/devin.md" });
    await persona.waitFor();
    await persona.click();
    const selectedState = new URLSearchParams(
      new URL(page.url()).hash.slice(1),
    );
    assert.equal(selectedState.get("focus"), selectedState.get("node"));
    assert.equal(selectedState.get("q"), null);
    await root.getByRole("tab", { name: "Metadata", exact: true }).click();
    assert.match(
      await root.locator('[data-panel="metadata"]').innerText(),
      /goals/,
    );
    await root
      .getByRole("button", { name: "Focus here", exact: false })
      .click();
    await root.locator("[data-depth]").selectOption("2");
    await root.getByRole("button", { name: "List", exact: true }).click();
    const saved = page.url();
    await page.reload();
    await root
      .locator("[data-total]")
      .filter({ hasText: "strategy records" })
      .waitFor();
    assert.equal(page.url(), saved);
    assert.equal(await root.getAttribute("data-view"), "list");
    await root.getByRole("tab", { name: "Connections", exact: true }).click();
    assert((await root.locator(".gx-connection").count()) > 0);
    await root
      .getByRole("tab", { name: "Connections", exact: true })
      .press("ArrowRight");
    assert.equal(
      await root
        .getByRole("tab", { name: "Metadata", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    await root.getByRole("button", { name: "Close node details" }).click();
    await root.getByRole("button", { name: "Reset", exact: true }).click();
    await root
      .getByRole("searchbox", { name: "Search nodes" })
      .fill("nothing-matches-this-string-48293");
    await root.locator("[data-empty]").waitFor();
    assert(await randomButton.isDisabled());
    assert.match(
      await root.locator("[data-empty]").innerText(),
      /No matching nodes/,
    );
    await root
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await root.getByRole("button", { name: "Graph", exact: true }).click();
    await root
      .locator(`[data-drawing][data-node-count="${expectedNodes}"]`)
      .waitFor({ state: "visible", timeout: 30000 });
    const before = await root.locator("[data-scene]").getAttribute("transform");
    await root.getByRole("button", { name: "Zoom in", exact: true }).click();
    assert.notEqual(
      await root.locator("[data-scene]").getAttribute("transform"),
      before,
    );
    await root.getByRole("button", { name: "Fit graph", exact: true }).click();
    const axe = await new AxeBuilder({ page })
      .include(".graph-explorer")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      [],
    );
    await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
    const darkAxe = await new AxeBuilder({ page })
      .include(".graph-explorer")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      darkAxe.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      [],
    );

    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [320, 568],
    ]) {
      await page.setViewportSize({ width, height });
      if (width === 390) {
        await root
          .getByRole("button", { name: "Show everything", exact: true })
          .click();
        await root
          .locator(`[data-drawing][data-node-count="${expectedNodes}"]`)
          .waitFor({ state: "visible", timeout: 30000 });
        await root.screenshot({
          path: `${directory}/${name}-everything-mobile.png`,
        });
        await root
          .getByRole("button", { name: "Fullscreen", exact: true })
          .click();
        await root
          .getByRole("button", { name: "Exit fullscreen", exact: true })
          .waitFor();
        const mobileFullscreen = await root.boundingBox();
        assert(
          await page.evaluate(() =>
            globalThis.document
              .querySelector("[data-graph-explorer]")
              ?.contains(globalThis.document.elementFromPoint(10, 10)),
          ),
        );
        await root
          .locator("[data-status]")
          .filter({ hasText: "Showing all" })
          .waitFor();
        assert(
          mobileFullscreen &&
            mobileFullscreen.x === 0 &&
            mobileFullscreen.y === 0 &&
            Math.abs(mobileFullscreen.width - width) < 2 &&
            Math.abs(mobileFullscreen.height - height) < 2,
        );
        const fullCanvas = await root.locator("[data-canvas]").boundingBox();
        assert(fullCanvas && fullCanvas.height > 200);
        await randomButton.tap();
        const mobileRandomState = new URLSearchParams(
          new URL(page.url()).hash.slice(1),
        );
        assert(mobileRandomState.get("node"));
        assert.equal(
          mobileRandomState.get("focus"),
          mobileRandomState.get("node"),
        );
        await root
          .getByRole("button", { name: "Show everything", exact: true })
          .click();
        await root
          .locator(`[data-drawing][data-node-count="${expectedNodes}"]`)
          .waitFor({ state: "visible" });
        await root.screenshot({
          path: `${directory}/${name}-fullscreen-mobile.png`,
        });
        await root
          .getByRole("button", { name: "Exit fullscreen", exact: true })
          .click();
        await root
          .getByRole("button", { name: "Fullscreen", exact: true })
          .waitFor();
      }
      await root.getByRole("button", { name: "List", exact: true }).click();
      const overflow = await page.evaluate(
        () =>
          globalThis.document.documentElement.scrollWidth >
          globalThis.innerWidth,
      );
      assert.equal(
        overflow,
        false,
        `Horizontal overflow at ${width}x${height}`,
      );
      await root.getByRole("searchbox", { name: "Search nodes" }).fill("Devin");
      await persona.waitFor();
      await persona.click();
      const mobileSelection = new URLSearchParams(
        new URL(page.url()).hash.slice(1),
      );
      assert.equal(mobileSelection.get("focus"), mobileSelection.get("node"));
      const bounds = await root.locator("[data-inspector]").boundingBox();
      await root.screenshot({
        path: `${directory}/${name}-${width}x${height}.png`,
      });
      assert(
        bounds &&
          bounds.x >= 0 &&
          bounds.x + bounds.width <= width + 1 &&
          bounds.y + bounds.height <= height + 1,
        `${name} inspector outside ${width}x${height}: ${JSON.stringify(bounds)}`,
      );
      if (width === 390) {
        const mobileAxe = await new AxeBuilder({ page })
          .include(".graph-explorer")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        assert.deepEqual(
          mobileAxe.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.length,
          })),
          [],
        );
      }
      await root.getByRole("button", { name: "Close node details" }).click();
      await root.getByRole("button", { name: "Reset", exact: true }).click();
    }
    // A missing artifact offers a real retry, rather than a blank graph.
    await page.route("**/explorer-data/graph.jsonld", (route) =>
      route.fulfill({ status: 503, body: "Unavailable" }),
    );
    await page.reload();
    await root.getByRole("button", { name: "Retry", exact: true }).waitFor();
    await page.unroute("**/explorer-data/graph.jsonld");
    await root.getByRole("button", { name: "Retry", exact: true }).click();
    await root
      .locator("[data-total]")
      .filter({ hasText: "strategy records" })
      .waitFor();
    assert.deepEqual(errors, []);
    report.push({
      browser: name,
      corpus: await root.locator("[data-total]").innerText(),
      desktop: "passed",
      mobile: "390x844, 844x390, 320x568 passed",
      accessibility: "0 axe violations",
      workflow:
        "search, persona, incoming/outgoing connections, metadata, URL reload, keyboard tabs, zoom, empty state, retry passed",
    });
    await context.close();
  } finally {
    await browser.close();
  }
}
await writeFile(
  `${directory}/report.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
