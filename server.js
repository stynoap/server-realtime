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
  let kbFileIds = [];
  let mokaAssistant = null;
  let threadId = null;

  const connectToOpenAI = (callParameters) => {
    console.log(callParameters);
    //TODO Aggiungere l'id dell'assistente come parametro passato da Twilio se voglio usare un assistant specifico
    const {
      hotelNumber,
      callerNumber,
      callSid,
      instructions,
      hotelKbIds,
      mokaAssistant: assistantId,
    } = callParameters;

    // Assegna le variabili al livello superiore per renderle accessibili
    mokaAssistant = assistantId;

    console.log(
      hotelNumber,
      callerNumber,
      callSid,
      instructions,
      hotelKbIds,
      mokaAssistant
    );
    /* Array di id dei documenti nello storage di openai */
    try {
      kbFileIds = hotelKbIds ? JSON.parse(hotelKbIds) : [];
    } catch (e) {
      kbFileIds = hotelKbIds || [];
    }
    const OPENAI_WS_URL =
      "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";

    // Connetti a OpenAI Realtime WebSocket
    openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    openaiWs.on("open", () => {
      console.log(" Connesso a OpenAI Realtime WebSocket");

      // Aggiungi istruzioni specifiche per l'uso della knowledge base
      const enhancedInstructions = `${instructions}

IMPORTANTE: Quando l'utente chiede informazioni specifiche (come password WiFi, orari, servizi, etc.), DEVI SEMPRE usare la funzione search_knowledge_base per cercare le informazioni nei documenti disponibili. Non rispondere mai basandoti solo sulla tua conoscenza generale quando sono disponibili documenti specifici.

Se hai accesso a documenti tramite search_knowledge_base, utilizzali sempre prima di rispondere.`;

      const sessionConfig = {
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions: enhancedInstructions,
          //TODO          /* Aggiungere switcher della voce sulla base delle istruzioni, quindi tipo al TONO DELLA VOCE che passo, li mapperò in qualche modo */
          voice: "alloy", // Voce naturale
          input_audio_format: "g711_ulaw", // Formato Twilio
          output_audio_format: "g711_ulaw",

          input_audio_transcription: {
            model: "whisper-1",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.6, // Sensibilità detection
            prefix_padding_ms: 400, // Padding inizio conversazione
            silence_duration_ms: 800, // Interruzioni dopo 800ms silenzio
          },
          // Function tool per cercare nella knowledge base - SEMPRE attivo se ci sono file
          tools:
            kbFileIds && kbFileIds.length > 0
              ? [
                  {
                    type: "function",
                    name: "search_knowledge_base",
                    description:
                      "Cerca informazioni nella knowledge base aziendale. USA SEMPRE questa funzione quando l'utente chiede informazioni specifiche come password WiFi, orari, servizi, prezzi, etc.",
                    parameters: {
                      type: "object",
                      properties: {
                        query: {
                          type: "string",
                          description:
                            "La query di ricerca per trovare informazioni rilevanti nei documenti",
                        },
                      },
                      required: ["query"],
                    },
                  },
                ]
              : [],
          temperature: 0.8, // Più naturale e meno robotico
        },
      };

      console.log("📋 Parametri sessione:", {
        assistantId: mokaAssistant,
        kbFileIds: kbFileIds,
        kbFileCount: kbFileIds ? kbFileIds.length : 0,
      });

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
          console.log("🤖 AI risponde:", response.delta);
        }

        // Gestione function call per knowledge base, qui vengono cercati i documenti
        if (response.type === "response.function_call_arguments.done") {
          console.log("🔧 Function call rilevata:", response);
          handleFunctionCall(
            response,
            openaiWs,
            kbFileIds,
            mokaAssistant,
            threadId
          );
        }

        // Log per intercettare eventuali altre chiamate function
        if (response.type && response.type.includes("function")) {
          console.log(`📞 Evento function: ${response.type}`, response);
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
          connectToOpenAI(callParameters);
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

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);

const PORT = process.env.PORT || 5050;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🟢 WebSocket server in ascolto su porta ${PORT}`);
  console.log(
    `📡 WebSocket endpoint: wss://server-realtime.onrender.com/voice-stream`
  );
  console.log(`🔍 Health check: https://server-realtime.onrender.com/health`);
});

// Funzione unificata per gestire le chiamate alla knowledge base
async function handleFunctionCall(
  response,
  openaiWs,
  kbFileIds,
  assistantId,
  threadId
) {
  if (response.name === "search_knowledge_base") {
    try {
      const args = JSON.parse(response.arguments);
      console.log(`🔍 Ricerca knowledge base: "${args.query}"`);

      let searchResult;

      if (assistantId && assistantId !== "undefined" && threadId) {
        // Usa l'assistente esistente se disponibile
        searchResult = await searchWithExistingAssistant(
          args.query,
          assistantId,
          threadId
        );
      } else {
        // Crea un assistente temporaneo
        searchResult = await searchInKnowledgeBase(args.query, kbFileIds);
      }

      // Invia il risultato back a OpenAI
      openaiWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: response.call_id,
            output: searchResult,
          },
        })
      );
    } catch (error) {
      console.error("❌ Errore nella ricerca knowledge base:", error);
      openaiWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: response.call_id,
            output: "Errore nella ricerca della knowledge base",
          },
        })
      );
    }
  }
}

