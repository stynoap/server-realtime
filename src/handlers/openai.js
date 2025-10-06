const WebSocket = require("ws");
const {
  OPENAI_WS_URL,
  VAD_CONFIG,
  AI_CONFIG,
  AWS_SERVER_URL,
  base_api,
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
    this.callId = "";
    this.twilioCallSid = "";
    this.hasReservation = false;
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

  connectOpenAISIPTRUNK(
    hotelId,
    wssUrl,
    caller_number,
    receiving_telephone_number,
    callId,
    twilioCallSid,
    instructions = ""
  ) {
    this.twilioCallSid = twilioCallSid;
    this.callId = callId;
    this.hotelId = hotelId; // ✅ Imposta l'hotelId prima della connessione
    this.hotelCallNumber = receiving_telephone_number;
    this.customerNumber = caller_number;
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
      console.log(instructions, "le istruzioni che passo alla open");
      this._setupHandlersSIPTRUNK(instructions);
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

  _setupHandlersSIPTRUNK(instructions = "") {
    // la connessione è stata stabilita
    this.openaiWs.on("open", () => {
      console.log(
        "🟢 Connesso a OpenAI Realtime WebSocket SIP TRUNK, dentro la open..."
      );
      console.log("📋 Invio configurazione sessione...");
      this._sendSessionConfig();

      console.log("Dopo che ho configurato la sessione");
    });
    // questo è il momento in cui ricevo i messaggi da openai
    this.openaiWs.on("message", (message) => {
      console.log(
        "messaggio in arrivo, messaggio:",
        JSON.parse(message.toString())
      );

      this._handleMessageSIPTRUNK(message, instructions);
    });

    this.openaiWs.on("close", async (code, reason) => {
      console.log(`🔴 OpenAI disconnesso - Code: ${code}, Reason: ${reason}`);
      await this.close();
      await this.hangupTwilioCall();
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
          "Cerca informazioni dettagliate nella knowledge base aziendale usando il sistema RAG. Usa questa funzione SOLO quando l'utente chiede informazioni specifiche che NON sono presenti nelle istruzioni iniziali che ti sono state passate (come dettagli sui servizi, prezzi esatti, orari specifici, password WiFi, menu dettagliati, procedure specifiche). Non usarla per saluti o informazioni generiche già nelle istruzioni.",
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
      // 🆕 NUOVA FUNZIONE PER PRENOTAZIONI
      {
        type: "function",
        name: "make_reservation",
        description:
          "Crea una prenotazione per il cliente quando ha richiesto un servizio e tutti i dati necessari sono stati raccolti.",
        parameters: {
          type: "object",
          properties: {
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
            },
          },
          required: [
            "reservation_type",
            "date",
            "time",
            "customer_name",
            "customer_surname",
            "customer_email",
          ],
        },
      },
      /* {
        type: "function",
        name: "end_call",
        description:
          "Termina la chiamata e fornisce un messaggio di chiusura al cliente.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Motivo della chiusura della chiamata",
            },
          },
          required: ["reason"],
        },
      }, */
    ];
  } /** Gestisce i messaggi da OpenAI */

  async handleEndCallFunctionCall(response) {}

  //funzione per la gestione di quando il cliente chiede di prenotare una camera
  async _handleReservationFunctionCall(response) {
    console.log("dentro la funzione per la gestione della prenotazione");
    try {
      // Parse e validazione argomenti
      let args;
      try {
        args = JSON.parse(response.arguments);
      } catch (err) {
        console.error("Errore parsing argomenti prenotazione:", err);
        return this.openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                "Non sono riuscito a leggere i dettagli della prenotazione. Puoi ripetere?",
            },
          })
        );
      }

      const {
        reservation_type,
        date,
        time,
        customer_name,
        customer_surname,
        customer_email,
        notes,
      } = args;

      if (
        !reservation_type ||
        !date ||
        !time ||
        !customer_name ||
        !customer_surname ||
        !customer_email
      ) {
        return this.openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions:
                "Mancano alcuni dati obbligatori per la prenotazione. Controlla e riprova.",
            },
          })
        );
      }

      const prenotazione = {
        reservation_type,
        date,
        time,
        customer_name,
        customer_surname,
        customer_email,
        notes: notes || null,
        hotel_id: this.hotelId,
        callId: this.callId,
      };

      // Invio al tuo servizio backend
      let confirmationMessage = `La tua prenotazione è stata registrata con successo! 🎉
Dettagli:
- Tipo: ${reservation_type}
- Data: ${date}
- Ora: ${time}
- Nome: ${customer_name} ${customer_surname}
- Email: ${customer_email}
${notes ? "- Note: " + notes : ""}`;

      console.log("Dettagli prenotazione:", prenotazione);
      try {
        const prenotazioneInsertStatus = await fetch(
          `${base_api}prenotazione`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(prenotazione),
          }
        );

        if (!prenotazioneInsertStatus.ok) {
          confirmationMessage =
            "C'è stato un problema nel salvataggio della prenotazione. Riprova più tardi.";
        }
      } catch (err) {
        console.error("Errore nella chiamata al servizio prenotazione:", err);
        confirmationMessage =
          "Errore di connessione al servizio prenotazioni. Riprova più tardi.";
      }

      this.hasReservation = true;
      // Risposta all'assistente
      openaiWs.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: confirmationMessage,
          },
        })
      );
      openaiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {},
        })
      );
    } catch (err) {
      console.error("Errore in _handleReservationFunctionCall:", err);
      this.openaiWs.send(
        JSON.stringify({
          type: "response.create",
          response: {
            instructions:
              "Si è verificato un errore interno durante la gestione della prenotazione.",
          },
        })
      );
    }
  }

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

  _handleMessageSIPTRUNK(message, instructions = "") {
    try {
      /* Questa è la risposta che mi arriva da open ai che PUO' avere l'impostazione per effettuare la ricerca nella knowledge base */
      const response = JSON.parse(message.toString());
      console.log("messaggio in arrivo, messaggio:", response);
      // Sessione configurata
      if (response.type === "session.updated") {
        console.log("✅ Sessione OpenAI configurata");
        console.log("✅ Sessione configurata, invio saluto iniziale...");
        // qua vorrei dirlgi di presentarsi, se già non lo ha fatto
        const hour = new Date().getHours();
        this.openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {
              instructions: `Se ancora al cliente non ti sei presentato, allora fallo dicendo chi sei e il nome della struttura per cui lavori. Per farlo, adattati al fatto che questa è l'ora del giorno: ${hour}. Saluta il cliente in modo appropriato, dicendo che sei l'assistente virtuale della struttura e che può parlarti normalmente come farebbe con una persona, e perciò può interromperti e chiedi poi come puoi aiutarlo. Il contesto che devi usare per basare questa tua presentazione è il seguente: ${instructions}`,
            },
          })
        );

        openaiWs.send(
          JSON.stringify({
            type: "response.create",
            response: {},
          })
        );
        // Chiama il callback se disponibile (per il messaggio di benvenuto)
        /* Non supporta che gli metti modalities audio */
        return;
      }
      // Log di debug per tutti gli eventi (commentare in produzione)
      if (response.type && !response.type.includes("audio.delta")) {
        console.log(`🔍 Evento OpenAI: ${response.type}`);
      }
      // Audio response dall'AI
      if (response.type === "response.output_audio_transcript.done") {
        //TODO: salvare il messaggio dell'AI
        console.log("🤖 AI ha detto (audio):", response.transcript);
        const transcript = response.transcript;
        if (transcript && transcript.trim()) {
          this.messages.push({
            text: transcript.trim(),
            timestamp: Date.now(),
            role: "assistant",
          });
          console.log("💾 Messaggio assistant salvato:", transcript.trim());
        }
      }

      // tentativo recupero trascrizione audio del cliente
      if (
        response.type ===
        "conversation.item.input_audio_transcription.completed"
      ) {
        console.log("dentro evento di trascrizione");
        console.log("👤 Utente ha detto (evento):", response);
        const userText = response.transcript || "";
        if (userText.trim()) {
          this.messages.push({
            text: userText.trim(),
            timestamp: Date.now(),
            role: "user",
          });
          console.log("💾 Messaggio utente salvato:", userText.trim());
        }
      }
      //Evento per gestire il salvataggio dei messaggi dell'utente

      // Risposta completata - fallback per salvare messaggi se necessario

      // Function call da OpenAI
      if (response.type === "response.function_call_arguments.done") {
        console.log(
          "dentro l'evento che gestisce il lancio degli eventi",
          response.name
        );
        if (response.name == "make_reservation") {
          console.log("evento di tipo make reservation");
          this._handleReservationFunctionCall(response);
          return;
        }
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
  //todo devo rivedere la close per la gestione dei salvataggi
  async close() {
    console.log("🔴 Chiusura connessione OpenAI...");
    console.log(
      "i messaggi",
      this.messages,
      "totale dei messaggi",
      this.messages.length
    );
    if (this.openaiWs) {
      console.log("💾 Salvataggio finale messaggi...");
      if (this.currentUserMessage.trim()) {
        this.messages.push({
          text: this.currentUserMessage.trim(),
          timestamp: Date.now(),
          role: "user",
        });
      }

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
      });

      /* Invio messaggi al server AWS con gestione errori */
      const response = await fetch(`${base_api}call`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hotelId: this.hotelId,
          customerNumber: this.customerNumber,
          hotelNumber: this.hotelCallNumber,
          messages: this.messages,
          callId: this.callId,
          hasReservation: this.hasReservation,
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
  async hangupTwilioCall() {
    console.log("🔴 Chiusura chiamata Twilio...");
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    console.log("Account SID:", accountSid);
    console.log("Auth Token presente:", authToken);

    const callSid = this.twilioCallSid;
    console.log("Chiusura chiamata Twilio, Call SID:", callSid);
    if (!callSid) {
      console.error(
        "❌ callSid non impostato, impossibile chiudere la chiamata"
      );
      return false;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`;
    console.log(url);

    const params = new URLSearchParams();
    params.append("Status", "completed"); // imposta la chiamata come terminata

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(
          "❌ Errore chiusura chiamata Twilio:",
          response.status,
          text
        );
        return false;
      }

      console.log("✅ Chiamata Twilio terminata con successo");
      return true;
    } catch (err) {
      console.error("❌ Errore nella richiesta Twilio:", err);
      return false;
    }
  }

  /** Crea il messaggio di benvenuto personalizzato */
  _createWelcomeMessage() {
    const hour = new Date().getHours();
    let welcomeMessage;

    if (hour < 12) {
      welcomeMessage = "Buongiorno! Come posso aiutarla oggi?";
    } else if (hour < 18) {
      welcomeMessage = "Buon pomeriggio! Come posso aiutarla oggi?";
    } else {
      welcomeMessage = "Buonasera! Come posso aiutarla oggi?";
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
