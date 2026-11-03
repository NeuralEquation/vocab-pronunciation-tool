
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

## GAS同期（検証用・未デプロイ）

GitHub PagesのPWAは引き続き使えます。同期は保存タブから手動で行い、APIキー・端末設定を除外します。GAS用には同じ画面をローカルでまとめる `npm run build:gas` を追加しました。Google認証・CORS・リダイレクト・実Drive保存・実iPadは未検証です。GitHub PWAからの直接同期が利用可能かは実環境での確認が必要です。

設計、競合解決、復旧、テスト、実環境での確認項目は [GAS同期ガイド](gas/README.md) を参照してください。本番deployやDriveデータ作成は実行していません。

## PWA Cache

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

**★ あとでテスト** is a manual subset within each vocabulary range. Select words in the compact searchable list, from an existing word view, during any word test, or from the test results. Start English→Japanese or Japanese→English directly; each session asks up to 10 marked words, including a single marked word when four distinct choices can be built from the full range. Older last-tested words get priority across sessions. Results offer another pass and a retry of the missed marked words. Correct answers never clear marks; remove them yourself when comfortable. Marks are independent of the old automatic hard/known status and survive reload, portable backup/restore, and synchronization with the updated GAS bundle. Existing GAS deployments need the rebuilt shared storage/protocol files before syncing this new field; local use does not require GAS.

The full-score check, readiness badges, and finishing-mode entry points have been removed. Historical test evidence and older backups remain supported. No new flashcard workflow is required.

The Quizlet export contains examples only in `English[TAB]Japanese` format. Phrase rows and internal IDs are excluded.

## Phrase and verb-form speech

The existing `phrases` English text can be played individually from the phrase list, linked usage, and the revealed word-test answer. No embedded audio or paid API is needed: playback uses the same selected US device voice and speed.

Vocabulary JSON may optionally include `verbForms`. The headword in `word` supplies the base form; these extra fields are independent of spelling-test accepted answers:

```json
[{"word":"go","meaning":"行く","verbForms":{"past":["went"],"pastParticiple":["gone"],"presentParticiple":["going"],"thirdPersonSingular":["goes"]},"phrases":[{"en":"on the go","ja":"活動中で"}]}]
```

Each field accepts a string or an array of strings (canonical backups use arrays); `/` separates alternatives in string input. Existing JSON/TSV and older backups remain valid with no `verbForms`. Stored forms are not guessed or auto-generated. Add or edit them on existing words under **動詞の活用**, including after answering a marked test. Listen to each form or the full sequence. The fields survive backup and sync with the updated GAS bundle; no audio binaries are added to localStorage or exports. Full text remains optional for old words.

## Friday Memorization

Choose **金曜の暗記構文** and paste:

```text
M001	1	I am ready for the test.	私はテストの準備ができています。
```

Memorization uses the same full-text `○` / `△` / `×` recall flow, but its data and progress are independent from vocabulary tests and speed review. Only text and progress are stored, so the feature does not add audio files to localStorage.

## Speech Fallback

Official Merriam-Webster audio remains the first choice. In speed review, each card automatically plays the official audio or, when it is unavailable, the device's English voice through the Web Speech API. Starting review and moving cards use direct taps (with keyboard shortcuts still available) so iOS user-gesture restrictions are respected. **もう一度聞く** remains available only as a replay control. Moving to another card, leaving review/test mode, or stopping continuous playback cancels queued speech immediately and prevents overlap.

## Rollback and Backups

The repository tag `stable-before-superapp-2026-07-29` identifies the code before the super-app changes.

On the first successful load, the app attempts a one-time local recovery copy. If that optional copy fails, valid study data is still loaded and a warning is shown. The backup screen can export or restore this copy. JSON export remains the recommended manual backup before a large import. API keys are never included.

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
| `js/playback.js` | cancellable single/linked-word audio, shared en-US voice selection, usage timing |
| `js/dictionary.js` | bounded, abortable MW requests, retries and safe errors |
| `js/app.js` | UI state, guarded localStorage writes, import/restore confirmation, continuous playback, and service-worker registration |
| `sw.js` | same-origin app-shell cache and removal of old app-shell caches |

`index.html` loads `storage.js`, `content.js`, `test.js`, `playback.js`, `dictionary.js`, then `app.js`. Keep this order because the UI uses the APIs supplied by these modules. The empty `ux-overrides.js` entry remains for PWA compatibility.

## Local data, schema v3, and API-key safety / ローカルデータと安全性

