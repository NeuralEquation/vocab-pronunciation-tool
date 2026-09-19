"use strict";
// Local packaging only. No clasp, credentials, network, deployment or Drive calls.
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const out = path.join(root, ".gas-build");
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace(/<link[^>]+(?:manifest|icon\.png)[^>]*>/g, "");
html = html.replace(/<link rel="stylesheet" href="styles\.css\?v=\d+">/, () => `<style>${fs.readFileSync(path.join(root, "styles.css"), "utf8")}</style>`);
html = html.replace(/<script defer src="(js\/[a-z-]+\.js)\?v=\d+"><\/script>/g, (_, file) => `<script>${fs.readFileSync(path.join(root, file), "utf8").replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace("<head>", '<head><base target="_top"><script>window.MW_GAS_HOST = true;</script>');
fs.writeFileSync(path.join(out, "Index.html"), html);
for (const file of ["Code.gs", "appsscript.json"]) fs.copyFileSync(path.join(root, "gas", file), path.join(out, file));
// Prefixes make the shared protocol initialize before server logic in the GAS project.
fs.copyFileSync(path.join(root, "js/sync-protocol.js"), path.join(out, "00_Protocol.gs"));
fs.copyFileSync(path.join(root, "gas/SyncServer.js"), path.join(out, "01_Server.gs"));
console.log("GAS package written locally to .gas-build; nothing uploaded or deployed.");
