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

  const MISSING_US_VOICE = "米国英語の音声を利用できません。設定の「読み上げ音声」を確認してください。音声の読み込み直後は、少し待って再生し直してください。";

  function voiceId(voice) { return voice.voiceURI || voice.name || ""; }

  function americanVoices(environment = window) {
    const voices = environment.speechSynthesis?.getVoices?.() || [];
    const quality = voice => {
      const name = voice.name || "";
      // Prefer explicitly labelled higher-quality voices, keeping vendor order
      // for ties. A name is a hint, not a guarantee of naturalness.
      if (/natural|neural|premium/i.test(name)) return 4;
      if (/enhanced/i.test(name)) return 3;
      if (/google|samantha|alex|ava|allison/i.test(name)) return 2;
      return 1;
    };
    return voices.filter(voice => /^en[-_]US$/i.test(voice.lang))
      .sort((a, b) => quality(b) - quality(a));
  }

  function englishUtterance(text, environment = window, options = {}) {
    if (!environment.speechSynthesis || !environment.SpeechSynthesisUtterance) return null;
    const voices = americanVoices(environment);
    // Never ask the engine to silently choose a different English accent.
    if (!voices.length) return null;
    const utterance = new environment.SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.voice = voices.find(voice => voiceId(voice) === options.voiceURI) || voices[0];
    utterance.rate = [0.85, 1, 1.1].includes(Number(options.rate)) ? Number(options.rate) : 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    return utterance;
  }

  function speechStatus(utterance) {
    return `米国英語：${utterance.voice?.name || "端末音声"}（${utterance.rate}倍）`;
  }

  // Every callback belongs to one operation and one queue item. Cancelling an
  // HTMLAudioElement may reject play() later; that rejection must do nothing.
  function createPreviewPlayer(environment = window, onStatus = () => {}, getSpeechOptions = () => ({})) {
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
          if (item.requireOfficial) {
            clearMedia(); onStatus("この品詞の公式音声を再生できません。別の品詞や端末音声には切り替えません。");
            finish("official"); return;
          }
          phase = "tts";
          clearMedia();
          utterance = englishUtterance(item.text, environment, item.speechOptions || getSpeechOptions());
          if (!utterance) { onStatus(MISSING_US_VOICE); finish("tts"); return; }
          utterance.onend = () => finish("tts");
          utterance.onerror = () => { if (valid("tts")) { onStatus("端末読み上げを再生できません。音声設定を確認してください。"); finish("tts"); } };
          timeout = environment.setTimeout(() => {
            if (!valid("tts")) return;
            utterance.onend = null; utterance.onerror = null;
            environment.speechSynthesis.cancel();
            onStatus("端末読み上げが時間切れになりました。再生ボタンから再試行できます。");
            finish("tts");
          }, Math.min(120000, Math.max(15000, item.text.length * 160)));
          onStatus(speechStatus(utterance));
          try { environment.speechSynthesis.speak(utterance); }
          catch { finish("tts"); onStatus("端末読み上げを開始できませんでした。"); }
        };
        if (!item.url) { fallback(); return; }
        try {
          audio = new environment.Audio(item.url);
          audio.onended = () => finish("official");
          audio.onerror = fallback;
          timeout = environment.setTimeout(fallback, 15000);
          onStatus(`Merriam-Webster公式音声${item.label ? `（${item.label}）` : ""}`);
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
    MISSING_US_VOICE,
    voiceId,
    americanVoices,
    speechStatus,
    englishUtterance,
    createPreviewPlayer
  };
})();
