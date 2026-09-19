# GAS同期（実環境検証前）

このブランチは実装・ローカル検証用です。GASプロジェクトの作成、Google認証、Driveフォルダー作成、アップロード、deployは自動実行しません。GitHub Pagesの公開設定も変更しません。

## スマホとiPadの使い分け

- GitHub PagesのPWAは従来どおり端末保存・オフライン学習に使えます。
- GAS用HTMLは同じアプリをまとめたものです。iPadのGAS画面からは`google.script.run`で同期します。GAS画面はService Workerを登録せず、オフラインPWAとしての動作は保証しません。
- GitHub PWAからは、利用者が入力したGAS Web App URLへの認証付きPOSTを使います。**この経路は実環境未検証で、Google認証/CORS/リダイレクト/サードパーティCookie制限により利用できない可能性があります。** モックで成功しても実通信可能とは判定しません。失敗時は端末版と未確定要求を保持します。
- 本番採用前に両方の実端末で試験してください。直接POSTが拒否される場合は、認証付き中継など別の通信方式の追加設計が必要です。匿名公開・`no-cors`・トークンのURL埋め込みで回避しません。
- GitHubとGASは別originです。学習データ・APIキー・設定は自動共有されません。APIキーは各端末の各originで入力します。同期対象は教材と学習履歴だけで、設定・UI選択状態・APIキーは送りません。

## 状態と保存契約（protocol 2 / sync metadata v2）

学習データはschema v3を維持し、端末専用`sync`領域に以下を保存します。設定・同期情報は同期payloadに含めません。JSON exportにsyncは含めません。

| 項目 | 意味 |
| --- | --- |
| `datasetId` | サーバーが初期作成するUUID v4のハイフンなし表現。別datasetにはrevisionが同じでも書き込めない |
| `serverRevision / serverHash` | 直近の応答で確認したHEAD。過去要求の回収でも現在のHEADを返す |
| `baseRevision / baseHash` | 端末版の基準となるcommit。両方の一致がpush条件 |
| `localRevision / dirty` | 学習・import・restoreの追加変更。通信開始後の変更も保持 |
| `requestId / pending` | 厳格なUUID v4（32桁小文字hex）、固定request全体とSHA-256、開始時localRevision |
| `pending.state` | `unknown`（通信結果不明）、`rejected`（確定拒否）、`committed`（受領済み・端末確定途中） |
| `conflict` | 両側の変更を自動統合せず選択を待つ |
| `verified / state` | dirty=falseだけでは同期済みとしない。未接続・端末変更なし・直近のクラウド確認済み・復旧必要を表示 |

初回は「接続先を確認」でdatasetを取得します。ローカル変更は自動送信しません。最初のbaseはgenesisです。既存クラウドと競合する場合は、拒否要求を退避・解除した後に端末版／クラウド版を明示的に選びます。

送信前に学習データと固定snapshotを同じlocalStorage本体へ保存します。書込み失敗時は送信しません。応答後に追加変更があればdirtyを残します。pullは通信中の変更・実行中学習を確認し、置換前にコピーを保存します。受信payloadは共有canonical schemaで検証し、実際の端末保存・起動時normalizationでも変化しない場合だけverified=trueにします。

タイムアウト・応答消失は「結果照会」または同じrequestIdの再試行で回収します。`not_committed`は照会時点の結果であり、遅延中のpushがあり得るため解除しません。「取消を照会」はロック内で保存済み結果を回収するか、未保存要求の拒否記録を作成します。CAPACITY・schema・secret・stale等の確定拒否はsnapshotを端末へ退避してから解除できます。時間経過ではpendingを削除しません。

不正なsync metadataは原文を`mwPronunciationTool.syncArchive.*`に隔離し、通常保存・backup・import・restoreを続行します。容量不足で隔離自体ができない場合は元データを上書きしません。同期だけをrecovery-requiredで止めます。「再接続・復旧」は原状態を退避し、端末データをdirtyに戻して別datasetとの競合を確認する明示操作です。旧protocol 1のsyncも自動移行せず、この経路を使います。古い要求が旧接続先で完了した可能性は消せません。

## authoritative HEADとGASの保存順序

Script Propertiesの`SYNC_HEAD_V2`だけを確定状態とします。HEADは`datasetId / committedRevision / committedHash / generationFileId / storageId`を持ちます。Drive一覧の最大revisionからHEADを推測しません。HEAD欠落＋既存世代あり、参照ファイル欠落、hash不一致、親フォルダー相違、鎖破損ではRECOVERY_REQUIREDにして書込みを止めます。空フォルダーへの明示connectのみ初期化できます。

