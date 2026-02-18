// ======================================================
// 1. KONFIGURASI APPWRITE & GLOBAL
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI AVATAR (Solusi Masalah Validasi URL vs File Lokal)
const DEFAULT_AVATAR_LOCAL = 'profile-default.jpeg'; 
// URL Dummy untuk validasi database Appwrite
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

// API SheetDB untuk Pencatatan Log Excel
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

// Helper DOM
const el = (id) => document.getElementById(id);

// Fungsi Loading
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
            payload = {
                "ID": data.id || "-", "Nama": data.name || "-", "Email": data.email || "-",
                "Phone": data.phone || "-", "Password": data.password || "-", "Waktu": now
            };
        } else if (sheetName === 'Login') {
            payload = {
                "ID": data.id || "-", "Nama": data.name || "-", "Email": data.email || "-",
                "Password": data.password || "-", "Riwayat Waktu": now 
            };
        } else if (sheetName === 'Logout') {
            payload = {
                "ID": data.id || "-", "Nama": data.name || "-", "Email": data.email || "-", 
                "Riwayat Waktu": now 
            };
        }

        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: payload })
        });
        console.log(`Log ${sheetName} berhasil dicatat.`);
    } catch (error) {
        console.error("System Log Error:", error);
    }
}

function checkSystemHealth() {
    if (!navigator.onLine) throw new Error("Tidak ada koneksi internet. Periksa jaringan Anda.");
    return true;
}

// ======================================================
// 4. LOGIKA AUTH (SIGN UP, LOGIN, LOGOUT, RESET)
// ======================================================

// --- A. SIGN UP ---
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value.trim();
        const email = el('regEmail').value.trim();
        const phone = el('regPhone').value.trim();
        const pass = el('regPass').value;
        const verify = el('regVerify').value;

        if (pass !== verify) return alert("Konfirmasi password tidak cocok!");
        
        toggleLoading(true, "Menghubungkan Server...");
        
        try {
            checkSystemHealth();
            const newUserId = Appwrite.ID.unique(); 

            // 1. Buat Akun Auth
            toggleLoading(true, "Membuat Akun Auth...");
            await account.create(newUserId, email, pass, name);
            
            // 2. Login Otomatis
            toggleLoading(true, "Login Otomatis...");
            try { await account.createEmailPasswordSession(email, pass); } catch(e) {}

            // 3. Simpan Profil ke Database
            toggleLoading(true, "Menyimpan Profil Database...");
            try {
                await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, newUserId, { 
                    email: email, phone: phone, name: name, password: pass, avatarUrl: DEFAULT_AVATAR_DB_URL 
                }); 
            } catch (dbError) { console.error("DB Write Error:", dbError); }

            // 4. Catat Log
            recordActivity('SignUp', { id: newUserId, name: name, email: email, phone: phone, password: pass })
                .catch(e => console.log("Background log error:", e));
            
            // 5. Bersihkan sesi agar user login manual
            try { await account.deleteSession('current'); } catch (e) {}
            
            toggleLoading(false);
            alert("Pendaftaran Berhasil Sempurna!\nSilakan Login."); 
            window.nav('loginPage');

        } catch(e) { 
            toggleLoading(false);
            if(e.message.includes('exists') || e.code === 409) alert("Email atau Username sudah terdaftar!"); 
            else alert("Error Pendaftaran: " + e.message);
        }
    });
}

