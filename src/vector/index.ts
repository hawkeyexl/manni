/**
 * The vector domain's programmatic API (proposal 0128), re-exported by
 * `src/index.ts` as `vector`. The umbrella mounts `./cli.js` directly.
 */
export {
  runBuild,
  renderBuild,
  embedText,
  type BuildOptions,
  type BuildReport,
  type LanguageReport,
} from "./commands/build.js";
export { runSearch, renderSearch, type SearchOptions, type SearchReport } from "./commands/search.js";
