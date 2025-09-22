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

        let searchResult;

        if (assistantId && assistantId !== "undefined" && threadId) {
          // Usa l'assistente esistente se disponibile
          searchResult =
            await this.knowledgeBaseService.searchWithExistingAssistant(
              args.query,
              assistantId,
              threadId
            );
        } else {
          // Crea un assistente temporaneo
          searchResult = await this.knowledgeBaseService.searchInKnowledgeBase(
            args.query,
            kbFileIds
          );
        }

        // Invia il risultato back a OpenAI
        this._sendFunctionResult(openaiWs, response.call_id, searchResult);
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
}

module.exports = FunctionCallHandler;
