"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let playwright;
try {
  playwright = require("playwright");
} catch (error) {
  const bundled = path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "node", "node_modules", "playwright");
  if (!fs.existsSync(bundled)) throw error;
  playwright = require(bundled);
}
const { chromium } = playwright;

const baseUrl = process.env.MW_TEST_URL || "http://127.0.0.1:8765/";
const vocabulary = [
  "record", "expense", "apple", "science", "diligent", "example", "audio", "pronunciation", "crucial", "besides",
  "receive", "achieve", "separate", "accommodate", "necessary", "environment", "government", "knowledge", "rhythm", "calendar"
].map((word, index) => ({
  word,
  meaning: `意味${index + 1}`,
  examples: index === 0 ? [{ en: "Keep a record.", ja: "記録をつける。" }] : [],
  phrases: index === 0 ? [{ en: "on record", ja: "記録されて" }] : []
}));
const meaningByWord = new Map(vocabulary.map(item => [item.word, item.meaning]));
const wordByMeaning = new Map(vocabulary.map(item => [item.meaning, item.word]));

async function answerTest(page, { firstWrong = false } = {}) {
  const total = Number((await page.locator(".test-progress span").first().textContent()).split("/")[1].trim());
  for (let index = 0; index < total; index++) {
    const prompt = (await page.locator(".test-prompt").textContent()).trim();
    const expected = meaningByWord.get(prompt) || wordByMeaning.get(prompt);
    assert.ok(expected, `unknown prompt: ${prompt}`);
    const choices = page.locator("[data-test-choice]");
    const labels = await choices.allTextContents();
    const correctIndex = labels.findIndex(label => label.trim() === expected);
    assert.notEqual(correctIndex, -1, `correct choice missing for ${prompt}`);
    const selected = firstWrong && index === 0 ? labels.findIndex(label => label.trim() !== expected) : correctIndex;
    const progressBefore = await page.locator(".test-progress").textContent();
    await choices.nth(selected).click();
    await page.locator(".test-feedback").waitFor();
    const next = page.locator("[data-test-action='next']");
    if (await next.count()) {
      await next.click();
    } else if (index < total - 1) {
      await page.waitForFunction(before => {
        const progress = document.querySelector(".test-progress");
        return !progress || progress.textContent !== before;
      }, progressBefore);
    }
  }
  await page.locator("#testContent .test-result").waitFor();
}

async function startMode(page, value) {
  const wordTests = {
    "word-enToJa-normal": "en-normal",
    "word-jaToEn-normal": "ja-normal",
    "word-enToJa-wrong": "en-wrong",
    "word-jaToEn-wrong": "ja-wrong"
  };
  const readyTests = {
    "ready-enToJa": "en-ready",
    "ready-jaToEn": "ja-ready"
  };
  if (wordTests[value]) {
    await page.locator("#startWordTestMenu").click();
    await page.locator(`[data-learning-choice='${wordTests[value]}']`).click();
    return;
  }
  if (readyTests[value]) {
    await page.locator("#startWordFinishMenu").click();
    await page.locator(`[data-learning-choice='${readyTests[value]}']`).click();
    return;
  }
  if (value === "spelling") {
    await page.locator("#startSpellingFinish").click();
    return;
  }
  throw new Error(`unknown study mode: ${value}`);
}

async function returnFromTest(page) {
  await page.locator("[data-test-action='return']").click();
  await page.locator("#wordPanel:not(.hidden)").waitFor();
}

