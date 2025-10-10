import express from "express";
import { scanAndTranscribe } from "./jobs/transcribeJob.js";
import { CONFIG } from "./config/env.js";

const app = express();
app.use(express.json());

// Default health check
app.get("/", (req, res) => {
  res.json({ status: "AI Analyzer Running" });
});

// AI analyze route
app.post("/analyze", async (req, res) => {
  try {
    const { recording_file, extension, call_id } = req.body;

    if (!recording_file) {
      return res.status(400).json({ success: false, error: "Missing recording_file" });
    }

    console.log(`🎯 Starting single analysis for ${recording_file}`);
    // (you would then handle file download/transcription here...)

    return res.json({ success: true, message: "AI analysis started" });
  } catch (err) {
    console.error("❌ Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(80, "0.0.0.0", () => {
  console.log("📡 API Server running on port 80...");
});

// Start scheduled background job too
console.log("🚀 AI Call Analyzer started...");
scanAndTranscribe();
setInterval(scanAndTranscribe, CONFIG.scanInterval * 60 * 1000);
