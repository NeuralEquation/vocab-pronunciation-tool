/* Pure transaction logic. The adapter supplies a lock, immutable generation store and SHA-256. */
(function (root) {
  "use strict";
  const empty = () => ({ schemaVersion: 3, ranges: [], studyLog: {} });
  function createServer(store) {
    const P = root.MWSyncProtocol;
    const hash = value => store.hash(P.canonical(value));
    function history() {
      const rows = store.list();
      if (rows.length > 1000) throw new Error("CAPACITY");
      rows.sort((a, b) => a.serverRevision - b.serverRevision);
      let previous = "";
      const ids = new Set();
      rows.forEach((row, i) => {
        if (!row || row.serverRevision !== i + 1 || row.previousHash !== previous || ids.has(row.request?.requestId) || row.request?.baseRevision !== i) throw new Error("RECOVERY");
        P.request(row.request);
        if (row.request.op !== "push" || row.requestHash !== hash(row.request)) throw new Error("RECOVERY");
        const { checksum, ...body } = row;
        if (checksum !== hash(body)) throw new Error("RECOVERY");
        ids.add(row.request.requestId); previous = checksum;
      });
      return rows;
    }
    function handle(request) {
      // Validation occurs again on the server; callers cannot bypass the browser allowlist.
      P.request(request);
      return store.lock(() => {
        const rows = history(), head = rows[rows.length - 1];
        const serverRevision = head?.serverRevision || 0;
        if (request.op === "pull") return { status: "ok", serverRevision, payload: head?.request.payload || empty() };
        const requestHash = hash(request);
        const prior = rows.find(row => row.request.requestId === request.requestId);
        if (prior) {
          if (prior.requestHash !== requestHash) throw new Error("REQUEST_REUSED");
          return { status: "ok", serverRevision: prior.serverRevision, requestId: request.requestId };
        }
        if (request.baseRevision !== serverRevision) return { status: "conflict", serverRevision };
        if (rows.length >= 1000) throw new Error("CAPACITY");
        const body = { serverRevision: serverRevision + 1, previousHash: head?.checksum || "", requestHash, request };
        const generation = { ...body, checksum: hash(body) };
        // A complete new generation is the commit; no mutable pointer or multi-file overwrite.
        // If create succeeds but its acknowledgement is lost, next request finds this requestId.
        store.append(generation);
        const verified = history();
        if (verified.length !== serverRevision + 1 || verified[verified.length - 1].checksum !== generation.checksum) throw new Error("RECOVERY");
        return { status: "ok", serverRevision: generation.serverRevision, requestId: request.requestId };
      });
    }
    return { handle };
  }
  root.MWSyncServer = Object.freeze({ createServer });
})(globalThis);
