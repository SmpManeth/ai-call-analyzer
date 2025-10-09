# AI Call Analyzer Microservice

Connects to 3CX FTP recordings, transcribes via OpenAI Whisper, analyzes with GPT-4 Turbo, 
and posts structured results to Laravel.

## 🚀 Setup

1. Copy `.env.example` to `.env` and update credentials.
2. Run `npm install`.
3. Start the service:
   ```bash
   pm2 start src/server.js --name ai-call-analyzer
   pm2 save
   pm2 startup
   ```

Logs and temp files are stored in `ai-call-analyzer/tmp/`.

## 🧩 Environment Variables

Refer to `.env.example` for configuration details.