The main saved object is browser localStorage key `mwPronunciationTool.v1`. Its **schema v3** export/import format contains normalized settings, ranges, study log, and selected-range UI state. Ranges contain words plus optional examples, phrases, memorization items, test history, spelling history, and learning statistics. Dictionary metadata such as pronunciation and audio URLs may be stored as lightweight text; raw Merriam-Webster responses and audio binaries are not exported.

`storage.js` accepts older schema data and migrates it to v3. It rejects a backup from a newer schema rather than guessing how to read it, validates JSON before writing, normalizes unsafe or duplicate IDs, restores valid links, and enforces import limits (8 MB, 500 ranges, and 5,000 words per range).

API keys are intentionally outside schema v3. Optional Learner's and Collegiate keys are saved only in this browser's localStorage when the user explicitly chooses to save them. They are never included in source code, samples, JSON/CSV/Quizlet export, GitHub Pages, issues, or pull requests. On a shared device, leave key saving off and remove saved keys after use. Demo mode is on by default, so opening the app does not itself make an API request.

## Back up, import, and roll back / バックアップ・インポート・復元

Before a large change, use **JSON export** and keep the downloaded file safely. The backup screen also offers three local recovery points:

- **Pre-upgrade backup** is the one-time copy retained when eligible older data is first upgraded. It can be exported or restored.
- **Pre-restore backup** preserves the main saved value before a restore. “復元直前に戻す” can undo a restore. If the recovery copy cannot be saved, the main value is not changed.
- **Pre-import backup** is written before attempting an append or replace import. “Restore before last import” replaces current study data with that checkpoint after confirmation.

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

Examples and phrases are always handled together. **学習モード（初見用）** offers separate word and example/phrase passes; both are unrated, tap-to-advance sessions that do not create study history. **高速周回** remains a separate mode for words or examples/phrases. Example/phrase Speed Review keeps the existing recall history and ratings, and automatically plays the official pronunciation of the linked word when that audio is available. Notifications are dismissed with a tap.

The vocabulary menu starts with **★ あとでテスト**, a compact manual word picker and direct short-test buttons. **学習モード** remains available, with **高速周回** and regular **確認テスト** under the optional practice menu. Example/phrase confirmation asks each selected item once and writes to the existing `recallStats`. The finishing-mode entry points are retired.

## Tests and spelling / テスト・スペル

Vocabulary tests are direction-specific: **English → Japanese** and **Japanese → English** write separate `testStats`. Each question has four choices, and the test engine avoids duplicate meanings/answers where it cannot build a valid set.

- **Normal / 通常** always requires and presents 15 buildable questions. It prioritizes recent mistakes or manually marked hard words, then untested words, then other review candidates.
- **Wrong / 間違い集中** asks up to 15 recent wrong answers in that direction.
- **Marked / ★ あとでテスト** asks 1–10 manually marked targets in that direction, with distractors from the full range. Success does not clear marks. Both shorter modes are recorded separately from normal tests. Legacy `ready` histories remain readable.

The optional spelling check asks for the English headword from the Japanese meaning. It accepts only the headword or an explicitly supplied accepted spelling (`acceptedSpellings`, `acceptedForms`, or `spellingForms`); verb conjugations are separate reference data. Typography is normalized for common width, apostrophe, and hyphen variants, with no fuzzy matching. Historical cross-day direction, spelling, and recall evidence is retained for compatibility and existing automatic priorities; the retired full-score checklist and readiness badges are not displayed and do not control manual marks.

**Speed Review / 高速周回** records per-word `speedStats` and keeps `unknown` and `unsure` cards in the next round until they are rated `instant`. These ratings are persisted and directly feed readiness risk and normal-test question priority, without changing the user's manual `hard` flag. They do **not** write ordinary `testStats`, alter a 15-question test score, or replace the direction-specific cross-day test evidence.

During continuous word playback, linked examples and phrases are expanded for the focused word. After the word audio, each linked example is read in full using the device's English voice, followed by the configured extra review time before the next word. Words without examples continue normally. Pause, replay, previous/next, and stop also control example playback. Device speech is cancelled on pause; resume starts the current sentence again from its beginning without skipping an example, including after returning from the background. The section is collapsed when playback advances or stops.

Example/phrase **学習モード** automatically reads the full English text, and its replay button reads that same text again. Android uses the browser's Web Speech API and an available English TTS voice; English voice availability depends on the device's speech settings. Word and example/phrase **高速周回** adapt to the viewport height, keeping reveal and rating buttons in view while long text or expanded examples scroll within their own area.

