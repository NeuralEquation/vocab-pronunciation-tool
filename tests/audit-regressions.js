"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const MAIN = "mwPronunciationTool.v1";
const fixture = () => ({ schemaVersion: 3, settings: { demoMode: true }, ranges: [{
  id: "range", rangeName: "Audit fixture", words: [{ id: "word", word: "record", meaningsJa: ["記録"], audioUrl: "https://media.merriam-webster.com/audio/prons/en/us/mp3/r/record01.mp3" }]
}] });

function harness(raw = JSON.stringify(fixture())) {
  const values = new Map(raw == null ? [] : [[MAIN, raw]]), elements = new Map(), blobs = [];
  const timers = new Map();
  let timerId = 0, failKey = "";
  const element = () => ({ value: "", checked: false, textContent: "", style: {}, dataset: {}, hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    setAttribute() {}, addEventListener() {}, querySelector() { return null; }, focus() {}, click() {}, remove() {} });
  class TestURL extends URL { static createObjectURL(blob) { blobs.push(blob); return "blob:audit"; } static revokeObjectURL() {} }
  const ctx = { Blob, URL: TestURL, Date, JSON, Map, Math, Number, Object, Set, String, TextEncoder, console, performance, AbortController, DOMException, TypeError,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    CSS: { escape: value => value }, navigator: {}, location: { reload() {} },
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element, querySelectorAll() { return []; }, querySelector() { return null; }, body: { appendChild() {}, classList: element().classList } },
    localStorage: { getItem: key => values.get(key) ?? null, setItem(key, value) { if (key === failKey) throw new DOMException("fixture quota", "QuotaExceededError"); values.set(key, value); }, removeItem(key) { values.delete(key); } }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const file of ["storage", "content", "test", "playback", "dictionary"]) vm.runInContext(fs.readFileSync(path.join(root, `js/${file}.js`), "utf8"), ctx);
  const source = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  assert.ok(source.includes("      initializeStorage();"));
  // Expose only inside this isolated VM, without production hooks or DOM boot.
  vm.runInContext(source.replace("      initializeStorage();", "window.audit = { state, persistence, load, save, canWrite, commitReplacement, exportPreUpgrade, exportJson, download, audioUrlFromId, safeApiError, fetchReal };"), ctx);
  ctx.audit.persistence.writer = true;
  return { ctx, a: ctx.audit, values, elements, blobs, timers, fail(key) { failKey = key; } };
}

const cases = [];
const it = (name, fn) => cases.push({ name, fn });

it("corrupt and future primary data cannot be overwritten by normal save", () => {
  for (const raw of ["{broken", JSON.stringify({ schemaVersion: 999, ranges: [] })]) {
    const h = harness(raw); h.a.load();
    assert.equal(h.a.persistence.readError, true);
    assert.equal(h.a.save(false), false);
    assert.equal(h.values.get(MAIN), raw);
  }
});

it("optional backup quota failure does not prevent reading valid data", () => {
  const h = harness(); h.fail("mwPronunciationTool.preSuperappBackup.v1"); h.a.load();
  assert.equal(h.a.persistence.readError, false);
  assert.equal(h.a.state.ranges[0].words[0].word, "record");
  assert.equal(h.a.save(false), true);
  assert.equal(JSON.parse(h.values.get(MAIN)).ranges.length, 1);
});

it("primary save failure preserves old bytes and exposes unsaved state until retry", () => {
  const h = harness(); h.a.load(); const before = h.values.get(MAIN);
  h.a.state.ranges[0].words[0].studyStatus = "hard"; h.fail(MAIN);
  assert.equal(h.a.save(false), false);
  assert.equal(h.values.get(MAIN), before);
  assert.equal(h.elements.get("saveStatus").dataset.state, "unsaved");
  h.fail(""); assert.equal(h.a.save(false), true);
  assert.equal(h.a.persistence.dirty, false);
  assert.equal(JSON.parse(h.values.get(MAIN)).ranges[0].words[0].studyStatus, "hard");
});

