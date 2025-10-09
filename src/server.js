import { scanAndTranscribe } from "./jobs/transcribeJob.js";
import { CONFIG } from "./config/env.js";

console.log("🚀 AI Call Analyzer started...");
scanAndTranscribe();
setInterval(scanAndTranscribe, CONFIG.scanInterval * 60 * 1000);
