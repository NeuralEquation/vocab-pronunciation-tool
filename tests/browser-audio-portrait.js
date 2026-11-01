"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(), "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
const baseUrl = process.env.MW_TEST_URL || "http://127.0.0.1:8765/";

async function setup(browser, viewport, fixture) {
  const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
  await context.route("https://**", route => route.abort());
  await context.addInitScript(() => {
    window.__spoken = [];
    window.__speechState = { active: null, cancelled: 0 };
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    window.__voices = [{ lang: "en-GB", name: "British English" }, { lang: "en-US", name: "Basic English" }, { lang: "en-US", name: "US Natural", voiceURI: "us-natural" }];
    window.__voiceEvents = new EventTarget();
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
      getVoices: () => window.__voices,
      addEventListener: (...args) => window.__voiceEvents.addEventListener(...args),
      cancel() { window.__speechState.active = null; window.__speechState.cancelled++; },
      // Model engines that discard paused speech and cannot resume it.
      pause() { window.__speechState.active = null; }, resume() {},
      speak(utterance) { window.__speechState.active = utterance; window.__spoken.push(utterance); }
    } });
    let id = 0;
    const pending = new Map();
    window.__MWPlaybackTestClock = {
      now: () => 0,
      setTimeout(callback) { pending.set(++id, callback); return id; },
      clearTimeout(key) { pending.delete(key); },
      count: () => pending.size,
      advance() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback()); }
    };
  });
  const page = await context.newPage();
  page.on("pageerror", error => { throw error; });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.locator("[data-tab='import']").click();
  await page.locator("#rangeName").fill("Audio and portrait fixture");
  await page.locator("#testDate").fill("2026-11-02");
  await page.locator("#wordInput").fill(JSON.stringify(fixture));
  await page.locator("#importRange").click();
  await page.locator("#toast").click();
  await page.locator("#toast").waitFor({ state: "hidden" });
  await page.locator("[data-action='open']").click();
  return { context, page };
}

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 820, height: 1180 }]) {
      const { context, page } = await setup(browser, viewport, [{
        word: "pneumonoultramicroscopicsilicovolcanoconiosis",
        meaning: "長い単語や複数の意味を表示しても操作ボタンを画面の中に収めるための確認用の日本語訳",
        examples: Array.from({ length: 8 }, () => ({ en: "This is a long example sentence that must remain accessible while the rating controls stay inside the screen.", ja: "例文を開いても判定ボタンを画面内に表示します。" })), phrases: []
      }]);
      await page.locator("#morePractice > summary").click();
      await page.locator("#startWordSpeed").click();
      const check = async state => {
        const geometry = await page.evaluate(() => {
          const layer = document.querySelector("#studySessionLayer");
          const controls = [...document.querySelectorAll(".speed-actions button, .speed-meaning-toggle, .speed-usage-toggle, #studySessionClose")].map(el => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
          });
          return { controls, scroll: layer.scrollHeight - layer.clientHeight, width: document.documentElement.scrollWidth - innerWidth };
        });
        assert.ok(geometry.controls.every(r => r.top >= 0 && r.bottom <= viewport.height + 1 && r.left >= 0 && r.right <= viewport.width + 1 && r.height >= 43 && r.hit), `${viewport.width}x${viewport.height} ${state}: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.scroll <= 1 && geometry.width <= 1, `no outer overflow: ${JSON.stringify(geometry)}`);
      };
      await check("hidden meaning");
      await page.locator(".speed-meaning-toggle").click();
      await check("long meaning");
      await page.locator(".speed-usage-toggle").click();
      await check("expanded examples");
      assert.ok(await page.locator(".speed-usage-list").evaluate(el => el.scrollHeight > el.clientHeight), "long examples scroll within their own area");
      await page.screenshot({ path: path.join(os.tmpdir(), `mw-speed-portrait-${viewport.width}.png`) });
      await page.locator("[data-speed-rating='instant']").click();
      await page.locator("#speedContent .test-result").waitFor();
      await page.locator("[data-speed-action='return']").click();
      await page.locator("#startUsageSpeed").click();
      await page.locator("[data-recall-action='reveal']").click();
      const usageFit = await page.locator(".speed-recall-ratings").evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      });
      assert.ok(usageFit, `example-speed ratings fit ${viewport.width}x${viewport.height}`);
      await page.screenshot({ path: path.join(os.tmpdir(), `mw-usage-speed-portrait-${viewport.width}.png`) });
      await page.locator("#studySessionClose").click();
      if (await page.locator("[data-modal-confirm]").isVisible()) await page.locator("[data-modal-confirm]").click();
      await page.locator("#startUsageStudy").click();
      assert.equal(await page.locator("#recallContent").evaluate(el => el.classList.contains("usage-speed-running")), false, "study mode clears speed-only layout");
      await context.close();
    }

    const { context, page } = await setup(browser, { width: 390, height: 844 }, [
      { word: "record", meaning: "記録", examples: [{ en: "Keep a record.", ja: "記録をつける。" }, { en: "This is another example.", ja: "別の例文です。" }], phrases: [{ en: "on record", ja: "記録されて" }] },
      { word: "expense", meaning: "費用", examples: [], phrases: [] },
      { word: "apple", meaning: "りんご", examples: [{ en: "I ate an apple.", ja: "りんごを食べた。" }], phrases: [] }
    ]);
    const lastText = () => page.evaluate(() => window.__spoken.at(-1)?.text);
    const end = () => page.evaluate(() => window.__spoken.at(-1).onend?.());
    const advance = () => page.evaluate(() => window.__MWPlaybackTestClock.advance());
    await page.locator("#startUsageStudy").click();
    assert.equal(await lastText(), "Keep a record.");
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).lang), "en-US", "only an American voice is selected");
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).voice.name), "US Natural", "higher-quality US voice wins over browser order");
    await page.locator("[data-study-action='audio']").click();
    assert.equal(await lastText(), "Keep a record.", "replay reads the full example");
    await page.locator("#studySessionClose").click();
    await page.locator("#vocabLearningOptions > summary").click();
    await page.locator("#continuousStart").click();
    assert.equal(await lastText(), "record");
    await end(); assert.equal(await lastText(), "Keep a record.");
    const stale = await page.evaluate(() => { window.__oldExampleEnd = window.__spoken.at(-1).onend; return window.__spoken.length; });
    await page.locator("#playbackPause").click();
    assert.equal(await page.evaluate(() => window.__speechState.active), null, "pausing actually stops the speech engine");
    await page.evaluate(() => window.__oldExampleEnd());
    assert.equal(await page.evaluate(() => window.__spoken.length), stale, "a paused example cannot advance");
    await page.locator("#playbackPause").click();
    assert.equal(await page.evaluate(() => window.__speechState.active?.text), "Keep a record.", "resume starts real speech even when native resume does nothing");
    assert.equal(await page.evaluate(() => window.__spoken.length), stale + 1, "resume creates a fresh utterance for the current example");
    await page.evaluate(() => window.__oldExampleEnd());
    assert.equal(await lastText(), "Keep a record.", "a cancelled callback cannot skip the resumed example");
    for (let retry = 0; retry < 2; retry++) {
      await page.locator("#playbackPause").click();
      assert.equal(await page.evaluate(() => window.__speechState.active), null);
      await page.locator("#playbackPause").click();
      assert.equal(await page.evaluate(() => window.__speechState.active?.text), "Keep a record.", "repeated pause/resume keeps the same example");
    }
    await end(); assert.equal(await lastText(), "This is another example.");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.evaluate(() => window.__speechState.active), null, "backgrounding stops example speech");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(await page.locator("#playbackPause").textContent(), "再開", "returning stays paused");
    await page.locator("#playbackPause").click();
    assert.equal(await page.evaluate(() => window.__speechState.active?.text), "This is another example.", "foreground resume restarts the current example, not the first example");
    await page.evaluate(() => window.__oldExampleEnd());
    assert.equal(await lastText(), "This is another example.", "old example callbacks cannot skip the current example");
    assert.equal(await page.evaluate(() => window.__MWPlaybackTestClock.count()), 0, "next-word timer waits for all examples");
    await end(); await advance(); assert.equal(await lastText(), "expense", "phrases are not added as examples");
    await end(); await advance(); assert.equal(await lastText(), "apple", "words without examples advance normally");
    await end(); assert.equal(await lastText(), "I ate an apple.", "the last word also reads its example");
    await end(); await advance();
    assert.equal(await page.locator("#playbackDock").isVisible(), false, "playback finishes after the last example");

    for (const action of ["playbackNext", "playbackReplay", "playbackDockStop"]) {
      await page.locator(".word-card").first().locator("[data-word-action='play-from']").click();
      await end(); assert.equal(await lastText(), "Keep a record.");
      await page.evaluate(() => { window.__staleEnd = window.__spoken.at(-1).onend; });
      await page.locator(`#${action}`).click();
      const count = await page.evaluate(() => window.__spoken.length);
      await page.evaluate(() => window.__staleEnd());
      assert.equal(await page.evaluate(() => window.__spoken.length), count, `${action} cancels example callbacks`);
      if (action !== "playbackDockStop") await page.locator("#playbackDockStop").click();
    }
    await page.locator(".word-card").first().locator("[data-word-action='play-from']").click();
    await end();
    await page.evaluate(() => window.__spoken.at(-1).onerror());
    assert.equal(await lastText(), "This is another example.", "a failed example does not block the remaining examples");
    await page.locator("#playbackPause").click();
    const pausedCount = await page.evaluate(() => window.__spoken.length);
    await page.locator("#playbackNext").click();
    assert.equal(await page.evaluate(() => window.__spoken.length), pausedCount, "seeking during a paused example stays silent");
    await page.locator("#playbackPause").click();
    assert.equal(await lastText(), "expense");
    await page.locator("#playbackPrevious").click();
    assert.equal(await lastText(), "record");
    await end(); assert.equal(await lastText(), "Keep a record.", "previous restarts examples from the selected word");
    await page.locator("#playbackDockStop").click();
    await page.locator("[data-tab='settings']").click();
    await page.locator("#speechOptions > summary").click();
    assert.equal(await page.locator("#speechVoice option").count(), 3, "British voice is absent from choices");
    await page.locator("#speechVoice").selectOption("Basic English");
    await page.locator("#speechRate").selectOption("0.85");
    await page.locator("#previewSpeech").click();
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).voice.name), "Basic English");
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).rate), 0.85);
    await page.evaluate(() => {
      window.__availableUSVoices = window.__voices;
      window.__voices = [{ lang: "en-GB", name: "British Natural" }];
      window.__voiceEvents.dispatchEvent(new Event("voiceschanged"));
    });
    assert.match(await page.locator("#speechVoiceStatus").textContent(), /米国英語の音声を利用できません/);
    const noUSCount = await page.evaluate(() => window.__spoken.length);
    await page.locator("#previewSpeech").click();
    assert.equal(await page.evaluate(() => window.__spoken.length), noUSCount, "no British fallback");
    await page.evaluate(() => {
      window.__voices = window.__availableUSVoices;
      window.__voiceEvents.dispatchEvent(new Event("voiceschanged"));
    });
    assert.match(await page.locator("#speechVoiceStatus").textContent(), /Basic English/);
    await page.locator("#saveApiSettings").click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.locator("[data-tab='settings']").click();
    await page.locator("#speechOptions > summary").click();
    assert.equal(await page.locator("#speechVoice").inputValue(), "Basic English");
    assert.equal(await page.locator("#speechRate").inputValue(), "0.85");
    await page.screenshot({ path: path.join(os.tmpdir(), "mw-speech-settings-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(os.tmpdir(), "mw-speech-settings-desktop.png"), fullPage: true });
    await page.locator("[data-tab='ranges']").click();
    await page.locator("[data-action='open']").click();
    await page.locator("#startUsageStudy").click();
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).voice.name), "Basic English", "study uses saved voice");
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).rate), 0.85, "study uses saved rate");
    await page.locator("#studySessionClose").click();
    await page.locator("#vocabLearningOptions > summary").click();
    await page.locator("#continuousStart").click();
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).rate), 0.85);
    await end();
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).voice.name), "Basic English", "continuous examples use saved voice");
    await page.locator("#playbackDockStop").click();
    await context.close();
    console.log("PASS full-example study/replay, English voice selection, continuous example order/pause/seek/replay/stop and portrait controls at 320/360/390/412/820px");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
