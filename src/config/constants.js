// Configurazione costanti del server
module.exports = {
  OPENAI_WS_URL:
    "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01",

  // Configurazione WebSocket
  WS_PATH: "/voice-stream",

  // Configurazione audio
  AUDIO_FORMAT: "g711_ulaw",

  // Configurazione VAD (Voice Activity Detection)
  VAD_CONFIG: {
    threshold: 0.75,
    prefix_padding_ms: 400,
    silence_duration_ms: 1200,
  },

  // Configurazione AI
  AI_CONFIG: {
    voice: "alloy",
    temperature: 0.8,
    model: "gpt-4o-mini",
  },

  // Headers OpenAI
  OPENAI_HEADERS: {
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2",
  },

  WEBHOOK_SECRET: "whsec_wBzlzmWdtmFj1jcTpznD9bP/XROvDpfM18BsTHLFaaQ=",

  AWS_SERVER_URL: "https://06244666c46b.ngrok-free.app/call",
  ASK_ENDPOINT: "https://06244666c46b.ngrok-free.app/ask",
};
