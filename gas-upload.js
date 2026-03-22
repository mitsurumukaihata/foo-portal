// ============================================================
// f.o.o ポータル — SNS素材アップロード用 Google Apps Script
// ============================================================
// 【更新手順】
// 1. script.google.com で「SNS素材アップロード」プロジェクトを開く
// 2. コード全体をこの内容に置き換え
// 3.「デプロイ」→「デプロイを管理」→ 鉛筆アイコン
// 4.「バージョン」を「新バージョン」に変更 →「デプロイ」
// ============================================================

var ROOT_FOLDER_NAME = 'SNS素材';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    switch (data.action) {

      // ── フォルダ作成 ──
      case 'createFolder':
        var parent = getOrCreateRootFolder();
        var folder = parent.createFolder(data.folderName);
        return respond({ success: true, folderId: folder.getId() });

      // ── 小ファイルアップロード（1回で完了） ──
      case 'upload':
        var folder = DriveApp.getFolderById(data.folderId);
        var bytes = Utilities.base64Decode(data.base64);
        var blob = Utilities.newBlob(bytes, data.mimeType, data.fileName);
        folder.createFile(blob);
        return respond({ success: true });

      // ── チャンクアップロード（大きいファイル用） ──
      case 'uploadChunk':
        var folder = DriveApp.getFolderById(data.folderId);
        var tempName = '_chunks_' + data.uploadId;
        var tempIt = folder.getFoldersByName(tempName);
        var tempFolder = tempIt.hasNext() ? tempIt.next() : folder.createFolder(tempName);

        var bytes = Utilities.base64Decode(data.base64);
        var chunkName = 'chunk_' + ('0000' + data.index).slice(-4);
        var blob = Utilities.newBlob(bytes, 'application/octet-stream', chunkName);
        tempFolder.createFile(blob);
        return respond({ success: true, chunkIndex: data.index });

      // ── チャンク組み立て（大きいファイルの最終処理） ──
      case 'assembleFile':
        var folder = DriveApp.getFolderById(data.folderId);
        var tempName = '_chunks_' + data.uploadId;
        var tempIt = folder.getFoldersByName(tempName);
        if (!tempIt.hasNext()) return respond({ error: 'チャンクが見つかりません' });
        var tempFolder = tempIt.next();

        var allBytes = [];
        for (var i = 0; i < data.totalChunks; i++) {
          var chunkName = 'chunk_' + ('0000' + i).slice(-4);
          var files = tempFolder.getFilesByName(chunkName);
          if (!files.hasNext()) return respond({ error: 'チャンク ' + i + ' が見つかりません' });
          var chunkBytes = files.next().getBlob().getBytes();
          for (var j = 0; j < chunkBytes.length; j++) {
            allBytes.push(chunkBytes[j]);
          }
        }

        var finalBlob = Utilities.newBlob(allBytes, data.mimeType, data.fileName);
        folder.createFile(finalBlob);
        tempFolder.setTrashed(true);
        return respond({ success: true });

      // ── 完了処理（フォルダID返却のみ、非公開のまま） ──
      case 'finish':
        return respond({ success: true, folderId: data.folderId });

      // ── フォルダ内のファイル一覧取得 ──
      case 'listFiles':
        var folder = DriveApp.getFolderById(data.folderId);
        var fileList = [];
        var files = folder.getFiles();
        while (files.hasNext()) {
          var f = files.next();
          fileList.push({
            id: f.getId(),
            name: f.getName(),
            size: f.getSize(),
            mimeType: f.getMimeType()
          });
        }
        // ファイル名でソート
        fileList.sort(function(a, b) { return a.name.localeCompare(b.name); });
        return respond({ success: true, files: fileList });

      // ── ファイルダウンロード（base64で返す） ──
      case 'downloadFile':
        var file = DriveApp.getFileById(data.fileId);
        var blob = file.getBlob();
        var bytes = blob.getBytes();
        var base64 = Utilities.base64Encode(bytes);
        return respond({
          success: true,
          fileName: file.getName(),
          mimeType: blob.getContentType(),
          size: bytes.length,
          base64: base64
        });

      // ── 大ファイルダウンロード（チャンクで返す） ──
      case 'downloadChunk':
        var file = DriveApp.getFileById(data.fileId);
        var blob = file.getBlob();
        var bytes = blob.getBytes();
        var totalSize = bytes.length;
        var chunkSize = 2 * 1024 * 1024; // 2MB
        var totalChunks = Math.ceil(totalSize / chunkSize);
        var start = data.chunkIndex * chunkSize;
        var end = Math.min(start + chunkSize, totalSize);

        var chunkBytes = [];
        for (var i = start; i < end; i++) {
          chunkBytes.push(bytes[i]);
        }
        var base64 = Utilities.base64Encode(chunkBytes);
        return respond({
          success: true,
          base64: base64,
          chunkIndex: data.chunkIndex,
          totalChunks: totalChunks,
          totalSize: totalSize
        });

      default:
        return respond({ error: '不明なアクション: ' + data.action });
    }

  } catch (err) {
    return respond({ error: err.toString() });
  }
}

function getOrCreateRootFolder() {
  var it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
