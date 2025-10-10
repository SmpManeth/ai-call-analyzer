import ftpClient from "ftp";
import fs from "fs-extra";
import axios from "axios";
import FormData from "form-data";
import { CONFIG } from "../config/env.js";


// --------------------------
//  Transcribe single file
// --------------------------
async function transcribeAudio(filePath) {
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("file", fs.createReadStream(filePath));

  const response = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
    headers: {
      Authorization: `Bearer ${CONFIG.openaiKey}`,
      ...form.getHeaders(),
    },
  });

  return response.data.text;
}


// --------------------------
//  Analyze transcript
// --------------------------
async function analyzeTranscript(transcript) {
  const response = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content:
            "Analyze this call. Return a JSON with keys: call_type (fresh/repeat), reason, sentiment.",
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

  return JSON.parse(response.data.choices[0].message.content);
}


// --------------------------
//  Send to Laravel
// --------------------------
async function sendToLaravel(payload) {
  await axios.post(CONFIG.apiUrl, payload);
  console.log(`✅ Sent to Laravel for Call ${payload.call_id || "N/A"}`);
}


// --------------------------
//  Analyze a single recording (manual trigger)
// --------------------------
export async function analyzeSingleRecording(recordingFile, callId, agent, extension) {
  console.log(`🎯 Starting single analysis for ${recordingFile}`);

  const localPath = `${CONFIG.tempDir}/${recordingFile}`;
  await fs.ensureDir(CONFIG.tempDir);

  const ftp = new ftpClient();

  return new Promise((resolve, reject) => {
    ftp.on("ready", () => {
      const remotePath = `${CONFIG.ftpBasePath}/${recordingFile}`;
      ftp.get(remotePath, async (err, stream) => {
        if (err) {
          ftp.end();
          return reject(new Error(`FTP download failed: ${err.message}`));
        }

        stream.pipe(fs.createWriteStream(localPath));

        stream.on("close", async () => {
          try {
            const transcript = await transcribeAudio(localPath);
            const analysis = await analyzeTranscript(transcript);

            console.log(`🧠 Analysis done for ${recordingFile}`, analysis);

            await sendToLaravel({
              call_id: callId,
              agent,
              extension,
              transcript,
              analysis,
            });

            fs.unlinkSync(localPath);
            ftp.end();
            resolve({ transcript, analysis });
          } catch (error) {
            ftp.end();
            reject(error);
          }
        });
      });
    });

    ftp.connect({
      host: CONFIG.ftpHost,
      user: CONFIG.ftpUser,
      password: CONFIG.ftpPassword,
    });
  });
}


// --------------------------
//  Periodic scan (auto mode)
// --------------------------
export async function scanAndTranscribe() {
  console.log("📡 Checking FTP for new recordings...");

  const ftp = new ftpClient();
  ftp.on("ready", () => {
    ftp.list(CONFIG.ftpBasePath, async (err, files) => {
      if (err) return console.error("❌ FTP list error:", err.message);

      for (const file of files) {
        if (!file.name.endsWith(".wav")) continue;

        const localPath = `${CONFIG.tempDir}/${file.name}`;
        await fs.ensureDir(CONFIG.tempDir);

        ftp.get(`${CONFIG.ftpBasePath}/${file.name}`, async (err, stream) => {
          if (err) return console.error("⚠️ FTP get error:", err.message);

          stream.pipe(fs.createWriteStream(localPath));
          stream.on("close", async () => {
            try {
              console.log(`🎧 Downloaded: ${file.name}`);

              const transcript = await transcribeAudio(localPath);
              const analysis = await analyzeTranscript(transcript);

              console.log(`🤖 Analysis for ${file.name}`, analysis);

              await sendToLaravel({
                transcript,
                analysis,
              });

              fs.unlinkSync(localPath);
            } catch (err) {
              console.error("❌ Error handling audio:", err.message);
            }
          });
        });
      }
    });
  });

  ftp.connect({
    host: CONFIG.ftpHost,
    user: CONFIG.ftpUser,
    password: CONFIG.ftpPassword,
  });
}
