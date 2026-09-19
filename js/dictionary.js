(() => {
  "use strict";

  function createClient(environment = window, timeoutMs = 15000) {
    const abortError = () => new DOMException("API取得を中止しました", "AbortError");
    async function request(word, apiKey, reference, { signal, onAttempt = () => {} } = {}) {
      if (!["learners", "collegiate"].includes(reference) || !apiKey) throw new Error("APIキーを確認してください");
      const endpoint = `https://www.dictionaryapi.com/api/v3/references/${reference}/json/${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (signal?.aborted) throw abortError();
        const controller = new AbortController();
        let timedOut = false;
        const cancel = () => controller.abort();
        signal?.addEventListener("abort", cancel, { once: true });
        const timer = environment.setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        try {
          onAttempt();
          const response = await environment.fetch(endpoint, { signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
          if (!response.ok) {
            const error = new Error(`HTTP ${response.status}`);
            error.retryable = [429, 500, 502, 503, 504].includes(response.status);
            throw error;
          }
          const text = await response.text();
          // Response bodies, request URLs and browser errors are never forwarded
          // to UI, logs or stored word errors.
          if (text.includes(apiKey) || text.includes(encodeURIComponent(apiKey))) throw new Error("API応答を安全に読み込めません");
          let data;
          try { data = JSON.parse(text); } catch { throw new Error("API応答を安全に読み込めません"); }
          if (!Array.isArray(data)) throw new Error("API応答を安全に読み込めません");
          return data;
        } catch (error) {
          if (signal?.aborted) throw abortError();
          if (timedOut) throw new DOMException("API通信が時間切れになりました", "TimeoutError");
          if (attempt || !(error.retryable || error instanceof TypeError)) {
            if (/^HTTP \d{3}$/.test(error.message) || error.message === "API応答を安全に読み込めません") throw error;
            throw new Error("ネットワークまたはAPIへの接続に失敗しました");
          }
        } finally {
          environment.clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
        }
        await new Promise((resolve, reject) => {
          const done = () => { signal?.removeEventListener("abort", cancelWait); resolve(); };
          const wait = environment.setTimeout(done, 650);
          const cancelWait = () => { environment.clearTimeout(wait); signal?.removeEventListener("abort", cancelWait); reject(abortError()); };
          if (signal?.aborted) cancelWait();
          else signal?.addEventListener("abort", cancelWait, { once: true });
        });
      }
    }
    return { request };
  }
  window.MWDictionary = { createClient };
})();
