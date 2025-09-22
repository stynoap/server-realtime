const OpenAIHandler = require("./openai");

/**
 * Handler per gestire la connessione WebSocket con Twilio
 */
class TwilioHandler {
  constructor(twilioWs) {
    this.twilioWs = twilioWs;
    this.openaiHandler = null;
    this._setupEventHandlers();
  }

  /**
   * Configura gli event handler per Twilio WebSocket
   */
  _setupEventHandlers() {
    this.twilioWs.on("message", (message) => {
      this._handleMessage(message);
    });

    this.twilioWs.on("close", () => {
      console.log("📞 Twilio disconnesso");
      if (this.openaiHandler) {
        this.openaiHandler.close();
      }
    });

    this.twilioWs.on("error", (error) => {
      console.error("❌ Errore Twilio WebSocket:", error);
    });
  }

  /**
   * Gestisce i messaggi da Twilio
   */
  _handleMessage(message) {
    try {
      const data = JSON.parse(message.toString());

      switch (data.event) {
        case "connected":
          console.log("📞 Chiamata Twilio connessa");
          break;

        case "start":
          this._handleStart(data);
          break;

        case "media":
          this._handleMedia(data);
          break;

        case "stop":
          this._handleStop();
          break;

        default:
          console.log(`📨 Evento Twilio sconosciuto: ${data.event}`);
      }
    } catch (error) {
      console.error("❌ Errore parsing messaggio Twilio:", error);
    }
  }

  /**
   * Gestisce l'evento start
   */
  _handleStart(data) {
    const streamSid = data.start.streamSid;
    const callParameters = data.start.customParameters || {};

    console.log(`🎥 Stream iniziato: ${streamSid}`);
    console.log("📋 Parametri chiamata:", callParameters);

    // Crea e connetti OpenAI handler
    this.openaiHandler = new OpenAIHandler(this.twilioWs);
    this.openaiHandler.setStreamSid(streamSid);

    // Connetti a OpenAI e invia messaggio di benvenuto quando è pronto
    this.openaiHandler.connect(callParameters, () => {
      // Callback chiamata quando OpenAI è connesso e configurato
      this._sendWelcomeMessage(callParameters);
    });
  }

  /**
   * Invia un messaggio di benvenuto automatico
   */
  _sendWelcomeMessage(callParameters) {
    console.log("🎙️ Inviando messaggio di benvenuto...");

    // Messaggio di benvenuto personalizzato in base al contesto
    const welcomeMessage = this._createWelcomeMessage(callParameters);

    // Usa un timeout breve per assicurarsi che OpenAI sia completamente pronto
    setTimeout(() => {
      if (this.openaiHandler) {
        this.openaiHandler.sendTextToOpenAI(welcomeMessage);
      }
    }, 500);
  }

  /**
   * Crea il messaggio di benvenuto personalizzato
   */
  _createWelcomeMessage(callParameters) {
    const { hotelNumber, callerNumber } = callParameters;

    // Personalizzazione in base all'orario
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

  /**
   * Gestisce l'evento media (audio dall'utente)
   */
  _handleMedia(data) {
    if (data.media.payload && this.openaiHandler) {
      this.openaiHandler.sendAudioToOpenAI(data.media.payload);
    }
  }

  /**
   * Gestisce l'evento stop
   */
  _handleStop() {
    console.log("⏹️ Stream terminato");
    if (this.openaiHandler) {
      this.openaiHandler.close();
      this.openaiHandler = null;
    }
  }
}

module.exports = TwilioHandler;
