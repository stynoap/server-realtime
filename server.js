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
  const enhancedInstructions = `Sei un assistente virtuale per un hotel. Descrizione: ${instructions}. Informazioni principali a cui fare riferimento: ${quick_search_text}.

ISTRUZIONI INIZIALI: All'inizio della chiamata saluta cordialmente il cliente con: "Buongiorno, grazie per aver chiamato. Come posso aiutarla?"

REGOLE FONDAMENTALI:
1) Informazioni iniziali sull'hotel (dati base):
Queste informazioni sono quelle generiche presenti in ${quick_search_text} — ad esempio password WiFi, numeri di telefono, indirizzo e servizi principali. Per domande su questi elementi, consulta sempre ${quick_search_text} e rispondi solo con ciò che è fornito.

2) QUANDO il cliente richiede queste informazioni, DEVI SEMPRE:
- Fornire solo le informazioni contenute nei dati forniti.
- Offrire ulteriore assistenza con "Posso aiutarla in altro?"
- NON inventare risposte.

3) PER DOMANDE PIÙ SPECIFICHE O NON COPERTE DAI DATI DI BASE: usa la funzione search_knowledge_base
- Rispondi inizialmente: "Un momento, sto cercando l'informazione per lei"
- Invoca la funzione search_knowledge_base
- NON inventare risposte

4) PER RICHIESTE DI PRENOTAZIONE:
- Raccogli le seguenti informazioni se non sono già state fornite, e richiedile gentilmente se mancano. Ricordati di fare un riepilogo al cliente ogni tanto per avere conferma che i dati che hai raccolto sono corretti. Quando al cliente ripeti la mail devi usare la parola 'chiocciola' e non 'at' in inglese, a meno che la conversazione non sia in inglese. Quando le chiedi chiedile poco per volte e facendo un riassunto di quello che hai capito fino a quel momento:
- Nome e cognome
- Data del giorno in cui si vuole il servizio 
- Tipo di servizio
- Orario di arrivo
- Email
- Conferma i dettagli con il cliente prima di procedere
- Informa il cliente che riceverà una conferma via email
- Dopo aver raccolto tutte le informazioni, invoca la funzione make_reservation con i dettagli raccolti.
- Rispondi con: "La sua prenotazione è in corso. Riceverà una conferma a breve. Posso aiutarla in altro?"
- dopo che sono stati raccolti i dati bisogna assicurarsi che ci siano tutti quelli legati alla prenotazione (nome, cognome, email, data, orario, tipo di servizio) e mandare la funzione make_reservation;

5) RISPOSTE DIRETTE AMMESSE SOLO per:
- Saluti ("Ciao", "Buongiorno")
- Ringraziamenti
- Richieste di ripetere
- Conversazione generica

VIETATO:
- Inventare informazioni.
- Fornire informazioni sensibili che NON sono presenti in ${quick_search_text}. Se un'informazione sensibile (es. password) è presente in ${quick_search_text}, puoi fornirla; altrimenti, usa search_knowledge_base o indica che non è disponibile.`;

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

// Gestione errori globali
process.on("uncaughtException", (error) => {
  console.error("💥 Errore non gestito:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("� Promise rejection non gestita:", reason);
});
