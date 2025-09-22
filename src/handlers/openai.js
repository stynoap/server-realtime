const WebSocket = require("ws");
const { OPENAI_WS_URL, VAD_CONFIG, AI_CONFIG } = require("../config/constants");
const FunctionCallHandler = require("./functionCall");

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

  /**
   * Configura gli event handler per OpenAI WebSocket
   */
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

  /**
   * Invia la configurazione della sessione a OpenAI
   */
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

  /**
   * Crea la configurazione dei tools
   */
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

  /**
   * Gestisce i messaggi da OpenAI
   */
  _handleMessage(message) {
    try {
      const response = JSON.parse(message.toString());

      // Audio response dall'AI
      if (
        response.type === "response.audio.delta" &&
        response.delta &&
        this.streamSid
      ) {
        this._forwardAudioToTwilio(response.delta);
      }

      // Audio da text-to-speech
      if (
        response.type === "text_to_speech.response" &&
        response.audio &&
        this.streamSid
      ) {
        this._forwardAudioToTwilio(response.audio);
      }

      // Transcription dell'utente
      if (
        response.type ===
        "conversation.item.input_audio_transcription.completed"
      ) {
        console.log("👤 Utente ha detto:", response.transcript);
      }

      // Risposta text dell'AI
      if (response.type === "response.text.delta") {
        console.log("🤖 AI risponde:", response.delta);
      }

      // Function call
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

  /**
   * Invia audio dell'utente a OpenAI
   */
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

  /**
   * Invia un messaggio di testo a OpenAI (per il benvenuto)
   */
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

  /**
   * Imposta stream SID
   */
  setStreamSid(streamSid) {
    this.streamSid = streamSid;
  }

  /**
   * Chiude la connessione
   */
  close() {
    if (this.openaiWs && this.openaiWs.readyState === WebSocket.OPEN) {
      this.openaiWs.close();
    }
  }
}

module.exports = OpenAIHandler;
