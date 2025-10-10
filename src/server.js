import express from "express";
import { scanAndTranscribe, analyzeSingleRecording } from "./jobs/transcribeJob.js";
import { CONFIG } from "./config/env.js";

const app = express();
app.use(express.json());

// 🟢 Auto-scanning mode (periodic)
console.log("🚀 AI Call Analyzer started...");
scanAndTranscribe();
setInterval(scanAndTranscribe, CONFIG.scanInterval * 60 * 1000);

// 🎯 Manual mode: triggered by Laravel
app.post("/analyze", async (req, res) => {
  const { call_id, recording_file, agent, extension } = req.body;
  if (!recording_file) {
    return res.status(400).json({ success: false, error: "Missing recording_file" });
  }

  try {
    const result = await analyzeSingleRecording(recording_file, call_id, agent, extension);
    res.json({ success: true, message: "Analysis complete", result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = CONFIG.apiPort || 4000;
app.listen(PORT, () => console.log(`📡 API Server running on port ${PORT}`));
