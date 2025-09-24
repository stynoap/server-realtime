require("dotenv").config();
const OpenAI = require("openai");
const express = require("express");
const http = require("http");
const cors = require("cors");
const WebSocket = require("ws");
const TwilioHandler = require("./src/handlers/twilio");
const { AWS_SERVER_URL, WEBHOOK_SECRET } = require("./src/config/constants");
const OpenAIHandler = require("./src/handlers/openai");

const app = express();
const server = http.createServer(app);

// CORS middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);

// JSON parsing
app.use(express.json());

console.log(
  "🚀 Inizializzando WebSocket server per Twilio + OpenAI Realtime..."
);

// WebSocket server per connessioni Twilio
const wss = new WebSocket.Server({
  server,
  path: "/voice-stream",
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "WebSocket server running",
    timestamp: new Date(),
    connections: wss.clients.size,
  });
});

// Test endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Twilio + OpenAI Realtime WebSocket Server",
    endpoints: {
      websocket: "/voice-stream",
      health: "/health",
    },
  });
});

// Gestione connessioni WebSocket
wss.on("connection", (twilioWs, req) => {
  console.log("🔗 Nuova connessione Twilio WebSocket");

  // Crea handler per gestire la connessione Twilio
  new TwilioHandler(twilioWs);
});

// Configurazione server
const PORT = process.env.PORT || 5050;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🟢 WebSocket server in ascolto su porta ${PORT}`);
  console.log(
    `📡 WebSocket endpoint: wss://server-realtime.onrender.com/voice-stream`
  );
  console.log(`🔍 Health check: https://server-realtime.onrender.com/health`);
  // Funzione di test per chiamata HTTP
});

app.post("/call", async (req, res) => {
  console.log("ciao");
  const body = req.body;

  console.log("📞 Chiamata in arrivo:", body);

  try {
    console.log("test");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const event = await client.webhooks.unwrap(
      req.body.toString("utf8"),
      req.headers,
      WEBHOOK_SECRET
    );

    const type = event?.type;

    if (type === RealtimeIncomingCall) {
      const callId = event?.data?.call_id;
      const resp = await fetch(
        `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(
          callId
        )}/accept`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(callAccept),
        }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("ACCEPT failed:", resp.status, resp.statusText, text);
        return res.status(500).send("Accept failed");
      }

      const openAiHandler = new OpenAIHandler("twilioWs");

      setTimeout(() => {
        openAiHandler.connectOpenAISIPTRUNK();
      }, 1000);

      // Acknowledge the webhook
      res.set("Authorization", `Bearer ${OPENAI_API_KEY}`);
      return res.sendStatus(200);
    }
  } catch (e) {
    const msg = String(e?.message ?? "");
    if (
      e?.name === "InvalidWebhookSignatureError" ||
      msg.toLowerCase().includes("invalid signature")
    ) {
      return res.status(400).send("Invalid signature");
    }
    return res.status(500).send("Server error");
  }

  // parte di gestione della chiamata
});

// Gestione errori globali
process.on("uncaughtException", (error) => {
  console.error("💥 Errore non gestito:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("� Promise rejection non gestita:", reason);
});
