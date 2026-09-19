/* Shared by the browser and Apps Script. No credentials or transport in this module. */
(function (root) {
  "use strict";
  const MAX_CHARS = 2 * 1024 * 1024;
  const fail = code => { throw new Error(code); };
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const id = value => typeof value === "string" && /^[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/.test(value);
  const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const fields = (names, type) => Object.fromEntries(names.split(" ").map(name => [name, type]));
  const numberMap = { $map: "number" };
  const stats = {
    ...fields("attempts correct incorrect consecutiveCorrect totalResponseMs slowCount hesitantCount instant unsure unknown circle triangle cross consecutiveCircle", "number"),
    ...fields("lastResult lastTestedAt lastTiming lastLapseAt lastConfusionAt lastRating lastReviewedAt lastSuccessfulReviewDate lastLapseDate lastAnswer lastAttemptedAt", "string"),
    successfulReviewDates: ["string"], successfulDates: ["string"], instantReviewDates: ["string"],
    wrongAnswers: ["string"], recentResponseMs: ["number"], confusedWith: numberMap
  };
  const allStats = { ...stats, enToJa: stats, jaToEn: stats };
  const variant = fields("id dictionarySource headword syllabifiedHeadword partOfSpeech label pronunciation audioId audioUrl", "string");
  const word = {
    ...fields("id sourceId word normalized mwUrl audioUrl audioId pronunciation syllabifiedHeadword partOfSpeech dictionarySource error studyStatus lastApiFetchedAt", "string"),
    cacheVersion: "number",
    ...fields("hasAudio hasDefinition apiFetched", "boolean"),
    meaningsJa: ["string"], acceptedSpellings: ["string"], definitions: ["string"], pronunciationVariants: [variant],
    testStats: allStats, spellingStats: allStats, speedStats: allStats
  };
  const item = { ...fields("id sourceId type label english japanese", "string"), linkedWordIds: ["string"], unresolvedRefs: ["string"], recallStats: allStats };
  const history = { ...fields("id direction mode startedAt finishedAt", "string"), ...fields("total correct accuracy averageResponseMs", "number"), categoryCorrect: numberMap, wrongWordIds: ["string"] };
  const range = { ...fields("id rangeName testDate materialType weekday pages deleteAt manualTestEndedDate currentWordId createdAt cacheClearedAt", "string"), words: [word], usageItems: [item], memoryItems: [item], testHistory: [history] };
  const count = { attempts: "number", correct: "number" };
  const schema = { schemaVersion: "number", ranges: [range], studyLog: { $map: { ...count, enToJa: count, jaToEn: count } } };
  function check(value, spec, depth = 0) {
    if (depth > 14) fail("MALFORMED");
    if (typeof spec === "string") {
      if (typeof value !== spec || (spec === "number" && (!Number.isFinite(value) || value < 0)) || (spec === "string" && value.length > 10000)) fail("MALFORMED");
    } else if (Array.isArray(spec)) {
      if (!Array.isArray(value) || value.length > 10000) fail("MALFORMED");
      value.forEach(entry => check(entry, spec[0], depth + 1));
    } else {
      if (!object(value)) fail("MALFORMED");
      Object.keys(value).forEach(key => {
        if (/^(?:__proto__|prototype|constructor)$/.test(key)) fail("MALFORMED");
        if (spec.$map) { if (!/^[A-Za-z0-9_-]{1,100}$/.test(key)) fail("MALFORMED"); check(value[key], spec.$map, depth + 1); }
        else { if (!Object.prototype.hasOwnProperty.call(spec, key)) fail("MALFORMED"); check(value[key], spec[key], depth + 1); }
      });
    }
  }
  function noSecrets(value, secrets = []) {
    const text = JSON.stringify(value);
    if (!text || text.length > MAX_CHARS + 2048) fail("SIZE");
    // Conservative: UUID-shaped MW keys and common credential/token forms are not study data.
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:gh[pousr]_|github_pat_|ya29\.)[A-Za-z0-9_.-]{10,}|-----BEGIN .*PRIVATE KEY|\bBearer\s+[A-Za-z0-9_.~+\/-]{8,}|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|https?:\/\/script\.google\.com\/macros\/|(?:api[_ -]?key|password|authorization|access[_ -]?token|refresh[_ -]?token)\s*["']?\s*[:=]/i.test(text)) fail("SECRET");
    for (const secret of secrets.filter(v => typeof v === "string" && v)) {
      if ([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)].some(v => text.includes(v))) fail("SECRET");
    }
    return value;
  }
  function validate(payload, secrets = []) {
    if (JSON.stringify(payload).length > MAX_CHARS) fail("SIZE");
    noSecrets(payload, secrets); check(payload, schema);
    if (payload.schemaVersion !== 3 || !Array.isArray(payload.ranges) || payload.ranges.length > 500 || !object(payload.studyLog)) fail("MALFORMED");
    const rangeIds = new Set(), wordIds = new Set();
    payload.ranges.forEach(r => {
      if (!r.id || rangeIds.has(r.id) || !Array.isArray(r.words) || r.words.length > 5000 || !Array.isArray(r.usageItems) || !Array.isArray(r.memoryItems) || !Array.isArray(r.testHistory)) fail("MALFORMED");
      rangeIds.add(r.id);
      r.words.forEach(w => { if (!w.id || wordIds.has(w.id) || !w.word || w.word.length > 100) fail("MALFORMED"); wordIds.add(w.id); });
      [...r.usageItems, ...r.memoryItems].forEach(i => { if (!i.id || !i.english || !i.japanese) fail("MALFORMED"); });
    });
    // Reuse the SAME storage canonicalizer on both sides, including field limits,
    // date/ID normalization, references and portable allowlists. Never silently truncate.
    let normalized;
    try { normalized = normalize(payload); } catch { fail("MALFORMED"); }
    if (canonical(normalized) !== canonical(payload)) fail("NON_CANONICAL");
    return payload;
  }
  function normalize(data) {
    const backup = root.MWStorage.createBackup(data, "2000-01-01T00:00:00.000Z");
    return { schemaVersion: 3, ranges: backup.ranges, studyLog: backup.studyLog };
  }
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (object(value)) return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    return JSON.stringify(value);
  }
  function request(value, secrets = [], envelopeOnly = false) {
    if (!object(value) || value.protocol !== 2 || !["connect", "push", "pull", "status", "cancel"].includes(value.op)) fail("MALFORMED");
    const allowed = value.op === "connect" ? ["protocol", "op"] : value.op === "push" ? ["protocol", "op", "datasetId", "requestId", "baseRevision", "baseHash", "payload"] : value.op === "pull" ? ["protocol", "op", "datasetId"] : ["protocol", "op", "datasetId", "requestId", "requestHash"];
    if (Object.keys(value).some(k => !allowed.includes(k))) fail("MALFORMED");
    if (value.op !== "connect" && !id(value.datasetId)) fail("MALFORMED");
    if (["push", "status", "cancel"].includes(value.op) && !id(value.requestId)) fail("MALFORMED");
    if (value.op === "push" && (!integer(value.baseRevision) || !hash(value.baseHash))) fail("MALFORMED");
    if (["status", "cancel"].includes(value.op) && !hash(value.requestHash)) fail("MALFORMED");
    if (envelopeOnly) return value;
    noSecrets(value, secrets); // Complete packet, not just payload.
    if (value.op === "push") validate(value.payload, secrets);
    return value;
  }
  async function digest(value) {
    const bytes = await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  }
  root.MWSyncProtocol = Object.freeze({ validate, normalize, noSecrets, canonical, request, integer, id, hash, digest, MAX_CHARS });
})(typeof window !== "undefined" ? window : globalThis);
