(() => {
  "use strict";

  const VALID_USAGE_TYPES = new Set(["example", "phrase"]);
  const VALID_RATINGS = new Set(["circle", "triangle", "cross"]);

  const clean = value => String(value ?? "").trim();
  const unique = values => [...new Set(values.filter(Boolean))];
  const splitJapanese = value => unique(clean(value).split(/[／/、;；]+/).map(clean));
  const reviewDateKey = now => {
    const date = new Date(now);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  };
  const defaultStats = () => ({
    attempts: 0,
    circle: 0,
    triangle: 0,
    cross: 0,
    consecutiveCircle: 0,
    successfulReviewDates: [],
    lastSuccessfulReviewDate: "",
    lastLapseDate: "",
    lastRating: "",
    lastReviewedAt: ""
  });

  function parseWordRows(text) {
    const rows = [];
    const seen = new Set();
    let duplicates = 0;
    let invalid = 0;
    clean(text).split(/\r?\n/).flatMap(line => line.includes("\t") ? [line] : line.split(/[\s,、]+/)).map(clean).filter(Boolean).forEach(line => {
      const parts = line.split("\t").map(clean);
      const hasSourceId = parts.length >= 3 && /^W[\w-]+$/i.test(parts[0]);
      const sourceId = hasSourceId ? parts.shift() : "";
      const word = clean(parts.shift()).replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, "");
      const normalized = word.toLowerCase();
      if (!/^[A-Za-z][A-Za-z'-]{0,59}$/.test(word)) {
        invalid++;
        return;
      }
      if (seen.has(normalized)) {
        duplicates++;
        return;
      }
      seen.add(normalized);
      rows.push({ sourceId, word, normalized, meaningsJa: splitJapanese(parts.join("／")) });
    });
    return { rows, duplicates, invalid };
  }

  function normalizeUsageList(value) {
    const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
    return list.map(item => ({
      english: clean(item?.english ?? item?.en),
      japanese: clean(item?.japanese ?? item?.ja)
    })).filter(item => item.english && item.japanese);
  }

  function splitMultiValue(value) {
    return clean(value).split(/\s*\|\|\s*/).map(clean).filter(Boolean);
  }

  function normalizeUnifiedEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const word = clean(entry.word ?? entry.headword).replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, "");
    if (!/^[A-Za-z][A-Za-z'-]{0,59}$/.test(word)) return null;
    const meaningsValue = entry.meaningsJa ?? entry.meaning ?? entry.japanese ?? "";
    const meaningsJa = Array.isArray(meaningsValue) ? unique(meaningsValue.map(clean)) : splitJapanese(meaningsValue);
    return {
      word,
      normalized: word.toLowerCase(),
      meaningsJa,
      examples: normalizeUsageList(entry.examples ?? entry.example),
      phrases: normalizeUsageList(entry.phrases ?? entry.expressions ?? entry.phrase)
    };
  }

  function parseUnifiedRows(text) {
    const source = clean(text);
    const candidates = [];
    const issues = [];
    let invalid = 0;
    if (!source) return { rows: [], duplicates: 0, invalid: 0, issues: [] };
    if (source.startsWith("[")) {
      try {
        const parsed = JSON.parse(source);
        if (!Array.isArray(parsed)) {
          return { rows: [], duplicates: 0, invalid: 1, issues: [{ line: 1, message: "JSON配列ではありません。" }] };
        }
        parsed.forEach((value, index) => candidates.push({ value, line: index + 1 }));
      } catch {
        return { rows: [], duplicates: 0, invalid: 1, issues: [{ line: 1, message: "JSONの解析に失敗しました。" }] };
      }
    } else {
      source.split(/\r?\n/).map((value, index) => ({ value: clean(value), line: index + 1 })).filter(entry => entry.value).forEach(entry => {
        const line = entry.value;
        if (line.startsWith("{")) {
          try {
            candidates.push({ value: JSON.parse(line), line: entry.line });
          } catch {
            invalid++;
            issues.push({ line: entry.line, message: "JSONの解析に失敗しました。" });
          }
          return;
        }
        const parts = line.split("\t").map(clean);
        if (parts.length < 2) {
          invalid++;
          issues.push({ line: entry.line, message: "単語と日本語訳の列が不足しています。" });
          return;
        }
        const exampleEnglish = splitMultiValue(parts[2]);
        const exampleJapanese = splitMultiValue(parts[3]);
        const phraseEnglish = splitMultiValue(parts[4]);
        const phraseJapanese = splitMultiValue(parts[5]);
        if (exampleEnglish.length !== exampleJapanese.length || phraseEnglish.length !== phraseJapanese.length) {
          invalid++;
          issues.push({ line: entry.line, message: "例文・熟語の英語と日本語訳の件数が一致しません。" });
          return;
        }
        candidates.push({ line: entry.line, value: {
          word: parts[0],
          meaning: parts[1],
          examples: exampleEnglish.map((english, index) => ({ english, japanese: exampleJapanese[index] || "" })),
          phrases: phraseEnglish.map((english, index) => ({ english, japanese: phraseJapanese[index] || "" }))
        } });
      });
    }
    const rows = [];
    const seen = new Set();
    let duplicates = 0;
    candidates.forEach(entry => {
      const candidate = entry.value;
      const meaningsValue = candidate?.meaningsJa ?? candidate?.meaning ?? candidate?.japanese ?? "";
      const meanings = Array.isArray(meaningsValue) ? meaningsValue.map(clean).filter(Boolean) : splitJapanese(meaningsValue);
      const usageKeys = ["examples", "example", "phrases", "expressions", "phrase"];
      const invalidUsageStructure = usageKeys.some(key => {
        const value = candidate?.[key];
        return value != null && value !== "" && !Array.isArray(value) && typeof value !== "object";
      });
      const incompleteUsage = usageKeys
        .flatMap(key => {
          const value = candidate?.[key];
          return Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
        })
        .some(item => !clean(item?.english ?? item?.en) || !clean(item?.japanese ?? item?.ja));
      if (!meanings.length || invalidUsageStructure || incompleteUsage) {
        invalid++;
        issues.push({
          line: entry.line,
          message: !meanings.length
            ? "日本語訳がありません。"
            : invalidUsageStructure
              ? "例文・熟語は配列またはオブジェクトで入力してください。"
              : "例文・熟語の英語または日本語訳が不足しています。"
        });
        return;
      }
      const row = normalizeUnifiedEntry(candidate);
      if (!row) {
        invalid++;
        issues.push({ line: entry.line, message: "英単語の形式を確認してください。" });
        return;
      }
      if (seen.has(row.normalized)) {
        duplicates++;
        issues.push({ line: entry.line, message: `重複する単語です: ${row.word}` });
        return;
      }
      seen.add(row.normalized);
      rows.push(row);
    });
    return { rows, duplicates, invalid, issues };
  }

  function parseUsageRows(text) {
    const rows = [];
    let invalid = 0;
    clean(text).split(/\r?\n/).map(clean).filter(Boolean).forEach((line, index) => {
      const parts = line.split("\t").map(clean);
      let sourceId = "", type = "example", refs = "", english = "", japanese = "";
      if (parts.length >= 5) {
        [sourceId, type, refs, english] = parts;
        japanese = parts.slice(4).join("／");
      } else if (parts.length === 4 && VALID_USAGE_TYPES.has(parts[0].toLowerCase())) {
        [type, refs, english, japanese] = parts;
      } else if (parts.length >= 2) {
        [english, japanese] = [parts[0], parts.slice(1).join("／")];
      }
      type = type.toLowerCase();
      if (!VALID_USAGE_TYPES.has(type) || !english || !japanese) {
        invalid++;
        return;
      }
      rows.push({
        sourceId: sourceId || `${type === "phrase" ? "P" : "E"}${String(index + 1).padStart(3, "0")}`,
        type,
        sourceRefs: unique(refs.split(/[,、\s]+/).map(clean)),
        english,
        japanese
      });
    });
    return { rows, invalid };
  }

  function parseMemoryRows(text) {
    const rows = [];
    const issues = [];
    let invalid = 0;
    clean(text).split(/\r?\n/).map(clean).filter(Boolean).forEach((line, index) => {
      const parts = line.split("\t").map(clean);
      let sourceId = "", label = "", english = "", japanese = "";
      if (parts.length >= 4) {
        [sourceId, label, english] = parts;
        japanese = parts.slice(3).join("／");
      } else if (parts.length >= 3) {
        [sourceId, english] = parts;
        japanese = parts.slice(2).join("／");
      } else if (parts.length >= 2) {
        [english, japanese] = [parts[0], parts.slice(1).join("／")];
      }
      if (!english || !japanese) {
        invalid++;
        issues.push({ line: index + 1, message: "英文全文または日本語訳が不足しています。" });
        return;
      }
      rows.push({
        sourceId: sourceId || `M${String(index + 1).padStart(3, "0")}`,
        label,
        english,
        japanese
      });
    });
    return { rows, invalid, issues };
  }

  function makeUsageItems(rows, sourceWordMap, uid) {
    return rows.map(row => {
      const linkedWordIds = unique(row.sourceRefs.map(ref => sourceWordMap.get(ref.toLowerCase()) || ""));
      const unresolvedRefs = row.sourceRefs.filter(ref => !sourceWordMap.has(ref.toLowerCase()));
      return {
        id: uid("usage"),
        sourceId: row.sourceId,
        type: row.type,
        english: row.english,
        japanese: row.japanese,
        linkedWordIds,
        unresolvedRefs,
        recallStats: defaultStats()
      };
    });
  }

  function makeMemoryItems(rows, uid) {
    return rows.map(row => ({
      id: uid("memory"),
      sourceId: row.sourceId,
      label: row.label,
      english: row.english,
      japanese: row.japanese,
      recallStats: defaultStats()
    }));
  }

  function normalizeRecallStats(value) {
    const stats = { ...defaultStats(), ...(value && typeof value === "object" ? value : {}) };
    ["attempts", "circle", "triangle", "cross", "consecutiveCircle"].forEach(key => {
      stats[key] = Math.max(0, Number(stats[key]) || 0);
    });
    stats.successfulReviewDates = unique(
      (Array.isArray(stats.successfulReviewDates) ? stats.successfulReviewDates : [])
        .map(clean)
        .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
    ).sort().slice(-20);
    if (!VALID_RATINGS.has(stats.lastRating)) stats.lastRating = "";
    // Older saved data has no explicit lapse boundary. Its last non-circle
    // assessment is still enough to prevent a same-day retry from restoring mastery.
    const reviewedAt = Date.parse(stats.lastReviewedAt);
    const legacyLapseDate = Number.isNaN(reviewedAt) ? "" : reviewDateKey(reviewedAt);
    stats.lastLapseDate = /^\d{4}-\d{2}-\d{2}$/.test(clean(stats.lastLapseDate))
      ? clean(stats.lastLapseDate)
      : (stats.lastRating === "triangle" || stats.lastRating === "cross" ? legacyLapseDate : "");
    stats.lastSuccessfulReviewDate = stats.successfulReviewDates.at(-1) || "";
    return stats;
  }

  function normalizeRangeContent(range, uid) {
    range.materialType = range.materialType === "memorization" ? "memorization" : "vocabulary";
    range.usageItems = Array.isArray(range.usageItems) ? range.usageItems : [];
    range.memoryItems = Array.isArray(range.memoryItems) ? range.memoryItems : [];
    const wordIds = new Set((range.words || []).map(word => word.id));
    range.usageItems = range.usageItems.map(item => ({
      id: item.id || uid("usage"),
      sourceId: clean(item.sourceId),
      type: VALID_USAGE_TYPES.has(item.type) ? item.type : "example",
      english: clean(item.english),
      japanese: clean(item.japanese),
      linkedWordIds: unique((Array.isArray(item.linkedWordIds) ? item.linkedWordIds : []).filter(id => wordIds.has(id))),
      unresolvedRefs: unique(Array.isArray(item.unresolvedRefs) ? item.unresolvedRefs.map(clean) : []),
      recallStats: normalizeRecallStats(item.recallStats)
    })).filter(item => item.english && item.japanese);
    range.memoryItems = range.memoryItems.map(item => ({
      id: item.id || uid("memory"),
      sourceId: clean(item.sourceId),
      label: clean(item.label),
      english: clean(item.english),
      japanese: clean(item.japanese),
      recallStats: normalizeRecallStats(item.recallStats)
    })).filter(item => item.english && item.japanese);
    return range;
  }

  function isSettled(item) {
    const stats = normalizeRecallStats(item?.recallStats);
    return stats.successfulReviewDates.length >= 2 && stats.lastRating === "circle" &&
      (!stats.lastLapseDate || stats.lastSuccessfulReviewDate > stats.lastLapseDate);
  }

  function selectRecallItems(items, options = {}, random = Math.random) {
    const mode = options.mode || "all";
    const type = options.type || "all";
    let selected = items.filter(item => type === "all" || item.type === type);
    if (mode === "unsettled") selected = selected.filter(item => !isSettled(item));
    const limit = mode === "random5" ? 5 : mode === "random10" ? 10 : mode === "test15" ? 15 : Infinity;
    selected = selected.map(item => ({ item, sort: random() })).sort((a, b) => a.sort - b.sort).map(entry => entry.item);
    return selected.slice(0, limit);
  }

  function createRecallSession(items, options = {}, random = Math.random, now = Date.now()) {
    const selected = selectRecallItems(items, options, random);
    if (!selected.length) return { error: options.mode === "unsettled" ? "未定着の項目はありません。" : "暗唱できる項目がありません。" };
    return {
      id: `recall_${now.toString(36)}`,
      source: options.source || "usage",
      mode: options.mode || "all",
      type: options.type || "all",
      itemIds: selected.map(item => item.id),
      queue: selected.map(item => item.id),
      index: 0,
      answerVisible: false,
      assessments: [],
      startedAt: new Date(now).toISOString(),
      finished: false
    };
  }

  function rateRecallItem(session, item, rating, now = Date.now()) {
    if (!session || session.finished || !VALID_RATINGS.has(rating) || !item) return null;
    const currentId = session.queue.shift();
    if (currentId !== item.id) return null;
    const stats = item.recallStats = normalizeRecallStats(item.recallStats);
    stats.attempts++;
    stats[rating]++;
    stats.consecutiveCircle = rating === "circle" ? stats.consecutiveCircle + 1 : 0;
    if (rating === "circle") {
      stats.successfulReviewDates = unique([...(stats.successfulReviewDates || []), reviewDateKey(now)]).sort().slice(-20);
      stats.lastSuccessfulReviewDate = stats.successfulReviewDates.at(-1) || "";
    } else {
      stats.lastLapseDate = reviewDateKey(now);
    }
    stats.lastRating = rating;
    stats.lastReviewedAt = new Date(now).toISOString();
    session.assessments.push({ itemId: item.id, rating, reviewedAt: stats.lastReviewedAt });
    if (rating === "cross") session.queue.splice(Math.min(3, session.queue.length), 0, item.id);
    else if (rating === "triangle") session.queue.push(item.id);
    session.index++;
    session.answerVisible = false;
    session.finished = session.queue.length === 0;
    if (session.finished) session.finishedAt = stats.lastReviewedAt;
    return { finished: session.finished, remaining: session.queue.length };
  }

  function contentStats(range) {
    const usage = range.usageItems || [];
    const memory = range.memoryItems || [];
    return {
      examples: usage.filter(item => item.type === "example").length,
      phrases: usage.filter(item => item.type === "phrase").length,
      examplesUnsettled: usage.filter(item => item.type === "example" && !isSettled(item)).length,
      phrasesUnsettled: usage.filter(item => item.type === "phrase" && !isSettled(item)).length,
      usageUnsettled: usage.filter(item => !isSettled(item)).length,
      memoryTotal: memory.length,
      memoryUnsettled: memory.filter(item => !isSettled(item)).length,
      unresolved: usage.filter(item => item.unresolvedRefs?.length).length
    };
  }

  function estimateBytes(value) {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  function runContentSelfCheck() {
    let seq = 0;
    const uid = prefix => `${prefix}_${++seq}`;
    const words = parseWordRows("W001\trecord\t記録／記録する\nW002\texpense\t費用").rows;
    const usageRows = parseUsageRows("E001\texample\tW001,W002\tKeep a record.\t記録をつける\nP001\tphrase\tW002\tat the expense of A\tAを犠牲にして").rows;
    const sourceMap = new Map(words.map((word, index) => [word.sourceId.toLowerCase(), `word_${index + 1}`]));
    const usage = makeUsageItems(usageRows, sourceMap, uid);
    const memory = makeMemoryItems(parseMemoryRows("M001\t1\tI am ready.\t私は準備ができている").rows, uid);
    const unified = parseUnifiedRows('{"word":"record","meaning":"記録","examples":[{"en":"Keep a record.","ja":"記録をつける。"}],"phrases":[{"en":"on record","ja":"記録されて"}]}');
    const dayOne = Date.UTC(2026, 6, 28, 3);
    const dayTwo = Date.UTC(2026, 6, 29, 3);
    const dayThree = Date.UTC(2026, 6, 30, 3);
    const firstSession = createRecallSession(usage, { mode: "all", source: "usage" }, () => 0.5, dayOne);
    rateRecallItem(firstSession, usage[0], "cross", dayOne + 1000);
    rateRecallItem(firstSession, usage[1], "circle", dayOne + 2000);
    rateRecallItem(firstSession, usage[0], "circle", dayOne + 3000);
    const settledAfterOneDay = isSettled(usage[0]);
    const secondSession = createRecallSession(usage, { mode: "unsettled", source: "usage" }, () => 0.5, dayTwo);
    rateRecallItem(secondSession, usage[0], "circle", dayTwo + 1000);
    rateRecallItem(secondSession, usage[1], "circle", dayTwo + 2000);
    const settledBeforeLapse = isSettled(usage[0]);
    const lapseSession = createRecallSession([usage[0]], { mode: "all", source: "usage" }, () => 0.5, dayTwo);
    rateRecallItem(lapseSession, usage[0], "triangle", dayTwo + 3000);
    rateRecallItem(lapseSession, usage[0], "circle", dayTwo + 4000);
    const unsettledAfterSameDayRetry = !isSettled(usage[0]);
    const verificationSession = createRecallSession([usage[0]], { mode: "all", source: "usage" }, () => 0.5, dayThree);
    rateRecallItem(verificationSession, usage[0], "circle", dayThree + 1000);
    const legacyLapseStats = normalizeRecallStats({
      successfulReviewDates: [reviewDateKey(dayOne), reviewDateKey(dayTwo)],
      lastRating: "cross",
      lastReviewedAt: new Date(dayTwo).toISOString()
    });
    const legacyLapseMigrated = legacyLapseStats.lastLapseDate === reviewDateKey(dayTwo) &&
      !isSettled({ recallStats: legacyLapseStats });
    return {
      passed: words.length === 2 && usage.length === 2 && usage[0].linkedWordIds.length === 2 &&
        unified.rows.length === 1 && unified.rows[0].examples.length === 1 && unified.rows[0].phrases.length === 1 &&
        memory.length === 1 && firstSession.finished && secondSession.finished && !settledAfterOneDay &&
        settledBeforeLapse && lapseSession.finished && unsettledAfterSameDayRetry && verificationSession.finished &&
        isSettled(usage[0]) && isSettled(usage[1]) && legacyLapseMigrated && usage[0].recallStats.cross === 1 &&
        estimateBytes({ usage, memory }) < 10000,
      wordCount: words.length,
      usageCount: usage.length,
      memoryCount: memory.length,
      estimatedBytes: estimateBytes({ usage, memory })
    };
  }

  window.MWContent = Object.freeze({
    parseWordRows,
    parseUnifiedRows,
    parseUsageRows,
    parseMemoryRows,
    makeUsageItems,
    makeMemoryItems,
    normalizeRangeContent,
    normalizeRecallStats,
    isSettled,
    createRecallSession,
    rateRecallItem,
    contentStats,
    estimateBytes,
    runContentSelfCheck
  });
})();

