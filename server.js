import express from "express";
import fs from "fs";
import path from "path";
import ftp from "ftp";
import axios from "axios";
import { CONFIG } from "./config/env.js";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.post("/analyze", async (req, res) => {
  const { call_id, recording_file, agent, extension } = req.body;

  if (!recording_file || !extension) {
    return res
      .status(400)
      .json({ error: "Missing recording_file or extension" });
  }

  const baseName = recording_file.replace(/\.wav$/, "");
  const tmpDir = path.join(__dirname, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  let actualFtpFile = null;

  console.log(`🎧 Searching FTP folder for file: ${recording_file}`);

  try {
    // STEP 1️⃣: Connect to FTP and find actual file (closest timestamp match)
    await new Promise((resolve, reject) => {
      const client = new ftp();

      client.on("ready", () => {
        client.list(`${CONFIG.ftpBasePath}/${extension}`, (err, list) => {
          if (err) {
            client.end();
            return reject(err);
          }

          // 🔍 Smarter filename match
          const prefixMatch = baseName.replace(/_\d{14}$/, ""); // strip timestamp
          const timeMatch = recording_file.match(/_(\d{14})/);
          const targetTime = timeMatch ? timeMatch[1] : null;

          let bestFile = null;
          let bestDiff = Infinity;

          list.forEach((item) => {
            if (!item.name.startsWith(prefixMatch)) return;

            const m = item.name.match(/_(\d{14})/);
            if (!m) return;

            if (!targetTime) {
              if (!bestFile) bestFile = item.name;
              return;
            }

            const diff = Math.abs(
              parseInt(m[1], 10) - parseInt(targetTime, 10)
            );
            if (diff < bestDiff) {
              bestDiff = diff;
              bestFile = item.name;
            }
          });

          if (bestFile) {
            actualFtpFile = bestFile;
            console.log(
              `✅ Matched closest recording on FTP: ${actualFtpFile}`
            );
            resolve();
          } else {
            reject(new Error(`No matching file found for ${baseName}`));
          }

          client.end();
        });
      });

      client.on("error", reject);
      client.connect({
        host: CONFIG.ftpHost,
        port: 21,
        user: CONFIG.ftpUser,
        password: CONFIG.ftpPassword,
        secure: false,
        connTimeout: 15000,
        pasvTimeout: 15000,
        keepalive: 10000,
      });
    });

    const ftpFilePath = `${CONFIG.ftpBasePath}/${extension}/${actualFtpFile}`;
    const localPath = path.join(tmpDir, actualFtpFile);

    console.log(`📥 Downloading: ${ftpFilePath}`);

    // STEP 2️⃣: Download file
    await new Promise((resolve, reject) => {
      const client = new ftp();

      client.on("ready", () => {
        client.get(ftpFilePath, (err, stream) => {
          if (err) {
            client.end();
            return reject(err);
          }

          stream.once("close", () => {
            client.end();
            resolve();
          });

          stream.pipe(fs.createWriteStream(localPath));
        });
      });

      client.on("error", reject);
      client.connect({
        host: CONFIG.ftpHost,
        port: 21,
        user: CONFIG.ftpUser,
        password: CONFIG.ftpPassword,
        secure: false,
        connTimeout: 15000,
        pasvTimeout: 15000,
        keepalive: 10000,
      });
    });

    console.log(`✅ Downloaded ${actualFtpFile} to ${localPath}`);

    // STEP 3️⃣: Transcribe with Whisper
    const whisperRes = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        model: "whisper-1",
        file: fs.createReadStream(localPath),
      },
      {
        headers: {
          Authorization: `Bearer ${CONFIG.openaiKey}`,
          "Content-Type": "multipart/form-data",
        },
        timeout: 600000, // 10 min
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const transcript = whisperRes.data.text || "";
    console.log(`🗣️ Transcript: ${transcript}`);

    // STEP 4️⃣: Analyze with GPT
    const gptRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4.1",
        messages: [
          {
            role: "system",
            content: `You are an AI call-analysis expert. Analyze the following call transcript and return a strict JSON object with these exact fields:

{
  "call_type": "fresh" | "repeat" | "OCC",
  "reason": string,
  "sentiment": "positive" | "neutral" | "negative" | "Not Sure",
  "agent_tone": "positive" | "slightly_positive" | "neutral" | "slightly_negative" | "negative" | "Not Sure"
}

### CALL TYPE LOGIC
- **fresh** → Caller is contacting Blue Lotus Vacations for the first time or becomes interested in booking after initially unrelated (OCC) talk.
- **repeat** → Caller mentions a previous call, booking, payment, reference, or asks for a specific agent by name. Even without a company name, any agent request = repeat.
- **OCC** → Entire call is unrelated to Blue Lotus Vacations and stays unrelated. Use only when clearly unrelated.
If unsure between OCC and another type, prefer **fresh** or **repeat**.

### REASON
Summarize what the call is about (e.g., “Inquiry about Thailand holiday package,” “Requested Emirates flight reference,” “Payment follow-up”).
If unclear, return “Not Sure”.

### SENTIMENT
- **positive** → caller is polite, cooperative, or happy
- **neutral** → calm, factual, or purely administrative
- **negative** → caller is angry, frustrated, dismissive, or rude
If unsure, return “Not Sure”.

### AGENT_TONE
Classify the agent's tone based on professionalism, empathy, and communication clarity:

- **positive** → consistently polite, empathetic, confident, and helpful throughout.
- **slightly_positive** → mostly polite and calm but shows small signs of uncertainty or mild defensiveness.
- **neutral** → professional and factual but emotionally flat or mechanical; not clearly empathetic or rude.
- **slightly_negative** → polite but noticeably hesitant, unprepared, defensive, or unable to provide clear information, which may frustrate the customer.
- **negative** → rude, dismissive, sarcastic, hostile, unprofessional, or showing clear impatience.
If uncertain, return “Not Sure”.

### OUTPUT
Return only valid JSON with no explanations, text, or commentary outside the JSON.

            `,
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
        timeout: 90000,
      }
    );

    const analysis = gptRes.data.choices[0]?.message?.content || "{}";
    console.log(`🤖 AI Analysis: ${analysis}`);

    // STEP 5️⃣: Send results to Laravel
    try {
      const parsed = JSON.parse(analysis);
      const payload = {
        extension,
        filename: actualFtpFile,
        transcript,
        sentiment: parsed.sentiment || null,
        reason: parsed.reason || null,
        call_type: parsed.call_type || null,
        agent_tone: parsed.agent_tone || null,
        call_id,
      };
      console.log("Payload sent to Laravel:", payload);

      const response = await axios.post(`${CONFIG.apiUrl}/ai/store`, payload, {
        timeout: 15000,
      });
      console.log(`📡 Sent AI analysis back to Laravel for ${actualFtpFile}`);
      console.log("📨 Laravel response:", response.data);
    } catch (e) {
      console.log(
        "⚠️ Error sending back to Laravel:",
        e.response?.data || e.message
      );
    }

    // STEP 6️⃣: Cleanup
    try {
      fs.unlinkSync(localPath);
    } catch (cleanupErr) {
      console.warn("⚠️ Cleanup failed:", cleanupErr.message);
    }

    res.json({
      success: true,
      call_id,
      transcript,
      analysis: JSON.parse(analysis),
    });
  } catch (err) {
    console.error("💥 Error in /analyze:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(CONFIG.port || 4000, "0.0.0.0", () => {
  console.log(`📡 AI Analyzer API running on port ${CONFIG.port || 4000}`);
});
