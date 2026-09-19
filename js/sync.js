(function (root) {
  "use strict";
  const P = root.MWSyncProtocol;
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = code => { throw new Error(code); };
  function initial(revision = 0, dirty = true) {
    if (!P.integer(revision) || typeof dirty !== "boolean") fail("RECOVERY");
    return { version: 1, serverRevision: 0, baseRevision: 0, localRevision: revision, dirty, requestId: null, pending: null, conflict: false };
  }
  function metadata(value, revision = 0, dirty = true) {
    if (value == null) return initial(revision, dirty);
    if (value.version !== 1 || ![value.serverRevision, value.baseRevision, value.localRevision].every(P.integer) || typeof value.dirty !== "boolean" || typeof value.conflict !== "boolean" || value.baseRevision > value.serverRevision) fail("RECOVERY");
    if (value.pending) {
      P.request(value.pending.request);
      if (value.requestId !== value.pending.request.requestId || value.pending.request.op !== "push" || !P.integer(value.pending.localRevision) || value.pending.localRevision > value.localRevision || !value.dirty || value.pending.request.baseRevision !== value.baseRevision) fail("RECOVERY");
    } else if (value.requestId !== null) fail("RECOVERY");
    return clone(value);
  }
  function changed(value, revision = 0) {
    const next = metadata(value, revision);
    next.localRevision++; next.dirty = true;
    if (!P.integer(next.localRevision)) fail("RECOVERY");
    return next;
  }
  function project(data, secrets) {
    let backup;
    try { backup = root.MWStorage.createBackup(data, "2000-01-01T00:00:00.000Z", secrets); }
    catch (error) { fail(/秘密情報/.test(error.message) ? "SECRET" : "MALFORMED"); }
    return P.validate({ schemaVersion: 3, ranges: backup.ranges, studyLog: backup.studyLog }, secrets);
  }
  // The host writes data and metadata together in ONE primary localStorage value.
  function createClient(host) {
    let busy = false;
    const checkError = response => {
      if (response?.status === "error") throw new Error(["RECOVERY", "MALFORMED", "SECRET", "SIZE"].includes(response.code) ? response.code : "SERVER");
    };
    const run = async action => {
      if (busy) fail("BUSY");
      busy = true; host.status("syncing");
      try { const result = await action(); host.status(result); return result; }
      catch (error) { host.status(["SECRET", "MALFORMED", "RECOVERY", "SIZE"].includes(error.message) ? error.message.toLowerCase() : "error"); throw new Error(["SECRET", "MALFORMED", "RECOVERY", "SIZE"].includes(error.message) ? error.message : "SYNC_FAILED"); }
      finally { busy = false; }
    };
    const read = () => { const value = host.read(); return { ...value, sync: metadata(value.sync, value.revision, value.hasData) }; };
    async function push() {
      return run(async () => {
        let before = read(), sync = before.sync;
        if (sync.conflict) return "conflict";
        if (!sync.dirty && !sync.pending) return "synced";
        if (!sync.pending) {
          const payload = project(before.data, host.secrets());
          sync.requestId = host.id();
          sync.pending = { localRevision: sync.localRevision, request: { protocol: 1, op: "push", requestId: sync.requestId, baseRevision: sync.baseRevision, payload } };
          P.request(sync.pending.request);
          host.write(before.data, sync, false); // Durable outbox BEFORE sending.
        }
        // Re-scan even persisted outbox when credentials changed since the first attempt.
        P.validate(sync.pending.request.payload, host.secrets());
        const response = await host.send(clone(sync.pending.request));
        checkError(response);
        const now = read();
        if (now.sync.requestId !== sync.requestId) fail("RECOVERY");
        if (!P.integer(response?.serverRevision)) fail("MALFORMED");
        if (response.status === "conflict") {
          if (response.serverRevision <= sync.baseRevision) fail("RECOVERY");
          now.sync.serverRevision = response.serverRevision; now.sync.conflict = true;
          now.sync.pending = null; now.sync.requestId = null;
          host.write(now.data, now.sync, false); return "conflict";
        }
        if (response.status !== "ok" || response.requestId !== sync.requestId || response.serverRevision !== sync.baseRevision + 1) fail("MALFORMED");
        now.sync.serverRevision = response.serverRevision; now.sync.baseRevision = response.serverRevision;
        now.sync.dirty = now.sync.localRevision !== sync.pending.localRevision;
        now.sync.pending = null; now.sync.requestId = null; now.sync.conflict = false;
        host.write(now.data, now.sync, false);
        return now.sync.dirty ? "dirty" : "synced";
      });
    }
    // Resolution is explicit; never merge. A new change during the read prevents replacement.
    async function pull(choice = "safe") {
      return run(async () => {
        const before = read();
        if (before.sync.pending) fail("RECOVERY"); // Resolve uncertain push by retry first.
        const response = await host.send({ protocol: 1, op: "pull" });
        checkError(response);
        if (response?.status !== "ok" || !P.integer(response.serverRevision)) fail("MALFORMED");
        P.validate(response.payload, host.secrets());
        const now = read();
        if (host.canApply?.() === false || now.sync.localRevision !== before.sync.localRevision || P.canonical(project(now.data, host.secrets())) !== P.canonical(project(before.data, host.secrets()))) return "changed";
        if (response.serverRevision < now.sync.baseRevision) fail("RECOVERY");
        const sync = now.sync; sync.serverRevision = response.serverRevision;
        if (choice === "local") {
          host.write(now.data, { ...sync, baseRevision: response.serverRevision, conflict: false, dirty: true }, true);
          return "dirty"; // User must explicitly push; server CAS still applies.
        }
        if (sync.dirty && choice !== "remote") {
          sync.conflict = true; host.write(now.data, sync, false); return "conflict";
        }
        if (!["safe", "remote"].includes(choice)) fail("MALFORMED");
        const data = { ...now.data, ranges: response.payload.ranges, studyLog: response.payload.studyLog };
        host.write(data, { ...sync, baseRevision: response.serverRevision, localRevision: sync.localRevision + 1, dirty: false, conflict: false }, true);
        host.applied(); return "synced";
      });
    }
    return { push, pull, isBusy: () => busy };
  }
  function transport(endpoint, environment = root, timeoutMs = 30000) {
    return request => new Promise((resolve, reject) => {
      P.request(request);
      let settled = false;
      const controller = new AbortController();
      const finish = (error, value) => { if (settled) return; settled = true; environment.clearTimeout(timer); error ? reject(new Error("NETWORK")) : resolve(value); };
      const timer = environment.setTimeout(() => { controller.abort(); finish(true); }, timeoutMs);
      if (environment.google?.script?.run) {
        environment.google.script.run.withSuccessHandler(value => finish(false, value)).withFailureHandler(() => finish(true)).syncRequest(request);
      } else {
        if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint)) { finish(true); return; }
        environment.fetch(endpoint, { method: "POST", credentials: "include", redirect: "follow", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(request), signal: controller.signal })
          .then(response => { if (!response.ok) throw new Error(); return response.text(); })
          .then(text => { if (text.length > P.MAX_CHARS + 1024) throw new Error(); finish(false, JSON.parse(text)); }).catch(() => finish(true));
      }
    });
  }
  root.MWSync = Object.freeze({ initial, metadata, changed, project, createClient, transport });
})(typeof window !== "undefined" ? window : globalThis);
