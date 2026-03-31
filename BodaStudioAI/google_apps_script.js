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
  // Hanya fungsi dummy untuk memicu prompt OAuth dari AppScript
  // Permissions akan diproses berdasarkan appsscript.json
  const token = ScriptApp.getOAuthToken();
  Logger.log("✅ Setup berhasil! OAuth Token: " + (token ? "Aktif" : "Gagal"));
  Logger.log("✅ Akun aktif: " + Session.getActiveUser().getEmail());
  
  // Tes akses folder target via REST API
  try {
    const folder = driveGetFolder("1KGzXGO3EnFl1I9hpQkY4cMk6nw8kI4cM");
    Logger.log("✅ Target folder accessible via API: " + folder.name);
  } catch(e) {
    Logger.log("❌ Target folder GAGAL diakses: " + e.toString());
    Logger.log("Pastikan folder dimiliki atau di-share ke akun Anda.");
  }
}

// ═══════════════════════════════════════
// WEB APP ENDPOINTS
// ═══════════════════════════════════════
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    let folderId = data.folderId;
    if (folderId && folderId.indexOf('?') > -1) {
      folderId = folderId.split('?')[0];
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
  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    message: "BODA STUDIO AI Cloud Endpoint Active.",
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}
