const { OPENAI_HEADERS, AI_CONFIG } = require("../config/constants");
const crypto = require("crypto");

/* Servizio ottimizzato per la gestione della knowledge base */
class KnowledgeBaseService {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;

    // Cache per risposte veloci
    this.queryCache = new Map();
    this.cacheMaxAge = 3 * 60 * 1000; // 3 minuti
    this.maxCacheSize = 50; // Max 50 risposte cached
  }

  /**
   * Genera una chiave cache per la query
   */
  _generateCacheKey(query, assistantId, threadId) {
    const content = `${query}-${assistantId}-${threadId}`;
    return crypto.createHash("md5").update(content).digest("hex");
  }

  /**
   * Controlla se abbiamo una risposta cached valida
   */
  _getCachedResponse(cacheKey) {
    const cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      console.log("⚡ Risposta trovata in cache!");
      return cached.response;
    }
    return null;
  }

  /**
   * Salva una risposta in cache
   */
  _setCachedResponse(cacheKey, response) {
    if (this.queryCache.size >= this.maxCacheSize) {
      const oldestKey = this.queryCache.keys().next().value;
      this.queryCache.delete(oldestKey);
    }

    this.queryCache.set(cacheKey, {
      response,
      timestamp: Date.now(),
    });
    console.log(
      `💾 Risposta salvata in cache (${this.queryCache.size}/${this.maxCacheSize})`
    );
  }

  /**
   * 🚀 Cerca informazioni usando un assistente esistente (OTTIMIZZATO)
   * @param {string} query - La query di ricerca
   * @param {string} assistantId - ID dell'assistente OpenAI
   * @param {string} threadId - ID del thread OpenAI
   * @param {Function} progressCallback - Callback per aggiornamenti di stato (opzionale)
   */
  async searchWithExistingAssistant(
    query,
    assistantId,
    threadId,
    progressCallback = null
  ) {
    const startTime = Date.now();

    try {
      // 🚀 STEP 1: Controlla cache
      const cacheKey = this._generateCacheKey(query, assistantId, threadId);
      const cachedResponse = this._getCachedResponse(cacheKey);

      if (cachedResponse) {
        if (progressCallback) {
          progressCallback("Risposta trovata in cache!");
        }
        return cachedResponse;
      }

      console.log(`🔍 Ricerca ottimizzata con assistente: ${assistantId}`);

      if (progressCallback) {
        progressCallback("Sto cercando le informazioni richieste...");
      }

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

      // 3. 🚀 Polling ottimizzato: aspetta che il Run sia completato
      let checkInterval = 300; // Inizia molto aggressivo: 300ms

      while (run.status === "queued" || run.status === "in_progress") {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

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

        // Aumenta gradualmente l'intervallo per bilanciare velocità vs API calls
        checkInterval = Math.min(checkInterval + 100, 1500); // Max 1.5 secondi

        // Feedback di progresso più rapido
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime > 2000 && elapsedTime < 2200 && progressCallback) {
          progressCallback("Sto analizzando i documenti...");
        } else if (
          elapsedTime > 4000 &&
          elapsedTime < 4200 &&
          progressCallback
        ) {
          progressCallback("Ricerca approfondita in corso...");
        }
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
      const response = lastMessage.content[0].text.value;

      // 🚀 Salva in cache per query future
      this._setCachedResponse(cacheKey, response);

      const totalTime = Date.now() - startTime;
      console.log(
        `⚡ Ricerca completata in ${totalTime}ms (${
          totalTime < 2000 ? "VELOCE" : totalTime < 4000 ? "MEDIA" : "LENTA"
        })`
      );

      return response;
    } catch (error) {
      console.error("❌ Errore ricerca con assistente esistente:", error);
      throw new Error(`Errore nella ricerca: ${error.message}`);
    }
  }

  /**
   * 📊 Statistiche cache per debug
   */
  getCacheStats() {
    const stats = {
      size: this.queryCache.size,
      maxSize: this.maxCacheSize,
      usage: Math.round((this.queryCache.size / this.maxCacheSize) * 100),
      cacheAge: `${this.cacheMaxAge / 1000}s`,
    };

    console.log(`📊 Cache stats:`, stats);
    return stats;
  }

  /**
   * 🧹 Pulisci cache manualmente
   */
  clearCache() {
    const size = this.queryCache.size;
    this.queryCache.clear();
    console.log(`🧹 Cache pulita - rimosse ${size} risposte`);
  }
}

module.exports = KnowledgeBaseService;
