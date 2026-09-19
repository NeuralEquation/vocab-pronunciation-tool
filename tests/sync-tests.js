"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const context = { URL, Blob, AbortController, setTimeout, clearTimeout, TextEncoder, crypto: crypto.webcrypto }; context.window = context;
vm.createContext(context);
for (const file of ["js/storage.js", "js/sync-protocol.js", "js/sync.js", "gas/SyncServer.js"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context);
const S = context.MWSync, P = context.MWSyncProtocol;
const copy = value => JSON.parse(JSON.stringify(value));
const data = (word = "record") => ({ schemaVersion: 3, settings: { demoMode: false, saveKey: true, apiKeySession: "LOCAL_ONLY_FIXTURE" }, ranges: [{ id: "r", rangeName: "Study", words: [{ id: "w", word, meaningsJa: ["記録"], cacheVersion: 7, apiFetched: true }] }], studyLog: {}, ui: { selectedRangeId: "r" } });
let serial = 0;
function server() {
  const store = { rows: [], head: null, refusals: {}, storageId: "fixture", locked: false, fail: "", capacity: 1000,
    hash: text => crypto.createHash("sha256").update(text).digest("hex"), id: () => crypto.randomUUID().replace(/-/g, ""),
    getHead() { return copy(this.head); }, setHead(h) { if (this.fail === "headBefore") throw new Error("disk"); this.head = copy(h); if (this.fail === "headAfter") throw new Error("lost"); },
    hasGenerations() { return this.rows.length > 0; }, read(id) { return copy(this.rows[Number(id.slice(1))]); },
    getRejected(d, id) { return this.refusals[d + id] || null; }, setRejected(d, id, entry) { this.refusals[d + id] = copy(entry); },
    lock(fn) { if (this.locked) throw new Error("BUSY"); this.locked = true; try { return fn(); } finally { this.locked = false; } },
    append(value) { if (this.fail === "before") throw new Error("disk"); this.rows.push(copy(value)); if (this.fail === "after") throw new Error("orphan"); return "f" + (this.rows.length - 1); }
  };
  return { store, handle: context.MWSyncServer.createServer(store).handle };
}
function device(remote, initial = data(), dirty = true) {
  let record = { data: copy(initial), sync: copy(S.initial(0, dirty)), revision: 0, hasData: dirty };
  const connected = remote.handle({ protocol: 2, op: "connect" });
  Object.assign(record.sync, { datasetId: connected.datasetId, baseHash: connected.genesisHash, serverHash: connected.serverHash, serverRevision: connected.serverRevision });
  const host = { archive(kind, value) { this.backups.push(copy(value)); }, writes: 0, sent: [], backups: [], states: [], failWrite: false, secrets: () => ["LOCAL_ONLY_FIXTURE"], id: () => crypto.randomUUID().replace(/-/g, ""),
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
  assert.equal(S.changed(S.initial(Number.MAX_SAFE_INTEGER)).state, "recovery-required");
  assert.equal(S.metadata(undefined, 0, true).dirty, true);
});
test("normal push/pull round-trips study data, excludes device settings, keeps receiving credentials", async () => {
  const r = server(), a = device(r), b = device(r, data("other"), false);
  assert.equal(await a.client.push(), "verified");
  assert.equal(a.get().sync.baseRevision, 1); assert.equal(a.get().sync.dirty, false);
  assert.equal(await b.client.pull(), "verified");
  assert.equal(b.get().data.ranges[0].words[0].word, "record");
  assert.equal(b.get().data.settings.apiKeySession, "LOCAL_ONLY_FIXTURE");
  assert.equal(b.host.backups.length, 1);
  assert.equal(JSON.stringify(r.store.rows).includes("LOCAL_ONLY_FIXTURE"), false);
  assert.equal(Object.hasOwn(r.store.rows[0].request.payload, "settings"), false);
});
test("stale baseRevision and two devices reject overwrite without auto merge", async () => {
  const r = server(), a = device(r), b = device(r);
  await a.client.push(); assert.equal(await b.client.push(), "rejected");
  assert.equal(b.get().sync.conflict, true); assert.equal(b.get().sync.baseRevision, 0);
  assert.equal(r.store.rows.length, 1);
  assert.equal(await b.client.push(), "rejected"); assert.equal(b.host.sent.length, 1);
  await b.client.clearRejected(); b.edit("local"); assert.equal(await b.client.pull("local"), "dirty");
  a.edit("new cloud"); await a.client.push();
  assert.equal(await b.client.push(), "rejected"); assert.equal(r.store.rows.length, 2);
  if (b.get().sync.pending) await b.client.clearRejected();
  assert.equal(await b.client.pull("remote"), "verified");
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
  assert.equal(r.handle(req).receipt.serverRevision, 1); assert.equal(r.store.rows.length, 2);
  const mutated = copy(req); mutated.payload.ranges[0].words[0].word = "tampered";
  assert.equal(r.handle(mutated).code, "REQUEST_REUSED");
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
  assert.equal(await a.client.push(), "verified"); assert.equal(r.store.rows.length, 2);
});
test("learning during pull, or an active study session, prevents remote replacement", async () => {
  const r = server(), a = device(r); await a.client.push();
  const b = device(r, data(), false); const normal = b.host.send;
  b.host.send = async req => { b.edit("in flight"); return normal(req); };
  if (b.get().sync.pending) await b.client.clearRejected();
  assert.equal(await b.client.pull("remote"), "changed"); assert.equal(b.host.backups.length, 0);
  assert.equal(b.get().data.ranges[0].words[0].word, "in flight");
  b.host.send = normal; b.host.canApply = () => false;
  if (b.get().sync.pending) await b.client.clearRejected();
  assert.equal(await b.client.pull("remote"), "changed");
});
test("malformed and credential-bearing payloads are rejected by server before persistence", () => {
  const r = server(), valid = copy(S.project(data(), ["LOCAL_ONLY_FIXTURE"]));
  const h = r.handle({ protocol: 2, op: "connect" });
  const request = payload => ({ protocol: 2, op: "push", datasetId: h.datasetId, baseHash: h.genesisHash, baseRevision: 0, requestId: crypto.randomUUID().replace(/-/g, ""), payload });
  for (const mutate of [p => p.ranges = {}, p => p.schemaVersion = 99, p => p.settings = {}, p => p.ranges[0].words[0].apiKey = "hidden", p => p.ranges[0].words[0].word = "", p => p.ranges[0].words[0].definitions = ["password=fixture"], p => p.ranges[0].words[0].word = "12345678-1234-1234-1234-123456789abc"]) {
    const bad = copy(valid); mutate(bad); assert.equal(r.handle(request(bad)).status, "rejected");
  }
  assert.throws(() => r.handle({ ...request(valid), baseRevision: -1 }));
  assert.equal(r.store.rows.length, 0);
});
test("known secret in allowlisted text cancels send; unknown credential fields are excluded", async () => {
  const r = server(), a = device(r); a.edit("LOCAL_ONLY_FIXTURE");
  await assert.rejects(a.client.push()); assert.equal(a.host.sent.length, 0);
  assert.equal(a.host.states.at(-1), "SECRET");
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
  for (const mode of ["before", "after", "headBefore", "headAfter"]) {
    const r = server(), a = device(r); r.store.fail = mode;
    await assert.rejects(a.client.push()); assert.equal(a.get().sync.dirty, true);
    r.store.fail = ""; await a.client.push(); assert.equal(r.store.head.committedRevision, 1);
  }
});
test("generation corruption, gaps and forks fail closed without overwriting history", async () => {
  for (const mutate of [rows => rows[0].request.payload.ranges[0].words[0].word = "corrupt", rows => rows[0].serverRevision = 2]) {
    const r = server(), a = device(r); await a.client.push(); mutate(r.store.rows);
    const before = JSON.stringify(r.store.rows); assert.throws(() => r.handle({ protocol: 2, op: "pull", datasetId: r.store.head.datasetId }), /RECOVERY/);
    assert.equal(JSON.stringify(r.store.rows), before);
  }
});
test("server lock rejects concurrent entry and is released after failures", () => {
  const r = server(); r.handle({ protocol: 2, op: "connect" }); r.store.locked = true;
  assert.throws(() => r.handle({ protocol: 2, op: "pull", datasetId: r.store.head.datasetId }), /BUSY/);
  r.store.locked = false; r.store.head.committedRevision = 1; r.store.rows = [{}];
  assert.throws(() => r.handle({ protocol: 2, op: "pull", datasetId: r.store.head.datasetId })); assert.equal(r.store.locked, false);
});
test("uncertain push prevents pull or conflict resolution from destroying outbox", async () => {
  const r = server(), a = device(r); a.host.send = async () => { throw new Error(); };
  await assert.rejects(a.client.push()); const before = a.get();
  await assert.rejects(a.client.pull("remote")); await assert.rejects(a.client.pull("local"));
  assert.deepEqual(a.get(), before);
});
test("network failure, timeout and late GAS callback never report a false success", async () => {
  const req = { protocol: 2, op: "connect" };
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
  const first = a.client.push(); await assert.rejects(a.client.push(), /BUSY/); while (!release) await new Promise(resolve => setTimeout(resolve, 1)); release(); await first;
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
test("H1 strict IDs and whole-packet known-secret scan on new send and restored pending", async () => {
  const r = server(), a = device(r);
  for (const bad of ["secret_fixture_request", "a".repeat(32), "22222222-2222-4222-8222-222222222222"]) {
    a.host.id = () => bad; await assert.rejects(a.client.push()); assert.equal(a.host.sent.length, 0);
    const h = r.store.head;
    assert.throws(() => r.handle({ protocol: 2, op: "push", datasetId: h.datasetId, baseRevision: 0, baseHash: h.committedHash, requestId: bad, payload: S.project(data()) }));
  }
  const secret = "22222222222242228222222222222222";
  a.host.id = () => secret; a.host.secrets = () => [secret];
  await assert.rejects(a.client.push(), /SECRET/); assert.equal(a.host.sent.length, 0);
  a.host.secrets = () => []; a.host.send = async () => { throw new Error(); };
  await assert.rejects(a.client.push()); a.reload(); a.host.secrets = () => [secret];
  a.host.send = async () => assert.fail("known secret transmitted");
  await assert.rejects(a.client.push(), /SECRET/);
  const broken = a.get(); broken.sync.pending.request.requestId = "bad"; broken.sync.requestId = "bad";
  assert.equal(S.inspect(broken.sync).quarantine, true);
});
test("H2 latest or HEAD generation missing, head hash mismatch and missing HEAD never roll back", async () => {
  for (const damage of [r => r.store.rows.pop(), r => r.store.head.generationFileId = "f99", r => r.store.head.committedHash = "f".repeat(64), r => r.store.head = null]) {
    const r = server(), a = device(r); await a.client.push(); a.edit("second"); await a.client.push();
    const old = a.get(); damage(r); const before = JSON.stringify(r.store.rows);
    assert.throws(() => r.handle({ protocol: 2, op: "connect" }), /RECOVERY/);
    a.edit("third"); await assert.rejects(a.client.push());
    assert.equal(JSON.stringify(r.store.rows), before); assert.equal(a.get().sync.baseRevision, old.sync.baseRevision);
  }
});
test("H2 orphan and fork files are not authoritative; failed readback cannot advance HEAD", async () => {
  const r = server(), a = device(r); await a.client.push(); const head = copy(r.store.head);
  r.store.rows.push({ garbage: true }, copy(r.store.rows[0]));
  assert.equal(r.handle({ protocol: 2, op: "pull", datasetId: head.datasetId }).serverRevision, 1);
  a.edit("next"); const read = r.store.read;
  r.store.read = function(id) { const row = read.call(this, id); if (id === "f3") row.checksum = "f".repeat(64); return row; };
  await assert.rejects(a.client.push()); assert.deepEqual(r.store.head, head);
  r.store.read = read; await a.client.push(); assert.equal(r.store.head.committedRevision, 2);
});
test("H3 equal revision on different datasets cannot be overwritten; reconnect keeps learning dirty", async () => {
  const r = server(), other = server(), a = device(r), b = device(other);
  await a.client.push(); await b.client.push(); a.edit("local new");
  a.host.send = async request => other.handle(request);
  await assert.rejects(a.client.push(), /DATASET_MISMATCH/);
  assert.equal(a.get().sync.state, "dataset-mismatch"); assert.equal(other.store.rows.length, 1);
  await a.client.connect(true); assert.equal(a.get().sync.dirty, true); assert.equal(a.get().sync.baseRevision, 0);
  assert.equal(a.get().data.ranges[0].words[0].word, "local new"); assert.equal(a.host.backups.length, 1);
  assert.equal(await a.client.push(), "rejected"); assert.equal(other.store.rows.length, 1);
});
test("H4 CAPACITY rejection archives and clears safely; delayed retry remains rejected", async () => {
  const r = server(), a = device(r); await a.client.push(); r.store.capacity = 1; a.edit("unsent");
  assert.equal(await a.client.push(), "rejected"); const p = a.get().sync.pending;
  a.host.archive = () => { throw new Error("quota"); }; await assert.rejects(a.client.clearRejected());
  assert.deepEqual(a.get().sync.pending, p);
  a.host.archive = function(kind, value) { this.backups.push(copy(value)); };
  await a.client.clearRejected(); assert.equal(a.get().sync.pending, null); assert.equal(a.get().sync.dirty, true);
  r.store.capacity = 100; assert.equal(r.handle(p.request).code, "CAPACITY"); assert.equal(r.store.rows.length, 1);
  assert.equal(await a.client.pull("remote"), "verified");
});
test("timeout status not_committed retains pending; cancel fences late delivery", async () => {
  const r = server(), a = device(r), normal = a.host.send; a.host.send = async () => { throw new Error("timeout"); };
  await assert.rejects(a.client.push()); const p = a.get().sync.pending; a.reload(); a.host.send = normal;
  assert.equal(await a.client.status(), "unknown"); assert.ok(a.get().sync.pending);
  await assert.rejects(a.client.clearRejected());
  assert.equal(await a.client.status(true), "rejected"); await a.client.clearRejected();
  assert.equal(r.handle(p.request).code, "CANCELLED"); assert.equal(r.store.rows.length, 0);
});
test("HEAD committed response lost is recovered through status, including later commits", async () => {
  const r = server(), a = device(r), normal = a.host.send;
  r.store.fail = "headAfter"; await assert.rejects(a.client.push()); r.store.fail = "";
  const b = device(r); await b.client.pull("local"); await b.client.push();
  a.reload(); a.host.send = normal;
  assert.equal(await a.client.status(), "local-clean"); assert.equal(a.get().sync.baseRevision, 1);
  assert.equal(a.get().sync.serverRevision, 2); assert.equal(a.get().sync.verified, false); assert.equal(r.store.rows.length, 2);
});
test("M1 canonical limits and date/ID rules are identical at server and client; pull cannot silently normalize", async () => {
  const payload = copy(S.project(data())); payload.ranges[0].words[0].meaningsJa = Array.from({length:30}, (_, i) => String(i));
  assert.doesNotThrow(() => P.validate(payload)); assert.equal(P.canonical(P.normalize(payload)), P.canonical(payload));
  for (const mutate of [p => p.ranges[0].words[0].meaningsJa.push("31"), p => p.ranges[0].testDate = "2026-02-30", p => p.ranges[0].words[0].word = "x".repeat(101), p => p.ranges[0].id = " r ", p => p.ranges[0].words[0].cacheVersion = "7", p => p.extra = "unknown"]) {
    const bad = copy(payload); mutate(bad); assert.throws(() => P.validate(bad));
    const r = server(), a = device(r); await a.client.push(); a.host.send = async () => ({ status: "ok", datasetId: r.store.head.datasetId, serverRevision: 1, serverHash: r.store.head.committedHash, payload: bad, payloadHash: await P.digest(bad) });
    const before = a.get(); await assert.rejects(a.client.pull("remote")); assert.deepEqual(a.get(), before);
  }
});
test("M2 known auth/endpoint and credential forms cannot pass via free text, errors or unknown fields", async () => {
  for (const secret of ["Bearer fixture_secret_value", "https://script.google.com/macros/s/fixture/exec", "ya29.fixture_token_value", "password=fixture", "eyJabc.def.ghi"]) {
    const value = data(); value.ranges[0].words[0].definitions = [secret]; assert.throws(() => S.project(value));
  }
  const payload = copy(S.project(data())); payload.ranges[0].rangeName = "saved_custom_auth_fixture";
  assert.throws(() => P.validate(payload, ["saved_custom_auth_fixture"]), /SECRET/);
  assert.doesNotThrow(() => P.validate(payload)); // Unknown human text is explicitly outside any 100% detection claim.
});
test("L1 disconnected, local clean and cloud verified are different states", async () => {
  const r = server(), a = device(r); const record = a.get(); record.sync = copy(S.initial(0, false)); a.set(record);
  assert.equal(S.display(a.get().sync), "disconnected"); assert.equal(await a.client.push(), "disconnected"); assert.equal(a.host.sent.length, 0);
  assert.equal(await a.client.connect(), "local-clean"); assert.equal(await a.client.push(), "local-clean");
  assert.equal(await a.client.pull(), "verified");
});
test("corrupt rejection records fail closed and never echo arbitrary property text", async () => {
  const r = server(), a = device(r); a.host.send = async () => { throw new Error(); }; await assert.rejects(a.client.push());
  const p = a.get().sync.pending; r.store.refusals[p.request.datasetId + p.request.requestId] = { requestHash: p.requestHash, secret: "PRIVATE_FIXTURE" };
  assert.throws(() => r.handle(p.request), /RECOVERY/); assert.equal(r.store.rows.length, 0);
});
(async () => { let passed = 0; for (const [name, fn] of tests) { try { await fn(); console.log("PASS " + name); passed++; } catch (e) { console.error("FAIL " + name); throw e; } } console.log(`${passed}/${tests.length} sync tests passed`); })().catch(e => { console.error(e.stack); process.exitCode = 1; });