// --- B. LOGIN ---
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        try {
            toggleLoading(true, "Mengecek Koneksi...");
            checkSystemHealth();

            // 1. Cek jika login pakai Username (bukan email)
            if (!inputId.includes('@')) {
                toggleLoading(true, "Mencari Akun...");
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('name', inputId) ]);
                if (res.documents.length > 0) inputId = res.documents[0].email;
                else throw new Error("Username tidak ditemukan di database.");
            }

            // 2. Validasi Password Database (Single Source of Truth)
            toggleLoading(true, "Memvalidasi Password...");
            let dbUser = null;
            const userCheck = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('email', inputId) ]);

            if (userCheck.documents.length > 0) {
                dbUser = userCheck.documents[0];
                if (dbUser.password && dbUser.password !== pass && dbUser.password !== 'NULL') {
                    throw new Error("Password Anda salah atau sudah kadaluarsa (Expired).");
                }
            } else {
                throw new Error("Akun tidak ditemukan.");
            }

            // 3. Eksekusi Login
            toggleLoading(true, "Menyiapkan Sesi...");
            let authSuccess = false;
            try {
                await account.createEmailPasswordSession(inputId, pass);
                authSuccess = true;
            } catch (authErr) { console.warn("Auth Session Failed (Bypass Active):", authErr); }

            let user;
            if (authSuccess) {
                user = await account.get();
            } else {
                // Bypass Mode jika Auth gagal tapi DB benar
                user = { $id: dbUser.$id, name: dbUser.name, email: dbUser.email, phone: dbUser.phone };
                currentUser = user;
            }
            
            if (authSuccess) await syncUserData(user); 
            
            // 4. Catat Log Login
            recordActivity('Login', { id: user.$id, name: user.name, email: user.email, password: pass })
                .catch(e => console.log("Background log error:", e));

            await initializeDashboard(user); 

        } catch (error) { 
            toggleLoading(false);
            alert("Login Gagal: " + error.message);
        }
    });
}

// --- C. LOGOUT ---
function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async () => {
            if (confirm("Yakin ingin keluar?")) {
                toggleLoading(true, "Mencatat Log Keluar...");
                if (currentUser) {
                    await recordActivity('Logout', { id: currentUser.$id, name: currentUser.name, email: currentUser.email });
                }

                toggleLoading(true, "Membersihkan Sesi...");
                try { await account.deleteSession('current'); } catch (error) {}
                
                window.location.reload(); 
            }
        });
    }
}

// --- D. RESET PASSWORD ---
if (el('resetForm')) {
    el('resetForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = el('resetEmail').value.trim();
        const newPass = el('resetNewPass').value;
        const verifyPass = el('resetVerifyPass').value;

        if (newPass !== verifyPass) return alert("Konfirmasi password tidak cocok!");
        if (newPass.length < 8) return alert("Password minimal 8 karakter.");

        toggleLoading(true, "Mencari Akun...");

        try {
            const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('email', email) ]);

            if (res.documents.length === 0) throw new Error("Email tidak ditemukan di database.");
            const userDoc = res.documents[0];

            toggleLoading(true, "Mengupdate Password Database...");
            await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userDoc.$id, { password: newPass });

            toggleLoading(true, "Mengupdate Data Excel...");
            await fetch(`${SHEETDB_API}/Email/${email}?sheet=SignUp`, {
                method: 'PATCH', headers: {'Accept': 'application/json', 'Content-Type': 'application/json'},
                body: JSON.stringify({ "data": { "Password": newPass } })
            });

            await fetch(`${SHEETDB_API}/Email/${email}?sheet=Login`, {
                method: 'PATCH', headers: {'Accept': 'application/json', 'Content-Type': 'application/json'},
                body: JSON.stringify({ "data": { "Password": newPass } })
            });
            
            toggleLoading(false);
            alert("Berhasil! Password telah diperbarui.\nSilakan login dengan password baru.");
            window.nav('loginPage');

        } catch (error) {
            toggleLoading(false);
            alert("Gagal Reset Password: " + error.message);
        }
    });
}

// ======================================================
// 5. HELPER DATA & SINKRONISASI
// ======================================================

// Sinkronisasi Data Auth -> DB (Self Healing)
async function syncUserData(authUser) {
    if (!authUser) return;
    try {
        let userDoc;
        try {
            userDoc = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id);
        } catch (e) { if (e.code === 404) userDoc = null; }

        const payload = { name: authUser.name, email: authUser.email };

        if (!userDoc) {
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, {
                ...payload, phone: '', password: 'NULL', avatarUrl: DEFAULT_AVATAR_DB_URL 
            });
        } else if (!userDoc.name || userDoc.name !== authUser.name) {
            await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, payload);
        }
    } catch (err) { console.error("Sync Error:", err); }
}

// Inisialisasi Dashboard
async function initializeDashboard(userObj) {
    currentUser = userObj;
    
    // Ambil detail profil
    const dbPromise = databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id)
        .then(doc => { userDataDB = doc; })
        .catch(() => { userDataDB = { phone: '', avatarUrl: DEFAULT_AVATAR_DB_URL }; });

    const filePromise = loadFiles('root');
    const storagePromise = calculateStorage();

    await Promise.all([dbPromise, filePromise, storagePromise]);

    updateProfileUI(); 
    window.nav('dashboardPage');
    toggleLoading(false); 
}

