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

  window.MWPlayback = {
    DEFAULT_USAGE_TIMING,
    englishWordCount,
    japaneseCharacterCount,
    calculateUsageReviewDelayMs
  };
})();
