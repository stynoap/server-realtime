const WebSocket = require("ws");
const {
  OPENAI_WS_URL,
  VAD_CONFIG,
  AI_CONFIG,
  AWS_SERVER_URL,
} = require("../config/constants");
// 🚀 Usa il nuovo handler RAG veloce
const FunctionCallHandlerRAG = require("./functionCallRAG");
const { text } = require("express");

class OpenAIHandler {
  constructor(twilioWs) {
    this.twilioWs = twilioWs;
    this.openaiWs = null;
    this.functionCallHandler = new FunctionCallHandlerRAG();
    this.streamSid = null;
    this.hotelCallNumber = null;
    this.customerNumber = null;
    this.hotelId = null; // ✨ Campo essenziale per RAG
    this.messages = [];
    this.currentAssistantResponse = "";
    this.currentUserMessage = "";
  }
  /** Connette a OpenAI Realtime WebSocket */
  connect(callParameters, onReady = null) {
    const {
      hotelNumber,
      callerNumber,
      callSid,
      instructions,
      mokaAssistant: assistantId,
      hotelId, // ✨ Nuovo parametro per RAG
    } = callParameters;

    this.hotelCallNumber = hotelNumber;
    this.customerNumber = callerNumber;
    this.hotelId = hotelId || hotelNumber; // Usa hotelId o fallback su hotelNumber

    this.onReadyCallback = onReady;

    console.log("📋 Parametri chiamata RAG:", {
      hotelNumber,
      hotelId: this.hotelId,
      callerNumber,
      callSid,
    });

    // Crea connessione WebSocket
    /*   this.openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }); */
    this.openaiWs = new WebSocket(OPENAI_WS_URL, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        origin: "https://api.openai.com",
      },
    });

    this._setupEventHandlers(instructions);
  }

  connectOpenAISIPTRUNK(hotelId, wssUrl) {
    this.hotelId = hotelId; // ✅ Imposta l'hotelId prima della connessione
    console.log("🏨 Hotel ID impostato:", this.hotelId);
    console.log("📋 URL WebSocket OpenAI:", wssUrl);

    console.log("🔌 Tentativo connessione WebSocket OpenAI...");
    setTimeout(() => {
      this.openaiWs = new WebSocket(wssUrl, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          origin: "https://api.openai.com",
        },
      });
      console.log(wssUrl);
      this._setupHandlersSIPTRUNK();
      console.log(this.openaiWs);
      console.log("✅ Handler SIP TRUNK configurati");
    }, 1000);
  }

  /**
   * Imposta gli event handlers per la connessione WebSocket
   */
  _setupEventHandlers(instructions) {
    const WELCOME_GREETING = "Thank you for calling, how can I help?";

    const responseCreate = {
      type: "response.create",
      response: {
        instructions: `Say to the user: ${WELCOME_GREETING}`,
      },
    };
    this.openaiWs.on("open", () => {
      console.log("🟢 Connesso a OpenAI Realtime WebSocket");
      //  this.openaiWs.send(JSON.stringify(responseCreate));
      /*     this._sendSessionConfig(instructions); */
    });
    // questo è il momento in cui ricevo i messaggi da openai
    this.openaiWs.on("message", (message) => {
      /*     this._handleMessage(message); */
      console.log(message);
    });

    this.openaiWs.on("close", () => {
      console.log("🔴 OpenAI disconnesso");
    });

    this.openaiWs.on("error", (error) => {
      console.error("❌ Errore OpenAI WebSocket:", error);
    });
  }

  _setupHandlersSIPTRUNK() {
    const WELCOME_GREETING = "Thank you for calling, how can I help?";
    const responseCreate = {
      type: "response.create",
      response: {
        instructions: `Di al cliente: Pronto sono Rossana in cosa posso esserti utile?`,
      },
    };
    // la connessione è stata stabilita
    this.openaiWs.on("open", () => {
      console.log(
        "🟢 Connesso a OpenAI Realtime WebSocket SIP TRUNK, dentro la open..."
      );
      console.log("📋 Invio configurazione sessione...");
      this._sendSessionConfig();

      console.log("Dopo che ho configurato la sessione");
      /*       this.openaiWs.send(JSON.stringify(responseCreate)); */
    });
    // questo è il momento in cui ricevo i messaggi da openai
    this.openaiWs.on("message", (message) => {
      console.log(
        "messaggio in arrivo, messaggio:",
        JSON.parse(message.toString())
      );

      this._handleMessageSIPTRUNK(message);
    });

    this.openaiWs.on("close", (code, reason) => {
      console.log(`🔴 OpenAI disconnesso - Code: ${code}, Reason: ${reason}`);
      // Non chiamare this.close() automaticamente per evitare chiusure premature
      // Solo loggare per debug
    });

    this.openaiWs.on("error", (error) => {
      console.error("❌ Errore OpenAI WebSocket:", error);
    });
  }

  /** Invia la configurazione della sessione a OpenAI */
  _sendSessionConfig() {
    console.log("avvio la configurazione della sessione");

    const sessionConfig = {
      type: "session.update",
      session: {
        type: "realtime",
        tools: this._createTools(),
      },
    };

    this.openaiWs.send(JSON.stringify(sessionConfig));
    console.log(" Configurazione sessione inviata a OpenAI");
  }

  /** Crea la configurazione dei tools per RAG */
  _createTools() {
    console.log("✅ Configuro i tools per RAG");
    // Con RAG abbiamo sempre la funzione di ricerca disponibile
    return [
      {
        type: "function",
        name: "search_knowledge_base",
        description:
          "Cerca informazioni dettagliate nella knowledge base aziendale usando il sistema RAG. Usa questa funzione SOLO quando l'utente chiede informazioni specifiche che NON sono presenti nelle istruzioni iniziali (come dettagli sui servizi, prezzi esatti, orari specifici, password WiFi, menu dettagliati, procedure specifiche). Non usarla per saluti o informazioni generiche già nelle istruzioni.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "La query di ricerca specifica per trovare informazioni dettagliate nella knowledge base (es: 'password WiFi', 'orari colazione', 'prezzo camera doppia')",
            },
          },
          required: ["query"],
        },
      },
    ];
  } /** Gestisce i messaggi da OpenAI */
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
          console.log(" AI ha risposto con solo audio, salvo messaggio utente");
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
        console.log("🔧 Function call RAG rilevata:", response);
        this.functionCallHandler.handleFunctionCall(
          response,
          this.openaiWs,
          this.hotelId
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

  _handleMessageSIPTRUNK(message) {
    try {
      /* Questa è la risposta che mi arriva da open ai che PUO' avere l'impostazione per effettuare la ricerca nella knowledge base */
      const response = JSON.parse(message.toString());
      console.log("messaggio in arrivo, messaggio:", response);
      // Sessione configurata
      if (response.type === "session.updated") {
        console.log("✅ Sessione OpenAI configurata");
        console.log("✅ Sessione configurata, invio saluto iniziale...");
        /* Non supporta che gli metti modalities audio */
        const responseCreate = {
          type: "response.create",
          response: {
            instructions: `Di al cliente: Pronto sono Rossana, la receptionist dell'hotel, in cosa posso essere utile? `,
          },
        };
        setTimeout(() => {
          this.openaiWs.send(JSON.stringify(responseCreate));
        }, 1000);
        return;
      }
      // Log di debug per tutti gli eventi (commentare in produzione)
      if (response.type && !response.type.includes("audio.delta")) {
        console.log(`🔍 Evento OpenAI: ${response.type}`);
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
          console.log(" AI ha risposto con solo audio, salvo messaggio utente");
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
        console.log("🔧 Function call RAG rilevata:", response);
        this.functionCallHandler.handleFunctionCall(
          response,
          this.openaiWs,
          this.hotelId
        );
      }

      // Log per altri eventi function
      if (response.type && response.type.includes("function")) {
        console.log(`📞 Evento function: ${response.type}`, response);
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
        console.log(" SALVATAGGIO FINALE completato");
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

  /** Crea il messaggio di benvenuto personalizzato */
  _createWelcomeMessage() {
    const hour = new Date().getHours();
    let welcomeMessage;

    if (hour < 12) {
      welcomeMessage =
        "Buongiorno! Sono l'assistente virtuale. Come posso aiutarla oggi?";
    } else if (hour < 18) {
      welcomeMessage =
        "Buon pomeriggio! Sono l'assistente virtuale. Come posso aiutarla oggi?";
    } else {
      welcomeMessage =
        "Buonasera! Sono l'assistente virtuale. Come posso aiutarla oggi?";
    }

    return welcomeMessage;
  }

  _sendWelcomeMessage() {
    console.log("🎙️ Inviando messaggio di benvenuto...");

    // Messaggio di benvenuto personalizzato in base al contesto
    const welcomeMessage = this._createWelcomeMessage();

    setTimeout(() => {
      if (this.openaiHandler) {
        this.openaiHandler.sendTextToOpenAI(welcomeMessage);
      }
    }, 500);
  }
}

module.exports = OpenAIHandler;