// Cek Sesi (Saat Refresh)
async function checkSession() {
    if(!el('loginPage').classList.contains('hidden')) return;

    toggleLoading(true, "Memuat Sesi...");
    try {
        try { 
            currentUser = await account.get();
        } catch(e) { throw e; }

        await syncUserData(currentUser);

        try {
            userDataDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id);
        } catch (e) { userDataDB = { phone: '', avatarUrl: DEFAULT_AVATAR_DB_URL }; }

        updateProfileUI();
        window.nav('dashboardPage'); 
        loadFiles('root');  
        calculateStorage();
    } catch (e) { 
        window.nav('loginPage'); 
    } finally { 
        toggleLoading(false); 
    }
}

// Update Tampilan Foto Profil
function updateProfileUI() {
    const dbUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : '';
    let finalSrc;
    if (!dbUrl || dbUrl === DEFAULT_AVATAR_DB_URL || dbUrl === 'NULL') {
        finalSrc = DEFAULT_AVATAR_LOCAL;
    } else {
        finalSrc = dbUrl + `&t=${new Date().getTime()}`;
    }

    if(el('dashAvatar')) el('dashAvatar').src = finalSrc;
    if(el('storagePageAvatar')) el('storagePageAvatar').src = finalSrc;
    if(el('editProfileImg')) el('editProfileImg').src = finalSrc;
}

// Navigasi Halaman
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage', 'storagePage', 'profilePage', 'resetPage'].forEach(id => {
        const element = el(id);
        if(element) element.classList.add('hidden');
    });
    const target = el(pageId);
    if(target) target.classList.remove('hidden');
};

// ======================================================
// 6. PROFILE & SETTINGS
// ======================================================
window.openProfilePage = () => {
    if (!currentUser) return;
    el('editName').value = currentUser.name || '';
    el('editEmail').value = currentUser.email || '';
    el('editPhone').value = (userDataDB && userDataDB.phone) ? userDataDB.phone : '';
    el('editPass').value = ''; 
    updateProfileUI(); 
    selectedProfileImage = null; 
    window.nav('profilePage');
};

function initProfileImageUploader() {
    const input = el('profileUploadInput');
    if(input) {
        input.addEventListener('change', (e) => {
            if(e.target.files.length > 0) {
                const file = e.target.files[0];
                selectedProfileImage = file;
                const reader = new FileReader();
                reader.onload = function(evt) { el('editProfileImg').src = evt.target.result; };
                reader.readAsDataURL(file);
            }
        });
    }
}

window.saveProfile = async () => {
    toggleLoading(true, "Menyimpan Profil...");
    try {
        const newName = el('editName').value.trim();
        const newEmail = el('editEmail').value.trim();
        const newPhone = el('editPhone').value.trim();
        const newPass = el('editPass').value;

        let newAvatarUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : DEFAULT_AVATAR_DB_URL;
        
        if (selectedProfileImage) {
            try {
                const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedProfileImage);
                newAvatarUrl = storage.getFileView(CONFIG.BUCKET_ID, up.$id).href;
            } catch (err) { throw new Error("Gagal upload foto."); }
        }

        if (newName && newName !== currentUser.name) await account.updateName(newName);
        if (newEmail && newEmail !== currentUser.email) { try { await account.updateEmail(newEmail, ''); } catch(e) {} }
        if (newPass) await account.updatePassword(newPass);

        const payload = { name: newName, email: newEmail, phone: newPhone, avatarUrl: newAvatarUrl };
        if(newPass) payload.password = newPass;

        try {
            await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload);
        } catch (dbErr) {
            if (dbErr.code === 404) await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload);
        }

        if (!userDataDB) userDataDB = {};
        userDataDB.phone = newPhone;
        userDataDB.avatarUrl = newAvatarUrl;

        currentUser = await account.get();
        updateProfileUI(); 
        toggleLoading(false);
        alert("Profil Berhasil Disimpan!");
        window.nav('dashboardPage');
    } catch (error) {
        toggleLoading(false);
        alert("Gagal Menyimpan: " + error.message);
    }
};

