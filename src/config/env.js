export const CONFIG = {
  ftpHost: process.env.FTP_HOST,
  ftpUser: process.env.FTP_USER,
  ftpPassword: process.env.FTP_PASSWORD,
  ftpBasePath: process.env.FTP_BASE_PATH,
  apiUrl: process.env.LARAVEL_API_URL,
  openaiKey: process.env.OPENAI_API_KEY,
  scanInterval: process.env.SCAN_INTERVAL_MINUTES || 10,
  tempDir: process.env.TEMP_DIR || 'ai-call-analyzer/tmp'
};