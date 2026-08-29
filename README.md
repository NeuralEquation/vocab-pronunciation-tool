
# Merriam-Webster Pronunciation Checker

A PWA for checking pronunciation, parts of speech, and short definitions with the Merriam-Webster Learner's Dictionary API before vocabulary quizzes based on *Sokudoku Eitango*, a Japanese English vocabulary book.

## Using with GitHub Pages

1. Upload the files in this folder to a GitHub repository.
2. Enable GitHub Pages.
3. Open the published URL on your smartphone and add it to your home screen.
4. Enter your API key directly on the smartphone screen.

## About the API Key

* The API key is not included in this repository.
* The API key is not written in the code or in any sample file.
* The API key is not included in JSON or CSV exports.
* Demo mode is enabled by default, so simply opening the page does not send any API requests.

## PWA Notes

The service worker only caches the app files. Merriam-Webster API responses and audio files are not stored in the PWA cache.

## Vocabulary, Examples, and Phrases

Choose **英単語・例文・熟語** on the registration screen. Paste all words, examples, and phrases once into the single field. The recommended Custom GPT output is one JSON array containing the complete range.

```json
[
  {"word":"record","meaning":"記録／記録する","examples":[{"en":"Keep a record of your expenses.","ja":"出費を記録しておきなさい。"}],"phrases":[{"en":"on record","ja":"記録されて"}]},
  {"word":"expense","meaning":"費用／出費","examples":[],"phrases":[{"en":"at the expense of A","ja":"Aを犠牲にして"}]}
]
```

`examples` and `phrases` are arrays, so each word can contain zero, one, or many items. Because the relationship is defined by the containing word record, the app does not inspect English text or guess links. JSON Lines remains accepted for compatibility. A six-column TSV fallback is accepted for simple one-line transfers; multiple values use ` || ` in the corresponding English and Japanese columns.

Before registration, the app previews the word, example, and phrase counts. Missing translations, malformed rows, mismatched TSV pairs, and duplicate words are shown with their line number and block registration until fixed.

Vocabulary test dates must be Monday or Wednesday. The app derives the weekday from the date and blocks registration when another weekday is selected. Friday memorization similarly requires a Friday date.

Examples and phrases are recalled from Japanese to the complete English text. After revealing the answer, rate it with `○`, `△`, or `×`. `×` returns after a few questions, while `△` returns near the end of the session. Repeating `○` on the same day does not mark an item as settled; an `○` on two different dates is required. There are no cloze or word-order questions.

Each range shows a full-score readiness checklist for unconfirmed or unsettled words, hard words, unsettled examples and phrases, and latest mistakes. The range is marked **満点準備完了** only when every applicable count is zero.

The Quizlet export contains examples only in `English[TAB]Japanese` format. Phrase rows and internal IDs are excluded.

## Friday Memorization

Choose **金曜の暗記構文** and paste:

```text
M001	1	I am ready for the test.	私はテストの準備ができています。
```

Memorization uses the same full-text `○` / `△` / `×` recall flow, but its data and progress are independent from vocabulary tests and speed review. Only text and progress are stored, so the feature does not add audio files to localStorage.

## Speech Fallback

Official Merriam-Webster audio remains the first choice. In speed review, each card automatically plays the official audio or, when it is unavailable, the device's English voice through the Web Speech API. Starting review and moving cards both happen directly from a tap, swipe, or key action so iOS user-gesture restrictions are respected. **もう一度聞く** remains available only as a replay control. Moving to another card, leaving review/test mode, or stopping continuous playback cancels queued speech immediately and prevents overlap.

## Rollback and Backups

The repository tag `stable-before-superapp-2026-07-29` identifies the code before the super-app changes.

On the first load, the app keeps a one-time copy of the existing main data when it is small enough to duplicate safely. The backup screen can export or restore this copy. JSON export remains the recommended manual backup before a large import. API keys are never included.

### Feedback and bug reports

Bug reports and feature suggestions are welcome through GitHub Issues.
Please do not include API keys or personal information in issues or pull requests.

## Current architecture / 現在の構成