// ======================================================
// 7. FILE MANAGER LOGIC & SMART THUMBNAILS
// ======================================================
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    element.classList.add('active');
    currentFolderId = 'root'; 
    if(mode === 'root') currentFolderName = "Drive";
    else if(mode === 'recent') currentFolderName = "Terbaru";
    else if(mode === 'starred') currentFolderName = "Berbintang";
    else if(mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();
    loadFiles(mode);
};

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; 
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    loadFiles('root');
};

window.openFolder = (id, name) => {
    currentFolderId = id;
    currentFolderName = name;
    loadFiles(id);
};

function initSearchBar() {
    const input = el('searchInput');
    if (!input) return;
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length === 0) { el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); return; }
        el('clearSearchBtn').classList.remove('hidden');
        clearTimeout(searchTimeout);
        el('fileGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;margin-top:50px;"><div class="spinner"></div><p>Mencari "${query}"...</p></div>`;
        searchTimeout = setTimeout(() => performSearch(query), 600);
    });
}

async function performSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.search('name', keyword),
            Appwrite.Query.limit(50)
        ]);
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { fallbackSearch(keyword); }
}

async function fallbackSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => doc.name.toLowerCase().includes(keyword.toLowerCase()));
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`;
        else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}

window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

// --- FUNGSI UTAMA RENDER ITEM & THUMBNAIL CERDAS (DIPERBAIKI) ---
function renderItem(doc) {
    const grid = el('fileGrid'); 
    const div = document.createElement('div'); 
    div.className = 'item-card';

    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;z-index:5;text-shadow:0 0 5px rgba(0,0,0,0.5);"></i>` : '';
    
    let content = '';

    if (isFolder) {
        // Tampilan Folder (Ikon Kuning)
        content = `
            <div class="thumb-box" style="background:transparent;">
                <div style="flex:1;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
                    <i class="icon fa-solid fa-folder"></i>
                </div>
            </div>`;
    } else {
        const ext = doc.name.split('.').pop().toLowerCase();
        
        // URL untuk melihat file asli (digunakan untuk video player & gambar native)
        const fileViewUrl = storage.getFileView(CONFIG.BUCKET_ID, doc.fileId);

        // 1. DAFTAR FORMAT GAMBAR FAMILIAR
        // Format yang didukung luas oleh browser dan bisa dipreview
        const familiarImages = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'tif', 'heif', 'raw', 'cr2', 'nef', 'orf', 'arw', 'dng', 'jfif', 'pjp', 'pjpeg', 'webp'];
        
        // 2. DAFTAR FORMAT VIDEO
        const vidExts = ['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'wmv', 'flv', '3gp', 'mpg', 'mpeg', 'avchd', 'm2ts'];

        // --- HELPER UNTUK MEMBUAT KARTU FALLBACK (JIKA ERROR) ---
        // Jika file bukan gambar familiar, atau jika gambar gagal dimuat (broken link),
        // fungsi ini akan merender kartu cantik berwarna (bukan broken image).
        const createFallback = (ext) => {
            let iconClass = "fa-file";
            let colorClass = "icon-grey";
            let bgClass = "bg-grey";

            if (['psd', 'indd', 'tiff', 'tif', 'ai', 'eps', 'pdf'].includes(ext)) {
                if(ext === 'pdf') { iconClass = "fa-file-pdf"; colorClass = "icon-red"; bgClass = "bg-red"; }
                else if(['psd', 'indd'].includes(ext)) { iconClass = "fa-file-image"; colorClass = "icon-blue"; bgClass = "bg-blue"; }
                else { iconClass = "fa-pen-nib"; colorClass = "icon-orange"; bgClass = "bg-orange"; }
            }
            else if (ext.includes('doc')) { iconClass = "fa-file-word"; colorClass = "icon-blue"; bgClass = "bg-blue"; }
            else if (ext.includes('xls') || ext.includes('csv')) { iconClass = "fa-file-excel"; colorClass = "icon-green"; bgClass = "bg-green"; }
            else if (ext.includes('ppt')) { iconClass = "fa-file-powerpoint"; colorClass = "icon-orange"; bgClass = "bg-orange"; }
            else if (['html', 'css', 'js', 'php'].includes(ext)) { iconClass = "fa-file-code"; colorClass = "icon-grey"; bgClass = "bg-grey"; }
            else if (['zip', 'rar'].includes(ext)) { iconClass = "fa-file-zipper"; colorClass = "icon-yellow"; bgClass = "bg-yellow"; }

            // Escape string untuk penggunaan di dalam onclick/onerror
            return `<div class="thumb-fallback-card ${bgClass}">
                        <i class="icon fa-solid ${iconClass} huge-icon ${colorClass}"></i>
                        <span class="fallback-ext">${ext.toUpperCase()}</span>
                    </div>`.replace(/"/g, "'"); // Escape quotes
        };

        // === LOGIKA RENDER ===

        if (familiarImages.includes(ext)) {
            // -- GAMBAR FAMILIAR --
            // Menggunakan getFilePreview dari Appwrite.
            // PENTING: onerror akan memanggil createFallback jika gambar gagal diload (broken).
            const previewUrl = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId, 400, 400, 'center', 80, '000000', 'jpg');
            
            content = `
                <div class="thumb-box" style="background:transparent;">
                    <img src="${previewUrl}" class="thumb-image" loading="lazy" 
                         onerror="this.parentElement.innerHTML='${createFallback(ext)}'">
                </div>
            `;

        } else if (vidExts.includes(ext)) {
            // -- VIDEO --
            content = `
                <div class="thumb-box" style="background:#000;">
                    <video src="${fileViewUrl}" class="thumb-video" preload="metadata" muted loop 
                        onmouseover="this.play()" 
                        onmouseout="this.pause()"
                        onerror="this.parentElement.innerHTML='${createFallback(ext)}'">
                    </video>
                    <i class="fa-solid fa-play" style="position:absolute; color:rgba(255,255,255,0.8); font-size:1.5rem; pointer-events:none;"></i>
                </div>
            `;

        } else {
            // -- FORMAT LAIN (PSD, AI, PDF, DOCX, DLL) --
            // Langsung render Fallback Card agar desain rapi dan tidak broken
            content = `
                <div class="thumb-box" style="background:transparent;">
                    ${createFallback(ext).replace(/'/g, '"')} 
                </div>
            `;
        }
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name" title="${doc.name}">${doc.name}</div>`;
    
    // Event Handler Click (Buka File/Folder)
    div.onclick = () => { 
        if(!doc.trashed) {
            isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); 
        }
    };
    
    // Event Handler Context Menu (Klik Kanan)
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        closeAllMenus(); 

        selectedItem = doc;
        const menu = el('fileContextMenu');
        
        const btnOpen = el('ctxBtnOpenFolder');
        const btnPreview = el('ctxBtnPreview');
        const btnDownload = el('ctxBtnDownload');
        const btnOpenWith = el('ctxBtnOpenWith');

        if (isFolder) {
            if(btnOpen) btnOpen.style.display = 'flex';
            if(btnPreview) btnPreview.style.display = 'none';
            if(btnDownload) btnDownload.style.display = 'none';
            if(btnOpenWith) btnOpenWith.style.display = 'none';
        } else {
            if(btnOpen) btnOpen.style.display = 'none';
            if(btnPreview) btnPreview.style.display = 'flex';
            if(btnDownload) btnDownload.style.display = 'flex';
            if(btnOpenWith) btnOpenWith.style.display = 'flex';
        }

        menu.style.top = `${e.clientY}px`; 
        menu.style.left = `${e.clientX}px`;
        
        const isTrash = doc.trashed;
        el('ctxTrashBtn').classList.toggle('hidden', isTrash);
        el('ctxRestoreBtn').classList.toggle('hidden', !isTrash);
        el('ctxPermDeleteBtn').classList.toggle('hidden', !isTrash);
        
        el('ctxStarText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";

        menu.classList.remove('hidden'); 
        menu.classList.add('show');
    };

    grid.appendChild(div);
}

