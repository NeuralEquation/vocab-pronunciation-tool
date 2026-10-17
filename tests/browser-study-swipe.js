"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(),
  "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && fs.existsSync(p));
const baseUrl = process.env.MW_TEST_URL || "http://127.0.0.1:8765/";
const fixture = ["record", "expense", "apple"].map((word, i) => ({ word, meaning: `意味${i}`, examples: [{ en: `Example ${i}.`, ja: `例文${i}` }], phrases: [] }));

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const errors = [];
  try {
    for (const width of [390, 820]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true, isMobile: true });
      await context.route("https://**", route => route.abort());
      await context.addInitScript(() => {
        window.__studySpoken = [];
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
          getVoices: () => [], cancel() {}, pause() {}, resume() {},
          speak(utterance) { window.__studySpoken.push(utterance.text); }
        } });
      });
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      await page.locator("[data-tab='import']").click();
      await page.locator("#rangeName").fill("Swipe fixture");
      await page.locator("#testDate").fill("2026-10-19");
      await page.locator("#wordInput").fill(JSON.stringify(fixture));
      await page.locator("#importRange").click();
      await page.locator("[data-action='open']").click();
      const rangesBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges);
      const cdp = await context.newCDPSession(page);
      const settle = async index => {
        await page.waitForFunction(n => document.querySelector(".recall-head")?.textContent.includes(`${n} / 3`), index, { timeout: 5000 });
        await page.locator("[data-study-card]").evaluate(card => Promise.all(card.getAnimations().map(animation => animation.finished)));
      };
      const swipe = async (dx, dy = 0, selector = ".usage-study-english") => {
        const box = await page.locator(selector).boundingBox();
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
        for (let i = 1; i <= 5; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * i / 5, y: y + dy * i / 5 }] });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      for (const mode of ["Word", "Usage"]) {
        await page.locator(`#start${mode}Study`).click();
        await settle(1);
        const speechAtFirst = await page.evaluate(() => window.__studySpoken.length);
        await swipe(110);
        await page.waitForTimeout(300);
        await settle(1);
        assert.equal(await page.evaluate(() => window.__studySpoken.length), speechAtFirst, "back at the first card does not wrap or replay");
        await swipe(-110); await settle(2);
        await swipe(-110); await settle(3);
        await swipe(110); await settle(2);
        assert.equal(await page.evaluate(() => window.__studySpoken.at(-1)), "expense", "back replays the selected card's word");
        await swipe(0, 110);
        await page.waitForTimeout(300); await settle(2);
        await swipe(30);
        await page.waitForTimeout(300); await settle(2);
        await page.locator("[data-study-action='audio']").click();
        await settle(2);
        await swipe(100, 0, "[data-study-action='audio']");
        await page.waitForTimeout(300); await settle(2);
        const box = await page.locator(".usage-study-english").boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await settle(3);
        await swipe(-110);
        await page.locator("#recallContent .test-result").waitFor();
        await page.locator("[data-study-action='return']").click();
      }
      await page.locator("#startWordStudy").click(); await settle(1);
      await page.locator("[data-study-card]").evaluate(card => { card.click(); card.click(); });
      await settle(2);
      await page.evaluate(() => {
        document.querySelector("[data-study-card]").click();
        document.getElementById("studySessionClose").click();
        document.getElementById("startUsageStudy").click();
      });
      await page.waitForTimeout(350); await settle(1);
      assert.match(await page.locator(".usage-study-english").textContent(), /^Example 0/,
        "an old transition cannot overwrite a newly started session");
      await page.locator("#studySessionClose").click();
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges), rangesBefore, "ungraded navigation does not change learning history");
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log("PASS study swipes: word/usage back and forward, first/last boundaries, tap, audio buttons, vertical/short drags, history preservation (390px/820px emulated touch)");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
