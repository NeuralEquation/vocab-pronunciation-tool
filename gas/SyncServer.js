/* HEAD is authoritative. Unreferenced files are never inferred to be commits. */
(function (root) {
  "use strict";
  function createServer(store) {
    const P = root.MWSyncProtocol, hash = value => store.hash(P.canonical(value));
    const empty = () => ({ schemaVersion: 3, ranges: [], studyLog: {} });
    const fail = () => { throw new Error("RECOVERY_REQUIRED"); };
    const genesis = datasetId => hash({ datasetId, genesis: true });
    function readState(initialize) {
      let head = store.getHead();
      if (!head) {
        if (store.hasGenerations() || !initialize) fail();
        const datasetId = store.id();
        if (!P.id(datasetId)) fail();
        head = { version: 2, datasetId, committedRevision: 0, committedHash: genesis(datasetId), generationFileId: "", storageId: store.storageId };
        store.setHead(head);
        if (P.canonical(store.getHead()) !== P.canonical(head)) fail();
      }
      if (head.version !== 2 || !P.id(head.datasetId) || !P.integer(head.committedRevision) || head.committedRevision > 1000 || !P.hash(head.committedHash) || head.storageId !== store.storageId) fail();
      const rows = [], seen = new Set();
      let fileId = head.generationFileId, expectedHash = head.committedHash;
      for (let revision = head.committedRevision; revision > 0; revision--) {
        if (!fileId || seen.has(fileId)) fail();
        seen.add(fileId);
        let row; try { row = store.read(fileId); } catch { fail(); }
        if (!row || row.datasetId !== head.datasetId || row.serverRevision !== revision || row.request?.baseRevision !== revision - 1 || row.request?.datasetId !== head.datasetId) fail();
        try { P.request(row.request); } catch { fail(); }
        const { checksum, ...body } = row;
        if (checksum !== expectedHash || checksum !== hash(body) || row.requestHash !== hash(row.request) || row.previousHash !== row.request.baseHash) fail();
        if (rows.some(r => r.request.requestId === row.request.requestId)) fail();
        rows.push(row); expectedHash = row.previousHash; fileId = row.previousFileId;
      }
      if (fileId !== "" || expectedHash !== genesis(head.datasetId)) fail();
      return { head, rows };
    }
    const info = state => ({ datasetId: state.head.datasetId, serverRevision: state.head.committedRevision, serverHash: state.head.committedHash });
    const receipt = row => ({ requestId: row.request.requestId, requestHash: row.requestHash, serverRevision: row.serverRevision, serverHash: row.checksum, payloadHash: hash(row.request.payload) });
    function rejected(state, requestId, requestHash, code) {
      const entry = { requestId, requestHash, code };
      store.setRejected(state.head.datasetId, requestId, entry);
      if (P.canonical(store.getRejected(state.head.datasetId, requestId)) !== P.canonical(entry)) fail();
      return { status: "rejected", ...info(state), ...entry };
    }
    function handle(request) {
      // Every return claiming rejection/commit is issued while holding the same lock.
      return store.lock(() => {
        P.request(request, [], true);
        const state = readState(request.op === "connect");
        if (request.op === "connect") { P.request(request); return { status: "ok", ...info(state), genesisHash: genesis(state.head.datasetId) }; }
        if (request.datasetId !== state.head.datasetId) return { status: "error", code: "DATASET_MISMATCH" };
        if (request.op === "pull") {
          P.request(request);
          const payload = state.rows[0]?.request.payload || empty();
          return { status: "ok", ...info(state), payload, payloadHash: hash(payload) };
        }
        const requestHash = request.op === "push" ? hash(request) : request.requestHash;
        const prior = state.rows.find(row => row.request.requestId === request.requestId);
        if (prior) {
          if (prior.requestHash !== requestHash) return { status: "error", code: "REQUEST_REUSED" };
          return { status: "committed", ...info(state), receipt: receipt(prior) };
        }
        const refusal = store.getRejected(request.datasetId, request.requestId);
        if (refusal) {
          if (Object.keys(refusal).sort().join(",") !== "code,requestHash,requestId" || refusal.requestId !== request.requestId || !P.hash(refusal.requestHash) || !["STALE_BASE", "CAPACITY", "MALFORMED", "NON_CANONICAL", "SECRET", "SIZE", "CANCELLED"].includes(refusal.code)) fail();
          if (refusal.requestHash !== requestHash) return { status: "error", code: "REQUEST_REUSED" };
          return { status: "rejected", ...info(state), ...refusal };
        }
        if (request.op !== "push") {
          P.request(request);
          if (request.op === "cancel") return rejected(state, request.requestId, requestHash, "CANCELLED");
          return { status: "not_committed", ...info(state), requestId: request.requestId, requestHash };
        }
        try { P.request(request); }
        catch (e) { return rejected(state, request.requestId, requestHash, ["MALFORMED", "NON_CANONICAL", "SECRET", "SIZE"].includes(e.message) ? e.message : "MALFORMED"); }
        if (request.baseRevision !== state.head.committedRevision || request.baseHash !== state.head.committedHash) return rejected(state, request.requestId, requestHash, "STALE_BASE");
        if (state.head.committedRevision >= (store.capacity || 1000)) return rejected(state, request.requestId, requestHash, "CAPACITY");
        const body = { datasetId: request.datasetId, serverRevision: state.head.committedRevision + 1, previousFileId: state.head.generationFileId, previousHash: state.head.committedHash, requestHash, request };
        const generation = { ...body, checksum: hash(body) };
        const fileId = store.append(generation); // May leave an orphan on ANY subsequent failure.
        if (!fileId || P.canonical(store.read(fileId)) !== P.canonical(generation)) fail();
        const nextHead = { ...state.head, committedRevision: generation.serverRevision, committedHash: generation.checksum, generationFileId: fileId };
        store.setHead(nextHead); // COMMIT POINT; ambiguous failure must retain client's unknown pending.
        if (P.canonical(store.getHead()) !== P.canonical(nextHead)) fail();
        return { status: "committed", ...info({ head: nextHead }), receipt: receipt(generation) };
      });
    }
    return { handle };
  }
  root.MWSyncServer = Object.freeze({ createServer });
})(globalThis);