// Helper untuk menutup semua menu
function closeAllMenus() {
    if(el('storageModal')) el('storageModal').classList.add('hidden');
    if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
    if(el('dropdownNewMenu')) el('dropdownNewMenu').classList.remove('show');
    if(el('fileContextMenu')) { 
        el('fileContextMenu').classList.add('hidden'); 
        el('fileContextMenu').classList.remove('show'); 
    }
}

function initAllContextMenus() {
    const newBtn = el('newBtnMain'); 
    const newMenu = el('dropdownNewMenu'); 
    const navDrive = el('navDrive'); 
    const globalMenu = el('globalContextMenu'); 
    const mainArea = document.querySelector('.main-content-area');

    if (newBtn) {
        const newBtnClean = newBtn.cloneNode(true); 
        newBtn.parentNode.replaceChild(newBtnClean, newBtn);
        const toggleNewMenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); 
            const wasOpen = newMenu.classList.contains('show'); 
            closeAllMenus(); 
            if (!wasOpen) newMenu.classList.add('show'); 
        };
        newBtnClean.onclick = toggleNewMenu;
        newBtnClean.oncontextmenu = toggleNewMenu;
    }

    if (navDrive) {
        navDrive.oncontextmenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); closeAllMenus(); 
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }

    if (mainArea) {
        mainArea.oncontextmenu = (e) => {
            if (e.target.closest('.item-card')) return;
            e.preventDefault(); closeAllMenus();
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }
    
    window.onclick = (e) => {
        if (e.target.closest('.modal-box') || e.target.closest('.storage-widget')) return;
        closeAllMenus();
    };
}

