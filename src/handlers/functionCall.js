const KnowledgeBaseService = require("../services/knowledgeBase");

/**
 * Handler per gestire le chiamate alle funzioni da parte dell'AI
 */
class FunctionCallHandler {
  constructor() {
    this.knowledgeBaseService = new KnowledgeBaseService();
  }

  /**
   * Gestisce le chiamate alle funzioni
   */
  async handleFunctionCall(
    response,
    openaiWs,
    kbFileIds,
    assistantId,
    threadId
  ) {
    /* Condizione di ricerca nella knowledge base */
    if (response.name === "search_knowledge_base") {
      try {
        const args = JSON.parse(response.arguments);
        console.log(`🔍 Ricerca knowledge base: "${args.query}"`);

        // Callback per aggiornamenti di stato
        const progressCallback = (message) => {
          this._sendTextMessageToOpenAI(openaiWs, message);
        };

        let searchResult;

        // Usa assistente esistente (molto più veloce!)
        searchResult =
          await this.knowledgeBaseService.searchWithExistingAssistant(
            args.query,
            assistantId,
            threadId,
            progressCallback
          );

        // Pulisci il risultato rimuovendo i metadati del documento
        const cleanedResult = searchResult.replace(/【[^】]+】/g, "");

        // Invia il risultato back a OpenAI
        this._sendFunctionResult(openaiWs, response.call_id, searchResult);

        // IMPORTANTE: Forza OpenAI a generare una risposta dopo aver ricevuto i risultati
        // Questo risolve il problema della mancata risposta spontanea
        setTimeout(() => {
          openaiWs.send(
            JSON.stringify({
              type: "response.create",
            })
          );
        }, 100); // Piccolo delay per assicurarsi che function_call_output sia processato prima
      } catch (error) {
        console.error(" Errore nella ricerca knowledge base:", error);
        this._sendFunctionResult(
          openaiWs,
          response.call_id,
          "Errore nella ricerca della knowledge base"
        );
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
  }

  /** Invia un messaggio testuale immediato a OpenAI durante la ricerca */
  _sendTextMessageToOpenAI(openaiWs, message) {
    // Invia il messaggio come risposta immediata dell'AI
    openaiWs.send(
      JSON.stringify({
        type: "response.create",
        response: {
          modalities: ["text", "audio"],
          instructions: `Rispondi immediatamente con questo messaggio: "${message}"`,
        },
      })
    );

    console.log(`🤖 Messaggio di stato immediato inviato: "${message}"`);
  }
}

module.exports = FunctionCallHandler;