it("stale and read-only writers cannot replace another tab's data", () => {
  const h = harness(); h.a.load(); const newer = JSON.stringify({ ...fixture(), revision: 12 });
  h.values.set(MAIN, newer);
  assert.equal(h.a.save(false), false); assert.equal(h.values.get(MAIN), newer);
  assert.equal(h.a.persistence.conflict, true);
  const other = harness(); other.a.load(); other.a.persistence.writer = false;
  assert.equal(other.a.save(false), false);
  assert.equal(other.a.commitReplacement(fixture(), "recovery"), false);
});

it("legacy flags, spelling evidence and local extension fields survive reload", () => {
  const old = fixture(); old.schemaVersion = 1; old.ranges[0].memo = "keep locally";
  old.ranges[0].words = [
    { id: "a", word: "alpha", hard: true, extension: { note: "keep" } },
    { id: "b", word: "beta", checked: true, acceptedForms: ["Beta"], spellingStats: { attempts: 1, lastAttemptedAt: "2026-09-18T12:00:00.000Z", wrongAnswers: ["betta"] } }
  ];
  const h = harness(JSON.stringify(old)); h.a.load(); assert.equal(h.a.save(false), true);
  const reloaded = harness(h.values.get(MAIN)); reloaded.a.load();
  const [a, b] = reloaded.a.state.ranges[0].words;
  assert.equal(a.studyStatus, "hard"); assert.equal(b.studyStatus, "known"); assert.equal(a.extension.note, "keep");
  assert.equal(reloaded.a.state.ranges[0].memo, "keep locally");
  const portable = reloaded.ctx.MWStorage.createBackup(reloaded.a.state);
  assert.equal(portable.ranges[0].words[1].spellingStats.lastAttemptedAt, "2026-09-18T12:00:00.000Z");
  assert.equal(portable.ranges[0].words[1].spellingStats.wrongAnswers[0], "betta");
  assert.equal(portable.ranges[0].words[1].acceptedSpellings[0], "Beta");
});

it("portable projection strips nested credential fields and rejects known secrets in allowed text", () => {
  const h = harness(), data = fixture(), secret = "AUDIT_ONLY_SENTINEL";
  data.settings.apiKeySession = secret;
  const range = data.ranges[0], word = range.words[0]; range.apiKey = secret; word.token = secret;
  word.testStats = { enToJa: { attempts: 2, apiKey: secret } };
  range.usageItems = [{ id: "u", english: "Keep a record.", japanese: "記録する", apiKey: secret, recallStats: { attempts: 1, apiKey: secret } }];
  assert.equal(JSON.stringify(h.ctx.MWStorage.createBackup(data)).includes(secret), false);
  word.definitions = [secret];
  assert.throws(() => h.ctx.MWStorage.createBackup(data), /秘密情報/);
  assert.throws(() => h.ctx.MWStorage.assertNoSecrets(encodeURIComponent("secret/?"), ["secret/?"]), /秘密情報/);
  assert.equal(h.ctx.MWStorage.safeStoredError(`credential=${secret}`), "取得に失敗しました");
});

it("legacy backup export is validated and never emits the raw credential-bearing JSON", async () => {
  const h = harness(); const legacy = fixture(); legacy.ranges[0].apiKey = "AUDIT_ONLY_SENTINEL";
  h.values.set("mwPronunciationTool.preSuperappBackup.v1", JSON.stringify(legacy));
  h.a.exportPreUpgrade(); assert.equal(h.blobs.length, 1);
  assert.equal((await h.blobs[0].text()).includes("AUDIT_ONLY_SENTINEL"), false);
  h.values.set("mwPronunciationTool.preSuperappBackup.v1", "{broken");
  h.a.exportPreUpgrade(); assert.equal(h.blobs.length, 1);
  h.values.set("mwPronunciationTool.apiKey.v1", "AUDIT_ONLY_SENTINEL");
  assert.equal(h.a.download("x.csv", "AUDIT_ONLY_SENTINEL", "text/csv"), false);
});

