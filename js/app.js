var {
  createTestSession, renderTestQuestion, answerTestQuestion, finishTest, abortTest,
  analyzeSpellingRisk, createSpeedReviewSession, restartSpeedReviewSession, rateSpeedReviewWord,
  defaultDirectionStats, normalizeDirectionStats, applyDirectionAttempt,
  normalizeSpellingStats, evaluateSpellingAnswer, createSpellingSession, answerSpellingQuestion,
  finishSpellingSession, applySpellingAttempt, selectTestReadyItems,
  readinessForRange: wordReadinessForRange, runTestFeatureSelfCheck
} = window.MWTest;
window.runTestFeatureSelfCheck = runTestFeatureSelfCheck;
var { parseUnifiedRows, parseMemoryRows, makeUsageItems, makeMemoryItems, normalizeRangeContent, isSettled, createRecallSession, rateRecallItem, contentStats, runContentSelfCheck } = window.MWContent;
window.runContentFeatureSelfCheck = runContentSelfCheck;
var { SCHEMA_VERSION: STORAGE_SCHEMA_VERSION, APP_VERSION, migrateBackup, parseBackup, planImport, createBackup, runStorageSelfCheck } = window.MWStorage;
window.runStorageSelfCheck = runStorageSelfCheck;

    (() => {
      "use strict";

      const STORAGE_KEY = "mwPronunciationTool.v1";
      const PRE_SUPERAPP_BACKUP_KEY = "mwPronunciationTool.preSuperappBackup.v1";
      const PRE_IMPORT_BACKUP_KEY = "mwPronunciationTool.preImportBackup.v1";
      const API_USAGE_KEY = "mwPronunciationTool.apiUsage.v1";
      const API_KEY_KEY = "mwPronunciationTool.apiKey.v1";
      const COLLEGIATE_API_KEY_KEY = "mwPronunciationTool.collegiateApiKey.v1";
      const CACHE_SCHEMA_VERSION = 7;
      const TEST_WORD_LIMIT = 3;
      const READY_EVIDENCE_MAX_AGE_DAYS = 14;
      const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

      const demoData = {
        example: { prs: "ɪgˈzæmpəl", sound: "exampl01", fl: "noun", defs: ["something chosen to show what a group is like", "a person or way of behaving that should be copied"] },
        audio: { prs: "ˈɑːdiˌoʊ", sound: "audio001", fl: "adjective", defs: ["relating to sound that is heard or recorded"] },
        pronunciation: { prs: "prəˌnʌnsiˈeɪʃən", sound: "pronun02", fl: "noun", defs: ["the way in which a word or name is pronounced"] },
        apple: { prs: "ˈæpəl", sound: "apple001", fl: "noun", defs: ["a round fruit with red, yellow, or green skin and firm white flesh"] },
        science: { prs: "ˈsaɪəns", sound: "scienc02", fl: "noun", defs: ["knowledge about or study of the natural world based on facts learned through experiments"] },
        diligent: { prs: "ˈdɪlɪdʒənt", sound: "dilige01", fl: "adjective", defs: ["showing care and effort in your work or duties"] },
        record: {
          defs: ["a written account of something", "to write down information for future use"],
          variants: [
            { prs: "ˈrekərd", sound: "record01", fl: "noun", label: "" },
            { prs: "rɪˈkɔːrd", sound: "record02", fl: "verb", label: "" }
          ]
        }
      };

      const state = {
        ranges: [],
        settings: { demoMode: true, saveKey: false, apiKeySession: "", collegiateApiKeySession: "", dictionaryType: "learners", definitionLimit: 2, studyFilter: "all", playbackInterval: 2, usageReviewExtraSeconds: 5, mondayEndTime: "", wednesdayEndTime: "", fridayEndTime: "" },
        studyLog: {},
        fetchingRangeId: "",
        selectedRangeId: null,
        lastImportWords: [],
        activeTest: null,
        speedSession: null,
        spellingSession: null,
        spellingFeedback: null,
        spellingResult: null,
        recallSession: null,
        usageStudySession: null,
        wordStudySession: null,
        speedMeaningVisible: false,
        speedUsageVisible: false,
        pendingWordScroll: false,
        temporaryWordIds: null,
        savedFilterBeforeTemporary: null
      };

      const playbackState = {
        active: false,
        currentAudio: null,
        timerId: null,
        rangeId: "",
        wordIds: [],
        currentIndex: 0,
        currentWordId: "",
        paused: false,
        phase: "idle"
      };
      let previewAudio = null;
      let lastAutoSpokenSpeedKey = "";
      let lastAutoSpokenUsageKey = "";
      let lastAutoSpokenStudyWordKey = "";

      const $ = (id) => document.getElementById(id);

      function uid(prefix) {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      }

      function todayKey() {
        return localDateString(new Date());
      }

      function localDateString(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }

      function localDateTimeString(date) {
        const ymd = localDateString(date);
        const h = String(date.getHours()).padStart(2, "0");
        const m = String(date.getMinutes()).padStart(2, "0");
        return `${ymd}T${h}:${m}`;
      }

      function splitMeanings(text) {
        return [...new Set(String(text || "").split(/[／/、;；]+/).map(value => value.trim()).filter(Boolean))];
      }

      function parseWords(text) {
        const seen = new Set();
        let duplicates = 0;
        let invalid = 0;
        const words = [];
        text.split(/\r?\n/).flatMap(line => line.includes("\t") ? [line] : line.split(/[\s,、]+/)).map(w => w.trim()).filter(Boolean).forEach(entry => {
          const [raw, ...meaningParts] = entry.split("\t");
          const cleaned = raw.replace(/^[^A-Za-z'-]+|[^A-Za-z'-]+$/g, "");
          if (!/^[A-Za-z][A-Za-z'-]{0,39}$/.test(cleaned)) {
            invalid++;
            return;
          }
          const normalized = cleaned.toLowerCase();
          if (seen.has(normalized)) {
            duplicates++;
            return;
          }
          seen.add(normalized);
          words.push({ raw: cleaned, normalized, meaningsJa: splitMeanings(meaningParts.join("／")) });
        });
        return { words, duplicates, invalid };
      }

      function emptyDirectionStats() {
        return defaultDirectionStats();
      }

      function defaultSpeedStats() {
        return { attempts: 0, instant: 0, unsure: 0, unknown: 0, lastRating: "", lastReviewedAt: "", totalResponseMs: 0, successfulReviewDates: [], lastLapseAt: "" };
      }

      function normalizeSpeedProfile(value) {
        const stats = { ...defaultSpeedStats(), ...(value && typeof value === "object" ? value : {}) };
        ["attempts", "instant", "unsure", "unknown", "totalResponseMs"].forEach(key => { stats[key] = Math.max(0, Number(stats[key]) || 0); });
        if (!["instant", "unsure", "unknown"].includes(stats.lastRating)) stats.lastRating = "";
        stats.successfulReviewDates = [...new Set((Array.isArray(stats.successfulReviewDates) ? stats.successfulReviewDates : []).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))].slice(-20);
        stats.lastReviewedAt = typeof stats.lastReviewedAt === "string" ? stats.lastReviewedAt : "";
        stats.lastLapseAt = typeof stats.lastLapseAt === "string" ? stats.lastLapseAt : "";
        return stats;
      }

      function normalizeSpeedStats(value) {
        const nested = value && typeof value === "object" && (value.enToJa || value.jaToEn);
        return {
          enToJa: normalizeSpeedProfile(nested ? value.enToJa : value),
          jaToEn: normalizeSpeedProfile(nested ? value.jaToEn : null)
        };
      }

      function createWord(raw, normalized, meaningsJa = []) {
        return {
          id: uid("word"),
          word: raw,
          normalized,
          pronunciation: "",
          audioId: "",
          audioUrl: "",
          pronunciationVariants: [],
          mwUrl: dictionaryUrl(normalized),
          dictionarySource: "",
          partOfSpeech: "",
          definitions: [],
          hasDefinition: false,
          cacheVersion: 0,
          apiFetched: false,
          hasAudio: false,
          lastApiFetchedAt: "",
          error: "",
          studyStatus: "unrated",
          meaningsJa,
          acceptedSpellings: [],
          testStats: { enToJa: emptyDirectionStats(), jaToEn: emptyDirectionStats() },
          spellingStats: normalizeSpellingStats(),
          speedStats: normalizeSpeedStats()
        };
      }

      function dictionaryUrl(word) {
        return `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`;
      }

      function audioUrlFromId(audioId) {
        if (!audioId) return "";
        let subdir = audioId.charAt(0);
        if (audioId.startsWith("bix")) subdir = "bix";
        if (audioId.startsWith("gg")) subdir = "gg";
        if (/^[0-9_]/.test(audioId)) subdir = "number";
        return `https://media.merriam-webster.com/audio/prons/en/us/mp3/${subdir}/${encodeURIComponent(audioId)}.mp3`;
      }

      function pronunciationText(pron, reference) {
        if (!pron) return "";
        return reference === "learners" ? (pron.ipa || pron.mw || "") : (pron.mw || pron.ipa || "");
      }

      function cleanHeadword(value) {
        return String(value || "").replace(/\*/g, "").trim();
      }

      function normalizePronunciationVariant(variant, fallback = {}) {
        const audioId = String(variant?.audioId || variant?.sound?.audio || "");
        return {
          id: variant?.id || uid("pron"),
          dictionarySource: variant?.dictionarySource || fallback.dictionarySource || "",
          headword: cleanHeadword(variant?.headword || fallback.headword || ""),
          partOfSpeech: variant?.partOfSpeech || fallback.partOfSpeech || "",
          label: String(variant?.label || fallback.label || ""),
          pronunciation: String(variant?.pronunciation || ""),
          audioId,
          audioUrl: variant?.audioUrl || audioUrlFromId(audioId)
        };
      }

      function dedupePronunciationVariants(variants) {
        const seen = new Set();
        return variants.map(variant => normalizePronunciationVariant(variant)).filter(variant => {
          if (!variant.pronunciation && !variant.audioId && !variant.audioUrl) return false;
          const key = [variant.partOfSpeech, variant.pronunciation, variant.audioId, variant.label].join("\u0001").toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function preferredPronunciationVariant(word, reference = state.settings.dictionaryType || "learners") {
        const variants = Array.isArray(word?.pronunciationVariants) ? word.pronunciationVariants : [];
        const target = normalizeLookupText(word?.normalized || word?.word || "");
        return variants.reduce((best, variant, index) => {
          const score = (variant.audioUrl ? 100 : 0)
            + (variant.dictionarySource === reference ? 20 : 0)
            + (normalizeLookupText(variant.headword) === target ? 10 : 0)
            - index / 1000;
          return !best || score > best.score ? { variant, score } : best;
        }, null)?.variant || null;
      }

      function syncLegacyPronunciationFields(word, reference = state.settings.dictionaryType || "learners") {
        word.pronunciationVariants = dedupePronunciationVariants(word.pronunciationVariants || []);
        const preferred = preferredPronunciationVariant(word, reference);
        word.pronunciation = preferred?.pronunciation || "";
        word.audioId = preferred?.audioId || "";
        word.audioUrl = preferred?.audioUrl || "";
        word.partOfSpeech = preferred?.partOfSpeech || "";
        word.hasAudio = word.pronunciationVariants.some(variant => Boolean(variant.audioUrl));
        return preferred;
      }

      function getApiKey(reference = "learners") {
        if (reference === "collegiate") {
          return cleanApiKey(state.settings.saveKey ? localStorage.getItem(COLLEGIATE_API_KEY_KEY) || "" : state.settings.collegiateApiKeySession || "");
        }
        return cleanApiKey(state.settings.saveKey ? localStorage.getItem(API_KEY_KEY) || "" : state.settings.apiKeySession || "");
      }

      function cleanApiKey(value) {
        const text = String(value || "").trim();
        if (!text) return "";
        try {
          const url = new URL(text);
          const key = url.searchParams.get("key");
          if (key) return key.trim();
        } catch {
          // Not a URL; continue with plain text cleanup.
        }
        const keyMatch = text.match(/[?&]key=([^&\s]+)/i) || text.match(/^key=([^&\s]+)/i);
        if (keyMatch) return decodeURIComponent(keyMatch[1]).trim();
        return text;
      }

      function dictionaryLabel(reference) {
        if (!reference) return "";
        return reference === "collegiate" ? "Collegiate Dictionary" : "Learner's Dictionary";
      }

      function load() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            if (!localStorage.getItem(PRE_SUPERAPP_BACKUP_KEY) && new Blob([raw]).size < 1.5 * 1024 * 1024) {
              localStorage.setItem(PRE_SUPERAPP_BACKUP_KEY, raw);
            }
            const migrated = parseBackup(raw);
            if (!migrated.ok) throw new Error(migrated.errors.join(" "));
            state.settings = { ...state.settings, ...migrated.data.settings };
            state.studyLog = migrated.data.studyLog;
            state.ranges = migrated.data.ranges;
            normalizeLoadedData();
            const savedSelectedRangeId = String(migrated.data.ui?.selectedRangeId || "");
            state.selectedRangeId = state.ranges.some(range => range.id === savedSelectedRangeId) ? savedSelectedRangeId : null;
            state.pendingWordScroll = Boolean(state.selectedRangeId);
          }
          if (state.settings.saveKey) {
            $("apiKey").value = localStorage.getItem(API_KEY_KEY) || "";
            $("collegiateApiKey").value = localStorage.getItem(COLLEGIATE_API_KEY_KEY) || "";
          }
          $("demoMode").checked = state.settings.demoMode;
          $("saveKey").checked = state.settings.saveKey;
          $("dictionaryType").value = state.settings.dictionaryType;
          $("definitionLimit").value = String(state.settings.definitionLimit);
          $("wordFilter").value = state.settings.studyFilter;
          $("playbackInterval").value = String(state.settings.playbackInterval);
          $("usageReviewExtraSeconds").value = String(state.settings.usageReviewExtraSeconds);
          $("mondayEndTime").value = state.settings.mondayEndTime;
          $("wednesdayEndTime").value = state.settings.wednesdayEndTime;
          $("fridayEndTime").value = state.settings.fridayEndTime;
        } catch (err) {
          toast("保存データの読み込みに失敗しました。JSONの破損があるかもしれません。");
        }
      }

      function save(shouldRender = true) {
        try {
          const savedAt = new Date().toISOString();
          const payload = createBackup({
            settings: state.settings,
            ranges: state.ranges,
            studyLog: state.studyLog,
            ui: { selectedRangeId: state.selectedRangeId || "" }
          }, savedAt);
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, savedAt }));
          if (shouldRender) render();
          return true;
        } catch (err) {
          toast("保存に失敗しました。容量が近い可能性があります。JSONエクスポート後、APIキャッシュ削除を検討してください。", true);
          return false;
        }
      }

      function normalizeLoadedData() {
        state.ranges.forEach(range => {
          range.words = Array.isArray(range.words) ? range.words : [];
          delete range.material;
          delete range.memo;
          range.testHistory = Array.isArray(range.testHistory) ? range.testHistory.slice(-30) : [];
          if (range.manualTestEndedDate && range.manualTestEndedDate !== todayKey()) range.manualTestEndedDate = "";
          range.words.forEach(word => {
            word.id = word.id || uid("word");
            word.normalized = word.normalized || String(word.word || "").toLowerCase();
            if (!["unrated", "hard", "known"].includes(word.studyStatus)) {
              if (word.hard === true) word.studyStatus = "hard";
              else if (word.checked === true) word.studyStatus = "known";
              else word.studyStatus = "unrated";
            }
            word.dictionarySource = word.dictionarySource || "";
            word.partOfSpeech = word.partOfSpeech || "";
            word.pronunciationVariants = Array.isArray(word.pronunciationVariants) ? word.pronunciationVariants : [];
            if (!word.pronunciationVariants.length && (word.pronunciation || word.audioUrl || word.partOfSpeech)) {
              word.pronunciationVariants.push({
                id: uid("pron"),
                dictionarySource: word.dictionarySource || "",
                headword: word.word || "",
                partOfSpeech: word.partOfSpeech || "",
                label: "",
                pronunciation: word.pronunciation || "",
                audioId: word.audioId || "",
                audioUrl: word.audioUrl || ""
              });
            }
            word.pronunciationVariants = dedupePronunciationVariants(word.pronunciationVariants);
            word.definitions = Array.isArray(word.definitions) ? word.definitions : [];
            word.meaningsJa = Array.isArray(word.meaningsJa) ? word.meaningsJa.map(String).filter(Boolean) : [];
            word.testStats = word.testStats && typeof word.testStats === "object" ? word.testStats : {};
            ["enToJa", "jaToEn"].forEach(direction => { word.testStats[direction] = normalizeDirectionStats(word.testStats[direction]); });
            word.acceptedSpellings = [...new Set((Array.isArray(word.acceptedSpellings) ? word.acceptedSpellings : []).map(value => String(value).trim()).filter(Boolean))];
            word.spellingStats = normalizeSpellingStats(word.spellingStats);
            word.speedStats = normalizeSpeedStats(word.speedStats);
            word.hasDefinition = Boolean(word.hasDefinition || word.definitions.length);
            word.cacheVersion = Number(word.cacheVersion) || 0;
            word.mwUrl = word.mwUrl || dictionaryUrl(word.normalized || word.word || "");
            syncLegacyPronunciationFields(word, word.dictionarySource || state.settings.dictionaryType);
            ["checked", "hard", "play" + "Count", "last" + "CheckedAt"].forEach(key => delete word[key]);
          });
          const savedWordExists = range.words.some(word => word.id === range.currentWordId);
          range.currentWordId = savedWordExists ? range.currentWordId : range.words[0]?.id || "";
          normalizeRangeContent(range, uid);
        });
      }

      function usageRecord() {
        try {
          const usage = JSON.parse(localStorage.getItem(API_USAGE_KEY) || "{}");
          if (usage.date !== todayKey()) return { date: todayKey(), count: 0 };
          return { date: usage.date, count: Number(usage.count) || 0 };
        } catch {
          return { date: todayKey(), count: 0 };
        }
      }

      function setUsage(count) {
        localStorage.setItem(API_USAGE_KEY, JSON.stringify({ date: todayKey(), count }));
      }

      function incrementUsage(by) {
        const usage = usageRecord();
        setUsage(usage.count + by);
      }

      function storageBytes() {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const value = localStorage.getItem(key) || "";
          total += new Blob([key + value]).size;
        }
        return total;
      }

      function formatBytes(bytes) {
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
      }

      function deleteAtFor(testDate, weekdayValue) {
        const base = testDate ? new Date(`${testDate}T12:00:00`) : new Date();
        const day = weekdayValue || weekdays[base.getDay()];
        const add = day === "月" || day === "水" ? 1 : 1;
        const d = new Date(base);
        d.setDate(d.getDate() + add);
        d.setHours(21, 0, 0, 0);
        return localDateTimeString(d);
      }

      function validateTestDate(showMessage = false) {
        const input = $("testDate");
        const feedback = $("dateValidation");
        const materialType = $("rangeKind").value;
        const value = input.value;
        input.setCustomValidity("");
        feedback.textContent = "";
        $("weekday").value = "";
        if (!value) {
          const message = "テスト日を入力してください。";
          input.setCustomValidity(message);
          feedback.textContent = message;
          if (showMessage) {
            input.reportValidity();
            toast(message, true);
          }
          return false;
        }
        const day = new Date(`${value}T12:00:00`).getDay();
        const allowed = materialType === "memorization" ? [5] : [1, 3];
        if (!allowed.includes(day)) {
          const message = materialType === "memorization"
            ? "暗記構文のテスト日は金曜日を選んでください。"
            : "英単語テストの日付は月曜日または水曜日を選んでください。";
          input.setCustomValidity(message);
          feedback.textContent = message;
          if (showMessage) {
            input.reportValidity();
            toast(message, true);
          }
          return false;
        }
        $("weekday").value = weekdays[day];
        feedback.textContent = `${weekdays[day]}曜日として登録します。`;
        return true;
      }

      function statusForRange(range, nextId) {
        if (!range.words.length && !range.memoryItems?.length) return "教材未登録";
        const now = new Date();
        const today = localDateString(now);
        const deleteAt = range.deleteAt ? new Date(range.deleteAt) : null;
        if (range.cacheClearedAt) return "キャッシュ削除済み";
        if (deleteAt && now >= deleteAt) return "削除予定";
        if (range.testDate === today) return isRangeEnded(range, now) ? "終了" : "今日の範囲";
        if (range.id === nextId) return "次回の範囲";
        if (range.testDate && range.testDate > today) return "待機中";
        if (range.testDate && range.testDate < today) return "終了";
        return "待機中";
      }

      function nextRangeId() {
        const today = localDateString(new Date());
        const candidates = state.ranges
          .filter(r => (r.words.length || r.memoryItems?.length) && r.testDate >= today && !(r.testDate === today && isRangeEnded(r, new Date())))
          .sort((a, b) => a.testDate.localeCompare(b.testDate));
        return candidates[0]?.id || "";
      }

      function statsForRange(range) {
        const words = range.words || [];
        const readiness = range.materialType === "memorization" ? null : readinessForRange(range);
        const total = words.length;
        const fetched = words.filter(w => isCacheCurrent(w, w.dictionarySource || state.settings.dictionaryType || "learners")).length;
        const audio = words.filter(w => w.hasAudio).length;
        const noAudio = words.filter(w => w.apiFetched && !w.hasAudio).length;
        const definitions = words.filter(w => w.hasDefinition).length;
        const hard = words.filter(w => w.studyStatus === "hard").length;
        const riskyIds = new Set(readiness?.riskItems?.map(item => item.wordId) || []);
        const known = words.filter(w => !riskyIds.has(w.id) && w.studyStatus === "known").length;
        const unseen = words.filter(w => !(w.testStats?.enToJa?.attempts || 0) && !(w.testStats?.jaToEn?.attempts || 0)).length;
        const unsettled = readiness?.riskItems?.length ?? words.filter(w => w.studyStatus !== "known").length;
        return { total, fetched, audio, noAudio, definitions, hard, known, unseen, unsettled, pct: total ? Math.round(fetched / total * 100) : 0, learningPct: total ? Math.round(known / total * 100) : 0, ...contentStats(range) };
      }

      function recallReadyForTest(item, now = Date.now()) {
        if (!isSettled(item)) return false;
        const dates = Array.isArray(item?.recallStats?.successfulReviewDates) ? item.recallStats.successfulReviewDates : [];
        const latest = [...dates].sort().at(-1);
        if (!latest) return false;
        const today = localDateString(new Date(now));
        const latestAt = new Date(`${latest}T12:00:00`).getTime();
        const todayAt = new Date(`${today}T12:00:00`).getTime();
        const ageDays = Math.round((todayAt - latestAt) / 86400000);
        return ageDays >= 0 && ageDays <= READY_EVIDENCE_MAX_AGE_DAYS;
      }

      function readinessForRange(range) {
        const content = contentStats(range);
        if (range.materialType === "memorization") {
          const finalMistakes = (range.memoryItems || []).filter(item => ["triangle", "cross"].includes(item.recallStats?.lastRating)).length;
          const memoryRisk = (range.memoryItems || []).filter(item => !recallReadyForTest(item)).length;
          const checks = [
            { key: "memory", label: "暗記構文未定着・14日以内未確認", count: memoryRisk },
            { key: "memoryMistakes", label: "最終確認ミス", count: finalMistakes }
          ];
          const ready = content.memoryTotal > 0 && checks.every(check => check.count === 0);
          return { ready, status: ready ? "safe" : content.memoryTotal ? "risk" : "unverified", checks, riskItems: [] };
        }
        const words = range.words || [];
        const wordReadiness = wordReadinessForRange(range, Date.now());
        const usageItems = range.usageItems || [];
        const contentChecks = [
          { key: "examples", label: "例文未定着・14日以内未確認", count: usageItems.filter(item => item.type === "example" && !recallReadyForTest(item)).length },
          { key: "phrases", label: "熟語未定着・14日以内未確認", count: usageItems.filter(item => item.type === "phrase" && !recallReadyForTest(item)).length }
        ];
        const checks = [...(wordReadiness.checks || []), ...contentChecks];
        const contentRisk = contentChecks.some(check => check.count > 0);
        const ready = words.length > 0 && wordReadiness.status === "safe" && !contentRisk;
        const status = ready ? "safe" : wordReadiness.status === "unverified" || !words.length ? "unverified" : "risk";
        return { ...wordReadiness, ready, status, checks };
      }

      function isRangeEnded(range, now = new Date()) {
        if (range.manualTestEndedDate === localDateString(now)) return true;
        if (range.testDate !== localDateString(now)) return false;
        const endTimeKey = { 1: "mondayEndTime", 3: "wednesdayEndTime", 5: "fridayEndTime" }[now.getDay()];
        const endTime = endTimeKey ? state.settings[endTimeKey] : "";
        const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        return Boolean(endTime && currentTime >= endTime);
      }
      function learningPlan(now = new Date()) {
        const today = localDateString(now);
        const vocabRanges = state.ranges.filter(r => r.materialType !== "memorization");
        const endedToday = vocabRanges.find(r => r.words?.length && r.testDate === today && isRangeEnded(r, now)) || null;
        const future = vocabRanges.filter(r => r.words?.length && r.testDate && (r.testDate > today || (r.testDate === today && !isRangeEnded(r, now)))).sort((a,b) => a.testDate.localeCompare(b.testDate));
        const primary = endedToday || future[0] || null, preview = endedToday ? (future[0] || null) : (future[1] || null);
        const memory = state.ranges.filter(r => r.materialType === "memorization" && r.memoryItems?.length && r.testDate && (r.testDate > today || (r.testDate === today && !isRangeEnded(r, now)))).sort((a,b) => a.testDate.localeCompare(b.testDate))[0] || null;
        const day = now.getDay(), todayTest = primary?.testDate === today;
        const mode = endedToday ? "wrong" : "normal";
        const reason = endedToday ? "今日のテスト時間は終了しました。間違えた単語を復習し、次回の範囲を少し先取りしましょう。" : todayTest ? "テスト当日のため、未確認・苦手単語を優先します。" : "次回テストに向けて未出題・苦手単語を優先します。";
        return { primary, preview, memory, mode, reason, friday: day === 5, endedToday };
      }
      function rangePlanHtml(label, range, now) {
        if (!range) return `<div class="plan-card"><strong>${label}</strong><span class="meta">対象範囲はありません</span></div>`;
        const s = statsForRange(range);
        const readiness = readinessForRange(range);
        const days = Math.max(0, Math.ceil((new Date(`${range.testDate}T00:00:00`) - new Date(`${localDateString(now)}T00:00:00`)) / 86400000));
        return `<div class="plan-card"><strong>${label}: ${escapeHtml(range.rangeName || "無題の範囲")}</strong><div class="meta">${escapeHtml(range.testDate || "日付未設定")} / あと${days}日 / ${s.total}語</div><div class="readiness-state ${readiness.status}">${readinessLabel(readiness)}</div>${readinessChecksHtml(readiness)}</div>`;
      }
      function renderTodayStudy() {
        const now = new Date(), plan = learningPlan(now);
        const memoryStats = plan.memory ? contentStats(plan.memory) : null;
        $("todayStudyPanel").innerHTML = `<h3>次の小テストを満点まで仕上げる</h3><p>${escapeHtml(plan.reason)}</p>${plan.endedToday ? `<div class="caution">今日落とした項目は、次の範囲より先に確認します。</div>` : ""}${plan.memory ? `<div class="caution">暗記構文「${escapeHtml(plan.memory.rangeName)}」: 未定着 ${memoryStats.memoryUnsettled}/${memoryStats.memoryTotal}件</div>` : ""}<div class="plan-grid">${rangePlanHtml(plan.endedToday ? "今日の取りこぼし" : "最優先", plan.primary, now)}${rangePlanHtml("次の範囲", plan.preview, now)}</div><div class="actions"><select id="todayDirection"><option value="enToJa">英語 → 日本語</option><option value="jaToEn">日本語 → 英語</option></select><button class="primary" id="startTodayStudy" ${plan.primary ? "" : "disabled"}>危険単語を満点確認</button><button class="soft" id="startTodayNormal" ${plan.primary ? "" : "disabled"}>通常15問</button>${plan.memory ? `<button class="primary" id="startTodayMemory">暗記構文を始める</button>` : ""}</div>`;
        $("startTodayStudy")?.addEventListener("click", () => { state.selectedRangeId = plan.primary.id; startTestReadyReview($("todayDirection").value); });
        $("startTodayNormal")?.addEventListener("click", () => { state.selectedRangeId = plan.primary.id; startTest($("todayDirection").value, "normal"); });
        $("startTodayMemory")?.addEventListener("click", () => { state.selectedRangeId = plan.memory.id; startRecall("memory", "unsettled"); });
      }

      function render() {
        const usage = usageRecord();
        const bytes = storageBytes();
        $("usageToday").textContent = usage.count;
        $("storageSize").textContent = formatBytes(bytes);
        $("rangeCount").textContent = state.ranges.length;
        renderStorageWarning(bytes);
        renderTodayStudy();
        renderRanges();
        if (state.selectedRangeId && currentTab() === "ranges") renderWords();
      }

      function renderStorageWarning(bytes) {
        const mb = bytes / 1024 / 1024;
        const root = $("storageWarning");
        if (mb >= 4) root.innerHTML = `<div class="danger-note">保存使用量が4MBを超えています。エクスポートとAPIキャッシュ削除をおすすめします。</div>`;
        else if (mb >= 3) root.innerHTML = `<div class="caution">保存使用量が3MBを超えています。不要なAPIキャッシュを削除すると軽くなります。</div>`;
        else if (mb >= 2) root.innerHTML = `<div class="caution">保存使用量が2MBを超えました。スマホでは容量に注意してください。</div>`;
        else root.innerHTML = "";
      }

      function readinessLabel(readiness) {
        if (readiness.status === "safe") return "✓ 満点準備OK";
        if (readiness.status === "risk") return `⚠ 危険 ${readiness.riskItems?.length || 0}語`;
        return "未検証項目あり";
      }

      function readinessChecksHtml(readiness) {
        const checks = (readiness.checks || []).filter(check => check.count > 0);
        if (!checks.length) return "";
        return `<div class="readiness-checks">${checks.map(check => `<span class="open">${escapeHtml(check.label)} ${check.count}</span>`).join("")}</div>`;
      }

      function renderRanges() {
        const filter = $("rangeFilter").value;
        const nextId = nextRangeId();
        let ranges = state.ranges.map(r => ({ ...r, status: statusForRange(r, nextId) }));
        if (filter !== "all") ranges = ranges.filter(r => r.status === filter);
        ranges.sort((a, b) => (a.testDate || "9999").localeCompare(b.testDate || "9999"));
        if (!ranges.length) {
          $("rangeList").innerHTML = `<div class="empty">範囲がありません。登録タブから範囲枠または単語リストを追加できます。</div>`;
          return;
        }
        $("rangeList").innerHTML = ranges.map(range => {
          const s = statsForRange(range);
          const readiness = readinessForRange(range);
          const isMemory = range.materialType === "memorization";
          const statusClass = range.status === "今日の範囲" ? "today" : range.status === "次回の範囲" ? "next" : "";
          const badgeClass = range.status === "削除予定" ? "danger" : range.status === "今日の範囲" || range.status === "次回の範囲" ? "ok" : "warn";
          return `
            <article class="range-card ${statusClass}">
              <div class="range-head">
                <div>
                  <div class="range-title">${escapeHtml(range.rangeName || "無題の範囲")}</div>
                  <div class="meta">${isMemory ? "暗記構文" : "英単語"} / ${escapeHtml(range.testDate || "日付未設定")} ${escapeHtml(range.weekday || "")}</div>
                </div>
                <span class="badge ${badgeClass}">${range.status}</span>
              </div>
              <div class="meta">${isMemory ? `未定着 ${s.memoryUnsettled}/${s.memoryTotal}件` : `学習定着率 ${s.learningPct}% / API取得率 ${s.pct}%`}</div>${isMemory ? "" : `<div class="progress" aria-label="API取得率"><span style="width:${s.pct}%"></span></div>`}
              <div class="readiness-summary">
                <div class="readiness-state ${readiness.status}">${readinessLabel(readiness)}</div>
                ${readinessChecksHtml(readiness)}
              </div>
              <div class="mini-grid">
                ${isMemory ? `<div class="mini"><strong>${s.memoryTotal}</strong>構文</div><div class="mini"><strong>${s.memoryUnsettled}</strong>未定着</div>` : `<div class="mini"><strong>${s.total}</strong>単語</div><div class="mini"><strong>${s.examples}</strong>例文</div><div class="mini"><strong>${s.phrases}</strong>熟語</div><div class="mini"><strong>${s.hard}</strong>苦手</div><div class="mini"><strong>${s.usageUnsettled}</strong>例文等未定着</div>`}
              </div>
              <div class="actions" style="margin-top:10px">
                <button class="primary" data-action="open" data-id="${escapeHtml(range.id)}">開く</button>
                ${isMemory ? "" : `<button class="warn" data-action="ready" data-id="${escapeHtml(range.id)}">満点確認</button>`}
                ${isMemory ? "" : `<button class="soft" data-action="fetch" data-id="${escapeHtml(range.id)}" ${s.total ? "" : "disabled"}>APIで取得</button>`}
                ${range.testDate === todayKey() ? (isRangeEnded(range) ? `<button class="soft" data-action="test-before" data-id="${escapeHtml(range.id)}">テスト前</button>` : `<button class="soft" data-action="test-ended" data-id="${escapeHtml(range.id)}">テスト終了</button>`) : ""}
              </div>
              <div class="danger-actions">
                <button class="compact refetch" data-action="clear-cache" data-id="${escapeHtml(range.id)}">キャッシュ削除</button>
                <button class="compact collegiate" data-action="delete-range" data-id="${escapeHtml(range.id)}">範囲削除</button>
              </div>
            </article>`;
        }).join("");
      }

      function renderSpellingRisk(word) {
        const risk = analyzeSpellingRisk(word.word);
        if (risk.level !== "high" || !risk.reasons.length) return "";
        return `<div class="spelling-risk high"><strong>スペル注意 高</strong><span>${escapeHtml(risk.reasons.join("・"))}</span></div>`;
      }

      function renderLinkedUsage(range, wordId) {
        const items = (range.usageItems || []).filter(item => item.linkedWordIds.includes(wordId));
        if (!items.length) return "";
        const open = playbackState.active && playbackState.currentWordId === wordId ? " open" : "";
        return `<details class="linked-usage" data-linked-usage-word="${escapeHtml(wordId)}"${open}><summary>例文・熟語 ${items.length}件</summary>${items.map(item => `<div class="linked-usage-item"><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span><strong>${escapeHtml(item.english)}</strong><span>${escapeHtml(item.japanese)}</span></div>`).join("")}</details>`;
      }

      function renderUsageOverview(range) {
        const items = range.usageItems || [];
        if (!items.length) {
          $("usageList").innerHTML = `<div class="empty">例文・熟語は未登録です。</div>`;
          return;
        }
        const wordsById = new Map(range.words.map(word => [word.id, word.word]));
        $("usageList").innerHTML = `<h3>例文・熟語一覧</h3>${items.map(item => {
          const linked = item.linkedWordIds.map(id => wordsById.get(id)).filter(Boolean);
          return `<article class="content-card ${isSettled(item) ? "settled" : ""}">
            <div class="range-head"><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span><span class="rating-status">${item.recallStats.lastRating === "circle" ? "○" : item.recallStats.lastRating === "triangle" ? "△" : item.recallStats.lastRating === "cross" ? "×" : "未判定"}</span></div>
            <strong>${escapeHtml(item.english)}</strong><div>${escapeHtml(item.japanese)}</div>
            <div class="meta">関連単語: ${linked.length ? escapeHtml(linked.join("、")) : "未設定"}${item.unresolvedRefs?.length ? ` / 未解決ID: ${escapeHtml(item.unresolvedRefs.join("、"))}` : ""}</div>
          </article>`;
        }).join("")}`;
      }

      function renderMemoryOverview(range) {
        $("wordList").innerHTML = (range.memoryItems || []).map((item, index) => `<article class="content-card ${isSettled(item) ? "settled" : ""}">
          <div class="range-head"><span class="content-type">暗記構文 ${escapeHtml(item.label || String(index + 1))}</span><span class="rating-status">${item.recallStats.lastRating === "circle" ? "○" : item.recallStats.lastRating === "triangle" ? "△" : item.recallStats.lastRating === "cross" ? "×" : "未判定"}</span></div>
          <strong>${escapeHtml(item.english)}</strong><div>${escapeHtml(item.japanese)}</div>
          <div class="meta">別の日に○を2回で定着</div>
        </article>`).join("") || `<div class="empty">暗記構文は未登録です。</div>`;
        $("usageList").innerHTML = "";
      }

      function configureLearningModes(isMemory) {
        const select = $("testMode");
        const previous = select.value;
        select.innerHTML = isMemory
          ? `<optgroup label="暗記構文">
              <option value="memory-unsettled">未定着のみ</option>
              <option value="memory-all">全範囲</option>
              <option value="memory-random5">ランダム5文</option>
              <option value="memory-random10">ランダム10文</option>
            </optgroup>`
          : `<optgroup label="単語テスト">
              <option value="word-enToJa-normal">英語→日本語・通常</option>
              <option value="word-jaToEn-normal">日本語→英語・通常</option>
              <option value="word-enToJa-wrong">英語→日本語・間違い集中</option>
              <option value="word-jaToEn-wrong">日本語→英語・間違い集中</option>
            </optgroup>
            <optgroup label="仕上げ">
              <option value="ready-enToJa">満点確認・英語→日本語</option>
              <option value="ready-jaToEn">満点確認・日本語→英語</option>
              <option value="spelling">スペル確認</option>
            </optgroup>`;
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
        $("vocabPrimaryModes").classList.toggle("hidden", isMemory);
        $("testModeLabel").textContent = isMemory ? "学習モード" : "確認モード";
        select.setAttribute("aria-label", isMemory ? "学習モード" : "確認モード");
        $("vocabLearningOptions").classList.toggle("hidden", isMemory);
      }

      function startSelectedLearningMode() {
        const value = $("testMode").value;
        if (value === "spelling") return startSpellingReview();
        if (value.startsWith("ready-")) return startTestReadyReview(value.slice(6));
        if (value.startsWith("word-")) {
          const [, direction, mode] = value.split("-");
          return startTest(direction, mode);
        }
        if (value.startsWith("memory-")) return startRecall("memory", value.slice(7));
      }

      function renderWords() {
        const range = state.ranges.find(r => r.id === state.selectedRangeId);
        if (!range) return;
        $("wordPanel").classList.remove("hidden");
        const isMemory = range.materialType === "memorization";
        configureLearningModes(isMemory);
        $("openRangeTitle").textContent = `${range.rangeName || "無題の範囲"} の${isMemory ? "暗記構文" : "教材"}`;
        const s = statsForRange(range);
        if (isMemory) {
          $("openRangeMeta").textContent = `${range.testDate || "日付未設定"} / ${s.memoryTotal}構文 / 未定着${s.memoryUnsettled}`;
          renderMemoryOverview(range);
          return;
        }
        $("wordFilter").value = state.settings.studyFilter;
        $("playbackInterval").value = String(state.settings.playbackInterval);
        updatePlaybackControls();
        const readiness = readinessForRange(range);
        $("openRangeMeta").textContent = `${range.testDate || "日付未設定"} / ${s.fetched}/${s.total} API取得済み / 例文${s.examples}・熟語${s.phrases} / 危険${readiness.riskItems?.length || 0}`;
        const readinessOverview = `<div class="readiness-summary"><div class="readiness-state ${readiness.status}">${readinessLabel(readiness)}</div>${readinessChecksHtml(readiness)}</div>`;
        const words = filteredWords(range);
        if (!words.length) {
          $("wordList").innerHTML = `${readinessOverview}<div class="empty">この条件に一致する単語はありません。</div>`;
          return;
        }
        const rememberedWordId = words.some(word => word.id === range.currentWordId) ? range.currentWordId : words[0].id;
        if (range.currentWordId !== rememberedWordId) {
          range.currentWordId = rememberedWordId;
          save(false);
        }
        $("wordList").innerHTML = readinessOverview + words.map((word, index) => `
          <article class="word-card ${word.id === rememberedWordId ? "current-word" : ""}" data-word-id="${escapeHtml(word.id)}">
            <div class="word-head">
              <div style="min-width:0;flex:1 1 auto">
                <div class="word-main-line">
                  <span class="word-index">${index + 1}/${words.length}</span>
                  <div class="word-title">${escapeHtml(word.word)}</div>
                </div>
                <div class="pron-line">
                  <span class="pron-text">発音1 : ${escapeHtml(word.pronunciation || "未取得")}</span>
                  <span class="pos-text">候補 : ${(word.pronunciationVariants || []).length}件</span>
                </div>
                ${renderSpellingRisk(word)}
                ${renderLinkedUsage(range, word.id)}
              </div>
              ${wordFailureLabel(word) ? `<span class="failure-label">${wordFailureLabel(word)}</span>` : ""}
            </div>
            ${renderPronunciationVariants(word)}
            ${word.definitions?.length ? `<div class="mini" style="margin-top:10px"><strong>定義</strong>${word.definitions.map((d, i) => `<div>${i + 1}. ${escapeHtml(d)}</div>`).join("")}</div>` : ""}
            <div class="study-actions">
              <button class="primary" data-word-action="play" data-id="${escapeHtml(word.id)}" ${word.audioUrl ? "" : "disabled"}>公式音声</button>
              <button class="primary" data-word-action="next" data-id="${escapeHtml(word.id)}">次へ</button>
            </div>
            <div class="secondary-actions">
              <button class="soft" data-word-action="speak" data-id="${escapeHtml(word.id)}">読み上げ</button>
              <button class="soft study-toggle hard" data-word-action="hard" data-id="${escapeHtml(word.id)}" aria-pressed="${word.studyStatus === "hard"}">苦手</button>
              <button class="soft study-toggle known" data-word-action="known" data-id="${escapeHtml(word.id)}" aria-pressed="${word.studyStatus === "known"}">覚えた</button>
            </div>
            <div class="danger-actions">
              <button class="soft mw-small" data-word-action="mw" data-id="${escapeHtml(word.id)}">MWで開く</button>
              <button class="compact refetch" data-word-action="refetch" data-id="${escapeHtml(word.id)}">再取得</button>
              <button class="compact collegiate" data-word-action="refetch-collegiate" data-id="${escapeHtml(word.id)}">Collegiate</button>
            </div>
          </article>`).join("");
        renderUsageOverview(range);
        if (state.pendingWordScroll) {
          const target = $("wordList").querySelector(`[data-word-id="${CSS.escape(rememberedWordId)}"]`);
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
          state.pendingWordScroll = false;
        }
      }

      function filteredWords(range) {
        const words = Array.isArray(range?.words) ? range.words : [];
        if (state.temporaryWordIds instanceof Set) return words.filter(word => state.temporaryWordIds.has(word.id));
        const filter = state.settings.studyFilter;
        return filter === "all" ? [...words] : words.filter(word => word.studyStatus === filter);
      }

      function testWord(range, wordId) {
        return range.words.find(word => word.id === wordId);
      }

      function playTestAudio(word) {
        if (!word) return;
        const variant = (word.pronunciationVariants || []).find(item => item.audioUrl);
        if (variant) playPronunciationVariant(word.id, variant.id);
        else if (word.audioUrl) playOfficial(word.id);
        else if (!speakWordText(word.word)) toast("この端末では代替読み上げを利用できません。", true);
      }

      function linkedUsageItemsForWord(range, wordId) {
        return (range?.usageItems || []).filter(item => item.linkedWordIds.includes(wordId));
      }

      function linkedWordsForUsageItem(range, item) {
        const wordsById = new Map((range?.words || []).map(word => [word.id, word]));
        return [...new Set(item?.linkedWordIds || [])].map(id => wordsById.get(id)).filter(Boolean);
      }

      function officialAudioUrlForWord(word) {
        return preferredPronunciationVariant(word)?.audioUrl || word?.audioUrl || "";
      }

      function usageAudioInfo(range, item) {
        const linkedWords = linkedWordsForUsageItem(range, item);
        const playableWords = linkedWords.filter(word => officialAudioUrlForWord(word));
        return {
          linkedWords,
          playableWords,
          label: linkedWords.length
            ? `登録単語: ${linkedWords.map(word => word.word).join("、")}`
            : "登録単語なし"
        };
      }

      function playUsageLinkedWordAudio(range, item) {
        const { playableWords } = usageAudioInfo(range, item);
        if (!playableWords.length) return false;
        stopPreviewAudio();
        let index = 0;
        const playNext = () => {
          const word = playableWords[index++];
          if (!word) {
            previewAudio = null;
            return;
          }
          previewAudio = new Audio(officialAudioUrlForWord(word));
          previewAudio.onended = playNext;
          previewAudio.onerror = playNext;
          previewAudio.play().catch(playNext);
        };
        playNext();
        return true;
      }

      function autoPlayUsageLinkedWord(range, item, key) {
        if (!range || !item || !key || key === lastAutoSpokenUsageKey) return;
        lastAutoSpokenUsageKey = key;
        playUsageLinkedWordAudio(range, item);
      }

      function usageAudioHtml(range, item, actionName) {
        const info = usageAudioInfo(range, item);
        const status = info.playableWords.length
          ? `${escapeHtml(info.label)} / 公式音声 ${info.playableWords.length}語`
          : `${escapeHtml(info.label)} / 公式音声未取得`;
        return `<div class="usage-word-audio"><span>${status}</span>${info.playableWords.length ? `<button class="soft" data-${actionName}-action="audio">単語音声を再生</button>` : ""}</div>`;
      }

      function hideForSpeed(active) {
        document.querySelector("header")?.classList.toggle("hidden", active);
        document.querySelector("nav.tabs")?.classList.toggle("hidden", active);
        document.querySelectorAll(".tab-page").forEach(page => page.classList.toggle("hidden", active || page.id !== `page-${currentTab()}`));
        $("wordPanel").classList.toggle("hidden", active);
        $("jumpFab").classList.toggle("hidden", active);
        $("testPanel").classList.add("hidden");
        $("spellingPanel").classList.add("hidden");
        $("recallPanel").classList.add("hidden");
        $("speedPanel").classList.toggle("hidden", !active);
      }

      function startSpeedReview() {
        stopContinuousPlayback();
        state.usageStudySession = null;
        state.wordStudySession = null;
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const words = filteredWords(range);
        const session = createSpeedReviewSession(range, words.map(word => word.id));
        if (session.error) return toast(session.error, true);
        state.speedSession = session;
        state.speedMeaningVisible = false;
        state.speedUsageVisible = false;
        lastAutoSpokenSpeedKey = "";
        hideForSpeed(true);
        renderSpeedReview();
      }

      function restartSpeedReview() {
        if (!restartSpeedReviewSession(state.speedSession)) return startSpeedReview();
        state.speedMeaningVisible = false;
        state.speedUsageVisible = false;
        renderSpeedReview();
      }

      function speedReviewWord() {
        const session = state.speedSession;
        return session ? findWord(session.roundWordIds[session.index]) : null;
      }

      function autoPlaySpeedReviewWord(word) {
        const session = state.speedSession;
        if (!session || session.finished || !word) return;
        const key = `${session.id}:${session.round}:${session.index}:${word.id}`;
        if (key === lastAutoSpokenSpeedKey) return;
        const hasOfficial = Boolean(word.audioUrl || (word.pronunciationVariants || []).some(item => item.audioUrl));
        const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        if (!hasOfficial && !canSpeak) return;
        lastAutoSpokenSpeedKey = key;
        playTestAudio(word);
      }

      function renderSpeedReview() {
        const session = state.speedSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        if (session.finished) {
          lastAutoSpokenSpeedKey = "";
          const elapsedSeconds = Math.max(1, Math.round((session.finishedAtMs - session.startedAtMs) / 1000));
          const counts = { unknown: 0, unsure: 0, instant: 0 };
          session.assessments.forEach(item => { counts[item.rating]++; });
          const readiness = readinessForRange(range);
          $("speedContent").innerHTML = `<div class="test-result"><h2>高速周回 完了</h2><p>${escapeHtml(range.rangeName || "無題の範囲")}</p><div class="result-score">全体 ${session.round}周目 完了</div><div class="result-grid"><div><strong>${session.assessments.length}</strong>確認回数</div><div><strong>${counts.instant}</strong>即答</div><div><strong>${counts.unsure}</strong>怪しい</div><div><strong>${counts.unknown}</strong>知らない</div></div><div class="readiness-summary"><div class="readiness-state ${readiness.status}">${readinessLabel(readiness)}</div>${readinessChecksHtml(readiness)}</div><p class="meta">所要時間 ${Math.floor(elapsedSeconds / 60)}分${elapsedSeconds % 60}秒。判定履歴は危険項目の選定に使いますが、15問テストの正答数は変更しません。</p><div class="test-result-actions"><button class="primary" data-speed-action="repeat">全範囲を次の周へ</button><button class="soft" data-speed-action="return">範囲へ戻る</button></div></div>`;
          return;
        }
        const word = speedReviewWord();
        if (!word) return;
        const elapsedMinutes = Math.max(1 / 60, (Date.now() - session.startedAtMs) / 60000);
        const wordsPerMinute = session.assessments.length / elapsedMinutes;
        const remaining = session.roundWordIds.length - session.index;
        const etaMinutes = wordsPerMinute > 0 ? Math.ceil(remaining / wordsPerMinute) : 0;
        const progress = session.roundWordIds.length ? session.index / session.roundWordIds.length * 100 : 0;
        const meaning = word.meaningsJa?.length ? word.meaningsJa.join("／") : "日本語訳未登録";
        const hasOfficial = Boolean(word.audioUrl || (word.pronunciationVariants || []).some(item => item.audioUrl));
        const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        const audioLabel = hasOfficial ? "公式音声を自動再生" : canSpeak ? "端末音声を自動再生" : "利用できる音声なし";
        const fallbackReplay = !hasOfficial && canSpeak
          ? `<button class="speed-replay" data-speed-action="audio" aria-label="端末読み上げをもう一度聞く" title="端末読み上げをもう一度聞く">🔊</button>`
          : "";
        const usageItems = linkedUsageItemsForWord(range, word.id);
        const usageReview = usageItems.length
          ? `<div class="speed-usage-review"><button class="soft speed-usage-toggle" data-speed-action="usage" aria-expanded="${state.speedUsageVisible}">例文・熟語を確認（${usageItems.length}件）</button>${state.speedUsageVisible ? `<div class="speed-usage-list">${usageItems.map(item => `<article><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span><strong>${escapeHtml(item.english)}</strong><span>${escapeHtml(item.japanese)}</span></article>`).join("")}</div>` : ""}</div>`
          : "";
        $("speedContent").innerHTML = `<div class="speed-head"><span>全体 ${session.round}周目</span><span>${session.index + 1} / ${session.roundWordIds.length}</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><div class="speed-metrics"><div><strong>${remaining}</strong>この周の残り</div><div><strong>${wordsPerMinute ? wordsPerMinute.toFixed(1) : "—"}</strong>語/分</div><div><strong>${etaMinutes ? `約${etaMinutes}分` : "計測中"}</strong>終了目安</div></div><div class="speed-audio-status meta">${audioLabel}</div><div class="speed-card-wrap">${fallbackReplay}<div class="speed-card" data-speed-card tabindex="0" role="button" aria-label="単語カード"><div class="speed-word">${escapeHtml(word.word)}</div>${state.speedMeaningVisible ? `<div class="speed-meaning">${escapeHtml(meaning)}</div>${renderSpellingRisk(word)}` : `<div class="speed-hint">下の大きなボタンで意味を確認</div>`}</div></div><button class="primary speed-meaning-toggle" data-speed-action="meaning" aria-expanded="${state.speedMeaningVisible}">${state.speedMeaningVisible ? "意味を隠す" : "意味を確認"}</button>${usageReview}<div class="speed-actions"><button class="speed-unknown" data-speed-rating="unknown">← 知らない</button><button class="speed-unsure" data-speed-rating="unsure">↑ 怪しい</button><button class="speed-instant" data-speed-rating="instant">即答 →</button></div><div class="speed-footer"><span class="meta">履歴は危険項目へ反映・15問成績とは独立</span><button class="soft" data-speed-action="abort">終了</button></div>`;
        autoPlaySpeedReviewWord(word);
      }

      function applySpeedAssessment(assessment, now = Date.now()) {
        const word = findWord(assessment?.wordId);
        if (!word) return;
        word.speedStats = normalizeSpeedStats(word.speedStats);
        const stats = word.speedStats.enToJa;
        const timestamp = new Date(now).toISOString();
        const day = localDateString(new Date(now));
        stats.attempts++;
        stats[assessment.rating]++;
        stats.lastRating = assessment.rating;
        stats.lastReviewedAt = timestamp;
        stats.totalResponseMs += Math.max(0, Number(assessment.responseMs) || 0);
        if (assessment.rating === "instant") {
          if (!stats.successfulReviewDates.includes(day)) stats.successfulReviewDates.push(day);
          stats.successfulReviewDates.sort();
        } else {
          stats.lastLapseAt = timestamp;
        }
      }

      function rateCurrentSpeedWord(rating) {
        stopPreviewAudio();
        const result = rateSpeedReviewWord(state.speedSession, rating);
        if (!result) return;
        applySpeedAssessment(result.assessment);
        save(false);
        state.speedMeaningVisible = false;
        state.speedUsageVisible = false;
        if (result.roundComplete && !result.finished) toast(`第${state.speedSession.round - 1}周が完了しました。${state.speedSession.roundStartCount}語に絞って続けます。`);
        renderSpeedReview();
      }

      function leaveSpeedReview() {
        stopPreviewAudio();
        lastAutoSpokenSpeedKey = "";
        state.speedSession = null;
        state.speedMeaningVisible = false;
        state.speedUsageVisible = false;
        hideForSpeed(false);
        switchTab("ranges");
        renderWords();
        $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function hideForSpelling(active) {
        document.querySelector("header")?.classList.toggle("hidden", active);
        document.querySelector("nav.tabs")?.classList.toggle("hidden", active);
        document.querySelectorAll(".tab-page").forEach(page => page.classList.toggle("hidden", active || page.id !== `page-${currentTab()}`));
        $("wordPanel").classList.toggle("hidden", active);
        $("jumpFab").classList.toggle("hidden", active);
        $("testPanel").classList.add("hidden");
        $("speedPanel").classList.add("hidden");
        $("recallPanel").classList.add("hidden");
        $("spellingPanel").classList.toggle("hidden", !active);
      }

      function startSpellingReview() {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const risks = wordReadinessForRange(range, Date.now()).riskItems || [];
        const today = todayKey();
        const spellingIds = risks.filter(item => item.reasons.some(reason => reason.startsWith("スペル:"))).map(item => {
          const word = testWord(range, item.wordId);
          const stats = normalizeSpellingStats(word?.spellingStats);
          const latestSuccess = stats.successfulReviewDates.at(-1) || "";
          const priority = Number(stats.lastResult === "incorrect") * 1000 + Number(stats.attempts === 0) * 500 +
            Number(latestSuccess && latestSuccess < today) * 200 + Number((stats.lastAttemptedAt || "").slice(0, 10) < today) * 100 + item.reasons.length;
          return { wordId: item.wordId, priority };
        }).sort((a, b) => b.priority - a.priority || a.wordId.localeCompare(b.wordId)).map(item => item.wordId).slice(0, 15);
        if (!spellingIds.length) return toast("スペルの危険項目は0です。別日の正解確認まで完了しています。");
        const session = createSpellingSession(range, spellingIds);
        if (session.error) return toast(session.error, true);
        state.spellingSession = session;
        state.spellingFeedback = null;
        state.spellingResult = null;
        hideForSpelling(true);
        renderSpellingReview();
      }

      function renderSpellingReview() {
        const session = state.spellingSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        if (state.spellingResult) {
          const result = state.spellingResult;
          const readiness = readinessForRange(range);
          $("spellingContent").innerHTML = `<div class="test-result"><h2>スペル確認 完了</h2><p>${escapeHtml(range.rangeName || "無題の範囲")}</p><div class="result-score">${result.correct} / ${result.answered}</div><div class="result-grid"><div><strong>${result.correct}</strong>正解</div><div><strong>${result.incorrect}</strong>不正解</div><div><strong>${Math.max(0, result.total - result.answered)}</strong>未回答</div></div><div class="readiness-summary"><div class="readiness-state ${readiness.status}">${readinessLabel(readiness)}</div>${readinessChecksHtml(readiness)}</div><div class="test-result-actions"><button class="primary" data-spelling-action="repeat">残っている危険スペルを確認</button><button class="soft" data-spelling-action="return">範囲へ戻る</button></div></div>`;
          return;
        }
        if (state.spellingFeedback) {
          const attempt = state.spellingFeedback;
          const word = testWord(range, attempt.wordId);
          $("spellingContent").innerHTML = `<div class="spelling-card"><div class="test-progress"><span>${attempt.questionIndex + 1} / ${session.wordIds.length}</span><span>日本語 → spelling</span></div><div class="spelling-feedback ${attempt.correct ? "correct" : "incorrect"}"><strong>${attempt.correct ? "正解" : "不正解"}</strong><div>入力: ${escapeHtml(attempt.answer || "（空欄）")}</div><div>正解: <strong>${escapeHtml(attempt.expected || word?.word || "")}</strong></div>${attempt.acceptedForms?.length > 1 ? `<div class="meta">許容形: ${escapeHtml(attempt.acceptedForms.join(" / "))}</div>` : ""}</div><button class="primary" data-spelling-action="next">${session.finished ? "結果を見る" : "次の単語"}</button><button class="soft" data-spelling-action="audio">発音を聞く</button></div>`;
          return;
        }
        const wordId = session.wordIds[session.index];
        const word = testWord(range, wordId);
        if (!word) return;
        const progress = session.wordIds.length ? session.index / session.wordIds.length * 100 : 0;
        $("spellingContent").innerHTML = `<div class="spelling-card"><div class="test-progress"><span>${session.index + 1} / ${session.wordIds.length}</span><span>厳密採点</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><div class="meta">日本語から英単語を入力</div><div class="spelling-meaning">${escapeHtml(word.meaningsJa.join("／") || "日本語訳未登録")}</div><form class="spelling-form" id="spellingForm"><label for="spellingAnswer">spelling</label><input id="spellingAnswer" name="answer" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" required><button class="primary" type="submit">答える</button></form><button class="soft" data-spelling-action="abort">終了</button></div>`;
        requestAnimationFrame(() => $("spellingAnswer")?.focus());
      }

      function submitSpellingAnswer(answer) {
        const session = state.spellingSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        const attempt = answerSpellingQuestion(session, range, answer, Date.now());
        if (!attempt) return;
        const word = testWord(range, attempt.wordId);
        if (attempt.correct && wordReadinessForRange({ words: [word] }, Date.now()).status === "safe") word.studyStatus = "known";
        else if (!attempt.correct) word.studyStatus = "hard";
        state.spellingFeedback = attempt;
        save(false);
        renderSpellingReview();
      }

      function finishPartialSpellingReview() {
        const session = state.spellingSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        state.spellingResult = finishSpellingSession(session, range, Date.now());
        state.spellingFeedback = null;
        save(false);
        renderSpellingReview();
      }

      function leaveSpellingReview() {
        state.spellingSession = null;
        state.spellingFeedback = null;
        state.spellingResult = null;
        hideForSpelling(false);
        switchTab("ranges");
        renderWords();
        $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function recallItems(range, source) {
        return source === "memory" ? (range.memoryItems || []) : (range.usageItems || []);
      }

      function startUsageStudy() {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        const itemIds = (range?.usageItems || []).map(item => item.id);
        if (!range || !itemIds.length) return toast("学習できる例文・熟語がありません。", true);
        state.recallSession = null;
        state.wordStudySession = null;
        state.usageStudySession = { rangeId: range.id, itemIds, index: 0, transitioning: false, finished: false };
        lastAutoSpokenUsageKey = "";
        hideForRecall(true);
        renderUsageStudy();
      }

      function currentUsageStudyItem() {
        const session = state.usageStudySession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        return (range?.usageItems || []).find(item => item.id === session?.itemIds?.[session.index]) || null;
      }

      function startWordStudy() {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        const itemIds = filteredWords(range).map(word => word.id);
        if (!range || !itemIds.length) return toast("学習できる単語がありません。", true);
        state.recallSession = null;
        state.usageStudySession = null;
        state.wordStudySession = { rangeId: range.id, itemIds, index: 0, transitioning: false, finished: false };
        lastAutoSpokenStudyWordKey = "";
        hideForRecall(true);
        renderWordStudy();
      }

      function currentWordStudyWord() {
        const session = state.wordStudySession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        return (range?.words || []).find(word => word.id === session?.itemIds?.[session.index]) || null;
      }

      function renderWordStudy() {
        const session = state.wordStudySession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        if (session.finished) {
          $("recallContent").innerHTML = `<div class="test-result"><h2>学習モード 完了</h2><p>${escapeHtml(range.rangeName)}</p><div class="result-score">単語 ${session.itemIds.length}件</div><p class="meta">この学習では採点や定着履歴を記録していません。</p><div class="actions"><button class="primary" data-study-action="repeat">もう一周</button><button class="soft" data-study-action="return">教材へ戻る</button></div></div>`;
          return;
        }
        const word = currentWordStudyWord();
        if (!word) return;
        const progress = session.itemIds.length ? session.index / session.itemIds.length * 100 : 0;
        const hasOfficial = Boolean(officialAudioUrlForWord(word));
        const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        const audio = hasOfficial ? "公式音声を自動再生" : canSpeak ? "端末音声を自動再生" : "利用できる音声なし";
        const replay = hasOfficial || canSpeak ? `<button class="soft" data-study-action="audio">発音をもう一度聞く</button>` : "";
        $("recallContent").innerHTML = `<div class="recall-head"><span>学習モード・単語</span><span>${session.index + 1} / ${session.itemIds.length}</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><article class="usage-study-card study-card-enter" data-study-card><span class="content-type">単語</span><div class="usage-word-audio"><span>${audio}</span>${replay}</div><div class="usage-study-english">${escapeHtml(word.word)}</div><div class="usage-study-japanese">${escapeHtml(word.meaningsJa?.join("／") || "日本語訳未登録")}</div><div class="swipe-next-hint">← 左へスワイプして次へ</div></article><button class="soft" data-study-action="abort">終了</button>`;
        const key = `study-word:${session.rangeId}:${session.index}:${word.id}`;
        if (key !== lastAutoSpokenStudyWordKey) {
          lastAutoSpokenStudyWordKey = key;
          playTestAudio(word);
        }
      }

      function advanceWordStudy() {
        const session = state.wordStudySession;
        const card = $("recallContent").querySelector("[data-study-card]");
        if (!session || session.finished || session.transitioning || !card) return;
        session.transitioning = true;
        card.classList.add("swipe-out-left");
        setTimeout(() => {
          stopPreviewAudio();
          session.index++;
          session.transitioning = false;
          session.finished = session.index >= session.itemIds.length;
          renderWordStudy();
        }, 220);
      }

      function activeStudySession() {
        return state.wordStudySession || state.usageStudySession;
      }

      function renderUsageStudy() {
        const session = state.usageStudySession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        if (session.finished) {
          $("recallContent").innerHTML = `<div class="test-result"><h2>学習モード 完了</h2><p>${escapeHtml(range.rangeName)}</p><div class="result-score">例文・熟語 ${session.itemIds.length}件</div><p class="meta">この学習では○・△・×や定着履歴を記録していません。</p><div class="actions"><button class="primary" data-study-action="repeat">もう一周</button><button class="soft" data-study-action="return">教材へ戻る</button></div></div>`;
          return;
        }
        const item = currentUsageStudyItem();
        if (!item) return;
        const progress = session.itemIds.length ? session.index / session.itemIds.length * 100 : 0;
        $("recallContent").innerHTML = `<div class="recall-head"><span>学習モード・${item.type === "phrase" ? "熟語" : "例文"}</span><span>${session.index + 1} / ${session.itemIds.length}</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><article class="usage-study-card study-card-enter" data-study-card><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span>${usageAudioHtml(range, item, "study")}<div class="usage-study-english">${escapeHtml(item.english)}</div><div class="usage-study-japanese">${escapeHtml(item.japanese)}</div><div class="swipe-next-hint">← 左へスワイプして次へ</div></article><button class="soft" data-study-action="abort">終了</button>`;
        autoPlayUsageLinkedWord(range, item, `study:${session.rangeId}:${session.index}:${item.id}`);
      }

      function advanceUsageStudy() {
        const session = state.usageStudySession;
        const card = $("recallContent").querySelector("[data-study-card]");
        if (!session || session.finished || session.transitioning || !card) return;
        session.transitioning = true;
        card.classList.add("swipe-out-left");
        setTimeout(() => {
          stopPreviewAudio();
          session.index++;
          session.transitioning = false;
          session.finished = session.index >= session.itemIds.length;
          renderUsageStudy();
        }, 220);
      }

      function leaveUsageStudy() {
        stopPreviewAudio();
        lastAutoSpokenUsageKey = "";
        state.usageStudySession = null;
        hideForRecall(false);
        switchTab("ranges");
        renderWords();
        $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function leaveWordStudy() {
        stopPreviewAudio();
        lastAutoSpokenStudyWordKey = "";
        state.wordStudySession = null;
        hideForRecall(false);
        switchTab("ranges");
        renderWords();
        $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function startUsageSpeedReview() {
        state.usageStudySession = null;
        state.wordStudySession = null;
        lastAutoSpokenUsageKey = "";
        startRecall("usage", "speed", "all");
      }

      function currentRecallItem() {
        const session = state.recallSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        return recallItems(range || {}, session?.source).find(item => item.id === session?.queue?.[0]) || null;
      }

      function hideForRecall(active) {
        document.querySelector("header")?.classList.toggle("hidden", active);
        document.querySelector("nav.tabs")?.classList.toggle("hidden", active);
        document.querySelectorAll(".tab-page").forEach(page => page.classList.toggle("hidden", active || page.id !== `page-${currentTab()}`));
        $("wordPanel").classList.toggle("hidden", active);
        $("jumpFab").classList.toggle("hidden", active);
        $("testPanel").classList.add("hidden");
        $("speedPanel").classList.add("hidden");
        $("spellingPanel").classList.add("hidden");
        $("recallPanel").classList.toggle("hidden", !active);
      }

      function startRecall(source, mode, type = "all") {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const session = createRecallSession(recallItems(range, source), { source, mode, type });
        if (session.error) return toast(session.error, true);
        session.rangeId = range.id;
        state.recallSession = session;
        state.usageStudySession = null;
        state.wordStudySession = null;
        lastAutoSpokenUsageKey = "";
        hideForRecall(true);
        renderRecall();
      }

      function renderRecall() {
        const session = state.recallSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        if (session.finished) {
          const isUsageSpeed = session.source === "usage" && session.mode === "speed";
          const counts = { circle: 0, triangle: 0, cross: 0 };
          session.assessments.forEach(entry => counts[entry.rating]++);
          $("recallContent").innerHTML = `<div class="test-result"><h2>${isUsageSpeed ? "例文・熟語 高速周回 完了" : "全文暗唱 完了"}</h2><p>${escapeHtml(range.rangeName)}</p><div class="result-grid"><div><strong>${counts.circle}</strong>${isUsageSpeed ? "即答" : "○"}</div><div><strong>${counts.triangle}</strong>${isUsageSpeed ? "怪しい" : "△"}</div><div><strong>${counts.cross}</strong>${isUsageSpeed ? "知らない" : "×"}</div></div><p class="meta">${isUsageSpeed ? "「知らない」「怪しい」は同じ周回内で再出題しました。" : "△・×は同じ周回内で○になるまで再出題しました。別の周回でもう一度○になると定着です。"}</p><div class="actions"><button class="primary" data-recall-action="repeat">もう一周</button><button class="soft" data-recall-action="return">教材へ戻る</button></div></div>`;
          return;
        }
        const item = currentRecallItem();
        if (!item) return;
        const isUsageSpeed = session.source === "usage" && session.mode === "speed";
        const total = session.itemIds.length;
        const completed = Math.max(0, total - new Set(session.queue).size);
        const ratings = isUsageSpeed
          ? `<div class="recall-ratings speed-recall-ratings"><button class="rating cross" data-recall-rating="cross" aria-label="知らない">知らない</button><button class="rating triangle" data-recall-rating="triangle" aria-label="怪しい">怪しい</button><button class="rating circle" data-recall-rating="circle" aria-label="即答">即答</button></div>`
          : `<div class="recall-ratings"><button class="rating cross" data-recall-rating="cross" aria-label="言えなかった">×</button><button class="rating triangle" data-recall-rating="triangle" aria-label="一部ミス">△</button><button class="rating circle" data-recall-rating="circle" aria-label="完全に言えた">○</button></div>`;
        $("recallContent").innerHTML = `<div class="recall-head"><span>${isUsageSpeed ? "例文・熟語・高速周回" : session.source === "memory" ? "暗記構文" : item.type === "phrase" ? "熟語" : "例文"}</span><span>未完了 ${session.queue.length} / 初回${total}件</span></div><div class="test-progressbar"><span style="width:${total ? completed / total * 100 : 0}%"></span></div><article class="recall-card"><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span>${isUsageSpeed ? usageAudioHtml(range, item, "recall") : ""}<div class="recall-prompt-label">${isUsageSpeed ? "日本語を見て英文を即答" : "日本語から英語全文を暗唱"}</div><div class="recall-japanese">${escapeHtml(item.japanese)}</div>${session.answerVisible ? `<div class="recall-answer">${escapeHtml(item.english)}</div>${ratings}` : `<button class="primary reveal-answer" data-recall-action="reveal">${isUsageSpeed ? "英文を表示" : "答えを表示"}</button>`}</article><button class="soft" data-recall-action="abort">終了</button>`;
        if (isUsageSpeed) autoPlayUsageLinkedWord(range, item, `usage-speed:${session.id}:${session.index}:${item.id}`);
      }

      function rateCurrentRecall(rating) {
        const item = currentRecallItem();
        if (!item) return;
        const result = rateRecallItem(state.recallSession, item, rating);
        if (!result) return;
        save(false);
        renderRecall();
      }

      function leaveRecall() {
        stopPreviewAudio();
        lastAutoSpokenUsageKey = "";
        state.recallSession = null;
        hideForRecall(false);
        switchTab("ranges");
        renderWords();
        $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function pronunciationFeedback(word) {
        const variants = (word.pronunciationVariants || []).slice(0, 2);
        return variants.length ? variants.map((variant, index) => `<span>発音${index + 1}: ${escapeHtml(variant.pronunciation || "表記なし")}</span>`).join("<br>") : `<span>発音: ${escapeHtml(word.pronunciation || "未取得")}</span>`;
      }

      function hideForTest(active) {
        document.querySelector("header")?.classList.toggle("hidden", active);
        document.querySelector("nav.tabs")?.classList.toggle("hidden", active);
        document.querySelectorAll(".tab-page").forEach(page => page.classList.toggle("hidden", active || page.id !== `page-${currentTab()}`));
        $("wordPanel").classList.toggle("hidden", active);
        $("jumpFab").classList.toggle("hidden", active);
        $("testPanel").classList.toggle("hidden", !active);
        $("speedPanel").classList.add("hidden");
        $("spellingPanel").classList.add("hidden");
        $("recallPanel").classList.add("hidden");
      }

      function startTest(direction, mode = "normal") {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const session = createTestSession(range, direction, { mode });
        if (session.error) return toast(session.error, true);
        state.activeTest = session;
        hideForTest(true);
        renderActiveTest();
      }

      function startTestReadyReview(direction = "enToJa") {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const targets = selectTestReadyItems(range, direction, 15, Date.now());
        if (!targets.length) {
          const readiness = readinessForRange(range);
          return toast(readiness.status === "safe" ? "危険単語は0です。この範囲は満点準備OKです。" : "この方向の危険単語はありません。スペル・例文・熟語の未確認項目を確認してください。");
        }
        const session = createTestSession(range, direction, { mode: "ready", wordIds: targets.map(word => word.id) });
        if (session.error) return toast(session.error, true);
        state.activeTest = session;
        hideForTest(true);
        renderActiveTest();
      }

      function renderActiveTest() {
        const session = state.activeTest;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        $("testContent").innerHTML = renderTestQuestion(session, range);
        session.questionStartedAt = Date.now();
        if (session.direction === "enToJa") setTimeout(() => playTestAudio(testWord(range, session.questions[session.index].wordId)), 120);
      }

      function updateTestStats(range, answer) {
        const session = state.activeTest;
        const word = testWord(range, answer.wordId);
        const timing = applyDirectionAttempt(word, session.direction, answer, Date.now());
        answer.slow = Boolean(timing?.slow);
        answer.hesitant = Boolean(timing?.hesitant);
        const before = word.studyStatus;
        if (!answer.correct) word.studyStatus = "hard";
        else if (wordReadinessForRange({ words: [word] }, Date.now()).status === "safe") word.studyStatus = "known";
        answer.studyStatusChanged = before !== word.studyStatus ? word.studyStatus : "";
        const key = todayKey();
        const log = state.studyLog[key] || (state.studyLog[key] = { attempts: 0, correct: 0, enToJa: { attempts: 0, correct: 0 }, jaToEn: { attempts: 0, correct: 0 } });
        log.attempts++; log.correct += Number(answer.correct); log[session.direction].attempts++; log[session.direction].correct += Number(answer.correct);
        Object.keys(state.studyLog).filter(date => date < localDateString(new Date(Date.now() - 29 * 86400000))).forEach(date => delete state.studyLog[date]);
        save(false);
      }

      function showAnsweredTest(answer) {
        const session = state.activeTest, range = state.ranges.find(item => item.id === session.rangeId);
        const question = session.questions[session.index], word = testWord(range, answer.wordId);
        $("testContent").querySelectorAll("[data-test-choice]").forEach((button, index) => {
          button.disabled = true;
          if (index === question.correctPosition) button.classList.add("correct");
          if (index === answer.selectedPosition && !answer.correct) button.classList.add("incorrect");
        });
        const feedback = document.createElement("div");
        feedback.className = `test-feedback ${answer.correct ? "correct-note" : "danger-note"}`;
        const changed = answer.studyStatusChanged === "hard" ? "苦手に変更しました" : answer.studyStatusChanged === "known" ? "覚えたに変更しました" : "";
        const timing = answer.slow ? "正解ですが回答が遅く、危険項目に残ります。" : answer.hesitant ? "正解ですが迷いがあり、危険項目に残ります。" : "";
        feedback.innerHTML = `<strong>${answer.correct ? "正解" : "不正解"}</strong><div class="test-answer-word">${escapeHtml(word.word)} — ${escapeHtml(word.meaningsJa.join("／"))}</div><div>${pronunciationFeedback(word)}</div>${timing ? `<div class="caution">${timing}</div>` : ""}${changed ? `<div><strong>${changed}</strong></div>` : ""}<button class="soft" data-test-action="replay">公式音声</button>${answer.correct ? "" : `<button class="primary" data-test-action="next">次の問題</button>`}`;
        $("testContent").appendChild(feedback);
        if (session.direction === "jaToEn" || !answer.correct) playTestAudio(word);
        if (answer.correct) setTimeout(nextTestQuestion, 700);
      }

      function nextTestQuestion() {
        stopPreviewAudio();
        const session = state.activeTest;
        if (!session) return;
        session.index++;
        if (session.index >= session.questions.length) showTestResult(finishTest(session, state.ranges.find(item => item.id === session.rangeId)));
        else renderActiveTest();
      }

      function cumulativeTestSummary(range, direction) {
        const stats = range.words.map(word => word.testStats?.[direction]).filter(Boolean);
        const attempts = stats.reduce((sum, item) => sum + item.attempts, 0), correct = stats.reduce((sum, item) => sum + item.correct, 0);
        return `${attempts}回答 / 正答率 ${attempts ? Math.round(correct / attempts * 100) : 0}%`;
      }

      function showTestResult(result) {
        const session = state.activeTest, range = state.ranges.find(item => item.id === session.rangeId);
        save(false);
        const wrong = result.wrongWordIds.map(id => testWord(range, id)).filter(Boolean);
        const histories = (range.testHistory || []).slice(-5).reverse();
        const slow = session.answers.filter(answer => answer.slow || answer.hesitant).length;
        const readiness = readinessForRange(range);
        const modeLabel = { normal: "通常", wrong: "間違い集中", ready: "満点確認" }[result.mode] || "通常";
        $("testContent").innerHTML = `<div class="test-result"><h2>テスト結果</h2><p>${session.direction === "enToJa" ? "英語 → 日本語" : "日本語 → 英語"} / ${modeLabel}モード</p><div class="result-score">${result.correct} / ${result.total}</div><div class="result-grid"><div><strong>${result.accuracy}%</strong>正答率</div><div><strong>${(result.averageResponseMs / 1000).toFixed(1)}秒</strong>平均回答</div><div><strong>${wrong.length}</strong>間違い</div><div><strong>${slow}</strong>遅い・迷い</div></div><div class="readiness-summary"><div class="readiness-state ${readiness.status}">${readinessLabel(readiness)}</div>${readinessChecksHtml(readiness)}</div><h3>累積分析</h3><p>${cumulativeTestSummary(range, session.direction)}</p>${histories.length ? `<div class="history-list">${histories.map(item => `<span>${escapeHtml((item.finishedAt || "").slice(0, 10))} ${Number(item.correct) || 0}/${Number(item.total) || 0}</span>`).join("")}</div>` : ""}<h3>間違えた単語</h3>${wrong.length ? wrong.map(word => `<article class="wrong-word"><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(word.meaningsJa.join("／"))}</span><span>${pronunciationFeedback(word)}</span><button class="soft" data-test-audio="${escapeHtml(word.id)}">公式音声</button><button class="soft" data-test-hard="${escapeHtml(word.id)}">苦手</button></article>`).join("") : `<div class="empty">全問正解です。</div>`}<div class="test-result-actions">${wrong.length ? `<button class="soft" data-test-action="open-wrong">間違いを発音画面で確認</button><button class="soft" data-test-action="hard-all">間違いを一括で苦手</button>` : ""}<button class="primary" data-test-action="repeat">同じ方向でもう一度</button><button class="soft" data-test-action="return">範囲へ戻る</button></div></div>`;
      }

      function leaveTest(openWrong = false) {
        stopPreviewAudio();
        const session = state.activeTest;
        if (openWrong && session) {
          state.savedFilterBeforeTemporary = state.settings.studyFilter;
          state.temporaryWordIds = new Set(session.answers.filter(answer => !answer.correct).map(answer => answer.wordId));
        }
        state.activeTest = null;
        hideForTest(false);
        switchTab("ranges");
        renderWords();
        $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function renderPronunciationVariants(word) {
        const variants = Array.isArray(word.pronunciationVariants) ? word.pronunciationVariants : [];
        if (!variants.length) return "";
        const partTotals = variants.reduce((totals, variant) => {
          const key = variant.partOfSpeech || "";
          totals[key] = (totals[key] || 0) + 1;
          return totals;
        }, {});
        const partIndexes = {};
        const rows = variants.map(variant => {
          const part = variant.partOfSpeech || "";
          partIndexes[part] = (partIndexes[part] || 0) + 1;
          const number = partTotals[part] > 1 ? ` 発音${partIndexes[part]}` : "";
          const meta = [part, variant.label].filter(Boolean).join(" / ");
          return `<div class="pronunciation-variant">
            <div style="min-width:0">
              ${meta || number ? `<div class="variant-meta">${escapeHtml(meta)}${number}</div>` : ""}
              <div class="variant-pronunciation">${escapeHtml(variant.pronunciation || "発音表記なし")}</div>
            </div>
            <button class="soft variant-audio" data-word-action="variant-play" data-id="${escapeHtml(word.id)}" data-variant-id="${escapeHtml(variant.id)}" ${variant.audioUrl ? "" : "disabled"}>公式音声</button>
          </div>`;
        }).join("");
        return `<div class="pronunciation-variants">${rows}</div>`;
      }

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
      }

      function truncateText(value, max) {
        const text = String(value || "").replace(/\s+/g, " ").trim();
        return text.length > max ? `${text.slice(0, max - 1)}…` : text;
      }

      function wordFailureLabel(word) {
        if (word.error?.includes("デモデータ")) return "デモにデータなし";
        if (word.error?.includes("HTTP")) return word.error.replace(/^APIエラー:\s*/, "API ");
        if (word.error?.includes("ネットワーク")) return "通信エラー";
        if (word.error?.includes("公式音声がありません")) return "音声なし";
        if (word.error?.includes("発音情報がありません")) return "発音なし";
        if (word.error?.includes("発音表記がありません")) return "表記なし";
        if (word.error) return "取得失敗";
        if (word.apiFetched && word.cacheVersion !== CACHE_SCHEMA_VERSION) return "再取得が必要";
        if (word.apiFetched && !word.hasAudio && !word.hasDefinition) return "取得失敗";
        return "";
      }

      function safeApiError(error) {
        const message = String(error?.message || error || "取得に失敗しました");
        if (/HTTP\s+\d{3}/.test(message)) return message.match(/HTTP\s+\d{3}/)[0];
        if (/Failed to fetch|NetworkError|network/i.test(message)) return "ネットワークまたはAPIへの接続に失敗しました";
        if (/APIキー/.test(message)) return "APIキーを確認してください";
        return message.slice(0, 100);
      }

      function toast(message, isDanger = false) {
        const el = $("toast");
        el.textContent = message;
        el.style.borderColor = isDanger ? "#763943" : "#31506f";
        el.classList.remove("hidden");
        clearTimeout(toast.timer);
        toast.timer = setTimeout(() => el.classList.add("hidden"), 3600);
      }

      function dismissToast() {
        clearTimeout(toast.timer);
        const el = $("toast");
        el.classList.add("toast-dismissed");
        setTimeout(() => { el.classList.add("hidden"); el.classList.remove("toast-dismissed"); }, 160);
      }

      function showModal(html, onConfirm) {
        const root = $("modalRoot");
        root.innerHTML = `<div class="modal">${html}</div>`;
        root.classList.remove("hidden");
        root.querySelector("[data-modal-cancel]")?.addEventListener("click", closeModal);
        root.querySelector("[data-modal-confirm]")?.addEventListener("click", async () => {
          const confirmButton = root.querySelector("[data-modal-confirm]");
          confirmButton.disabled = true;
          try {
            await onConfirm?.();
            // Long-running flows may replace the confirmation with a completion screen.
            if (root.querySelector("[data-modal-confirm]")) closeModal();
          } finally {
            confirmButton.disabled = false;
          }
        });
      }

      function closeModal() {
        $("modalRoot").classList.add("hidden");
        $("modalRoot").innerHTML = "";
      }

      function updateImportPreview() {
        const root = $("importPreview");
        const isMemory = $("rangeKind").value === "memorization";
        const source = isMemory ? $("memoryInput").value : $("wordInput").value;
        if (!source.trim()) {
          root.className = "wide import-preview";
          root.innerHTML = `<span class="meta">貼り付けると、登録前に件数と不完全行を確認できます。</span>`;
          $("importRange").disabled = false;
          return;
        }
        const parsed = isMemory ? parseMemoryRows(source) : parseUnifiedRows(source);
        const issues = parsed.issues || [];
        const blocked = Boolean(parsed.invalid || (!isMemory && parsed.duplicates));
        root.className = `wide import-preview ${blocked ? "invalid" : "valid"}`;
        if (isMemory) {
          root.innerHTML = `<strong>${blocked ? "修正が必要です" : "登録できます"}</strong>
            <div class="import-preview-counts"><span>暗記構文 ${parsed.rows.length}件</span><span>不完全 ${parsed.invalid}件</span></div>
            ${issues.length ? `<ul class="import-issues">${issues.slice(0, 6).map(issue => `<li>${issue.line}行目: ${escapeHtml(issue.message)}</li>`).join("")}</ul>` : ""}`;
        } else {
          const examples = parsed.rows.reduce((sum, row) => sum + row.examples.length, 0);
          const phrases = parsed.rows.reduce((sum, row) => sum + row.phrases.length, 0);
          root.innerHTML = `<strong>${blocked ? "修正が必要です" : "登録できます"}</strong>
            <div class="import-preview-counts">
              <span>単語 ${parsed.rows.length}語</span><span>例文 ${examples}件</span><span>熟語 ${phrases}件</span>
              <span>重複 ${parsed.duplicates}件</span><span>不完全 ${parsed.invalid}件</span>
            </div>
            ${issues.length ? `<ul class="import-issues">${issues.slice(0, 6).map(issue => `<li>${issue.line}行目: ${escapeHtml(issue.message)}</li>`).join("")}</ul>` : ""}`;
        }
        $("importRange").disabled = blocked;
      }

      function buildRangeFromForm(wordRows, memoryRows, materialType) {
        const testDate = $("testDate").value;
        const weekday = $("weekday").value;
        const augmentedRows = wordRows.map((row, index) => ({ ...row, sourceId: `ROW${String(index + 1).padStart(3, "0")}` }));
        const rangeWords = augmentedRows.map(row => {
          const word = createWord(row.word, row.normalized, row.meaningsJa);
          word.sourceId = row.sourceId;
          return word;
        });
        const sourceWordMap = new Map(rangeWords.filter(word => word.sourceId).map(word => [word.sourceId.toLowerCase(), word.id]));
        const usageRows = augmentedRows.flatMap((row, wordIndex) => [
          ...row.examples.map((item, itemIndex) => ({ sourceId: `E${wordIndex + 1}-${itemIndex + 1}`, type: "example", sourceRefs: [row.sourceId], english: item.english, japanese: item.japanese })),
          ...row.phrases.map((item, itemIndex) => ({ sourceId: `P${wordIndex + 1}-${itemIndex + 1}`, type: "phrase", sourceRefs: [row.sourceId], english: item.english, japanese: item.japanese }))
        ]);
        return {
          id: uid("range"),
          rangeName: $("rangeName").value.trim() || "無題の範囲",
          testDate,
          weekday,
          pages: $("pages").value.trim(),
          deleteAt: $("deleteAt").value || deleteAtFor(testDate, weekday),
          cacheClearedAt: "",
          createdAt: new Date().toISOString(),
          currentWordId: rangeWords[0]?.id || "",
          words: rangeWords,
          materialType,
          usageItems: makeUsageItems(usageRows, sourceWordMap, uid),
          memoryItems: makeMemoryItems(memoryRows, uid),
          testHistory: []
        };
      }

      function registerRange() {
        const materialType = $("rangeKind").value;
        if (!validateTestDate(true)) return;
        const parsedWords = parseUnifiedRows($("wordInput").value);
        const parsedMemory = parseMemoryRows($("memoryInput").value);
        const hasContent = materialType === "memorization" ? parsedMemory.rows.length : parsedWords.rows.length;
        if (!$("rangeName").value.trim() && !hasContent) {
          toast("教材名か学習内容を入力してください。", true);
          return;
        }
        if (materialType === "memorization" && parsedMemory.invalid) return toast("不完全な暗記構文があります。登録前の確認欄で修正してください。", true);
        if (materialType === "vocabulary" && (parsedWords.invalid || parsedWords.duplicates)) return toast("不完全行または重複行があります。登録前の確認欄で修正してください。", true);
        if (materialType === "memorization" && !parsedMemory.rows.length) return toast("暗記構文を1件以上入力してください。", true);
        if (materialType === "vocabulary" && !parsedWords.rows.length) return toast("例文・熟語を関連付けるため、単語を1語以上入力してください。", true);
        const range = buildRangeFromForm(parsedWords.rows, parsedMemory.rows, materialType);
        state.ranges.push(range);
        save();
        if (materialType === "memorization") {
          toast(`暗記構文${range.memoryItems.length}件を登録しました。`);
        } else {
          const stats = contentStats(range);
          const warnings = [
            parsedWords.duplicates ? `重複${parsedWords.duplicates}行` : "",
            parsedWords.invalid ? `無効${parsedWords.invalid}行` : "",
            stats.unresolved ? `関連ID要確認${stats.unresolved}件` : ""
          ].filter(Boolean).join("、");
          toast(`${range.words.length}語・例文${stats.examples}件・熟語${stats.phrases}件を登録しました。API通信はしていません。${warnings ? ` ${warnings}` : ""}`, Boolean(stats.unresolved));
        }
        switchTab("ranges");
      }

      function isCacheCurrent(word, reference = state.settings.dictionaryType || "learners") {
        return Boolean(
          word.apiFetched &&
          word.cacheVersion === CACHE_SCHEMA_VERSION &&
          word.dictionarySource === reference &&
          Array.isArray(word.definitions)
        );
      }

      function pendingWords(range) {
        const reference = state.settings.dictionaryType || "learners";
        return range.words.filter(w => !isCacheCurrent(w, reference));
      }

      function confirmFetch(range, forceWordId = "", referenceOverride = "") {
        let targets = forceWordId ? range.words.filter(w => w.id === forceWordId) : pendingWords(range);
        const skipped = forceWordId ? 0 : range.words.length - targets.length;
        const reference = referenceOverride || state.settings.dictionaryType || "learners";
        if (!targets.length) {
          toast("未取得の単語はありません。再取得したい場合は単語カードの再取得を使ってください。");
          return;
        }
        const usage = usageRecord();
        const modeLabel = state.settings.demoMode ? "デモモード" : "実APIモード";
        if (!state.settings.demoMode && !getApiKey(reference)) {
          toast(`実APIモードでは${dictionaryLabel(reference)}のAPIキー入力が必要です。API通信はしていません。`, true);
          return;
        }
        if (!state.settings.demoMode && usage.count + targets.length > 1000) {
          toast("今日のAPI使用量が1000回を超える見込みのため停止しました。", true);
          return;
        }
        const caution = !state.settings.demoMode
          ? `<div class="danger-note">実APIに問い合わせます。今回APIに問い合わせる単語数は <strong>${targets.length}語</strong> です。</div>`
          : `<div class="caution">デモモードなので実API通信は行いません。今回のモック取得対象は <strong>${targets.length}語</strong> です。</div>`;
        const highUsage = !state.settings.demoMode && usage.count + targets.length >= 900
          ? `<div class="danger-note">今日の使用量が900回以上になります。単語数を必ず確認してください。</div>` : "";
        showModal(`
          <h2>API取得の確認</h2>
          ${caution}
          ${highUsage}
          <ul>
            <li>範囲名: ${escapeHtml(range.rangeName)}</li>
            <li>テスト日: ${escapeHtml(range.testDate || "-")}</li>
            <li>使用辞書: ${dictionaryLabel(reference)}</li>
            <li>フォールバック辞書: Collegiate Dictionary（自動取得OFF・単語ごとに確認後）</li>
            <li>定義取得: ON（最大${state.settings.definitionLimit}個）</li>
            <li>例文取得: OFF</li>
            <li>モード: ${modeLabel}</li>
            <li>今回APIに問い合わせる単語数: ${targets.length}</li>
            <li>キャッシュ済みでスキップ: ${skipped}</li>
            <li>今日のAPI使用量: ${usage.count}</li>
            <li>取得後の予想使用量: ${state.settings.demoMode ? usage.count : usage.count + targets.length}</li>
          </ul>
          <div class="actions">
            <button class="primary" data-modal-confirm>この内容で取得</button>
            <button class="soft" data-modal-cancel>キャンセル</button>
          </div>
        `, () => fetchWords(range.id, targets.map(w => w.id), reference));
      }

      async function fetchWords(rangeId, wordIds, reference) {
        const range = state.ranges.find(r => r.id === rangeId);
        if (!range || state.fetchingRangeId === rangeId) return;
        state.fetchingRangeId = rangeId;
        const targets = range.words.filter(w => wordIds.includes(w.id));
        let success = 0, audio = 0, noAudio = 0, failed = 0, defYes = 0, defNo = 0, learnersCount = 0, collegiateCount = 0, apiCalls = 0;
        const failureReasons = new Map();
        const renderProgress = (current = "") => {
          const done = success + failed, total = targets.length, pct = total ? Math.floor(done / total * 100) : 100;
          const reasons = done === total && failureReasons.size ? `<div class="danger-note">失敗理由: ${[...failureReasons.entries()].map(([reason, count]) => `${escapeHtml(reason)}（${count}語）`).join(" / ")}</div>` : "";
          const mode = state.settings.demoMode ? `<div class="caution">デモモード中です。実APIを使う場合は設定でデモモードをOFFにしてください。</div>` : "";
          $("modalRoot").innerHTML = `<div class="modal api-progress"><h2>APIデータを取得しています</h2><div>${escapeHtml(range.rangeName || "無題の範囲")}</div><strong>${done} / ${total}語（${pct}%）</strong><div class="api-progress-bar"><span style="width:${pct}%"></span></div><div>現在処理中: ${escapeHtml(current || "完了")}</div><div class="mini-grid"><div class="mini"><strong>${success}</strong>成功</div><div class="mini"><strong>${failed}</strong>失敗</div><div class="mini"><strong>${audio}</strong>音声あり</div><div class="mini"><strong>${noAudio}</strong>音声なし</div><div class="mini"><strong>${defYes}</strong>定義あり</div><div class="mini"><strong>${defNo}</strong>定義なし</div></div>${reasons}${mode}</div>`;
        };
        renderProgress(targets[0]?.word || "");
        for (const word of targets) {
          try {
            const result = state.settings.demoMode ? await fetchDemo(word.normalized, reference) : await fetchReal(word.normalized, getApiKey(reference), reference);
            const { apiCalls: resultApiCalls = 1, ...storedResult } = result;
            apiCalls += state.settings.demoMode ? 0 : resultApiCalls;
            Object.assign(word, storedResult, {
              apiFetched: true,
              cacheVersion: CACHE_SCHEMA_VERSION,
              lastApiFetchedAt: new Date().toISOString(),
              error: result.error || ""
            });
            success++;
            if (word.hasAudio) audio++; else noAudio++;
            if (word.hasDefinition) defYes++; else defNo++;
            if (word.dictionarySource === "collegiate") collegiateCount++; else learnersCount++;
          } catch (err) {
            if (!state.settings.demoMode) apiCalls++;
            word.apiFetched = false;
            word.error = safeApiError(err);
            failureReasons.set(word.error, (failureReasons.get(word.error) || 0) + 1);
            failed++;
          }
          renderProgress(word.word);
        }
        if (!state.settings.demoMode) incrementUsage(apiCalls);
        save();
        renderProgress("完了");
        $("modalRoot").querySelector(".api-progress").insertAdjacentHTML("beforeend", `<div class="actions"><button class="primary" data-progress-close>範囲画面へ戻る</button></div>`);
        $("modalRoot").querySelector("[data-progress-close]").addEventListener("click", closeModal);
        state.fetchingRangeId = "";
        toast(`取得完了: 成功${success} / 失敗${failed} / API通信${apiCalls}。通知は横スワイプで閉じられます。`, failed > 0);
      }

      async function fetchDemo(word, reference = "learners") {
        await new Promise(resolve => setTimeout(resolve, 120));
        const found = demoData[word] || null;
        if (!found) {
          return {
            pronunciationVariants: [],
            pronunciation: "",
            audioId: "",
            audioUrl: "",
            mwUrl: dictionaryUrl(word),
            dictionarySource: reference,
            partOfSpeech: "",
            definitions: [],
            hasDefinition: false,
            hasAudio: false,
            error: "デモデータに情報がありません"
          };
        }
        const definitions = found.defs.slice(0, state.settings.definitionLimit);
        const rawVariants = found.variants || [{ prs: found.prs, sound: found.sound, fl: found.fl, label: "" }];
        const pronunciationVariants = dedupePronunciationVariants(rawVariants.map(item => normalizePronunciationVariant({
          dictionarySource: reference,
          headword: word,
          partOfSpeech: item.fl || found.fl || "",
          label: item.label || "",
          pronunciation: item.prs || "",
          audioId: item.sound || ""
        })));
        const result = {
          pronunciationVariants,
          pronunciation: "",
          audioId: "",
          audioUrl: "",
          mwUrl: dictionaryUrl(word),
          dictionarySource: reference,
          partOfSpeech: "",
          definitions,
          hasDefinition: definitions.length > 0,
          hasAudio: pronunciationVariants.some(variant => variant.audioUrl),
          error: ""
        };
        syncLegacyPronunciationFields(result, reference);
        return result;
      }

      async function fetchReal(word, apiKey, reference = "learners") {
        const cleanedKey = cleanApiKey(apiKey);
        if (!cleanedKey) throw new Error("APIキー未入力です");
        const data = await requestDictionaryApi(word, cleanedKey, reference);
        let apiCalls = 1;
        if (data.length && data.every(item => typeof item === "string")) {
          const fallback = await fetchSuggestionEntry(data, word, cleanedKey, reference);
          if (!fallback) {
            return {
              pronunciationVariants: [],
              pronunciation: "",
              audioId: "",
              audioUrl: "",
              mwUrl: dictionaryUrl(word),
              dictionarySource: reference,
              partOfSpeech: "",
              definitions: [],
              hasDefinition: false,
              hasAudio: false,
              apiCalls,
              error: "単語候補のみ返りました"
            };
          }
          apiCalls += fallback.apiCalls;
          return buildResultFromData(fallback.data, word, reference, apiCalls);
        }
        return buildResultFromData(data, word, reference, apiCalls);
      }

      async function requestDictionaryApi(word, apiKey, reference) {
        const endpoint = `https://www.dictionaryapi.com/api/v3/references/${reference}/json/${encodeURIComponent(word)}?key=${encodeURIComponent(apiKey)}`;
        let response;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            response = await fetch(endpoint);
            if (response.ok || ![429, 500, 502, 503, 504].includes(response.status) || attempt) break;
          } catch (error) {
            if (attempt) throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 650));
        }
        if (!response) throw new Error("ネットワークまたはAPIへの接続に失敗しました");
        if (!response.ok) throw new Error(`APIエラー: HTTP ${response.status}`);
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(text.slice(0, 80) || "APIレスポンスをJSONとして読めません");
        }
        if (!Array.isArray(data)) {
          throw new Error(data.message || data.error || "APIキーまたはレスポンス形式を確認してください");
        }
        return data;
      }

      async function fetchSuggestionEntry(suggestions, word, apiKey, reference) {
        const target = normalizeLookupText(word);
        const candidates = suggestions
          .map(suggestion => String(suggestion || "").trim())
          .filter(Boolean)
          .filter(suggestion => normalizeLookupText(suggestion) !== target)
          .slice(0, 3);
        let apiCalls = 0;
        for (const candidate of candidates) {
          apiCalls++;
          const data = await requestDictionaryApi(candidate, apiKey, reference);
          const match = findBestEntryMatch(data, word);
          if (match) return { data, apiCalls };
        }
        return null;
      }

      function buildResultFromData(data, word, reference, apiCalls) {
        const target = normalizeLookupText(word);
        const entries = data.filter(item => item && typeof item === "object" && item.hwi);
        const related = entries.map(entry => {
          const exactHeadword = normalizeLookupText(entry.hwi?.hw) === target;
          const exactId = normalizeLookupText(String(entry.meta?.id || "").split(":")[0]) === target;
          const stemMatch = (entry.meta?.stems || []).some(stem => normalizeLookupText(stem) === target);
          const derivedSource = !exactHeadword ? findDerivedFormData(entry, word) : null;
          return { entry, exactHeadword, exactId, stemMatch, derivedSource };
        }).filter(item => item.exactHeadword || item.exactId || item.stemMatch || item.derivedSource);

        if (!related.length) {
          return emptyPronunciationResult(word, reference, apiCalls, "単語自体が見つかりません");
        }

        const variants = [];
        const definitions = [];
        related.forEach(item => {
          const source = item.exactHeadword ? item.entry : item.derivedSource;
          if (item.exactHeadword) variants.push(...collectEntryPronunciationVariants(item.entry, word, reference));
          else if (source) variants.push(...collectDerivedPronunciationVariants(item.entry, source, word, reference));
          definitions.push(...extractDefinitions(source || item.entry));
        });
        const pronunciationVariants = dedupePronunciationVariants(variants);
        const uniqueDefinitions = [...new Set(definitions)].slice(0, state.settings.definitionLimit);
        const hasAudio = pronunciationVariants.some(variant => variant.audioUrl);
        const hasPronunciation = pronunciationVariants.some(variant => variant.pronunciation);
        let error = "";
        if (!pronunciationVariants.length) error = "辞書項目はありますが発音情報がありません";
        else if (!hasAudio) error = "発音表記はありますが公式音声がありません";
        else if (!hasPronunciation) error = "音声はありますが発音表記がありません";

        const result = {
          pronunciationVariants,
          pronunciation: "",
          audioId: "",
          audioUrl: "",
          mwUrl: dictionaryUrl(word),
          dictionarySource: reference,
          partOfSpeech: "",
          definitions: uniqueDefinitions,
          hasDefinition: uniqueDefinitions.length > 0,
          hasAudio,
          apiCalls,
          error
        };
        syncLegacyPronunciationFields(result, reference);
        return result;
      }

      function emptyPronunciationResult(word, reference, apiCalls, error) {
        return {
          pronunciationVariants: [],
          pronunciation: "",
          audioId: "",
          audioUrl: "",
          mwUrl: dictionaryUrl(word),
          dictionarySource: reference,
          partOfSpeech: "",
          definitions: [],
          hasDefinition: false,
          hasAudio: false,
          apiCalls,
          error
        };
      }

      function collectEntryPronunciationVariants(entry, word, reference) {
        const headword = cleanHeadword(entry.hwi?.hw || String(entry.meta?.id || "").split(":")[0] || word);
        const partOfSpeech = entry.fl || "";
        const variants = [];
        const add = (pronunciations, label = "") => {
          (pronunciations || []).forEach(pron => {
            variants.push(normalizePronunciationVariant({
              dictionarySource: reference,
              headword,
              partOfSpeech,
              label,
              pronunciation: pronunciationText(pron, reference),
              audioId: pron.sound?.audio || ""
            }));
          });
        };
        add(entry.hwi?.prs, "");
        (entry.ahws || []).forEach(ahw => add(ahw.prs, cleanHeadword(ahw.hw || ahw.va || "")));
        (entry.vrs || []).forEach(variant => add(variant.prs, cleanHeadword(variant.va || variant.vl || variant.hw || "")));
        return variants;
      }

      function collectDerivedPronunciationVariants(entry, source, word, reference) {
        const label = cleanHeadword(source.if || source.va || source.ure || source.drp || source.hw || word);
        return collectObjectPronunciations(source).map(pron => normalizePronunciationVariant({
          dictionarySource: reference,
          headword: cleanHeadword(entry.hwi?.hw || word),
          partOfSpeech: source.fl || entry.fl || "",
          label,
          pronunciation: pronunciationText(pron, reference),
          audioId: pron.sound?.audio || ""
        }));
      }

      function findBestEntryMatch(data, word) {
        const target = normalizeLookupText(word);
        const entries = data.filter(item => item && typeof item === "object" && item.hwi);
        const headword = entries.find(item => entryLookupTerms(item).some(term => normalizeLookupText(term) === target));
        if (headword) return { entry: headword, kind: "headword" };
        const stem = entries.find(item => {
          const stems = Array.isArray(item.meta?.stems) ? item.meta.stems : [];
          return stems.some(term => normalizeLookupText(term) === target);
        });
        return stem ? { entry: stem, kind: "stem" } : null;
      }

      function findDerivedFormData(entry, word) {
        const target = normalizeLookupText(word);
        const formKeys = ["if", "hw", "va", "ure", "drp"];
        const queue = [entry];
        const seen = new Set();
        const candidates = [];
        while (queue.length) {
          const item = queue.shift();
          if (!item || typeof item !== "object") continue;
          if (seen.has(item)) continue;
          seen.add(item);
          if (item !== entry && formKeys.some(key => normalizeLookupText(item[key]) === target)) candidates.push(item);
          Object.values(item).forEach(value => {
            if (Array.isArray(value)) value.forEach(child => queue.push(child));
            else if (value && typeof value === "object") queue.push(value);
          });
        }
        return candidates.find(item => collectObjectPronunciations(item).some(pr => pr.sound?.audio))
          || candidates.find(item => collectObjectPronunciations(item).length)
          || candidates.find(item => extractDefinitions(item).length)
          || candidates[0]
          || null;
      }

      function entryLookupTerms(entry) {
        const terms = [];
        if (entry.meta?.id) terms.push(String(entry.meta.id).split(":")[0]);
        if (entry.hwi?.hw) terms.push(entry.hwi.hw);
        return terms;
      }

      function normalizeLookupText(value) {
        return String(value || "")
          .toLowerCase()
          .split(":")[0]
          .replace(/\*|\s+/g, "")
          .replace(/[^a-z0-9]/g, "");
      }

      function collectObjectPronunciations(item) {
        return Array.isArray(item?.prs) ? item.prs.filter(Boolean) : [];
      }

      function extractDefinitions(entry) {
        const defs = [];
        if (Array.isArray(entry.shortdef)) defs.push(...entry.shortdef);
        const appShortdef = entry.meta?.["app-shortdef"]?.def;
        if (Array.isArray(appShortdef)) defs.push(...appShortdef);
        defs.push(...definitionTexts(entry.def));
        return [...new Set(defs.map(cleanDefinition).filter(Boolean))];
      }

      function definitionTexts(value) {
        const defs = [];
        const walk = (item) => {
          if (!item) return;
          if (Array.isArray(item)) {
            if (item[0] === "text" && typeof item[1] === "string") {
              defs.push(item[1]);
              return;
            }
            item.forEach(walk);
            return;
          }
          if (typeof item === "object") Object.values(item).forEach(walk);
        };
        walk(value);
        return defs;
      }

      function cleanDefinition(text) {
        return String(text || "")
          .replace(/\{bc\}/g, "")
          .replace(/\{\/?it\}/g, "")
          .replace(/\{\/?wi\}/g, "")
          .replace(/\{phrase\}([^{}]+)\{\/phrase\}/g, "$1")
          .replace(/\{sx\|([^|{}]+)\|[^{}]*\|[^{}]*\}/g, "$1")
          .replace(/\{a_link\|([^{}]+)\}/g, "$1")
          .replace(/\{[^}]+\}/g, "")
          .replace(/\s+/g, " ")
          .trim();
      }

      function clearCache(rangeId) {
        const range = state.ranges.find(r => r.id === rangeId);
        if (!range) return;
        showModal(`
          <h2>APIキャッシュ削除</h2>
          <div class="caution">削除対象: 発音候補、発音表記、音声ID、音声URL、品詞、定義、使用辞書、API取得状態、エラー、取得日時。</div>
          <p>残るデータ: 単語、範囲名、テスト日、ページ範囲、現在位置、苦手・覚えた状態。</p>
          <p>対象範囲: <strong>${escapeHtml(range.rangeName)}</strong> / ${range.words.length}語</p>
          <div class="actions">
            <button class="warn" data-modal-confirm>キャッシュのみ削除</button>
            <button class="soft" data-modal-cancel>キャンセル</button>
          </div>
        `, () => {
          range.words.forEach(w => {
            w.pronunciation = "";
            w.audioId = "";
            w.audioUrl = "";
            w.pronunciationVariants = [];
            w.dictionarySource = "";
            w.partOfSpeech = "";
            w.definitions = [];
            w.hasDefinition = false;
            w.cacheVersion = 0;
            w.apiFetched = false;
            w.hasAudio = false;
            w.error = "";
            w.lastApiFetchedAt = "";
          });
          range.cacheClearedAt = new Date().toISOString();
          save();
          toast("APIキャッシュのみ削除しました。");
        });
      }

      function deleteRange(rangeId) {
        const range = state.ranges.find(r => r.id === rangeId);
        if (!range) return;
        showModal(`
          <h2>範囲削除</h2>
          <div class="danger-note">単語リストごと削除します。この操作は元に戻せません。</div>
          <p>対象: <strong>${escapeHtml(range.rangeName)}</strong> / ${range.words.length}語</p>
          <div class="actions">
            <button class="danger" data-modal-confirm>削除する</button>
            <button class="soft" data-modal-cancel>キャンセル</button>
          </div>
        `, () => {
          stopContinuousPlayback();
          state.ranges = state.ranges.filter(r => r.id !== rangeId);
          if (state.selectedRangeId === rangeId) state.selectedRangeId = null;
          save();
          $("wordPanel").classList.add("hidden");
          toast("範囲を削除しました。");
        });
      }

      function playOfficial(wordId) {
        stopContinuousPlayback();
        const word = findWord(wordId);
        if (!word || !word.audioUrl) return;
        rememberWord(wordId);
        stopPreviewAudio();
        previewAudio = new Audio(word.audioUrl);
        previewAudio.onended = () => { previewAudio = null; };
        previewAudio.play().catch(() => {
          previewAudio = null;
          if (!speakWordText(word.word)) toast("公式音声と端末読み上げを再生できませんでした。", true);
        });
      }

      function playPronunciationVariant(wordId, variantId) {
        stopContinuousPlayback();
        const word = findWord(wordId);
        const variant = word?.pronunciationVariants?.find(item => item.id === variantId);
        if (!word || !variant?.audioUrl) return;
        rememberWord(wordId);
        stopPreviewAudio();
        previewAudio = new Audio(variant.audioUrl);
        previewAudio.onended = () => { previewAudio = null; };
        previewAudio.play().catch(() => {
          previewAudio = null;
          if (!speakWordText(word.word)) toast("この発音の公式音声を再生できませんでした。", true);
        });
      }

      function speakWord(wordId) {
        const word = findWord(wordId);
        if (!word || !speakWordText(word.word)) {
          toast("このブラウザでは読み上げに対応していません。", true);
          return;
        }
        rememberWord(wordId);
      }

      function stopPreviewAudio() {
        if (previewAudio) {
          previewAudio.onended = null;
          previewAudio.onerror = null;
          previewAudio.pause();
          previewAudio.removeAttribute("src");
          previewAudio = null;
        }
        if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      }

      function speakWordText(text) {
        if (!text || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
        stopPreviewAudio();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        const voices = window.speechSynthesis.getVoices?.() || [];
        utterance.voice = voices.find(voice => /^en-US\b/i.test(voice.lang)) || voices.find(voice => /^en\b/i.test(voice.lang)) || null;
        window.speechSynthesis.speak(utterance);
        return true;
      }

      function rememberWord(wordId) {
        const range = findRangeByWord(wordId);
        if (!range) return;
        state.selectedRangeId = range.id;
        range.currentWordId = wordId;
        save(false);
        updateCurrentWord(wordId);
      }

      function updateCurrentWord(wordId) {
        document.querySelectorAll(".word-card.current-word").forEach(card => card.classList.remove("current-word"));
        document.querySelector(`[data-word-id="${CSS.escape(wordId)}"]`)?.classList.add("current-word");
      }

      function goToNextWord(wordId) {
        const range = findRangeByWord(wordId);
        if (!range) return;
        const words = filteredWords(range);
        const index = words.findIndex(w => w.id === wordId);
        const next = words[index + 1] || words[0];
        if (!next) return;
        rememberWord(next.id);
        document.querySelector(`[data-word-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function toggleStudyStatus(wordId, status) {
        stopContinuousPlayback();
        const word = findWord(wordId);
        if (!word || !["hard", "known"].includes(status)) return;
        rememberWord(wordId);
        word.studyStatus = word.studyStatus === status ? "unrated" : status;
        save();
      }

      function updatePlaybackControls() {
        const start = $("continuousStart");
        const stop = $("continuousStop");
        const dock = $("playbackDock");
        const pause = $("playbackPause");
        if (!start || !stop || !dock || !pause) return;
        start.setAttribute("aria-pressed", String(playbackState.active));
        start.textContent = playbackState.active ? (playbackState.paused ? "連続再生 一時停止中" : "連続再生中") : "連続再生開始";
        stop.disabled = !playbackState.active;
        dock.classList.toggle("hidden", !playbackState.active);
        document.body.classList.toggle("playback-active", playbackState.active);
        pause.textContent = playbackState.paused ? "再開" : "一時停止";
        pause.disabled = !playbackState.active;
        const word = findWord(playbackState.currentWordId);
        const extra = playbackState.phase === "reviewing" ? Number(state.settings.usageReviewExtraSeconds) || 0 : 0;
        $("playbackDockWord").textContent = word ? `${word.word}${extra ? `・例文熟語 +${extra}秒` : ""}` : "連続再生";
        $("playbackDockProgress").textContent = playbackState.active ? `${Math.min(playbackState.currentIndex + 1, playbackState.wordIds.length)} / ${playbackState.wordIds.length}` : "0 / 0";
      }

      function setContinuousUsageOpen(wordId = "") {
        document.querySelectorAll("details.linked-usage[data-linked-usage-word]").forEach(details => {
          details.open = Boolean(wordId && details.dataset.linkedUsageWord === wordId);
        });
      }

      function stopContinuousPlayback() {
        if (playbackState.timerId) clearTimeout(playbackState.timerId);
        playbackState.timerId = null;
        if (playbackState.currentAudio) {
          playbackState.currentAudio.onended = null;
          playbackState.currentAudio.onerror = null;
          playbackState.currentAudio.pause();
          playbackState.currentAudio.removeAttribute("src");
        }
        playbackState.active = false;
        playbackState.currentAudio = null;
        playbackState.rangeId = "";
        playbackState.wordIds = [];
        playbackState.currentIndex = 0;
        playbackState.currentWordId = "";
        playbackState.paused = false;
        playbackState.phase = "idle";
        setContinuousUsageOpen();
        stopPreviewAudio();
        updatePlaybackControls();
      }

      function toggleContinuousPause() {
        if (!playbackState.active) return;
        if (!playbackState.paused) {
          playbackState.paused = true;
          if (playbackState.timerId) clearTimeout(playbackState.timerId);
          playbackState.timerId = null;
          if (playbackState.phase === "playing") playbackState.currentAudio?.pause();
          updatePlaybackControls();
          return;
        }
        playbackState.paused = false;
        updatePlaybackControls();
        if (playbackState.phase === "playing" && playbackState.currentAudio?.src) {
          playbackState.currentAudio.play().catch(() => scheduleNextContinuousWord());
        } else {
          scheduleNextContinuousWord();
        }
      }

      function startContinuousPlayback() {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const words = filteredWords(range);
        if (!words.length) return toast("連続再生できる単語がありません。", true);
        const currentIndex = Math.max(0, words.findIndex(word => word.id === range.currentWordId));
        playbackState.active = true;
        playbackState.currentAudio = new Audio();
        playbackState.rangeId = range.id;
        playbackState.wordIds = words.map(word => word.id);
        playbackState.currentIndex = currentIndex;
        playbackState.paused = false;
        playbackState.phase = "idle";
        updatePlaybackControls();
        playContinuousWord(true);
      }

      function playContinuousWord(isFirst = false) {
        if (!playbackState.active || playbackState.paused) return;
        while (playbackState.currentIndex < playbackState.wordIds.length) {
          const word = findWord(playbackState.wordIds[playbackState.currentIndex]);
          const officialAudioUrl = word ? officialAudioUrlForWord(word) : "";
          if (word && officialAudioUrl) {
            setContinuousUsageOpen(word.id);
            playbackState.currentWordId = word.id;
            playbackState.phase = "playing";
            rememberWord(word.id);
            document.querySelector(`[data-word-id="${CSS.escape(word.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            const audio = playbackState.currentAudio;
            audio.onended = scheduleNextContinuousWord;
            audio.onerror = scheduleNextContinuousWord;
            audio.src = officialAudioUrl;
            audio.currentTime = 0;
            audio.play().catch(() => {
              if (isFirst) {
                stopContinuousPlayback();
                toast("連続再生を開始できませんでした。もう一度開始を押してください。", true);
                return;
              }
              scheduleNextContinuousWord();
            });
            updatePlaybackControls();
            return;
          }
          playbackState.currentIndex++;
        }
        stopContinuousPlayback();
        toast("連続再生が完了しました。");
      }

      function scheduleNextContinuousWord() {
        if (!playbackState.active) return;
        if (playbackState.timerId) return;
        if (playbackState.currentAudio) {
          playbackState.currentAudio.onended = null;
          playbackState.currentAudio.onerror = null;
        }
        const range = state.ranges.find(item => item.id === playbackState.rangeId);
        const usageCount = linkedUsageItemsForWord(range, playbackState.currentWordId).length;
        const extraSeconds = usageCount ? Number(state.settings.usageReviewExtraSeconds) || 0 : 0;
        const delaySeconds = (Number(state.settings.playbackInterval) || 2) + extraSeconds;
        const nextIndex = playbackState.currentIndex + 1;
        playbackState.phase = extraSeconds ? "reviewing" : "waiting";
        updatePlaybackControls();
        if (playbackState.paused) return;
        playbackState.timerId = setTimeout(() => {
          playbackState.timerId = null;
          if (nextIndex >= playbackState.wordIds.length) {
            stopContinuousPlayback();
            toast("連続再生が完了しました。");
            return;
          }
          playbackState.currentIndex = nextIndex;
          playContinuousWord();
        }, delaySeconds * 1000);
      }

      function findWord(wordId) {
        for (const range of state.ranges) {
          const word = range.words.find(w => w.id === wordId);
          if (word) return word;
        }
        return null;
      }

      function findRangeByWord(wordId) {
        return state.ranges.find(r => r.words.some(w => w.id === wordId));
      }

      function exportJson() {
        try {
          const payload = createBackup({ settings: state.settings, ranges: state.ranges, studyLog: state.studyLog, ui: { selectedRangeId: state.selectedRangeId || "" } });
          const text = JSON.stringify(payload, null, 2);
          download(`mw-pronunciation-${todayKey()}.json`, text, "application/json");
          toast(`学習履歴・設定を含むschema v${payload.schemaVersion}のJSONを書き出しました。APIキーは含まれていません。サイズ: ${formatBytes(new Blob([text]).size)}`);
        } catch (error) {
          toast(`JSONの作成に失敗しました: ${error.message}`, true);
        }
      }

      function exportCsv() {
        const rows = [["範囲名", "テスト日", "単語", "日本語訳", "学習状態", "品詞・発音一覧", "音声数", "使用辞書", "発音表記", "品詞", "定義1", "定義2", "定義3", "音声あり", "定義あり", "英→日 回答", "英→日 正解", "英→日 不正解", "日→英 回答", "日→英 正解", "日→英 不正解"]];
        state.ranges.forEach(r => r.words.forEach(w => rows.push([
          r.rangeName,
          r.testDate,
          w.word,
          (w.meaningsJa || []).join("／"),
          studyStatusLabel(w.studyStatus),
          pronunciationVariantsSummary(w),
          (w.pronunciationVariants || []).filter(variant => variant.audioUrl).length,
          dictionaryLabel(w.dictionarySource || ""),
          w.pronunciation,
          w.partOfSpeech || "",
          w.definitions?.[0] || "",
          w.definitions?.[1] || "",
          w.definitions?.[2] || "",
          w.hasAudio ? "1" : "0",
          w.hasDefinition ? "1" : "0",
          w.testStats?.enToJa?.attempts || 0,
          w.testStats?.enToJa?.correct || 0,
          w.testStats?.enToJa?.incorrect || 0,
          w.testStats?.jaToEn?.attempts || 0,
          w.testStats?.jaToEn?.correct || 0,
          w.testStats?.jaToEn?.incorrect || 0
        ])));
        const csv = rows.map(row => row.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
        download(`mw-pronunciation-${todayKey()}.csv`, csv, "text/csv");
      }

      function exportQuizlet() {
        const examples = state.ranges.flatMap(range => (range.usageItems || []).filter(item => item.type === "example"));
        if (!examples.length) return toast("Quizlet用に出力できる例文がありません。", true);
        const text = examples.map(item => `${item.english}\t${item.japanese}`).join("\n");
        download(`quizlet-examples-${todayKey()}.txt`, text, "text/plain");
        toast(`例文${examples.length}件をQuizlet形式で書き出しました。熟語と管理IDは含みません。`);
      }

      function exportPreUpgrade() {
        const raw = localStorage.getItem(PRE_SUPERAPP_BACKUP_KEY);
        if (!raw) return toast("この端末には改修前データの自動保存がありません。通常のJSON保存を使ってください。", true);
        download(`mw-before-superapp-${todayKey()}.json`, raw, "application/json");
        toast("改修前データを書き出しました。APIキーは含まれていません。");
      }

      function restorePreUpgrade() {
        const raw = localStorage.getItem(PRE_SUPERAPP_BACKUP_KEY);
        if (!raw) return toast("改修前データの自動保存がありません。", true);
        restoreStoredBackup(raw, "改修前データ");
      }

      function restorePreImport() {
        const raw = localStorage.getItem(PRE_IMPORT_BACKUP_KEY);
        if (!raw) return toast("前回インポート前の自動保存がありません。", true);
        restoreStoredBackup(raw, "前回インポート前");
      }

      function restoreStoredBackup(raw, label) {
        const migrated = parseBackup(raw);
        if (!migrated.ok) return toast(`${label}を安全に復元できません: ${migrated.errors[0]}`, true);
        showModal(`<h2>${escapeHtml(label)}へ戻す</h2><div class="danger-note">現在の学習データを置き換えます。必要なら先に現在のJSONを書き出してください。</div><div class="actions"><button class="warn" data-modal-confirm>復元する</button><button class="soft" data-modal-cancel>キャンセル</button></div>`, () => {
          try {
            const payload = createBackup(migrated.data);
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, savedAt: new Date().toISOString() }));
            location.reload();
          } catch (error) {
            toast(`復元に失敗しました: ${error.message}`, true);
          }
        });
      }

      function studyStatusLabel(status) {
        if (status === "hard") return "苦手";
        if (status === "known") return "覚えた";
        return "未判定";
      }

      function pronunciationVariantsSummary(word) {
        return (word.pronunciationVariants || []).map(variant => {
          const label = variant.partOfSpeech || variant.label || "発音";
          return `${label}: ${variant.pronunciation || "表記なし"}`;
        }).join(" | ");
      }

      function download(filename, text, type) {
        const blob = new Blob([text], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }

      function updateBackupImportPreview(mode = "append") {
        const root = $("backupImportPreview");
        const text = $("importJson").value;
        if (!text.trim()) {
          root.className = "import-preview";
          root.innerHTML = `<span class="meta">JSONを貼り付けると、変更前に範囲数・単語数・重複・移行内容を確認できます。</span>`;
          return null;
        }
        const plan = planImport(text, state.ranges, mode);
        root.className = `import-preview ${plan.ok ? "valid" : "invalid"}`;
        if (!plan.ok) {
          const modeHint = mode === "append" ? `<div class="meta">これは「追加」としての判定です。全体を復元する場合は「置き換えインポート」を押すと別に再検証します。</div>` : "";
          root.innerHTML = `<strong>${mode === "append" ? "追加できません" : "読み込めません"}</strong><ul class="import-issues">${plan.errors.slice(0, 8).map(error => `<li>${escapeHtml(error)}</li>`).join("")}</ul>${modeHint}`;
          return plan;
        }
        root.innerHTML = `<strong>検証済み</strong><div class="import-preview-counts"><span>範囲 ${plan.summary.ranges}件</span><span>単語 ${plan.summary.words}語</span><span>重複スキップ ${plan.summary.duplicates}件</span></div>${plan.warnings.length ? `<ul class="import-issues">${plan.warnings.slice(0, 8).map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}`;
        return plan;
      }

      function commitImport(plan, replace) {
        const base = replace ? plan.data : {
          settings: state.settings,
          ranges: [...state.ranges, ...plan.incoming],
          studyLog: state.studyLog,
          ui: { selectedRangeId: state.selectedRangeId || "" }
        };
        const combined = migrateBackup({ schemaVersion: STORAGE_SCHEMA_VERSION, ...base });
        if (!combined.ok) return toast(`インポート候補を統合できません: ${combined.errors[0]}`, true);
        const currentRaw = localStorage.getItem(STORAGE_KEY);
        const previousPreImport = localStorage.getItem(PRE_IMPORT_BACKUP_KEY);
        try {
          const payload = createBackup(combined.data);
          if (currentRaw) localStorage.setItem(PRE_IMPORT_BACKUP_KEY, currentRaw);
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...payload, savedAt: new Date().toISOString() }));
          location.reload();
        } catch (error) {

          try {
            if (previousPreImport == null) localStorage.removeItem(PRE_IMPORT_BACKUP_KEY);
            else localStorage.setItem(PRE_IMPORT_BACKUP_KEY, previousPreImport);
          } catch {
            // The primary data was never replaced; keep the original error visible.
          }
          toast(`保存領域を変更せず中止しました: ${error.message}`, true);
        }
      }

      function importJson(replace) {
        const plan = updateBackupImportPreview(replace ? "replace" : "append");
        if (!plan?.ok) return toast(plan?.errors?.[0] || "JSONを入力してください。", true);
        if (!replace && !plan.incoming.length) return toast("追加できる新しい範囲がありません。重複範囲は変更していません。", true);
        const verb = replace ? "置き換え" : "追加";
        showModal(`<h2>${verb}インポート</h2><p>範囲 ${plan.summary.ranges}件・単語 ${plan.summary.words}語を${verb}します。</p>${plan.summary.duplicates ? `<div class="caution">重複 ${plan.summary.duplicates}件はスキップします。</div>` : ""}${plan.warnings.length ? `<ul>${plan.warnings.slice(0, 8).map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}${replace ? `<div class="danger-note">現在の範囲・履歴・設定をバックアップ内容で置き換えます。直前状態は自動保存します。</div>` : `<div class="meta">現在の設定と学習ログは維持します。</div>`}<div class="actions"><button class="${replace ? "warn" : "primary"}" data-modal-confirm>${verb}する</button><button class="soft" data-modal-cancel>キャンセル</button></div>`, () => commitImport(plan, replace));
      }

      function wipeAll() {
        showModal(`
          <h2>全データ削除</h2>
          <div class="danger-note">範囲、単語、進捗、APIキャッシュをすべて削除します。APIキーは別ボタンで削除できます。</div>
          <div class="actions"><button class="danger" data-modal-confirm>全データ削除</button><button class="soft" data-modal-cancel>キャンセル</button></div>
        `, () => {
          stopContinuousPlayback();
          state.ranges = [];
          state.selectedRangeId = null;
          save();
          $("wordPanel").classList.add("hidden");
          toast("全データを削除しました。");
        });
      }

      function switchTab(name) {
        stopContinuousPlayback();
        document.querySelectorAll("[data-tab]").forEach(btn => btn.setAttribute("aria-selected", String(btn.dataset.tab === name)));
        document.querySelectorAll(".tab-page").forEach(page => page.classList.add("hidden"));
        $(`page-${name}`).classList.remove("hidden");
        if (name === "ranges" && state.selectedRangeId) {
          renderWords();
        } else {
          $("wordPanel").classList.add("hidden");
        }
      }

      function currentTab() {
        return document.querySelector("[data-tab][aria-selected='true']")?.dataset.tab || "ranges";
      }

      function bindEvents() {
        document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
        $("saveApiSettings").addEventListener("click", () => {
          const wantsSave = $("saveKey").checked;
          const apiKey = cleanApiKey($("apiKey").value);
          const collegiateApiKey = cleanApiKey($("collegiateApiKey").value);
          const apply = () => {
            state.settings.demoMode = $("demoMode").checked;
            state.settings.saveKey = wantsSave;
            state.settings.dictionaryType = $("dictionaryType").value;
            state.settings.definitionLimit = Number($("definitionLimit").value) || 2;
            state.settings.mondayEndTime = $("mondayEndTime").value;
            state.settings.wednesdayEndTime = $("wednesdayEndTime").value;
            state.settings.fridayEndTime = $("fridayEndTime").value;
            state.settings.apiKeySession = wantsSave ? "" : apiKey;
            state.settings.collegiateApiKeySession = wantsSave ? "" : collegiateApiKey;
            $("apiKey").value = apiKey;
            $("collegiateApiKey").value = collegiateApiKey;
            if (wantsSave && apiKey) localStorage.setItem(API_KEY_KEY, apiKey);
            if (wantsSave && collegiateApiKey) localStorage.setItem(COLLEGIATE_API_KEY_KEY, collegiateApiKey);
            if (!wantsSave) {
              localStorage.removeItem(API_KEY_KEY);
              localStorage.removeItem(COLLEGIATE_API_KEY_KEY);
            }
            save();
            toast("API設定を保存しました。保存だけではAPI通信しません。");
          };
          if (wantsSave && (apiKey || collegiateApiKey)) {
            showModal(`
              <h2>APIキー保存の確認</h2>
              <div class="caution">このブラウザのlocalStorageにAPIキーを保存します。共有端末では保存しないでください。</div>
              <div class="actions"><button class="warn" data-modal-confirm>保存する</button><button class="soft" data-modal-cancel>キャンセル</button></div>
            `, apply);
          } else apply();
        });
        $("clearApiKey").addEventListener("click", () => showModal(`
          <h2>APIキー削除</h2>
          <p>保存済みAPIキーと一時入力を削除します。</p>
          <div class="actions"><button class="danger" data-modal-confirm>削除する</button><button class="soft" data-modal-cancel>キャンセル</button></div>
        `, () => {
          $("apiKey").value = "";
          $("collegiateApiKey").value = "";
          state.settings.apiKeySession = "";
          state.settings.collegiateApiKeySession = "";
          localStorage.removeItem(API_KEY_KEY);
          localStorage.removeItem(COLLEGIATE_API_KEY_KEY);
          save();
          toast("APIキーを削除しました。");
        }));
        $("testDate").addEventListener("change", () => {
          if (validateTestDate(false)) $("deleteAt").value = deleteAtFor($("testDate").value, $("weekday").value);
        });
        $("rangeKind").addEventListener("change", () => {
          const isMemory = $("rangeKind").value === "memorization";
          $("vocabImportFields").classList.toggle("hidden", isMemory);
          $("memoryImportFields").classList.toggle("hidden", !isMemory);
          validateTestDate(false);
          updateImportPreview();
        });
        $("wordInput").addEventListener("input", updateImportPreview);
        $("memoryInput").addEventListener("input", updateImportPreview);
        $("importRange").addEventListener("click", registerRange);
        $("clearImport").addEventListener("click", () => {
          ["rangeName", "testDate", "pages", "deleteAt", "wordInput", "memoryInput"].forEach(id => $(id).value = "");
          $("weekday").value = "";
          $("dateValidation").textContent = "";
          $("testDate").setCustomValidity("");
          updateImportPreview();
        });
        $("rangeFilter").addEventListener("change", renderRanges);
        $("rangeList").addEventListener("click", (event) => {
          const btn = event.target.closest("button[data-action]");
          if (!btn) return;
          const range = state.ranges.find(r => r.id === btn.dataset.id);
          if (!range) return;
          if (btn.dataset.action === "open") { stopContinuousPlayback(); state.selectedRangeId = range.id; state.pendingWordScroll = true; save(false); renderWords(); $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" }); }
          if (btn.dataset.action === "ready") { stopContinuousPlayback(); state.selectedRangeId = range.id; save(false); startTestReadyReview("enToJa"); }
          if (btn.dataset.action === "fetch") confirmFetch(range);
          if (btn.dataset.action === "test-ended") { range.manualTestEndedDate = todayKey(); save(); toast("テスト終了として記録しました。次の範囲を優先します。"); }
          if (btn.dataset.action === "test-before") { range.manualTestEndedDate = ""; save(); toast("テスト前として記録しました。"); }
          if (btn.dataset.action === "clear-cache") clearCache(range.id);
          if (btn.dataset.action === "delete-range") deleteRange(range.id);
        });
        $("openNext").addEventListener("click", () => {
          stopContinuousPlayback();
          const id = nextRangeId();
          if (!id) return toast("次回の範囲がありません。");
          state.selectedRangeId = id;
          state.pendingWordScroll = true;
          save(false);
          renderWords();
          $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        $("closeWords").addEventListener("click", () => { stopContinuousPlayback(); state.selectedRangeId = null; save(false); $("wordPanel").classList.add("hidden"); });
        $("wordFilter").addEventListener("change", () => {
          stopContinuousPlayback();
          state.temporaryWordIds = null;
          state.savedFilterBeforeTemporary = null;
          state.settings.studyFilter = $("wordFilter").value;
          save();
        });
        $("playbackInterval").addEventListener("change", () => {
          state.settings.playbackInterval = Number($("playbackInterval").value) || 2;
          save(false);
        });
        $("usageReviewExtraSeconds").addEventListener("change", () => {
          state.settings.usageReviewExtraSeconds = Number($("usageReviewExtraSeconds").value) || 0;
          save(false);
        });
        $("continuousStart").addEventListener("click", startContinuousPlayback);
        $("continuousStop").addEventListener("click", stopContinuousPlayback);
        $("playbackPause").addEventListener("click", toggleContinuousPause);
        $("playbackDockStop").addEventListener("click", stopContinuousPlayback);
        $("jumpTop").addEventListener("click", () => {
          $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        $("jumpBottom").addEventListener("click", () => {
          const cards = $("wordList").querySelectorAll(".word-card");
          const last = cards[cards.length - 1];
          last?.scrollIntoView({ behavior: "smooth", block: "end" });
        });
        $("startUsageStudy").addEventListener("click", startUsageStudy);
        $("startWordStudy").addEventListener("click", startWordStudy);
        $("startWordSpeed").addEventListener("click", startSpeedReview);
        $("startUsageSpeed").addEventListener("click", startUsageSpeedReview);
        $("startSelectedMode").addEventListener("click", startSelectedLearningMode);
        $("testContent").addEventListener("click", event => {
          const session = state.activeTest;
          if (!session) return;
          const range = state.ranges.find(item => item.id === session.rangeId);
          const choice = event.target.closest("[data-test-choice]");
          if (choice) {
            const answer = answerTestQuestion(session, range, Number(choice.dataset.testChoice));
            if (answer) { updateTestStats(range, answer); showAnsweredTest(answer); }
            return;
          }
          const audio = event.target.closest("[data-test-audio]");
          if (audio) return playTestAudio(testWord(range, audio.dataset.testAudio));
          const hard = event.target.closest("[data-test-hard]");
          if (hard) { const word = testWord(range, hard.dataset.testHard); word.studyStatus = "hard"; save(false); hard.setAttribute("aria-pressed", "true"); return; }
          const action = event.target.closest("[data-test-action]")?.dataset.testAction;
          if (action === "replay") playTestAudio(testWord(range, session.questions[Math.min(session.index, session.questions.length - 1)].wordId));
          if (action === "next") nextTestQuestion();
          if (action === "abort") showModal(`<h2>テストを中止しますか？</h2><p>回答済みの成績は残りますが、テスト履歴には追加されません。</p><div class="actions"><button class="danger" data-modal-confirm>中止する</button><button class="soft" data-modal-cancel>続ける</button></div>`, () => { abortTest(session); leaveTest(); });
          if (action === "return") leaveTest();
          if (action === "open-wrong") leaveTest(true);
          if (action === "hard-all") { session.answers.filter(answer => !answer.correct).forEach(answer => { testWord(range, answer.wordId).studyStatus = "hard"; }); save(false); toast("間違えた単語を苦手にしました。"); }
          if (action === "repeat") startTest(session.direction, session.mode || "normal");
        });
        let speedSwipeHandledUntil = 0;
        $("speedContent").addEventListener("click", event => {
          if (Date.now() < speedSwipeHandledUntil) return;
          const action = event.target.closest("[data-speed-action]")?.dataset.speedAction;
          if (action === "audio") return playTestAudio(speedReviewWord());
          if (action === "meaning") {
            state.speedMeaningVisible = !state.speedMeaningVisible;
            return renderSpeedReview();
          }
          if (action === "usage") {
            state.speedUsageVisible = !state.speedUsageVisible;
            return renderSpeedReview();
          }
          if (action === "abort") return showModal(`<h2>高速周回を終了しますか？</h2><p>ここまでの即答・怪しい・知らないの判定は保存済みです。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, leaveSpeedReview);
          if (action === "return") return leaveSpeedReview();
          if (action === "repeat") return restartSpeedReview();
          const rating = event.target.closest("[data-speed-rating]")?.dataset.speedRating;
          if (rating) return rateCurrentSpeedWord(rating);
          if (event.target.closest("[data-speed-card]")) {
            state.speedMeaningVisible = !state.speedMeaningVisible;
            renderSpeedReview();
          }
        });
        let speedPointerStart = null;
        $("speedContent").addEventListener("pointerdown", event => {
          const card = event.target.closest("[data-speed-card]");
          if (!card) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          speedPointerStart = { x: event.clientX, y: event.clientY, card };
        });
        $("speedContent").addEventListener("pointerup", event => {
          if (!speedPointerStart) return;
          const { x, y } = speedPointerStart;
          const dx = event.clientX - x;
          const dy = event.clientY - y;
          speedPointerStart = null;
          if (Math.abs(dx) >= 60 && Math.abs(dx) > Math.abs(dy)) {
            event.preventDefault();
            speedSwipeHandledUntil = Date.now() + 400;
            rateCurrentSpeedWord(dx > 0 ? "instant" : "unknown");
          } else if (dy <= -60 && Math.abs(dy) > Math.abs(dx)) {
            event.preventDefault();
            speedSwipeHandledUntil = Date.now() + 400;
            rateCurrentSpeedWord("unsure");
          }
        });
        $("speedContent").addEventListener("pointercancel", () => { speedPointerStart = null; });
        $("spellingContent").addEventListener("submit", event => {
          if (!event.target.matches("#spellingForm")) return;
          event.preventDefault();
          submitSpellingAnswer(new FormData(event.target).get("answer"));
        });
        $("spellingContent").addEventListener("click", event => {
          const action = event.target.closest("[data-spelling-action]")?.dataset.spellingAction;
          if (!action) return;
          if (action === "next") {
            const session = state.spellingSession;
            const range = state.ranges.find(item => item.id === session?.rangeId);
            state.spellingFeedback = null;
            if (session?.finished && range) state.spellingResult = finishSpellingSession(session, range, Date.now());
            save(false);
            return renderSpellingReview();
          }
          if (action === "audio") {
            const wordId = state.spellingFeedback?.wordId || state.spellingSession?.wordIds?.[state.spellingSession?.index];
            return playTestAudio(findWord(wordId));
          }
          if (action === "repeat") return startSpellingReview();
          if (action === "return") return leaveSpellingReview();
          if (action === "abort") return showModal(`<h2>スペル確認を終了しますか？</h2><p>回答済みの履歴は保存し、未回答は残します。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, finishPartialSpellingReview);
        });
        $("recallContent").addEventListener("click", event => {
          const studyAction = event.target.closest("[data-study-action]")?.dataset.studyAction;
          if (studyAction === "audio") {
            const session = activeStudySession();
            const range = state.ranges.find(item => item.id === session?.rangeId);
            return session === state.wordStudySession ? playTestAudio(currentWordStudyWord()) : playUsageLinkedWordAudio(range, currentUsageStudyItem());
          }
          if (studyAction === "repeat") return state.wordStudySession ? startWordStudy() : startUsageStudy();
          if (studyAction === "return") return state.wordStudySession ? leaveWordStudy() : leaveUsageStudy();
          if (studyAction === "abort") return showModal(`<h2>学習モードを終了しますか？</h2><p>このモードでは採点や定着履歴を記録していません。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, state.wordStudySession ? leaveWordStudy : leaveUsageStudy);
          const rating = event.target.closest("[data-recall-rating]")?.dataset.recallRating;
          if (rating) return rateCurrentRecall(rating);
          const action = event.target.closest("[data-recall-action]")?.dataset.recallAction;
          if (action === "audio") {
            const session = state.recallSession;
            const range = state.ranges.find(item => item.id === session?.rangeId);
            return playUsageLinkedWordAudio(range, currentRecallItem());
          }
          if (action === "reveal") {
            state.recallSession.answerVisible = true;
            return renderRecall();
          }
          if (action === "repeat") {
            const previous = state.recallSession;
            return startRecall(previous.source, previous.mode, previous.type);
          }
          if (action === "return") return leaveRecall();
          if (action === "abort") return showModal(`<h2>全文暗唱を終了しますか？</h2><p>ここまでの○・△・×は保存されています。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, leaveRecall);
        });
        let usageStudyPointerStart = null;
        $("recallContent").addEventListener("pointerdown", event => {
          const card = event.target.closest("[data-study-card]");
          if (!card || !activeStudySession()) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          usageStudyPointerStart = { x: event.clientX, y: event.clientY, card };
        });
        $("recallContent").addEventListener("pointermove", event => {
          if (!usageStudyPointerStart) return;
          const dx = Math.min(0, event.clientX - usageStudyPointerStart.x);
          const dy = event.clientY - usageStudyPointerStart.y;
          if (Math.abs(dx) <= Math.abs(dy)) return;
          usageStudyPointerStart.card.style.transform = `translateX(${dx}px) rotate(${dx / 35}deg)`;
          usageStudyPointerStart.card.style.opacity = String(Math.max(0.35, 1 + dx / 360));
        });
        $("recallContent").addEventListener("pointerup", event => {
          if (!usageStudyPointerStart) return;
          const { x, y, card } = usageStudyPointerStart;
          usageStudyPointerStart = null;
          const dx = event.clientX - x;
          const dy = event.clientY - y;
          card.style.transform = "";
          card.style.opacity = "";
          if (dx <= -60 && Math.abs(dx) > Math.abs(dy)) {
            if (state.wordStudySession) advanceWordStudy();
            else advanceUsageStudy();
          }
        });
        $("recallContent").addEventListener("pointercancel", () => {
          if (usageStudyPointerStart?.card) {
            usageStudyPointerStart.card.style.transform = "";
            usageStudyPointerStart.card.style.opacity = "";
          }
          usageStudyPointerStart = null;
        });
        document.addEventListener("keydown", event => {
          if (!state.speedSession || state.speedSession.finished || event.repeat) return;
          if (event.target.closest?.("button, input, select, textarea")) return;
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            state.speedMeaningVisible = !state.speedMeaningVisible;
            renderSpeedReview();
          }
          if (event.key === "1") rateCurrentSpeedWord("unknown");
          if (event.key === "2") rateCurrentSpeedWord("unsure");
          if (event.key === "3") rateCurrentSpeedWord("instant");
        });
        $("wordList").addEventListener("click", event => {
          const btn = event.target.closest("button[data-word-action]");
          if (!btn) {
            const card = event.target.closest(".word-card[data-word-id]");
            if (card) rememberWord(card.dataset.wordId);
            return;
          }
          const word = findWord(btn.dataset.id);
          if (!word) return;
          if (btn.dataset.wordAction === "play") playOfficial(word.id);
          if (btn.dataset.wordAction === "variant-play") playPronunciationVariant(word.id, btn.dataset.variantId);
          if (btn.dataset.wordAction === "next") goToNextWord(word.id);
          if (btn.dataset.wordAction === "speak") speakWord(word.id);
          if (btn.dataset.wordAction === "hard") toggleStudyStatus(word.id, "hard");
          if (btn.dataset.wordAction === "known") toggleStudyStatus(word.id, "known");
          if (btn.dataset.wordAction === "mw") { rememberWord(word.id); window.open(word.mwUrl || dictionaryUrl(word.normalized), "_blank", "noopener"); }
          if (btn.dataset.wordAction === "refetch") {
            const range = findRangeByWord(word.id);
            if (range) {
              confirmFetch(range, word.id);
            }
          }
          if (btn.dataset.wordAction === "refetch-collegiate") {
            const range = findRangeByWord(word.id);
            if (range) {
              confirmFetch(range, word.id, "collegiate");
            }
          }
        });
        $("exportJson").addEventListener("click", exportJson);
        $("exportCsv").addEventListener("click", exportCsv);
        $("exportQuizlet").addEventListener("click", exportQuizlet);
        $("exportPreUpgrade").addEventListener("click", exportPreUpgrade);
        $("restorePreUpgrade").addEventListener("click", restorePreUpgrade);
        $("restorePreImport").addEventListener("click", restorePreImport);
        $("importJson").addEventListener("input", () => updateBackupImportPreview("append"));
        $("appendJson").addEventListener("click", () => importJson(false));
        $("replaceJson").addEventListener("click", () => importJson(true));
        $("wipeAll").addEventListener("click", wipeAll);
        let toastStartX = null;
        $("toast").addEventListener("pointerdown", event => { event.currentTarget.setPointerCapture?.(event.pointerId); toastStartX = event.clientX; });
        $("toast").addEventListener("pointerup", event => {
          if (toastStartX !== null && Math.abs(event.clientX - toastStartX) >= 48) dismissToast();
          toastStartX = null;
        });
        $("toast").addEventListener("pointercancel", () => { toastStartX = null; });
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) stopContinuousPlayback();
          else render();
        });
        window.addEventListener("focus", render);
      }

      load();
      bindEvents();
      render();
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
            // PWA登録に失敗しても通常のWebアプリとして使えます。
          });
        });
      }
    })();
  

