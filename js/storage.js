(() => {
  "use strict";

  const SCHEMA_VERSION = 3;
  const APP_VERSION = "2026.08.20";
  const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
  const MAX_RANGES = 500;
  const MAX_WORDS_PER_RANGE = 5000;
  const MAX_CONTENT_PER_RANGE = 10000;

  const isObject = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const clean = value => String(value ?? "").trim();
  const uniqueStrings = value => [...new Set((Array.isArray(value) ? value : []).map(clean).filter(Boolean))];
  const validDateKey = value => {
    const text = clean(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const parsed = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : "";
  };
  const safeTime = value => {
    const text = clean(value);
    if (!/^\d{2}:\d{2}$/.test(text)) return "";
    const [hours, minutes] = text.split(":").map(Number);
    return hours <= 23 && minutes <= 59 ? text : "";
  };
  const safeIso = value => {
    const text = clean(value);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || Number.isNaN(Date.parse(text))) return "";
    return text.slice(0, 40);
  };
  const safeHttpUrl = (value, allowedHost = "") => {
    const text = clean(value);
    if (!text) return "";
    try {
      const url = new URL(text);
      if (url.protocol !== "https:") return "";
      if (allowedHost && url.hostname !== allowedHost && !url.hostname.endsWith(`.${allowedHost}`)) return "";
      return url.href.slice(0, 2000);
    } catch {
      return "";
    }
  };

  function safeId(value, prefix, used, index) {
    const source = clean(value)
      .normalize("NFKC")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 72);
    const base = source || `${prefix}_${index + 1}`;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate)) candidate = `${base.slice(0, 64)}_${suffix++}`;
    used.add(candidate);
    return candidate;
  }

  function safeSettings(value) {
    const source = isObject(value) ? value : {};
    return {
      demoMode: source.demoMode !== false,
      saveKey: source.saveKey === true,
      dictionaryType: source.dictionaryType === "collegiate" ? "collegiate" : "learners",
      definitionLimit: Number(source.definitionLimit) === 3 ? 3 : 2,
      studyFilter: ["all", "unrated", "hard", "known"].includes(source.studyFilter) ? source.studyFilter : "all",
      playbackInterval: [1, 2, 3].includes(Number(source.playbackInterval)) ? Number(source.playbackInterval) : 2,
      usageReviewExtraSeconds: [0, 3, 5, 8, 10, 15].includes(Number(source.usageReviewExtraSeconds)) ? Number(source.usageReviewExtraSeconds) : 5,
      mondayEndTime: safeTime(source.mondayEndTime),
      wednesdayEndTime: safeTime(source.wednesdayEndTime),
      fridayEndTime: safeTime(source.fridayEndTime)
    };
  }

  function normalizeStudyLog(value) {
    if (!isObject(value)) return {};
    const result = {};
    Object.entries(value).forEach(([date, raw]) => {
      if (!validDateKey(date) || !isObject(raw)) return;
      const integer = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
      const direction = key => {
        const attempts = integer(raw[key]?.attempts);
        return { attempts, correct: Math.min(attempts, integer(raw[key]?.correct)) };
      };
      const attempts = integer(raw.attempts);
      result[date] = {
        attempts,
        correct: Math.min(attempts, integer(raw.correct)),
        enToJa: direction("enToJa"),
        jaToEn: direction("jaToEn")
      };
    });
    return result;
  }

  function sourceData(value) {
    if (!isObject(value)) return null;
    if (isObject(value.data)) return value.data;
    return value;
  }

  function normalizeRanges(value) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(value)) return { errors: ["ranges が配列ではありません。"], warnings, ranges: [] };
    if (value.length > MAX_RANGES) return { errors: [`範囲数が上限 ${MAX_RANGES} 件を超えています。`], warnings, ranges: [] };

    const ranges = [];
    const usedRangeIds = new Set();
    const usedWordIds = new Set();
    const rangeIdMap = new Map();
    value.forEach((rawRange, rangeIndex) => {
      if (!isObject(rawRange)) {
        errors.push(`範囲 ${rangeIndex + 1} がオブジェクトではありません。`);
        return;
      }
      if (!Array.isArray(rawRange.words)) {
        errors.push(`範囲 ${rangeIndex + 1} の words が配列ではありません。`);
        return;
      }
      if (rawRange.words.length > MAX_WORDS_PER_RANGE) {
        errors.push(`範囲 ${rangeIndex + 1} の単語数が上限 ${MAX_WORDS_PER_RANGE} 語を超えています。`);
        return;
      }

      const range = clone(rawRange);
      const originalRangeId = clean(range.id);
      range.id = safeId(originalRangeId, "range", usedRangeIds, rangeIndex);
      if (originalRangeId && !rangeIdMap.has(originalRangeId)) rangeIdMap.set(originalRangeId, range.id);
      if (originalRangeId && originalRangeId !== range.id) warnings.push(`範囲ID「${originalRangeId}」を安全なIDへ変更しました。`);
      range.rangeName = clean(range.rangeName).slice(0, 200);
      range.testDate = validDateKey(range.testDate);
      range.materialType = range.materialType === "memorization" ? "memorization" : "vocabulary";
      range.weekday = clean(range.weekday).slice(0, 10);
      range.pages = clean(range.pages).slice(0, 100);
      range.deleteAt = clean(range.deleteAt).slice(0, 40);
      range.manualTestEndedDate = validDateKey(range.manualTestEndedDate);

      const rangeWordIds = new Set();
      const wordIdMap = new Map();
      const words = [];
      range.words.forEach((rawWord, wordIndex) => {
        if (!isObject(rawWord)) {
          errors.push(`範囲 ${rangeIndex + 1} の単語 ${wordIndex + 1} がオブジェクトではありません。`);
          return;
        }
        const wordText = clean(rawWord.word);
        if (!wordText || wordText.length > 100) {
          errors.push(`範囲 ${rangeIndex + 1} の単語 ${wordIndex + 1} に有効な word がありません。`);
          return;
        }
        const word = clone(rawWord);
        const oldId = clean(word.id);
        if (oldId && wordIdMap.has(oldId)) warnings.push(`範囲「${range.rangeName || rangeIndex + 1}」に重複単語ID「${oldId}」があります。関連参照は先頭の単語へ維持しました。`);
        word.id = safeId(oldId, `word_${rangeIndex + 1}`, usedWordIds, wordIndex);
        rangeWordIds.add(word.id);
        if (oldId && !wordIdMap.has(oldId)) wordIdMap.set(oldId, word.id);
        if (oldId && oldId !== word.id) warnings.push(`単語ID「${oldId}」を安全なIDへ変更しました。`);
        word.word = wordText;
        word.normalized = clean(word.normalized || wordText).toLocaleLowerCase("en-US").slice(0, 100);
        word.meaningsJa = uniqueStrings(word.meaningsJa).map(item => item.slice(0, 500)).slice(0, 30);
        word.acceptedSpellings = uniqueStrings(word.acceptedSpellings).filter(item => item.length <= 100).slice(0, 30);
        word.mwUrl = safeHttpUrl(word.mwUrl, "merriam-webster.com");
        word.audioUrl = safeHttpUrl(word.audioUrl, "merriam-webster.com");
        word.audioId = clean(word.audioId).replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 100);
        word.pronunciation = clean(word.pronunciation).slice(0, 300);
        word.partOfSpeech = clean(word.partOfSpeech).slice(0, 100);
        word.dictionarySource = ["learners", "collegiate"].includes(word.dictionarySource) ? word.dictionarySource : "";
        word.definitions = uniqueStrings(word.definitions).map(item => item.slice(0, 2000)).slice(0, 10);
        word.error = clean(word.error).slice(0, 300);
        word.studyStatus = ["unrated", "hard", "known"].includes(word.studyStatus) ? word.studyStatus : "unrated";
        const usedVariantIds = new Set();
        word.pronunciationVariants = (Array.isArray(word.pronunciationVariants) ? word.pronunciationVariants : []).map((variant, variantIndex) => {
          if (!isObject(variant)) return null;
          return {
            id: safeId(variant.id, `pron_${rangeIndex + 1}_${wordIndex + 1}`, usedVariantIds, variantIndex),
            dictionarySource: ["learners", "collegiate"].includes(variant.dictionarySource) ? variant.dictionarySource : "",
            headword: clean(variant.headword).slice(0, 100),
            partOfSpeech: clean(variant.partOfSpeech).slice(0, 100),
            label: clean(variant.label).slice(0, 200),
            pronunciation: clean(variant.pronunciation).slice(0, 300),
            audioId: clean(variant.audioId).replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 100),
            audioUrl: safeHttpUrl(variant.audioUrl, "merriam-webster.com")
          };
        }).filter(Boolean).slice(0, 30);
        words.push(word);
      });
      range.words = words;
      const mappedCurrentWordId = wordIdMap.get(clean(range.currentWordId)) || clean(range.currentWordId);
      range.currentWordId = rangeWordIds.has(mappedCurrentWordId) ? mappedCurrentWordId : (range.words[0]?.id || "");
      range.words.forEach(word => {
        if (!isObject(word.testStats)) return;
        ["enToJa", "jaToEn"].forEach(direction => {
          const stats = word.testStats[direction];
          if (!isObject(stats) || !isObject(stats.confusedWith)) return;
          stats.confusedWith = Object.fromEntries(Object.entries(stats.confusedWith)
            .map(([id, count]) => [wordIdMap.get(id) || id, Math.max(0, Number(count) || 0)])
            .filter(([id, count]) => rangeWordIds.has(id) && count > 0));
        });
      });

      const normalizeContent = (items, type) => {
        if (items == null) return [];
        if (!Array.isArray(items)) {
          errors.push(`範囲 ${rangeIndex + 1} の ${type} が配列ではありません。`);
          return [];
        }
        if (items.length > MAX_CONTENT_PER_RANGE) {
          errors.push(`範囲 ${rangeIndex + 1} の ${type} が上限 ${MAX_CONTENT_PER_RANGE} 件を超えています。`);
          return [];
        }
        const usedIds = new Set();
        return items.map((rawItem, itemIndex) => {
          if (!isObject(rawItem)) {
            errors.push(`範囲 ${rangeIndex + 1} の ${type} ${itemIndex + 1} がオブジェクトではありません。`);
            return null;
          }
          const item = clone(rawItem);
          item.id = safeId(item.id, `${type}_${rangeIndex + 1}`, usedIds, itemIndex);
          item.english = clean(item.english).slice(0, 10000);
          item.japanese = clean(item.japanese).slice(0, 10000);
          if (!item.english || !item.japanese) {
            errors.push(`範囲 ${rangeIndex + 1} の ${type} ${itemIndex + 1} に英文または日本語訳がありません。`);
            return null;
          }
          item.sourceId = clean(item.sourceId).slice(0, 100);
          if (type === "usageItems") {
            item.type = item.type === "phrase" ? "phrase" : "example";
            item.linkedWordIds = uniqueStrings(item.linkedWordIds).map(id => wordIdMap.get(id) || id).filter(id => rangeWordIds.has(id));
            item.unresolvedRefs = uniqueStrings(item.unresolvedRefs).map(item => item.slice(0, 100)).slice(0, 100);
          } else {
            item.label = clean(item.label).slice(0, 200);
          }
          return item;
        }).filter(Boolean);
      };
      range.usageItems = normalizeContent(range.usageItems, "usageItems");
      range.memoryItems = normalizeContent(range.memoryItems, "memoryItems");
      range.testHistory = (Array.isArray(range.testHistory) ? range.testHistory : []).map(item => {
        if (!isObject(item)) return null;
        const direction = ["enToJa", "jaToEn"].includes(item.direction) ? item.direction : "enToJa";
        const mode = ["normal", "wrong", "ready"].includes(item.mode) ? item.mode : "normal";
        const total = Math.max(0, Math.min(100, Math.floor(Number(item.total) || 0)));
        const correct = Math.max(0, Math.min(total, Math.floor(Number(item.correct) || 0)));
        const finishedAt = safeIso(item.finishedAt);
        return {
          id: clean(item.id).slice(0, 100), direction, mode,
          startedAt: safeIso(item.startedAt),
          finishedAt, total, correct,
          accuracy: total ? Math.round(correct / total * 100) : 0,
          averageResponseMs: Math.max(0, Math.min(300000, Math.floor(Number(item.averageResponseMs) || 0))),
          categoryCorrect: isObject(item.categoryCorrect) ? Object.fromEntries(Object.entries(item.categoryCorrect).map(([key, count]) => [clean(key).slice(0, 30), Math.max(0, Math.floor(Number(count) || 0))])) : {},
          wrongWordIds: uniqueStrings(item.wrongWordIds).map(id => wordIdMap.get(id) || id).filter(id => rangeWordIds.has(id))
        };
      }).filter(Boolean).slice(-30);
      ranges.push(range);
    });
    return { errors, warnings: [...new Set(warnings)], ranges, rangeIdMap };
  }

  function migrateBackup(value) {
    const source = sourceData(value);
    if (!source) return { ok: false, errors: ["JSONの最上位がオブジェクトではありません。"], warnings: [] };
    const inputVersion = Number(value.schemaVersion || value.version || source.schemaVersion || source.version) || 1;
    if (inputVersion > SCHEMA_VERSION) return { ok: false, errors: [`このJSONは新しいschema v${inputVersion}です。現在のアプリ(v${SCHEMA_VERSION})では安全に読み込めません。`], warnings: [] };
    const rangesResult = normalizeRanges(source.ranges);
    const data = {
      schemaVersion: SCHEMA_VERSION,
      settings: safeSettings(source.settings),
      ranges: rangesResult.ranges,
      studyLog: normalizeStudyLog(source.studyLog),
      ui: { selectedRangeId: rangesResult.rangeIdMap?.get(clean(source.ui?.selectedRangeId)) || clean(source.ui?.selectedRangeId) }
    };
    if (data.ui.selectedRangeId && !data.ranges.some(range => range.id === data.ui.selectedRangeId)) data.ui.selectedRangeId = "";
    const warnings = [...rangesResult.warnings];
    if (inputVersion < SCHEMA_VERSION) warnings.unshift(`旧schema v${inputVersion}をv${SCHEMA_VERSION}へ移行します。`);
    return { ok: rangesResult.errors.length === 0, errors: rangesResult.errors, warnings, data };
  }

  function parseBackup(text) {
    const source = String(text || "");
    if (!source.trim()) return { ok: false, errors: ["JSONが空です。"], warnings: [] };
    if (new Blob([source]).size > MAX_IMPORT_BYTES) return { ok: false, errors: ["JSONが8MBを超えています。"], warnings: [] };
    try {
      return migrateBackup(JSON.parse(source));
    } catch {
      return { ok: false, errors: ["JSONの解析に失敗しました。"], warnings: [] };
    }
  }

  function rangeMetadataKey(range) {
    return [clean(range.rangeName).toLocaleLowerCase("ja"), clean(range.testDate), range.materialType || "vocabulary"].join("\u0001");
  }

  function rangeContentKey(range) {
    const wordsById = new Map((range.words || []).map(word => [word.id, clean(word.normalized || word.word).toLocaleLowerCase("en-US")]));
    return JSON.stringify({
      metadata: rangeMetadataKey(range),
      words: (range.words || []).map(word => ({
        word: clean(word.normalized || word.word).toLocaleLowerCase("en-US"),
        meaningsJa: uniqueStrings(word.meaningsJa).sort(),
        acceptedSpellings: uniqueStrings(word.acceptedSpellings).sort()
      })),
      usageItems: (range.usageItems || []).map(item => ({
        type: item.type === "phrase" ? "phrase" : "example",
        english: clean(item.english),
        japanese: clean(item.japanese),
        linkedWords: uniqueStrings(item.linkedWordIds).map(id => wordsById.get(id) || "").filter(Boolean).sort()
      })),
      memoryItems: (range.memoryItems || []).map(item => ({ label: clean(item.label), english: clean(item.english), japanese: clean(item.japanese) }))
    });
  }

  function planImport(text, currentRanges, mode = "append") {
    const parsed = parseBackup(text);
    if (!parsed.ok) return parsed;
    if (parsed.data.settings.saveKey) {
      parsed.data.settings.saveKey = false;
      parsed.warnings.push("安全のため、復元後のAPIキー保存設定をOFFにします。必要なら設定画面で再度有効にしてください。");
    }
    const existing = Array.isArray(currentRanges) ? currentRanges : [];
    const byId = new Map(existing.map(range => [clean(range.id), range]).filter(([id]) => id));
    const byMetadata = new Map(existing.map(range => [rangeMetadataKey(range), range]));
    const incoming = [];
    let duplicates = 0;
    const conflicts = [];
    parsed.data.ranges.forEach(range => {
      const id = clean(range.id);
      const metadata = rangeMetadataKey(range);
      if (mode === "append") {
        const idMatch = byId.get(id);
        const metadataMatch = byMetadata.get(metadata);
        const match = idMatch || metadataMatch;
        if (match) {
          if (rangeContentKey(match) === rangeContentKey(range)) duplicates++;
          else conflicts.push(`範囲「${range.rangeName || id}」は既存範囲とIDまたは名称・日付が同じですが、内容が異なります。追加を中止しました。`);
          return;
        }
      }
      byId.set(id, range);
      byMetadata.set(metadata, range);
      incoming.push(range);
    });
    if (conflicts.length) {
      return { ...parsed, ok: false, errors: conflicts, incoming: [], summary: { ranges: 0, words: 0, duplicates, conflicts: conflicts.length, mode } };
    }
    return {
      ...parsed,
      incoming,
      summary: {
        ranges: incoming.length,
        words: incoming.reduce((sum, range) => sum + range.words.length, 0),
        duplicates,
        conflicts: 0,
        mode
      }
    };
  }

  function createBackup(data, exportedAt = new Date().toISOString()) {
    const normalized = migrateBackup({ schemaVersion: SCHEMA_VERSION, ...clone(data) });
    if (!normalized.ok) throw new Error(normalized.errors.join(" "));
    return {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAt,
      settings: normalized.data.settings,
      ranges: normalized.data.ranges,
      studyLog: normalized.data.studyLog,
      ui: normalized.data.ui
    };
  }

  function runStorageSelfCheck() {
    const legacy = {
      version: 1,
      settings: { dictionaryType: "learners", apiKeySession: "must-not-export" },
      ranges: [{ id: "bad id\"", rangeName: "A", testDate: "2026-08-24", words: [
        { id: "same", word: "record", meaningsJa: ["記録"] },
        { id: "same", word: "expense", meaningsJa: ["費用"] }
      ], usageItems: [{ id: "u 1", type: "example", english: "Keep a record.", japanese: "記録をつける。", linkedWordIds: ["same"] }] }],
      studyLog: { "2026-08-20": { attempts: 1, correct: 1, enToJa: { attempts: 1, correct: 1 } } }
    };
    const backup = createBackup(legacy, "2026-08-20T00:00:00.000Z");
    const parsed = planImport(JSON.stringify(backup), backup.ranges, "append");
    const malformed = parseBackup('{"ranges":[null]}');
    return {
      passed: backup.schemaVersion === SCHEMA_VERSION && !JSON.stringify(backup).includes("must-not-export") &&
        backup.ranges[0].id === "bad_id" && backup.ranges[0].words[0].id !== backup.ranges[0].words[1].id &&
        parsed.ok && parsed.summary.duplicates === 1 && parsed.incoming.length === 0 && !malformed.ok,
      schemaVersion: backup.schemaVersion,
      duplicateRanges: parsed.summary?.duplicates || 0,
      malformedRejected: !malformed.ok
    };
  }

  window.MWStorage = Object.freeze({
    SCHEMA_VERSION,
    APP_VERSION,
    safeSettings,
    normalizeStudyLog,
    migrateBackup,
    parseBackup,
    planImport,
    createBackup,
    runStorageSelfCheck
  });
})();

