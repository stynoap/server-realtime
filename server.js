require("dotenv").config();
const OpenAI = require("openai");
const express = require("express");
const http = require("http");
const cors = require("cors");
const WebSocket = require("ws");
const TwilioHandler = require("./src/handlers/twilio");
const { base_api } = require("./src/config/constants");
const OpenAIHandler = require("./src/handlers/openai");

const app = express();
const server = http.createServer(app);
/* 
 reservation_type: {
              type: "string",
              description:
                "Tipo di prenotazione (es: 'camera', 'tavolo ristorante', 'servizio spa')",
            },
            customer_name: {
              type: "string",
              description: "Nome del cliente",
            },
            customer_surname: {
              type: "string",
              description: "Cognome del cliente",
            },
            customer_email: {
              type: "string",
              description: "Email del cliente",
            },

            date: {
              type: "string",
              description: "Data della prenotazione (formato YYYY-MM-DD)",
            },
            time: {
              type: "string",
              description:
                "Orario della prenotazione (se applicabile, formato HH:MM)",
            },
            notes: {
              type: "string",
              description:
                "Note aggiuntive del cliente (es: preferenze speciali)",
            }, */

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

//TODO gestire il benvenuto, deve dirmi che è un assistente virtuale dell'hotel x e che può parlarmi normalmente come farebbe con una persona
// TODO aggiungere funzione che quando mi vengono fatte domande relative alle prenotazioni allora si occupa di raccogliere informazioni quali nome, cognome, email e numero di telefono che verranno salvate nel database e a quel punto sanranno segnalate nella conversazione
app.post("/call", async (req, res) => {
  const body = req.body.toString("utf8");
  const parsedBody = JSON.parse(body);
  const sipHeaders = parsedBody.data?.sip_headers;
  var receiving_telephone_number = null;
  var caller_number = null;
  console.log("SIP HEADERS:", sipHeaders);
  console.log(parsedBody, "body parsato");
  const twilioCallSidHeader = sipHeaders.find(
    (h) => h.name === "X-Twilio-CallSid"
  );
  const twilioCallSid = twilioCallSidHeader?.value;
  console.log("Twilio Call SID:", twilioCallSid);

  // Estrai il numero di telefono chiamato dagli header SIP
  if (sipHeaders && Array.isArray(sipHeaders)) {
    for (const header of sipHeaders) {
      if (header.name === "Diversion") {
        console.log(header.value, "header diversion");
        const headerValue = header.value;
        const startIndex = headerValue.indexOf("sip:") + 4;
        const endIndex = headerValue.indexOf("@");
        if (startIndex !== -1 && endIndex !== -1) {
          receiving_telephone_number = headerValue.substring(
            startIndex,
            endIndex
          );
        }
      }

      if (header.name === "From") {
        console.log(header.value, "header from");
        const headerValue = header.value;
        const startIndex = headerValue.indexOf("sip:") + 4;
        const endIndex = headerValue.indexOf("@");
        if (startIndex !== -1 && endIndex !== -1) {
          caller_number = headerValue.substring(startIndex, endIndex);
        }
      }
    }
  }

  console.log("numero di telefono chiamato:", receiving_telephone_number);
  console.log("numero di telefono chiamante:", caller_number);
  const url = `${base_api}voice_channel_info?phone_number=${encodeURIComponent(
    receiving_telephone_number
  )}`;
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const responseData = await resp.json();
  const { instructions, quick_search_text, hotel_id, realtime_voice } =
    responseData || {};
  console.log(instructions, quick_search_text, hotel_id);

  const enhancedInstructions = ` 
## CHI SEI: ${instructions}.  
## INFORMAZIONI PRINCIPALI E CONTESTO SULL'HOTEL: ${quick_search_text}.  

INIZIO CHIAMATA:
- Presentati come assistente virtuale dell’hotel, specifica il tuo nome e il nome dell'hotel. Dì che possono parlare con te come farebbero con una persona e che possono interromperti.
- Ringrazia per la chiamata.
- Poi chiedi: "Come posso aiutarla?"

CONVERSAZIONE:
- Sii cordiale, professionale e conciso, ma basa il tono sulla base delle istruzioni che ti sono state fornite.  
- Usa solo le informazioni contenute in INFORMAZIONI PRINCIPALI E CONTESTO SULL'HOTEL.  
- NON inventare risposte.  

RICHIESTA DI INFORMAZIONI:
- Se l'informazione è in INFORMAZIONI PRINCIPALI E CONTESTO SULL'HOTEL, rispondi direttamente altrimenti invoca la "search_knowledge_base" e dì: "Un momento, sto cercando l'informazione per lei".

PRENOTAZIONI:
- Raccogli questi dati: nome, cognome, email, tipo di servizio, data, orario, note (se ci sono).  
- Chiedi i dati con calma, poco alla volta, e confermali al cliente.  
- Per l’email, pronuncia "chiocciola" invece di "at", se la conversazione è in italiano.  
- Dopo aver raccolto tutto, invoca "make_reservation".  


TRASFERIMENTO DI CHIAMATA: 
- Se il cliente chiede di parlare con un umano, rispondi: "Certamente, mi occupo subito di effettuare il trasferimento." e a questo punto invoca la "transfer_to_human".

FINE CHIAMATA:
- Se il cliente saluta e ti sei accertato che non ha altre richieste, rispondi con:
  "Grazie per aver chiamato. Le auguro una buona giornata!" e termina la chiamata.
- Se il cliente non saluta, chiedi: "Posso aiutarla in altro?"  
- Se il cliente risponde negativamente, chiudi con: "Grazie per aver chiamato. Le auguro una buona giornata!" e termina la chiamata.
- quando termini la chiamata devi invocare "end_call" per chiudere la chiamata in modo corretto.


RISPONDI DIRETTAMENTE SOLO A:
- Saluti, ringraziamenti, richieste di ripetere, conversazione generica.  

VIETATO:
- Inventare informazioni non presenti.  
`;
  console.log("Webhook ricevuto - ACCEPT IMMEDIATO");

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const event = await client.webhooks.unwrap(
      body,
      req.headers,
      process.env.WEBHOOK_SECRET
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
            instructions: enhancedInstructions,
            model: "gpt-realtime",
            output_modalities: ["audio"],
            audio: {
              input: {
                transcription: {
                  model: "whisper-1", // GA format, not beta
                },
                format: {
                  type: "audio/g711_ulaw", // oppure "audio/pcm" se Twilio lo supporta
                  rate: 8000, // 8000 per g711_ulaw, 24000 per pcm
                },
              },
              output: {
                format: {
                  type: "audio/g711_ulaw",
                  rate: 8000,
                },
                voice: realtime_voice || "alloy", // voce di default se non specificata
              },
            },
          }),
        }
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        console.error("❌ ACCEPT failed:", resp.status, resp.statusText, text);
        return res.status(500).send("Accept failed");
      }

      console.log(resp, " la risposta dall'accept");
      const wssUrl = `wss://api.openai.com/v1/realtime?call_id=${callId}`;
      const openAiHandler = new OpenAIHandler(null);

      console.log("🔗 Connessione immediata al WebSocket OpenAI...");

      openAiHandler.connectOpenAISIPTRUNK(
        hotel_id,
        wssUrl,
        caller_number,
        receiving_telephone_number,
        callId,
        twilioCallSid,
        enhancedInstructions
      );

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

/* Creare endpoint SIP */
// Gestione errori globali
process.on("uncaughtException", (error) => {
  console.error("💥 Errore non gestito:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("� Promise rejection non gestita:", reason);
});