it("replacement requires successful recovery copy and preserves original on each quota failure", () => {
  for (const failing of ["recovery", MAIN]) {
    const h = harness(); h.a.load(); const before = h.values.get(MAIN); h.fail(failing);
    assert.equal(h.a.commitReplacement({ ...fixture(), ranges: [] }, "recovery"), false);
    assert.equal(h.values.get(MAIN), before);
    if (failing === MAIN) assert.equal(h.values.get("recovery"), before);
  }
  const h = harness("{broken"); h.a.load();
  assert.equal(h.a.commitReplacement(fixture(), "recovery"), true);
  assert.equal(h.values.get("recovery"), "{broken");
  assert.equal(JSON.parse(h.values.get(MAIN)).ranges.length, 1);
});

it("valid official URLs survive validation; unsafe URL credentials and queries do not", () => {
  const h = harness(), data = fixture();
  assert.equal(h.ctx.MWStorage.createBackup(data).ranges[0].words[0].audioUrl, data.ranges[0].words[0].audioUrl);
  data.ranges[0].words[0].audioUrl += "?key=sentinel";
  assert.equal(h.ctx.MWStorage.createBackup(data).ranges[0].words[0].audioUrl, "");
  assert.match(h.a.audioUrlFromId("-special"), /\/number\/-special.mp3$/);
  assert.equal(h.ctx.MWStorage.csvCell("=1+1"), '"\'=1+1"');
});

function audioEnvironment() {
  const audios = [], spoken = [], timers = new Map(); let timerId = 0;
  const environment = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    Audio: class { constructor(url) { this.url = url; audios.push(this); } play() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); } pause() { this.paused = true; } removeAttribute() {} },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { cancel() {}, getVoices() { return [{ lang: "en-GB" }, { lang: "en-US" }]; }, speak(utterance) { spoken.push(utterance); } }
  };
  return { environment, audios, spoken, timers };
}

it("cancelled preview promises and stale queue callbacks cannot revive old speech", async () => {
  const h = harness(), media = audioEnvironment(); const player = h.ctx.MWPlayback.createPreviewPlayer(media.environment);
  player.play([{ text: "alpha", url: "a" }, { text: "obsolete", url: "old" }]);
  const old = media.audios[0], ended = old.onended;
  player.play([{ text: "beta", url: "b" }]); old.reject(new Error("cancelled")); ended();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(media.spoken.length, 0); assert.equal(media.audios.length, 2);
  assert.notEqual(media.audios[1].paused, true);
  const failed = media.audios[1]; failed.onerror(); failed.reject(new Error("also failed"));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(media.spoken.length, 1); assert.equal(media.spoken[0].text, "beta");
  assert.equal(media.spoken[0].voice.lang, "en-US");
  const speechEnd = media.spoken[0].onend; player.stop(); speechEnd();
  assert.equal(media.timers.size, 0);
});

it("official media errors and hangs fallback once; TTS failures advance the queue", () => {
  const h = harness(), media = audioEnvironment(); const player = h.ctx.MWPlayback.createPreviewPlayer(media.environment);
  player.play([{ text: "one", url: "one.mp3" }, { text: "two" }]);
  const timeout = [...media.timers.values()][0]; timeout(); timeout();
  assert.equal(media.spoken.length, 1);
  media.spoken[0].onerror(); assert.equal(media.spoken.length, 2); assert.equal(media.spoken[1].text, "two");
  player.stop(); assert.equal(media.timers.size, 0);
});

it("API client counts retry attempts, rejects reflected credentials, and cancels stalled bodies", async () => {
  const h = harness(); let attempts = 0, calls = 0;
  const environment = { setTimeout, clearTimeout, fetch: async () => ++calls === 1
    ? { ok: false, status: 503 } : { ok: true, text: async () => "[]" } };
  await h.ctx.MWDictionary.createClient(environment).request("record", "AUDIT_KEY", "learners", { onAttempt() { attempts++; } });
  assert.equal(attempts, 2);
  environment.fetch = async () => ({ ok: true, text: async () => "Error key=AUDIT_KEY" });
  await assert.rejects(h.ctx.MWDictionary.createClient(environment).request("record", "AUDIT_KEY", "learners"), error => !error.message.includes("AUDIT_KEY") && /安全/.test(error.message));
  environment.fetch = async (_, { signal }) => ({ ok: true, text: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) });
  await assert.rejects(h.ctx.MWDictionary.createClient(environment, 5).request("record", "AUDIT_KEY", "learners"), { name: "TimeoutError" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.ctx.MWDictionary.createClient(environment).request("record", "AUDIT_KEY", "learners", { signal: controller.signal }), { name: "AbortError" });
});

