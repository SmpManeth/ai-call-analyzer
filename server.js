import express from "express";
import fs from "fs";
import path from "path";
import axios from "axios";
import multer from "multer";
import { fileURLToPath } from "url";
import { CONFIG } from "./config/env.js";

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root recordings folder (adjust if needed)
const recordingsRoot = path.join(__dirname, "recordings");

// ---- POST /analyze ----
app.post("/analyze", async (req, res) => {
  try {
    const { call_id, recording_file, agent, extension } = req.body;

    if (!recording_file || !extension) {
      return res.status(400).json({ error: "Missing file name or extension" });
    }

    // Build folder and file path
    const folderPath = path.join(recordingsRoot, extension);
    const filePath = path.join(folderPath, recording_file);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: `File not found: ${filePath}`,
      });
    }

    console.log(`🎧 Found file for Call ${call_id}: ${filePath}`);

    // Step 1. Transcribe with Whisper
    const whisperRes = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        model: "whisper-1",
        file: fs.createReadStream(filePath),
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.openaiKey}`,
          "Content-Type": "multipart/form-data",
        },
      }
    );

    const transcript = whisperRes.data.text;
    console.log(`🗣️ Transcript: ${transcript}`);

    // Step 2. Analyze with GPT
    const gptRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content:
              "Analyze this call transcript and return JSON with call_type (fresh/repeat), reason, and sentiment.",
          },
          { role: "user", content: transcript },
        ],
        response_format: { type: "json_object" },
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.openaiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const analysis = gptRes.data.choices[0].message.content;
    console.log(`🤖 AI Analysis for Call ${call_id}: ${analysis}`);

    // (Optional) Send back to Laravel
    try {
      await axios.post(`${CONFIG.apiUrl}/ai/callback`, {
        call_id,
        analysis: JSON.parse(analysis),
      });
      console.log(`📡 Sent analysis back to Laravel for Call ${call_id}`);
    } catch (e) {
      console.error(`⚠️ Failed to send back to Laravel: ${e.message}`);
    }

    res.json({
      success: true,
      call_id,
      transcript,
      analysis: JSON.parse(analysis),
    });
  } catch (err) {
    console.error("💥 Error analyzing call:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---- Start API ----
app.listen(CONFIG.port || 4000, "0.0.0.0", () => {
  console.log(`📡 AI Analyzer API running on port ${CONFIG.port || 4000}`);
});
