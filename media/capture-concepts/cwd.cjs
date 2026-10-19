// Start the CLI in DEMO_CWD exactly as spelled, the way a terminal opened there would.
// Git Bash hands a child the junction's resolved target as its working directory;
// a shell started in C:\concepts hands it C:\concepts. Nothing else changes.
if (process.env.DEMO_CWD) process.chdir(process.env.DEMO_CWD);
