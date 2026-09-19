"use strict";
// Same safety assertions can run against the pre-fix commit, without checking it out.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto"), cp = require("node:child_process");
const root = path.resolve(__dirname, ".."), ref = process.env.MW_AUDIT_REF;
const ctx = { crypto: crypto.webcrypto, TextEncoder, URL, Blob }; ctx.window = ctx; vm.createContext(ctx);
for (const file of ["js/storage.js", "js/sync-protocol.js", "js/sync.js", "gas/SyncServer.js"]) vm.runInContext(ref ? cp.execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8" }) : fs.readFileSync(path.join(root, file), "utf8"), ctx);
const S = ctx.MWSync, P = ctx.MWSyncProtocol, v2 = typeof P.digest === "function", copy = x => JSON.parse(JSON.stringify(x));
const id = () => crypto.randomUUID().replace(/-/g, ""), hash = s => crypto.createHash("sha256").update(s).digest("hex");
const payload = () => S.project({ ranges: [{ id: "r", words: [{ id: "w", word: "record" }] }], studyLog: {} });
function remote() {
  const store = { storageId: "fixture", rows: [], head: null, rejects: {}, id, hash, lock: fn => fn(), list() { return copy(this.rows); }, hasGenerations() { return this.rows.length > 0; }, getHead() { return this.head; }, setHead(h) { this.head = copy(h); }, read(i) { return this.rows[+i]; }, append(g) { this.rows.push(copy(g)); return String(this.rows.length - 1); }, getRejected(d, r) { return this.rejects[d+r]; }, setRejected(d,r,e) { this.rejects[d+r] = copy(e); } };
  return { store, handle: ctx.MWSyncServer.createServer(store).handle };
}
function device(r) {
  let record = { data: payload(), sync: S.initial(0, true), revision: 0, hasData: true };
  if (v2) { const c = r.handle({ protocol: 2, op: "connect" }); Object.assign(record.sync, { datasetId: c.datasetId, baseHash: c.genesisHash, serverHash: c.serverHash, serverRevision: c.serverRevision }); }
  const host = { sent: 0, secrets: () => [], id, read: () => copy(record), write(data,sync) { record = { ...record, data: copy(data), sync: copy(sync) }; }, send: async req => { host.sent++; return r.handle(req); }, status() {}, applied() {}, archive() {} };
  return { host, client: S.createClient(host), get: () => record, edit() { record.sync = S.changed(record.sync); } };
}
const tests = [
 ["H1 known secret in requestId must never leave browser", async () => { const d = device(remote()), secret = id(); d.host.id = () => secret; d.host.secrets = () => [secret]; try { await d.client.push(); } catch {} assert.equal(d.host.sent, 0); }],
 ["H2 missing latest generation must stop reads", async () => { const r = remote(), d = device(r); await d.client.push(); r.store.rows.pop(); assert.throws(() => r.handle(v2 ? { protocol: 2, op: "pull", datasetId: r.store.head.datasetId } : { protocol: 1, op: "pull" })); }],
 ["H3 another dataset at equal revision must reject write", async () => { const r = remote(), r2 = remote(), a = device(r), b = device(r2); await a.client.push(); await b.client.push(); a.edit(); a.host.send = async req => r2.handle(req); try { await a.client.push(); } catch {} assert.equal(r2.store.rows.length, 1); }],
 ["H4 definitive refusal must support archived pending release", async () => { const r = remote(), a = device(r); await a.client.push(); a.edit(); a.host.send = async req => v2 ? { status: "rejected", datasetId: r.store.head.datasetId, serverRevision: 1, serverHash: r.store.head.committedHash, requestId: req.requestId, requestHash: await P.digest(req), code: "CAPACITY" } : { status: "error", code: "CAPACITY" }; try { await a.client.push(); } catch {} assert.equal(typeof a.client.clearRejected, "function"); await a.client.clearRejected(); assert.equal(a.get().sync.pending, null); }],
 ["H5 corrupt sync metadata must not prevent local changes", () => { assert.doesNotThrow(() => S.changed({ version: 1 })); }],
 ["M1 31 meanings cannot be accepted as canonical", () => { const p = payload(); p.ranges[0].words[0].meaningsJa = Array.from({length:31}, (_,i) => String(i)); assert.throws(() => P.validate(p)); }],
 ["M2 free text cannot carry GAS endpoint", () => { const p = payload(); p.ranges[0].rangeName = "https://script.google.com/macros/s/fixture/exec"; assert.throws(() => P.validate(p)); }],
 ["L1 dirty=false alone cannot mean cloud verified", async () => { const d = device(remote()); d.get().sync = S.initial(0, false); const result = await d.client.push(); assert.equal(result, "disconnected"); }]
];
(async () => { let failures = 0; for (const [name, fn] of tests) { try { await fn(); console.log("PASS " + name); } catch { failures++; console.log("FAIL " + name); } } console.log(`${tests.length-failures}/${tests.length} independent safety contracts passed (${ref || "working tree"})`); process.exitCode = failures ? 1 : 0; })();
