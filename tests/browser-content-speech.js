"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs"), os = require("node:os");
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(), "/usr/bin/chromium"].find(p => p && fs.existsSync(p));
const fixture = [
  { word: "go", meaning: "行く", verbForms: { past: "went", pastParticiple: ["gone"], presentParticiple: "going", thirdPersonSingular: "goes" }, phrases: [{ en: "on the go", ja: "活動中で" }] },
  { word: "apple", meaning: "りんご" }, { word: "record", meaning: "記録" }, { word: "expense", meaning: "費用" }
];
(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("https://**", route => route.abort());
    await context.addInitScript(() => {
      window.__spoken = [];
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        getVoices: () => [{ lang: "en-US", name: "US Natural" }], speak(utterance) { window.__spoken.push(utterance); }, cancel() {}
      } });
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].words);
    const lastText = () => page.evaluate(() => window.__spoken.at(-1)?.text);
    await page.goto(process.env.MW_TEST_URL || "http://127.0.0.1:8765/");
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.locator("[data-tab='import']").click();
    await page.locator("#rangeName").fill("Phrase and verb speech");
    await page.locator("#testDate").fill("2026-11-02");
    await page.locator("#wordInput").fill(JSON.stringify([{ ...fixture[0], verbForms: { past: 42 } }]));
    assert.equal(await page.locator("#importRange").isDisabled(), true, "bad forms block registration");
    await page.locator("#wordInput").fill(JSON.stringify(fixture));
    await page.locator("#importRange").click();
    await page.locator("[data-action='open']").click();
    const initial = await stored(), wordId = initial[0].id;
    assert.equal(initial[0].verbForms.past[0], "went");
    assert.equal(Object.hasOwn(initial[1], "verbForms"), false, "legacy word stays compatible");
    await page.locator("#materialContents > summary").click();
    await page.locator("#usageList [data-usage-speak]").click();
    assert.equal(await lastText(), "on the go", "phrase itself is read");
    const card = page.locator(`[data-word-id='${wordId}']`);
    await card.locator(".verb-forms > summary").click();
    await card.locator("[data-verb-speak][data-form='past']").click();
    assert.equal(await lastText(), "went");
    assert.equal(await page.evaluate(() => window.__spoken.at(-1).lang), "en-US");
    await card.locator("[data-verb-speak][data-form='all']").click();
    assert.equal(await lastText(), "go");
    for (const expected of ["went", "gone", "going", "goes"]) {
      await page.evaluate(() => window.__spoken.at(-1).onend());
      assert.equal(await lastText(), expected);
    }
    await card.locator("[data-verb-edit]").click();
    await page.locator("#verb-past").fill("<script>");
    await page.locator("[data-modal-confirm]").click();
    assert.equal(await page.locator("#modalRoot").isVisible(), true, "invalid edits keep the editor open");
    assert.equal((await stored())[0].verbForms.past[0], "went");
    await page.locator("#verb-past").fill("went / went");
    await page.locator("#verb-thirdPersonSingular").fill("goes");
    await page.locator("[data-modal-confirm]").click();
    assert.equal((await stored())[0].verbForms.past.length, 1);
    await page.locator("#markedWordPicker > summary").click();
    await page.locator(`[data-marked-word='${wordId}']`).check();
    await page.locator("#startMarkedJapanese").click();
    assert.equal(await page.locator("#testContent .verb-forms").count(), 0, "reverse test does not leak forms before answering");
    await page.getByRole("button", { name: "go", exact: true }).click();
    await page.locator("#testContent .verb-forms > summary").click();
    await page.locator("#testContent [data-verb-speak][data-form='pastParticiple']").click();
    assert.equal(await lastText(), "gone");
    await page.locator("#testContent .linked-usage > summary").click();
    await page.locator("#testContent [data-usage-speak]").click();
    assert.equal(await lastText(), "on the go");
    await page.screenshot({ path: path.join(os.tmpdir(), "mw-phrase-verb-speech-mobile.png"), fullPage: true });
    await page.locator("[data-test-action='next']").click();
    await page.locator("[data-test-action='return']").click();
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    assert.equal((await stored())[0].verbForms.pastParticiple[0], "gone");
    const backup = await page.evaluate(() => window.MWStorage.createBackup(JSON.parse(localStorage.getItem("mwPronunciationTool.v1"))));
    assert.equal(backup.ranges[0].words[0].verbForms.pastParticiple[0], "gone");
    assert.deepEqual(errors, []);
    await context.close();
    console.log("PASS phrase and verb speech: optional JSON/legacy import, validation-first editor, US individual/sequence playback, revealed reverse answers, reload and portable backup");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
