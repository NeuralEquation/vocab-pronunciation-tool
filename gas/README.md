# GAS同期（実環境検証前）

このブランチは実装・ローカル検証用です。GASプロジェクトの作成、Google認証、Driveフォルダー作成、アップロード、deployは自動実行しません。GitHub Pagesの公開設定も変更しません。

## スマホとiPadの使い分け

- GitHub PagesのPWAは従来どおり端末保存・オフライン学習に使えます。
- GAS用HTMLは同じアプリをまとめたものです。iPadのGAS画面からは`google.script.run`で同期します。GAS画面はService Workerを登録せず、オフラインPWAとしての動作は保証しません。
- GitHub PWAからは、利用者が入力したGAS Web App URLへの認証付きPOSTを使います。**この経路は実環境未検証で、Google認証/CORS/リダイレクト/サードパーティCookie制限により利用できない可能性があります。** モックで成功しても実通信可能とは判定しません。失敗時は端末版と未確定要求を保持します。
- 本番採用前に両方の実端末で試験してください。直接POSTが拒否される場合は、認証付き中継など別の通信方式の追加設計が必要です。匿名公開・`no-cors`・トークンのURL埋め込みで回避しません。
- GitHubとGASは別originです。学習データ・APIキー・設定は自動共有されません。APIキーは各端末の各originで入力します。同期対象は教材と学習履歴だけで、設定・UI選択状態・APIキーは送りません。

## 状態と保存契約

端末の既存schema v3データに、ローカル専用の`sync`領域を追加します。JSON exportには含めません。

| 項目 | 意味 |
| --- | --- |
| `serverRevision` | 端末が応答で確認したサーバー版。重複要求の応答では、その要求が保存された版 |
| `baseRevision` | 端末版の基準となるサーバー版。push時に一致しなければ競合 |
| `localRevision` | 端末の保存・import・restoreごとに増える番号 |
| `dirty` | 端末の変更が未同期。既存の「端末への保存失敗」とは別 |
| `requestId` | 未確定pushの一意な識別子。同じ要求の再試行では変更しない |
| `pending` | 同期開始時のpayload、baseRevision、localRevisionを固定した送信待ちsnapshot |
| `conflict` | 競合が確認され、利用者の判断が必要な状態 |

1. `createBackup`の許可フィールドから、さらに`schemaVersion/ranges/studyLog`だけを抽出し、型・サイズ・秘密情報を検証。
2. 現在データとpendingを**同じlocalStorage本体に1回のsetItem**で保存。失敗したら送信しません。
3. サーバーはLockService内で履歴を検証し、requestIdの重複を確認してからbaseRevisionを照合。
4. 成功応答を受けても、現在のlocalRevisionがsnapshotより進んでいればdirtyを残します。現在の教材をsnapshotで書き戻しません。
5. 応答消失・タイムアウト・端末のack保存失敗ではpendingを残します。次回も同じ要求を送信します。サーバーが既に保存していれば世代を増やしません。
6. 受信中の追加変更、学習セッション、API取得があればクラウド版を適用しません。受信置換の前には端末の同期直前コピーを保存します。
7. import/restoreは過去のsync情報を取り込まず、現在のbaseRevisionとpendingを維持してlocalRevisionを増やしdirtyにします。

同期UIは保存タブにあります。未接続、未同期、同期中、同期済み、結果未確定、競合、エラー、秘密情報検出、復旧必要を区別します。通常の学習中に自動送信はしません。

## 競合時

- 自動マージ・時刻による勝者決定・強制pushはしません。
- 「端末版を残す」は最新サーバー版を読み直してbaseRevisionを更新するだけです。続けて「送信」を押す必要があります。その間に別端末が更新すれば再び競合します。
- 「クラウド版を使う」は確認後、端末版の復旧コピーを保存してから置き換えます。
- 不明なpushがpendingに残っている間は、どちらの選択もできません。まず再試行で結果を確定させます。
- 「同期直前に戻す」は新たなローカル変更です。巻き戻した学習内容を送信する場合もCASが必要です。

## GAS側の世代保存

`SyncServer.js`はサービス非依存の保存ロジック、`Code.gs`はGoogleサービスのアダプターです。

