"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), vm = require("node:vm"), crypto = require("node:crypto");
let playwright; try { playwright = require("playwright"); } catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const baseUrl = process.env.MW_TEST_URL || "http://127.0.0.1:8765/";
const root = path.resolve(__dirname, ".."), MAIN = "mwPronunciationTool.v1", endpoint = "https://script.google.com/macros/s/mock_only/exec";
const executablePath = [process.env.MW_CHROMIUM_EXECUTABLE, playwright.chromium.executablePath(), "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(p => p && fs.existsSync(p));
const fixture = word => ({ schemaVersion: 3, settings: { demoMode: true }, ranges: [{ id: "range", rangeName: "Sync fixture", words: [{ id: "word", word, meaningsJa: ["記録"] }] }] });
const ctx = {}; vm.createContext(ctx);
for (const file of ["js/sync-protocol.js", "gas/SyncServer.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx);
const rows = [], store = { hash: text => crypto.createHash("sha256").update(text).digest("hex"), list: () => structuredClone(rows), append: row => rows.push(structuredClone(row)), lock: fn => fn() };
const remote = ctx.MWSyncServer.createServer(store);
(async () => {
  const browser = await playwright.chromium.launch({ headless: true, executablePath });
  const contexts = [], errors = []; let loseResponse = true, release = null, hold = false;
  async function open(word, native = false) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
    await context.route("https://www.dictionaryapi.com/**", route => { errors.push("unexpected MW call"); return route.abort(); });
    await context.route(endpoint, async route => {
      const request = route.request().postDataJSON();
      const response = remote.handle(request);
      if (hold) await new Promise(resolve => { release = resolve; });
      if (loseResponse) { loseResponse = false; await route.abort(); return; }
      await route.fulfill({ status: 200, headers: { "Access-Control-Allow-Origin": new URL(baseUrl).origin, "Access-Control-Allow-Credentials": "true" }, contentType: "application/json", body: JSON.stringify(response) });
    });
    await context.addInitScript(({ data, MAIN }) => { if (localStorage.getItem(MAIN) == null) localStorage.setItem(MAIN, JSON.stringify(data)); }, { data: fixture(word), MAIN });
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    if (native) {
      await page.exposeBinding("mockGasRequest", (_, request) => JSON.parse(JSON.stringify(remote.handle(request))));
      await page.addInitScript(() => {
        const runner = { withSuccessHandler(fn) { return { withFailureHandler(fail) { return { syncRequest(request) { window.mockGasRequest(request).then(fn, fail); } }; } }; } };
        window.google = { script: { run: runner } };
      });
    }
    await page.goto(baseUrl + (native ? ".gas-build/Index.html" : ""));
    await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await page.locator("[data-tab='backup']").click();
    if (!native) await page.locator("#syncEndpoint").fill(endpoint);
    return page;
  }
  const stored = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), MAIN);
  const ready = page => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  try {
    const a = await open("record");
    await a.locator("#syncPush").click(); await a.locator('#syncStatus[data-state="error"]').waitFor();
    const pendingId = (await stored(a)).sync.requestId; assert.ok(pendingId); assert.equal(rows.length, 1);
    await a.reload(); await ready(a); await a.locator("[data-tab='backup']").click();
    await a.locator("#syncPush").click(); await a.locator('#syncStatus[data-state="synced"]').waitFor();
    assert.equal(rows.length, 1); assert.equal(rows[0].request.requestId, pendingId);

    const b = await open("local alternative");
    await b.locator("#syncPush").click(); await b.locator('#syncStatus[data-state="conflict"]').waitFor();
    assert.equal((await stored(b)).ranges[0].words[0].word, "local alternative");
    await b.locator("#syncUseRemote").click(); await b.locator("[data-modal-confirm]").click();
    await b.waitForFunction(key => JSON.parse(localStorage.getItem(key)).ranges[0].words[0].word === "record", MAIN);
    await b.waitForLoadState("networkidle"); await ready(b); await b.locator("[data-tab='backup']").click();
    await b.locator("#restorePreSync").click(); await b.locator("[data-modal-confirm]").click();
    await b.waitForFunction(key => JSON.parse(localStorage.getItem(key)).ranges[0].words[0].word === "local alternative", MAIN);
    await b.waitForLoadState("networkidle"); await ready(b);
    assert.equal((await stored(b)).sync.dirty, true); assert.equal((await stored(b)).sync.baseRevision, 1);

    // App mutations while a response is held must survive acknowledgement.
    await a.locator("[data-tab='settings']").click(); await a.locator("#definitionLimit").selectOption("3"); await a.locator("#saveApiSettings").click();
    await a.locator("[data-tab='backup']").click(); hold = true; await a.locator("#syncPush").click();
    await a.waitForFunction(() => document.getElementById("syncStatus").dataset.state === "syncing");
    await a.locator("[data-tab='settings']").click(); await a.locator("#dictionaryType").selectOption("collegiate"); await a.locator("#saveApiSettings").click();
    assert.ok(release); hold = false; release();
    await a.waitForFunction(key => { const s = JSON.parse(localStorage.getItem(key)).sync; return !s.pending && s.baseRevision === 2; }, MAIN);
    assert.equal((await stored(a)).sync.dirty, true); assert.equal((await stored(a)).settings.dictionaryType, "collegiate");

    // Locally bundled GAS HTML + mocked google.script.run; this is NOT real GAS evidence.
    const gas = await open("GAS local", true); assert.equal(await gas.locator("#syncEndpoint").isDisabled(), true);
    await gas.locator("#syncUseRemote").click(); await gas.locator("[data-modal-confirm]").click();
    await gas.waitForFunction(key => JSON.parse(localStorage.getItem(key)).sync?.baseRevision === 2, MAIN);
    await gas.waitForLoadState("networkidle"); assert.equal((await stored(gas)).ranges[0].words[0].word, "record");
    assert.equal(await gas.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log("PASS browser sync fixture: lost response/reload/retry, two-device conflict, explicit pull, restore dirty, in-flight mutation, native GAS bundle, mobile width (no real Google services)");
  } finally { for (const c of contexts) await c.close(); await browser.close(); }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
