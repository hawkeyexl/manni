/**
 * A term's identity when its record carries no `id` and its construct no
 * identifier of its own: the GitHub slug of its preferred label. The slug is
 * `github-slugger`'s, which is the one kg mints concept IRIs with, so a term
 * and its kg concept agree on a name without either carrying one.
 */
import { slug } from "github-slugger";

/** The slug of `label`, trimmed first: a stray space is not part of a name. */
export function slugOf(label: string): string {
  return slug(label.trim());
}
