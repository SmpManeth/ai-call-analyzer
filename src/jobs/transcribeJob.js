// src/jobs/transcribeJob.js
import ftp from "ftp";
import fs from "fs";
import axios from "axios";
import FormData from "form-data";
import { CONFIG } from "../config/env.js";

export async function scanAndTranscribe() {
  console.log("📡 Checking FTP for new recordings...");

  const client = new ftp();

  client.on("ready", () => {
    client.list(CONFIG.ftpBasePath, (err, dirs) => {
      if (err) throw err;

      dirs.forEach((dir) => {
        const dirPath = `${CONFIG.ftpBasePath}/${dir.name}`;
        client.list(dirPath, async (err, files) => {
          if (err) return;

          for (const file of files) {
            if (!file.name.endsWith(".wav")) continue;

            // Ensure tmp directory exists
            fs.mkdirSync(CONFIG.tempDir, { recursive: true });
            const localPath = `${CONFIG.tempDir}/${file.name}`;

            client.get(`${dirPath}/${file.name}`, async (err, stream) => {
              if (err) return;

              const writeStream = fs.createWriteStream(localPath);
              stream.pipe(writeStream);

              stream.on("close", async () => {
                console.log(`🎧 Downloaded: ${file.name}`);
                await handleAudio(localPath, dir.name, file.name);
              });
            });
          }
        });
      });
    });
  });

  client.connect({
    host: CONFIG.ftpHost,
    user: CONFIG.ftpUser,
    password: CONFIG.ftpPassword,
  });
}

async function handleAudio(path, extension, filename) {
  try {
    // 1️⃣ Transcribe with Whisper
    const formData = new FormData();
    formData.append("model", "whisper-1");
    formData.append("file", fs.createReadStream(path));

    const whisperRes = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          Authorization: `Bearer ${CONFIG.openaiKey}`,
          ...formData.getHeaders(),
        },
      }
    );

    const transcript = whisperRes.data.text?.trim() || "";
    console.log(`🗣️ Transcript: ${transcript}`);

    // 2️⃣ Analyze with GPT
    const gptRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content:
              "Analyze this call transcript and return a JSON with fields: call_type (fresh or repeat), reason, sentiment.",
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

    const analysis = JSON.parse(gptRes.data.choices[0].message.content);
    console.log(`🤖 Analysis:`, analysis);

    const analysisData = {
      extension,
      filename,
      transcript,
      call_type: analysis.call_type,
      reason: analysis.reason,
      sentiment: analysis.sentiment,
    };

    console.log("📡 Sending payload:", analysisData);

    // 3️⃣ Send to Laravel API
    await axios.post(CONFIG.apiUrl, analysisData);

    console.log("✅ Sent to Laravel successfully!");
  } catch (err) {
    console.error(
      "❌ Error handling audio:",
      err.response?.data || err.message
    );
  } finally {
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}
