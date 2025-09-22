const WebSocket = require("ws");
const {
  OPENAI_WS_URL,
  VAD_CONFIG,
  AI_CONFIG,
  AWS_SERVER_URL,
} = require("../config/constants");
const FunctionCallHandler = require("./functionCall");
const { text } = require("express");

/**
 * Handler per gestire la connessione WebSocket con OpenAI Realtime
 */
class OpenAIHandler {
  constructor(twilioWs) {
    this.twilioWs = twilioWs;
    this.openaiWs = null;
    this.functionCallHandler = new FunctionCallHandler();
    this.streamSid = null;
    this.kbFileIds = [];
    this.mokaAssistant = null;
    this.threadId = null;
    this.hotelCallNumber = null;
    this.customerNumber = null;
    this.messages = [];
    this.currentAssistantMessage = "";
    this.currentAssistantResponse = "";
    this.currentUserMessage = "";
  }

  /**
   * Connette a OpenAI Realtime WebSocket
   */
  connect(callParameters, onReady = null) {
    const {
      hotelNumber,
      callerNumber,
      callSid,
      instructions,
      hotelKbIds,
      mokaAssistant: assistantId,
    } = callParameters;

    this.hotelCallNumber = hotelNumber;
    this.customerNumber = callerNumber;

    // Assegna le variabili
    this.mokaAssistant = assistantId;
    this.onReadyCallback = onReady;

    console.log("📋 Parametri chiamata:", {
      hotelNumber,
      callerNumber,
      callSid,
      assistantId,
      kbFileCount: hotelKbIds
        ? typeof hotelKbIds === "string"
          ? JSON.parse(hotelKbIds).length
          : hotelKbIds.length
        : 0,
    });

    // Parsing dei file IDs
    try {
      this.kbFileIds = hotelKbIds ? JSON.parse(hotelKbIds) : [];
    } catch (e) {
      this.kbFileIds = hotelKbIds || [];
    }

    // Crea connessione WebSocket
    this.openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    this._setupEventHandlers(instructions);
  }

  /** Imposta gli event handlers per la connessione WebSocket */
  _setupEventHandlers(instructions) {
    this.openaiWs.on("open", () => {
      console.log("🟢 Connesso a OpenAI Realtime WebSocket");
      this._sendSessionConfig(instructions);
    });

    this.openaiWs.on("message", (message) => {
      this._handleMessage(message);
    });

    this.openaiWs.on("close", () => {
      console.log("🔴 OpenAI disconnesso");
    });

    this.openaiWs.on("error", (error) => {
      console.error("❌ Errore OpenAI WebSocket:", error);
    });
  }

