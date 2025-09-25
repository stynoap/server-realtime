const { AWS_SERVER_URL, ASK_ENDPOINT } = require("../config/constants");

/**
 * Handler ottimizzato per gestire le funzioni con sistema RAG
 */
class FunctionCallHandlerRAG {
  constructor() {
    // URL del server RAG dalle constants (più pratico per ngrok)
    this.ragEndpoint = ASK_ENDPOINT;
    console.log(`🚀 RAG endpoint configurato: ${this.ragEndpoint}`);
  }

  /**
   * Gestisce le chiamate alle funzioni con RAG velocissimo
   */
  async handleFunctionCall(
    response,
    openaiWs,
    hotelId // Ora usiamo hotelId invece di kbFileIds
  ) {
    if (response.name === "search_knowledge_base") {
      try {
        /* Estrai gli argomenti dalla risposta */
        const args = JSON.parse(response.arguments);
        console.log(
          `🚀 Ricerca RAG veloce: "${args.query}" per hotel: ${hotelId}`
        );

        // ✅ Niente feedback immediato per evitare conflitti
        /*       this._sendImmediateResponse(
          openaiWs,
          "Sto cercando le informazioni..."
        ); */
        const startTime = Date.now();

        // 🚀 RICERCA RAG SUPER-VELOCE
        const ragResponse = await fetch(this.ragEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query: args.query,
            hotelId: hotelId,
          }),
        });

        if (!ragResponse.ok) {
          throw new Error(`RAG server error: ${ragResponse.status}`);
        }

        const relevantDocs = await ragResponse.json();
        console.log("📄 Documenti rilevanti ricevuti:", relevantDocs);

        // Costruisci il contesto dalla ricerca vettoriale
        let context = "";
        if (relevantDocs && relevantDocs.length > 0) {
          context = relevantDocs
            .filter((doc) => doc.score > 0.7) // Filtra per relevance
            .slice(0, 3) // Max 3 risultati migliori
            .map((doc, index) => {
              return `${index + 1}. ${doc.text}`;
            })
            .join("\n\n");

          if (!context) {
            context =
              "Non sono state trovate informazioni specifiche per questa richiesta.";
          }
        } else {
          context =
            "Non sono state trovate informazioni relative alla tua richiesta.";
        }

        const searchResult = context; // Risposta diretta senza prefisso

        const totalTime = Date.now() - startTime;
        const docCount = relevantDocs ? relevantDocs.length : 0;
        console.log(
          `⚡ Ricerca RAG completata in ${totalTime}ms - Trovati ${docCount} documenti`
        );

        // Invia il risultato a OpenAI
        this._sendFunctionResult(openaiWs, response.call_id, searchResult);

        // ✅ OpenAI risponderà automaticamente dopo il function result
      } catch (error) {
        console.error("❌ Errore nella ricerca RAG:", error);

        const errorMessage =
          "Errore nel sistema di ricerca. Prova a riformulare la domanda.";
        console.log(response, response.callId, "la risposta e il callId");
        this._sendFunctionResult(openaiWs, response.call_id, errorMessage);

        // ✅ OpenAI risponderà automaticamente anche in caso di errore
      }
    }
  }

  /** Invia il risultato della function call a OpenAI */
  _sendFunctionResult(openaiWs, callId, result) {
    openaiWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: result,
        },
      })
    );
    openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {},
      })
    );
  }

  _sendImmediateResponse(openaiWs, message) {
    openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: `Rispondi brevemente: "${message}"`,
        },
      })
    );

    console.log(`🤖 Feedback immediato inviato: "${message}"`);
  }
}

module.exports = FunctionCallHandlerRAG;
