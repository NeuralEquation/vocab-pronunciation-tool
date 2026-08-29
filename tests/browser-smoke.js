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
  await page.locator("#testMode").selectOption(value);
  await page.locator("#startSelectedMode").click();
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
    assert.match(await page.locator(".readiness-state").first().textContent(), /未検証|危険/);
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

    const usageModeOptions = await page.locator("#testMode option").evaluateAll(options =>
      options.map(option => ({ value: option.value, label: option.textContent.trim() }))
    );
    assert.equal(usageModeOptions.some(option => option.value.startsWith("usage-")), false);
    assert.equal(await page.locator("#startUsageStudy").count(), 1);
    assert.equal(await page.locator("#startWordStudy").count(), 1);
    assert.equal(await page.locator("#startUsageSpeed").count(), 1);
    assert.equal(await page.getByText("関連単語を編集", { exact: true }).count(), 0);

    const usageHistoryBeforeStudy = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].usageItems.map(item => item.recallStats));
    await page.locator("#startUsageStudy").click();
    assert.equal(await page.locator("[data-recall-rating]").count(), 0);
    assert.match(await page.locator("#recallContent").textContent(), /学習モード[\s\S]*左へスワイプして次へ[\s\S]*公式音声未取得/);
    const studyCard = page.locator("[data-study-card]");
    const studyBox = await studyCard.boundingBox();
    assert.ok(studyBox);
    await page.mouse.move(studyBox.x + studyBox.width * 0.8, studyBox.y + studyBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(studyBox.x + studyBox.width * 0.15, studyBox.y + studyBox.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector(".recall-head")?.textContent.includes("2 / 2"));
    assert.equal(await page.locator("[data-recall-rating]").count(), 0);
    const studyBox2 = await page.locator("[data-study-card]").boundingBox();
    await page.mouse.move(studyBox2.x + studyBox2.width * 0.8, studyBox2.y + studyBox2.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(studyBox2.x + studyBox2.width * 0.15, studyBox2.y + studyBox2.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await page.locator("#recallContent .test-result").waitFor();
    assert.match(await page.locator("#recallContent").textContent(), /採点や学習履歴は記録していません/);
    await page.locator("[data-study-action='return']").click();
    const usageHistoryAfterStudy = await page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].usageItems.map(item => item.recallStats));
    assert.deepEqual(usageHistoryAfterStudy, usageHistoryBeforeStudy);

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
    assert.ok(cacheState.keys.includes("mw-pronunciation-pwa-v47"));
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

