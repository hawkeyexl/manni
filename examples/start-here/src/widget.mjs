// The widget CLI. The docs pin their claims about it to these lines.
export const DEFAULT_TIMEOUT_MS = 30000;
export const MAX_RETRIES = 3;

if (process.argv[2] === "run") console.log(`Job ${process.argv[3]}: done`);
