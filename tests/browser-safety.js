"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
async function expand(page, selector) {
  const group = page.locator(selector);
  if (await group.getAttribute("open") === null) await group.locator(":scope > summary").click();
}
const baseUrl = process.env.MW_TEST_URL || "http://127.0.0.1:8765/";
const MAIN = "mwPronunciationTool.v1";
const KEY = "mwPronunciationTool.apiKey.v1";
const data = { schemaVersion: 3, settings: { demoMode: true }, ranges: [{ id: "r", rangeName: "Safety fixture", words: [{ id: "w", word: "record", hard: true, meaningsJa: ["記録"] }] }] };
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(), "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find(p => p && fs.existsSync(p));

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const contexts = [], errors = [];
  const contextFor = async ({ raw = JSON.stringify(data), quota = "", secret = "", locks = "" } = {}) => {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1024, height: 768 } });
    contexts.push(context);
    // All dictionary requests are forbidden in these fixture-only tests.
    await context.route("https://www.dictionaryapi.com/**", route => { errors.push("unexpected real API request"); return route.abort(); });
    await context.addInitScript(({ raw, quota, secret, locks, MAIN, KEY }) => {
      if (localStorage.getItem(MAIN) == null) localStorage.setItem(MAIN, raw);
      if (secret) localStorage.setItem(KEY, secret);
      const original = Storage.prototype.setItem;
      window.__restoreStorageWrites = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (key, value) {
        if (key === quota) throw new DOMException("fixture quota", "QuotaExceededError");
        return original.call(this, key, value);
      };
      const originalLocks = navigator.locks;
      window.__restoreLocks = () => Object.defineProperty(navigator, "locks", { configurable: true, value: originalLocks });
      if (locks === "unsupported") Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
      if (locks === "error") Object.defineProperty(navigator, "locks", { configurable: true, value: { request() { return Promise.reject(new DOMException("fixture unavailable", "SecurityError")); } } });
    }, { raw, quota, secret, locks, MAIN, KEY });
    return context;
  };
  const open = async (context, ready = "true") => {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(expected => document.documentElement.dataset.appReady === expected, ready);
    return page;
  };
  const stored = page => page.evaluate(key => localStorage.getItem(key), MAIN);
  try {
    const broken = await open(await contextFor({ raw: "{broken" }));
    assert.equal(await broken.locator("#saveStatus").getAttribute("data-state"), "recovery");
    await broken.locator("[data-tab='settings']").click(); await expand(broken, "#dictionaryOptions");
    await broken.locator("#saveApiSettings").click();
    assert.equal(await stored(broken), "{broken");
    await broken.locator("[data-tab='backup']").click();
    await expand(broken, "#backupOptions");
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
    await quota.locator("[data-tab='settings']").click(); await expand(quota, "#dictionaryOptions");
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
    await credentialQuota.locator("[data-tab='settings']").click(); await expand(credentialQuota, "#dictionaryOptions");
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
    await first.locator("[data-tab='settings']").click(); await expand(first, "#dictionaryOptions");
    await first.locator("#dictionaryType").selectOption("collegiate");
    await first.locator("#saveApiSettings").click();
    await second.locator("[data-tab='settings']").click(); await expand(second, "#dictionaryOptions");
    await second.locator("#saveApiSettings").click();
    assert.equal(JSON.parse(await stored(second)).settings.dictionaryType, "collegiate");
    await first.close();
    await second.reload();
    await second.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    assert.equal(await second.locator("#saveStatus").getAttribute("data-state"), "saved");

    const unsupported = await open(await contextFor({ locks: "unsupported" }));
    assert.equal(await unsupported.locator("#saveStatus").getAttribute("data-state"), "readonly");
    assert.match(await unsupported.locator("#saveStatusText").textContent(), /この環境では安全な保存機能を利用できません/);
    assert.doesNotMatch(await unsupported.locator("#saveStatusText").textContent(), /別の/);
    assert.equal(await stored(unsupported), JSON.stringify(data));

    const unavailable = await open(await contextFor({ locks: "error" }));
    assert.match(await unavailable.locator("#saveStatusText").textContent(), /保存機能を開始できませんでした/);
    assert.match(await unavailable.locator("#saveStatusText").textContent(), /MW70-LOCK-SecurityError/);
    assert.equal(await unavailable.locator("#retryStorage").isVisible(), true);
    await unavailable.evaluate(() => window.__restoreLocks());
    await unavailable.locator("#retryStorage").click();
    await unavailable.waitForFunction(() => document.querySelector("#saveStatus").dataset.state === "saved");
    assert.equal(await unavailable.locator("#retryStorage").isVisible(), false);

    // An early UI binding exception must not become a lock error or disable
    // the independent export/reload controls. Nothing may overwrite the data.
    const startupContext = await contextFor();
    await startupContext.addInitScript(() => {
      const query = document.querySelector.bind(document);
      document.querySelector = function (selector) {
        if (selector === ".tabs" && !sessionStorage.getItem("fixture.bootFailed")) {
          sessionStorage.setItem("fixture.bootFailed", "true");
          throw new TypeError("FIXTURE_PRIVATE_DIAGNOSTIC_DATA");
        }
        return query(selector);
      };
    });
    const startup = await open(startupContext, "error");
    assert.equal(await startup.locator("#saveStatus").getAttribute("data-state"), "recovery");
    const startupText = await startup.locator("#saveStatusText").textContent();
    assert.match(startupText, /MW70-EVENTS-TypeError/);
    assert.doesNotMatch(startupText, /保存機能を開始できません|FIXTURE_PRIVATE_DIAGNOSTIC_DATA/);
    assert.equal(await stored(startup), JSON.stringify(data));
    const startupDownload = startup.waitForEvent("download");
    await startup.locator("#saveStatusExport").click();
    const startupBackup = JSON.parse(fs.readFileSync(await (await startupDownload).path(), "utf8"));
    assert.equal(startupBackup.ranges[0].words[0].word, "record");
    await startup.locator("#reloadData").click();
    await startup.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    assert.equal(await startup.locator("#saveStatus").getAttribute("data-state"), "saved");

    // A later renderer failure also keeps local saves and replacement blocked.
    const renderContext = await contextFor();
    await renderContext.route("**/js/content.js?*", route => route.fulfill({
      contentType: "application/javascript",
      body: fs.readFileSync(path.join(__dirname, "../js/content.js"), "utf8") + '\nwindow.MWContent = { ...window.MWContent, contentStats: () => { throw new TypeError("FIXTURE_PRIVATE_RENDER_DATA"); } };'
    }));
    const failedRender = await open(renderContext, "error");
    assert.match(await failedRender.locator("#saveStatusText").textContent(), /MW70-RENDER-TypeError/);
    assert.doesNotMatch(await failedRender.locator("#saveStatusText").textContent(), /FIXTURE_PRIVATE_RENDER_DATA/);
    await failedRender.locator("[data-tab='settings']").click(); await expand(failedRender, "#dictionaryOptions");
    await failedRender.locator("#saveApiSettings").click();
    assert.equal(await stored(failedRender), JSON.stringify(data));

    // Resume while the original browser lock request is still completing.
    const racingContext = await contextFor();
    await racingContext.addInitScript(() => {
      const locks = navigator.locks;
      let interrupted = false;
      Object.defineProperty(navigator, "locks", { value: {
        request(name, options, callback) {
          return locks.request(name, options, lock => {
            if (!interrupted) {
              interrupted = true;
              window.dispatchEvent(new PageTransitionEvent("pagehide"));
              window.dispatchEvent(new PageTransitionEvent("pageshow"));
            }
            return callback(lock);
          });
        }
      } });
    });
    const racing = await open(racingContext);
    assert.equal(await racing.locator("#saveStatus").getAttribute("data-state"), "saved");

    // Android PWA resume may keep this document after a non-BFCache pagehide.
    // It must reacquire the released lock, without duplicating event handlers.
    const resumed = await open(await contextFor());
    const resumedBefore = await stored(resumed);
    for (let i = 0; i < 3; i++) {
      await resumed.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
      });
      await resumed.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await resumed.waitForFunction(() => document.querySelector("#saveStatus").dataset.state === "saved");
    }
    assert.equal(await stored(resumed), resumedBefore);
    await resumed.evaluate(key => {
      window.__mainWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) window.__mainWrites++;
        return original.call(this, name, value);
      };
    }, MAIN);
    await resumed.locator("[data-tab='settings']").click(); await expand(resumed, "#dictionaryOptions");
    await resumed.locator("#dictionaryType").selectOption("collegiate");
    await resumed.locator("#saveApiSettings").click();
    assert.equal(JSON.parse(await stored(resumed)).settings.dictionaryType, "collegiate");
    assert.equal(await resumed.evaluate(() => window.__mainWrites), 1);

    const transferContext = await contextFor();
    const owner = await open(transferContext), waiting = await open(transferContext);
    assert.equal(await waiting.locator("#saveStatus").getAttribute("data-state"), "readonly");
    await owner.close();
    await waiting.evaluate(() => window.dispatchEvent(new Event("focus")));
    await waiting.waitForFunction(() => document.querySelector("#saveStatus").dataset.state === "saved");

    // Another page can write while this PWA is suspended. Never revive its
    // stale in-memory state as a writer over the newer saved data.
    const staleContext = await contextFor();
    const stale = await open(staleContext);
    await stale.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    const newer = await open(staleContext);
    await newer.locator("[data-tab='settings']").click(); await expand(newer, "#dictionaryOptions");
    await newer.locator("#dictionaryType").selectOption("collegiate");
    await newer.locator("#saveApiSettings").click();
    const newerRaw = await stored(newer);
    await newer.close();
    await stale.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
    await stale.waitForFunction(() => /別の画面でデータが変更/.test(document.querySelector("#saveStatusText").textContent));
    assert.equal(await stale.locator("#saveStatus").getAttribute("data-state"), "readonly");
    await stale.locator("[data-tab='settings']").click(); await expand(stale, "#dictionaryOptions");
    await stale.locator("#saveApiSettings").click();
    assert.equal(await stored(stale), newerRaw);

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
    console.log("PASS browser safety: corrupt recovery, quota, retry, writer lock, PWA resume, lock transfer, stale resume, lock failures, portable secret boundary");
  } finally {
    for (const context of contexts) await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
