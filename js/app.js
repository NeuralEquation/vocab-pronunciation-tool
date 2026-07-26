
var { createTestSession, renderTestQuestion, answerTestQuestion, finishTest, abortTest, analyzeSpellingRisk, createSpeedReviewSession, restartSpeedReviewSession, rateSpeedReviewWord, runTestFeatureSelfCheck } = window.MWTest;
window.runTestFeatureSelfCheck = runTestFeatureSelfCheck;

    (() => {
      "use strict";

      const STORAGE_KEY = "mwPronunciationTool.v1";
      const API_USAGE_KEY = "mwPronunciationTool.apiUsage.v1";
      const API_KEY_KEY = "mwPronunciationTool.apiKey.v1";
      const COLLEGIATE_API_KEY_KEY = "mwPronunciationTool.collegiateApiKey.v1";
      const CACHE_SCHEMA_VERSION = 7;
      const TEST_WORD_LIMIT = 3;
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
        settings: { demoMode: true, saveKey: false, apiKeySession: "", collegiateApiKeySession: "", dictionaryType: "learners", definitionLimit: 2, studyFilter: "all", playbackInterval: 2, mondayEndTime: "", wednesdayEndTime: "", fridayEndTime: "" },
        studyLog: {},
        fetchingRangeId: "",
        selectedRangeId: null,
        lastImportWords: [],
        activeTest: null,
        speedSession: null,
        speedMeaningVisible: false,
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
        return { attempts: 0, correct: 0, incorrect: 0, consecutiveCorrect: 0, lastResult: "", lastTestedAt: "", totalResponseMs: 0, confusedWith: {} };
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
          testStats: { enToJa: emptyDirectionStats(), jaToEn: emptyDirectionStats() }
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
            const parsed = JSON.parse(raw);
            state.ranges = Array.isArray(parsed.ranges) ? parsed.ranges : [];
            normalizeLoadedData();
            const savedSelectedRangeId = String(parsed.ui?.selectedRangeId || "");
            state.selectedRangeId = state.ranges.some(range => range.id === savedSelectedRangeId) ? savedSelectedRangeId : null;
            state.pendingWordScroll = Boolean(state.selectedRangeId);
            state.settings.demoMode = parsed.settings?.demoMode !== false;
            state.settings.saveKey = parsed.settings?.saveKey === true;
            state.settings.dictionaryType = parsed.settings?.dictionaryType || "learners";
            state.settings.definitionLimit = Number(parsed.settings?.definitionLimit) || 2;
            state.settings.studyFilter = ["all", "unrated", "hard", "known"].includes(parsed.settings?.studyFilter) ? parsed.settings.studyFilter : "all";
            state.settings.playbackInterval = [1, 2, 3].includes(Number(parsed.settings?.playbackInterval)) ? Number(parsed.settings.playbackInterval) : 2;
            ["mondayEndTime", "wednesdayEndTime", "fridayEndTime"].forEach(key => state.settings[key] = /^\d{2}:\d{2}$/.test(parsed.settings?.[key] || "") ? parsed.settings[key] : "");
            state.studyLog = parsed.studyLog && typeof parsed.studyLog === "object" ? parsed.studyLog : {};
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
          $("mondayEndTime").value = state.settings.mondayEndTime;
          $("wednesdayEndTime").value = state.settings.wednesdayEndTime;
          $("fridayEndTime").value = state.settings.fridayEndTime;
        } catch (err) {
          toast("保存データの読み込みに失敗しました。JSONの破損があるかもしれません。");
        }
      }

      function save(shouldRender = true) {
        const payload = {
          version: 1,
          savedAt: new Date().toISOString(),
          settings: {
            demoMode: state.settings.demoMode,
            saveKey: state.settings.saveKey,
            dictionaryType: state.settings.dictionaryType,
            definitionLimit: state.settings.definitionLimit,
            studyFilter: state.settings.studyFilter,
            playbackInterval: state.settings.playbackInterval,
            mondayEndTime: state.settings.mondayEndTime, wednesdayEndTime: state.settings.wednesdayEndTime, fridayEndTime: state.settings.fridayEndTime
          },
          ranges: state.ranges,
          studyLog: state.studyLog,
          ui: { selectedRangeId: state.selectedRangeId || "" }
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
            ["enToJa", "jaToEn"].forEach(direction => { word.testStats[direction] = { ...emptyDirectionStats(), ...(word.testStats[direction] || {}), confusedWith: { ...(word.testStats[direction]?.confusedWith || {}) } }; });
            word.hasDefinition = Boolean(word.hasDefinition || word.definitions.length);
            word.cacheVersion = Number(word.cacheVersion) || 0;
            word.mwUrl = word.mwUrl || dictionaryUrl(word.normalized || word.word || "");
            syncLegacyPronunciationFields(word, word.dictionarySource || state.settings.dictionaryType);
            ["checked", "hard", "play" + "Count", "last" + "CheckedAt"].forEach(key => delete word[key]);
          });
          const savedWordExists = range.words.some(word => word.id === range.currentWordId);
          range.currentWordId = savedWordExists ? range.currentWordId : range.words[0]?.id || "";
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

      function statusForRange(range, nextId) {
        if (!range.words.length) return "単語未登録";
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
          .filter(r => r.words.length && r.testDate >= today && !(r.testDate === today && isRangeEnded(r, new Date())))
          .sort((a, b) => a.testDate.localeCompare(b.testDate));
        return candidates[0]?.id || "";
      }

      function statsForRange(range) {
        const words = range.words || [];
        const total = words.length;
        const fetched = words.filter(w => isCacheCurrent(w, w.dictionarySource || state.settings.dictionaryType || "learners")).length;
        const audio = words.filter(w => w.hasAudio).length;
        const noAudio = words.filter(w => w.apiFetched && !w.hasAudio).length;
        const definitions = words.filter(w => w.hasDefinition).length;
        const hard = words.filter(w => w.studyStatus === "hard").length;
        const known = words.filter(w => w.studyStatus === "known").length;
        const unseen = words.fil…16416 tokens truncated…      }

      function findRangeByWord(wordId) {
        return state.ranges.find(r => r.words.some(w => w.id === wordId));
      }

      function exportJson() {
        const payload = {
          version: 2,
          exportedAt: new Date().toISOString(),
          ranges: state.ranges
        };
        const text = JSON.stringify(payload, null, 2);
        download(`mw-pronunciation-${todayKey()}.json`, text, "application/json");
        toast(`JSONを書き出しました。APIキーは含まれていません。サイズ: ${formatBytes(new Blob([text]).size)}`);
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

      function importJson(replace) {
        try {
          const parsed = JSON.parse($("importJson").value);
          const incoming = Array.isArray(parsed.ranges) ? parsed.ranges : [];
          if (!incoming.length) {
            toast("インポートできる範囲が見つかりません。", true);
            return;
          }
          const run = () => {
            state.ranges = replace ? incoming : state.ranges.concat(incoming);
            normalizeLoadedData();
            save();
            toast(`${incoming.length}件の範囲を${replace ? "置き換え" : "追加"}インポートしました。APIキーは読み込みません。`);
          };
          if (replace) {
            showModal(`
              <h2>置き換えインポート</h2>
              <div class="danger-note">現在のデータをすべて置き換えます。</div>
              <div class="actions"><button class="warn" data-modal-confirm>置き換える</button><button class="soft" data-modal-cancel>キャンセル</button></div>
            `, run);
          } else {
            run();
          }
        } catch {
          toast("JSONの読み込みに失敗しました。", true);
        }
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
          const testDate = $("testDate").value;
          const weekday = testDate ? weekdays[new Date(`${testDate}T12:00:00`).getDay()] : "";
          if (!$("weekday").value) $("weekday").value = weekday;
          $("deleteAt").value = deleteAtFor(testDate, $("weekday").value || weekday);
        });
        $("weekday").addEventListener("change", () => { $("deleteAt").value = deleteAtFor($("testDate").value, $("weekday").value); });
        $("importRange").addEventListener("click", registerRange);
        $("clearImport").addEventListener("click", () => {
          ["rangeName", "testDate", "pages", "deleteAt", "wordInput"].forEach(id => $(id).value = "");
          $("weekday").value = "";
        });
        $("rangeFilter").addEventListener("change", renderRanges);
        $("rangeList").addEventListener("click", (event) => {
          const btn = event.target.closest("button[data-action]");
          if (!btn) return;
          const range = state.ranges.find(r => r.id === btn.dataset.id);
          if (!range) return;
          if (btn.dataset.action === "open") { stopContinuousPlayback(); state.selectedRangeId = range.id; state.pendingWordScroll = true; save(false); renderWords(); $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" }); }
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
        $("startSpeedReview").addEventListener("click", startSpeedReview);
        $("startEnToJa").addEventListener("click", () => startTest("enToJa"));
        $("startJaToEn").addEventListener("click", () => startTest("jaToEn"));
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
          if (action === "abort") return showModal(`<h2>高速周回を終了しますか？</h2><p>高速周回の判定は保存されていません。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, leaveSpeedReview);
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
          if (!event.target.closest("[data-speed-card]")) return;
          speedPointerStart = { x: event.clientX, y: event.clientY };
        });
        $("speedContent").addEventListener("pointerup", event => {
          if (!speedPointerStart || !event.target.closest("[data-speed-card]")) return;
          const dx = event.clientX - speedPointerStart.x;
          const dy = event.clientY - speedPointerStart.y;
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
        $("appendJson").addEventListener("click", () => importJson(false));
        $("replaceJson").addEventListener("click", () => importJson(true));
        $("wipeAll").addEventListener("click", wipeAll);
        let toastStartX = null;
        $("toast").addEventListener("pointerdown", event => { toastStartX = event.clientX; });
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
  