This is a static, local-first PWA. Study data, settings, and dictionary lookup cache live in the browser; it has no application server.

| File | Responsibility |
| --- | --- |
| `js/storage.js` | schema v3 validation, migration, safe JSON export, append/replace import planning |
| `js/content.js` | vocabulary/example/phrase/memorization parsing and the `○` / `△` / `×` full-text recall queue |
| `js/test.js` | two-direction test sessions, choice construction, spelling evaluation, Speed Review sessions, and readiness rules |
| `js/app.js` | UI state, localStorage writes, import confirmation, API/audio access, speech fallback, and service-worker registration |
| `sw.js` | same-origin app-shell cache and removal of old app-shell caches |

`index.html` loads `storage.js`, `content.js`, `test.js`, then `app.js`. Keep this order because the UI uses the APIs supplied by the first three files.

## Local data, schema v3, and API-key safety / ローカルデータと安全性

The main saved object is browser localStorage key `mwPronunciationTool.v1`. Its **schema v3** export/import format contains normalized settings, ranges, study log, and selected-range UI state. Ranges contain words plus optional examples, phrases, memorization items, test history, spelling history, and learning statistics. Dictionary metadata such as pronunciation and audio URLs may be stored as lightweight text; raw Merriam-Webster responses and audio binaries are not exported.

`storage.js` accepts older schema data and migrates it to v3. It rejects a backup from a newer schema rather than guessing how to read it, validates JSON before writing, normalizes unsafe or duplicate IDs, restores valid links, and enforces import limits (8 MB, 500 ranges, and 5,000 words per range).

API keys are intentionally outside schema v3. Optional Learner's and Collegiate keys are saved only in this browser's localStorage when the user explicitly chooses to save them. They are never included in source code, samples, JSON/CSV/Quizlet export, GitHub Pages, issues, or pull requests. On a shared device, leave key saving off and remove saved keys after use. Demo mode is on by default, so opening the app does not itself make an API request.

## Back up, import, and roll back / バックアップ・インポート・復元

Before a large change, use **JSON export** and keep the downloaded file safely. The backup screen also offers two automatic recovery points:

- **Pre-upgrade backup** is the one-time copy retained when eligible older data is first upgraded. It can be exported or restored.
- **Pre-import backup** is written immediately before a successful append or replace import. “Restore before last import” replaces current study data with that checkpoint after confirmation.

Paste JSON into the backup screen first. The app previews ranges, words, duplicates, and migration warnings before enabling the operation.

- **Append import / 追加インポート** keeps the current settings and study log, adding only new ranges. An exact duplicate is skipped. If an existing ID or the same range name/date/type points to different content, validation stops the entire append instead of silently discarding or overwriting either version.
- **Replace import / 置き換えインポート** uses the validated backup as the new data set, including its settings and study log. It is confirmation-gated and first saves the current state as the pre-import rollback point.

If validation, migration, or storage writing fails, the import is cancelled without changing the main saved object. Restoring either automatic backup re-validates and migrates it first. A restore replaces current data, so export the current JSON first if it may be needed later.

## Study content and recall / 教材と暗唱

For **英単語・例文・熟語**, paste one JSON array containing the complete range. JSON Lines remains supported for compatibility:

```json
[
  {"word":"record","meaning":"記録／記録する","examples":[{"en":"Keep a record.","ja":"記録をつける。"}],"phrases":[{"en":"on record","ja":"記録されて"}]}
]
```

The parser also accepts a six-column TSV fallback. It previews counts and blocks registration with malformed lines, missing translations, mismatched English/Japanese multi-value pairs, or duplicate words. Examples and phrases keep their source-word relationship through the containing record; the app does not infer links from English text.

For **金曜の暗記構文**, paste TSV containing English full text and its Japanese translation (an optional source ID and label may precede them). Examples, phrases, and memorization sentences are recalled Japanese → complete English. After revealing the answer, rate it `○`, `△`, or `×`: `×` is requeued after a few items and `△` returns near the end. An item is settled only after `○` on two different calendar days and, after a lapse, a later-day `○`; same-day retries do not erase that boundary. This recall progress is separate from vocabulary tests and Speed Review.

