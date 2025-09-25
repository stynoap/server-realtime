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

// JSON parsing per endpoint normali
app.use("/call", express.raw({ type: "application/json" }));
app.use(express.json());

console.log(
  "🚀 Inizializzando WebSocket server per Twilio + OpenAI Realtime..."
);

// WebSocket server per connessioni Twilio
/* const wss = new WebSocket.Server({
  server,
  path: "/voice-stream",
});
 */
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
// wss.on("connection", (twilioWs, req) => {
//   console.log("🔗 Nuova connessione Twilio WebSocket");
//   new TwilioHandler(twilioWs);
// });

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
  console.log("📞 Webhook ricevuto - ACCEPT IMMEDIATO");

  try {
    const body = req.body.toString("utf8");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const event = await client.webhooks.unwrap(
      body,
      req.headers,
      WEBHOOK_SECRET
    );

    console.log(event);

    if (event.type === "realtime.call.incoming") {
      const callId = event?.data?.call_id;
      console.log(`⚡ ACCEPT IMMEDIATO per: ${callId}`);

      // ⚡ Accept SUBITO - senza processing aggiuntivo
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
          body: JSON.stringify({
            type: "realtime",
            model: "gpt-realtime",
            instructions: `
         Sei l’assistente dell’hotel. Rispondi in italiano salvo diversa lingua del cliente. Per informazioni specifiche (WiFi, prezzi, orari, menu) DEVI usare il tool search_knowledge_base e non inventare.,
            `,
            audio: {
              input: { format: "g711_ulaw" }, // coerente con SIP u-law
              output: { voice: "alloy", format: "g711_ulaw" },
            },
            input_audio_transcription: { model: "gpt-4o-mini-transcribe" }, // o whisper-1
            turn_detection: { type: "server_vad" },
            tools: [
              {
                type: "function",
                name: "search_knowledge_base",
                description: "Cerca nella knowledge base dell’hotel.",
                parameters: {
                  type: "object",
                  properties: {
                    query: {
                      type: "string",
                      description:
                        "Domanda specifica (es. 'password WiFi', 'orari colazione', 'prezzo camera doppia')",
                    },
                  },
                  required: ["query"],
                },
              },
            ],
            tool_choice: "auto",
          }),
        }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("❌ ACCEPT failed:", resp.status, resp.statusText, text);
        return res.status(500).send("Accept failed");
      }

      console.log("✅ Chiamata accettata!");

      // const parsedBody = JSON.parse(body);
      let hotelId = null;

      /* Recupero il numero di telefono che sta venendo chiamato */
      // const sipHeaders = parsedBody.data?.sip_headers;

      /*       if (sipHeaders && Array.isArray(sipHeaders)) {
        for (const header of sipHeaders) {
          if (header.name === "Diversion") {
            const headerValue = header.value;
            const startIndex = headerValue.indexOf("sip:") + 4;
            const endIndex = headerValue.indexOf("@");
            if (startIndex !== -1 && endIndex !== -1) {
              hotelId = headerValue.substring(startIndex, endIndex);
            }
            break;
          }
        }
      }

      console.log("🏨 Hotel ID:", hotelId); */
      hotelId = "+17752433953";
      // Connetti WebSocket - Mantieni riferimento per evitare garbage collection
      const wssUrl = `wss://api.openai.com/v1/realtime?call_id=${callId}`;
      const openAiHandler = new OpenAIHandler(null);

      console.log("🔗 Connessione immediata al WebSocket OpenAI...");

      openAiHandler.connectOpenAISIPTRUNK(hotelId, wssUrl);

      return res.sendStatus(200);
    } else {
      console.log(`ℹ️ Evento non gestito: ${event.type}`);
      return res.sendStatus(200);
    }
  } catch (e) {
    console.error("❌ Errore nel webhook:", e);
    if (e?.name === "InvalidWebhookSignatureError") {
      return res.status(400).send("Invalid signature");
    }
    return res.status(500).send("Server error");
  }
});

// Gestione errori globali
process.on("uncaughtException", (error) => {
  console.error("💥 Errore non gestito:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("� Promise rejection non gestita:", reason);
});