## Pronunciation and speech / 発音

Example, phrase, and fallback word speech uses **American English only**. Under **設定 → 読み上げ音声**, choose an available US voice, preview it, and select 0.85×, 1×, or 1.1× speed; save with **設定を保存**. Automatic selection prefers voices labelled Natural/Neural/Premium, then Enhanced. These labels are quality hints; actual naturalness depends on the OS and browser. The full sentence is sent as one utterance, with normal pitch. The selected voice name and rate appear during playback. Voice lists refresh when the browser reports `voiceschanged`; when no US voice is exposed (including during initial loading), speech is unavailable with guidance rather than switching to a British/default voice. Install a US high-quality voice in device accessibility/TTS settings where supported, then verify that it appears in this browser. No cloud speech service has been added.

Official Merriam-Webster audio is preferred. Pronunciation notation such as `ˈrekərd` remains visible in the pronunciation field, while the word spelling itself is always shown unchanged. In Speed Review and test-related playback, when official audio is unavailable, the app can use the device's English Web Speech voice instead; it does not fabricate an official audio URL. Playback actions are started from a user gesture for iOS compatibility, and leaving a learning mode stops queued speech and current preview playback to avoid overlap.

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

For a release that changes app-shell files, update the cache/query version consistently in `index.html` and `sw.js`, then reload the HTTP-served app and check the service-worker update path. `sw.js` only caches same-origin app files; external Merriam-Webster API responses and audio are not put in the PWA cache. An installed update waits until all app tabs close. The app shows an update notice; confirm that data is saved, close all app tabs, then reopen. HTML and assets are served from the same installed shell, and only explicitly listed app assets are cached.

## GitHub Pages / GitHub Pages での公開

This project can be published as a static GitHub Pages site: publish the repository's app files, enable Pages for the intended branch/folder, and open the resulting HTTPS URL before installing it as a PWA. The relative asset and service-worker paths support a project Pages subpath. GitHub Pages serves the client application only; it must not be used to publish API keys or private exports. Verify the deployed HTML, JavaScript versions, and service-worker cache name after a release rather than treating a successful upload as browser or device validation.


## Audit fixes (app shell v55)

- 読込失敗時は復旧モードになり、通常保存で元データを上書きしません。「保存」タブで正常なJSONへの置き換え・退避済みデータからの復元を行えます。破損した元の値も置き換え直前のローカル退避に残ります。
- 保存失敗は「未保存」として表示し続けます。タブを閉じずに再試行するか、JSONで退避してください。APIキーの保存が失敗した場合は、設定画面から再試行します。
- 現行版同士の同時上書きを防ぐため、Web Locksで編集するタブを1つに限定します。他のタブは閲覧専用です。編集タブを閉じてから再読込すると引き継げます。Web Locks未対応のブラウザでは保存を停止します。古い版を開いているタブも閉じてください。
- `revision`は端末内の保存用番号です。v57では別の`sync`領域に同期のrevision/dirty/pending/conflictを保持します（上記GAS同期ガイド参照）。端末間の自動マージは行いません。追加importは教材の追加であり、同じ教材の学習履歴を統合する機能ではありません。
- JSON出力は許可したschema項目だけを組み立てます。未知の拡張項目は出力しません。範囲・単語・例文の未知項目はローカル側で保持し、元JSONのローカル退避も維持します。旧バックアップの出力にも同じ検証を適用します。
- 端末で保持しているMWキーと一致する文字列が学習データや出力に見つかった場合は、保存・出力を中止します。MWへの認証以外にキーを送る経路は追加していません。応答本文や通信URLはアプリのログ・保存用エラーに入れません。
- 単発音声・例文に関連する単語音声は、遅れて届く失敗通知を無視します。公式音声が失敗・時間切れになれば米国英語のみの端末TTSへ切り替えます。例文・熟語の学習画面には「全文を読み上げ」もあります。端末TTSの実音声・オフライン可否は端末の音声設定に依存します。
- API通信は1回15秒で時間切れになり、取得中に中止できます。使用回数は候補検索・再試行も含む実通信の開始ごとに数えます。

Verification: `npm test` runs the original unit suite and the audit regressions. Serve this directory over HTTP, then set `MW_TEST_URL` and run `npm run test:browser` for both learning/PWA smoke tests and corruption/quota/two-tab/secret-boundary browser tests. Tests use synthetic data and mocked dictionary/audio paths; they do not certify physical iPad audio, background behavior, or GAS authentication. Keep a separate JSON backup before testing an actual installed iPad PWA.
