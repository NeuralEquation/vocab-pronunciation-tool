"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), crypto = require("node:crypto"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const contents = [], events = []; let active = "owner@example.invalid", effective = active, locked = false;
const properties = { ALLOWED_USER_EMAIL: active, SYNC_FOLDER_ID: "fixture-folder" };
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties[k] }) },
  Session: { getActiveUser: () => ({ getEmail: () => active }), getEffectiveUser: () => ({ getEmail: () => effective }) },
  Utilities: { DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" }, computeDigest: (_, s) => [...crypto.createHash("sha256").update(s).digest()] },
  LockService: { getScriptLock: () => ({ tryLock: () => { events.push("lock"); locked = true; return true; }, releaseLock: () => { events.push("unlock"); locked = false; } }) },
  DriveApp: { getFolderById: id => {
    assert.equal(id, "fixture-folder"); assert.equal(locked, true);
    return { getFiles: () => { let i = 0; return { hasNext: () => i < contents.length, next: () => { const f = contents[i++]; return { getName: () => f.name, getSize: () => f.text.length, getBlob: () => ({ getDataAsString: () => f.text }) }; } }; },
      createFile: (name, text) => { assert.equal(locked, true); contents.push({ name, text }); events.push("append"); } };
  } },
  MimeType: { PLAIN_TEXT: "text/plain" },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: text => ({ text, setMimeType() { return this; } }) },
  HtmlService: { createHtmlOutputFromFile: name => ({ name, setTitle() { return this; } }), createHtmlOutput: text => ({ text }) },
  // Any accidental body/exception logging must fail the fixture.
  console: { log: () => assert.fail("logging prohibited"), error: () => assert.fail("logging prohibited") }, Logger: { log: () => assert.fail("logging prohibited") }
};
vm.createContext(ctx);
// Exercise independence from GAS file initialization ordering.
for (const file of ["gas/SyncServer.js", "js/sync-protocol.js", "gas/Code.gs"]) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), ctx);
const request = { protocol: 1, op: "push", requestId: "adapter_fixture_1234", baseRevision: 0, payload: { schemaVersion: 3, ranges: [], studyLog: {} } };
assert.equal(ctx.syncRequest(request).status, "ok");
assert.equal(ctx.syncRequest(request).serverRevision, 1); assert.equal(contents.length, 1);
assert.equal(ctx.syncRequest({ protocol: 1, op: "pull" }).serverRevision, 1);
assert.equal(ctx.doGet().name, "Index");
assert.equal(JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(request) } }).text).status, "ok");
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
