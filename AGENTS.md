# Repository guardrails

- Do not delete user files or stored-data fields as part of a migration. Validate and migrate older backups before committing a new main value.
- Never add Merriam-Webster API keys, passwords, tokens, exported study data, or browser profiles to source control.
- Serve the app over local HTTP for browser/PWA checks. Do not use `file://` as PWA evidence.

## Architecture and ownership

- `js/storage.js` owns schema validation, migration, import planning, and backup normalization.
- `js/content.js` owns example, phrase, and memorization recall state.
- `js/test.js` owns question generation, direction statistics, spelling grading, Speed Review sessions, and word-readiness rules.
- `js/app.js` is the UI/state coordinator and the only browser-localStorage writer for normal app flows.
- Keep the script order in `index.html`: storage, content, test, app.

## Critical invariants

- English-to-Japanese and Japanese-to-English evidence are independent.
- A word is not ready from same-day repetitions alone. Each direction and spelling need successful evidence on two dates, a recent fast/certain result, and later-day recovery after a lapse.
- Wrong and test-ready sessions may contain fewer than 15 questions; normal tests require 15 buildable questions.
- Every multiple-choice question has four unique choices and a balanced, non-patterned correct position.
- Speed Review persists only to `speedStats`; it may affect question priority/readiness but must not write ordinary test scores or mutate the manual `hard` flag.
- API keys stay outside schema backups and exports.
- Append/replace imports are validation-first and main-data writes are transactional with a pre-import recovery point.

## Verification

Run:

```powershell
npm test
```

For a browser regression, start a local HTTP server and then run `npm run test:browser`. The browser check requires Playwright or the bundled Codex browser runtime and verifies registration, normal/wrong/reverse tests, Speed Review, spelling, recall, backup replacement/restore, service-worker control, and offline save/reload.

When app-shell files change, update the query versions in `index.html`, `APP_SHELL`, and `CACHE_NAME` in `sw.js` together. Automated checks do not replace a visible localhost/mobile/desktop review.

