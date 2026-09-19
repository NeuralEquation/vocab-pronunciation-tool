(() => {
  "use strict";

  const DEFAULT_USAGE_TIMING = Object.freeze({
    phraseBaseMs: 1200,
    exampleBaseMs: 2000,
    englishWordMs: 220,
    japaneseCharacterMs: 24,
    maxTotalMs: 12000
  });

  function englishWordCount(value) {
    const text = String(value || "").trim();
    if (!text) return 0;
    return (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
  }

  function japaneseCharacterCount(value) {
    return Array.from(String(value || "").replace(/\s/g, "")).length;
  }

  function calculateUsageReviewDelayMs(items, options = {}) {
    const usageItems = Array.isArray(items) ? items : [];
    if (!usageItems.length) return 0;
    if (options.mode === "fixed") {
      const seconds = Number(options.fixedSeconds);
      return Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000;
    }
    const timing = { ...DEFAULT_USAGE_TIMING, ...(options.timing || {}) };
    const total = usageItems.reduce((sum, item) => {
      const base = item?.type === "phrase" ? timing.phraseBaseMs : timing.exampleBaseMs;
      return sum
        + base
        + englishWordCount(item?.english) * timing.englishWordMs
        + japaneseCharacterCount(item?.japanese) * timing.japaneseCharacterMs;
    }, 0);
    return Math.min(timing.maxTotalMs, Math.max(0, Math.round(total)));
  }

  function englishUtterance(text, environment = window) {
    if (!environment.speechSynthesis || !environment.SpeechSynthesisUtterance) return null;
    const utterance = new environment.SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.voice = (environment.speechSynthesis.getVoices?.() || []).find(voice => /^en-US\b/i.test(voice.lang)) || null;
    return utterance;
  }

  // Every callback belongs to one operation and one queue item. Cancelling an
  // HTMLAudioElement may reject play() later; that rejection must do nothing.
  function createPreviewPlayer(environment = window, onStatus = () => {}) {
    let generation = 0, audio = null, utterance = null, timeout = null;
    const clearMedia = () => {
      environment.clearTimeout(timeout);
      timeout = null;
      if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute("src"); audio = null; }
      if (utterance) { utterance.onend = null; utterance.onerror = null; utterance = null; }
    };
    const stop = () => {
      generation++;
      clearMedia();
      environment.speechSynthesis?.cancel();
      onStatus("");
    };
    const play = items => {
      stop();
      const token = generation;
      const queue = items.filter(item => item?.text);
      if (!queue.length) return false;
      let index = -1;
      const next = () => {
        if (token !== generation) return;
        clearMedia();
        const item = queue[++index];
        if (!item) return;
        const itemIndex = index;
        let phase = "official";
        const valid = expected => token === generation && index === itemIndex && phase === expected;
        const finish = expected => {
          if (!valid(expected)) return;
          phase = "done";
          next();
        };
        const fallback = () => {
          if (!valid("official")) return;
          phase = "tts";
          clearMedia();
          utterance = englishUtterance(item.text, environment);
          if (!utterance) { onStatus("公式音声・端末読み上げを利用できません。"); finish("tts"); return; }
          utterance.onend = () => finish("tts");
          utterance.onerror = () => { if (valid("tts")) { onStatus("端末読み上げを再生できません。音声設定を確認してください。"); finish("tts"); } };
          timeout = environment.setTimeout(() => {
            if (!valid("tts")) return;
            utterance.onend = null; utterance.onerror = null;
            environment.speechSynthesis.cancel();
            onStatus("端末読み上げが時間切れになりました。再生ボタンから再試行できます。");
            finish("tts");
          }, Math.min(120000, Math.max(15000, item.text.length * 160)));
          onStatus("端末読み上げ（en-US指定）");
          try { environment.speechSynthesis.speak(utterance); }
          catch { finish("tts"); onStatus("端末読み上げを開始できませんでした。"); }
        };
        if (!item.url) { fallback(); return; }
        try {
          audio = new environment.Audio(item.url);
          audio.onended = () => finish("official");
          audio.onerror = fallback;
          timeout = environment.setTimeout(fallback, 15000);
          onStatus("Merriam-Webster公式音声");
          Promise.resolve(audio.play()).catch(fallback);
        } catch { fallback(); }
      };
      next();
      return true;
    };
    return { play, stop };
  }

  window.MWPlayback = {
    DEFAULT_USAGE_TIMING,
    englishWordCount,
    japaneseCharacterCount,
    calculateUsageReviewDelayMs,
    englishUtterance,
    createPreviewPlayer
  };
})();