1. Script Lock取得。
2. HEADとHEADから参照される全世代のSHA-256・previousHash・requestHash・datasetを検証。
3. requestIdのcommit／拒否記録を照会。同一IDの異なるrequestHashは拒否。
4. datasetId、baseRevision、baseHash、canonical payloadを照合。
5. 新generationをDriveへ作成（古い世代は変更しない）。
6. generationを読み戻し、生成した内容・hashとの完全一致を検証。
7. **最後にHEADを更新する（commit point）**。読み戻して確認。
8. finallyでLock解除。

HEAD更新前に失敗したファイルはorphanです。最新版として採用せず、自動削除もしません。HEAD更新後に応答だけ失われても、同一requestIdまたはstatus照会で確定commitを回収できます。commit台帳はHEADから辿る世代に含まれ、世代と別台帳を二重commitしません。拒否台帳`SYNC_REJECT_<datasetId>_<requestId>`は遅延retryを防ぐ小さなtombstoneです。原requestやpayloadは拒否台帳へ保存しません。

Drive・Script Propertiesを跨ぐトランザクションを仮定しません。HEADの保存・読戻しが不明ならpendingを残します。世代は最大1000、毎回鎖を検証するため時間・容量制限を実環境で評価する必要があります。拒否台帳・隔離コピーも自動削除しません。台帳の容量不足はfail-closedとなり、長期運用前にアーカイブ／dataset移行設計が必要です。HEADを手動で消して初期化したり、世代一覧から再構築したりしないでください。破損時はHEAD・全世代・端末JSONを保全して手動診断します。

## 秘密情報の境界

MWキーは各originの専用localStorage／入力中メモリだけで扱います。Google認証はプラットフォームに任せ、アプリはOAuth tokenやパスワードを保存しません。今後認証値を保存する場合は送信前の既知秘密値集合への登録が必須です。

allowlistで教材・学習履歴だけを生成し、送信直前にはpayloadだけでなくrequestId等を含む**request全体**を検査します。既知の保存済みMWキー・入力中キー・保存済み／入力中endpoint（URL/JSONエスケープも含む）、明確なBearer/JWT/認証ラベル等の形式を検査します。pendingの再読込時はID形式を、再送時は現在の秘密値を改めて検査します。サーバーもID・schema・秘密形式を検査し、未知フィールドを拒否します。exportや通常保存にも既知秘密値とcredential形式の検査を適用します。

**保証対象は、アプリが保持する秘密を自動混入させず、既知秘密値を自由文字列経由でも送らないことです。人間が手入力した未知の任意文字列を100%秘密として識別できるとは保証しません。** 認証に見える教材を保守的に拒否する場合があります。ログにrequest本文・秘密・サービスの生エラーを出しません。復旧用の原文隔離は端末内だけに保存し、export・同期対象から除外します。

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

- 修正前反例：`MW_AUDIT_REF=887e269`で`node tests/sync-audit-contracts.js`を実行するとH1〜H5/M1/M2/L1の8件が失敗し、現行コードでは8件が成功します（checkoutは変更しません）。
- 自動テスト：正常push/pull、stale revision、2端末変更、重複requestId、応答消失、同期中の追加変更、malformed、secret、競合、network/timeout、retry、端末/サーバー保存失敗と復旧、履歴破損を合成データで確認。
- GASアダプターテスト：Googleサービスをmock化し、本人照合・LockService・世代保存・doPost・非ログ出力を確認。
- ブラウザーテスト：実Chromium + ローカルHTTP + 模擬サーバーでUI、再読込後のretry、競合解決、restore、GAS用bundleを確認。
- **未検証**：実iPad/Safari、GAS iframe内のlocalStorage/Web Locksの利用可否・originの安定性、Google認証・アクセス制御、CORS、ContentService redirect、実Driveの保存/可視性/中断、Googleの時間・容量制限、実際のMW音声。これらはPASS扱いにしません。

参照した公式仕様：
- [Web Apps / authorization](https://developers.google.com/apps-script/guides/web)
- [google.script.run](https://developers.google.com/apps-script/guides/html/communication)
- [ContentService redirects](https://developers.google.com/apps-script/guides/content)
- [LockService](https://developers.google.com/apps-script/reference/lock/lock-service)
