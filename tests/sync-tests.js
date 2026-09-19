"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = { URL, Blob, AbortController, setTimeout, clearTimeout }; context.window = context;
vm.createContext(context);
for (const file of ["js/storage.js", "js/sync-protocol.js", "js/sync.js", "gas/SyncServer.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const S = context.MWSync, P = context.MWSyncProtocol;
const copy = value => JSON.parse(JSON.stringify(value));
const data = (word = "record") => ({ schemaVersion: 3, settings: { demoMode: false, saveKey: true, apiKeySession: "LOCAL_ONLY_FIXTURE" }, ranges: [{ id: "r", rangeName: "Study", words: [{ id: "w", word, meaningsJa: ["記録"], cacheVersion: 7, apiFetched: true }] }], studyLog: {}, ui: { selectedRangeId: "r" } });
let serial = 0;
function server() {
  const store = { rows: [], locked: false, fail: "", hash: text => crypto.createHash("sha256").update(text).digest("hex"),
    list() { return copy(this.rows); },
    lock(fn) { if (this.locked) throw new Error("BUSY"); this.locked = true; try { return fn(); } finally { this.locked = false; } },
    append(value) { if (this.fail === "before") throw new Error("disk"); this.rows.push(copy(value)); if (this.fail === "after") throw new Error("lost commit acknowledgement"); }
  };
  return { store, handle: context.MWSyncServer.createServer(store).handle };
}
function device(remote, initial = data(), dirty = true) {
  let record = { data: copy(initial), sync: copy(S.initial(0, dirty)), revision: 0, hasData: dirty };
  const host = { writes: 0, sent: [], backups: [], states: [], failWrite: false, secrets: () => ["LOCAL_ONLY_FIXTURE"], id: () => `request_${String(++serial).padStart(16, "0")}`,
    read: () => copy(record),
    write(d, sync, recovery) { if (this.failWrite) throw new Error("quota"); if (recovery) this.backups.push(copy(record)); record = { data: copy(d), sync: copy(sync), revision: record.revision + 1, hasData: true }; this.writes++; },
    send: async request => { host.sent.push(copy(request)); return copy(remote.handle(request)); },
    status: state => host.states.push(state), applied() { host.applies = (host.applies || 0) + 1; }
  };
  const d = { host, client: S.createClient(host), get: () => copy(record),
    edit(word) { record.data.ranges[0].words[0].word = word; record.sync = copy(S.changed(record.sync)); },
    reload() { d.client = S.createClient(host); },
    set(value) { record = copy(value); }
  };
  return d;
}
const tests = [], test = (name, fn) => tests.push([name, fn]);
test("metadata rejects invalid counters and overflow; existing empty datasets remain unsynced", () => {
  assert.throws(() => S.initial(Infinity), /RECOVERY/);
  assert.throws(() => S.changed(S.initial(Number.MAX_SAFE_INTEGER)), /RECOVERY/);
  assert.equal(S.metadata(undefined, 0, true).dirty, true);
});
test("normal push/pull round-trips study data, excludes device settings, keeps receiving credentials", async () => {
  const r = server(), a = device(r), b = device(r, data("other"), false);
  assert.equal(await a.client.push(), "synced");
  assert.equal(a.get().sync.baseRevision, 1); assert.equal(a.get().sync.dirty, false);
  assert.equal(await b.client.pull(), "synced");
  assert.equal(b.get().data.ranges[0].words[0].word, "record");
  assert.equal(b.get().data.settings.apiKeySession, "LOCAL_ONLY_FIXTURE");
  assert.equal(b.host.backups.length, 1);
  assert.equal(JSON.stringify(r.store.rows).includes("LOCAL_ONLY_FIXTURE"), false);
  assert.equal(Object.hasOwn(r.store.rows[0].request.payload, "settings"), false);
});
test("stale baseRevision and two devices reject overwrite without auto merge", async () => {
  const r = server(), a = device(r), b = device(r);
  await a.client.push(); assert.equal(await b.client.push(), "conflict");
  assert.equal(b.get().sync.conflict, true); assert.equal(b.get().sync.baseRevision, 0);
  assert.equal(r.store.rows.length, 1);
  assert.equal(await b.client.push(), "conflict"); assert.equal(b.host.sent.length, 1);
  b.edit("local"); assert.equal(await b.client.pull("local"), "dirty");
  a.edit("new cloud"); await a.client.push();
  assert.equal(await b.client.push(), "conflict"); assert.equal(r.store.rows.length, 2);
  assert.equal(await b.client.pull("remote"), "synced");
  assert.equal(b.get().data.ranges[0].words[0].word, "new cloud");
  assert.equal(b.host.backups.at(-1).data.ranges[0].words[0].word, "local");
});
test("safe pull refuses to discard local edits even at the same base revision", async () => {
  const r = server(), a = device(r); await a.client.push(); a.edit("unsent");
  assert.equal(await a.client.pull(), "conflict");
  assert.equal(a.get().data.ranges[0].words[0].word, "unsent"); assert.equal(a.host.applies, undefined);
});
test("duplicate requestId is idempotent, including after newer generations; changed request is rejected", async () => {
  const r = server(), a = device(r); await a.client.push(); const req = a.host.sent[0];
  a.edit("next"); await a.client.push();
  assert.equal(r.handle(req).serverRevision, 1); assert.equal(r.store.rows.length, 2);
  const mutated = copy(req); mutated.payload.ranges[0].words[0].word = "tampered";
  assert.throws(() => r.handle(mutated), /REQUEST_REUSED/);
});
test("lost response after server success survives reload and retries identical durable request", async () => {
  const r = server(), a = device(r); const normal = a.host.send;
  a.host.send = async req => { await normal(req); throw new Error("offline"); };
  await assert.rejects(a.client.push()); const pending = a.get().sync.pending;
  assert.equal(r.store.rows.length, 1); assert.equal(a.get().sync.dirty, true);
  a.reload(); a.host.send = normal; await a.client.push();
  assert.deepEqual(a.host.sent[1], pending.request); assert.equal(r.store.rows.length, 1); assert.equal(a.get().sync.dirty, false);
});
test("learning during push remains dirty and outbox snapshot never mutates", async () => {
  const r = server(), a = device(r); const normal = a.host.send;
  a.host.send = async req => { a.edit("learned later"); return normal(req); };
  assert.equal(await a.client.push(), "dirty");
  assert.equal(r.store.rows[0].request.payload.ranges[0].words[0].word, "record");
  assert.equal(a.get().data.ranges[0].words[0].word, "learned later");
  assert.equal(a.get().sync.baseRevision, 1); a.host.send = normal;
  assert.equal(await a.client.push(), "synced"); assert.equal(r.store.rows.length, 2);
});
test("learning during pull, or an active study session, prevents remote replacement", async () => {
  const r = server(), a = device(r); await a.client.push();
  const b = device(r, data(), false); const normal = b.host.send;
  b.host.send = async req => { b.edit("in flight"); return normal(req); };
  assert.equal(await b.client.pull("remote"), "changed"); assert.equal(b.host.backups.length, 0);
  assert.equal(b.get().data.ranges[0].words[0].word, "in flight");
  b.host.send = normal; b.host.canApply = () => false;
  assert.equal(await b.client.pull("remote"), "changed");
});
test("malformed and credential-bearing payloads are rejected by server before persistence", () => {
  const r = server(), valid = copy(S.project(data(), ["LOCAL_ONLY_FIXTURE"]));
  const request = payload => ({ protocol: 1, op: "push", baseRevision: 0, requestId: "safe_request_123456", payload });
  for (const mutate of [p => p.ranges = {}, p => p.schemaVersion = 99, p => p.settings = {}, p => p.ranges[0].words[0].apiKey = "hidden", p => p.ranges[0].words[0].word = "", p => p.ranges[0].words[0].definitions = ["password=fixture"], p => p.ranges[0].words[0].word = "12345678-1234-1234-1234-123456789abc"]) {
    const bad = copy(valid); mutate(bad); assert.throws(() => r.handle(request(bad)));
  }
  assert.throws(() => r.handle({ ...request(valid), baseRevision: -1 }));
  assert.equal(r.store.rows.length, 0);
});
test("known secret in allowlisted text cancels send; unknown credential fields are excluded", async () => {
  const r = server(), a = device(r); a.edit("LOCAL_ONLY_FIXTURE");
  await assert.rejects(a.client.push()); assert.equal(a.host.sent.length, 0);
  assert.equal(a.host.states.at(-1), "secret");
  const unknown = data(); unknown.ranges[0].words[0].privateToken = "EXCLUDED_FIXTURE";
  assert.equal(JSON.stringify(S.project(unknown, [])).includes("EXCLUDED_FIXTURE"), false);
});
test("outbox is rechecked against newly configured secrets before retry", async () => {
  const r = server(), a = device(r); a.host.send = async () => { throw new Error(); };
  await assert.rejects(a.client.push()); a.host.secrets = () => ["record"];
  a.host.send = async () => { assert.fail("secret sent"); };
  await assert.rejects(a.client.push()); assert.equal(r.store.rows.length, 0);
});
test("local quota before send makes no network request; failed acknowledgement preserves outbox", async () => {
  const r = server(), a = device(r); a.host.failWrite = true;
  await assert.rejects(a.client.push()); assert.equal(a.host.sent.length, 0);
  a.host.failWrite = false; const normal = a.host.send;
  a.host.send = async req => { const response = await normal(req); a.host.failWrite = true; return response; };
  await assert.rejects(a.client.push()); assert.equal(a.get().sync.pending.request.baseRevision, 0);
  a.host.failWrite = false; a.host.send = normal; await a.client.push(); assert.equal(r.store.rows.length, 1);
});
test("generation save failure before commit retries; failure after commit reconciles by requestId", async () => {
  for (const mode of ["before", "after"]) {
    const r = server(), a = device(r); r.store.fail = mode;
    await assert.rejects(a.client.push()); assert.equal(a.get().sync.dirty, true);
    r.store.fail = ""; await a.client.push(); assert.equal(r.store.rows.length, 1);
  }
});
test("generation corruption, gaps and forks fail closed without overwriting history", async () => {
  for (const mutate of [rows => rows[0].request.payload.ranges[0].words[0].word = "corrupt", rows => rows[0].serverRevision = 2, rows => rows.push(copy(rows[0]))]) {
    const r = server(), a = device(r); await a.client.push(); mutate(r.store.rows);
    const before = JSON.stringify(r.store.rows); assert.throws(() => r.handle({ protocol: 1, op: "pull" }), /RECOVERY/);
    assert.equal(JSON.stringify(r.store.rows), before);
  }
});
test("server lock rejects concurrent entry and is released after failures", () => {
  const r = server(); r.store.locked = true;
  assert.throws(() => r.handle({ protocol: 1, op: "pull" }), /BUSY/);
  r.store.locked = false; r.store.rows = [{}];
  assert.throws(() => r.handle({ protocol: 1, op: "pull" })); assert.equal(r.store.locked, false);
});
test("uncertain push prevents pull or conflict resolution from destroying outbox", async () => {
  const r = server(), a = device(r); a.host.send = async () => { throw new Error(); };
  await assert.rejects(a.client.push()); const before = a.get();
  await assert.rejects(a.client.pull("remote")); await assert.rejects(a.client.pull("local"));
  assert.deepEqual(a.get(), before);
});
test("network failure, timeout and late GAS callback never report a false success", async () => {
  const req = { protocol: 1, op: "pull" };
  const env = { setTimeout, clearTimeout, fetch: async () => { throw new Error("private diagnostic"); } };
  await assert.rejects(S.transport("https://script.google.com/macros/s/fixture/exec", env, 20)(req), /NETWORK/);
  let success;
  const runner = { withSuccessHandler(fn) { success = fn; return this; }, withFailureHandler() { return this; }, syncRequest() {} };
  const gas = { setTimeout, clearTimeout, google: { script: { run: runner } } };
  await assert.rejects(S.transport("", gas, 10)(req), /NETWORK/);
  success({ status: "ok" });
  await assert.rejects(S.transport("https://evil.example/exec", env)(req), /NETWORK/);
});
test("concurrent button presses use one in-flight operation", async () => {
  const r = server(), a = device(r); let release;
  a.host.send = req => new Promise(resolve => { release = () => resolve(r.handle(req)); });
  const first = a.client.push(); await assert.rejects(a.client.push(), /BUSY/); release(); await first;
  assert.equal(r.store.rows.length, 1);
});
test("import/restore mark a new local revision and preserve pending snapshot", async () => {
  const r = server(), a = device(r); a.host.send = async () => { throw new Error(); };
  await assert.rejects(a.client.push()); const before = a.get().sync;
  const next = copy(S.changed(before)); assert.equal(next.localRevision, before.localRevision + 1);
  assert.equal(next.dirty, true); assert.deepEqual(next.pending, before.pending);
});
test("malformed responses and rollback revisions preserve the local copy", async () => {
  const r = server(), a = device(r); await a.client.push();
  const before = a.get(); a.host.send = async () => ({ status: "ok", serverRevision: 0, payload: S.project(data(), []) });
  await assert.rejects(a.client.pull("remote")); assert.deepEqual(a.get(), before);
  a.edit("new change"); a.host.send = async () => ({ status: "conflict", serverRevision: 0 });
  await assert.rejects(a.client.push()); assert.equal(a.get().sync.baseRevision, 1);
  assert.equal(a.get().sync.conflict, false);
});
(async () => { let passed = 0; for (const [name, fn] of tests) { try { await fn(); console.log("PASS " + name); passed++; } catch (e) { console.error("FAIL " + name); throw e; } } console.log(`${passed}/${tests.length} sync tests passed`); })().catch(e => { console.error(e.stack); process.exitCode = 1; });
