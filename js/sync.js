(function (root) {
  "use strict";
  const P = root.MWSyncProtocol, clone = value => JSON.parse(JSON.stringify(value));
  const fail = code => { throw new Error(code); };
  function initial(revision = 0, dirty = true) {
    if (!P.integer(revision) || typeof dirty !== "boolean") fail("RECOVERY_REQUIRED");
    return { version: 2, state: "active", datasetId: null, serverRevision: 0, serverHash: null, baseRevision: 0, baseHash: null, localRevision: revision, dirty, verified: false, requestId: null, pending: null, conflict: false };
  }
  function metadata(value, revision = 0, dirty = true) {
    if (value == null) return initial(revision, dirty);
    if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(initial(), k))) fail("RECOVERY_REQUIRED");
    if (value.version !== 2 || !["active", "recovery-required", "dataset-mismatch"].includes(value.state) || ![value.serverRevision, value.baseRevision, value.localRevision].every(P.integer) || typeof value.dirty !== "boolean" || typeof value.verified !== "boolean" || typeof value.conflict !== "boolean" || value.baseRevision > value.serverRevision) fail("RECOVERY_REQUIRED");
    if (value.datasetId !== null && (!P.id(value.datasetId) || !P.hash(value.baseHash) || !P.hash(value.serverHash))) fail("RECOVERY_REQUIRED");
    if (value.datasetId === null && (value.baseRevision || value.serverRevision || value.baseHash !== null || value.serverHash !== null || value.pending || value.verified)) fail("RECOVERY_REQUIRED");
    if (value.pending) {
      const p = value.pending;
      if (Object.keys(p).some(k => !["state", "localRevision", "request", "requestHash", "code", "receipt"].includes(k))) fail("RECOVERY_REQUIRED");
      if (p.state === "rejected" && !["STALE_BASE", "CAPACITY", "MALFORMED", "NON_CANONICAL", "SECRET", "SIZE", "CANCELLED"].includes(p.code)) fail("RECOVERY_REQUIRED");
      P.request(p.request); // Includes strict ID and canonical payload, also on reload.
      if (!["unknown", "rejected", "committed"].includes(p.state) || !P.hash(p.requestHash) || value.requestId !== p.request.requestId || p.request.op !== "push" || p.request.datasetId !== value.datasetId || !P.integer(p.localRevision) || p.localRevision > value.localRevision || !value.dirty || p.request.baseRevision !== value.baseRevision || p.request.baseHash !== value.baseHash) fail("RECOVERY_REQUIRED");
    } else if (value.requestId !== null) fail("RECOVERY_REQUIRED");
    if (value.verified && (value.dirty || !value.datasetId || value.baseRevision !== value.serverRevision || value.baseHash !== value.serverHash || value.pending)) fail("RECOVERY_REQUIRED");
    return clone(value);
  }
  function inspect(value, revision = 0, dirty = true) {
    try { return { sync: metadata(value, revision, dirty), quarantine: false }; }
    catch { return { sync: { ...initial(P.integer(revision) ? revision : 0, true), state: "recovery-required" }, quarantine: true }; }
  }
  function changed(value, revision = 0) {
    const next = inspect(value, revision).sync;
    if (next.localRevision >= Number.MAX_SAFE_INTEGER) return { ...initial(0, true), state: "recovery-required" };
    next.localRevision++; next.dirty = true; next.verified = false; return next;
  }
  function project(data, secrets = []) {
    let payload;
    try { payload = P.normalize(data); } catch (e) { if (/秘密|SECRET/.test(e.message)) fail("SECRET"); fail("NON_CANONICAL"); }
    return P.validate(payload, secrets);
  }
  function display(sync) {
    if (sync.state !== "active") return sync.state;
    if (sync.pending) return sync.pending.state;
    if (sync.conflict) return "conflict";
    if (!sync.datasetId) return "disconnected";
    return sync.dirty ? "dirty" : sync.verified ? "verified" : "local-clean";
  }
  function createClient(host) {
    let busy = false;
    const read = (recovery = false) => {
      const value = host.read(), checked = inspect(value.sync, value.revision, value.hasData);
      if (!recovery && (checked.quarantine || checked.sync.state !== "active")) fail("RECOVERY_REQUIRED");
      return { ...value, sync: checked.sync };
    };
    const run = async fn => {
      if (busy) fail("BUSY"); busy = true; host.status("syncing");
      try { const result = await fn(); host.status(result); return result; }
      catch (e) { const code = ["SECRET", "MALFORMED", "NON_CANONICAL", "RECOVERY_REQUIRED", "DATASET_MISMATCH", "SIZE"].includes(e.message) ? e.message : "SYNC_FAILED"; host.status(code); throw new Error(code); }
      finally { busy = false; }
    };
    function head(response, sync) {
      if (response?.status === "error") fail(response.code);
      if (!P.id(response?.datasetId) || !P.integer(response.serverRevision) || !P.hash(response.serverHash)) fail("MALFORMED");
      if (sync.datasetId && response.datasetId !== sync.datasetId) fail("DATASET_MISMATCH");
      if (sync.datasetId && (response.serverRevision < sync.baseRevision || (response.serverRevision === sync.baseRevision && response.serverHash !== sync.baseHash))) fail("RECOVERY_REQUIRED");
    }
    async function send(request) {
      P.request(request, host.secrets()); // Last check immediately before each transport, including status/retry.
      return host.send(clone(request));
    }
    async function consume(response, pending) {
      let now = read();
      if (now.sync.requestId !== pending.request.requestId) fail("RECOVERY_REQUIRED");
      if (response?.code === "DATASET_MISMATCH") {
        now.sync.state = "dataset-mismatch"; now.sync.verified = false; host.write(now.data, now.sync, false); fail("DATASET_MISMATCH");
      }
      head(response, now.sync);
      if (response.status === "committed") {
        const receipt = response.receipt;
        if (receipt?.requestId !== pending.request.requestId || receipt.requestHash !== pending.requestHash || receipt.serverRevision !== pending.request.baseRevision + 1 || !P.hash(receipt.serverHash) || receipt.payloadHash !== await P.digest(pending.request.payload) || receipt.serverRevision > response.serverRevision || (receipt.serverRevision === response.serverRevision && receipt.serverHash !== response.serverHash)) fail("MALFORMED");
        now = read();
        now.sync.pending = { ...pending, state: "committed", receipt };
        host.write(now.data, now.sync, false); // Preserve acknowledged state if final local save fails.
        const same = P.canonical(project(now.data, host.secrets())) === P.canonical(pending.request.payload);
        const sync = { ...now.sync, baseRevision: receipt.serverRevision, baseHash: receipt.serverHash, serverRevision: response.serverRevision, serverHash: response.serverHash, dirty: now.sync.localRevision !== pending.localRevision || !same, pending: null, requestId: null, conflict: false };
        sync.verified = !sync.dirty && sync.baseRevision === sync.serverRevision && sync.baseHash === sync.serverHash;
        host.write(now.data, sync, false); return display(sync);
      }
      if (!["rejected", "not_committed"].includes(response.status) || response.requestId !== pending.request.requestId || response.requestHash !== pending.requestHash) fail("MALFORMED");
      now.sync.serverRevision = response.serverRevision; now.sync.serverHash = response.serverHash; now.sync.verified = false;
      if (response.status === "rejected") {
        if (!["STALE_BASE", "CAPACITY", "MALFORMED", "NON_CANONICAL", "SECRET", "SIZE", "CANCELLED"].includes(response.code)) fail("MALFORMED");
        now.sync.pending = { ...pending, state: "rejected", code: response.code };
        now.sync.conflict = response.code === "STALE_BASE";
        host.write(now.data, now.sync, false); return "rejected";
      }
      host.write(now.data, now.sync, false); return "unknown"; // Not committed NOW does not cancel a delayed request.
    }
    async function connect(recovery = false) {
      return run(async () => {
        const before = read(recovery);
        if (before.sync.pending && !recovery) fail("RECOVERY_REQUIRED");
        const response = await send({ protocol: 2, op: "connect" });
        const now = read(recovery);
        if (now.sync.localRevision !== before.sync.localRevision) return "changed";
        head(response, initial());
        if (response.status !== "ok" || !P.hash(response.genesisHash)) fail("MALFORMED");
        if (!recovery && now.sync.datasetId && now.sync.datasetId !== response.datasetId) fail("DATASET_MISMATCH");
        if (recovery) host.archive("reconnect", before); // Explicit confirmation only. Never automatic.
        const sync = { ...initial(now.sync.localRevision, recovery || now.sync.dirty), datasetId: response.datasetId, baseHash: response.genesisHash, serverHash: response.serverHash, serverRevision: response.serverRevision };
        if (!recovery && now.sync.datasetId === response.datasetId) Object.assign(sync, now.sync, { verified: false });
        host.write(now.data, sync, false); return display(sync);
      });
    }
    async function push() {
      return run(async () => {
        let before = read(), sync = before.sync;
        if (!sync.datasetId) return "disconnected";
        if (sync.pending?.state === "rejected") return "rejected";
        if (sync.conflict && !sync.pending) return "conflict";
        if (!sync.dirty && !sync.pending) return "local-clean";
        if (!sync.pending) {
          const request = { protocol: 2, op: "push", datasetId: sync.datasetId, requestId: host.id(), baseRevision: sync.baseRevision, baseHash: sync.baseHash, payload: project(before.data, host.secrets()) };
          P.request(request, host.secrets()); const requestHash = await P.digest(request);
          const now = read();
          if (now.sync.localRevision !== sync.localRevision) return "changed";
          sync.pending = { state: "unknown", localRevision: sync.localRevision, request, requestHash }; sync.requestId = request.requestId; sync.verified = false;
          host.write(now.data, sync, false);
        }
        if (await P.digest(sync.pending.request) !== sync.pending.requestHash) fail("RECOVERY_REQUIRED");
        return consume(await send(sync.pending.request), sync.pending);
      });
    }
    async function status(cancel = false) {
      return run(async () => {
        const before = read(), p = before.sync.pending;
        if (!p) return display(before.sync);
        return consume(await send({ protocol: 2, op: cancel ? "cancel" : "status", datasetId: before.sync.datasetId, requestId: p.request.requestId, requestHash: p.requestHash }), p);
      });
    }
    async function clearRejected() {
      return run(async () => {
        const now = read(); if (now.sync.pending?.state !== "rejected") fail("RECOVERY_REQUIRED");
        host.archive("rejected", now.sync.pending); // Required before clearing; quota failure leaves pending intact.
        const sync = { ...now.sync, pending: null, requestId: null, dirty: true, verified: false };
        host.write(now.data, sync, false); return display(sync);
      });
    }
    async function pull(choice = "safe") {
      return run(async () => {
        const before = read(); if (!before.sync.datasetId) return "disconnected";
        if (before.sync.pending) fail("RECOVERY_REQUIRED");
        const response = await send({ protocol: 2, op: "pull", datasetId: before.sync.datasetId });
        if (response?.code === "DATASET_MISMATCH") { const now = read(); now.sync.state = "dataset-mismatch"; host.write(now.data, now.sync, false); fail("DATASET_MISMATCH"); }
        head(response, before.sync); if (response.status !== "ok") fail("MALFORMED"); P.validate(response.payload, host.secrets());
        if (response.payloadHash !== await P.digest(response.payload)) fail("MALFORMED");
        const now = read();
        if (host.canApply?.() === false || now.sync.localRevision !== before.sync.localRevision || P.canonical(project(now.data, host.secrets())) !== P.canonical(project(before.data, host.secrets()))) return "changed";
        const sync = { ...now.sync, serverRevision: response.serverRevision, serverHash: response.serverHash, verified: false };
        if (choice === "local") { host.write(now.data, { ...sync, baseRevision: response.serverRevision, baseHash: response.serverHash, conflict: false, dirty: true }, true); return "dirty"; }
        if (sync.dirty && choice !== "remote") { sync.conflict = true; host.write(now.data, sync, false); return "conflict"; }
        if (!["safe", "remote"].includes(choice) || sync.localRevision >= Number.MAX_SAFE_INTEGER) fail("RECOVERY_REQUIRED");
        const data = { ...now.data, ranges: response.payload.ranges, studyLog: response.payload.studyLog };
        if (P.canonical(project(data, host.secrets())) !== P.canonical(response.payload)) fail("NON_CANONICAL");
        host.write(data, { ...sync, baseRevision: response.serverRevision, baseHash: response.serverHash, localRevision: sync.localRevision + 1, dirty: false, verified: true, conflict: false }, true);
        host.applied(); return "verified";
      });
    }
    return { connect, push, pull, status, clearRejected, isBusy: () => busy };
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
          .then(text => { if (text.length > P.MAX_CHARS + 4096) throw new Error(); finish(false, JSON.parse(text)); }).catch(() => finish(true));
      }
    });
  }
  root.MWSync = Object.freeze({ initial, metadata, inspect, changed, project, display, createClient, transport });
})(typeof window !== "undefined" ? window : globalThis);
