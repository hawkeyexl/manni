import captures from "./captures.json";
import { FPS, timeline, type Beat } from "../beats";

export { FPS };

// Measured wall-clock latency of the real commands on this machine, three runs
// each (media/capture-url, same shell): validate 563-591 ms (includes the fetch),
// token-unset 532-556 ms, --offline 521-547 ms. Output never appears sooner.
export const latency = {
  validate: Math.round(0.57 * FPS),
  tokenUnset: Math.round(0.54 * FPS),
  offline: Math.round(0.53 * FPS),
  cat: 2,
  echo: 2,
};

export const beats: Beat[] = [
  {
    title: "file: is a URL now",
    caption:
      "The manifest lives in another repo. A public one needs no token: a URL and the keys it owns.",
    commands: [
      { typed: "cat manni.config.yaml", output: captures["cat manni.config.yaml (public)"], latencyFrames: latency.cat, holdFrames: 4.2 * FPS },
    ],
  },
  {
    title: "validate fetches it",
    caption:
      "The merged object is checked. billing's bad ticket is reported at the URL, line 6, not in the page.",
    commands: [
      { typed: "manni meta validate", output: captures["manni meta validate"], latencyFrames: latency.validate, holdFrames: 5.0 * FPS },
      { typed: "echo $?", output: "1\n", latencyFrames: latency.echo, holdFrames: 2.0 * FPS },
    ],
  },
  {
    title: "Private: add tokenEnv",
    caption:
      "tokenEnv names the variable holding the token. Unset, the run stops with exit 2 and names the variable.",
    commands: [
      { typed: "cat manni.config.yaml", output: captures["cat manni.config.yaml (private)"], latencyFrames: latency.cat, holdFrames: 2.6 * FPS },
      { typed: "manni meta validate", output: captures["manni meta validate (token unset)"], latencyFrames: latency.tokenUnset, holdFrames: 3.6 * FPS },
      { typed: "echo $?", output: "2\n", latencyFrames: latency.echo, holdFrames: 1.8 * FPS },
    ],
  },
  {
    title: "--offline refuses it",
    caption:
      "A remote manifest is fetched every run, never cached. With no network there is nothing to check, so it stops.",
    commands: [
      { typed: "manni meta validate --offline", output: captures["manni meta validate --offline"], latencyFrames: latency.offline, holdFrames: 3.6 * FPS },
    ],
  },
  {
    title: "Exit codes for CI",
    caption:
      "1 for findings, 2 when the manifest cannot be reached. The message names the variable, never the token.",
    continues: true,
    commands: [
      { typed: "echo $?", output: "2\n", latencyFrames: latency.echo, holdFrames: 4.0 * FPS },
    ],
  },
];

export const beatDurations = beats.map((b) => timeline(b).duration);
export const totalFrames = beatDurations.reduce((a, b) => a + b, 0);
