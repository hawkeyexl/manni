/**
 * `images:` - how many images, filtered by `url`, `alt`, and `attributes`.
 *
 * All three narrow the counted set rather than reporting their own finding -
 * proposal 0054's message table gives `images` only `images_count_error`, no
 * per-field diagnostic the way `elements.attributes` gets one. `attributes`
 * in particular can never match: `ImageNode` carries no `attributes` of its
 * own (the node model gave that field to `element` only), so any non-empty
 * `attributes` requirement here excludes every image, same as an image whose
 * `url` or `alt` does not match.
 */

import type { ContentNode, Finding, ImageNode, SectionNode } from "../types.js";
import {
  checkCount,
  imagesOf,
  sectionContext,
  type ImagesRule,
  type RuleContext,
} from "./index.js";

/** Checks the images a section holds directly. */
export function checkImages(
  section: SectionNode,
  rule: ImagesRule | undefined,
): Finding[] {
  return checkImagesIn(section.children, rule, sectionContext(section));
}

/** The reusable core: checks the images in any ordered content list. */
export function checkImagesIn(
  content: ContentNode[],
  rule: ImagesRule | undefined,
  ctx: RuleContext,
): Finding[] {
  if (!rule) return [];

  const matching = imagesOf(content).filter((image) => matches(image, rule));
  return checkCount(matching.length, rule, "image", "images_count_error", ctx);
}

function matches(image: ImageNode, rule: ImagesRule): boolean {
  if (rule.url !== undefined && image.url !== rule.url) return false;
  if (rule.alt !== undefined && image.alt !== rule.alt) return false;
  if (rule.attributes && Object.keys(rule.attributes).length > 0) return false;
  return true;
}