// Funzione per usare un assistente esistente
async function searchWithExistingAssistant(query, assistantId, threadId) {
  try {
    // 1. Aggiungi il messaggio al thread esistente
    await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        role: "user",
        content: query,
      }),
    });

    // 2. Avvia il Run sul thread
    let runResponse = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({ assistant_id: assistantId }),
      }
    );
    let run = await runResponse.json();

    // 3. Polling: aspetta che il Run sia completato
    while (run.status === "queued" || run.status === "in_progress") {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const statusResponse = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
          },
        }
      );
      run = await statusResponse.json();
    }

    // 4. Recupera il messaggio finale
    const messagesResponse = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/messages`,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
        },
      }
    );

    const messages = await messagesResponse.json();
    const lastMessage = messages.data[0];

    return lastMessage.content[0].text.value;
  } catch (error) {
    console.error("Errore ricerca con assistente esistente:", error);
    return `Errore nella ricerca: ${error.message}`;
  }
}

// Funzione di ricerca nella knowledge base usando API Assistants
async function searchInKnowledgeBase(query, kbFileIds) {
  try {
    // Crea un thread temporaneo per la ricerca
    const threadResponse = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({}),
    });

    const thread = await threadResponse.json();

    // Aggiungi il messaggio di ricerca
    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        role: "user",
        content: query,
        attachments: kbFileIds.map((fileId) => ({
          file_id: fileId,
          tools: [{ type: "file_search" }],
        })),
      }),
    });

    // Crea un assistant temporaneo se non ne hai già uno
    const assistantResponse = await fetch(
      "https://api.openai.com/v1/assistants",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          tools: [{ type: "file_search" }],
          instructions:
            "Cerca e riassumi informazioni rilevanti dai file allegati.",
        }),
      }
    );

    const assistant = await assistantResponse.json();

    // Esegui la ricerca
    const runResponse = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/runs`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          assistant_id: assistant.id,
        }),
      }
    );

    const run = await runResponse.json();

    // Polling per aspettare il completamento
    let runStatus = run;
    while (
      runStatus.status === "queued" ||
      runStatus.status === "in_progress"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const statusResponse = await fetch(
        `https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
          },
        }
      );
      runStatus = await statusResponse.json();
    }

    // Recupera la risposta
    const messagesResponse = await fetch(
      `https://api.openai.com/v1/threads/${thread.id}/messages`,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
        },
      }
    );

    const messages = await messagesResponse.json();
    const lastMessage = messages.data[0];

    // Cleanup
    await fetch(`https://api.openai.com/v1/assistants/${assistant.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });

    return lastMessage.content[0].text.value;
  } catch (error) {
    console.error("Errore ricerca knowledge base:", error);
    return `Errore nella ricerca: ${error.message}`;
  }
}

// Gestione errori globali
process.on("uncaughtException", (error) => {
  console.error(" Errore non gestito:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Promise rejection non gestita:", reason);
});

// Funzione attuale per gestire le chiamate alla knowledge base
async function handleFunctionCall(response, openaiWs, threadId, assistantId) {
  if (response.name === "search_knowledge_base") {
    try {
      const args = JSON.parse(response.arguments);
      console.log(`🔍 Ricerca knowledge base: "${args.query}"`);

      // 1. Aggiungi il messaggio al thread esistente
      await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "assistants=v2",
        },
        body: JSON.stringify({
          role: "user",
          content: args.query,
          // Gli allegati li gestisce l'assistente stesso
        }),
      });

      // 2. Avvia il Run sul thread
      let runResponse = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/runs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "assistants=v2",
          },
          body: JSON.stringify({ assistant_id: assistantId }),
        }
      );
      let run = await runResponse.json();

      // 3. Polling: aspetta che il Run sia completato
      // Questo è molto più affidabile di un semplice setTimeout
      while (run.status !== "completed") {
        await new Promise((resolve) => setTimeout(resolve, 500)); // Aspetta 500ms
        const statusResponse = await fetch(
          `https://api.openai.com/v1/threads/${threadId}/runs/${run.id}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "OpenAI-Beta": "assistants=v2",
            },
          }
        );
        run = await statusResponse.json();
      }

      // 4. Recupera il messaggio finale
      const messagesResponse = await fetch(
        `https://api.openai.com/v1/threads/${threadId}/messages`,
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
          },
        }
      );

      const messages = await messagesResponse.json();
      const lastMessage = messages.data[0];
      const searchResult = lastMessage.content[0].text.value;

      // Invia il risultato back a OpenAI
      openaiWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: response.call_id,
            output: searchResult,
          },
        })
      );
    } catch (error) {
      console.error("❌ Errore nella ricerca knowledge base:", error);
      openaiWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: response.call_id,
            output: "Errore nella ricerca della knowledge base",
          },
        })
      );
    }
  }
}

// Gestione errori globali
process.on("uncaughtException", (error) => {
  console.error(" Errore non gestito:", error);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Promise rejection non gestita:", reason);
});