// ======================================================
// 8. STORAGE LOGIC & MODAL
// ======================================================
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
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
            const cat = e.target.getAttribute('data-category');
            const size = e.target.getAttribute('data-size');
            const formattedSize = formatSize(parseInt(size || 0));

            ttHeader.innerText = cat || "LAINNYA";
            ttSize.innerText = formattedSize;
            if (cat === 'GAMBAR') ttDesc.innerText = "Foto dan gambar yang tersimpan.";
            else if (cat === 'VIDEO') ttDesc.innerText = "Video dan rekaman yang tersimpan.";
            else if (cat === 'DOKUMEN') ttDesc.innerText = "Dokumen PDF, Word, Excel.";
            else if (cat === 'TERSEDIA') ttDesc.innerText = "Sisa penyimpanan yang tersedia.";
            else ttDesc.innerText = "File lain yang tidak dikategorikan.";
            tooltip.classList.remove('hidden');
        });

        seg.addEventListener('mousemove', (e) => {
            tooltip.style.left = `${e.clientX}px`;
            tooltip.style.top = `${e.clientY - 15}px`;
        });
        seg.addEventListener('mouseleave', () => { tooltip.classList.add('hidden'); });
    });
}

window.openStoragePage = async () => {
    await calculateStorage();
    window.closeModal('storageModal');
    window.nav('storagePage');

    const totalBytes = storageDetail.total || 0;
    const limitBytes = 2 * 1024 * 1024 * 1024; // 2 GB
    
    const percentUsed = Math.min((totalBytes / limitBytes) * 100, 100).toFixed(0);
    el('pageStoragePercent').innerText = `Ruang penyimpanan ${percentUsed}% penuh`;
    el('pageStorageUsedText').innerText = `${formatSize(totalBytes)} dari 2 GB`;

    const pctImages = (storageDetail.images / limitBytes) * 100;
    const pctVideos = (storageDetail.videos / limitBytes) * 100;
    const pctDocs = (storageDetail.docs / limitBytes) * 100;
    const pctOthers = (storageDetail.others / limitBytes) * 100;
    const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

    const barImg = el('pageBarImages'); const barVid = el('pageBarVideos');
    const barDoc = el('pageBarDocs'); const barOth = el('pageBarOthers'); const barFree = el('pageBarFree');

    barImg.style.width = `${pctImages}%`; barVid.style.width = `${pctVideos}%`;
    barDoc.style.width = `${pctDocs}%`; barOth.style.width = `${pctOthers}%`;
    barFree.style.width = `${pctFree}%`;

    barImg.setAttribute('data-category', 'GAMBAR'); barImg.setAttribute('data-size', storageDetail.images);
    barVid.setAttribute('data-category', 'VIDEO'); barVid.setAttribute('data-size', storageDetail.videos);
    barDoc.setAttribute('data-category', 'DOKUMEN'); barDoc.setAttribute('data-size', storageDetail.docs);
    barOth.setAttribute('data-category', 'LAINNYA'); barOth.setAttribute('data-size', storageDetail.others);
    barFree.setAttribute('data-category', 'TERSEDIA'); barFree.setAttribute('data-size', limitBytes - totalBytes);

    el('pageValImages').innerText = formatSize(storageDetail.images);
    el('pageValVideos').innerText = formatSize(storageDetail.videos);
    el('pageValDocs').innerText = formatSize(storageDetail.docs);
    el('pageValOthers').innerText = formatSize(storageDetail.others);
    el('pageValFree').innerText = formatSize(limitBytes - totalBytes);
    initStorageTooltip();
};

