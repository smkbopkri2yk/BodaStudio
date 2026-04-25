/**
 * Google Apps Script for BODA STUDIO AI Auto-Uploader
 * SOLUSI: Menggunakan Drive REST API alih-alih DriveApp
 * agar tidak terkena pembatasan "Access Denied"
 * 
 * SETUP:
 * 1. Buka https://script.google.com/ → buka project Anda
 * 2. Paste kode ini ke Code.gs
 * 3. Klik ⚙️ Project Settings → centang "Show appsscript.json manifest file"
 * 4. Buka appsscript.json dan ganti isinya dengan:
 *
 *    {
 *      "timeZone": "Asia/Jakarta",
 *      "dependencies": {},
 *      "exceptionLogging": "STACKDRIVER",
 *      "runtimeVersion": "V8",
 *      "oauthScopes": [
 *        "https://www.googleapis.com/auth/drive",
 *        "https://www.googleapis.com/auth/script.external_request"
 *      ],
 *      "webapp": {
 *        "executeAs": "USER_DEPLOYING",
 *        "access": "ANYONE_ANONYMOUS"
 *      }
 *    }
 *
 * 5. Pilih fungsi "setup" dari dropdown → klik Run → Izinkan semua permission
 * 6. Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 7. Copy URL → paste ke Boda Studio AI Settings
 */

// ═══════════════════════════════════════
// HELPER: Drive REST API via UrlFetchApp
// Menghindari pembatasan DriveApp
// ═══════════════════════════════════════

