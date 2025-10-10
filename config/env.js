import dotenv from "dotenv";
dotenv.config();

export const CONFIG = {
  ftpHost: process.env.FTP_HOST,
  ftpUser: process.env.FTP_USER,
  ftpPassword: process.env.FTP_PASSWORD,
  ftpBasePath: process.env.FTP_BASE_PATH,
  tempDir: process.env.TEMP_DIR || "tmp",
  scanInterval: parseInt(process.env.SCAN_INTERVAL || "10"),
  openaiKey: process.env.OPENAI_API_KEY,
  apiUrl: process.env.LARAVEL_API_URL,
  apiPort: process.env.API_PORT || 4000,
};
