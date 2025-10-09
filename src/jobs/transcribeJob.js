// Handles periodic transcription jobs
import ftp from "ftp";
import fs from "fs";
import axios from "axios";
import { CONFIG } from "../config/env.js";

export async function scanAndTranscribe() {
  console.log("📡 Checking FTP for new recordings...");

  const client = new ftp();
  client.on("ready", () => {
    client.list(CONFIG.ftpBasePath, (err, dirs) => {
      if (err) throw err;

      dirs.forEach(dir => {
        const dirPath = `${CONFIG.ftpBasePath}/${dir.name}`;
        client.list(dirPath, async (err, files) => {
          if (err) return;

          for (const file of files) {
            if (!file.name.endsWith(".wav")) continue;

            const localPath = `${CONFIG.tempDir}/${file.name}`;
            client.get(`${dirPath}/${file.name}`, async (err, stream) => {
              if (err) return;
              stream.pipe(fs.createWriteStream(localPath));

              stream.on("close", async () => {
                console.log(`🎧 Downloaded: ${file.name}`);
                await handleAudio(localPath, dir.name);
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

async function handleAudio(path, extension) {
  try {
    const whisperRes = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        model: "whisper-1",
        file: fs.createReadStream(path),
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

    // AI analysis
    const gptRes = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content: "Analyze the call and return JSON with call_type (fresh/repeat), reason, and sentiment.",
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
    console.log(`🤖 Analysis: ${analysis}`);

    // Send to Laravel
    await axios.post(CONFIG.apiUrl, {
      extension,
      transcript,
      analysis: JSON.parse(analysis),
    });

    console.log("✅ Sent to Laravel successfully!");
  } catch (err) {
    console.error("❌ Error handling audio:", err.message);
  } finally {
    fs.unlinkSync(path);
  }
}
