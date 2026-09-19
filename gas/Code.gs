/* Private, single-owner Web App. Configure manually only in an isolated test project. */
function authorize_() {
  var properties = PropertiesService.getScriptProperties();
  var owner = String(properties.getProperty('ALLOWED_USER_EMAIL') || '').toLowerCase();
  var active = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  var effective = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!owner || active !== owner || effective !== owner) throw new Error('ACCESS_DENIED');
  return properties;
}

function syncRequest(request) {
  try {
    var properties = authorize_();
    var folderId = properties.getProperty('SYNC_FOLDER_ID');
    if (!folderId) throw new Error('NOT_CONFIGURED');
    var store = {
      storageId: folderId,
      id: function () { return Utilities.getUuid().replace(/-/g, '').toLowerCase(); },
      getHead: function () { var raw = properties.getProperty('SYNC_HEAD_V2'); return raw ? JSON.parse(raw) : null; },
      setHead: function (head) { properties.setProperty('SYNC_HEAD_V2', JSON.stringify(head)); },
      getRejected: function (datasetId, requestId) { var raw = properties.getProperty('SYNC_REJECT_' + datasetId + '_' + requestId); return raw ? JSON.parse(raw) : null; },
      setRejected: function (datasetId, requestId, entry) { properties.setProperty('SYNC_REJECT_' + datasetId + '_' + requestId, JSON.stringify(entry)); },
      hash: function (text) {
        return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)
          .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
      },
      lock: function (operation) {
        var lock = LockService.getScriptLock();
        if (!lock.tryLock(10000)) throw new Error('BUSY');
        try { return operation(); } finally { lock.releaseLock(); }
      },
      hasGenerations: function () {
        var files = DriveApp.getFolderById(folderId).getFiles();
        while (files.hasNext()) {
          var file = files.next();
          if (file.getName().indexOf('mw-sync-generation-') === 0) return true;
        }
        return false;
      },
      read: function (id) {
        var file = DriveApp.getFileById(id), parents = file.getParents(), member = false;
        while (parents.hasNext()) if (parents.next().getId() === folderId) member = true;
        if (!member || file.isTrashed() || file.getSize() > 12 * 1024 * 1024) throw new Error('RECOVERY_REQUIRED');
        return JSON.parse(file.getBlob().getDataAsString('UTF-8'));
      },
      append: function (generation) {
        return DriveApp.getFolderById(folderId).createFile('mw-sync-generation-' + generation.serverRevision + '.json', JSON.stringify(generation), MimeType.PLAIN_TEXT).getId();
      }
    };
    return MWSyncServer.createServer(store).handle(request);
  } catch (error) {
    // Never log or echo request bodies, Google service exceptions or credentials.
    var safe = ['ACCESS_DENIED', 'NOT_CONFIGURED', 'BUSY', 'RECOVERY_REQUIRED', 'DATASET_MISMATCH', 'REQUEST_REUSED', 'MALFORMED', 'SECRET', 'SIZE'];
    return { status: 'error', code: safe.indexOf(error.message) >= 0 ? error.message : 'RECOVERY_REQUIRED' };
  }
}

function doPost(event) {
  var response;
  try {
    authorize_();
    var text = event && event.postData && event.postData.contents;
    if (typeof text !== 'string' || text.length > MWSyncProtocol.MAX_CHARS + 1024) throw new Error('MALFORMED');
    response = syncRequest(JSON.parse(text));
  } catch (_) { response = { status: 'error', code: 'ACCESS_OR_PAYLOAD' }; }
  return ContentService.createTextOutput(JSON.stringify(response)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  try { authorize_(); return HtmlService.createHtmlOutputFromFile('Index').setTitle('MW 発音・同期'); }
  catch (_) { return HtmlService.createHtmlOutput('<p>この同期アプリへのアクセスは許可されていません。</p>'); }
}
