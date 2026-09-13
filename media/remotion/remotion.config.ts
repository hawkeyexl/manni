import { Config } from "@remotion/cli/config";

// Use the Chrome already on this machine; do not download a headless shell.
Config.setBrowserExecutable("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
Config.setChromeMode("chrome-for-testing");
Config.setVideoImageFormat("png");
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
