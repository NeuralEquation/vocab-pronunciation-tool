"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const contents = [], events = []; let active = "owner@example.invalid", effective = active, locked = false;
const properties = { ALLOWED_USER_EMAIL: active, SYNC_FOLDER_ID: "fixture-folder" };
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties[k], setProperty: (k, v) => { assert.equal(locked, true); properties[k] = v; events.push(k === "SYNC_HEAD_V2" ? "head" : "rejection"); } }) },
  Session: { getActiveUser: () => ({ getEmail: () => active }), getEffectiveUser: () => ({ getEmail: () => effective }) },
  Utilities: { getUuid: () => crypto.randomUUID(), DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" }, computeDigest: (_, s) => [...crypto.createHash("sha256").update(s).digest()] },
  LockService: { getScriptLock: () => ({ tryLock: () => { events.push("lock"); locked = true; return true; }, releaseLock: () => { events.push("unlock"); locked = false; } }) },
  DriveApp: { getFileById: id => {
    assert.equal(locked, true); events.push("read"); const file = contents[Number(id.slice(1))]; if (!file) throw new Error("missing");
    return { getId: () => id, isTrashed: () => false, getParents: () => { let once = true; return { hasNext: () => once, next: () => { once = false; return { getId: () => "fixture-folder" }; } }; }, getSize: () => file.text.length, getBlob: () => ({ getDataAsString: () => file.text }) };
  }, getFolderById: id => {
    assert.equal(id, "fixture-folder"); assert.equal(locked, true);
    return { getFiles: () => { let i = 0; return { hasNext: () => i < contents.length, next: () => { const f = contents[i++]; return { getName: () => f.name, getSize: () => f.text.length, getBlob: () => ({ getDataAsString: () => f.text }) }; } }; },
      createFile: (name, text) => { assert.equal(locked, true); contents.push({ name, text }); events.push("append"); return { getId: () => "f" + (contents.length - 1) }; } };
  } },
  MimeType: { PLAIN_TEXT: "text/plain" },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
  HtmlService: { createHtmlOutputFromFile: name => ({ name, setTitle() { return this; } }), createHtmlOutput: text => ({ text }) },
  // Any accidental body/exception logging must fail the fixture.
  console: { log: () => assert.fail("logging prohibited"), error: () => assert.fail("logging prohibited") }, Logger: { log: () => assert.fail("logging prohibited") }
};
vm.createContext(ctx);
// Exercise independence from GAS file initialization ordering.
for (const file of ["gas/SyncServer.js", "js/sync-protocol.js", "js/storage.js", "gas/Code.gs"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx);
const connected = ctx.syncRequest({ protocol: 2, op: "connect" });
assert.equal(connected.status, "ok");
events.length = 0;
const request = { protocol: 2, op: "push", datasetId: connected.datasetId, baseHash: connected.genesisHash, requestId: crypto.randomUUID().replace(/-/g, ""), baseRevision: 0, payload: { schemaVersion: 3, ranges: [], studyLog: {} } };
assert.equal(ctx.syncRequest(request).status, "committed");
assert.deepEqual(events, ["lock", "append", "read", "head", "unlock"]);
assert.equal(ctx.syncRequest(request).serverRevision, 1); assert.equal(contents.length, 1);
assert.equal(ctx.syncRequest({ protocol: 2, op: "pull", datasetId: connected.datasetId }).serverRevision, 1);
assert.equal(ctx.doGet().name, "Index");
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(request) } }).text).status, "committed");
const before = JSON.stringify(contents), beforeEvents = events.length;
active = "attacker@example.invalid";
assert.equal(ctx.syncRequest(request).code, "ACCESS_DENIED"); assert.equal(events.length, beforeEvents);
assert.match(ctx.doGet().text, /許可/);
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(request) } }).text).status, "error");
active = properties.ALLOWED_USER_EMAIL; effective = "other@example.invalid";
assert.equal(ctx.syncRequest(request).code, "ACCESS_DENIED");
effective = active;
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: "{broken" } }).text).status, "error");
assert.equal(JSON.stringify(contents), before); assert.equal(locked, false);
assert.equal(fs.readFileSync(path.join(root, "gas/appsscript.json"), "utf8").includes('"MYSELF"'), true);
console.log("PASS GAS adapter fixture: authorization, LockService, immutable Drive generations, idempotency, doPost and no logs (mock services only)");
