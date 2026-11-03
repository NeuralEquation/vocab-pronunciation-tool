"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os");
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(), "/usr/bin/chromium"].find(p => p && fs.existsSync(p));
const dictionary = [
  { meta: { id: "record:1", stems: ["record"] }, fl: "noun", hwi: { hw: "rec*ord", prs: [{ ipa: "ˈrekɚd", sound: { audio: "nounfixture" } }] }, shortdef: ["a written account"] },
  { meta: { id: "record:2", stems: ["record"] }, fl: "verb", hwi: { hw: "re*cord", prs: [{ ipa: "rɪˈkɔrd", sound: { audio: "verbfixture" } }] }, shortdef: ["to write down"] }
];
(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await context.route("https://**", route => route.abort());
    await context.addInitScript(dictionary => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, options) => String(input).startsWith("https://www.dictionaryapi.com/")
        ? Promise.resolve(new Response(JSON.stringify(dictionary), { status: 200, headers: { "content-type": "application/json" } }))
        : nativeFetch(input, options);
      window.__audioURLs = []; window.__spoken = [];
      window.Audio = class {
        constructor(url = "") { this.src = url; }
        play() { window.__audioURLs.push(this.src); window.__lastAudio = this; return Promise.resolve(); }
        pause() {} removeAttribute() {}
      };
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, "speechSynthesis", { configurable: true, value: {
        getVoices: () => [{ lang: "en-US", name: "US Natural" }], cancel() {}, speak(u) { window.__spoken.push(u.text); }
      } });
    }, dictionary);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const words = () => page.evaluate(() => JSON.parse(localStorage.getItem("mwPronunciationTool.v1")).ranges[0].words);
    await page.goto(process.env.MW_TEST_URL || "http://127.0.0.1:8765/");
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.locator("[data-tab='settings']").click();
    await page.locator("#dictionaryOptions > summary").click();
    await page.locator("#demoMode").uncheck();
    await page.locator("#apiKey").fill("TEST_KEY");
    await page.locator("#saveApiSettings").click();
    await page.locator("[data-tab='import']").click();
    await page.locator("#rangeName").fill("POS pronunciation fixture");
    await page.locator("#testDate").fill("2026-11-02");
    await page.locator("#wordInput").fill(JSON.stringify([
      { word: "record", meaning: "記録／記録する", partsOfSpeech: ["noun", "verb"], pronunciations: [{ partOfSpeech: "noun", ipa: "ˈrekɚd" }, { partOfSpeech: "verb", ipa: "rɪˈkɔrd" }], verbForms: { past: ["recorded"] } },
      { word: "go", meaning: "行く", partsOfSpeech: ["verb"], verbForms: { past: ["went"] } },
      { word: "apple", meaning: "りんご", partsOfSpeech: ["noun"] },
      { word: "quickly", meaning: "すばやく", partsOfSpeech: ["adverb"] },
      { word: "unknown", meaning: "不明" }
    ]));
    await page.locator("#importRange").click();
    await page.locator("[data-action='open']").click();
    await page.locator("#materialContents > summary").click();
    const ids = (await words()).map(word => word.id), card = page.locator(`[data-word-id='${ids[0]}']`);
    assert.equal(await page.locator(`[data-word-id='${ids[2]}'] .verb-forms`).count(), 0, "noun never shows a verb-form registration box");
    assert.equal(await page.locator(`[data-word-id='${ids[3]}'] .verb-forms`).count(), 0);
    assert.equal(await page.locator(`[data-word-id='${ids[4]}'] .verb-forms`).count(), 0, "unknown POS does not imply verb");
    assert.equal(await card.locator(".verb-forms").count(), 1);
    await card.locator(".technical-details > summary").click();
    await card.locator("[data-word-action='refetch']").click();
    await page.locator("[data-modal-confirm]").click();
    await page.locator("[data-progress-close]").click();
    let record = (await words())[0];
    assert.equal(record.partsOfSpeech.join(","), "noun,verb");
    assert.equal(record.pronunciations.length, 2, "dictionary fetch does not overwrite textbook IPA");
    assert.equal(record.pronunciationVariants.length, 2, record.error || "API fixture should yield noun and verb variants");
    await card.locator("[data-word-action='play']").click();
    assert.match(await page.evaluate(() => window.__audioURLs.at(-1)), /nounfixture/);
    await card.locator("[data-pronunciation-pos]").selectOption("verb");
    await card.locator("[data-word-action='play']").click();
    assert.match(await page.evaluate(() => window.__audioURLs.at(-1)), /verbfixture/);
    const spokenBefore = await page.evaluate(() => window.__spoken.length);
    await page.evaluate(() => window.__lastAudio.onerror());
    assert.equal(await page.evaluate(() => window.__spoken.length), spokenBefore, "no ambiguous TTS after POS-specific audio fails");
    assert.match(await page.locator("#audioStatus").textContent(), /公式音声を再生できません/);
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    assert.equal((await words())[0].preferredPartOfSpeech, "verb");
    assert.equal((await words())[0].partOfSpeech, "noun", "selected POS does not mutate the independent dictionary cache on reload");
    if (!(await page.locator("#wordPanel").isVisible())) await page.locator("[data-action='open']").click();
    await page.locator("#markedWordPicker > summary").click();
    await page.locator(`[data-marked-word='${ids[0]}']`).check();
    await page.locator("#startMarkedEnglish").click();
    assert.equal(await page.locator("[data-test-pos]").textContent(), "動詞");
    await page.getByRole("button", { name: "記録／記録する", exact: true }).click();
    await page.locator("#testContent [data-pronunciation-pos]").selectOption("noun");
    assert.equal(await page.locator(".test-feedback").count(), 1, "selecting POS never removes an answered question");
    await page.locator(".test-feedback [data-test-action='replay']").click();
    assert.match(await page.evaluate(() => window.__audioURLs.at(-1)), /nounfixture/);
    await page.screenshot({ path: path.join(os.tmpdir(), "mw-pos-pronunciation-mobile.png"), fullPage: true });
    await page.locator("[data-test-action='next']").click();
    await page.locator("[data-test-action='return']").click();
    if (!(await page.locator("#materialContents").evaluate(el => el.open))) await page.locator("#materialContents > summary").click();
    await card.locator(".technical-details > summary").click();
    await card.locator("[data-edit-pos]").click();
    await page.locator("[data-pos-option='verb']").uncheck();
    await page.locator("[data-modal-confirm]").click();
    assert.equal(await card.locator(".verb-forms").count(), 0, "choosing noun-only hides the verb panel");
    assert.equal((await words())[0].pronunciations.length, 2, "changing lesson POS preserves all imported pronunciation evidence");
    assert.equal((await words())[0].verbForms.past[0], "recorded", "hiding a panel does not delete stored forms");
    const unknownCard = page.locator(`[data-word-id='${ids[4]}']`);
    await unknownCard.locator(".technical-details > summary").click();
    await unknownCard.locator("[data-edit-pos]").click();
    await page.locator("[data-pos-option='verb']").check();
    await page.screenshot({ path: path.join(os.tmpdir(), "mw-pos-editor-mobile.png"), fullPage: true });
    await page.locator("[data-modal-confirm]").click();
    assert.equal(await unknownCard.locator(".verb-forms").count(), 1, "adding verb POS exposes the verb editor on an older unknown word");
    assert.equal((await words())[4].partsOfSpeech[0], "verb");
    const backup = await page.evaluate(() => window.MWStorage.createBackup(JSON.parse(localStorage.getItem("mwPronunciationTool.v1"))));
    assert.equal(backup.ranges[0].words[0].preferredPartOfSpeech, "noun");
    assert.equal(backup.ranges[0].words[0].pronunciations.length, 2);
    assert.deepEqual(errors, []);
    await context.close();
    console.log("PASS POS grammar: JSON import, noun/unknown hidden forms, API fl/prs mapping, selected noun/verb recordings, no ambiguous fallback, reload, answer preservation and backup");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
