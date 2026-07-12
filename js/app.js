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
      const weekdays = ["æ—¥", "æœˆ", "ç«", "æ°´", "æœ¨", "é‡‘", "åœŸ"];

      const demoData = {
        example: { prs: "ÉªgËˆzÃ¦mpÉ™l", sound: "exampl01", fl: "noun", defs: ["something chosen to show what a group is like", "a person or way of behaving that should be copied"] },
        audio: { prs: "ËˆÉ‘ËdiËŒoÊŠ", sound: "audio001", fl: "adjective", defs: ["relating to sound that is heard or recorded"] },
        pronunciation: { prs: "prÉ™ËŒnÊŒnsiËˆeÉªÊƒÉ™n", sound: "pronun02", fl: "noun", defs: ["the way in which a word or name is pronounced"] },
        apple: { prs: "ËˆÃ¦pÉ™l", sound: "apple001", fl: "noun", defs: ["a round fruit with red, yellow, or green skin and firm white flesh"] },
        science: { prs: "ËˆsaÉªÉ™ns", sound: "scienc02", fl: "noun", defs: ["knowledge about or study of the natural world based on facts learned through experiments"] },
        diligent: { prs: "ËˆdÉªlÉªdÊ’É™nt", sound: "dilige01", fl: "adjective", defs: ["showing care and effort in your work or duties"] },
        record: {
          defs: ["a written account of something", "to write down information for future use"],
          variants: [
            { prs: "ËˆrekÉ™rd", sound: "record01", fl: "noun", label: "" },
            { prs: "rÉªËˆkÉ”Ërd", sound: "record02", fl: "verb", label: "" }
          ]
        }
      };

      const state = {
        ranges: [],
        settings: { demoMode: true, saveKey: false, apiKeySession: "", collegiateApiKeySession: "", dictionaryType: "learners", definitionLimit: 2, studyFilter: "all", playbackInterval: 2 },
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
        return [...new Set(String(text || "").split(/[ï¼/ã€;ï¼›]+/).map(value => value.trim()).filter(Boolean))];
      }

      function parseWords(text) {
        const seen = new Set();
        let duplicates = 0;
        let invalid = 0;
        const words = [];
        text.split(/\r?\n/).flatMap(line => line.includes("\t") ? [line] : line.split(/[\s,ã€]+/)).map(w => w.trim()).filter(Boolean).forEach(entry => {
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
          words.push({ raw: cleaned, normalized, meaningsJa: splitMeanings(meaningParts.join("ï¼")) });
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
        } catch (err) {
          toast("ä¿å­˜ãƒ‡ãƒ¼ã‚¿ã®èª­ã¿è¾¼ã¿ã«å¤±æ•—ã—ã¾ã—ãŸã€‚JSONã®ç ´æãŒã‚ã‚‹ã‹ã‚‚ã—ã‚Œã¾ã›ã‚“ã€‚");
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
            playbackInterval: state.settings.playbackInterval
          },
          ranges: state.ranges
        };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
          if (shouldRender) render();
          return true;
        } catch (err) {
          toast("ä¿å­˜ã«å¤±æ•—ã—ã¾ã—ãŸã€‚å®¹é‡ãŒè¿‘ã„å¯èƒ½æ€§ãŒã‚ã‚Šã¾ã™ã€‚JSONã‚¨ã‚¯ã‚¹ãƒãƒ¼ãƒˆå¾Œã€APIã‚­ãƒ£ãƒƒã‚·ãƒ¥å‰Šé™¤ã‚’æ¤œè¨Žã—ã¦ãã ã•ã„ã€‚", true);
          return false;
        }
      }

      function normalizeLoadedData() {
        state.ranges.forEach(range => {
          range.words = Array.isArray(range.words) ? range.words : [];
          delete range.material;
          delete range.memo;
          range.testHistory = Array.isArray(range.testHistory) ? range.testHistory.slice(-30) : [];
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
            ["checked", "hard", "play" + "Count", "last" + "CheckedAt"].forEach(key => de×½yæÚ$z{-®éÜj×Š™â"Â.Zé®{ê“"Â.Zé®{ê“""Â.Zé®{ê“2"Â.™û>Z;8.8(¢"Â.Zé®{êž8.8(¢"Â.ˆ»(i.izRY¹îzÙB"Â.ˆ»(i.izRjÚ>Šz2"Â.ˆ»(i.izRKˆÞjÚ>Šz2"Â.iz^(i.ˆ»Y¹îzÙB"Â.iz^(i.ˆ»jÚ>Šz2"Â.iz^(i.ˆ»KˆÞjÚ>Šz2%ÕÓ°¢7FFRç&ævW2æf÷$V6‚‡"Óâ"çv÷&G2æf÷$V6‚‡rÓâ&÷w2çW6‚…°¢"ç&ævTæÖRÀ¢"çFW7DFFRÀ¢rçv÷&BÀ¢‡ræÖVæ–æw4¦ÇÂµÒ’æ¦ö–â‚.ûÈò"’À¢7GVG•7FGW4Æ&VÂ‡rç7GVG•7FGW2’À¢&öçVæ6–F–öåf&–çG57VÖÖ'’‡r’À¢‡rç&öçVæ6–F–öåf&–çG2ÇÂµÒ’æf–ÇFW"‡f&–çBÓâf&–çBæVF–õW&Â’æÆVæwF‚À¢F–7F–öæ'”Æ&VÂ‡ræF–7F–öæ'•6÷W&6RÇÂ""’À¢rç&öçVæ6–F–öâÀ¢rç'Döe7VV6‚ÇÂ""À¢ræFVf–æ—F–öç3òå³ÒÇÂ""À¢ræFVf–æ—F–öç3òå³ÒÇÂ""À¢ræFVf–æ—F–öç3òå³%ÒÇÂ""À¢ræ†4VF–òò#"¢#"À¢ræ†4FVf–æ—F–öâò#"¢#"À¢rçFW7E7FG3òæVåFô¦òæGFV×G2ÇÂÀ¢rçFW7E7FG3òæVåFô¦òæ6÷'&V7BÇÂÀ¢rçFW7E7FG3òæVåFô¦òæ–æ6÷'&V7BÇÂÀ¢rçFW7E7FG3òæ¦FôVãòæGFV×G2ÇÂÀ¢rçFW7E7FG3òæ¦FôVãòæ6÷'&V7BÇÂÀ¢rçFW7E7FG3òæ¦FôVãòæ–æ6÷'&V7BÇÂ ¢Ò’’“°¢6öç7B77bÒ&÷w2æÖ‡&÷rÓâ&÷ræÖ†6VÆÂÓâ"Gµ7G&–ær†6VÆÂóò""’ç&WÆ6R‚ò"örÂr""r—Ò&’æ¦ö–â‚"Â"’’æ¦ö–â‚%Æâ"“°¢F÷væÆöB†×r×&öçVæ6–F–öâÒG·FöF”¶W’‚—Òæ77fÂ77bÂ'FW‡Bö77b"“°¢Ð ¢gVæ7F–öâ7GVG•7FGW4Æ&VÂ‡7FGW2’°¢–b‡7FGW2ÓÓÒ&†&B"’&WGW&â.ˆºnh˜²#°¢–b‡7FGW2ÓÓÒ&¶æ÷vâ"’&WGW&â.Ši®8Ž8ò#°¢&WGW&â.iÊ®XŠNZé¢#°¢Ð ¢gVæ7F–öâ&öçVæ6–F–öåf&–çG57VÖÖ'’‡v÷&B’°¢&WGW&â‡v÷&Bç&öçVæ6–F–öåf&–çG2ÇÂµÒ’æÖ‡f&–çBÓâ°¢6öç7BÆ&VÂÒf&–çBç'Döe7VV6‚ÇÂf&–çBæÆ&VÂÇÂ.y›®™û2#°¢&WGW&âG¶Æ&VÇÓ¢G·f&–çBç&öçVæ6–F–öâÇÂ.ŠŽŠ‰Ž8®8r'Ö°¢Ò’æ¦ö–â‚"Â"“°¢Ð ¢gVæ7F–öâF÷væÆöB†f–ÆVæÖRÂFW‡BÂG—R’°¢6öç7B&Æö"ÒæWr&Æö"…·FW‡EÒÂ²G—RÒ“°¢6öç7BW&ÂÒU$Âæ7&VFTö&¦V7EU$Â†&Æö"“°¢6öç7BÒFö7VÖVçBæ7&VFTVÆVÖVçB‚&"“°¢æ‡&VbÒW&Ã°¢æF÷væÆöBÒf–ÆVæÖS°¢æ6Æ–6²‚“°¢U$Âç&Wfö¶Tö&¦V7EU$Â‡W&Â“°¢Ð ¢gVæ7F–öâ–×÷'D§6öâ‡&WÆ6R’°¢G'’°¢6öç7B'6VBÒ¥4ôâç'6R‚B‚&–×÷'D§6öâ"’çfÇVR“°¢6öç7B–æ6öÖ–ærÒ'&’æ—4'&’‡'6VBç&ævW2’ò'6VBç&ævW2¢µÓ°¢–b‚–æ6öÖ–æræÆVæwF‚’°¢Fö7B‚.8*N8;>89Þ8;Î88Ž8~8Þ8(¾zøNY».8ÎŠh¾8N8¾8(®8î8¾8)>8""ÂG'VR“°¢&WGW&ã°¢Ð¢6öç7B'VâÒ‚’Óâ°¢7FFRç&ævW2Ò&WÆ6Rò–æ6öÖ–ær¢7FFRç&ævW2æ6öæ6B†–æ6öÖ–ær“°¢æ÷&ÖÆ—¦TÆöFVDFF‚“°¢6fR‚“°¢Fö7B†G¶–æ6öÖ–æræÆVæwF‡ÞK»n8îzøNY».8)"G·&WÆ6Rò.{Úî8Þhù¾8‚"¢.‹ûÞXª'Þ8*N8;>89Þ8;Î88Ž8~8î8~8þ8$ž8*Þ8;Î8þŠªÞ8þ‹ëÎ8þ8î8¾8)>8&“°¢Ó°¢–b‡&WÆ6R’°¢6†÷tÖöFÂ† ¢Æƒ#î{Úî8Þhù¾8Ž8*N8;>89Þ8;Î88ƒÂöƒ#à¢ÆF—b6Æ73Ò&FævW"Öæ÷FR#îxûîYÊŽ8î88~8;Î8+þ8).8ž8ž8n{Úî8Þhù¾8Ž8î8ž8#ÂöF—cà¢ÆF—b6Æ73Ò&7F–öç2#ãÆ'WGFöâ6Æ73Ò'v&â"FFÖÖöFÂÖ6öæf—&Óî{Úî8Þhù¾8Ž8(³Âö'WGFöããÆ'WGFöâ6Æ73Ò'6ögB"FFÖÖöFÂÖ6æ6VÃî8*Þ8:>8;>8+¾8:³Âö'WGFöããÂöF—cà¢Â'Vâ“°¢ÒVÇ6R°¢'Vâ‚“°¢Ð¢Ò6F6‚°¢Fö7B‚$¥4ôî8îŠªÞ8þ‹ëÎ8þ8¾ZKiY~8~8î8~8þ8""ÂG'VR“°¢Ð¢Ð ¢gVæ7F–öâv—TÆÂ‚’°¢6†÷tÖöFÂ† ¢Æƒ#îXZŽ88~8;Î8+þX˜®™šCÂöƒ#à¢ÆF—b6Æ73Ò&FævW"Öæ÷FR#îzøNY».8XÙŽŠ©î8˜.hÙ~8ž8*Þ8:>88>8+~8:^8).8ž8ž8nX˜®™šN8~8î8ž8$ž8*Þ8;Î8þXŠ^89Î8+þ8;>8~X˜®™šN8~8Þ8î8ž8#ÂöF—cà¢ÆF—b6Æ73Ò&7F–öç2#ãÆ'WGFöâ6Æ73Ò&FævW""FFÖÖöFÂÖ6öæf—&ÓîXZŽ88~8;Î8+þX˜®™šCÂö'WGFöããÆ'WGFöâ6Æ73Ò'6ögB"FFÖÖöFÂÖ6æ6VÃî8*Þ8:>8;>8+¾8:³Âö'WGFöããÂöF—cà¢Â‚’Óâ°¢7F÷6öçF–çV÷W5Æ–&6²‚“°¢7FFRç&ævW2ÒµÓ°¢7FFRç6VÆV7FVE&ævT–BÒçVÆÃ°¢6fR‚“°¢B‚'v÷&EæVÂ"’æ6Æ74Æ—7BæFB‚&†–FFVâ"“°¢Fö7B‚.XZŽ88~8;Î8+þ8).X˜®™šN8~8î8~8þ8""“°¢Ò“°¢Ð ¢gVæ7F–öâ7v—F6…F"†æÖR’°¢7F÷6öçF–çV÷W5Æ–&6²‚“°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚%¶FF×F%Ò"’æf÷$V6‚†'FâÓâ'Fâç6WDGG&–'WFR‚&&–×6VÆV7FVB"Â7G&–ær†'FâæFF6WBçF"ÓÓÒæÖR’’“°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚"çF"×vR"’æf÷$V6‚‡vRÓâvRæ6Æ74Æ—7BæFB‚&†–FFVâ"’“°¢B†vRÒG¶æÖWÖ’æ6Æ74Æ—7Bç&VÖ÷fR‚&†–FFVâ"“°¢–b†æÖRÓÓÒ'&ævW2"bb7FFRç6VÆV7FVE&ævT–B’°¢&VæFW%v÷&G2‚“°¢ÒVÇ6R°¢B‚'v÷&EæVÂ"’æ6Æ74Æ—7BæFB‚&†–FFVâ"“°¢Ð¢Ð ¢gVæ7F–öâ7W'&VçEF"‚’°¢&WGW&âFö7VÖVçBçVW'•6VÆV7F÷"‚%¶FF×F%Õ¶&–×6VÆV7FVCÒwG'VRuÒ"“òæFF6WBçF"ÇÂ'&ævW2#°¢Ð ¢gVæ7F–öâ&–æDWfVçG2‚’°¢Fö7VÖVçBçVW'•6VÆV7F÷$ÆÂ‚%¶FF×F%Ò"’æf÷$V6‚†'FâÓâ'FâæFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ7v—F6…F"†'FâæFF6WBçF"’’“°¢B‚'6fT•6WGF–æw2"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ°¢6öç7BvçG56fRÒB‚'6fT¶W’"’æ6†V6¶VC°¢6öç7B”¶W’Ò6ÆVä”¶W’‚B‚&”¶W’"’çfÇVR“°¢6öç7B6öÆÆVv–FT”¶W’Ò6ÆVä”¶W’‚B‚&6öÆÆVv–FT”¶W’"’çfÇVR“°¢6öç7BÇ’Ò‚’Óâ°¢7FFRç6WGF–æw2æFVÖôÖöFRÒB‚&FVÖôÖöFR"’æ6†V6¶VC°¢7FFRç6WGF–æw2ç6fT¶W’ÒvçG56fS°¢7FFRç6WGF–æw2æF–7F–öæ'•G—RÒB‚&F–7F–öæ'•G—R"’çfÇVS°¢7FFRç6WGF–æw2æFVf–æ—F–öäÆ–Ö—BÒçVÖ&W"‚B‚&FVf–æ—F–öäÆ–Ö—B"’çfÇVR’ÇÂ#°¢7FFRç6WGF–æw2æ”¶W•6W76–öâÒvçG56fRò""¢”¶W“°¢7FFRç6WGF–æw2æ6öÆÆVv–FT”¶W•6W76–öâÒvçG56fRò""¢6öÆÆVv–FT”¶W“°¢B‚&”¶W’"’çfÇVRÒ”¶W“°¢B‚&6öÆÆVv–FT”¶W’"’çfÇVRÒ6öÆÆVv–FT”¶W“°¢–b‡vçG56fRbb”¶W’’Æö6Å7F÷&vRç6WD—FVÒ„•ô´U•ô´U’Â”¶W’“°¢–b‡vçG56fRbb6öÆÆVv–FT”¶W’’Æö6Å7F÷&vRç6WD—FVÒ„4ôÄÄTt”DUô•ô´U•ô´U’Â6öÆÆVv–FT”¶W’“°¢–b‚vçG56fR’°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ„•ô´U•ô´U’“°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ„4ôÄÄTt”DUô•ô´U•ô´U’“°¢Ð¢6fR‚“°¢Fö7B‚$žŠŠÞZé®8).KùÞZÙŽ8~8î8~8þ8.KùÞZÙŽ888~8ôž˜	®Kú8~8î8¾8)>8""“°¢Ó°¢–b‡vçG56fRbb†”¶W’ÇÂ6öÆÆVv–FT”¶W’’’°¢6†÷tÖöFÂ† ¢Æƒ#äž8*Þ8;ÎKùÞZÙŽ8îz+®Š¨ÓÂöƒ#à¢ÆF—b6Æ73Ò&6WF–öâ#î8>8î89n8:ž8*n8+n8æÆö6Å7F÷&v^8´ž8*Þ8;Î8).KùÞZÙŽ8~8î8ž8.X[iÈžzºþiÊ¾8~8þKùÞZÙŽ8~8®8N8~8þ88^8N8#ÂöF—cà¢ÆF—b6Æ73Ò&7F–öç2#ãÆ'WGFöâ6Æ73Ò'v&â"FFÖÖöFÂÖ6öæf—&ÓîKùÞZÙŽ8ž8(³Âö'WGFöããÆ'WGFöâ6Æ73Ò'6ögB"FFÖÖöFÂÖ6æ6VÃî8*Þ8:>8;>8+¾8:³Âö'WGFöããÂöF—cà¢ÂÇ’“°¢ÒVÇ6RÇ’‚“°¢Ò“°¢B‚&6ÆV$”¶W’"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ6†÷tÖöFÂ† ¢Æƒ#äž8*Þ8;ÎX˜®™šCÂöƒ#à¢ÇîKùÞZÙŽkˆŽ8ôž8*Þ8;Î8ŽKˆi˜.XZ^X©¾8).X˜®™šN8~8î8ž8#Â÷à¢ÆF—b6Æ73Ò&7F–öç2#ãÆ'WGFöâ6Æ73Ò&FævW""FFÖÖöFÂÖ6öæf—&ÓîX˜®™šN8ž8(³Âö'WGFöããÆ'WGFöâ6Æ73Ò'6ögB"FFÖÖöFÂÖ6æ6VÃî8*Þ8:>8;>8+¾8:³Âö'WGFöããÂöF—cà¢Â‚’Óâ°¢B‚&”¶W’"’çfÇVRÒ"#°¢B‚&6öÆÆVv–FT”¶W’"’çfÇVRÒ"#°¢7FFRç6WGF–æw2æ”¶W•6W76–öâÒ"#°¢7FFRç6WGF–æw2æ6öÆÆVv–FT”¶W•6W76–öâÒ"#°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ„•ô´U•ô´U’“°¢Æö6Å7F÷&vRç&VÖ÷fT—FVÒ„4ôÄÄTt”DUô•ô´U•ô´U’“°¢6fR‚“°¢Fö7B‚$ž8*Þ8;Î8).X˜®™šN8~8î8~8þ8""“°¢Ò’“°¢B‚'FW7DFFR"’æFDWfVçDÆ—7FVæW"‚&6†ævR"Â‚’Óâ°¢6öç7BFW7DFFRÒB‚'FW7DFFR"’çfÇVS°¢6öç7BvVV¶F’ÒFW7DFFRòvVV¶F—5¶æWrFFR†G·FW7DFFWÕC#££’ævWDF’‚•Ò¢"#°¢–b‚B‚'vVV¶F’"’çfÇVR’B‚'vVV¶F’"’çfÇVRÒvVV¶F“°¢B‚&FVÆWFTB"’çfÇVRÒFVÆWFTDf÷"‡FW7DFFRÂB‚'vVV¶F’"’çfÇVRÇÂvVV¶F’“°¢Ò“°¢B‚'vVV¶F’"’æFDWfVçDÆ—7FVæW"‚&6†ævR"Â‚’Óâ²B‚&FVÆWFTB"’çfÇVRÒFVÆWFTDf÷"‚B‚'FW7DFFR"’çfÇVRÂB‚'vVV¶F’"’çfÇVR“²Ò“°¢B‚&–×÷'E&ævR"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â&Vv—7FW%&ævR“°¢B‚&6ÆV$–×÷'B"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ°¢²'&ævTæÖR"Â'FW7DFFR"Â'vW2"Â&FVÆWFTB"Â'v÷&D–çWB%Òæf÷$V6‚†–BÓâB†–B’çfÇVRÒ""“°¢B‚'vVV¶F’"’çfÇVRÒ"#°¢Ò“°¢B‚'&ævTf–ÇFW""’æFDWfVçDÆ—7FVæW"‚&6†ævR"Â&VæFW%&ævW2“°¢B‚'&ævTÆ—7B"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â†WfVçB’Óâ°¢6öç7B'FâÒWfVçBçF&vWBæ6Æ÷6W7B‚&'WGFöå¶FFÖ7F–öåÒ"“°¢–b‚'Fâ’&WGW&ã°¢6öç7B&ævRÒ7FFRç&ævW2æf–æB‡"Óâ"æ–BÓÓÒ'FâæFF6WBæ–B“°¢–b‚&ævR’&WGW&ã°¢–b†'FâæFF6WBæ7F–öâÓÓÒ&÷Vâ"’²7F÷6öçF–çV÷W5Æ–&6²‚“²7FFRç6VÆV7FVE&ævT–BÒ&ævRæ–C²7FFRçVæF–æuv÷&E67&öÆÂÒG'VS²&VæFW%v÷&G2‚“²B‚'v÷&EæVÂ"’ç67&öÆÄ–çFõf–Wr‡²&V†f–÷#¢'6Öö÷F‚"Â&Æö6³¢'7F'B"Ò“²Ð¢–b†'FâæFF6WBæ7F–öâÓÓÒ&fWF6‚"’6öæf—&ÔfWF6‚‡&ævR“°¢–b†'FâæFF6WBæ7F–öâÓÓÒ&6ÆV"Ö66†R"’6ÆV$66†R‡&ævRæ–B“°¢–b†'FâæFF6WBæ7F–öâÓÓÒ&FVÆWFR×&ævR"’FVÆWFU&ævR‡&ævRæ–B“°¢Ò“°¢B‚&÷VäæW‡B"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ°¢7F÷6öçF–çV÷W5Æ–&6²‚“°¢6öç7B–BÒæW‡E&ævT–B‚“°¢–b‚–B’&WGW&âFö7B‚.jÊY¹î8îzøNY».8Î8.8(®8î8¾8)>8""“°¢7FFRç6VÆV7FVE&ævT–BÒ–C°¢7FFRçVæF–æuv÷&E67&öÆÂÒG'VS°¢&VæFW%v÷&G2‚“°¢B‚'v÷&EæVÂ"’ç67&öÆÄ–çFõf–Wr‡²&V†f–÷#¢'6Öö÷F‚"Â&Æö6³¢'7F'B"Ò“°¢Ò“°¢B‚&6Æ÷6Uv÷&G2"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ²7F÷6öçF–çV÷W5Æ–&6²‚“²7FFRç6VÆV7FVE&ævT–BÒçVÆÃ²B‚'v÷&EæVÂ"’æ6Æ74Æ—7BæFB‚&†–FFVâ"“²Ò“°¢B‚'v÷&Df–ÇFW""’æFDWfVçDÆ—7FVæW"‚&6†ævR"Â‚’Óâ°¢7F÷6öçF–çV÷W5Æ–&6²‚“°¢7FFRçFV×÷&'•v÷&D–G2ÒçVÆÃ°¢7FFRç6fVDf–ÇFW$&Vf÷&UFV×÷&'’ÒçVÆÃ°¢7FFRç6WGF–æw2ç7GVG”f–ÇFW"ÒB‚'v÷&Df–ÇFW""’çfÇVS°¢6fR‚“°¢Ò“°¢B‚'Æ–&6´–çFW'fÂ"’æFDWfVçDÆ—7FVæW"‚&6†ævR"Â‚’Óâ°¢7FFRç6WGF–æw2çÆ–&6´–çFW'fÂÒçVÖ&W"‚B‚'Æ–&6´–çFW'fÂ"’çfÇVR’ÇÂ#°¢6fR†fÇ6R“°¢Ò“°¢B‚&6öçF–çV÷W57F'B"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â7F'D6öçF–çV÷W5Æ–&6²“°¢B‚&6öçF–çV÷W57F÷"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â7F÷6öçF–çV÷W5Æ–&6²“°¢B‚&§V×F÷"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ°¢B‚'v÷&EæVÂ"’ç67&öÆÄ–çFõf–Wr‡²&V†f–÷#¢'6Öö÷F‚"Â&Æö6³¢'7F'B"Ò“°¢Ò“°¢B‚&§V×&÷GFöÒ"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ°¢6öç7B6&G2ÒB‚'v÷&DÆ—7B"’çVW'•6VÆV7F÷$ÆÂ‚"çv÷&BÖ6&B"“°¢6öç7BÆ7BÒ6&G5¶6&G2æÆVæwF‚ÒÓ°¢Æ7Còç67&öÆÄ–çFõf–Wr‡²&V†f–÷#¢'6Öö÷F‚"Â&Æö6³¢&VæB"Ò“°¢Ò“°¢B‚'7F'DVåFô¦"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ7F'EFW7B‚&VåFô¦"’“°¢B‚'7F'D¦FôVâ"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ7F'EFW7B‚&¦FôVâ"’“°¢B‚'FW7D6öçFVçB"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"ÂWfVçBÓâ°¢6öç7B6W76–öâÒ7FFRæ7F—fUFW7C°¢–b‚6W76–öâ’&WGW&ã°¢6öç7B&ævRÒ7FFRç&ævW2æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ6W76–öâç&ævT–B“°¢6öç7B6†ö–6RÒWfVçBçF&vWBæ6Æ÷6W7B‚%¶FF×FW7BÖ6†ö–6UÒ"“°¢–b†6†ö–6R’°¢6öç7Bç7vW"Òç7vW%FW7EVW7F–öâ‡6W76–öâÂ&ævRÂçVÖ&W"†6†ö–6RæFF6WBçFW7D6†ö–6R’“°¢–b†ç7vW"’²WFFUFW7E7FG2‡&ævRÂç7vW"“²6†÷tç7vW&VEFW7B†ç7vW"“²Ð¢&WGW&ã°¢Ð¢6öç7BVF–òÒWfVçBçF&vWBæ6Æ÷6W7B‚%¶FF×FW7BÖVF–õÒ"“°¢–b†VF–ò’&WGW&âÆ•FW7DVF–ò‡FW7Ev÷&B‡&ævRÂVF–òæFF6WBçFW7DVF–ò’“°¢6öç7B†&BÒWfVçBçF&vWBæ6Æ÷6W7B‚%¶FF×FW7BÖ†&EÒ"“°¢–b††&B’²6öç7Bv÷&BÒFW7Ev÷&B‡&ævRÂ†&BæFF6WBçFW7D†&B“²v÷&Bç7GVG•7FGW2Ò&†&B#²6fR†fÇ6R“²†&Bç6WDGG&–'WFR‚&&–×&W76VB"Â'G'VR"“²&WGW&ã²Ð¢6öç7B7F–öâÒWfVçBçF&vWBæ6Æ÷6W7B‚%¶FF×FW7BÖ7F–öåÒ"“òæFF6WBçFW7D7F–öã°¢–b†7F–öâÓÓÒ'&WÆ’"’Æ•FW7DVF–ò‡FW7Ev÷&B‡&ævRÂ6W76–öâçVW7F–öç5´ÖF‚æÖ–â‡6W76–öâæ–æFW‚Â6W76–öâçVW7F–öç2æÆVæwF‚Ò•Òçv÷&D–B’“°¢–b†7F–öâÓÓÒ&æW‡B"’æW‡EFW7EVW7F–öâ‚“°¢–b†7F–öâÓÓÒ&&÷'B"’6†÷tÖöFÂ†Æƒ#î88n8+ž88Ž8).KŠÞjÚ.8~8î8ž8¾ûÉóÂöƒ#ãÇîY¹îzÙNkˆŽ8þ8îh‰{‹î8þjè¾8(®8î8ž8Î888n8+ž88Ž[^jÛN8¾8þ‹ûÞXª8^8(Î8î8¾8)>8#Â÷ãÆF—b6Æ73Ò&7F–öç2#ãÆ'WGFöâ6Æ73Ò&FævW""FFÖÖöFÂÖ6öæf—&ÓîKŠÞjÚ.8ž8(³Âö'WGFöããÆ'WGFöâ6Æ73Ò'6ögB"FFÖÖöFÂÖ6æ6VÃî{i®88(³Âö'WGFöããÂöF—cæÂ‚’Óâ²&÷'EFW7B‡6W76–öâ“²ÆVfUFW7B‚“²Ò“°¢–b†7F–öâÓÓÒ'&WGW&â"’ÆVfUFW7B‚“°¢–b†7F–öâÓÓÒ&÷Vâ×w&öær"’ÆVfUFW7B‡G'VR“°¢–b†7F–öâÓÓÒ&†&BÖÆÂ"’²6W76–öâæç7vW'2æf–ÇFW"†ç7vW"Óâç7vW"æ6÷'&V7B’æf÷$V6‚†ç7vW"Óâ²FW7Ev÷&B‡&ævRÂç7vW"çv÷&D–B’ç7GVG•7FGW2Ò&†&B#²Ò“²6fR†fÇ6R“²Fö7B‚.™i>˜^8Ž8þXÙŽŠ©î8).ˆºnh˜¾8¾8~8î8~8þ8""“²Ð¢–b†7F–öâÓÓÒ'&WVB"’7F'EFW7B‡6W76–öâæF—&V7F–öâ“°¢Ò“°¢B‚'v÷&DÆ—7B"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"ÂWfVçBÓâ°¢6öç7B'FâÒWfVçBçF&vWBæ6Æ÷6W7B‚&'WGFöå¶FF×v÷&BÖ7F–öåÒ"“°¢–b‚'Fâ’°¢6öç7B6&BÒWfVçBçF&vWBæ6Æ÷6W7B‚"çv÷&BÖ6&E¶FF×v÷&BÖ–EÒ"“°¢–b†6&B’&VÖVÖ&W%v÷&B†6&BæFF6WBçv÷&D–B“°¢&WGW&ã°¢Ð¢6öç7Bv÷&BÒf–æEv÷&B†'FâæFF6WBæ–B“°¢–b‚v÷&B’&WGW&ã°¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ'Æ’"’Æ”öff–6–Â‡v÷&Bæ–B“°¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ'f&–çB×Æ’"’Æ•&öçVæ6–F–öåf&–çB‡v÷&Bæ–BÂ'FâæFF6WBçf&–çD–B“°¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ&æW‡B"’võFôæW‡Ev÷&B‡v÷&Bæ–B“°¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ'7V²"’7Vµv÷&B‡v÷&Bæ–B“°¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ&†&B"’FövvÆU7GVG•7FGW2‡v÷&Bæ–BÂ&†&B"“°¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ&¶æ÷vâ"’FövvÆU7GVG•7FGW2‡v÷&Bæ–BÂ&¶æ÷vâ"“°¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ&×r"’²&VÖVÖ&W%v÷&B‡v÷&Bæ–B“²v–æF÷ræ÷Vâ‡v÷&Bæ×uW&ÂÇÂF–7F–öæ'•W&Â‡v÷&Bææ÷&ÖÆ—¦VB’Â%ö&Ææ²"Â&æö÷VæW""“²Ð¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ'&VfWF6‚"’°¢6öç7B&ævRÒf–æE&ævT'•v÷&B‡v÷&Bæ–B“°¢–b‡&ævR’°¢6öæf—&ÔfWF6‚‡&ævRÂv÷&Bæ–B“°¢Ð¢Ð¢–b†'FâæFF6WBçv÷&D7F–öâÓÓÒ'&VfWF6‚Ö6öÆÆVv–FR"’°¢6öç7B&ævRÒf–æE&ævT'•v÷&B‡v÷&Bæ–B“°¢–b‡&ævR’°¢6öæf—&ÔfWF6‚‡&ævRÂv÷&Bæ–BÂ&6öÆÆVv–FR"“°¢Ð¢Ð¢Ò“°¢B‚&W‡÷'D§6öâ"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"ÂW‡÷'D§6öâ“°¢B‚&W‡÷'D77b"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"ÂW‡÷'D77b“°¢B‚&VæD§6öâ"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ–×÷'D§6öâ†fÇ6R’“°¢B‚'&WÆ6T§6öâ"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Â‚’Óâ–×÷'D§6öâ‡G'VR’“°¢B‚'v—TÆÂ"’æFDWfVçDÆ—7FVæW"‚&6Æ–6²"Âv—TÆÂ“°¢Fö7VÖVçBæFDWfVçDÆ—7FVæW"‚'f—6–&–Æ—G–6†ævR"Â‚’Óâ°¢–b†Fö7VÖVçBæ†–FFVâ’7F÷6öçF–çV÷W5Æ–&6²‚“°¢Ò“°¢Ð ¢ÆöB‚“°¢&–æDWfVçG2‚“°¢&VæFW"‚“°¢–b‚'6W'f–6Uv÷&¶W""–âæf–vF÷"’°¢v–æF÷ræFDWfVçDÆ—7FVæW"‚&ÆöB"Â‚’Óâ°¢æf–vF÷"ç6W'f–6Uv÷&¶W"ç&Vv—7FW"‚"â÷7ræ§2"Â²66÷S¢"âò"Ò’æ6F6‚‚‚’Óâ°¢òòty›¾˜Ë.8¾ZKiY~8~8n8(.˜	®[‹Ž8åvV.8*.89~8:®8Ž8~8nKÛþ8Ž8î8ž8 ¢Ò“°¢Ò“°¢Ð¢Ò’‚“°¢ 