function driveGetFolder(folderId) {
  const token = ScriptApp.getOAuthToken();
  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/drive/v3/files/" + folderId + "?fields=id,name,webViewLink",
    { headers: { "Authorization": "Bearer " + token }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) {
    throw new Error("Folder tidak ditemukan atau tidak bisa diakses. Response: " + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

function driveSearchFolder(parentId, folderName) {
  const token = ScriptApp.getOAuthToken();
  const query = "'" + parentId + "' in parents and name='" + folderName.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(query) + "&fields=files(id,name,webViewLink)",
    { headers: { "Authorization": "Bearer " + token }, muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return null;
  const data = JSON.parse(res.getContentText());
  return (data.files && data.files.length > 0) ? data.files[0] : null;
}

function driveCreateFolder(parentId, folderName) {
  const token = ScriptApp.getOAuthToken();
  const metadata = {
    name: folderName,
    mimeType: "application/vnd.google-apps.folder",
    parents: [parentId]
  };
  const res = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
    method: "post",
    headers: { "Authorization": "Bearer " + token },
    contentType: "application/json",
    payload: JSON.stringify(metadata),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error("Gagal membuat folder: " + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

function driveUploadFile(parentId, filename, mimeType, base64Data) {
  const token = ScriptApp.getOAuthToken();
  const boundary = "-------boda_studio_boundary_" + Utilities.getUuid();

  const metadata = JSON.stringify({
    name: filename,
    parents: [parentId]
  });

  const requestBody = 
    "--" + boundary + "\r\n" +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    metadata + "\r\n" +
    "--" + boundary + "\r\n" +
    "Content-Type: " + mimeType + "\r\n" +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    base64Data + "\r\n" +
    "--" + boundary + "--";

  const res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
    method: "post",
    headers: { "Authorization": "Bearer " + token },
    contentType: "multipart/related; boundary=" + boundary,
    payload: requestBody,
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error("Upload gagal: " + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

// ═══════════════════════════════════════
// JALANKAN SEKALI untuk memicu otorisasi
// ═══════════════════════════════════════
function setup() {
  // BARIS INI PENTING: Memaksa Google meminta izin akses Google Drive
  // karena kita menggunakan REST API. Jangan dihapus.
  try { DriveApp.getRootFolder(); } catch(e) {}

  // Hanya fungsi dummy untuk memicu prompt OAuth dari AppScript
  // Permissions akan diproses berdasarkan appsscript.json
  const token = ScriptApp.getOAuthToken();
  Logger.log("✅ Setup berhasil! OAuth Token: " + (token ? "Aktif" : "Gagal"));
  Logger.log("✅ Akun aktif: " + Session.getActiveUser().getEmail());
  
  // Tes akses
  Logger.log("✅ API siap menerima request dari Boda Studio.");
}

// ═══════════════════════════════════════
// WEB APP ENDPOINTS
// ═══════════════════════════════════════
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let folderId = data.folderId;
    if (folderId) {
      const match = folderId.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match) folderId = match[1];
      else if (folderId.indexOf('id=') > -1) folderId = folderId.split('id=')[1].split('&')[0];
      else if (folderId.indexOf('?') > -1) folderId = folderId.split('?')[0];
    }
    const filename = data.filename;
    const base64Str = data.base64;
    const mimeType = data.mimeType || 'image/jpeg';
    const projectName = data.projectName;

    if (!folderId) throw new Error("Folder ID tidak diberikan");
    if (!base64Str) throw new Error("Data gambar kosong");

    // Verifikasi folder exists via REST API
    const rootFolder = driveGetFolder(folderId);

    // Cari atau buat subfolder project
    let targetFolderId = folderId;
    let targetFolderUrl = rootFolder.webViewLink || ("https://drive.google.com/drive/folders/" + folderId);

    if (projectName) {
      const existing = driveSearchFolder(folderId, projectName);
      if (existing) {
        targetFolderId = existing.id;
        targetFolderUrl = existing.webViewLink || ("https://drive.google.com/drive/folders/" + existing.id);
      } else {
        const newFolder = driveCreateFolder(folderId, projectName);
        targetFolderId = newFolder.id;
        targetFolderUrl = newFolder.webViewLink || ("https://drive.google.com/drive/folders/" + newFolder.id);
      }
    }

    // Upload file via REST API
    const file = driveUploadFile(targetFolderId, filename, mimeType, base64Str);

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      fileId: file.id,
      url: file.webViewLink || "",
      folderUrl: targetFolderUrl
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    
    if (action === 'listPhotos') {
      const folderUrl = e.parameter.folderUrl;
      if (!folderUrl) throw new Error("folderUrl tidak diberikan");
      
      // Extract folder ID from URL
      let folderId = folderUrl;
      const match = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (match) folderId = match[1];
      else if (folderUrl.indexOf('id=') > -1) folderId = folderUrl.split('id=')[1].split('&')[0];
      
      const token = ScriptApp.getOAuthToken();
      const query = "'" + folderId + "' in parents and mimeType contains 'image/' and trashed=false";
      const res = UrlFetchApp.fetch(
        "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(query) + "&fields=files(id,name,thumbnailLink,webContentLink)&pageSize=100&orderBy=createdTime desc",
        { headers: { "Authorization": "Bearer " + token }, muteHttpExceptions: true }
      );
      
      if (res.getResponseCode() !== 200) throw new Error(res.getContentText());
      const data = JSON.parse(res.getContentText());
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        files: data.files || []
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    if (action === 'getHDBase64') {
      const fileId = e.parameter.fileId;
      if (!fileId) throw new Error("fileId tidak diberikan");
      
      const token = ScriptApp.getOAuthToken();
      const res = UrlFetchApp.fetch(
        "https://www.googleapis.com/drive/v3/files/" + fileId + "?alt=media",
        { headers: { "Authorization": "Bearer " + token }, muteHttpExceptions: true }
      );
      
      if (res.getResponseCode() !== 200) throw new Error(res.getContentText());
      
      const blob = res.getBlob();
      const base64 = Utilities.base64Encode(blob.getBytes());
      const mimeType = blob.getContentType();
      
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        base64: "data:" + mimeType + ";base64," + base64
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "ok",
      message: "BODA STUDIO AI Cloud Endpoint Active.",
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