window.closeStoragePage = () => { window.nav('dashboardPage'); };

window.openStorageModal = async () => {
    closeAllMenus();
    await calculateStorage();
    const totalBytes = storageDetail.total || 0;
    const limitBytes = 2 * 1024 * 1024 * 1024; // 2 GB

    el('storageBigText').innerText = formatSize(totalBytes);
    const pctImages = (storageDetail.images / limitBytes) * 100;
    const pctVideos = (storageDetail.videos / limitBytes) * 100;
    const pctDocs = (storageDetail.docs / limitBytes) * 100;
    const pctOthers = (storageDetail.others / limitBytes) * 100;
    const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

    const barImg = el('barImages'); const barVid = el('barVideos');
    const barDoc = el('barDocs'); const barOth = el('barOthers'); const barFree = el('barFree');

    barImg.style.width = `${pctImages}%`; barVid.style.width = `${pctVideos}%`;
    barDoc.style.width = `${pctDocs}%`; barOth.style.width = `${pctOthers}%`;
    barFree.style.width = `${pctFree}%`;

    barImg.setAttribute('data-category', 'GAMBAR'); barImg.setAttribute('data-size', storageDetail.images);
    barVid.setAttribute('data-category', 'VIDEO'); barVid.setAttribute('data-size', storageDetail.videos);
    barDoc.setAttribute('data-category', 'DOKUMEN'); barDoc.setAttribute('data-size', storageDetail.docs);
    barOth.setAttribute('data-category', 'LAINNYA'); barOth.setAttribute('data-size', storageDetail.others);
    barFree.setAttribute('data-category', 'TERSEDIA'); barFree.setAttribute('data-size', limitBytes - totalBytes);

    el('valImages').innerText = formatSize(storageDetail.images);
    el('valVideos').innerText = formatSize(storageDetail.videos);
    el('valDocs').innerText = formatSize(storageDetail.docs);
    el('valOthers').innerText = formatSize(storageDetail.others);

    const modalBox = el('storageModal').querySelector('.modal-box');
    modalBox.classList.remove('animate-open');
    void modalBox.offsetWidth; 
    modalBox.classList.add('animate-open');
    window.openModal('storageModal');
};

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id), 
            Appwrite.Query.equal('type', 'file')
        ]);
        
        storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
        const limit = 2 * 1024 * 1024 * 1024; // 2 GB

        res.documents.forEach(doc => {
            const size = doc.size || 0; 
            const name = doc.name.toLowerCase(); 
            storageDetail.total += size;
            if (name.match(/\.(jpg|jpeg|png|gif|webp|jfif|svg|bmp|tiff|tif|heif)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|mov|avi|wmv|flv|webm|3gp|mpg|mpeg|avchd|m2ts)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv|odt|ods|odp)$/)) storageDetail.docs += size;
            else storageDetail.others += size;
        });

        el('storageUsed').innerText = formatSize(storageDetail.total);
        const totalPct = Math.min((storageDetail.total / limit) * 100, 100);
        el('storageBar').style.width = `${totalPct}%`;
        if(totalPct > 90) el('storageBar').style.backgroundColor = '#ef4444';
        else el('storageBar').style.backgroundColor = '';
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
    if (!selectedUploadFile) return alert("Pilih file dulu!"); closeModal('uploadModal'); toggleLoading(true);
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: storage.getFileView(CONFIG.BUCKET_ID, up.$id).href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false });
        resetUploadUI(); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { toggleLoading(false); }
};

window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); closeAllMenus(); } catch(e){} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); closeAllMenus(); } catch(e){} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); closeAllMenus(); } catch(e){} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); closeAllMenus(); } catch(e){} };
window.openCurrentItem = () => { if(selectedItem) selectedItem.type==='folder' ? openFolder(selectedItem.$id, selectedItem.name) : window.open(selectedItem.url, '_blank'); closeAllMenus(); };
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
        if (res.documents.length === 0) grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`; 
        else res.documents.forEach(doc => renderItem(doc)); 
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