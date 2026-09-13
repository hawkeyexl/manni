// Make the CLI believe stdout/stderr are a terminal, as they would be in the demo.
// Nothing else changes: the bytes below are what a terminal receives.
Object.defineProperty(process.stdout, "isTTY", { value: true });
Object.defineProperty(process.stderr, "isTTY", { value: true });
