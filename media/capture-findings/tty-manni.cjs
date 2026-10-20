// media/capture/tty.cjs, but only for manni's own process. Under npx,
// NODE_OPTIONS reaches npm's node too, and npm on a "terminal" draws a
// spinner that a capture file cannot take. So the shim applies when the
// script is a manni dist/cli.js and leaves npm untouched.
if (/dist.cli.js$/.test(process.argv[1] ?? "")) require("../capture/tty.cjs");
