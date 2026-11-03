"use strict";
const assert = require("node:assert/strict");
const path = require("node:path"), fs = require("node:fs"), os = require("node:os");
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(), "/usr/bin/chromium"].find(p => p && fs.existsSync(p));
const baseUrl = process.env.MW_TEST_URL || "http://127.0.0.1:8765/";
const fixture = Array.from({ length: 16 }, (_, i) => ({ word: `word${String.fromCharCode(97 + i)}`, meaning: `意味${i}`, examples: [], phrases: [] }));
(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  try {
    for (const width of [320, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: true });
      await context.route("https://**", route => route.abort());
      await context.addInitScript(() => {
        window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
        Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
          getVoices: () => [{ lang: "en-US", name: "Test US" }], cancel() {}, speak() {}
        } });
      });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(baseUrl);
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      await page.locator("[data-tab='import']").click();
      await page.locator("#rangeName").fill("Marked quiz fixture");
      await page.locator("#testDate").fill("2026-11-02");
      await page.locator("#wordInput").fill(JSON.stringify(fixture));
      await page.locator("#importRange").click();
      await page.locator("[data-action='open']").click();
      assert.equal(await page.locator(".readiness-state, #startWordFinishMenu, #startUsageFinish").count(), 0);
      assert.ok(!(await page.locator("body").innerText()).includes("満点確認"));
      assert.equal(await page.locator("#startMarkedEnglish").isDisabled(), true);
      await page.locator("#markedWordPicker > summary").click();
      await page.locator("#markedWordSearch").fill("意味0");
      assert.equal(await page.locator("[data-marked-word]").count(), 1);
      await page.locator("[data-marked-word]").check();
      assert.equal(await page.locator("#markedReviewCount").textContent(), "1語");
      const savedWords = () => page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].words);
      const firstId = (await savedWords())[0].id;
      assert.equal((await savedWords())[0].reviewMarked, true);
      await page.locator("#markedWordSearch").fill("");
      await page.screenshot({ path: path.join(os.tmpdir(), `mw-marked-picker-${width}.png`), fullPage: true });
      await page.locator("#markedWordPicker > summary").click();
      assert.equal(await page.locator(".word-card").first().isVisible(), false, "quiz setup does not require opening word cards");
      await page.locator("#startMarkedEnglish").click();
      assert.match(await page.locator("#testContent .test-progress").textContent(), /1\s*\/\s*1/);
      assert.equal(await page.locator(".test-prompt").textContent(), "worda");
      assert.equal(await page.locator(".test-choice").count(), 4);
      await page.screenshot({ path: path.join(os.tmpdir(), `mw-marked-test-${width}.png`), fullPage: true });
      const wrong = await page.locator(".test-choice").evaluateAll(buttons => buttons.findIndex(button => button.textContent !== "意味0"));
      await page.locator(".test-choice").nth(wrong).click();
      await page.locator("[data-test-action='next']").click();
      assert.match(await page.locator(".result-score").textContent(), /0\s*\/\s*1/);
      assert.equal((await savedWords())[0].reviewMarked, true);
      await page.locator("[data-test-action='repeat-marked-wrong']").click();
      await page.getByRole("button", { name: "意味0", exact: true }).click();
      assert.equal(await page.locator("[data-test-action='next']").count(), 1, "a correct marked answer waits so marks can be adjusted");
      await page.locator("[data-test-action='next']").click();
      assert.match(await page.locator(".result-score").textContent(), /1\s*\/\s*1/);
      assert.equal((await savedWords())[0].reviewMarked, true, "success never automatically clears the mark");
      await page.screenshot({ path: path.join(os.tmpdir(), `mw-marked-result-${width}.png`), fullPage: true });
      await page.getByText("今回の単語をマーク", { exact: true }).click();
      await page.locator(`.marked-result-list [data-review-toggle='${firstId}']`).click();
      assert.equal((await savedWords())[0].reviewMarked, false);
      await page.locator("[data-test-action='return']").click();
      await page.locator("#markedWordPicker > summary").click();
      for (let i = 1; i <= 3; i++) await page.locator("[data-marked-word]").nth(i).check();
      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
      if (!(await page.locator("#wordPanel").isVisible())) await page.locator("[data-action='open']").click();
      assert.equal(await page.locator("#markedReviewCount").textContent(), "3語");
      await page.locator("#startMarkedJapanese").click();
      for (let i = 0; i < 3; i++) {
        const prompt = await page.locator(".test-prompt").textContent();
        assert.ok(["意味1", "意味2", "意味3"].includes(prompt));
        await page.getByRole("button", { name: fixture[Number(prompt.slice(2))].word, exact: true }).click();
        await page.locator("[data-test-action='next']").click();
      }
      assert.match(await page.locator(".result-score").textContent(), /3\s*\/\s*3/);
      const stored = await savedWords();
      assert.equal(stored.filter(word => word.reviewMarked).length, 3);
      assert.equal(stored[0].reviewMarked, false);
      assert.ok(stored.slice(1, 4).every(word => word.testStats.jaToEn.correct === 1));
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
      await context.close();
    }
    console.log("PASS marked quizzes: compact selection/search, no full-score UI, single-word wrong retry, manual removal, saved marks, reverse three-word quiz, no cards, 320/1280px");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
