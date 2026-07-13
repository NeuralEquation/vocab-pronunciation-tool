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

## 学校の単語テスト対策

* 英語→日本語・日本語→英語の4択テストを原則15問で実施できます。
* 通常、直前、間違い集中の3モードがあり、苦手語・未定着語・直近の誤答を優先できます。
* 両方向で連続2回正解すると「覚えた」になり、不正解は自動で「苦手」に戻ります。手動変更も可能です。
* 月曜・水曜のテスト日、端末のローカル日時、設定した終了時刻を使い、最優先範囲と先取り範囲、今日の目標を提案します。金曜は暗記構文の短い通知だけを表示し、本文は保存・表示・出題しません。
* API取得は確認後に進捗画面へ切り替わり、処理数、割合、現在の単語、成功・失敗、音声・定義の有無を表示します。
* 回答履歴は今日の記録として過去30日分を保持します。JSONバックアップとCSV出力に対応します。

## オフライン利用

一度オンラインでアプリ本体を開けば、Service Workerのアプリシェルキャッシュでオフライン起動できます。未取得のAPIデータと公式音声はオンライン時に取得してください。APIキーはエクスポートされません。
