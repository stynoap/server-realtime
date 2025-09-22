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
    if (response.name === "search_knowledge_base") {
      try {
        const args = JSON.parse(response.arguments);
        console.log(`🔍 Ricerca knowledge base: "${args.query}"`);

        // Invia un feedback immediato all'utente che la ricerca è iniziata
        this._sendTextMessageToOpenAI(
          openaiWs,
          "Sto cercando le informazioni richieste, un attimo di pazienza..."
        );

        // Definisci il callback per gli aggiornamenti di stato
        const progressCallback = (message) => {
          this._sendTextMessageToOpenAI(openaiWs, message);
        };

        let searchResult;

        if (assistantId && assistantId !== "undefined" && threadId) {
          // Usa l'assistente esistente se disponibile
          searchResult =
            await this.knowledgeBaseService.searchWithExistingAssistant(
              args.query,
              assistantId,
              threadId,
              progressCallback
            );
        } else {
          // Crea un assistente temporaneo
          searchResult = await this.knowledgeBaseService.searchInKnowledgeBase(
            args.query,
            kbFileIds,
            progressCallback
          );
        }

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
        console.error("❌ Errore nella ricerca knowledge base:", error);
        this._sendFunctionResult(
          openaiWs,
          response.call_id,
          "Errore nella ricerca della knowledge base"
        );
      }
    }
  }

  /**
   * Invia il risultato della function call a OpenAI
   */
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

  /**
   * Invia un messaggio testuale a OpenAI durante la ricerca
   */
  _sendTextMessageToOpenAI(openaiWs, message) {
    // Semplicemente aggiungiamo il messaggio alla conversazione
    // OpenAI dovrebbe generare automaticamente l'audio per i messaggi dell'assistant
    openaiWs.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "text",
              text: message,
            },
          ],
        },
      })
    );

    console.log(`🤖 Messaggio di stato inviato: "${message}"`);
  }
}

module.exports = FunctionCallHandler;
