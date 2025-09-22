const { OPENAI_HEADERS, AI_CONFIG } = require("../config/constants");

/**
 * Servizio per gestire le ricerche nella knowledge base di OpenAI
 */
class KnowledgeBaseService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
  }

  /**
   * Cerca informazioni usando un assistente esistente
   */
  async searchWithExistingAssistant(query, assistantId, threadId) {
    try {
      console.log(`🔍 Ricerca con assistente esistente: ${assistantId}`);

      // 1. Aggiungi il messaggio al thread esistente
      await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...OPENAI_HEADERS,
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
            Authorization: `Bearer ${this.apiKey}`,
            ...OPENAI_HEADERS,
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
              Authorization: `Bearer ${this.apiKey}`,
              ...OPENAI_HEADERS,
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
            Authorization: `Bearer ${this.apiKey}`,
            ...OPENAI_HEADERS,
          },
        }
      );

      const messages = await messagesResponse.json();
      const lastMessage = messages.data[0];

      return lastMessage.content[0].text.value;
    } catch (error) {
      console.error("❌ Errore ricerca con assistente esistente:", error);
      throw new Error(`Errore nella ricerca: ${error.message}`);
    }
  }

  /**
   * Cerca informazioni creando un assistente temporaneo
   */
  async searchInKnowledgeBase(query, kbFileIds) {
    try {
      console.log(
        `🔍 Ricerca con assistente temporaneo per ${kbFileIds.length} file`
      );

      // 1. Crea un thread temporaneo per la ricerca
      const threadResponse = await fetch("https://api.openai.com/v1/threads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...OPENAI_HEADERS,
        },
        body: JSON.stringify({}),
      });

      const thread = await threadResponse.json();

      // 2. Aggiungi il messaggio di ricerca con i file allegati
      await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...OPENAI_HEADERS,
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

      // 3. Crea un assistant temporaneo
      const assistantResponse = await fetch(
        "https://api.openai.com/v1/assistants",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...OPENAI_HEADERS,
          },
          body: JSON.stringify({
            model: AI_CONFIG.model,
            tools: [{ type: "file_search" }],
            instructions:
              "Cerca e riassumi informazioni rilevanti dai file allegati.",
          }),
        }
      );

      const assistant = await assistantResponse.json();

      // 4. Esegui la ricerca
      const runResponse = await fetch(
        `https://api.openai.com/v1/threads/${thread.id}/runs`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...OPENAI_HEADERS,
          },
          body: JSON.stringify({
            assistant_id: assistant.id,
          }),
        }
      );

      const run = await runResponse.json();

      // 5. Polling per aspettare il completamento
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
              Authorization: `Bearer ${this.apiKey}`,
              ...OPENAI_HEADERS,
            },
          }
        );
        runStatus = await statusResponse.json();
      }

      // 6. Recupera la risposta
      const messagesResponse = await fetch(
        `https://api.openai.com/v1/threads/${thread.id}/messages`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            ...OPENAI_HEADERS,
          },
        }
      );

      const messages = await messagesResponse.json();
      const lastMessage = messages.data[0];

      // 7. Cleanup - elimina l'assistente temporaneo
      await fetch(`https://api.openai.com/v1/assistants/${assistant.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...OPENAI_HEADERS,
        },
      });

      return lastMessage.content[0].text.value;
    } catch (error) {
      console.error("❌ Errore ricerca knowledge base:", error);
      throw new Error(`Errore nella ricerca: ${error.message}`);
    }
  }
}

module.exports = KnowledgeBaseService;
