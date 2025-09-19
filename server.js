require("dotenv").config();
const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const cors = require("cors");

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

wss.on("connection", (twilioWs, req) => {
  console.log(" Nuova connessione Twilio WebSocket");

  let openaiWs = null;
  let streamSid = null;
  let callParameters = {};

  const connectToOpenAI = () => {
    const OPENAI_WS_URL =
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

    openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiWs.on("open", () => {
      // Configura la sessione per l'hotel
      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: `Sei l'assistente virtuale di un hotel di lusso in Italia. 
                        
                        COMPORTAMENTO:
                        - Rispondi SEMPRE in italiano
                        - Sii cordiale, professionale ed elegante
                        - Puoi gestire: prenotazioni, informazioni sui servizi, check-in/out, richieste speciali
                        - Permetti interruzioni naturali nella conversazione
                        - Se non sai qualcosa, proponi di trasferire alla reception
                        
                        STILE:
                        - Usa un tono accogliente e professionale
                        - Risposte concise ma complete
                        - "Certamente", "Naturalmente", "Sarò felice di aiutarla"
                        
                        Il numero chiamato: ${
                          callParameters.hotelNumber || "hotel"
                        }
                        Chiamante: ${callParameters.callerNumber || "ospite"}`,

          voice: "alloy", // Voce naturale
          input_audio_format: "g711_ulaw", // Formato Twilio
          output_audio_format: "g711_ulaw",

          input_audio_transcription: {
            model: "whisper-1",
          },

          turn_detection: {
            type: "server_vad", // Voice Activity Detection automatico
            threshold: 0.5, // Sensibilità detection
            prefix_padding_ms: 300, // Padding inizio conversazione
            silence_duration_ms: 700, // Interruzioni dopo 700ms silenzio
          },

          tools: [], // Per ora niente tools, solo conversazione
          temperature: 0.8, // Più naturale e meno robotico
        },
      };

      openaiWs.send(JSON.stringify(sessionConfig));
    });

    // OpenAI → Twilio (risposta audio dell'AI)
    openaiWs.on("message", (message) => {
      try {
        const response = JSON.parse(message.toString());

        // Audio response dall'AI
        if (
          response.type === "response.audio.delta" &&
          response.delta &&
          streamSid
        ) {
          twilioWs.send(
            JSON.stringify({
              event: "media",
              streamSid: streamSid,
              media: {
                payload: response.delta, // Base64 audio da OpenAI
              },
            })
          );
        }

        // Transcription dell'utente (per debug)
        if (
          response.type ===
          "conversation.item.input_audio_transcription.completed"
        ) {
          console.log(" Utente ha detto:", response.transcript);
        }

        // Risposta text dell'AI (per debug)
        if (response.type === "response.text.delta") {
          console.log(" AI risponde:", response.delta);
        }

        // Conferma sessione configurata
        if (response.type === "session.updated") {
          console.log(" Sessione OpenAI configurata");
        }

        // Gestione errori OpenAI
        if (response.type === "error") {
          console.error(" Errore OpenAI:", response.error);
        }
      } catch (error) {
        console.error(" Errore parsing messaggio OpenAI:", error);
      }
    });

    openaiWs.on("close", () => {
      console.log(" OpenAI disconnesso");
    });

    openaiWs.on("error", (error) => {
      console.error("Errore OpenAI WebSocket:", error);
    });
  };

  // Twilio → OpenAI (messaggi da Twilio)
  twilioWs.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      switch (data.event) {
        case "connected":
          console.log("📞 Chiamata Twilio connessa");
          break;

        case "start":
          streamSid = data.start.streamSid;
          callParameters = data.start.customParameters || {};
          console.log(`🎥 Stream iniziato: ${streamSid}`);
          console.log("📋 Parametri chiamata:", callParameters);

          // Connetti OpenAI quando inizia lo stream
          connectToOpenAI();
          break;

        case "media":
          // Invia audio dell'utente a OpenAI
          if (
            data.media.payload &&
            openaiWs &&
            openaiWs.readyState === WebSocket.OPEN
          ) {
            openaiWs.send(
              JSON.stringify({
                type: "input_audio_buffer.append",
                audio: data.media.payload,
              })
            );
          }
          break;

        case "stop":
          console.log(" Stream terminato");
          if (openaiWs) {
            openaiWs.close();
          }
          break;
      }
    } catch (error) {
      console.error(" Errore parsing messaggio Twilio:", error);
    }
  });

  // Cleanup quando Twilio disconnette
  twilioWs.on("close", () => {
    console.log("📞 Twilio disconnesso");
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) {
      openaiWs.close();
    }
  });

  twilioWs.on("error", (error) => {
    console.error(" Errore Twilio WebSocket:", error);
  });
});

const PORT = process.env.PORT || 5050;
server.listen(PORT, () => {
  console.log(` WebSocket server in ascolto su porta ${PORT}`);
  console.log(` WebSocket endpoint: ws://localhost:${PORT}/voice-stream`);
  console.log(` Health check: http://localhost:${PORT}/health`);
});

// Gestione errori globali
process.on("uncaughtException", (error) => {
  console.error(" Errore non gestito:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Promise rejection non gestita:", reason);
});
