var {
  createTestSession, renderTestQuestion, answerTestQuestion, finishTest, abortTest,
  analyzeSpellingRisk, createSpeedReviewSession, restartSpeedReviewSession, rateSpeedReviewWord,
  defaultDirectionStats, normalizeDirectionStats, applyDirectionAttempt,
  normalizeSpellingStats, evaluateSpellingAnswer, createSpellingSession, answerSpellingQuestion,
  finishSpellingSession, applySpellingAttempt,
  readinessForRange: wordReadinessForRange, runTestFeatureSelfCheck
} = window.MWTest;
window.runTestFeatureSelfCheck = runTestFeatureSelfCheck;
var { parseUnifiedRows, parseMemoryRows, makeUsageItems, makeMemoryItems, normalizeRangeContent, isSettled, createRecallSession, rateRecallItem, contentStats, runContentSelfCheck } = window.MWContent;
window.runContentFeatureSelfCheck = runContentSelfCheck;
var { SCHEMA_VERSION: STORAGE_SCHEMA_VERSION, APP_VERSION, migrateBackup, parseBackup, planImport, createBackup, createLocalSnapshot, assertNoSecrets, assertStorageSize, safeStoredError, csvCell, runStorageSelfCheck } = window.MWStorage;
window.runStorageSelfCheck = runStorageSelfCheck;
var { calculateUsageReviewDelayMs } = window.MWPlayback;

    (() => {
      "use strict";

      const STORAGE_KEY = "mwPronunciationTool.v1";
      const PRE_SUPERAPP_BACKUP_KEY = "mwPronunciationTool.preSuperappBackup.v1";
      const PRE_IMPORT_BACKUP_KEY = "mwPronunciationTool.preImportBackup.v1";
      const PRE_RESTORE_BACKUP_KEY = "mwPronunciationTool.preRestoreBackup.v1";
      const API_USAGE_KEY = "mwPronunciationTool.apiUsage.v1";
      const API_KEY_KEY = "mwPronunciationTool.apiKey.v1";
      const COLLEGIATE_API_KEY_KEY = "mwPronunciationTool.collegiateApiKey.v1";
      const CACHE_SCHEMA_VERSION = 7;
      const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

      const demoData = {
        example: { hw: "ex*am*ple", prs: "ɪgˈzæmpəl", sound: "exampl01", fl: "noun", defs: ["something chosen to show what a group is like", "a person or way of behaving that should be copied"] },
        audio: { hw: "au*dio", prs: "ˈɑːdiˌoʊ", sound: "audio001", fl: "adjective", defs: ["relating to sound that is heard or recorded"] },
        pronunciation: { hw: "pro*nun*ci*a*tion", prs: "prəˌnʌnsiˈeɪʃən", sound: "pronun02", fl: "noun", defs: ["the way in which a word or name is pronounced"] },
        apple: { hw: "ap*ple", prs: "ˈæpəl", sound: "apple001", fl: "noun", defs: ["a round fruit with red, yellow, or green skin and firm white flesh"] },
        science: { hw: "sci*ence", prs: "ˈsaɪəns", sound: "scienc02", fl: "noun", defs: ["knowledge about or study of the natural world based on facts learned through experiments"] },
        diligent: { hw: "dil*i*gent", prs: "ˈdɪlɪdʒənt", sound: "dilige01", fl: "adjective", defs: ["showing care and effort in your work or duties"] },
        record: {
          hw: "rec*ord",
          defs: ["a written account of something", "to write down information for future use"],
          variants: [
            { prs: "ˈrekərd", sound: "record01", fl: "noun", label: "" },
            { prs: "rɪˈkɔːrd", sound: "record02", fl: "verb", label: "" }
          ]
        }
      };

      const state = {
        ranges: [],
        settings: { demoMode: true, saveKey: false, apiKeySession: "", collegiateApiKeySession: "", dictionaryType: "learners", definitionLimit: 2, speechVoiceURI: "", speechRate: 1, studyFilter: "all", playbackInterval: 2, usageReviewMode: "auto", usageReviewExtraSeconds: 5, mondayEndTime: "", wednesdayEndTime: "", fridayEndTime: "" },
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
        currentUtterance: null,
        exampleTexts: [],
        exampleIndex: -1,
        timerId: null,
        timerStartedAt: 0,
        timerDueAt: 0,
        remainingDelayMs: 0,
        rangeId: "",
        wordIds: [],
        currentIndex: -1,
        currentWordId: "",
        paused: false,
        phase: "idle",
        transport: "none",
        resumeAction: "none",
        operationToken: 0
      };
      let continuousWatchdog = null;
      const previewPlayer = window.MWPlayback.createPreviewPlayer(window, message => {
        const label = document.getElementById("audioStatus");
        if (label) label.textContent = message;
      }, speechOptions);
      let lastAutoSpokenSpeedKey = "";
      let lastAutoSpokenUsageKey = "";
      let lastAutoSpokenStudyWordKey = "";
      let sessionReturnFocus = null;
      const persistence = { writer: false, lockState: "pending", lockError: "", startupError: "", loaded: false, readError: false, conflict: false, dirty: false, credentialError: false, raw: null, message: "保存領域を確認しています。" };
      let syncClient = null;
      let syncRuntime = "";
      const SYNC_ENDPOINT_KEY = "mwPronunciationTool.syncEndpoint.v1";
      const PRE_SYNC_KEY = "mwPronunciationTool.preSyncBackup.v1";
      let releaseWriter = null;
      let apiController = null;
      let actualApiCalls = 0;
      const dictionaryClient = window.MWDictionary.createClient();
      let modalReturnFocus = null;

      const $ = (id) => document.getElementById(id);
      const playbackClock = window.__MWPlaybackTestClock || {
        now: () => performance.now(),
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: timerId => window.clearTimeout(timerId)
      };

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
          syllabifiedHeadword: "",
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
        if (/^[^A-Za-z]/.test(audioId)) subdir = "number";
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
          syllabifiedHeadword: String(variant?.syllabifiedHeadword || fallback.syllabifiedHeadword || variant?.headword || fallback.headword || "").trim(),
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

      function pronunciationChoices(word) {
        const imported = (word?.pronunciations || []).map((item, index) => normalizePronunciationVariant({
          id: `imported_${word.id}_${index}`, headword: word.word, partOfSpeech: item.partOfSpeech,
          pronunciation: item.ipa, audioId: item.audioId, label: "教材"
        }));
        return [...imported, ...(word?.pronunciationVariants || [])];
      }

      function preferredPronunciationVariant(word, reference = state.settings.dictionaryType || "learners", cacheOnly = false, requestedPart = "") {
        const part = cacheOnly ? "" : requestedPart || window.MWStorage.pronunciationPartOfSpeech(word);
        const variants = (cacheOnly ? word?.pronunciationVariants || [] : pronunciationChoices(word)).filter(item => !part || window.MWStorage.partOfSpeechMatches(item.partOfSpeech, part));
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
        const preferred = preferredPronunciationVariant(word, reference, true);
        word.pronunciation = preferred?.pronunciation || "";
        word.syllabifiedHeadword = preferred?.syllabifiedHeadword || word.syllabifiedHeadword || "";
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
        if (keyMatch) { try { return decodeURIComponent(keyMatch[1]).trim(); } catch { return keyMatch[1].trim(); } }
        return text;
      }

      function dictionaryLabel(reference) {
        if (!reference) return "";
        return reference === "collegiate" ? "Collegiate Dictionary" : "Learner's Dictionary";
      }

      function load() {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          persistence.raw = raw;
          if (raw) {
            const migrated = parseBackup(raw);
            if (!migrated.ok) throw new Error(migrated.errors.join(" "));
            state.settings = { ...state.settings, ...migrated.data.settings };
            state.studyLog = migrated.data.studyLog;
            state.ranges = migrated.data.ranges;
            normalizeLoadedData();
            const savedSelectedRangeId = String(migrated.data.ui?.selectedRangeId || "");
            state.selectedRangeId = state.ranges.some(range => range.id === savedSelectedRangeId) ? savedSelectedRangeId : null;
            state.pendingWordScroll = Boolean(state.selectedRangeId);
            // A failed optional recovery copy must not prevent reading valid data.
            try {
              if (persistence.writer && !localStorage.getItem(PRE_SUPERAPP_BACKUP_KEY)) localStorage.setItem(PRE_SUPERAPP_BACKUP_KEY, raw);
            } catch {
              persistence.message = "学習データは読み込めましたが、自動退避を作れません。JSON保存をおすすめします。";
            }
          }
          if (state.settings.saveKey) {
            $("apiKey").value = localStorage.getItem(API_KEY_KEY) || "";
            $("collegiateApiKey").value = localStorage.getItem(COLLEGIATE_API_KEY_KEY) || "";
          }
          $("demoMode").checked = state.settings.demoMode;
          $("saveKey").checked = state.settings.saveKey;
          $("dictionaryType").value = state.settings.dictionaryType;
          $("definitionLimit").value = String(state.settings.definitionLimit);
          renderSpeechSettings(state.settings.speechVoiceURI);
          $("speechRate").value = String(state.settings.speechRate);
          $("wordFilter").value = state.settings.studyFilter;
          $("playbackInterval").value = String(state.settings.playbackInterval);
          $("usageReviewMode").value = state.settings.usageReviewMode;
          $("usageReviewExtraSeconds").value = String(state.settings.usageReviewExtraSeconds);
          updateUsageTimingSettings();
          $("mondayEndTime").value = state.settings.mondayEndTime;
          $("wednesdayEndTime").value = state.settings.wednesdayEndTime;
          $("fridayEndTime").value = state.settings.fridayEndTime;
          persistence.loaded = true;
        } catch (err) {
          persistence.readError = true;
          persistence.message = "保存データを読み込めないため、上書きを停止しています。保存タブから正常なバックアップを復元してください。元データは保持しています。";
        }
        renderPersistence();
      }

      function renderPersistence() {
        renderSync();
        const root = $("saveStatus");
        if (!root) return;
        root.dataset.state = persistence.readError || persistence.startupError ? "recovery" : !persistence.writer || persistence.conflict ? "readonly" : persistence.dirty ? "unsaved" : "saved";
        $("saveStatusText").textContent = persistence.readError ? persistence.message
          : persistence.startupError ? `画面の初期化でエラーが起きたため、上書きを停止しています。JSONで退避してから再読込してください。診断コード: ${persistence.startupError}`
          : !persistence.writer ? ({
            busy: "別の画面が保存を使用中です。この画面は閲覧専用です。ほかの画面を閉じて、このアプリに戻ってください。",
            unsupported: "この環境では安全な保存機能を利用できません。この画面は閲覧専用です。ブラウザを更新して開き直してください。",
            error: `保存機能を開始できませんでした。この画面は閲覧専用です。「保存機能を再試行」を押してください。診断コード: ${persistence.lockError}`,
            released: "アプリの復帰時に保存機能を確認します。",
            pending: "保存領域を確認しています。"
          }[persistence.lockState] || "保存機能を確認しています。")
          : persistence.conflict ? "別の画面でデータが変更されました。上書きを停止しました。未保存の内容はJSONで退避してから再読込してください。"
          : persistence.credentialError ? "APIキーを保存できませんでした。設定画面からキーの保存を再試行してください。学習データはJSONで退避できます。"
          : persistence.dirty ? "未保存です。この画面を閉じず、再試行するかJSONで退避してください。"
          : persistence.message || "端末に保存済み";
        $("retrySave").hidden = !persistence.dirty || persistence.credentialError || persistence.readError || persistence.startupError || persistence.conflict || !persistence.writer;
        $("retryStorage").hidden = Boolean(persistence.writer || persistence.startupError || !["busy", "error"].includes(persistence.lockState));
      }

      function canWrite(recovery = false) {
        if (!persistence.writer || persistence.startupError || persistence.conflict || (persistence.readError && !recovery)) { renderPersistence(); return false; }
        try {
          if (localStorage.getItem(STORAGE_KEY) !== persistence.raw) {
            persistence.conflict = true;
            renderPersistence();
            return false;
          }
          return true;
        } catch {
          persistence.message = "保存領域へアクセスできません。元データの上書きを停止しています。";
          persistence.readError = true;
          renderPersistence();
          return false;
        }
      }

      function localSecrets() {
        const values = [state.settings.apiKeySession, state.settings.collegiateApiKeySession, $("apiKey")?.value, $("collegiateApiKey")?.value];
        // Failure to inspect credentials must fail closed for every output path.
        values.push(localStorage.getItem(API_KEY_KEY), localStorage.getItem(COLLEGIATE_API_KEY_KEY), localStorage.getItem(SYNC_ENDPOINT_KEY), $("syncEndpoint")?.value);
        return values.filter(Boolean).map(cleanApiKey);
      }

      function currentData() {
        return { settings: state.settings, ranges: state.ranges, studyLog: state.studyLog, ui: { selectedRangeId: state.selectedRangeId || "" } };
      }

      function storedSync() {
        const record = JSON.parse(persistence.raw || "{}");
        return window.MWSync.inspect(record.sync, Number(record.revision) || 0, persistence.raw != null).sync;
      }

      function renderSync() {
        const label = $("syncStatus");
        if (!label || !window.MWSync) return;
        try {
          const sync = storedSync();
          const status = syncRuntime || window.MWSync.display(sync);
          const labels = { disconnected: "未接続", dirty: "端末に未送信の変更があります", unknown: "送信結果が不明です。結果照会または同じ要求を再試行してください", rejected: "サーバーが保存を拒否しました。要求を退避・解除できます", committed: "クラウド保存確認済み。端末の確定処理を再試行してください", syncing: "同期中（学習は続けられます）", verified: "クラウド最新版を直近の通信で確認済み", "local-clean": "端末に未送信変更なし（クラウド最新版は未確認）", conflict: "競合：自動では統合しません", changed: "同期中に端末が変更されたため適用を中止しました", SYNC_FAILED: "通信・認証・保存に失敗しました。未確定要求は結果照会してください", SECRET: "秘密情報を検出したため送信を中止しました", MALFORMED: "同期データの形式が不正です", NON_CANONICAL: "受信データと端末保存形式が一致しないため停止しました", RECOVERY_REQUIRED: "同期の復旧が必要です。学習・JSON保存は続けられます", "recovery-required": "同期情報を隔離しました。学習は続けられます。同期には明示的な再接続が必要です", "dataset-mismatch": "接続先データセットが異なります。再接続・復旧が必要です", DATASET_MISMATCH: "接続先データセットが異なります", SIZE: "同期データがサイズ上限を超えています" };
          label.dataset.state = status;
          label.textContent = `${labels[status] || status} ｜ server ${sync.serverRevision} / base ${sync.baseRevision} / local ${sync.localRevision} / dirty ${sync.dirty}`;
          ["syncConnect", "syncReconnect", "syncPush", "syncPull", "syncKeepLocal", "syncUseRemote", "syncCheck", "syncCancel", "syncClear"].forEach(id => { if ($(id)) $(id).disabled = Boolean(syncClient?.isBusy()) || !persistence.writer || persistence.readError || persistence.startupError || persistence.conflict || persistence.dirty; });
        } catch { label.dataset.state = "recovery"; label.textContent = "同期メタデータを読み込めません。端末JSONを退避し、復旧手順を確認してください。"; }
      }

      function archiveSync(kind, value) {
        const key = `mwPronunciationTool.syncArchive.${kind}.${crypto.randomUUID()}`;
        const raw = JSON.stringify(value);
        localStorage.setItem(key, raw);
        if (localStorage.getItem(key) !== raw) throw new Error("RECOVERY_REQUIRED");
      }

      function quarantineSync(record) {
        if (window.MWSync.inspect(record.sync, Number(record.revision) || 0).quarantine) archiveSync("quarantine", record.sync);
      }

      function initializeSync() {
        if (!window.MWSync) return;
        try { $("syncEndpoint").value = localStorage.getItem(SYNC_ENDPOINT_KEY) || ""; } catch { /* Keep disabled configuration; no request. */ }
        $("syncEndpoint").disabled = Boolean(window.MW_GAS_HOST);
        let reconnecting = false;
        syncClient = window.MWSync.createClient({
          read: () => {
            if (!canWrite() || persistence.dirty) throw new Error("RECOVERY");
            const record = JSON.parse(persistence.raw || "{}");
            return { data: JSON.parse(JSON.stringify(currentData())), sync: record.sync, revision: Number(record.revision) || 0, hasData: persistence.raw != null };
          },
          secrets: localSecrets,
          archive: archiveSync,
          canApply: () => !state.activeTest && !state.speedSession && !state.spellingSession && !state.recallSession && !state.usageStudySession && !state.wordStudySession && !state.fetchingRangeId,
          id: () => crypto.randomUUID().replace(/-/g, ""),
          status: status => { syncRuntime = status; renderSync(); queueMicrotask(renderSync); },
          write: (data, sync, recovery) => {
            if (!canWrite() || persistence.dirty) throw new Error("RECOVERY");
            const record = JSON.parse(persistence.raw || "{}");
            quarantineSync(record);
            const snapshot = createLocalSnapshot(data);
            if (sync.verified) {
              const originalRanges = state.ranges;
              try {
                state.ranges = JSON.parse(JSON.stringify(snapshot.ranges));
                normalizeLoadedData();
                const normalized = { ...snapshot, ranges: state.ranges };
                if (window.MWSyncProtocol.canonical(window.MWSync.project(normalized, localSecrets())) !== window.MWSyncProtocol.canonical(window.MWSync.project(data, localSecrets()))) throw new Error("NON_CANONICAL");
              } finally { state.ranges = originalRanges; }
            }
            if (sync.verified && window.MWSyncProtocol.canonical(window.MWSync.project(snapshot, localSecrets())) !== window.MWSyncProtocol.canonical(window.MWSync.project(data, localSecrets()))) throw new Error("NON_CANONICAL");
            const raw = JSON.stringify({ ...snapshot, savedAt: new Date().toISOString(), revision: (Number(record.revision) || 0) + 1, sync });
            assertNoSecrets(raw, localSecrets()); assertStorageSize(raw);
            if (recovery && persistence.raw != null) localStorage.setItem(PRE_SYNC_KEY, persistence.raw);
            localStorage.setItem(STORAGE_KEY, raw);
            persistence.raw = raw;
            renderSync();
          },
          send: request => {
            const endpoint = $("syncEndpoint").value.trim();
            const previous = localStorage.getItem(SYNC_ENDPOINT_KEY) || "";
            if (!window.MW_GAS_HOST) {
              if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) throw new Error("MALFORMED");
              // Bind the outbox and its revision history to one server, including after reload.
              if (previous && previous !== endpoint && !(reconnecting && request.op === "connect")) throw new Error("RECOVERY_REQUIRED");
              localStorage.setItem(SYNC_ENDPOINT_KEY, endpoint);
            }
            return window.MWSync.transport(endpoint)(request);
          },
          applied: () => location.reload()
        });
        const invoke = action => { syncRuntime = ""; action().catch(() => {}).finally(renderSync); };
        $("syncConnect").addEventListener("click", () => invoke(() => syncClient.connect()));
        $("syncCheck").addEventListener("click", () => invoke(() => syncClient.status()));
        const confirmSync = (id, title, message, action) => $(id).addEventListener("click", () => showModal(`<h2>${title}</h2><p>${message}</p><button data-modal-confirm>実行する</button><button data-modal-cancel>キャンセル</button>`, () => invoke(action)));
        confirmSync("syncClear", "拒否された要求を解除", "保存されなかった要求を端末内へ退避して解除します。学習データは残ります。", () => syncClient.clearRejected());
        confirmSync("syncCancel", "未確定要求の取消を照会", "すでに保存済みなら結果を回収します。未保存ならサーバーに拒否記録を作り、遅れた要求の保存も防ぎます。通信できない間は解除しません。", () => syncClient.status(true));
        confirmSync("syncReconnect", "同期を再接続・復旧", "以前の同期情報を端末内へ退避します。以前のサーバーで送信が完了していた可能性は残ります。端末の学習を未送信として保持し、クラウドとは自動統合しません。接続先を確認してください。", async () => { reconnecting = true; try { return await syncClient.connect(true); } finally { reconnecting = false; } });
        $("syncPush").addEventListener("click", () => invoke(() => syncClient.push()));
        $("syncPull").addEventListener("click", () => invoke(() => syncClient.pull()));
        $("syncKeepLocal").addEventListener("click", () => showModal('<h2>端末版を残す</h2><p>最新のクラウド版を確認し、次回の送信で端末版に置き換える準備をします。クラウドの学習変更は統合しません。送信は別途必要です。</p><button data-modal-confirm>端末版を選ぶ</button><button data-modal-cancel>キャンセル</button>', () => { invoke(() => syncClient.pull("local")); }));
        $("syncUseRemote").addEventListener("click", () => showModal('<h2>クラウド版を使う</h2><p>端末の学習データを置き換えます。端末版は直前コピーとして退避します。まず必要ならJSONを保存してください。同期中に端末が変わった場合は適用しません。</p><button class="warn" data-modal-confirm>クラウド版を選ぶ</button><button data-modal-cancel>キャンセル</button>', () => { invoke(() => syncClient.pull("remote")); }));
        $("restorePreSync").addEventListener("click", () => {
          try { restoreStoredBackup(localStorage.getItem(PRE_SYNC_KEY), "同期直前"); }
          catch { toast("同期直前コピーを読み込めません。", true); }
        });
        renderSync();
      }

      function save(shouldRender = true) {
        persistence.dirty = true;
        if (persistence.credentialError) { renderPersistence(); return false; }
        if (!canWrite()) return false;
        try {
          const savedAt = new Date().toISOString();
          const payload = createLocalSnapshot(currentData(), savedAt);
          const record = JSON.parse(persistence.raw || "{}");
          quarantineSync(record);
          const sync = window.MWSync.changed(record.sync, Number(record.revision) || 0);
          const raw = JSON.stringify({ ...payload, savedAt, revision: (Number(record.revision) || 0) + 1, sync });
          assertNoSecrets(raw, localSecrets());
          assertStorageSize(raw);
          localStorage.setItem(STORAGE_KEY, raw);
          persistence.raw = raw;
          persistence.dirty = false;
          persistence.message = "";
          if (!syncClient?.isBusy()) syncRuntime = "";
          renderPersistence();
          if (shouldRender) render();
          return true;
        } catch (err) {
          renderPersistence();
          toast("保存に失敗しました。容量が近い可能性があります。JSONエクスポート後、APIキャッシュ削除を検討してください。", true);
          return false;
        }
      }

      function normalizeLoadedData() {
        state.ranges.forEach(range => {
          range.words = Array.isArray(range.words) ? range.words : [];
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
            word.syllabifiedHeadword = String(word.syllabifiedHeadword || "");
            word.pronunciationVariants = Array.isArray(word.pronunciationVariants) ? word.pronunciationVariants : [];
            if (!word.pronunciationVariants.length && (word.pronunciation || word.audioUrl || word.partOfSpeech)) {
              word.pronunciationVariants.push({
                id: uid("pron"),
                dictionarySource: word.dictionarySource || "",
                headword: word.word || "",
                syllabifiedHeadword: word.syllabifiedHeadword || word.word || "",
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
            ["enToJa", "jaToEn"].forEach(direction => { word.testStats[direction] = { ...word.testStats[direction], ...normalizeDirectionStats(word.testStats[direction]) }; });
            word.acceptedSpellings = [...new Set((Array.isArray(word.acceptedSpellings) ? word.acceptedSpellings : []).map(value => String(value).trim()).filter(Boolean))];
            word.spellingStats = { ...word.spellingStats, ...normalizeSpellingStats(word.spellingStats) };
            word.speedStats = normalizeSpeedStats(word.speedStats);
            word.hasDefinition = Boolean(word.hasDefinition || word.definitions.length);
            word.cacheVersion = Number(word.cacheVersion) || 0;
            word.mwUrl = word.mwUrl || dictionaryUrl(word.normalized || word.word || "");
            syncLegacyPronunciationFields(word, word.dictionarySource || state.settings.dictionaryType);
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
        try { localStorage.setItem(API_USAGE_KEY, JSON.stringify({ date: todayKey(), count })); }
        catch { toast("API回数を保存できませんでした。学習データの保存状態を確認してください。", true); }
      }

      function incrementUsage(by) {
        const usage = usageRecord();
        setUsage(usage.count + by);
      }

      function storageBytes() {
        let total = 0;
        try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          const value = localStorage.getItem(key) || "";
          total += new Blob([key + value]).size;
        }
        } catch { return total; }
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
        const total = words.length;
        const fetched = words.filter(w => isCacheCurrent(w, w.dictionarySource || state.settings.dictionaryType || "learners")).length;
        const audio = words.filter(w => w.hasAudio).length;
        const noAudio = words.filter(w => w.apiFetched && !w.hasAudio).length;
        const definitions = words.filter(w => w.hasDefinition).length;
        const hard = words.filter(w => w.studyStatus === "hard").length;
        const known = words.filter(w => w.studyStatus === "known").length;
        const marked = words.filter(w => w.reviewMarked === true).length;
        const unseen = words.filter(w => !(w.testStats?.enToJa?.attempts || 0) && !(w.testStats?.jaToEn?.attempts || 0)).length;
        const unsettled = words.filter(w => w.studyStatus !== "known").length;
        return { total, fetched, audio, noAudio, definitions, hard, known, marked, unseen, unsettled, pct: total ? Math.round(fetched / total * 100) : 0, learningPct: total ? Math.round(known / total * 100) : 0, ...contentStats(range) };
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
        const days = Math.max(0, Math.ceil((new Date(`${range.testDate}T00:00:00`) - new Date(`${localDateString(now)}T00:00:00`)) / 86400000));
        return `<div class="plan-card"><strong>${label}: ${escapeHtml(range.rangeName || "無題の範囲")}</strong><div class="meta">${escapeHtml(range.testDate || "日付未設定")} / あと${days}日 / ${s.total}語</div></div>`;
      }
      function renderTodayStudy() {
        const now = new Date(), plan = learningPlan(now);
        if (!plan.primary && !plan.memory) {
          $("todayStudyPanel").classList.add("hidden");
          $("todayStudyPanel").innerHTML = "";
          return;
        }
        $("todayStudyPanel").classList.remove("hidden");
        const memoryStats = plan.memory ? contentStats(plan.memory) : null;
        $("todayStudyPanel").innerHTML = `<h3>次の小テストに向けて</h3><p class="next-material">${escapeHtml((plan.primary || plan.memory).rangeName || "無題の範囲")}</p><button class="primary" id="continueLearning">教材を開いて学習する →</button><details class="disclosure today-details"><summary>学習プラン</summary><p>${escapeHtml(plan.reason)}</p>${plan.endedToday ? `<div class="caution">今日落とした項目は、次の範囲より先に確認します。</div>` : ""}${plan.memory ? `<div class="caution">暗記構文「${escapeHtml(plan.memory.rangeName)}」: 未定着 ${memoryStats.memoryUnsettled}/${memoryStats.memoryTotal}件</div>` : ""}<div class="plan-grid">${rangePlanHtml(plan.endedToday ? "今日の取りこぼし" : "最優先", plan.primary, now)}${rangePlanHtml("次の範囲", plan.preview, now)}</div><div class="actions"><select id="todayDirection"><option value="enToJa">英語 → 日本語</option><option value="jaToEn">日本語 → 英語</option></select><button class="primary" id="startTodayMarked" ${plan.primary ? "" : "disabled"}>★ あとでテスト</button><button class="soft" id="startTodayNormal" ${plan.primary ? "" : "disabled"}>通常15問</button>${plan.memory ? `<button class="primary" id="startTodayMemory">暗記構文を始める</button>` : ""}</div></details>`;
        $("continueLearning")?.addEventListener("click", () => {
          stopContinuousPlayback();
          state.selectedRangeId = (plan.primary || plan.memory).id;
          save(false); renderWords();
          $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        $("startTodayMarked")?.addEventListener("click", () => { state.selectedRangeId = plan.primary.id; startTest($("todayDirection").value, "marked"); });
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

      function renderRanges() {
        const filter = $("rangeFilter").value;
        const nextId = nextRangeId();
        $("openNext").classList.toggle("hidden", !nextId);
        $("libraryTools").classList.toggle("hidden", !state.ranges.length);
        $("libraryHeading").classList.toggle("hidden", !state.ranges.length);
        let ranges = state.ranges.map(r => ({ ...r, status: statusForRange(r, nextId) }));
        if (filter !== "all") ranges = ranges.filter(r => r.status === filter);
        ranges.sort((a, b) => (a.testDate || "9999").localeCompare(b.testDate || "9999"));
        if (!ranges.length) {
          $("rangeList").innerHTML = state.ranges.length
            ? `<div class="empty">この条件の教材はありません。表示する教材を「すべて」に変更してください。</div>`
            : `<div class="welcome-card"><h3>教材がありません</h3><p>単語・例文・暗記構文を登録して学習できます。</p><ol><li>教材を登録する</li><li>音声と意味を確認する</li><li>テストで覚えたか確かめる</li></ol><button class="primary" data-go="import">最初の教材を登録 →</button><p class="meta">登録済みのバックアップは「データ」から取り込めます。</p></div>`;
          return;
        }
        $("rangeList").innerHTML = ranges.map(range => {
          const s = statsForRange(range);
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
              <div class="meta">${isMemory ? `未定着 ${s.memoryUnsettled}/${s.memoryTotal}件` : `★ あとでテスト ${s.marked}語`}</div>
              <details class="range-progress"><summary>学習状況の内訳</summary><div class="mini-grid">
                ${isMemory ? `<div class="mini"><strong>${s.memoryTotal}</strong>構文</div><div class="mini"><strong>${s.memoryUnsettled}</strong>未定着</div>` : `<div class="mini"><strong>${s.total}</strong>単語</div><div class="mini"><strong>${s.examples}</strong>例文</div><div class="mini"><strong>${s.phrases}</strong>熟語</div><div class="mini"><strong>${s.hard}</strong>苦手</div><div class="mini"><strong>${s.usageUnsettled}</strong>例文等未定着</div>`}
              </div></details>
              <div class="actions" style="margin-top:10px">
                <button class="primary" data-action="open" data-id="${escapeHtml(range.id)}">学習する →</button>
                ${isMemory ? "" : `<button class="soft" data-action="marked" data-id="${escapeHtml(range.id)}">★ あとでテスト ${s.marked}語</button>`}
                ${range.testDate === todayKey() ? (isRangeEnded(range) ? `<button class="soft" data-action="test-before" data-id="${escapeHtml(range.id)}">テスト前</button>` : `<button class="soft" data-action="test-ended" data-id="${escapeHtml(range.id)}">テスト終了</button>`) : ""}
              </div>
              <details class="technical-details"><summary>管理・発音データ</summary><div class="technical-details-body">
                ${isMemory ? "" : `<div class="meta">発音データ ${s.fetched}/${s.total}語</div><button class="soft" data-action="fetch" data-id="${escapeHtml(range.id)}" ${s.total ? "" : "disabled"}>発音データを取得</button>`}
                <div class="danger-actions"><button class="compact refetch" data-action="clear-cache" data-id="${escapeHtml(range.id)}">キャッシュ削除</button><button class="compact collegiate" data-action="delete-range" data-id="${escapeHtml(range.id)}">範囲削除</button></div>
              </div></details>
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
        return `<details class="linked-usage" data-linked-usage-word="${escapeHtml(wordId)}"${open}><summary>例文・熟語 ${items.length}件</summary>${items.map(item => `<div class="linked-usage-item"><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span><strong>${escapeHtml(item.english)}</strong><span>${escapeHtml(item.japanese)}</span><button class="soft" data-usage-speak="${escapeHtml(item.id)}">${item.type === "phrase" ? "熟語" : "例文"}を聞く</button></div>`).join("")}</details>`;
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
            <strong>${escapeHtml(item.english)}</strong><div>${escapeHtml(item.japanese)}</div><button class="soft" data-usage-speak="${escapeHtml(item.id)}">${item.type === "phrase" ? "熟語" : "例文"}を聞く</button>
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
        $("vocabPrimaryModes").classList.toggle("hidden", isMemory);
        $("memoryPrimaryModes").classList.toggle("hidden", !isMemory);
        $("vocabLearningOptions").classList.toggle("hidden", isMemory);
      }

      function showLearningChoiceModal(title, choices) {
        showModal(`<h2>${escapeHtml(title)}</h2><div class="learning-choice-list">${choices.map(choice => `<button class="${choice.className || "soft"}" data-learning-choice="${escapeHtml(choice.id)}">${escapeHtml(choice.label)}</button>`).join("")}</div><button class="soft" data-modal-cancel>キャンセル</button>`);
        const actions = new Map(choices.map(choice => [choice.id, choice.action]));
        $("modalRoot").querySelectorAll("[data-learning-choice]").forEach(button => button.addEventListener("click", () => {
          const action = actions.get(button.dataset.learningChoice);
          closeModal();
          action?.();
        }));
      }

      function showWordTestMenu() {
        showLearningChoiceModal("単語テスト", [
          { id: "en-normal", label: "英語 → 日本語・通常", className: "primary", action: () => startTest("enToJa", "normal") },
          { id: "ja-normal", label: "日本語 → 英語・通常", className: "primary", action: () => startTest("jaToEn", "normal") },
          { id: "en-wrong", label: "英語 → 日本語・間違い集中", action: () => startTest("enToJa", "wrong") },
          { id: "ja-wrong", label: "日本語 → 英語・間違い集中", action: () => startTest("jaToEn", "wrong") }
        ]);
      }

      function showMarkedTestMenu() {
        showLearningChoiceModal("★ あとでテスト", [
          { id: "en-marked", label: "英語 → 日本語（最大10問）", className: "primary", action: () => startTest("enToJa", "marked") },
          { id: "ja-marked", label: "日本語 → 英語（最大10問）", className: "primary", action: () => startTest("jaToEn", "marked") },
          { id: "pick-marked", label: "単語を選ぶ・マークを外す", action: () => {
            renderWords(); $("markedWordPicker").open = true;
            $("markedReview").scrollIntoView({ behavior: "smooth", block: "start" });
          } }
        ]);
      }

      function renderGrammar(word, editable = false) {
        const grammar = window.MWStorage, parts = grammar.wordPartsOfSpeech(word), selected = grammar.pronunciationPartOfSpeech(word);
        const label = part => grammar.PART_OF_SPEECH_LABELS[part] || part;
        const variant = preferredPronunciationVariant(word);
        return `<div class="word-grammar" data-grammar-word="${escapeHtml(word.id)}" data-grammar-editable="${editable}"><div class="meta">${parts.length ? parts.map(part => escapeHtml(label(part))).join("・") : "品詞未登録"}</div>
          ${parts.length > 1 ? `<label class="meta">読み上げる品詞 <select data-pronunciation-pos="${escapeHtml(word.id)}" aria-label="読み上げる品詞">${parts.map(part => `<option value="${escapeHtml(part)}" ${part === selected ? "selected" : ""}>${escapeHtml(label(part))}</option>`).join("")}</select></label>` : ""}
          <div class="meta pron-line">${selected ? escapeHtml(label(selected)) + "：" : ""}${escapeHtml(variant?.pronunciation || "発音未取得")}</div>${editable ? `<button class="soft" data-edit-pos="${escapeHtml(word.id)}">品詞を編集</button>` : ""}
        </div>`;
      }

      function refreshGrammar(word) {
        document.querySelectorAll(`[data-grammar-word="${CSS.escape(word.id)}"]`).forEach(panel => {
          const holder = document.createElement("div"); holder.innerHTML = renderGrammar(word, panel.dataset.grammarEditable === "true"); panel.replaceWith(holder.firstElementChild);
        });
        document.querySelectorAll(`[data-word-id="${CSS.escape(word.id)}"] [data-word-action="play"]`).forEach(button => { button.disabled = !officialAudioUrlForWord(word); });
        // The active test keeps its choices, answer, and timing while POS changes.
        const testLabel = $("testContent").querySelector("[data-test-pos]");
        if (testLabel?.dataset.testPos === word.id) testLabel.textContent = window.MWStorage.PART_OF_SPEECH_LABELS[window.MWStorage.pronunciationPartOfSpeech(word)] || "";
      }

      function editPartsOfSpeech(word) {
        const grammar = window.MWStorage, selected = grammar.wordPartsOfSpeech(word);
        showModal(`<h2>${escapeHtml(word.word)} の品詞</h2><p class="meta">教材に載っている品詞を選んでください。複数選べます。</p><div class="pos-picker">${Object.entries(grammar.PART_OF_SPEECH_LABELS).map(([part, label]) => `<label><input type="checkbox" data-pos-option="${part}" ${selected.includes(part) ? "checked" : ""}>${label}</label>`).join("")}</div><div class="actions"><button class="primary" data-modal-confirm>保存する</button><button class="soft" data-modal-cancel>キャンセル</button></div>`, () => {
          if (!canWrite()) return false;
          const parts = [...$("modalRoot").querySelectorAll("[data-pos-option]:checked")].map(input => input.dataset.posOption);
          if (!parts.length) { toast("品詞を1つ以上選んでください。", true); return false; }
          word.partsOfSpeech = parts;
          word.preferredPartOfSpeech = parts.includes(word.preferredPartOfSpeech) ? word.preferredPartOfSpeech : parts[0];
          if (!save(false)) return false;
          if (!state.activeTest) renderWords();
          else {
            refreshGrammar(word);
            const details = $("testContent").querySelector(".word-speech-details");
            if (details) details.innerHTML = renderWordSpeechDetails(word, findRangeByWord(word.id));
          }
          return true;
        });
      }

      function renderVerbForms(word) {
        if (!window.MWStorage.wordPartsOfSpeech(word).some(window.MWStorage.isVerbPartOfSpeech)) return "";
        const forms = Object.entries(window.MWStorage.VERB_FORM_LABELS).flatMap(([key, label]) =>
          (word.verbForms?.[key] || []).map((form, index) => `<span class="verb-form"><span>${label}：<strong>${escapeHtml(form)}</strong></span><button class="soft" data-verb-speak="${escapeHtml(word.id)}" data-form="${key}" data-form-index="${index}">${label}を聞く</button></span>`));
        return `<details class="verb-forms"><summary>動詞の活用${forms.length ? ` ${forms.length}形` : "を登録"}</summary><div class="verb-form-list">${forms.length ? `<span class="verb-form"><span>原形：<strong>${escapeHtml(word.word)}</strong></span><button class="soft" data-verb-speak="${escapeHtml(word.id)}" data-form="base">原形を聞く</button></span>` + forms.join("") + `<button class="soft" data-verb-speak="${escapeHtml(word.id)}" data-form="all">活用を順番に聞く</button>` : `<p class="meta">教材にある活用形を追加できます。</p>`}<button class="soft" data-verb-edit="${escapeHtml(word.id)}">活用形を${forms.length ? "編集" : "登録"}</button></div></details>`;
      }

      function renderWordSpeechDetails(word, range) {
        return `<div class="word-speech-details">${renderGrammar(word, true)}${renderLinkedUsage(range, word.id)}${renderVerbForms(word)}</div>`;
      }

      function editVerbForms(word) {
        const labels = window.MWStorage.VERB_FORM_LABELS;
        showModal(`<h2>${escapeHtml(word.word)} の活用形</h2><p class="meta">教材の表記を入力してください。複数ある形は / で区切れます。空欄は未登録として扱います。</p>${Object.entries(labels).map(([key, label]) => `<label for="verb-${key}">${label}</label><input id="verb-${key}" value="${escapeHtml((word.verbForms?.[key] || []).join(" / "))}" autocomplete="off" autocapitalize="none" spellcheck="false">`).join("")}<div class="actions"><button class="primary" data-modal-confirm>活用形を保存</button><button class="soft" data-modal-cancel>キャンセル</button></div>`, () => {
          if (!canWrite()) return false;
          let forms;
          try { forms = window.MWStorage.normalizeVerbForms(Object.fromEntries(Object.keys(labels).map(key => [key, $("verb-" + key).value]))); }
          catch (error) { toast(error.message, true); return false; }
          word.verbForms = forms;
          if (!save(false)) return false;
          // Keep the current question/answer state while refreshing only the form panel.
          document.querySelectorAll(`[data-verb-edit="${CSS.escape(word.id)}"]`).forEach(button => {
            const panel = button.closest(".verb-forms");
            if (panel) { const holder = document.createElement("div"); holder.innerHTML = renderVerbForms(word); holder.firstElementChild.open = true; panel.replaceWith(holder.firstElementChild); }
          });
          return true;
        });
      }

      function reviewToggleHtml(word) {
        return `<button class="soft review-toggle" data-review-toggle="${escapeHtml(word.id)}" aria-pressed="${word.reviewMarked === true}" aria-label="${word.reviewMarked === true ? "あとでテストから外す" : "あとでテストに追加"}" title="${word.reviewMarked === true ? "あとでテストから外す" : "あとでテストに追加"}">${word.reviewMarked === true ? "★" : "☆"}</button>`;
      }

      function renderMarkedPicker() {
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range || range.materialType === "memorization") return;
        const markedCount = range.words.filter(word => word.reviewMarked === true).length;
        $("markedReviewCount").textContent = `${markedCount}語`;
        $("startMarkedEnglish").disabled = $("startMarkedJapanese").disabled = !markedCount;
        const query = $("markedWordSearch").value.trim().toLocaleLowerCase();
        const words = range.words.filter(word => `${word.word} ${(word.meaningsJa || []).join(" ")}`.toLocaleLowerCase().includes(query));
        $("markedWordList").innerHTML = words.map(word => `<label class="marked-word-row"><input type="checkbox" data-marked-word="${escapeHtml(word.id)}" ${word.reviewMarked === true ? "checked" : ""}><span><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml((word.meaningsJa || []).join("／"))}</span></span></label>`).join("") || `<div class="empty">一致する単語がありません。</div>`;
      }

      function setReviewMarked(wordId, marked) {
        if (!canWrite()) return;
        const range = findRangeByWord(wordId), word = range?.words.find(item => item.id === wordId);
        if (!word) return;
        word.reviewMarked = Boolean(marked);
        save(false);
        const focusedWordId = document.activeElement?.dataset?.markedWord;
        renderMarkedPicker();
        if (focusedWordId) $("markedWordList").querySelector(`[data-marked-word="${CSS.escape(focusedWordId)}"]`)?.focus({ preventScroll: true });
        document.querySelectorAll("[data-review-toggle]").forEach(button => {
          if (button.dataset.reviewToggle !== wordId) return;
          button.setAttribute("aria-pressed", String(word.reviewMarked));
          button.textContent = word.reviewMarked ? "★" : "☆";
          const label = word.reviewMarked ? "あとでテストから外す" : "あとでテストに追加";
          button.setAttribute("aria-label", label);
          button.title = label;
        });
      }

      function renderWords() {
        const range = state.ranges.find(r => r.id === state.selectedRangeId);
        if (!range) return;
        $("wordPanel").classList.remove("hidden");
        $("page-ranges").classList.add("hidden");
        const isMemory = range.materialType === "memorization";
        configureLearningModes(isMemory);
        $("openRangeTitle").textContent = `${range.rangeName || "無題の範囲"} の${isMemory ? "暗記構文" : "教材"}`;
        const s = statsForRange(range);
        if (isMemory) {
          $("openRangeMeta").textContent = `${range.testDate || "日付未設定"} / ${s.memoryTotal}構文 / 未定着${s.memoryUnsettled}`;
          renderMemoryOverview(range);
          $("usageList").innerHTML = "";
          return;
        }
        $("wordFilter").value = state.settings.studyFilter;
        $("playbackInterval").value = String(state.settings.playbackInterval);
        $("usageReviewMode").value = state.settings.usageReviewMode;
        $("usageReviewExtraSeconds").value = String(state.settings.usageReviewExtraSeconds);
        updateUsageTimingSettings();
        updatePlaybackControls();
        $("openRangeMeta").textContent = `${range.testDate || "日付未設定"} / ${s.total}語 / 例文${s.examples}・熟語${s.phrases}`;
        renderMarkedPicker();
        renderUsageOverview(range);
        const words = filteredWords(range);
        if (!words.length) {
          $("wordList").innerHTML = `<div class="empty">この条件に一致する単語はありません。</div>`;
          return;
        }
        const rememberedWordId = words.some(word => word.id === range.currentWordId) ? range.currentWordId : words[0].id;
        if (range.currentWordId !== rememberedWordId) {
          range.currentWordId = rememberedWordId;
          save(false);
        }
        $("wordList").innerHTML = words.map((word, index) => `
          <article class="word-card ${word.id === rememberedWordId ? "current-word" : ""}" data-word-id="${escapeHtml(word.id)}">
            <div class="word-head">
              <div style="min-width:0;flex:1 1 auto">
                <div class="word-main-line">
                  <span class="word-index">${index + 1}/${words.length}</span>
                  <div class="word-title">${escapeHtml(word.word)}</div>
                </div>
                <div class="word-meaning">${escapeHtml(word.meaningsJa?.join("／") || "日本語訳未登録")}</div>
                ${renderGrammar(word)}
                ${renderSpellingRisk(word)}
                ${renderLinkedUsage(range, word.id)}
                ${renderVerbForms(word)}
              </div>
              ${wordFailureLabel(word) ? `<span class="failure-label">${wordFailureLabel(word)}</span>` : ""}
            </div>
            <div class="study-actions">
              <button class="primary" data-word-action="play" data-id="${escapeHtml(word.id)}" ${officialAudioUrlForWord(word) ? "" : "disabled"}>公式音声</button>
              <button class="primary" data-word-action="next" data-id="${escapeHtml(word.id)}">次へ</button>
              <button class="soft play-from-here" data-word-action="play-from" data-id="${escapeHtml(word.id)}">▶ ここから再生</button>
            </div>
            <div class="secondary-actions">
              ${reviewToggleHtml(word)}
              <button class="soft" data-word-action="speak" data-id="${escapeHtml(word.id)}">読み上げ</button>
              <button class="soft study-toggle hard" data-word-action="hard" data-id="${escapeHtml(word.id)}" aria-pressed="${word.studyStatus === "hard"}">苦手</button>
              <button class="soft study-toggle known" data-word-action="known" data-id="${escapeHtml(word.id)}" aria-pressed="${word.studyStatus === "known"}">覚えた</button>
            </div>
            <details class="technical-details"><summary>発音・辞書の詳細</summary><div class="technical-details-body">
              <div class="meta">発音候補 ${pronunciationChoices(word).length}件</div><button class="soft" data-edit-pos="${escapeHtml(word.id)}">品詞を編集</button>
              ${renderPronunciationVariants(word)}
              ${word.definitions?.length ? `<div class="mini"><strong>英語定義</strong>${word.definitions.map((d, i) => `<div>${i + 1}. ${escapeHtml(d)}</div>`).join("")}</div>` : ""}
              <div class="danger-actions"><button class="soft mw-small" data-word-action="mw" data-id="${escapeHtml(word.id)}">MWで開く</button><button class="compact refetch" data-word-action="refetch" data-id="${escapeHtml(word.id)}">再取得</button><button class="compact collegiate" data-word-action="refetch-collegiate" data-id="${escapeHtml(word.id)}">Collegiate</button></div>
            </div></details>
          </article>`).join("");
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

      function requiresPartOfSpeechAudio(word) {
        if (word?.partsOfSpeech?.length || word?.pronunciations?.length) return true;
        const variants = word?.pronunciationVariants || [];
        return new Set(variants.map(item => window.MWStorage.partOfSpeechKey(item.partOfSpeech)).filter(Boolean)).size > 1;
      }

      function playTestAudio(word) {
        if (!word) return;
        const variant = preferredPronunciationVariant(word);
        if (variant?.audioUrl) playPronunciationVariant(word.id, variant.id);
        else if (!window.MWStorage.pronunciationPartOfSpeech(word) && word.audioUrl) playOfficial(word.id);
        else if (requiresPartOfSpeechAudio(word)) return toast("この品詞の公式音声は未取得です。辞書音声を取得するか、品詞ごとの発音候補を確認してください。", true);
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
        return preferredPronunciationVariant(word)?.audioUrl || (!window.MWStorage.pronunciationPartOfSpeech(word) ? word?.audioUrl : "") || "";
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
        const { linkedWords } = usageAudioInfo(range, item);
        stopContinuousPlayback();
        return previewPlayer.play(linkedWords.map(word => ({ text: word.word, url: officialAudioUrlForWord(word), requireOfficial: requiresPartOfSpeechAudio(word) })));
      }

      function autoPlayUsageLinkedWord(range, item, key) {
        if (!range || !item || !key || key === lastAutoSpokenUsageKey) return;
        lastAutoSpokenUsageKey = key;
        playUsageLinkedWordAudio(range, item);
      }

      function usageAudioHtml(range, item, actionName) {
        if (actionName === "study") {
          const available = canUseContinuousSpeech();
          return `<div class="usage-word-audio"><span>${available ? "英文全文を端末音声で自動読み上げ" : "この端末では全文読み上げを利用できません"}</span>${available ? `<button class="soft" data-study-action="audio">全文をもう一度読み上げ</button>` : ""}</div>`;
        }
        const info = usageAudioInfo(range, item);
        const status = info.playableWords.length
          ? `${escapeHtml(info.label)} / 公式音声 ${info.playableWords.length}語`
          : `${escapeHtml(info.label)} / 公式音声未取得`;
        return `<div class="usage-word-audio"><span>${status}</span>${info.linkedWords.length ? `<button class="soft" data-${actionName}-action="audio">関連単語を再生</button>` : ""}<button class="soft" data-${actionName}-action="full-audio">全文を読み上げ</button></div>`;
      }

      function setSessionView(panelId, title, active) {
        const layer = $("studySessionLayer");
        layer.dataset.session = active ? panelId : "";
        $("recallContent").classList.remove("usage-speed-running");
        ["testPanel", "speedPanel", "spellingPanel", "recallPanel"].forEach(id => $(id).classList.toggle("hidden", !active || id !== panelId));
        if (active) {
          if (layer.classList.contains("hidden")) sessionReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          $("studySessionTitle").textContent = title || "学習中";
          layer.classList.remove("hidden");
          document.body.classList.add("session-active");
          layer.scrollTop = 0;
          requestAnimationFrame(() => { layer.scrollTop = 0; });
          return;
        }
        layer.classList.add("hidden");
        document.body.classList.remove("session-active");
        sessionReturnFocus?.focus?.();
        sessionReturnFocus = null;
      }

      function hideForSpeed(active) {
        setSessionView("speedPanel", "高速周回", active);
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
        const hasOfficial = Boolean(officialAudioUrlForWord(word));
        const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        if (!hasOfficial && !canSpeak) return;
        lastAutoSpokenSpeedKey = key;
        playTestAudio(word);
      }

      function renderSpeedReview() {
        const session = state.speedSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        if (!session || !range) return;
        $("speedContent").classList.toggle("speed-running", !session.finished);
        if (session.finished) {
          lastAutoSpokenSpeedKey = "";
          const elapsedSeconds = Math.max(1, Math.round((session.finishedAtMs - session.startedAtMs) / 1000));
          const counts = { unknown: 0, unsure: 0, instant: 0 };
          session.assessments.forEach(item => { counts[item.rating]++; });
            $("speedContent").innerHTML = `<div class="test-result"><h2>高速周回 完了</h2><p>${escapeHtml(range.rangeName || "無題の範囲")}</p><div class="result-score">全体 ${session.round}周目 完了</div><div class="result-grid"><div><strong>${session.assessments.length}</strong>確認回数</div><div><strong>${counts.instant}</strong>即答</div><div><strong>${counts.unsure}</strong>怪しい</div><div><strong>${counts.unknown}</strong>知らない</div></div><p class="meta">所要時間 ${Math.floor(elapsedSeconds / 60)}分${elapsedSeconds % 60}秒。判定履歴は復習の順番に使います。テストの正答数は変更しません。</p><div class="test-result-actions"><button class="primary" data-speed-action="repeat">全範囲を次の周へ</button><button class="soft" data-speed-action="return">範囲へ戻る</button></div></div>`;
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
        const hasOfficial = Boolean(officialAudioUrlForWord(word));
        const canSpeak = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
        const audioLabel = hasOfficial ? "公式音声を自動再生" : canSpeak ? "端末音声を自動再生" : "利用できる音声なし";
        const fallbackReplay = !hasOfficial && canSpeak
          ? `<button class="speed-replay" data-speed-action="audio" aria-label="端末読み上げをもう一度聞く" title="端末読み上げをもう一度聞く">🔊</button>`
          : "";
        const usageItems = linkedUsageItemsForWord(range, word.id);
        const usageReview = usageItems.length
          ? `<div class="speed-usage-review"><button class="soft speed-usage-toggle" data-speed-action="usage" aria-expanded="${state.speedUsageVisible}">例文・熟語を確認（${usageItems.length}件）</button>${state.speedUsageVisible ? `<div class="speed-usage-list">${usageItems.map(item => `<article><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span><strong>${escapeHtml(item.english)}</strong><span>${escapeHtml(item.japanese)}</span></article>`).join("")}</div>` : ""}</div>`
          : "";
        $("speedContent").innerHTML = `<div class="speed-head"><span>全体 ${session.round}周目</span><span>${session.index + 1} / ${session.roundWordIds.length}</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><div class="speed-metrics"><div><strong>${remaining}</strong>この周の残り</div><div><strong>${wordsPerMinute ? wordsPerMinute.toFixed(1) : "—"}</strong>語/分</div><div><strong>${etaMinutes ? `約${etaMinutes}分` : "計測中"}</strong>終了目安</div></div><div class="speed-audio-status meta">${audioLabel}</div><div class="speed-card-wrap">${fallbackReplay}<div class="speed-card" data-speed-card tabindex="0" role="button" aria-label="単語カード"><div class="speed-word">${escapeHtml(word.word)}</div>${state.speedMeaningVisible ? `<div class="speed-meaning">${escapeHtml(meaning)}</div>${renderSpellingRisk(word)}` : `<div class="speed-hint">下の大きなボタンで意味を確認</div>`}</div></div><button class="primary speed-meaning-toggle" data-speed-action="meaning" aria-expanded="${state.speedMeaningVisible}">${state.speedMeaningVisible ? "意味を隠す" : "意味を確認"}</button>${usageReview}<div class="speed-actions"><button class="speed-unknown" data-speed-rating="unknown">知らない</button><button class="speed-unsure" data-speed-rating="unsure">怪しい</button><button class="speed-instant" data-speed-rating="instant">即答</button></div><div class="speed-footer"><span class="meta">履歴は復習の順番へ反映・テスト成績とは独立</span></div>`;
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
      }

      function hideForSpelling(active) {
        setSessionView("spellingPanel", "スペルテスト", active);
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
            $("spellingContent").innerHTML = `<div class="test-result"><h2>スペル確認 完了</h2><p>${escapeHtml(range.rangeName || "無題の範囲")}</p><div class="result-score">${result.correct} / ${result.answered}</div><div class="result-grid"><div><strong>${result.correct}</strong>正解</div><div><strong>${result.incorrect}</strong>不正解</div><div><strong>${Math.max(0, result.total - result.answered)}</strong>未回答</div></div><div class="test-result-actions"><button class="primary" data-spelling-action="repeat">スペルをもう一度確認</button><button class="soft" data-spelling-action="return">範囲へ戻る</button></div></div>`;
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
        $("spellingContent").innerHTML = `<div class="spelling-card"><div class="test-progress"><span>${session.index + 1} / ${session.wordIds.length}</span><span>厳密採点</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><div class="meta">日本語から英単語を入力</div><div class="spelling-meaning">${escapeHtml(word.meaningsJa.join("／") || "日本語訳未登録")}</div><form class="spelling-form" id="spellingForm"><label for="spellingAnswer">spelling</label><input id="spellingAnswer" name="answer" autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" required><button class="primary" type="submit">答える</button></form></div>`;
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
        $("recallContent").innerHTML = `<div class="recall-head"><span>学習モード・単語</span><span>${session.index + 1} / ${session.itemIds.length}</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><article class="usage-study-card study-card-enter" data-study-card><span class="content-type">単語</span><div class="usage-word-audio"><span>${audio}</span>${replay}</div><div class="usage-study-english">${escapeHtml(word.word)}</div><div class="usage-study-japanese">${escapeHtml(word.meaningsJa?.join("／") || "日本語訳未登録")}</div><div class="tap-next-hint">タップして次へ<br><span>左スワイプで次へ・右スワイプで前へ</span></div></article>`;
        const key = `study-word:${session.rangeId}:${session.index}:${word.id}`;
        if (key !== lastAutoSpokenStudyWordKey) {
          lastAutoSpokenStudyWordKey = key;
          playTestAudio(word);
        }
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
          $("recallContent").innerHTML = `<div class="recall-head"><span>学習モード・例文・熟語</span><span>${session.index + 1} / ${session.itemIds.length}</span></div><div class="test-progressbar"><span style="width:${progress}%"></span></div><article class="usage-study-card study-card-enter" data-study-card><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span>${usageAudioHtml(range, item, "study")}<div class="usage-study-english">${escapeHtml(item.english)}</div><div class="usage-study-japanese">${escapeHtml(item.japanese)}</div><div class="tap-next-hint">タップして次へ<br><span>左スワイプで次へ・右スワイプで前へ</span></div></article>`;
        const key = `study:${session.rangeId}:${session.index}:${item.id}`;
        if (key !== lastAutoSpokenUsageKey) {
          lastAutoSpokenUsageKey = key;
          if (!speakWordText(item.english)) toast("この端末では全文読み上げを利用できません。", true);
        }
      }

      function moveStudyCard(direction) {
        const session = activeStudySession();
        const card = $("recallContent").querySelector("[data-study-card]");
        if (!session || session.finished || session.transitioning || !card || ![-1, 1].includes(direction)) return;
        const targetIndex = session.index + direction;
        if (targetIndex < 0) return;
        const isWordStudy = Boolean(state.wordStudySession);
        session.transitioning = true;
        stopPreviewAudio();
        card.classList.add(direction < 0 ? "study-card-exit-back" : "study-card-exit");
        setTimeout(() => {
          // A swipe must not redraw an abandoned or newly started session.
          if (activeStudySession() !== session) return;
          session.index = targetIndex;
          session.transitioning = false;
          session.finished = targetIndex >= session.itemIds.length;
          if (isWordStudy) renderWordStudy();
          else renderUsageStudy();
          if (direction < 0) $("recallContent").querySelector("[data-study-card]")?.classList.add("study-card-enter-back");
        }, 220);
      }

      function bindStudyCardSwipe() {
        const root = $("recallContent");
        let gesture = null;
        let suppressClickCard = null;
        root.addEventListener("pointerdown", event => {
          suppressClickCard = null;
          gesture = null;
          if (!event.isPrimary) { gesture = null; return; }
          const card = event.target.closest?.("[data-study-card]");
          const session = activeStudySession();
          if (event.button !== 0 || !card || !session || session.transitioning
              || event.target.closest("button, a, input, select, textarea, summary")) return;
          gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, card, session };
          try { card.setPointerCapture(event.pointerId); } catch { /* Synthetic test pointers have no capture target. */ }
        });
        root.addEventListener("pointerup", event => {
          const start = gesture;
          if (!start || start.id !== event.pointerId) return;
          gesture = null;
          if (activeStudySession() !== start.session || !start.card.isConnected) return;
          const dx = event.clientX - start.x, dy = event.clientY - start.y;
          suppressClickCard = start.card;
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) {
            event.preventDefault();
            moveStudyCard(1);
            return;
          }
          // Dragging is never a tap, including vertical scrolls and a back swipe at the first card.
          if (Math.abs(dx) < 56 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
          event.preventDefault();
          moveStudyCard(dx > 0 ? -1 : 1);
        });
        root.addEventListener("pointercancel", () => {
          suppressClickCard = gesture?.card || null;
          gesture = null;
        });
        root.addEventListener("click", event => {
          if (suppressClickCard && event.target.closest?.("[data-study-card]") === suppressClickCard) {
            suppressClickCard = null;
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true);
      }

      function leaveUsageStudy() {
        stopPreviewAudio();
        lastAutoSpokenUsageKey = "";
        state.usageStudySession = null;
        hideForRecall(false);
        switchTab("ranges");
        renderWords();
      }

      function leaveWordStudy() {
        stopPreviewAudio();
        lastAutoSpokenStudyWordKey = "";
        state.wordStudySession = null;
        hideForRecall(false);
        switchTab("ranges");
        renderWords();
      }

      function startUsageSpeedReview() {
        state.usageStudySession = null;
        state.wordStudySession = null;
        lastAutoSpokenUsageKey = "";
        startRecall("usage", "speed", "all", "speed");
      }

      function startUsageTestReview() {
        startRecall("usage", "test15", "all", "test");
      }

      function currentRecallItem() {
        const session = state.recallSession;
        const range = state.ranges.find(item => item.id === session?.rangeId);
        return recallItems(range || {}, session?.source).find(item => item.id === session?.queue?.[0]) || null;
      }

      function hideForRecall(active) {
        const session = state.recallSession;
        const title = state.wordStudySession ? "学習モード・単語"
          : state.usageStudySession ? "学習モード・例文・熟語"
            : session?.mode === "speed" ? "高速周回・例文・熟語"
              : session?.purpose === "finish" ? "仕上げ・例文・熟語"
                : session?.source === "memory" ? "暗記構文" : "確認テスト・例文・熟語";
        setSessionView("recallPanel", title, active);
      }

      function startRecall(source, mode, type = "all", purpose = source === "usage" ? "test" : "recall") {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const session = createRecallSession(recallItems(range, source), { source, mode, type, purpose });
        if (session.error) return toast(session.error, true);
        session.rangeId = range.id;
        session.purpose = purpose;
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
        const usageSpeed = session.source === "usage" && session.mode === "speed";
        $("studySessionLayer").dataset.session = usageSpeed ? "usageSpeed" : "recallPanel";
        $("recallContent").classList.toggle("usage-speed-running", usageSpeed && !session.finished);
        if (session.finished) {
          const isUsageSpeed = session.source === "usage" && session.mode === "speed";
          const isUsageTest = session.source === "usage" && session.purpose === "test";
          const isUsageFinish = session.source === "usage" && session.purpose === "finish";
          const counts = { circle: 0, triangle: 0, cross: 0 };
          session.assessments.forEach(entry => counts[entry.rating]++);
          const title = isUsageSpeed ? "例文・熟語 高速周回 完了" : isUsageTest ? "例文・熟語テスト 完了" : isUsageFinish ? "例文・熟語の仕上げ 完了" : "全文暗唱 完了";
          const meta = isUsageSpeed ? "「知らない」「怪しい」は同じ周回内で再出題しました。"
            : isUsageTest ? "各項目を一度ずつ確認しました。判定は既存の例文・熟語履歴へ反映されています。"
              : "惜しい・できなかった項目は、できるまで同じ回の中で再出題しました。";
          $("recallContent").innerHTML = `<div class="test-result"><h2>${title}</h2><p>${escapeHtml(range.rangeName)}</p><div class="result-grid"><div><strong>${counts.circle}</strong>${isUsageSpeed ? "即答" : "できた"}</div><div><strong>${counts.triangle}</strong>${isUsageSpeed ? "怪しい" : "惜しい"}</div><div><strong>${counts.cross}</strong>${isUsageSpeed ? "知らない" : "できなかった"}</div></div><p class="meta">${meta}</p><div class="actions"><button class="primary" data-recall-action="repeat">もう一周</button><button class="soft" data-recall-action="return">教材へ戻る</button></div></div>`;
          return;
        }
        const item = currentRecallItem();
        if (!item) return;
        const isUsageSpeed = session.source === "usage" && session.mode === "speed";
        const isUsageTest = session.source === "usage" && session.purpose === "test";
        const isUsageFinish = session.source === "usage" && session.purpose === "finish";
        const total = session.itemIds.length;
        const completed = Math.max(0, total - new Set(session.queue).size);
        const ratings = isUsageSpeed
          ? `<div class="recall-ratings speed-recall-ratings"><button class="rating cross" data-recall-rating="cross" aria-label="知らない">知らない</button><button class="rating triangle" data-recall-rating="triangle" aria-label="怪しい">怪しい</button><button class="rating circle" data-recall-rating="circle" aria-label="即答">即答</button></div>`
          : session.source === "usage"
            ? `<div class="recall-ratings"><button class="rating cross" data-recall-rating="cross" aria-label="できなかった">できなかった</button><button class="rating triangle" data-recall-rating="triangle" aria-label="惜しい">惜しい</button><button class="rating circle" data-recall-rating="circle" aria-label="できた">できた</button></div>`
            : `<div class="recall-ratings"><button class="rating cross" data-recall-rating="cross" aria-label="言えなかった">×</button><button class="rating triangle" data-recall-rating="triangle" aria-label="一部ミス">△</button><button class="rating circle" data-recall-rating="circle" aria-label="完全に言えた">○</button></div>`;
        const sessionLabel = isUsageSpeed ? "例文・熟語・高速周回" : isUsageTest ? "例文・熟語・確認テスト" : isUsageFinish ? "例文・熟語・仕上げ" : session.source === "memory" ? "暗記構文" : item.type === "phrase" ? "熟語" : "例文";
        $("recallContent").innerHTML = `<div class="recall-head"><span>${sessionLabel}</span><span>未完了 ${session.queue.length} / 初回${total}件</span></div><div class="test-progressbar"><span style="width:${total ? completed / total * 100 : 0}%"></span></div><article class="recall-card"><span class="content-type">${item.type === "phrase" ? "熟語" : "例文"}</span>${isUsageSpeed ? usageAudioHtml(range, item, "recall") : ""}<div class="recall-prompt-label">${isUsageSpeed ? "日本語を見て英文を即答" : "日本語から英語全文を暗唱"}</div><div class="recall-japanese">${escapeHtml(item.japanese)}</div>${session.answerVisible ? `<div class="recall-answer">${escapeHtml(item.english)}</div>${ratings}` : `<button class="primary reveal-answer" data-recall-action="reveal">${isUsageSpeed ? "英文を表示" : "答えを表示"}</button>`}</article>`;
        if (isUsageSpeed) {
          const card = $("recallContent").querySelector(".recall-card");
          const controls = card.querySelector(".recall-ratings, .reveal-answer");
          const body = document.createElement("div");
          body.className = "speed-recall-body";
          while (card.firstChild && card.firstChild !== controls) body.append(card.firstChild);
          card.prepend(body);
          autoPlayUsageLinkedWord(range, item, `usage-speed:${session.id}:${session.index}:${item.id}`);
        }
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
      }

      function pronunciationFeedback(word) {
        const variants = pronunciationChoices(word).slice(0, 2);
        return variants.length ? variants.map((variant, index) => `<span>${escapeHtml(window.MWStorage.PART_OF_SPEECH_LABELS[window.MWStorage.partOfSpeechKey(variant.partOfSpeech)] || variant.partOfSpeech || `発音${index + 1}`)}: ${escapeHtml(variant.pronunciation || "表記なし")}</span>`).join("<br>") : `<span>発音: ${escapeHtml(word.pronunciation || "未取得")}</span>`;
      }

      function hideForTest(active) {
        const mode = state.activeTest?.mode === "marked" ? "★ あとでテスト" : "確認テスト・単語";
        setSessionView("testPanel", mode, active);
      }

      function startTest(direction, mode = "normal", wordIds = null) {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const session = createTestSession(range, direction, { mode, ...(wordIds ? { wordIds } : {}) });
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
        const questionIndex = session.index;
        if (session.direction === "enToJa") setTimeout(() => {
          if (state.activeTest === session && session.index === questionIndex && !session.finished) playTestAudio(testWord(range, session.questions[questionIndex].wordId));
        }, 120);
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
        const timing = answer.slow || answer.hesitant ? "まだ不安なら「あとでテスト」にマークできます。" : "";
        feedback.innerHTML = `<strong>${answer.correct ? "正解" : "不正解"}</strong><div class="test-answer-word">${escapeHtml(word.word)} — ${escapeHtml(word.meaningsJa.join("／"))}</div><div>${pronunciationFeedback(word)}</div>${renderWordSpeechDetails(word, range)}${timing ? `<div class="caution">${timing}</div>` : ""}${changed ? `<div><strong>${changed}</strong></div>` : ""}<button class="soft" data-test-action="replay">公式音声</button>${answer.correct && session.mode !== "marked" ? "" : `<button class="primary" data-test-action="next">${session.index + 1 === session.questions.length ? "結果を見る" : "次の問題"}</button>`}`;
        $("testContent").appendChild(feedback);
        if (session.direction === "jaToEn" || !answer.correct) playTestAudio(word);
        if (answer.correct && session.mode !== "marked") {
          const answerIndex = session.index;
          setTimeout(() => { if (state.activeTest === session && session.index === answerIndex && !session.finished) nextTestQuestion(); }, 700);
        }
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
        const markedMode = session.mode === "marked";
        const wrong = result.wrongWordIds.map(id => testWord(range, id)).filter(Boolean);
        const histories = (range.testHistory || []).slice(-5).reverse();
        const slow = session.answers.filter(answer => answer.slow || answer.hesitant).length;
        const modeLabel = { normal: "通常", wrong: "間違い集中", ready: "過去の確認", marked: "★ あとでテスト" }[result.mode] || "通常";
        const actions = `<div class="test-result-actions">
          ${!markedMode && wrong.length ? `<button class="soft" data-test-action="open-wrong">間違いを発音画面で確認</button><button class="soft" data-test-action="hard-all">間違いを一括で苦手</button>` : ""}
          <button class="primary" data-test-action="repeat">${markedMode ? "マークした単語をもう一周" : "同じ方向でもう一度"}</button>
          ${markedMode && wrong.length ? `<button class="soft" data-test-action="repeat-marked-wrong">間違いだけ再テスト</button>` : ""}
          <button class="soft" data-test-action="return">範囲へ戻る</button>
        </div>`;
        const rows = session.answers.map(answer => {
          const word = testWord(range, answer.wordId);
          return `<div class="marked-result-row"><span><strong>${escapeHtml(word.word)}</strong> ${answer.correct ? "○" : "×"}<span>${escapeHtml(word.meaningsJa.join("／"))}</span></span>${reviewToggleHtml(word)}</div>`;
        }).join("");
        $("testContent").innerHTML = `<div class="test-result ${markedMode ? "marked-test-result" : ""}">
          <h2>テスト結果</h2><p>${session.direction === "enToJa" ? "英語 → 日本語" : "日本語 → 英語"} / ${modeLabel}</p>
          <div class="result-score">${result.correct} / ${result.total}</div>
          ${markedMode ? actions : ""}
          <div class="result-grid"><div><strong>${result.accuracy}%</strong>正答率</div><div><strong>${(result.averageResponseMs / 1000).toFixed(1)}秒</strong>平均回答</div><div><strong>${wrong.length}</strong>間違い</div><div><strong>${slow}</strong>遅い・迷い</div></div>
          ${markedMode ? "" : actions}
          <details class="disclosure"><summary>今回の単語をマーク</summary><div class="marked-result-list">${rows}</div></details>
          <details class="disclosure"><summary>成績・間違えた単語</summary>
            <h3>累積分析</h3><p>${cumulativeTestSummary(range, session.direction)}</p>
            ${histories.length ? `<div class="history-list">${histories.map(item => `<span>${escapeHtml((item.finishedAt || "").slice(0, 10))} ${Number(item.correct) || 0}/${Number(item.total) || 0}</span>`).join("")}</div>` : ""}
            <h3>間違えた単語</h3>${wrong.length ? wrong.map(word => `<article class="wrong-word"><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(word.meaningsJa.join("／"))}</span><span>${pronunciationFeedback(word)}</span><button class="soft" data-test-audio="${escapeHtml(word.id)}">公式音声</button><button class="soft" data-test-hard="${escapeHtml(word.id)}">苦手</button></article>`).join("") : `<div class="empty">全問正解です。</div>`}
          </details>
        </div>`;
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
      }

      function requestCloseActiveSession() {
        if (state.wordStudySession) return leaveWordStudy();
        if (state.usageStudySession) return leaveUsageStudy();
        if (state.activeTest) {
          if (state.activeTest.finished) return leaveTest();
          return showModal(`<h2>テストを中止しますか？</h2><p>回答済みの成績は残りますが、テスト履歴には追加されません。</p><div class="actions"><button class="danger" data-modal-confirm>中止する</button><button class="soft" data-modal-cancel>続ける</button></div>`, () => { abortTest(state.activeTest); leaveTest(); });
        }
        if (state.speedSession) {
          if (state.speedSession.finished) return leaveSpeedReview();
          return showModal(`<h2>高速周回を終了しますか？</h2><p>ここまでの即答・怪しい・知らないの判定は保存済みです。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, leaveSpeedReview);
        }
        if (state.spellingSession) {
          if (state.spellingResult) return leaveSpellingReview();
          return showModal(`<h2>スペル確認を終了しますか？</h2><p>回答済みの履歴は保存し、未回答は残します。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, () => { finishPartialSpellingReview(); leaveSpellingReview(); });
        }
        if (state.recallSession) {
          if (state.recallSession.finished) return leaveRecall();
          return showModal(`<h2>この確認を終了しますか？</h2><p>ここまでの判定は、画面上の保存状態を確認してください。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, leaveRecall);
        }
        setSessionView("", "", false);
      }

      function renderPronunciationVariants(word) {
        const variants = pronunciationChoices(word);
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
            <div class="variant-copy">
              ${meta || number ? `<div class="variant-meta">${escapeHtml(meta)}${number}</div>` : ""}
              <div class="variant-headword">${escapeHtml(variant.headword || word.word)}</div>
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
        if (error?.name === "AbortError") return "API取得を中止しました";
        if (error?.name === "TimeoutError") return "API通信が時間切れになりました";
        return safeStoredError(error?.message || "取得に失敗しました");
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
        if (root.classList.contains("hidden")) modalReturnFocus = document.activeElement;
        root.innerHTML = `<div class="modal">${html}</div>`;
        root.classList.remove("hidden");
        root.querySelector("button, input, select, textarea")?.focus();
        root.querySelector("[data-modal-cancel]")?.addEventListener("click", closeModal);
        root.querySelector("[data-modal-confirm]")?.addEventListener("click", async () => {
          const confirmButton = root.querySelector("[data-modal-confirm]");
          confirmButton.disabled = true;
          try {
            const result = await onConfirm?.();
            // Long-running flows may replace the confirmation with a completion screen.
            if (result !== false && root.querySelector("[data-modal-confirm]")) closeModal();
          } catch {
            toast("操作を完了できませんでした。保存状態を確認してください。", true);
          } finally {
            confirmButton.disabled = false;
          }
        });
      }

      function closeModal() {
        $("modalRoot").classList.add("hidden");
        $("modalRoot").innerHTML = "";
        modalReturnFocus?.focus?.();
        modalReturnFocus = null;
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
          if (row.verbForms) word.verbForms = row.verbForms;
          if (row.partsOfSpeech) word.partsOfSpeech = row.partsOfSpeech;
          if (row.pronunciations) word.pronunciations = row.pronunciations;
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
        state.selectedRangeId = null;
        state.temporaryWordIds = null;
        state.savedFilterBeforeTemporary = null;
        $("rangeFilter").value = "all";
        if (!save()) return;
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
        if (!range || state.fetchingRangeId || !canWrite()) return;
        apiController = new AbortController();
        const controller = apiController;
        const callsBefore = actualApiCalls;
        state.fetchingRangeId = rangeId;
        const targets = range.words.filter(w => wordIds.includes(w.id));
        let success = 0, audio = 0, noAudio = 0, failed = 0, defYes = 0, defNo = 0, learnersCount = 0, collegiateCount = 0, apiCalls = 0;
        const failureReasons = new Map();
        const renderProgress = (current = "") => {
          const done = success + failed, total = targets.length, pct = total ? Math.floor(done / total * 100) : 100;
          const reasons = done === total && failureReasons.size ? `<div class="danger-note">失敗理由: ${[...failureReasons.entries()].map(([reason, count]) => `${escapeHtml(reason)}（${count}語）`).join(" / ")}</div>` : "";
          const mode = state.settings.demoMode ? `<div class="caution">デモモード中です。実APIを使う場合は設定でデモモードをOFFにしてください。</div>` : "";
          $("modalRoot").innerHTML = `<div class="modal api-progress"><h2>APIデータを取得しています</h2><div>${escapeHtml(range.rangeName || "無題の範囲")}</div><strong>${done} / ${total}語（${pct}%）</strong><div class="api-progress-bar"><span style="width:${pct}%"></span></div><div>現在処理中: ${escapeHtml(current || "完了")}</div><div class="mini-grid"><div class="mini"><strong>${success}</strong>成功</div><div class="mini"><strong>${failed}</strong>失敗</div><div class="mini"><strong>${audio}</strong>音声あり</div><div class="mini"><strong>${noAudio}</strong>音声なし</div><div class="mini"><strong>${defYes}</strong>定義あり</div><div class="mini"><strong>${defNo}</strong>定義なし</div></div>${reasons}${mode}<div class="actions"><button class="soft" data-api-cancel>取得を中止</button></div></div>`;
          $("modalRoot").querySelector("[data-api-cancel]")?.addEventListener("click", () => controller.abort());
        };
        try {
        renderProgress(targets[0]?.word || "");
        for (const word of targets) {
          if (controller.signal.aborted || !canWrite()) break;
          try {
            const result = state.settings.demoMode ? await fetchDemo(word.normalized, reference) : await fetchReal(word.normalized, getApiKey(reference), reference);
            if (controller.signal.aborted) break;
            const { apiCalls: resultApiCalls = 1, ...storedResult } = result;
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
            if (controller.signal.aborted) break;
            word.apiFetched = false;
            word.error = safeApiError(err);
            failureReasons.set(word.error, (failureReasons.get(word.error) || 0) + 1);
            failed++;
          }
          renderProgress(word.word);
          if (!save(false)) break;
        }
        apiCalls = actualApiCalls - callsBefore;
        const saved = save();
        renderProgress(controller.signal.aborted ? "中止" : "完了");
        $("modalRoot").querySelector(".api-progress").insertAdjacentHTML("beforeend", `<div class="actions"><button class="primary" data-progress-close>範囲画面へ戻る</button></div>`);
        $("modalRoot").querySelector("[data-progress-close]").addEventListener("click", closeModal);
        if (saved) toast(`取得処理終了: 成功${success} / 失敗${failed} / API通信${apiCalls}。通知はタップで閉じられます。`, failed > 0);
        } finally {
          state.fetchingRangeId = "";
          if (apiController === controller) apiController = null;
        }
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
          syllabifiedHeadword: found.hw || word,
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
        if (!cleanedKey) throw new Error("APIキーを確認してください");
        const callsBefore = actualApiCalls;
        const data = await requestDictionaryApi(word, cleanedKey, reference);
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
              apiCalls: actualApiCalls - callsBefore,
              error: "単語候補のみ返りました"
            };
          }
          return buildResultFromData(fallback.data, word, reference, actualApiCalls - callsBefore);
        }
        return buildResultFromData(data, word, reference, actualApiCalls - callsBefore);
      }

      async function requestDictionaryApi(word, apiKey, reference) {
        return dictionaryClient.request(word, apiKey, reference, {
          signal: apiController?.signal,
          onAttempt: () => { actualApiCalls++; incrementUsage(1); }
        });
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
        const syllabifiedHeadword = String(entry.hwi?.hw || String(entry.meta?.id || "").split(":")[0] || word);
        const headword = cleanHeadword(syllabifiedHeadword);
        const partOfSpeech = entry.fl || "";
        const variants = [];
        const add = (pronunciations, label = "") => {
          (pronunciations || []).forEach(pron => {
            variants.push(normalizePronunciationVariant({
              dictionarySource: reference,
              headword,
              syllabifiedHeadword,
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
          syllabifiedHeadword: String(entry.hwi?.hw || word),
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
          if (!save()) return false;
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
          if (!save()) return false;
          $("wordPanel").classList.add("hidden");
          toast("範囲を削除しました。");
        });
      }

      function playOfficial(wordId) {
        stopContinuousPlayback();
        const word = findWord(wordId);
        if (!word) return;
        rememberWord(wordId);
        const url = officialAudioUrlForWord(word);
        if (!url) return playTestAudio(word);
        previewPlayer.play([{ text: word.word, url, requireOfficial: requiresPartOfSpeechAudio(word) }]);
      }

      function playPronunciationVariant(wordId, variantId) {
        stopContinuousPlayback();
        const word = findWord(wordId);
        const variant = pronunciationChoices(word).find(item => item.id === variantId);
        if (!word || !variant) return;
        rememberWord(wordId);
        previewPlayer.play([{ text: word.word, url: variant.audioUrl, label: window.MWStorage.PART_OF_SPEECH_LABELS[window.MWStorage.partOfSpeechKey(variant.partOfSpeech)] || variant.partOfSpeech, requireOfficial: requiresPartOfSpeechAudio(word) }]);
      }

      function speakWord(wordId) {
        stopContinuousPlayback();
        const word = findWord(wordId);
        if (word && requiresPartOfSpeechAudio(word)) return playTestAudio(word);
        if (!word || !speakWordText(word.word)) return toast("このブラウザでは読み上げに対応していません。", true);
        rememberWord(wordId);
      }

      function stopPreviewAudio() { previewPlayer.stop(); }

      function speakWordText(text) {
        if (!text || !canUseContinuousSpeech()) return false;
        return previewPlayer.play([{ text }]);
      }

      function rememberWord(wordId) {
        const range = findRangeByWord(wordId);
        if (!range) return;
        const changed = state.selectedRangeId !== range.id || range.currentWordId !== wordId;
        state.selectedRangeId = range.id;
        range.currentWordId = wordId;
        if (changed) save(false);
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

      function updateUsageTimingSettings() {
        const mode = state.settings.usageReviewMode === "fixed" ? "fixed" : "auto";
        const fixedField = $("usageReviewFixedField");
        if (fixedField) fixedField.classList.toggle("hidden", mode !== "fixed");
      }

      function speechOptions() {
        return { voiceURI: state.settings.speechVoiceURI, rate: state.settings.speechRate };
      }

      function renderSpeechSettings(selected = $("speechVoice").value) {
        const voices = window.MWPlayback.americanVoices();
        const select = $("speechVoice");
        select.innerHTML = `<option value="">自動（高品質音声を優先）</option>` + voices.map(voice =>
          `<option value="${escapeHtml(window.MWPlayback.voiceId(voice))}">${escapeHtml(voice.name || "米国英語")}</option>`).join("");
        if (selected && !voices.some(voice => window.MWPlayback.voiceId(voice) === selected)) {
          select.innerHTML += `<option value="${escapeHtml(selected)}">保存した声（現在利用できません・自動選択）</option>`;
        }
        select.value = selected || "";
        const chosen = voices.find(voice => window.MWPlayback.voiceId(voice) === select.value) || voices[0];
        $("speechVoiceStatus").textContent = chosen
          ? `使用する声：${chosen.name || "米国英語"}。試聴して好みの声を選び、設定を保存してください。`
          : window.MWPlayback.MISSING_US_VOICE;
      }

      function canUseContinuousSpeech() {
        return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
      }

      function isContinuousWordPlayable(word) {
        return Boolean(word && (officialAudioUrlForWord(word) || (word.word && !requiresPartOfSpeechAudio(word) && canUseContinuousSpeech() && window.MWPlayback.americanVoices().length > 0)));
      }

      function continuousUsageDelayMs(wordId = playbackState.currentWordId) {
        const range = state.ranges.find(item => item.id === playbackState.rangeId);
        return calculateUsageReviewDelayMs(linkedUsageItemsForWord(range, wordId), {
          mode: state.settings.usageReviewMode,
          fixedSeconds: state.settings.usageReviewExtraSeconds
        });
      }

      function playableIndexFrom(startIndex, direction) {
        for (let index = startIndex; index >= 0 && index < playbackState.wordIds.length; index += direction) {
          if (isContinuousWordPlayable(findWord(playbackState.wordIds[index]))) return index;
        }
        return -1;
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
        const reviewMs = playbackState.phase === "reviewing" ? playbackState.remainingDelayMs : 0;
        const timingLabel = playbackState.phase === "examples" ? `・例文読み上げ ${playbackState.exampleIndex + 1} / ${playbackState.exampleTexts.length}` : reviewMs ? `・例文熟語 ${Math.ceil(reviewMs / 100) / 10}秒` : "";
        $("playbackDockWord").textContent = word ? `${word.word}${timingLabel}` : "連続再生";
        $("playbackDockProgress").textContent = playbackState.active ? `${Math.min(playbackState.currentIndex + 1, playbackState.wordIds.length)} / ${playbackState.wordIds.length}` : "0 / 0";
        $("playbackReplay").disabled = !playbackState.active || playbackState.currentIndex < 0;
        $("playbackPrevious").disabled = !playbackState.active || playableIndexFrom(playbackState.currentIndex - 1, -1) < 0;
        $("playbackNext").disabled = !playbackState.active || playableIndexFrom(playbackState.currentIndex + 1, 1) < 0;
      }

      function setContinuousUsageOpen(wordId = "") {
        document.querySelectorAll("details.linked-usage[data-linked-usage-word]").forEach(details => {
          details.open = Boolean(wordId && details.dataset.linkedUsageWord === wordId);
        });
      }

      function clearContinuousTimer(preserveRemaining = false) {
        if (preserveRemaining && playbackState.timerId !== null) {
          playbackState.remainingDelayMs = Math.max(0, playbackState.timerDueAt - playbackClock.now());
        }
        if (playbackState.timerId !== null) playbackClock.clearTimeout(playbackState.timerId);
        playbackState.timerId = null;
        playbackState.timerStartedAt = 0;
        playbackState.timerDueAt = 0;
      }

      function detachContinuousMediaCallbacks() {
        window.clearTimeout(continuousWatchdog);
        continuousWatchdog = null;
        if (playbackState.currentAudio) {
          playbackState.currentAudio.onended = null;
          playbackState.currentAudio.onerror = null;
        }
        if (playbackState.currentUtterance) {
          playbackState.currentUtterance.onend = null;
          playbackState.currentUtterance.onerror = null;
        }
      }

      function invalidateContinuousOperation() {
        playbackState.operationToken++;
        clearContinuousTimer(false);
        detachContinuousMediaCallbacks();
        if (playbackState.currentAudio) {
          playbackState.currentAudio.pause();
          try { playbackState.currentAudio.currentTime = 0; } catch {}
        }
        if (playbackState.currentUtterance && canUseContinuousSpeech()) {
          window.speechSynthesis.cancel();
        }
        playbackState.currentUtterance = null;
      }

      function callbackMatches(token, index, wordId) {
        return playbackState.active
          && !playbackState.paused
          && playbackState.operationToken === token
          && playbackState.currentIndex === index
          && playbackState.currentWordId === wordId;
      }

      function stopContinuousPlayback() {
        invalidateContinuousOperation();
        if (playbackState.currentAudio) playbackState.currentAudio.removeAttribute("src");
        playbackState.active = false;
        playbackState.currentAudio = null;
        playbackState.currentUtterance = null;
        playbackState.exampleTexts = [];
        playbackState.exampleIndex = -1;
        playbackState.rangeId = "";
        playbackState.wordIds = [];
        playbackState.currentIndex = -1;
        playbackState.currentWordId = "";
        playbackState.paused = false;
        playbackState.phase = "idle";
        playbackState.transport = "none";
        playbackState.resumeAction = "none";
        playbackState.remainingDelayMs = 0;
        setContinuousUsageOpen();
        stopPreviewAudio();
        updatePlaybackControls();
      }

      function attachOfficialAudioCallbacks(token, index, wordId) {
        const audio = playbackState.currentAudio;
        if (!audio) return;
        audio.onended = () => {
          if (playbackState.transport === "official-audio" && playbackState.phase === "playing") finishContinuousWord(token, index, wordId);
        };
        audio.onerror = () => fallbackToContinuousSpeech(token, index, wordId);
        continuousWatchdog = window.setTimeout(() => fallbackToContinuousSpeech(token, index, wordId), 15000);
      }

      function attachSpeechCallbacks(utterance, token, index, wordId) {
        const complete = failed => {
          if (!callbackMatches(token, index, wordId) || playbackState.currentUtterance !== utterance) return;
          if (playbackState.phase === "examples") {
            if (failed) toast("例文を読み上げられませんでした。端末の英語音声設定を確認してください。", true);
            detachContinuousMediaCallbacks();
            playbackState.currentUtterance = null;
            playNextContinuousExample(token, index, wordId);
          } else if (failed) skipUnplayableContinuousWord(token, index, wordId);
          else finishContinuousWord(token, index, wordId);
        };
        utterance.onend = () => complete(false);
        utterance.onerror = () => complete(true);
        continuousWatchdog = window.setTimeout(() => {
          if (!callbackMatches(token, index, wordId) || playbackState.currentUtterance !== utterance) return;
          utterance.onend = null;
          utterance.onerror = null;
          window.speechSynthesis.cancel();
          complete(true);
        }, Math.min(120000, Math.max(30000, utterance.text.length * 160)));
      }

      function playNextContinuousExample(token, index, wordId) {
        if (!callbackMatches(token, index, wordId)) return;
        const text = playbackState.exampleTexts[++playbackState.exampleIndex];
        if (!text || !canUseContinuousSpeech()) return scheduleNextContinuousWord();
        const utterance = window.MWPlayback.englishUtterance(text, window, speechOptions());
        if (!utterance) { toast(window.MWPlayback.MISSING_US_VOICE, true); return scheduleNextContinuousWord(); }
        playbackState.phase = "examples";
        playbackState.currentUtterance = utterance;
        playbackState.transport = "speech-synthesis";
        playbackState.resumeAction = "speech-synthesis";
        attachSpeechCallbacks(utterance, token, index, wordId);
        $("audioStatus").textContent = window.MWPlayback.speechStatus(utterance);
        updatePlaybackControls();
        try { window.speechSynthesis.speak(utterance); }
        catch { utterance.onerror?.(); }
      }

      function startContinuousSpeech(word, token, index, wordId) {
        if (!canUseContinuousSpeech() || requiresPartOfSpeechAudio(word)) return false;
        const utterance = window.MWPlayback.englishUtterance(word.word, window, speechOptions());
        if (!utterance) { toast(window.MWPlayback.MISSING_US_VOICE, true); return false; }
        attachSpeechCallbacks(utterance, token, index, wordId);
        playbackState.currentUtterance = utterance;
        playbackState.transport = "speech-synthesis";
        $("audioStatus").textContent = window.MWPlayback.speechStatus(utterance);
        playbackState.resumeAction = "speech-synthesis";
        try {
          window.speechSynthesis.speak(utterance);
          return true;
        } catch {
          playbackState.currentUtterance = null;
          playbackState.transport = "none";
          return false;
        }
      }

      function fallbackToContinuousSpeech(token, index, wordId) {
        if (!callbackMatches(token, index, wordId) || playbackState.transport !== "official-audio") return;
        detachContinuousMediaCallbacks();
        playbackState.currentAudio?.pause();
        const word = findWord(wordId);
        if (word && startContinuousSpeech(word, token, index, wordId)) {
          updatePlaybackControls();
          return;
        }
        skipUnplayableContinuousWord(token, index, wordId);
      }

      function skipUnplayableContinuousWord(token, index, wordId) {
        if (!callbackMatches(token, index, wordId)) return;
        invalidateContinuousOperation();
        playbackState.currentIndex = index + 1;
        playbackState.transport = "none";
        playbackState.resumeAction = "play-current";
        playContinuousWord();
      }

      function finishContinuousWord(token, index, wordId) {
        if (!callbackMatches(token, index, wordId)) return;
        detachContinuousMediaCallbacks();
        playbackState.currentUtterance = null;
        const range = state.ranges.find(item => item.id === playbackState.rangeId);
        playbackState.exampleTexts = linkedUsageItemsForWord(range, wordId)
          .filter(item => item.type === "example" && item.english?.trim())
          .map(item => item.english.trim());
        playbackState.exampleIndex = -1;
        playNextContinuousExample(token, index, wordId);
      }

      function armContinuousTimer(delayMs) {
        const token = playbackState.operationToken;
        const index = playbackState.currentIndex;
        const wordId = playbackState.currentWordId;
        const safeDelayMs = Math.max(0, Math.round(delayMs));
        playbackState.remainingDelayMs = safeDelayMs;
        playbackState.timerStartedAt = playbackClock.now();
        playbackState.timerDueAt = playbackState.timerStartedAt + safeDelayMs;
        playbackState.timerId = playbackClock.setTimeout(() => {
          if (!callbackMatches(token, index, wordId) || playbackState.timerId === null) return;
          playbackState.timerId = null;
          playbackState.timerStartedAt = 0;
          playbackState.timerDueAt = 0;
          playbackState.remainingDelayMs = 0;
          const nextIndex = playableIndexFrom(index + 1, 1);
          if (nextIndex < 0) {
            stopContinuousPlayback();
            toast("連続再生が完了しました。");
            return;
          }
          playbackState.currentIndex = nextIndex;
          playbackState.transport = "none";
          playbackState.resumeAction = "play-current";
          playContinuousWord();
        }, safeDelayMs);
      }

      function toggleContinuousPause() {
        if (!playbackState.active) return;
        if (!playbackState.paused) {
          const resumeAction = playbackState.transport === "timer"
            ? "timer"
            : playbackState.transport === "official-audio"
              ? "official-audio"
              : playbackState.transport === "speech-synthesis"
                ? "speech-synthesis"
                : "play-current";
          if (resumeAction === "timer") clearContinuousTimer(true);
          playbackState.operationToken++;
          detachContinuousMediaCallbacks();
          if (resumeAction === "official-audio") playbackState.currentAudio?.pause();
          if (resumeAction === "speech-synthesis" && canUseContinuousSpeech()) {
            // Some speech engines discard paused utterances or cannot resume.
            // Retain the text and queue position; restart this sentence on resume.
            try { window.speechSynthesis.cancel(); } catch {}
          }
          playbackState.paused = true;
          playbackState.resumeAction = resumeAction;
          updatePlaybackControls();
          return;
        }
        playbackState.paused = false;
        const token = ++playbackState.operationToken;
        const index = playbackState.currentIndex;
        const wordId = playbackState.currentWordId;
        const resumeAction = playbackState.resumeAction;
        if (resumeAction === "official-audio" && playbackState.currentAudio) {
          attachOfficialAudioCallbacks(token, index, wordId);
          playbackState.currentAudio.play().catch(() => fallbackToContinuousSpeech(token, index, wordId));
        } else if (resumeAction === "speech-synthesis" && playbackState.currentUtterance && canUseContinuousSpeech()) {
          const utterance = window.MWPlayback.englishUtterance(playbackState.currentUtterance.text, window, speechOptions());
          if (!utterance) { stopContinuousPlayback(); toast(window.MWPlayback.MISSING_US_VOICE, true); return; }
          playbackState.currentUtterance = utterance;
          attachSpeechCallbacks(utterance, token, index, wordId);
          try { window.speechSynthesis.speak(utterance); }
          catch { utterance.onerror?.(); }
        } else if (resumeAction === "timer") {
          armContinuousTimer(playbackState.remainingDelayMs);
        } else {
          playContinuousWord();
        }
        updatePlaybackControls();
      }

      function startContinuousPlayback(startWordId = "") {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const words = filteredWords(range);
        if (!words.length) return toast("連続再生できる単語がありません。", true);
        const requestedWordId = typeof startWordId === "string" && startWordId ? startWordId : range.currentWordId;
        const requestedIndex = words.findIndex(word => word.id === requestedWordId);
        if (startWordId && requestedIndex < 0) return toast("現在の表示条件では、その単語から再生できません。", true);
        $("materialContents").open = true;
        playbackState.active = true;
        playbackState.rangeId = range.id;
        playbackState.wordIds = words.map(word => word.id);
        playbackState.currentIndex = Math.max(0, requestedIndex);
        playbackState.paused = false;
        playbackState.phase = "idle";
        playbackState.transport = "none";
        playbackState.resumeAction = "play-current";
        updatePlaybackControls();
        playContinuousWord();
      }

      function playContinuousWord() {
        if (!playbackState.active || playbackState.paused) return;
        const nextPlayableIndex = playableIndexFrom(playbackState.currentIndex, 1);
        if (nextPlayableIndex < 0) {
          stopContinuousPlayback();
          toast(window.MWPlayback.americanVoices().length ? "連続再生できる音声がありません。" : window.MWPlayback.MISSING_US_VOICE, true);
          return;
        }
        playbackState.currentIndex = nextPlayableIndex;
        const word = findWord(playbackState.wordIds[nextPlayableIndex]);
        playbackState.currentWordId = word.id;
        playbackState.phase = "playing";
        playbackState.remainingDelayMs = 0;
        setContinuousUsageOpen(word.id);
        rememberWord(word.id);
        document.querySelector(`[data-word-id="${CSS.escape(word.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        const token = ++playbackState.operationToken;
        const officialAudioUrl = officialAudioUrlForWord(word);
        if (officialAudioUrl) {
          const audio = playbackState.currentAudio || new Audio();
          playbackState.currentAudio = audio;
          playbackState.currentUtterance = null;
          playbackState.transport = "official-audio";
          $("audioStatus").textContent = "Merriam-Webster公式音声";
          playbackState.resumeAction = "official-audio";
          attachOfficialAudioCallbacks(token, nextPlayableIndex, word.id);
          audio.src = officialAudioUrl;
          audio.currentTime = 0;
          audio.play().catch(() => fallbackToContinuousSpeech(token, nextPlayableIndex, word.id));
        } else {
          if (!startContinuousSpeech(word, token, nextPlayableIndex, word.id)) {
            skipUnplayableContinuousWord(token, nextPlayableIndex, word.id);
          }
        }
        updatePlaybackControls();
      }

      function scheduleNextContinuousWord() {
        if (!playbackState.active || playbackState.paused || playbackState.timerId !== null) return;
        invalidateContinuousOperation();
        const usageDelayMs = continuousUsageDelayMs();
        const baseDelayMs = (Number(state.settings.playbackInterval) || 2) * 1000;
        playbackState.phase = usageDelayMs ? "reviewing" : "waiting";
        playbackState.transport = "timer";
        playbackState.resumeAction = "timer";
        armContinuousTimer(baseDelayMs + usageDelayMs);
        updatePlaybackControls();
      }

      function replayCurrentContinuousWord() {
        if (!playbackState.active || playbackState.currentIndex < 0) return;
        const wasPaused = playbackState.paused;
        invalidateContinuousOperation();
        if (wasPaused) {
          selectPausedContinuousWord(playbackState.currentIndex);
          return;
        }
        playbackState.phase = "idle";
        playbackState.transport = "none";
        playbackState.resumeAction = "play-current";
        playbackState.remainingDelayMs = 0;
        playContinuousWord();
      }

      function selectPausedContinuousWord(index) {
        const word = findWord(playbackState.wordIds[index]);
        if (!word) return;
        playbackState.currentIndex = index;
        playbackState.currentWordId = word.id;
        playbackState.paused = true;
        playbackState.phase = "idle";
        playbackState.transport = "none";
        playbackState.resumeAction = "play-current";
        playbackState.remainingDelayMs = 0;
        setContinuousUsageOpen(word.id);
        rememberWord(word.id);
        document.querySelector(`[data-word-id="${CSS.escape(word.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        updatePlaybackControls();
      }

      function moveContinuousPlayback(direction) {
        if (!playbackState.active || ![-1, 1].includes(direction)) return;
        const targetIndex = playableIndexFrom(playbackState.currentIndex + direction, direction);
        if (targetIndex < 0) return;
        const wasPaused = playbackState.paused;
        invalidateContinuousOperation();
        if (wasPaused) {
          selectPausedContinuousWord(targetIndex);
          return;
        }
        playbackState.currentIndex = targetIndex;
        playbackState.phase = "idle";
        playbackState.transport = "none";
        playbackState.resumeAction = "play-current";
        playbackState.remainingDelayMs = 0;
        playContinuousWord();
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
        if (persistence.readError) return toast("元データを読み込めないため、空のJSONは出力しません。正常なバックアップを選んで復元してください。", true);
        try {
          let source = currentData();
          if (persistence.startupError && !persistence.dirty) {
            const saved = parseBackup(localStorage.getItem(STORAGE_KEY));
            if (!saved.ok) throw new Error("RECOVERY_REQUIRED");
            source = saved.data;
          }
          const payload = createBackup(source, new Date().toISOString(), localSecrets());
          const text = JSON.stringify(payload, null, 2);
          if (!download(`mw-pronunciation-${todayKey()}.json`, text, "application/json")) return;
          toast(`学習履歴・設定を含むschema v${payload.schemaVersion}のJSONを書き出しました。APIキーは含まれていません。サイズ: ${formatBytes(new Blob([text]).size)}`);
        } catch (error) {
          toast("JSONを安全に作成できませんでした。秘密情報の混入やデータの形式を確認してください。", true);
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
        const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
        download(`mw-pronunciation-${todayKey()}.csv`, csv, "text/csv");
      }

      function exportQuizlet() {
        const examples = state.ranges.flatMap(range => (range.usageItems || []).filter(item => item.type === "example"));
        if (!examples.length) return toast("Quizlet用に出力できる例文がありません。", true);
        const text = examples.map(item => `${item.english}\t${item.japanese}`).join("\n");
        if (!download(`quizlet-examples-${todayKey()}.txt`, text, "text/plain")) return;
        toast(`例文${examples.length}件をQuizlet形式で書き出しました。熟語と管理IDは含みません。`);
      }

      function exportPreUpgrade() {
        try {
          const raw = localStorage.getItem(PRE_SUPERAPP_BACKUP_KEY);
          if (!raw) return toast("この端末には改修前データの自動保存がありません。通常のJSON保存を使ってください。", true);
          const parsed = parseBackup(raw);
          if (!parsed.ok) throw new Error("invalid backup");
          const payload = createBackup(parsed.data, new Date().toISOString(), localSecrets());
          if (download(`mw-before-superapp-${todayKey()}.json`, JSON.stringify(payload, null, 2), "application/json")) toast("改修前データを検証して書き出しました。APIキーは含まれていません。");
        } catch { toast("改修前データを安全に出力できません。元データは端末内に保持しています。", true); }
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
        migrated.data.settings.saveKey = false;
        showModal(`<h2>${escapeHtml(label)}へ戻す</h2><div class="danger-note">現在の学習データを置き換えます。直前の保存データは端末内に退避します。未保存の変更がある場合は先にJSONで退避してください。</div><div class="actions"><button class="warn" data-modal-confirm>復元する</button><button class="soft" data-modal-cancel>キャンセル</button></div>`, () => commitReplacement(migrated.data, PRE_RESTORE_BACKUP_KEY));
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
        try {
          assertNoSecrets(text, localSecrets());
          if (type === "application/json") assertStorageSize(text);
        }
        catch { toast("秘密情報の混入、または保存領域へのアクセス失敗のため出力を中止しました。", true); return false; }
        const blob = new Blob([text], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return true;
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
        return commitReplacement(combined.data, PRE_IMPORT_BACKUP_KEY);
      }

      function commitReplacement(data, recoveryKey) {
        if (!canWrite(true)) return false;
        if (persistence.dirty && !persistence.readError) {
          toast("未保存の変更があります。先に保存を再試行するか、JSONで退避してから再読込してください。", true);
          return false;
        }
        try {
          const payload = createLocalSnapshot(data);
          let previous = {};
          try { previous = JSON.parse(persistence.raw || "{}"); } catch { /* Explicit recovery from corrupt main. */ }
          quarantineSync(previous);
          const sync = window.MWSync.changed(previous.sync, Number(previous.revision) || 0);
          const raw = JSON.stringify({ ...payload, savedAt: new Date().toISOString(), revision: (Number(previous.revision) || 0) + 1, sync });
          assertNoSecrets(raw, localSecrets());
          assertStorageSize(raw);
          // Never mutate primary storage unless its recovery copy succeeded.
          // Keep that copy even if the subsequent primary write fails.
          if (persistence.raw != null) localStorage.setItem(recoveryKey, persistence.raw);
          localStorage.setItem(STORAGE_KEY, raw);
          persistence.raw = raw;
          persistence.dirty = false;
          location.reload();
          return true;
        } catch (error) {
          toast("置き換えを中止しました。元の学習データは保持しています。空き容量とデータの形式を確認してください。", true);
          return false;
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
          if (!save()) return false;
          $("wordPanel").classList.add("hidden");
          toast("全データを削除しました。");
        });
      }

      function switchTab(name) {
        stopContinuousPlayback();
        document.querySelectorAll("[data-tab]").forEach(btn => {
          btn.setAttribute("aria-selected", String(btn.dataset.tab === name));
          btn.tabIndex = btn.dataset.tab === name ? 0 : -1;
        });
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
        bindStudyCardSwipe();
        document.querySelector(".tabs").addEventListener("keydown", event => {
          const tabs = [...document.querySelectorAll("[data-tab]")];
          const current = tabs.indexOf(event.target);
          if (current < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
          tabs[index].focus(); tabs[index].click();
        });
        document.addEventListener("click", event => {
          const target = event.target.closest("[data-go]");
          if (target) { switchTab(target.dataset.go); window.scrollTo(0, 0); $("rangeName").focus(); }
        });
        $("retrySave").addEventListener("click", () => save());
        $("restorePreRestore").addEventListener("click", () => {
          try {
            const raw = localStorage.getItem(PRE_RESTORE_BACKUP_KEY);
            if (raw) restoreStoredBackup(raw, "復元直前のデータ");
            else toast("復元直前の退避データはありません。", true);
          } catch { toast("退避データを読み込めません。", true); }
        });
        document.addEventListener("keydown", event => {
          const root = $("modalRoot");
          if (root.classList.contains("hidden")) return;
          if (event.key === "Escape" && root.querySelector("[data-modal-cancel]")) { event.preventDefault(); closeModal(); }
          if (event.key === "Tab") {
            const controls = [...root.querySelectorAll("button:not(:disabled), input, select, textarea, a[href]")];
            if (!controls.length) return;
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }
        });
        window.addEventListener("storage", event => {
          if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== persistence.raw) {
            persistence.conflict = true;
            stopContinuousPlayback();
            apiController?.abort();
            renderPersistence();
          }
        });
        window.addEventListener("beforeunload", event => {
          if (persistence.dirty) { event.preventDefault(); event.returnValue = ""; }
        });
        window.addEventListener("pagehide", () => {
          stopContinuousPlayback();
          apiController?.abort();
        });
        document.querySelectorAll("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
          if (btn.dataset.tab === "ranges") {
            state.temporaryWordIds = null;
            state.savedFilterBeforeTemporary = null;
            if (state.selectedRangeId) {
              state.selectedRangeId = null;
              if (persistence.writer && !persistence.conflict && !persistence.readError) save(false);
            }
          }
          switchTab(btn.dataset.tab);
          window.scrollTo(0, 0);
        }));
        window.speechSynthesis?.addEventListener?.("voiceschanged", () => renderSpeechSettings());
        $("speechVoice").addEventListener("change", () => renderSpeechSettings($("speechVoice").value));
        $("previewSpeech").addEventListener("click", () => {
          stopContinuousPlayback();
          const options = { voiceURI: $("speechVoice").value, rate: Number($("speechRate").value) };
          const sample = window.MWPlayback.englishUtterance("Keep a record of your expenses. I would like a cup of coffee, please.", window, options);
          if (!sample) { toast(window.MWPlayback.MISSING_US_VOICE, true); return; }
          // Use the same cancellable preview path as study playback.
          previewPlayer.play([{ text: sample.text, speechOptions: options }]);
        });
        $("saveApiSettings").addEventListener("click", () => {
          const wantsSave = $("saveKey").checked;
          const apiKey = cleanApiKey($("apiKey").value);
          const collegiateApiKey = cleanApiKey($("collegiateApiKey").value);
          const apply = () => {
            if (!canWrite()) return false;
            state.settings.demoMode = $("demoMode").checked;
            state.settings.saveKey = wantsSave;
            state.settings.dictionaryType = $("dictionaryType").value;
            state.settings.definitionLimit = Number($("definitionLimit").value) || 2;
            state.settings.speechVoiceURI = $("speechVoice").value;
            state.settings.speechRate = Number($("speechRate").value) || 1;
            state.settings.mondayEndTime = $("mondayEndTime").value;
            state.settings.wednesdayEndTime = $("wednesdayEndTime").value;
            state.settings.fridayEndTime = $("fridayEndTime").value;
            state.settings.apiKeySession = wantsSave ? "" : apiKey;
            state.settings.collegiateApiKeySession = wantsSave ? "" : collegiateApiKey;
            $("apiKey").value = apiKey;
            $("collegiateApiKey").value = collegiateApiKey;
            try {
              if (wantsSave && apiKey) localStorage.setItem(API_KEY_KEY, apiKey); else localStorage.removeItem(API_KEY_KEY);
              if (wantsSave && collegiateApiKey) localStorage.setItem(COLLEGIATE_API_KEY_KEY, collegiateApiKey); else localStorage.removeItem(COLLEGIATE_API_KEY_KEY);
            } catch {
              persistence.dirty = true;
              persistence.credentialError = true;
              renderPersistence();
              toast("APIキーを保存できませんでした。設定画面から再試行してください。", true);
              return false;
            }
            persistence.credentialError = false;
            if (!save()) return false;
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
          if (!canWrite()) return false;
          $("apiKey").value = "";
          $("collegiateApiKey").value = "";
          state.settings.apiKeySession = "";
          state.settings.collegiateApiKeySession = "";
          try {
            localStorage.removeItem(API_KEY_KEY);
            localStorage.removeItem(COLLEGIATE_API_KEY_KEY);
            persistence.credentialError = false;
          } catch {
            persistence.dirty = true;
            persistence.credentialError = true;
            renderPersistence();
            toast("APIキーを削除できませんでした。設定画面から再試行してください。", true);
            return false;
          }
          if (!save()) return false;
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
          if (btn.dataset.action === "marked") { stopContinuousPlayback(); state.selectedRangeId = range.id; save(false); showMarkedTestMenu(); }
          if (btn.dataset.action === "fetch") confirmFetch(range);
          if (btn.dataset.action === "test-ended") { range.manualTestEndedDate = todayKey(); if (!save()) return; toast("テスト終了として記録しました。次の範囲を優先します。"); }
          if (btn.dataset.action === "test-before") { range.manualTestEndedDate = ""; if (!save()) return; toast("テスト前として記録しました。"); }
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
        $("closeWords").addEventListener("click", () => { stopContinuousPlayback(); state.selectedRangeId = null; state.temporaryWordIds = null; state.savedFilterBeforeTemporary = null; save(false); $("wordPanel").classList.add("hidden"); $("page-ranges").classList.remove("hidden"); $("page-ranges").scrollIntoView({ block: "start" }); });
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
        $("usageReviewMode").addEventListener("change", () => {
          state.settings.usageReviewMode = $("usageReviewMode").value === "fixed" ? "fixed" : "auto";
          updateUsageTimingSettings();
          save(false);
        });
        $("usageReviewExtraSeconds").addEventListener("change", () => {
          state.settings.usageReviewExtraSeconds = Number($("usageReviewExtraSeconds").value) || 0;
          save(false);
        });
        $("continuousStart").addEventListener("click", () => startContinuousPlayback());
        $("continuousStop").addEventListener("click", stopContinuousPlayback);
        $("playbackPause").addEventListener("click", toggleContinuousPause);
        $("playbackReplay").addEventListener("click", replayCurrentContinuousWord);
        $("playbackPrevious").addEventListener("click", () => moveContinuousPlayback(-1));
        $("playbackNext").addEventListener("click", () => moveContinuousPlayback(1));
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
        $("startWordTestMenu").addEventListener("click", showWordTestMenu);
        $("startUsageTest").addEventListener("click", startUsageTestReview);
        $("startMarkedEnglish").addEventListener("click", () => startTest("enToJa", "marked"));
        $("startMarkedJapanese").addEventListener("click", () => startTest("jaToEn", "marked"));
        $("markedWordSearch").addEventListener("input", renderMarkedPicker);
        $("markedWordList").addEventListener("change", event => {
          const input = event.target.closest("[data-marked-word]");
          if (input) setReviewMarked(input.dataset.markedWord, input.checked);
        });
        $("startSpellingFinish").addEventListener("click", startSpellingReview);
        $("memoryPrimaryModes").addEventListener("click", event => {
          const mode = event.target.closest("[data-memory-mode]")?.dataset.memoryMode;
          if (mode) startRecall("memory", mode, "all", "recall");
        });
        $("studySessionClose").addEventListener("click", requestCloseActiveSession);
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
          if (action === "repeat-marked-wrong") startTest(session.direction, "marked", session.answers.filter(answer => !answer.correct).map(answer => answer.wordId));
          if (action === "repeat") startTest(session.direction, session.mode || "normal");
        });
        $("speedContent").addEventListener("click", event => {
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
          if (studyAction === "full-audio") return speakWordText(currentUsageStudyItem()?.english);
          if (studyAction === "audio") {
            const session = activeStudySession();
            return session === state.wordStudySession ? playTestAudio(currentWordStudyWord()) : speakWordText(currentUsageStudyItem()?.english);
          }
          if (studyAction === "repeat") return state.wordStudySession ? startWordStudy() : startUsageStudy();
          if (studyAction === "return") return state.wordStudySession ? leaveWordStudy() : leaveUsageStudy();
          if (studyAction === "abort") return showModal(`<h2>学習モードを終了しますか？</h2><p>このモードでは採点や定着履歴を記録していません。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, state.wordStudySession ? leaveWordStudy : leaveUsageStudy);
          const rating = event.target.closest("[data-recall-rating]")?.dataset.recallRating;
          if (rating) return rateCurrentRecall(rating);
          const action = event.target.closest("[data-recall-action]")?.dataset.recallAction;
          if (action === "full-audio") return speakWordText(currentRecallItem()?.english);
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
            return startRecall(previous.source, previous.mode, previous.type, previous.purpose);
          }
          if (action === "return") return leaveRecall();
          if (action === "abort") return showModal(`<h2>全文暗唱を終了しますか？</h2><p>ここまでの履歴は、画面上の保存状態を確認してください。</p><div class="actions"><button class="danger" data-modal-confirm>終了する</button><button class="soft" data-modal-cancel>続ける</button></div>`, leaveRecall);
          if (event.target.closest("[data-study-card]")) {
            const session = activeStudySession();
            if (!session || session.transitioning) return;
            return moveStudyCard(1);
          }
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
          if (btn.dataset.wordAction === "play-from") {
            event.preventDefault();
            event.stopPropagation();
            startContinuousPlayback(word.id);
            return;
          }
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
        $("toast").addEventListener("click", dismissToast);
        document.addEventListener("change", event => {
          const select = event.target.closest?.("[data-pronunciation-pos]");
          if (!select || !canWrite()) return;
          const word = findWord(select.dataset.pronunciationPos);
          if (!word || !window.MWStorage.wordPartsOfSpeech(word).includes(select.value)) return;
          stopContinuousPlayback();
          word.preferredPartOfSpeech = select.value;
          save(false); refreshGrammar(word);
        });
        document.addEventListener("click", event => {
          const posButton = event.target.closest?.("[data-edit-pos]");
          if (posButton) { const word = findWord(posButton.dataset.editPos); if (word) editPartsOfSpeech(word); return; }
          const usageButton = event.target.closest?.("[data-usage-speak]");
          if (usageButton) {
            const item = state.ranges.find(range => range.id === state.selectedRangeId)?.usageItems?.find(item => item.id === usageButton.dataset.usageSpeak);
            if (item) { stopContinuousPlayback(); speakWordText(item.english); }
            return;
          }
          const verbButton = event.target.closest?.("[data-verb-speak], [data-verb-edit]");
          if (verbButton) {
            const id = verbButton.dataset.verbSpeak || verbButton.dataset.verbEdit;
            const word = findRangeByWord(id)?.words.find(word => word.id === id);
            if (!word) return;
            if (verbButton.dataset.verbEdit) return editVerbForms(word);
            stopContinuousPlayback();
            const key = verbButton.dataset.form;
            const text = key === "base" ? word.word : word.verbForms?.[key]?.[Number(verbButton.dataset.formIndex)];
            const forms = [word.word, ...Object.keys(window.MWStorage.VERB_FORM_LABELS).flatMap(key => word.verbForms?.[key] || [])];
            const verbPart = window.MWStorage.wordPartsOfSpeech(word).find(window.MWStorage.isVerbPartOfSpeech);
            const base = { text: word.word, url: preferredPronunciationVariant(word, undefined, false, verbPart)?.audioUrl, requireOfficial: requiresPartOfSpeechAudio(word) };
            if (key === "all") previewPlayer.play([base, ...forms.slice(1).map(text => ({ text }))]);
            else if (key === "base") previewPlayer.play([base]);
            else if (text) speakWordText(text);
            return;
          }
          const button = event.target.closest?.("[data-review-toggle]");
          if (!button) return;
          const range = findRangeByWord(button.dataset.reviewToggle);
          const word = range?.words.find(item => item.id === button.dataset.reviewToggle);
          if (word) setReviewMarked(word.id, word.reviewMarked !== true);
        });
        document.addEventListener("visibilitychange", () => {
          if (document.hidden && playbackState.active && !playbackState.paused) toggleContinuousPause();
          else render();
        });
        window.addEventListener("focus", render);
      }

      function startupDiagnostic(stage, error) {
        // Only fixed error names and coordinates in our own scripts may reach
        // the UI. Exception messages/stacks can contain API keys or user data.
        const allowed = ["Error", "TypeError", "ReferenceError", "RangeError", "SyntaxError", "AbortError", "SecurityError", "UnknownError", "InvalidStateError", "NotAllowedError", "NotSupportedError", "QuotaExceededError"];
        const name = allowed.includes(error?.name) ? error.name : "OtherError";
        const frame = String(error?.stack || "").match(/\/(app|storage|content|test|playback|dictionary|sync|sync-protocol)\.js(?:\?v=\d+)?:([0-9]{1,6}):([0-9]{1,6})\b/);
        return `MW70-${stage}-${name}${frame ? `-${frame[1]}-${frame[2]}-${frame[3]}` : ""}`;
      }

      function initializeStorage() {
        let started = false;
        let suspended = false;
        let requesting = false;
        let generation = 0;
        const start = () => {
          if (started) { renderPersistence(); return; }
          started = true;
          persistence.message = "";
          let stage = "LOAD";
          try {
            load();
            stage = "EVENTS";
            bindEvents();
            stage = "SYNC";
            initializeSync();
            stage = "RENDER";
            render();
            document.documentElement.dataset.appReady = "true";
          } catch (error) {
            // A UI exception must not masquerade as a browser lock failure.
            persistence.startupError = startupDiagnostic(stage, error);
            document.documentElement.dataset.appReady = "error";
            renderPersistence();
          }
        };
        // Keep export/reload and write protection available even if UI setup
        // stops before bindEvents reaches its normal event handlers.
        $("reloadData").addEventListener("click", () => location.reload());
        $("saveStatusExport").addEventListener("click", exportJson);
        document.addEventListener("click", event => {
          if (persistence.writer && !persistence.startupError && !persistence.conflict && !persistence.readError) return;
          const control = event.target.closest?.("button");
          if (!control) return;
          if (control.matches("[data-tab], [data-go], #reloadData, #retryStorage, #exportJson, #exportCsv, #exportPreUpgrade, #exportQuizlet, #saveStatusExport, [data-modal-cancel], [data-progress-close], #continuousStop, #playbackDockStop")) return;
          if (persistence.writer && !persistence.startupError && !persistence.conflict && control.matches("#replaceJson, #restorePreUpgrade, #restorePreImport, #restorePreRestore, [data-modal-confirm]")) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          renderPersistence();
        }, true);
        // Hold one writer lock while this page is active. A PWA can resume the
        // same document after pagehide, so reacquire rather than staying read-only.
        const acquire = () => {
          if (suspended || requesting || persistence.writer) return;
          if (!navigator.locks?.request) {
            persistence.lockState = "unsupported";
            start();
            return;
          }
          requesting = true;
          persistence.lockError = "";
          const attempt = generation;
          Promise.resolve().then(() => navigator.locks.request(`${STORAGE_KEY}.writer`, { ifAvailable: true }, async lock => {
            if (attempt !== generation || suspended) return;
            persistence.writer = Boolean(lock);
            persistence.lockState = lock ? "held" : "busy";
            if (!lock) { start(); return; }
            const released = new Promise(resolve => { releaseWriter = resolve; });
            // A suspended or read-only screen must never overwrite newer data.
            if (started) {
              try {
                if (localStorage.getItem(STORAGE_KEY) !== persistence.raw) persistence.conflict = true;
              } catch (error) {
                persistence.readError = true;
                persistence.message = `保存データを読み直せなかったため、上書きを停止しています。診断コード: ${startupDiagnostic("READ", error)}`;
              }
            }
            start();
            await released;
          })).catch(error => {
            if (attempt !== generation) return;
            persistence.writer = false;
            persistence.lockState = "error";
            persistence.lockError = startupDiagnostic("LOCK", error);
            releaseWriter = null;
            start();
          }).finally(() => {
            requesting = false;
            // Wait for the previous request to release its browser lock before
            // resuming; otherwise ifAvailable can see our own retiring lock.
            if (attempt !== generation && !suspended) acquire();
          });
        };
        const resume = () => {
          suspended = false;
          acquire();
        };
        window.addEventListener("pagehide", () => {
          suspended = true;
          generation++;
          persistence.writer = false;
          persistence.lockState = "released";
          const release = releaseWriter;
          releaseWriter = null;
          release?.();
        });
        window.addEventListener("pageshow", event => {
          if (event.persisted) { location.reload(); return; }
          resume();
        });
        window.addEventListener("focus", () => { if (!document.hidden) resume(); });
        document.addEventListener("visibilitychange", () => { if (!document.hidden) resume(); });
        $("retryStorage").addEventListener("click", () => acquire());
        acquire();
      }
      initializeStorage();
      if (!window.MW_GAS_HOST && "serviceWorker" in navigator) {
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(registration => {
            const notify = () => {
              if (!registration.waiting || !navigator.serviceWorker.controller) return;
              $("updateStatus").textContent = "更新があります。保存済みを確認し、すべてのタブを閉じて開き直すと反映されます。";
              $("updateStatus").classList.remove("hidden");
            };
            notify();
            registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", notify));
          }).catch(() => {
            // PWA登録に失敗しても通常のWebアプリとして使えます。
          });
        });
      }
    })();
  
