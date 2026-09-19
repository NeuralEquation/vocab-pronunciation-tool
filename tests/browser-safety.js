"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const baseUrl = process.env.MW_TEST_URL || "http://127.0.0.1:8765/";
const MAIN = "mwPronunciationTool.v1";
const KEY = "mwPronunciationTool.apiKey.v1";
const data = { schemaVersion: 3, settings: { demoMode: true }, ranges: [{ id: "r", rangeName: "Safety fixture", words: [{ id: "w", word: "record", hard: true, meaningsJa: ["記録"] }] }] };
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(), "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p => p && fs.existsSync(p));

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const contexts = [], errors = [];
  const contextFor = async ({ raw = JSON.stringify(data), quota = "", secret = "" } = {}) => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1024, height: 768 } });
    contexts.push(context);
    // All dictionary requests are forbidden in these fixture-only tests.
    await context.route("https://www.dictionaryapi.com/**", route => { errors.push("unexpected real API request"); return route.abort(); });
    await context.addInitScript(({ raw, quota, secret, MAIN, KEY }) => {
      if (localStorage.getItem(MAIN) == null) localStorage.setItem(MAIN, raw);
      if (secret) localStorage.setItem(KEY, secret);
      const original = Storage.prototype.setItem;
      window.__restoreStorageWrites = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (key, value) {
        if (key === quota) throw new DOMException("fixture quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
    }, { raw, quota, secret, MAIN, KEY });
    return context;
  };
  const open = async context => {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    return page;
  };
  const stored = page => page.evaluate(key => localStorage.getItem(key), MAIN);
  try {
    const broken = await open(await contextFor({ raw: "{broken" }));
    assert.equal(await broken.locator("#saveStatus").getAttribute("data-state"), "recovery");
    await broken.locator("[data-tab='settings']").click();
    await broken.locator("#saveApiSettings").click();
    assert.equal(await stored(broken), "{broken");
    await broken.locator("[data-tab='backup']").click();
    await broken.locator("#importJson").fill(JSON.stringify(data));
    await broken.locator("#replaceJson").click();
    await broken.locator("[data-modal-confirm]").click();
    await broken.waitForLoadState("networkidle");
    await broken.locator(".range-card").waitFor();
    assert.equal(await broken.evaluate(() => localStorage.getItem("mwPronunciationTool.preImportBackup.v1")), "{broken");

    const backupQuota = await open(await contextFor({ quota: "mwPronunciationTool.preSuperappBackup.v1" }));
    assert.equal(await backupQuota.locator(".range-card").count(), 1);
    assert.equal(await backupQuota.locator("#saveStatus").getAttribute("data-state"), "saved");

    const quota = await open(await contextFor({ quota: MAIN }));
    const before = await stored(quota);
    await quota.locator("[data-tab='settings']").click();
    await quota.locator("#dictionaryType").selectOption("collegiate");
    await quota.locator("#saveApiSettings").click();
    assert.equal(await stored(quota), before);
    assert.equal(await quota.locator("#saveStatus").getAttribute("data-state"), "unsaved");
    assert.doesNotMatch(await quota.locator("#toast").textContent(), /API設定を保存しました/);
    await quota.evaluate(() => window.__restoreStorageWrites());
    await quota.locator("#retrySave").click();
    assert.equal(JSON.parse(await stored(quota)).settings.dictionaryType, "collegiate");
    assert.equal(await quota.locator("#saveStatus").getAttribute("data-state"), "saved");

    const credentialQuota = await open(await contextFor({ quota: KEY }));
    await credentialQuota.locator("[data-tab='settings']").click();
    await credentialQuota.locator("#apiKey").fill("FIXTURE_ONLY_KEY");
    await credentialQuota.locator("#saveKey").check();
    await credentialQuota.locator("#saveApiSettings").click();
    await credentialQuota.locator("[data-modal-confirm]").click();
    assert.equal(await credentialQuota.locator("#saveStatus").getAttribute("data-state"), "unsaved");
    assert.equal(await credentialQuota.locator("#retrySave").isVisible(), false);
    await credentialQuota.locator("[data-modal-cancel]").click();
    await credentialQuota.locator("#clearApiKey").click();
    await credentialQuota.locator("[data-modal-confirm]").click();
    assert.equal(await credentialQuota.locator("#saveStatus").getAttribute("data-state"), "saved");
    assert.equal(await credentialQuota.evaluate(key => localStorage.getItem(key), KEY), null);
    assert.equal((await stored(credentialQuota)).includes("FIXTURE_ONLY_KEY"), false);

    const shared = await contextFor(); const first = await open(shared), second = await open(shared);
    assert.equal(await first.locator("#saveStatus").getAttribute("data-state"), "saved");
    assert.equal(await second.locator("#saveStatus").getAttribute("data-state"), "readonly");
    await first.locator("[data-tab='settings']").click();
    await first.locator("#dictionaryType").selectOption("collegiate");
    await first.locator("#saveApiSettings").click();
    await second.locator("[data-tab='settings']").click();
    await second.locator("#saveApiSettings").click();
    assert.equal(JSON.parse(await stored(second)).settings.dictionaryType, "collegiate");
    await first.close();
    await second.reload();
    await second.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    assert.equal(await second.locator("#saveStatus").getAttribute("data-state"), "saved");

    const secret = "AUDIT_ONLY_NOT_A_REAL_KEY";
    const secretData = structuredClone(data); secretData.ranges[0].words[0].apiKey = secret;
    const portable = await open(await contextFor({ raw: JSON.stringify(secretData), secret }));
    await portable.locator("[data-tab='backup']").click();
    const downloaded = portable.waitForEvent("download"); await portable.locator("#exportJson").click();
    const download = await downloaded;
    assert.equal(fs.readFileSync(await download.path(), "utf8").includes(secret), false);
    assert.equal(JSON.parse(await stored(portable)).ranges[0].words[0].apiKey, secret, "export must not mutate local source");

    // Exporting allowed text containing a known key must fail closed, too.
    const contaminated = structuredClone(data); contaminated.ranges[0].words[0].definitions = [secret];
    const blocked = await open(await contextFor({ raw: JSON.stringify(contaminated), secret }));
    let downloads = 0; blocked.on("download", () => downloads++);
    await blocked.locator("[data-tab='backup']").click(); await blocked.locator("#exportJson").click();
    assert.match(await blocked.locator("#toast").textContent(), /安全に作成できません/);
    assert.equal(downloads, 0);
    assert.deepEqual(errors, []);
    console.log("PASS browser safety: corrupt recovery, quota, retry, writer lock, lock transfer, portable secret boundary");
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
