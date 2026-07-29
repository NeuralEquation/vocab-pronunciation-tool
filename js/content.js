(() => {
  "use strict";

  const VALID_USAGE_TYPES = new Set(["example", "phrase"]);
  const VALID_RATINGS = new Set(["circle", "triangle", "cross"]);

  const clean = value => String(value ?? "").trim();
  const unique = values => [...new Set(values.filter(Boolean))];
  const splitJapanese = value => unique(clean(value).split(/[／/、;；]+/).map(clean));
  const defaultStats = () => ({
    attempts: 0,
    circle: 0,
    triangle: 0,
    cross: 0,
    consecutiveCircle: 0,
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
        return;
      }
      rows.push({
        sourceId: sourceId || `M${String(index + 1).padStart(3, "0")}`,
        label,
        english,
        japanese
      });
    });
    return { rows, invalid };
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
    if (!VALID_RATINGS.has(stats.lastRating)) stats.lastRating = "";
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
    return item.recallStats?.consecutiveCircle >= 2 && item.recallStats?.lastRating === "circle";
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
    stats.lastRating = rating;
    stats.lastReviewedAt = new Date(now).toISOString();
    session.assessments.push({ itemId: item.id, rating, reviewedAt: stats.lastReviewedAt });
    if (rating !== "circle") session.queue.push(item.id);
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
    const session = createRecallSession(usage, { mode: "all", source: "usage" }, () => 0.5, 1000);
    rateRecallItem(session, usage[0], "cross", 2000);
    rateRecallItem(session, usage[1], "circle", 3000);
    rateRecallItem(session, usage[0], "circle", 4000);
    return {
      passed: words.length === 2 && usage.length === 2 && usage[0].linkedWordIds.length === 2 &&
        memory.length === 1 && session.finished && usage[0].recallStats.cross === 1 &&
        estimateBytes({ usage, memory }) < 10000,
      wordCount: words.length,
      usageCount: usage.length,
      memoryCount: memory.length,
      estimatedBytes: estimateBytes({ usage, memory })
    };
  }

  window.MWContent = Object.freeze({
    parseWordRows,
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