- 設定済みの専用フォルダーに`mw-sync-generation-N.json`を追記します。既存ファイルを更新・削除しません。直前世代がそのままバックアップになります。
- 各ファイルは完全なpayload、requestId、baseRevision、serverRevision、要求のSHA-256、前世代のhash、自身のchecksumを持ちます。認証情報やHTTP本文のログは持ちません。
- 読み取りも書き込みも`getScriptLock()`内で実行。同じフォルダーを複数のGASプロジェクトから操作しないでください（script lockの範囲外になります）。
- 新しい完全なファイルの作成がcommitです。mutableなHEADファイルを別途更新する二段階保存はしません。作成後は読み直して連続性・checksumを確認します。
- サーバー保存後に通信が切れた場合は、世代ファイル内のrequestIdから保存済み結果を返します。同じrequestIdで内容やbaseRevisionが異なる要求は拒否します。
- 壊れたJSON、欠落世代、同番号の複数ファイル、hash不一致では停止し、古い世代を最新として勝手に採用しません。Driveにはトランザクション保証がないため、作成中断が残す不完全ファイルを自動修復できたとは主張しません。
- 読み取りコストを抑えるため手動同期の小規模運用を対象とし、最大1000世代で新規保存を停止します。全世代を検証するため、実データ量でGAS時間・メモリ・Drive割当の試験が必要です。世代削除は冪等性台帳とhash鎖を破壊するため行いません。長期運用には別途アーカイブ設計が必要です。
- 正常な過去世代へ戻したい場合は、その`request.payload`を端末へimportし、新しい変更として送信します。鎖自体が壊れた場合は原本を保全して手動診断し、修復計画を立てます。自動の履歴削除・巻き戻しはありません。

## 秘密情報の境界

クライアントのallowlist生成とGAS側の厳格なフィールド検証を両方実施します。MWキーは専用localStorageまたはセッションメモリだけに保持し、GASのPropertiesServiceやDriveには保存しません。Google認証はプラットフォームに任せ、OAuth tokenやパスワードをJavaScriptの同期payloadへ入れません。

送信前に既知の端末キー（URL/JSONエスケープを含む）、MWキー形式のUUID、一般的な秘密情報形式を検査します。再試行snapshotも検査し直します。検出した場合は送信しません。UUIDが教材に含まれる場合も保守的に停止することがあります。未知の秘密文字列が普通の自由記述と区別できる、という保証はできません。秘密情報を教材欄へ貼り付けないでください。

通常のAPI設定、同期先URL、端末状態はpayloadに含めません。ログは本文・秘密情報・Googleサービスの生エラーを記録せず、UIには固定文を返します。既存のexport安全性、単一書き込みタブ、容量不足時の保全も維持します。

## ローカルでの作成と検証

```powershell
npm test
npm run build:gas
# 別のローカルHTTPサーバーを起動してから:
$env:MW_TEST_URL='http://127.0.0.1:18765/'
npm run test:browser
```

`.gas-build/`にGoogle Apps Script用のファイルをまとめます。このフォルダーはGit対象外です。コードとmanifestのローカル生成のみで、ネットワーク処理をしません。

将来の**隔離したテスト環境**では、別途承認のうえ専用GASプロジェクトと空のDriveフォルダーを用意し、Script Propertiesに`ALLOWED_USER_EMAIL`と`SYNC_FOLDER_ID`を設定します。Web Appは本人限定、アクセスしている本人として実行します。manifestのDrive権限は広いため、認可範囲の確認も実機試験項目です。既存フォルダー・本番学習データでは試さないでください。

## 検証の区分

- 自動テスト：正常push/pull、stale revision、2端末変更、重複requestId、応答消失、同期中の追加変更、malformed、secret、競合、network/timeout、retry、端末/サーバー保存失敗と復旧、履歴破損を合成データで確認。
- GASアダプターテスト：Googleサービスをmock化し、本人照合・LockService・世代保存・doPost・非ログ出力を確認。
- ブラウザーテスト：実Chromium + ローカルHTTP + 模擬サーバーでUI、再読込後のretry、競合解決、restore、GAS用bundleを確認。
- **未検証**：実iPad/Safari、GAS iframe内のlocalStorage/Web Locksの利用可否・originの安定性、Google認証・アクセス制御、CORS、ContentService redirect、実Driveの保存/可視性/中断、Googleの時間・容量制限、実際のMW音声。これらはPASS扱いにしません。

参照した公式仕様：
- [Web Apps / authorization](https://developers.google.com/apps-script/guides/web)
- [google.script.run](https://developers.google.com/apps-script/guides/html/communication)
- [ContentService redirects](https://developers.google.com/apps-script/guides/content)
- [LockService](https://developers.google.com/apps-script/reference/lock/lock-service)