async function main() {
  const executablePath = [
    process.env.MW_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].find(candidate => candidate && fs.existsSync(candidate));
  assert.ok(executablePath, "Chromium, Chrome, or Edge executable was not found");
  const browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__unhandledRejections = [];
    window.addEventListener("unhandledrejection", event => {
      window.__unhandledRejections.push(String(event.reason?.stack || event.reason || "unknown rejection"));
    });
    let now = 0;
    let nextTimerId = 1;
    const activeTimers = new Map();
    const timerHistory = new Map();
    window.__MWPlaybackTestClock = {
      now: () => now,
      setTimeout(callback, delay) {
        const id = nextTimerId++;
        const timer = { id, callback, dueAt: now + Number(delay || 0), delay: Number(delay || 0) };
        activeTimers.set(id, timer);
        timerHistory.set(id, timer);
        return id;
      },
      clearTimeout(id) { activeTimers.delete(id); },
      advance(milliseconds) {
        now += milliseconds;
        while (true) {
          const due = [...activeTimers.values()].filter(timer => timer.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
          if (!due) break;
          activeTimers.delete(due.id);
          due.callback();
        }
      },
      pending: () => [...activeTimers.values()].map(timer => ({ id: timer.id, delay: timer.delay, dueAt: timer.dueAt })),
      lastId: () => nextTimerId - 1,
      fireStale(id) { timerHistory.get(id)?.callback(); }
    };

    const audioHarness = { instances: [], capturedEnds: [], capturedErrors: [] };
    class FakeAudio {
      constructor(src = "") {
        this.src = src;
        this.currentTime = 0;
        this.paused = true;
        this.playCalls = 0;
        this.onended = null;
        this.onerror = null;
        audioHarness.instances.push(this);
      }
      play() {
        this.paused = false;
        this.playCalls++;
        audioHarness.capturedEnds.push(this.onended);
        audioHarness.capturedErrors.push(this.onerror);
        return Promise.resolve();
      }
      pause() { this.paused = true; }
      removeAttribute(name) { if (name === "src") this.src = ""; }
    }
    audioHarness.fireLatestEnd = () => audioHarness.capturedEnds.at(-1)?.();
    audioHarness.fireLatestError = () => audioHarness.capturedErrors.at(-1)?.();
    audioHarness.fireCapturedEnd = index => audioHarness.capturedEnds[index]?.();
    window.__audioHarness = audioHarness;
    window.Audio = FakeAudio;

    class FakeUtterance {
      constructor(text) {
        this.text = text;
        this.lang = "";
        this.voice = null;
        this.onend = null;
        this.onerror = null;
      }
    }
    const speechHarness = {
      utterances: [],
      capturedEnds: [],
      paused: false,
      cancelled: 0,
      speak(utterance) {
        this.utterances.push(utterance);
        this.capturedEnds.push(utterance.onend);
        this.paused = false;
      },
      pause() { this.paused = true; },
      resume() { this.paused = false; },
      cancel() { this.cancelled++; this.paused = false; },
      getVoices() { return [{ lang: "en-US", name: "Test English" }]; },
      fireLatestEnd() { this.utterances.at(-1)?.onend?.(); },
      fireCapturedEnd(index) { this.capturedEnds[index]?.(); }
    };
    window.SpeechSynthesisUtterance = FakeUtterance;
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: speechHarness });
    window.__speechHarness = speechHarness;
  });
  const browserErrors = [];
  page.on("pageerror", error => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", message => { if (message.type() === "error") browserErrors.push(`console: ${message.text()}`); });

  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    assert.match(await page.title(), /Merriam-Webster/);
    const checks = await page.evaluate(() => ({
      storage: window.runStorageSelfCheck(),
      content: window.runContentFeatureSelfCheck(),
      test: window.runTestFeatureSelfCheck()
    }));
    assert.equal(checks.storage.passed && checks.content.passed && checks.test.passed, true);

    await page.locator("[data-tab='import']").click();
    await page.locator("#rangeName").fill("Browser Smoke Range");
    await page.locator("#testDate").fill("2026-08-24");
    await page.locator("#wordInput").fill(JSON.stringify(vocabulary));
    await page.locator("#importPreview.valid").waitFor();
    assert.match(await page.locator("#importPreview").textContent(), /単語 20語/);
    await page.locator("#importRange").click();
    await page.locator(".range-card").filter({ hasText: "Browser Smoke Range" }).waitFor();
    await page.locator(".range-card").filter({ hasText: "Browser Smoke Range" }).locator("[data-action='open']").click();
    await page.locator("#wordPanel:not(.hidden)").waitFor();
    assert.match(await page.locator(".readiness-state").first().textContent(), /未確認|危険/);
    assert.equal(await page.locator(".readiness-detail-grid").count(), 0, "risk reasons stay collapsed until requested");
    await page.locator(".readiness-state").first().click();
    await page.locator("#modalRoot .readiness-detail-grid").waitFor();
    await page.locator("#modalRoot [data-modal-cancel]").click();
    assert.match(await page.locator(".word-card .word-meaning").first().textContent(), /意味\d+/);
    assert.equal(await page.locator(".word-card details.technical-details").first().getAttribute("open"), null);
    const recordCard = page.locator(".word-card").first();
    await recordCard.locator("details.technical-details summary").click();
    await recordCard.locator("[data-word-action='refetch']").click();
    await page.locator("#modalRoot [data-modal-confirm]").click();
    await page.locator("[data-progress-close]").waitFor();
    await page.locator("[data-progress-close]").click();
    await page.locator("#modalRoot").waitFor({ state: "hidden" });
    assert.equal((await recordCard.locator(".word-title").textContent()).trim(), "record", "the stored/displayed spelling remains the original headword");
    assert.equal(await recordCard.locator(".word-title .stress-vowel").count(), 0, "word spelling has no visual accent overlay");
    assert.match(await recordCard.locator(".pron-line").textContent(), /ˈrekərd/, "pronunciation notation keeps its stress marker");
    assert.equal(await recordCard.locator(".variant-headword").count(), 2, "pronunciation variants remain available as ordinary headwords");
    const storedRecord = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].words[0].word);
    assert.equal(storedRecord, "record", "visual stress marks must not alter lookup or spelling-test data");
    await recordCard.locator("details.technical-details summary").click();

    await page.evaluate(() => {
      const setSelect = (id, value) => {
        const select = document.getElementById(id);
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      };
      setSelect("playbackInterval", "1");
      setSelect("usageReviewMode", "fixed");
      setSelect("usageReviewExtraSeconds", "0");
    });

    const dockWord = page.locator("#playbackDockWord");
    const dockProgress = page.locator("#playbackDockProgress");
    const playbackPause = page.locator("#playbackPause");
    const startFrom = index => page.locator(".word-card").nth(index).locator("[data-word-action='play-from']").click();
    const stopPlayback = () => page.locator("#playbackDockStop").click();

    const speechCountBeforeOfficial = await page.evaluate(() => window.__speechHarness.utterances.length);
    await startFrom(0);
    assert.equal(await page.evaluate(() => window.__speechHarness.utterances.length), speechCountBeforeOfficial, "official audio is attempted before TTS");
    await page.evaluate(() => window.__audioHarness.fireLatestError());
    assert.equal(await page.evaluate(() => window.__speechHarness.utterances.at(-1)?.text), "record", "failed official audio falls back to English TTS for the same word");
    await stopPlayback();

    await startFrom(0);
    await page.evaluate(() => window.__audioHarness.fireLatestEnd());
    assert.equal((await page.evaluate(() => window.__MWPlaybackTestClock.pending()))[0].delay, 1000);
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(700));
    await playbackPause.click();
    assert.equal((await page.evaluate(() => window.__MWPlaybackTestClock.pending())).length, 0);
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(5000));
    assert.equal((await dockProgress.textContent()).trim(), "1 / 20", "paused review time does not advance");
    await playbackPause.click();
    assert.equal((await page.evaluate(() => window.__MWPlaybackTestClock.pending()))[0].delay, 300, "resume keeps the exact remaining milliseconds");
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(299));
    assert.equal((await dockProgress.textContent()).trim(), "1 / 20");
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(1));
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20");
    assert.equal(await page.evaluate(() => window.__speechHarness.utterances.at(-1)?.text), "expense", "TTS fallback plays the no-official-audio word instead of skipping it");
    await stopPlayback();

    await startFrom(0);
    await page.evaluate(() => window.__audioHarness.fireLatestEnd());
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(300));
    await playbackPause.click();
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(4000));
    await playbackPause.click();
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(400));
    await playbackPause.click();
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(4000));
    await playbackPause.click();
    assert.equal((await page.evaluate(() => window.__MWPlaybackTestClock.pending()))[0].delay, 300, "repeated pauses preserve only the unelapsed remainder");
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(299));
    assert.equal((await dockProgress.textContent()).trim(), "1 / 20");
    await page.evaluate(() => window.__MWPlaybackTestClock.advance(1));
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20");
    await stopPlayback();

    await startFrom(0);
    await page.evaluate(() => { window.__audioHarness.instances.at(-1).currentTime = 1.25; });
    await playbackPause.click();
    assert.deepEqual(await page.evaluate(() => {
      const audio = window.__audioHarness.instances.at(-1);
      return { currentTime: audio.currentTime, paused: audio.paused };
    }), { currentTime: 1.25, paused: true });
    assert.equal((await dockProgress.textContent()).trim(), "1 / 20", "pausing audio preserves the current index");
    await playbackPause.click();
    assert.deepEqual(await page.evaluate(() => {
      const audio = window.__audioHarness.instances.at(-1);
      return { currentTime: audio.currentTime, paused: audio.paused, playCalls: audio.playCalls };
    }), { currentTime: 1.25, paused: false, playCalls: 2 }, "audio resumes from the same position");
    const staleAudioEndIndex = await page.evaluate(() => window.__audioHarness.capturedEnds.length - 1);
    await page.locator("#playbackReplay").click();
    await page.evaluate(index => window.__audioHarness.fireCapturedEnd(index), staleAudioEndIndex);
    assert.equal((await page.evaluate(() => window.__MWPlaybackTestClock.pending())).length, 0, "stale audio completion cannot schedule a timer after Replay");
    const navigationStaleAudioEndIndex = await page.evaluate(() => window.__audioHarness.capturedEnds.length - 1);
    await page.locator("#playbackNext").click();
    await page.evaluate(index => window.__audioHarness.fireCapturedEnd(index), navigationStaleAudioEndIndex);
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20", "stale audio completion cannot undo Next navigation");
    assert.equal((await page.evaluate(() => window.__MWPlaybackTestClock.pending())).length, 0);
    const stoppedSpeechEndIndex = await page.evaluate(() => window.__speechHarness.capturedEnds.length - 1);
    await stopPlayback();
    await page.evaluate(index => window.__speechHarness.fireCapturedEnd(index), stoppedSpeechEndIndex);
    assert.equal(await page.locator("#playbackDock").getAttribute("class"), "playback-dock hidden", "stale media completion cannot revive playback after Stop");

    await startFrom(1);
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20", "play from here starts at the selected middle word");
    assert.match((await dockWord.textContent()).trim(), /^expense/);
    const oldSpeechEndIndex = await page.evaluate(() => window.__speechHarness.capturedEnds.length - 1);
    const speechCountBeforeReplay = await page.evaluate(() => window.__speechHarness.utterances.length);
    await page.locator("#playbackReplay").click();
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20", "Replay keeps the same current index");
    assert.equal(await page.evaluate(() => window.__speechHarness.utterances.length), speechCountBeforeReplay + 1, "Replay restarts current speech");
    await page.evaluate(index => window.__speechHarness.fireCapturedEnd(index), oldSpeechEndIndex);
    assert.equal((await page.evaluate(() => window.__MWPlaybackTestClock.pending())).length, 0, "stale TTS completion cannot advance after Replay");
    await page.evaluate(() => window.__speechHarness.fireLatestEnd());
    const staleTimerId = await page.evaluate(() => window.__MWPlaybackTestClock.lastId());
    await page.locator("#playbackReplay").click();
    await page.evaluate(id => window.__MWPlaybackTestClock.fireStale(id), staleTimerId);
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20", "stale review timer cannot advance after Replay");

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal((await playbackPause.textContent()).trim(), "再開");
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20", "hiding the page preserves the session and index");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal((await playbackPause.textContent()).trim(), "再開", "returning to the page stays paused until explicit Resume");
    assert.equal((await dockProgress.textContent()).trim(), "2 / 20");
    const playbackMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(playbackMobileOverflow <= 1, `playback dock mobile horizontal overflow: ${playbackMobileOverflow}`);
    const playbackMobileScreenshotPath = path.join(os.tmpdir(), "mw-playback-mobile.png");
    await page.screenshot({ path: playbackMobileScreenshotPath });
    await stopPlayback();

    const mobileScreenshotPath = path.join(os.tmpdir(), "mw-browser-smoke-mobile.png");
    await page.screenshot({ path: mobileScreenshotPath });

    await startMode(page, "word-enToJa-normal");
    await answerTest(page, { firstWrong: true });
    assert.match(await page.locator("#testContent .result-score").textContent(), /14\s*\/\s*15/);
    await returnFromTest(page);

    await startMode(page, "word-enToJa-wrong");
    await answerTest(page);
    assert.match(await page.locator("#testContent .result-score").textContent(), /1\s*\/\s*1/);
    await returnFromTest(page);

    await startMode(page, "ready-jaToEn");
    await answerTest(page);
    assert.match(await page.locator("#testContent .result-score").textContent(), /15\s*\/\s*15/);
    await returnFromTest(page);

    const studyStatusBeforeSpeed = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].words.map(word => word.studyStatus));
    await page.locator("#startWordSpeed").click();
    await page.locator("#studySessionLayer:not(.hidden)").waitFor();
    const sessionLayout = await page.locator("#studySessionLayer").evaluate(element => ({
      position: getComputedStyle(element).position,
      top: element.getBoundingClientRect().top,
      closeVisible: Boolean(document.querySelector("#studySessionClose")?.offsetParent)
    }));
    assert.equal(sessionLayout.position, "fixed");
    assert.ok(Math.abs(sessionLayout.top) <= 1);
    assert.equal(sessionLayout.closeVisible, true);
    assert.equal(await page.locator("[data-speed-action='meaning']").count(), 1);
    await page.locator("[data-speed-action='meaning']").click();
    assert.equal(await page.locator(".speed-meaning").count(), 1);
    let sawUsageConfirmation = false;
    let markedUnsure = false;
    for (let safety = 0; safety < 45 && !(await page.locator("#speedContent .test-result").count()); safety++) {
      if (await page.locator("[data-speed-action='usage']").count()) {
        sawUsageConfirmation = true;
        await page.locator("[data-speed-action='usage']").click();
        assert.match(await page.locator(".speed-usage-list").textContent(), /Keep a record\.|on record/);
      }
      if (!markedUnsure) {
        markedUnsure = true;
        await page.locator("[data-speed-rating='unsure']").click();
        continue;
      }
      await page.locator("[data-speed-rating='instant']").click();
    }
    assert.equal(sawUsageConfirmation, true);
    await page.locator("#speedContent .test-result").waitFor();
    assert.match(await page.locator("#speedContent").textContent(), /高速周回 完了/);
    const studyStatusAfterSpeed = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].words.map(word => word.studyStatus));
    assert.deepEqual(studyStatusAfterSpeed, studyStatusBeforeSpeed);
    await page.locator("[data-speed-action='return']").click();

    await startMode(page, "spelling");
    for (let index = 0; index < 15; index++) {
      const meaning = (await page.locator(".spelling-meaning").textContent()).trim();
      const expected = wordByMeaning.get(meaning);
      assert.ok(expected, `unknown spelling prompt: ${meaning}`);
      await page.locator("#spellingAnswer").fill(index === 0 ? `${expected}x` : expected.toUpperCase());
      await page.locator("#spellingForm button[type='submit']").click();
      await page.locator(".spelling-feedback").waitFor();
      await page.locator("[data-spelling-action='next']").click();
    }
    await page.locator("#spellingContent .test-result").waitFor();
    assert.match(await page.locator("#spellingContent .result-score").textContent(), /14\s*\/\s*15/);
    await page.locator("[data-spelling-action='return']").click();

    assert.equal(await page.locator("#startUsageStudy").count(), 1);
    assert.equal(await page.locator("#startWordStudy").count(), 1);
    assert.equal(await page.locator("#startUsageSpeed").count(), 1);
    assert.equal(await page.locator("#startUsageTest").count(), 1);
    assert.equal(await page.locator("#startUsageFinish").count(), 1);
    assert.equal(await page.getByText("関連単語を編集", { exact: true }).count(), 0);

    const usageHistoryBeforeStudy = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].usageItems.map(item => item.recallStats));
    await page.locator("#startUsageStudy").click();
    assert.equal(await page.locator("[data-recall-rating]").count(), 0);
    assert.match(await page.locator("#recallContent").textContent(), /学習モード[\s\S]*公式音声(?:未取得|\s+\d+語)[\s\S]*タップして次へ/);
    const studyCard = page.locator("[data-study-card]");
    await studyCard.locator(".usage-study-english").click();
    await page.waitForFunction(() => document.querySelector(".recall-head")?.textContent.includes("2 / 2"));
    assert.equal(await page.locator("[data-recall-rating]").count(), 0);
    await page.locator("[data-study-card] .usage-study-english").click();
    await page.locator("#recallContent .test-result").waitFor();
    assert.match(await page.locator("#recallContent").textContent(), /定着履歴を記録していません/);
    await page.locator("[data-study-action='return']").click();
    const usageHistoryAfterStudy = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].usageItems.map(item => item.recallStats));
    assert.deepEqual(usageHistoryAfterStudy, usageHistoryBeforeStudy);

    await page.locator("#startUsageTest").click();
    assert.match(await page.locator("#recallContent").textContent(), /例文・熟語・確認テスト/);
    for (const rating of ["cross", "triangle"]) {
      await page.locator("[data-recall-action='reveal']").click();
      await page.locator(`[data-recall-rating='${rating}']`).click();
    }
    await page.locator("#recallContent .test-result").waitFor();
    assert.match(await page.locator("#recallContent").textContent(), /各項目を一度ずつ確認/);
    await page.locator("[data-recall-action='return']").click();

    await page.locator("#startUsageFinish").click();
    assert.match(await page.locator("#recallContent").textContent(), /例文・熟語・仕上げ/);
    await page.locator("[data-recall-action='reveal']").click();
    await page.locator("[data-recall-rating='cross']").click();
    assert.equal(await page.locator("#recallContent .test-result").count(), 0, "finish mode requeues missed items");
    await page.locator("#studySessionClose").click();
    await page.locator("#modalRoot [data-modal-confirm]").click();
    await page.locator("#wordPanel:not(.hidden)").waitFor();

    await page.locator("#startUsageSpeed").click();
    assert.match(await page.locator("#recallContent").textContent(), /例文・熟語・高速周回[\s\S]*初回2件/);
    for (let index = 0; index < 2; index++) {
      await page.locator("[data-recall-action='reveal']").click();
      await page.locator("[data-recall-rating='circle']").click();
    }
    await page.locator("#recallContent .test-result").waitFor();
    assert.match(await page.locator("#recallContent").textContent(), /例文・熟語 高速周回 完了/);
    await page.locator("[data-recall-action='return']").click();

    const beforeImport = JSON.parse(await page.evaluate(() => localStorage.getItem("mwPronunciationTool.v1")));
    assert.equal(beforeImport.ranges[0].words.some(word => word.speedStats?.enToJa?.attempts > 0), true);
    assert.equal(beforeImport.ranges[0].words.some(word => word.spellingStats?.attempts > 0), true);
    assert.equal(beforeImport.ranges[0].usageItems.some(item => item.recallStats?.attempts > 0), true);

    await page.locator("[data-tab='backup']").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportJson").click();
    const download = await downloadPromise;
    const downloadedPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadedPath, "utf8"));
    assert.equal(exported.schemaVersion, 3);
    assert.equal(exported.ranges.length, 1);
    assert.equal(JSON.stringify(exported).includes("apiKeySession"), false);

    const replacement = structuredClone(exported);
    replacement.ranges[0].rangeName = "Browser Replacement Range";
    await page.locator("#importJson").fill(JSON.stringify(replacement));
    await page.locator("#backupImportPreview.invalid").waitFor();
    assert.match(await page.locator("#backupImportPreview").textContent(), /置き換えインポート/);
    await page.locator("#replaceJson").click();
    await page.locator("[data-modal-confirm]").click();
    await page.waitForLoadState("networkidle");
    await page.locator(".range-card").filter({ hasText: "Browser Replacement Range" }).waitFor();

    await page.locator("[data-tab='backup']").click();
    await page.locator("#restorePreImport").click();
    await page.locator("[data-modal-confirm]").click();
    await page.waitForLoadState("networkidle");
    await page.locator(".range-card").filter({ hasText: "Browser Smoke Range" }).waitFor();
    const restored = JSON.parse(await page.evaluate(() => localStorage.getItem("mwPronunciationTool.v1")));
    assert.deepEqual(restored.ranges, beforeImport.ranges);
    assert.deepEqual(restored.studyLog, beforeImport.studyLog);

    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    const cacheState = await page.evaluate(async () => ({ keys: await caches.keys(), controller: Boolean(navigator.serviceWorker.controller) }));
    assert.equal(cacheState.controller, true);
    assert.ok(cacheState.keys.some(key => key.startsWith("mw-pronunciation-pwa-v55:")));
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".range-card").filter({ hasText: "Browser Smoke Range" }).waitFor();
    await page.locator(".range-card").filter({ hasText: "Browser Smoke Range" }).locator("[data-action='open']").click();
    const firstHard = page.locator("[data-word-action='hard'][aria-pressed='false']").first();
    const hardWordId = await firstHard.getAttribute("data-id");
    await firstHard.click();
    await page.reload({ waitUntil: "domcontentloaded" });
    const restoredHard = page.locator(`[data-word-action='hard'][data-id='${hardWordId}']`);
    await restoredHard.waitFor();
    assert.equal(await restoredHard.getAttribute("aria-pressed"), "true");
    await context.setOffline(false);

    await page.setViewportSize({ width: 1024, height: 768 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 1, `desktop horizontal overflow: ${overflow}`);
    const screenshotPath = path.join(os.tmpdir(), "mw-browser-smoke.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    assert.deepEqual(await page.evaluate(() => window.__unhandledRejections), []);
    assert.deepEqual(browserErrors, []);
    console.log(JSON.stringify({
      passed: true,
      selfChecks: checks,
      normalScore: "14/15",
      wrongScore: "1/1",
      reverseReadyScore: "15/15",
      spellingScore: "14/15",
      serviceWorker: cacheState,
      offlineReloadAndSave: true,
      backupReplaceRestore: true,
      playbackMobileOverflow,
      playbackMobileScreenshotPath,
      mobileScreenshotPath,
      screenshotPath
    }, null, 2));
  } finally {
    await context.setOffline(false).catch(() => {});
    await browser.close();
  }
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});

