var { createTestSession, renderTestQuestion, answerTestQuestion, finishTest, abortTest, runTestFeatureSelfCheck } = window.MWTest;
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
        temporaryWordIds: null,
        savedFilterBeforeTemporary: null
      };

      const playbackState = {
        active: false,
        currentAudio: null,
        timerId: null,
        rangeId: "",
        wordIds: [],
        currentIndex: 0
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
          ranges: state.ranges, studyLog: state.studyLog
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
        if (range.testDate === today) return "今日の範囲";
        if (range.id === nextId) return "次回の範囲";
        if (range.testDate && range.testDate > today) return "待機中";
        if (range.testDate && range.testDate < today) return "終了";
        return "待機中";
      }

      function nextRangeId() {
        const today = localDateString(new Date());
        const candidates = state.ranges
          .filter(r => r.words.length && r.testDate >= today)
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
        const unseen = words.filter(w => !(w.testStats?.enToJa?.attempts || 0) && !(w.testStats?.jaToEn?.attempts || 0)).length;
        const unsettled = words.filter(w => w.studyStatus !== "known" || (w.testStats?.enToJa?.consecutiveCorrect || 0) < 2 || (w.testStats?.jaToEn?.consecutiveCorrect || 0) < 2 || w.testStats?.enToJa?.lastResult === "incorrect" || w.testStats?.jaToEn?.lastResult === "incorrect").length;
        return { total, fetched, audio, noAudio, definitions, hard, known, unseen, unsettled, pct: total ? Math.round(fetched / total * 100) : 0, learningPct: total ? Math.round(known / total * 100) : 0 };
      }

      function isRangeEnded(range, now = new Date()) {
        if (range.manualTestEndedDate === localDateString(now)) return true;
        if (range.testDate !== localDateString(now)) return false;
        const key = now.getDay() === 1 ? "mondayEndTime" : now.getDay() === 3 ? "wednesdayEndTime" : "";
        return Boolean(key && state.settings[key] && `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` >= state.settings[key]);
      }
      function learningPlan(now = new Date()) {
        const today = localDateString(now);
        const future = state.ranges.filter(r => r.words?.length && r.testDate && (r.testDate > today || (r.testDate === today && !isRangeEnded(r, now)))).sort((a,b) => a.testDate.localeCompare(b.testDate));
        const primary = future[0] || null, preview = future[1] || null;
        const day = now.getDay(), todayTest = primary?.testDate === today;
        const mode = (todayTest || day === 2 || day === 0 || (day === 1 || day === 3) && !isRangeEnded(primary || {}, now)) ? "cram" : "normal";
        const reason = todayTest ? "テスト当日のため、苦手・未定着単語を優先します。" : day === 2 ? "明日が水曜テストのため、直前確認を行います。" : day === 0 ? "明日が月曜テストのため、仕上げを行います。" : "次回テストに向けて未出題・苦手単語を優先します。";
        return { primary, preview, mode, reason, friday: day === 5 };
      }
      function rangePlanHtml(label, range, now) {
        if (!range) return `<div class="plan-card"><strong>${label}</strong><span class="meta">対象範囲はありません</span></div>`;
        const s = statsForRange(range), days = Math.max(0, Math.ceil((new Date(`${range.testDate}T00:00:00`) - new Date(`${localDateString(now)}T00:00:00`)) / 86400000));
        const goal = days <= 0 ? s.unsettled : Math.ceil(s.unsettled / days), recommend = Math.ceil(goal * 1.25);
        return `<div class="plan-card"><strong>${label}: ${escapeHtml(range.rangeName || "無題の範囲")}</strong><div class="meta">${range.testDate}まで${days}日 / ${s.total}語</div><div>未出題 ${s.unseen}・苦手 ${s.hard}・覚えた ${s.known}・未定着 ${s.unsettled}</div><div>今日の目標: 最低${goal}問 / 推奨${recommend}問</div></div>`;
      }
      function renderTodayStudy() {
        const now = new Date(), plan = learningPlan(now), log = state.studyLog[todayKey()] || { attempts: 0, correct: 0, enToJa: { attempts: 0, correct: 0 }, jaToEn: { attempts: 0, correct: 0 } };
        const weekday = weekdays[now.getDay()];
        $("todayStudyPanel").innerHTML = `<h3>${now.getMonth() + 1}月${now.getDate()}日 ${weekday}曜日</h3><strong>今日の学習方針</strong><p>${escapeHtml(plan.reason)}</p>${plan.friday ? `<div class="caution">今日は暗記構文テストがあります。2周目なので、10〜15分だけ確認しましょう。</div>` : ""}<div class="plan-grid">${rangePlanHtml("最優先", plan.primary, now)}${rangePlanHtml("先取り", plan.preview, now)}</div><div class="meta">今日: ${log.attempts}回答 / ${log.correct}正解 / 正答率 ${log.attempts ? Math.round(log.correct / log.attempts * 100) : 0}%（英→日 ${log.enToJa.attempts}、日→英 ${log.jaToEn.attempts}）</div><div class="actions"><select id="todayDirection"><option value="enToJa">英語 → 日本語</option><option value="jaToEn">日本語 → 英語</option></select><button class="primary" id="startTodayStudy" ${plan.primary ? "" : "disabled"}>今日の学習を始める</button></div>`;
        $("startTodayStudy")?.addEventListener("click", () => { state.selectedRangeId = plan.primary.id; startTest($("todayDirection").value, plan.mode); });
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
        let ranges = state.ranges.map(r => ({ ...r, status: statusForRange(r, nextId) }));
        if (filter !== "all") ranges = ranges.filter(r => r.status === filter);
        ranges.sort((a, b) => (a.testDate || "9999").localeCompare(b.testDate || "9999"));
        if (!ranges.length) {
          $("rangeList").innerHTML = `<div class="empty">範囲がありません。登録タブから範囲枠または単語リストを追加できます。</div>`;
          return;
        }
        $("rangeList").innerHTML = ranges.map(range => {
          const s = statsForRange(range);
          const statusClass = range.status === "今日の範囲" ? "today" : range.status === "次回の範囲" ? "next" : "";
          const badgeClass = range.status === "削除予定" ? "danger" : range.status === "今日の範囲" || range.status === "次回の範囲" ? "ok" : "warn";
          return `
            <article class="range-card ${statusClass}">
              <div class="range-head">
                <div>
                  <div class="range-title">${escapeHtml(range.rangeName || "無題の範囲")}</div>
                  <div class="meta">${escapeHtml(range.testDate || "日付未設定")} ${escapeHtml(range.weekday || "")}</div>
                </div>
                <span class="badge ${badgeClass}">${range.status}</span>
              </div>
              <div class="meta">学習定着率 ${s.learningPct}% / API取得率 ${s.pct}%</div><div class="progress" aria-label="API取得率"><span style="width:${s.pct}%"></span></div>
              <div class="mini-grid">
                <div class="mini"><strong>${s.total}</strong>単語</div>
                <div class="mini"><strong>${s.fetched}</strong>API取得済み</div>
                <div class="mini"><strong>${s.hard}</strong>苦手</div>
                <div class="mini"><strong>${s.known}</strong>覚えた</div>
                <div class="mini"><strong>${s.unseen}</strong>未出題</div>
              </div>
              <div class="actions" style="margin-top:10px">
                <button class="primary" data-action="open" data-id="${range.id}">開く</button>
                <button class="soft" data-action="fetch" data-id="${range.id}" ${s.total ? "" : "disabled"}>APIで取得</button>
                ${range.testDate === todayKey() ? (isRangeEnded(range) ? `<button class="soft" data-action="test-before" data-id="${range.id}">テスト前</button>` : `<button class="soft" data-action="test-ended" data-id="${range.id}">テスト終了</button>`) : ""}
              </div>
              <div class="danger-actions">
                <button class="compact refetch" data-action="clear-cache" data-id="${range.id}">キャッシュ削除</button>
                <button class="compact collegiate" data-action="delete-range" data-id="${range.id}">範囲削除</button>
              </div>
            </article>`;
        }).join("");
      }

      function renderWords() {
        const range = state.ranges.find(r => r.id === state.selectedRangeId);
        if (!range) return;
        $("wordPanel").classList.remove("hidden");
        $("wordFilter").value = state.settings.studyFilter;
        $("playbackInterval").value = String(state.settings.playbackInterval);
        updatePlaybackControls();
        $("openRangeTitle").textContent = `${range.rangeName || "無題の範囲"} の単語`;
        const s = statsForRange(range);
        $("openRangeMeta").textContent = `${range.testDate || "日付未設定"} / ${s.fetched}/${s.total} API取得済み / 苦手${s.hard} / 覚えた${s.known}`;
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
          <article class="word-card ${word.id === rememberedWordId ? "current-word" : ""}" data-word-id="${word.id}">
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
              </div>
              ${wordFailureLabel(word) ? `<span class="failure-label">${wordFailureLabel(word)}</span>` : ""}
            </div>
            ${renderPronunciationVariants(word)}
            ${word.definitions?.length ? `<div class="mini" style="margin-top:10px"><strong>定義</strong>${word.definitions.map((d, i) => `<div>${i + 1}. ${escapeHtml(d)}</div>`).join("")}</div>` : ""}
            <div class="study-actions">
              <button class="primary" data-word-action="play" data-id="${word.id}" ${word.audioUrl ? "" : "disabled"}>公式音声</button>
              <button class="primary" data-word-action="next" data-id="${word.id}">次へ</button>
            </div>
            <div class="secondary-actions">
              <button class="soft" data-word-action="speak" data-id="${word.id}">読み上げ</button>
              <button class="soft study-toggle hard" data-word-action="hard" data-id="${word.id}" aria-pressed="${word.studyStatus === "hard"}">苦手</button>
              <button class="soft study-toggle known" data-word-action="known" data-id="${word.id}" aria-pressed="${word.studyStatus === "known"}">覚えた</button>
            </div>
            <div class="danger-actions">
              <button class="soft mw-small" data-word-action="mw" data-id="${word.id}">MWで開く</button>
              <button class="compact refetch" data-word-action="refetch" data-id="${word.id}">再取得</button>
              <button class="compact collegiate" data-word-action="refetch-collegiate" data-id="${word.id}">Collegiate</button>
            </div>
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

      function playTestAudio(word) {
        if (!word) return;
        const variant = (word.pronunciationVariants || []).find(item => item.audioUrl);
        if (variant) playPronunciationVariant(word.id, variant.id);
        else if (word.audioUrl) playOfficial(word.id);
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
      }

      function startTest(direction, mode = $("testMode")?.value || "normal") {
        stopContinuousPlayback();
        const range = state.ranges.find(item => item.id === state.selectedRangeId);
        if (!range) return;
        const session = createTestSession(range, direction, { mode });
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
        const stats = word.testStats[session.direction];
        stats.attempts++;
        stats.totalResponseMs += answer.responseMs;
        stats.lastTestedAt = new Date().toISOString();
        stats.lastResult = answer.correct ? "correct" : "incorrect";
        if (answer.correct) { stats.correct++; stats.consecutiveCorrect++; }
        else {
          stats.incorrect++;
          stats.consecutiveCorrect = 0;
          if (answer.selectedWordId) stats.confusedWith[answer.selectedWordId] = (stats.confusedWith[answer.selectedWordId] || 0) + 1;
        }
        const other = word.testStats[session.direction === "enToJa" ? "jaToEn" : "enToJa"];
        const before = word.studyStatus;
        if (!answer.correct) word.studyStatus = "hard";
        else if (stats.consecutiveCorrect >= 2 && other.consecutiveCorrect >= 2 && stats.lastResult === "correct" && other.lastResult === "correct") word.studyStatus = "known";
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
        feedback.innerHTML = `<strong>${answer.correct ? "正解" : "不正解"}</strong><div class="test-answer-word">${escapeHtml(word.word)} — ${escapeHtml(word.meaningsJa.join("／"))}</div><div>${pronunciationFeedback(word)}</div>${changed ? `<div><strong>${changed}</strong></div>` : ""}<button class="soft" data-test-action="replay">公式音声</button>${answer.correct ? "" : `<button class="primary" data-test-action="next">次の問題</button>`}`;
        $("testContent").appendChild(feedback);
        if (session.direction === "jaToEn" || !answer.correct) playTestAudio(word);
        if (answer.correct) setTimeout(nextTestQuestion, 700);
      }

      function nextTestQuestion() {
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
        const modeLabel = { normal: "通常", cram: "直前", wrong: "間違い集中" }[result.mode] || "通常";
        $("testContent").innerHTML = `<div class="test-result"><h2>テスト結果</h2><p>${session.direction === "enToJa" ? "英語 → 日本語" : "日本語 → 英語"} / ${modeLabel}モード</p><div class="result-score">${result.correct} / ${result.total}</div><div class="result-grid"><div><strong>${result.accuracy}%</strong>正答率</div><div><strong>${(result.averageResponseMs / 1000).toFixed(1)}秒</strong>平均回答</div><div><strong>${wrong.length}</strong>間違い</div></div><h3>累積分析</h3><p>${cumulativeTestSummary(range, session.direction)}</p>${histories.length ? `<div class="history-list">${histories.map(item => `<span>${item.finishedAt.slice(0, 10)} ${item.correct}/${item.total}</span>`).join("")}</div>` : ""}<h3>間違えた単語</h3>${wrong.length ? wrong.map(word => `<article class="wrong-word"><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(word.meaningsJa.join("／"))}</span><span>${pronunciationFeedback(word)}</span><button class="soft" data-test-audio="${word.id}">公式音声</button><button class="soft" data-test-hard="${word.id}">苦手</button></article>`).join("") : `<div class="empty">全問正解です。</div>`}<div class="test-result-actions">${wrong.length ? `<button class="soft" data-test-action="open-wrong">間違いを発音画面で確認</button><button class="soft" data-test-action="hard-all">間違いを一括で苦手</button>` : ""}<button class="primary" data-test-action="repeat">同じ方向でもう一度</button><button class="soft" data-test-action="return">範囲へ戻る</button></div></div>`;
      }

      function leaveTest(openWrong = false) {
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
            <button class="soft variant-audio" data-word-action="variant-play" data-id="${word.id}" data-variant-id="${variant.id}" ${variant.audioUrl ? "" : "disabled"}>公式音声</button>
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

      function buildRangeFromForm(words) {
        const testDate = $("testDate").value;
        const weekday = $("weekday").value || (testDate ? weekdays[new Date(`${testDate}T12:00:00`).getDay()] : "");
        const rangeWords = words.map(w => createWord(w.raw, w.normalized, w.meaningsJa));
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
          testHistory: []
        };
      }

      function registerRange() {
        const parsed = parseWords($("wordInput").value);
        if (!$("rangeName").value.trim() && !parsed.words.length) {
          toast("範囲名か単語リストを入力してください。", true);
          return;
        }
        const range = buildRangeFromForm(parsed.words);
        state.ranges.push(range);
        save();
        toast(parsed.words.length ? `${parsed.words.length}語を登録しました。API通信はしていません。` : "範囲枠を作成しました。API通信はしていません。");
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
        const audio = new Audio(word.audioUrl);
        audio.play().catch(() => toast("公式音声を再生できませんでした。MWリンクや読み上げを使ってください。", true));
      }

      function playPronunciationVariant(wordId, variantId) {
        stopContinuousPlayback();
        const word = findWord(wordId);
        const variant = word?.pronunciationVariants?.find(item => item.id === variantId);
        if (!word || !variant?.audioUrl) return;
        rememberWord(wordId);
        const audio = new Audio(variant.audioUrl);
        audio.play().catch(() => toast("この発音の公式音声を再生できませんでした。", true));
      }

      function speakWord(wordId) {
        const word = findWord(wordId);
        if (!word || !("speechSynthesis" in window)) {
          toast("このブラウザでは読み上げに対応していません。", true);
          return;
        }
        rememberWord(wordId);
        const u = new SpeechSynthesisUtterance(word.word);
        u.lang = "en-US";
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
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
        if (!start || !stop) return;
        start.setAttribute("aria-pressed", String(playbackState.active));
        start.textContent = playbackState.active ? "連続再生中" : "連続再生開始";
        stop.disabled = !playbackState.active;
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
        updatePlaybackControls();
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
        updatePlaybackControls();
        playContinuousWord(true);
      }

      function playContinuousWord(isFirst = false) {
        if (!playbackState.active) return;
        while (playbackState.currentIndex < playbackState.wordIds.length) {
          const word = findWord(playbackState.wordIds[playbackState.currentIndex]);
          if (word?.audioUrl) {
            rememberWord(word.id);
            document.querySelector(`[data-word-id="${CSS.escape(word.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
            const audio = playbackState.currentAudio;
            audio.onended = scheduleNextContinuousWord;
            audio.onerror = scheduleNextContinuousWord;
            audio.src = word.audioUrl;
            audio.currentTime = 0;
            audio.play().catch(() => {
              if (isFirst) {
                stopContinuousPlayback();
                toast("連続再生を開始できませんでした。もう一度開始を押してください。", true);
                return;
              }
              scheduleNextContinuousWord();
            });
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
        playbackState.currentIndex++;
        if (playbackState.currentIndex >= playbackState.wordIds.length) {
          stopContinuousPlayback();
          toast("連続再生が完了しました。");
          return;
        }
        playbackState.timerId = setTimeout(() => {
          playbackState.timerId = null;
          playContinuousWord();
        }, state.settings.playbackInterval * 1000);
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
          if (btn.dataset.action === "open") { stopContinuousPlayback(); state.selectedRangeId = range.id; state.pendingWordScroll = true; renderWords(); $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" }); }
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
          renderWords();
          $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        $("closeWords").addEventListener("click", () => { stopContinuousPlayback(); state.selectedRangeId = null; $("wordPanel").classList.add("hidden"); });
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
        $("jumpTop").addEventListener("click", () => {
          $("wordPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        $("jumpBottom").addEventListener("click", () => {
          const cards = $("wordList").querySelectorAll(".word-card");
          const last = cards[cards.length - 1];
          last?.scrollIntoView({ behavior: "smooth", block: "end" });
        });
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
  