it("unsuccessful suggestion lookups count every real request; official fixtures retain audio", async () => {
  const h = harness(); let count = 0;
  h.ctx.fetch = async () => ({ ok: true, text: async () => JSON.stringify(++count === 1 ? ["first", "second", "third"] : []) });
  const missing = await h.a.fetchReal("record", "AUDIT_KEY", "learners");
  assert.equal(count, 4); assert.equal(missing.apiCalls, 4);
  assert.equal(JSON.parse(h.values.get("mwPronunciationTool.apiUsage.v1")).count, 4);
  h.ctx.fetch = async () => ({ ok: true, text: async () => JSON.stringify([{ meta: { id: "record", stems: ["record"] }, hwi: { hw: "rec*ord", prs: [{ ipa: "record", sound: { audio: "record01" } }] }, fl: "noun", shortdef: ["a written account"] }]) });
  const found = await h.a.fetchReal("record", "AUDIT_KEY", "learners");
  assert.equal(found.apiCalls, 1); assert.equal(found.hasAudio, true);
  assert.match(found.audioUrl, /\/r\/record01.mp3$/);
});

it("service worker caches only the manifest shell, keeps a consistent offline build, and respects other scopes", async () => {
  const handlers = {}, entries = new Map(), deleted = [];
  const scope = "https://example.test/app/", index = `${scope}index.html`;
  entries.set("mw-pronunciation-pwa-v54", new Map([[index, "old shell"]]));
  entries.set("mw-pronunciation-pwa-v54:other", new Map([["https://example.test/other/index.html", "other shell"]]));
  let claimed = false;
  const ctx = { URL, Set, self: { registration: { scope }, location: { origin: "https://example.test" }, clients: { async claim() { claimed = true; } },
    skipWaiting() { throw Error("updates must wait"); }, addEventListener(name, fn) { handlers[name] = fn; } },
    caches: { async keys() { return [...entries.keys()]; }, async delete(key) { deleted.push(key); entries.delete(key); }, async open(key) {
      if (!entries.has(key)) entries.set(key, new Map()); const cache = entries.get(key);
      return { async addAll(paths) { for (const path of paths) cache.set(new URL(path, scope).href, `shell:${path}`); }, async match(request) { return cache.get(typeof request === "string" ? request : request.url); } };
    } }, fetch() { throw Error("offline"); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "sw.js"), "utf8"), ctx);
  let waiting; handlers.install({ waitUntil(promise) { waiting = promise; } }); await waiting;
  handlers.activate({ waitUntil(promise) { waiting = promise; } }); await waiting;
  assert.equal(claimed, true); assert.deepEqual(deleted, ["mw-pronunciation-pwa-v54"]);
  for (const request of [
    { url: `${scope}sync`, method: "POST" }, { url: `${scope}private.json`, method: "GET" },
    { url: "https://www.dictionaryapi.com/anything?key=AUDIT", method: "GET" },
    { url: "https://example.test/other/index.html", method: "GET" }
  ]) handlers.fetch({ request, respondWith() { assert.fail("non-shell request intercepted"); } });
  let response;
  handlers.fetch({ request: { url: index, method: "GET", mode: "navigate" }, respondWith(promise) { response = promise; } });
  assert.equal(await response, "shell:./index.html");
  const shell = [...entries.entries()].find(([key]) => key.startsWith("mw-pronunciation-pwa-v55:"))[1];
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  for (const [, asset] of html.matchAll(/(?:src|href)="([^"]+\?v=\d+)"/g)) assert.equal(shell.has(new URL(asset, scope).href), true, asset);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of cases) {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { failed++; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`${cases.length - failed}/${cases.length} audit regressions passed`);
  process.exitCode = failed ? 1 : 0;
})();