  /** Invia la configurazione della sessione a OpenAI */
  _sendSessionConfig(instructions) {
    const enhancedInstructions = `${instructions}

IMPORTANTE: Quando l'utente chiede informazioni specifiche (come password WiFi, orari, servizi, etc.), DEVI SEMPRE usare la funzione search_knowledge_base per cercare le informazioni nei documenti disponibili. Non rispondere mai basandoti solo sulla tua conoscenza generale quando sono disponibili documenti specifici.

Se hai accesso a documenti tramite search_knowledge_base, utilizzali sempre prima di rispondere.`;

    const sessionConfig = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        instructions: enhancedInstructions,
        voice: AI_CONFIG.voice,
        input_audio_format: "g711_ulaw",
        output_audio_format: "g711_ulaw",
        input_audio_transcription: {
          model: "whisper-1",
        },
        turn_detection: {
          type: "server_vad",
          ...VAD_CONFIG,
        },
        tools: this._createTools(),
        temperature: AI_CONFIG.temperature,
      },
    };

    console.log("📋 Parametri sessione:", {
      assistantId: this.mokaAssistant,
      kbFileIds: this.kbFileIds,
      kbFileCount: this.kbFileIds ? this.kbFileIds.length : 0,
    });

    this.openaiWs.send(JSON.stringify(sessionConfig));
  }

  /** Crea la configurazione dei tools */
  _createTools() {
    return this.kbFileIds && this.kbFileIds.length > 0
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
      : [];
  }

  /** Gestisce i messaggi da OpenAI */
  _handleMessage(message) {
    try {
      /* Questa è la risposta che mi arriva da open ai che PUO' avere l'impostazione per effettuare la ricerca nella knowledge base */
      const response = JSON.parse(message.toString());

      // Log di debug per tutti gli eventi (commentare in produzione)
      if (response.type && !response.type.includes("audio.delta")) {
        console.log(`🔍 Evento OpenAI: ${response.type}`);
      }

      // Audio response dall'AI
      if (
        response.type === "response.audio.delta" &&
        response.delta &&
        this.streamSid
      ) {
        this._forwardAudioToTwilio(response.delta);
      }

      // Trascrizione dell'audio dell'utente in arrivo
      if (
        response.type ===
        "conversation.item.input_audio_transcription.completed"
      ) {
        console.log("👤 Utente ha detto:", response.transcript);

        // Se c'era già un messaggio utente non salvato, salvalo prima
        if (this.currentUserMessage.trim()) {
          console.log(
            "⚠️ Messaggio utente precedente non salvato, lo salvo ora"
          );
          this.messages.push({
            text: this.currentUserMessage.trim(),
            timestamp: Date.now(),
            role: "user",
          });
        }

        this.currentUserMessage = response.transcript;
        console.log("📝 Messaggio utente temporaneo salvato");
      }

      if (response.type === "response.text.delta") {
        console.log("🤖 AI risponde (testo):", response.delta);
        this.currentAssistantResponse += response.delta;
      }

      // Risposta text dell'AI completata - salva ENTRAMBI i messaggi in ordine
      if (response.type === "response.text.done") {
        if (this.currentAssistantResponse.trim()) {
          // Prima salva il messaggio dell'utente
          if (this.currentUserMessage.trim()) {
            this.messages.push({
              text: this.currentUserMessage.trim(),
              timestamp: Date.now(),
              role: "user",
            });
            console.log(
              "💾 Messaggio utente salvato:",
              this.currentUserMessage.trim()
            );
          }

          // Poi salva la risposta dell'AI
          this.messages.push({
            text: this.currentAssistantResponse.trim(),
            timestamp: Date.now(),
            role: "assistant",
          });
          console.log(
            "💾 Messaggio assistant salvato:",
            this.currentAssistantResponse.trim()
          );

          // Reset
          this.currentAssistantResponse = "";
          this.currentUserMessage = "";
        }
      }

      // Trascrizione dell'audio dell'AI completata - salva ENTRAMBI i messaggi
      if (response.type === "response.audio_transcript.done") {
        const transcript = response.transcript;
        if (transcript && transcript.trim()) {
          // Prima salva il messaggio dell'utente
          if (this.currentUserMessage.trim()) {
            this.messages.push({
              text: this.currentUserMessage.trim(),
              timestamp: Date.now(),
              role: "user",
            });
            console.log(
              "💾 Messaggio utente salvato:",
              this.currentUserMessage.trim()
            );
          }

          // Poi salva la risposta dell'AI
          this.messages.push({
            text: transcript.trim(),
            timestamp: Date.now(),
            role: "assistant",
          });
          console.log(
            "💾 Messaggio assistant salvato (audio):",
            transcript.trim()
          );

          // Reset COMPLETO
          this.currentUserMessage = "";
          this.currentAssistantResponse = "";
        }
      }

      // Risposta completata - fallback per salvare messaggi se necessario
      if (response.type === "response.done") {
        console.log("📋 Risposta AI completata");

        // Caso 1: Abbiamo testo accumulato ma non salvato
        if (this.currentAssistantResponse.trim()) {
          // Prima salva il messaggio dell'utente
          if (this.currentUserMessage.trim()) {
            this.messages.push({
              text: this.currentUserMessage.trim(),
              timestamp: Date.now(),
              role: "user",
            });
            console.log(
              "💾 Messaggio utente salvato (fallback testo):",
              this.currentUserMessage.trim()
            );
          }

          // Poi salva la risposta dell'AI
          this.messages.push({
            text: this.currentAssistantResponse.trim(),
            timestamp: Date.now(),
            role: "assistant",
          });
          console.log(
            "💾 Messaggio assistant salvato (fallback testo):",
            this.currentAssistantResponse.trim()
          );

          // Reset
          this.currentAssistantResponse = "";
          this.currentUserMessage = "";
        }
        // Caso 2: AI ha risposto solo con audio senza trascrizione
        else if (this.currentUserMessage.trim()) {
          console.log(
            "⚠️ AI ha risposto con solo audio, salvo messaggio utente"
          );
          this.messages.push({
            text: this.currentUserMessage.trim(),
            timestamp: Date.now(),
            role: "user",
          });
          this.messages.push({
            text: "[Risposta audio senza trascrizione]",
            timestamp: Date.now(),
            role: "assistant",
          });
          console.log("💾 Messaggio utente + risposta audio generica salvati");
          this.currentUserMessage = "";
        }

        // Log dello stato attuale
        console.log(`📊 Totale messaggi: ${this.messages.length}`);
        console.log(
          "📋 Conversazione:",
          this.messages
            .slice(-4)
            .map((m, i) => `${i + 1}. ${m.role}: ${m.text.substring(0, 30)}...`)
        );
      } // Function call da OpenAI
      if (response.type === "response.function_call_arguments.done") {
        console.log("🔧 Function call rilevata:", response);
        this.functionCallHandler.handleFunctionCall(
          response,
          this.openaiWs,
          this.kbFileIds,
          this.mokaAssistant,
          this.threadId
        );
      }

      // Log per altri eventi function
      if (response.type && response.type.includes("function")) {
        console.log(`📞 Evento function: ${response.type}`, response);
      }

      // Sessione configurata
      if (response.type === "session.updated") {
        console.log("✅ Sessione OpenAI configurata");

        // Chiama il callback se disponibile (per il messaggio di benvenuto)
        if (
          this.onReadyCallback &&
          typeof this.onReadyCallback === "function"
        ) {
          setTimeout(() => {
            this.onReadyCallback();
            this.onReadyCallback = null; // Chiama solo una volta
          }, 1000);
        }
      }

      // Errori
      if (response.type === "error") {
        console.error("❌ Errore OpenAI:", response.error);
      }
    } catch (error) {
      console.error("❌ Errore parsing messaggio OpenAI:", error);
    }
  }

  /**
   * Inoltra audio a Twilio
   */
  _forwardAudioToTwilio(delta) {
    this.twilioWs.send(
      JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: {
          payload: delta,
        },
      })
    );
  }

  /** Invia audio dell'utente a OpenAI, viene usata da twilio per inviare l'audio dell'utente a openai */
  sendAudioToOpenAI(audioPayload) {
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      this.openaiWs.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: audioPayload,
        })
      );
    }
  }

  /** Invia testo a OpenAI, per il messaggio di benvenuto, viene mandato da twilio subito dopo la connect */
  sendTextToOpenAI(text) {
    if (!this.openaiWs || this.openaiWs.readyState !== WebSocket.OPEN) {
      console.error("❌ OpenAI WebSocket non connesso");
      return;
    }

    console.log(`📤 Invio testo a OpenAI: "${text}"`);

    // Formato corretto per l'API Realtime
    const message = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: text,
          },
        ],
      },
    };

    this.openaiWs.send(JSON.stringify(message));

    // Invia comando per generare la risposta
    const responseCommand = {
      type: "response.create",
      response: {},
    };

    this.openaiWs.send(JSON.stringify(responseCommand));
  }
  /* imposto lo stream sid */
  setStreamSid(streamSid) {
    this.streamSid = streamSid;
  }

  /* questo è il momento in cui chiudo la connessione */
  close() {
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      // 🚨 CONTROLLO FINALE: Salva qualsiasi messaggio rimasto in sospeso
      if (this.currentUserMessage.trim()) {
        console.log("⚠️ SALVATAGGIO FINALE: Messaggio utente in sospeso");
        this.messages.push({
          text: this.currentUserMessage.trim(),
          timestamp: Date.now(),
          role: "user",
        });

        // Se c'è anche una risposta AI in sospeso, salvala
        if (this.currentAssistantResponse.trim()) {
          this.messages.push({
            text: this.currentAssistantResponse.trim(),
            timestamp: Date.now(),
            role: "assistant",
          });
          console.log(
            "⚠️ SALVATAGGIO FINALE: Anche risposta AI in sospeso salvata"
          );
        }
        console.log("✅ SALVATAGGIO FINALE completato");
      }

      // Ordina i messaggi definitivamente per timestamp e sequenza
      this.messages.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return (a.sequence || 0) - (b.sequence || 0);
      });

      console.log("📤 Invio messaggi al server AWS...");
      console.log("🌐 URL AWS:", `${AWS_SERVER_URL}`);
      console.log(
        "� Sequenza finale messaggi:",
        this.messages.map(
          (m, i) =>
            `${i + 1}. [${m.sequence || "?"}] ${m.role}: ${m.text.substring(
              0,
              40
            )}...`
        )
      );
      console.log("📞 Dati chiamata:", {
        customerNumber: this.customerNumber,
        hotelNumber: this.hotelCallNumber,
        streamSid: this.streamSid,
      });

      /* Invio messaggi al server AWS con gestione errori */
      fetch(`${AWS_SERVER_URL}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
          "User-Agent": "TwilioRealtime/1.0",
        },
        body: JSON.stringify({
          customerNumber: this.customerNumber,
          hotelNumber: this.hotelCallNumber,
          streamSid: this.streamSid,
          messages: this.messages,
        }),
      })
        .then((response) => {
          console.log("📡 Risposta HTTP status:", response.status);
          console.log(
            "📡 Risposta HTTP headers:",
            Object.fromEntries(response.headers.entries())
          );

          if (!response.ok) {
            // Proviamo a leggere il corpo della risposta per più dettagli sull'errore
            return response.text().then((text) => {
              console.log("❌ Corpo della risposta di errore:", text);
              throw new Error(
                `HTTP error! status: ${response.status}, message: ${text}`
              );
            });
          }
          console.log("✅ Messaggi inviati al server AWS con successo");
          return response.json();
        })
        .then((data) => {
          console.log("📊 Risposta server AWS:", data);
        })
        .catch((error) => {
          console.error("❌ Errore nell'invio messaggi al server AWS:", error);
          // Non bloccare la chiusura anche in caso di errore
        });

      this.openaiWs.close();
    }
  }
}

module.exports = OpenAIHandler;