Vocabulary recall modes always keep examples and phrases together: **例文・熟語・高速周回**, **未定着の例文・熟語**, and **全例文・熟語**. They reuse the existing recall history instead of creating a separate example-only history.

## Tests, spelling, and readiness / テスト・スペル・準備判定

Vocabulary tests are direction-specific: **English → Japanese** and **Japanese → English** write separate `testStats`. Each question has four choices, and the test engine avoids duplicate meanings/answers where it cannot build a valid set.

- **Normal / 通常** always requires and presents 15 buildable questions. It prioritizes recent mistakes or manually marked hard words, then untested words, then other review candidates.
- **Wrong / 間違い集中** and **Ready / 満点確認** may be shorter (up to 15). They are focused queues for recent wrong answers or current readiness risks; they are not evidence that a normal 15-question test was run.

Readiness is stricter than one high score. For every word, both test directions need evidence, correct success on at least two different local calendar days, a latest correct and non-hesitant/non-slow answer, no unresolved repeated choice confusion, a successful check within the last 14 days, and a later-day recovery after any wrong answer. The spelling check is also required. It asks the user to type English from the Japanese meaning and accepts only the headword or an explicitly supplied accepted form (`acceptedSpellings`, `acceptedForms`, or `spellingForms`). Typography is normalized for common width, apostrophe, and hyphen variants, but there is no fuzzy matching or typo correction. A spelling lapse likewise needs a correct answer on a later day. Example, phrase, and memorization recall also expires from test readiness when its latest successful evidence is older than 14 days.

The range checklist reports unverified items, missing cross-day success, latest mistakes, slow/hesitant answers, repeated choice confusion, and spelling risk. **満点準備完了 / ready** means every applicable risk count is zero; it is a study rule, not a guarantee of a real examination result.

**Speed Review / 高速周回** records per-word `speedStats` and keeps `unknown` and `unsure` cards in the next round until they are rated `instant`. These ratings are persisted and directly feed readiness risk and normal-test question priority, without changing the user's manual `hard` flag. They do **not** write ordinary `testStats`, alter a 15-question test score, or replace the direction-specific cross-day test evidence.

## Pronunciation and speech / 発音

Official Merriam-Webster audio is preferred. In Speed Review and test-related playback, when official audio is unavailable, the app can use the device's English Web Speech voice instead; it does not fabricate an official audio URL. Playback actions are started from a user gesture for iOS compatibility, and leaving a learning mode stops queued speech and current preview playback to avoid overlap.

Dictionary response-shape, network, and HTTP errors should be diagnosed without displaying the raw API key. If cached dictionary data no longer matches the current cache schema, use the app's re-fetch control after checking the range and selected dictionary type.

## Run locally, test, and update the PWA / ローカル実行・テスト・更新

Use a local HTTP server for development and verification. Do **not** open the app with `file://`: service workers require an HTTP(S) origin and `file://` does not exercise the PWA cache correctly. From this project directory, for example:

```powershell
py -3 -m http.server 8000
# open http://127.0.0.1:8000/
```

Run the automated checks with:

```powershell
npm test
```

The automated command is a code-level check. It does not prove a visible browser flow, installation, offline reload, audio permission/voice behaviour, or real-device behavior. Those require a separate localhost browser/PWA pass.

For a release that changes app-shell files, update the cache/query version consistently in `index.html` and `sw.js`, then reload the HTTP-served app and check the service-worker update path. `sw.js` only caches same-origin app files; external Merriam-Webster API responses and audio are not put in the PWA cache. A browser with an older service worker may need one reload/activation cycle before the new shell is used.

## GitHub Pages / GitHub Pages での公開

This project can be published as a static GitHub Pages site: publish the repository's app files, enable Pages for the intended branch/folder, and open the resulting HTTPS URL before installing it as a PWA. The relative asset and service-worker paths support a project Pages subpath. GitHub Pages serves the client application only; it must not be used to publish API keys or private exports. Verify the deployed HTML, JavaScript versions, and service-worker cache name after a release rather than treating a successful upload as browser or device validation.

