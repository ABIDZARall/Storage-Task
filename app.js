// ======================================================
// 1. KONFIGURASI APPWRITE & GLOBAL
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI PROYEK (Sesuaikan dengan Project ID Anda)
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

// API SheetDB untuk Pencatatan Excel
const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi'; 

// URL & File Gambar Profil Default
const DEFAULT_AVATAR_LOCAL = 'profile-default.jpeg'; 
const DEFAULT_AVATAR_DB_URL = 'https://cloud.appwrite.io/v1/storage/buckets/default/files/default/view';

// Inisialisasi SDK
client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// State Global (Penyimpanan Data Sementara di Memori Browser)
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

// ======================================================
// 2. UTILITY & HELPER FUNCTIONS
// ======================================================

// Helper untuk mengambil elemen HTML berdasarkan ID
const el = (id) => document.getElementById(id);

// Helper untuk menampilkan/menyembunyikan Loading Overlay
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

// Helper Cek Koneksi Internet
function checkSystemHealth() {
    if (!navigator.onLine) {
        throw new Error("Tidak ada koneksi internet. Periksa jaringan Anda.");
    }
    return true;
}

// Helper untuk navigasi antar halaman (Login, Dashboard, dll)
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage', 'storagePage', 'profilePage', 'resetPage'].forEach(id => {
        const element = el(id);
        if(element) element.classList.add('hidden');
    });
    const target = el(pageId);
    if(target) target.classList.remove('hidden');
};

// Helper Toggle Password (Spy Eye)
window.togglePass = (id, icon) => { 
    const input = document.getElementById(id); 
    if (input.type === "password") { 
        input.type = "text"; 
        icon.classList.remove("fa-eye-slash"); 
        icon.classList.add("fa-eye"); 
    } else { 
        input.type = "password"; 
        icon.classList.remove("fa-eye"); 
        icon.classList.add("fa-eye-slash"); 
    } 
};

// ======================================================
// 3. FUNGSI LOGGING KE EXCEL (SHEETDB)
// ======================================================
async function recordActivity(sheetName, data) {
    try {
        // Format Waktu Indonesia (WIB)
        const now = new Date().toLocaleString('id-ID', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).replace(/\./g, ':'); 

        let payload = {};

        // Mapping data sesuai Sheet yang dituju
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

        // Kirim ke SheetDB
        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: payload })
        });
        
        console.log(`Log Excel [${sheetName}] berhasil dicatat.`);

    } catch (error) {
        console.error("Gagal mencatat Log Excel:", error);
    }
}

// ======================================================
// 4. MAIN EXECUTION (SAAT APLIKASI DIBUKA)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Cek Sesi segera saat aplikasi dibuka untuk mencegah "kelempar ke login"
    checkSession(); 
    
    // 2. Inisialisasi fitur-fitur UI
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus();
    initStorageTooltip();
    initProfileImageUploader(); 
});

// ======================================================
// 5. MANAJEMEN SESI (PERBAIKAN LOGIKA "NYANGKUT")
// ======================================================

async function checkSession() {
    // Tampilkan loading agar transisi halus
    toggleLoading(true, "Memuat Data Pengguna...");
    
    try {
        // Coba ambil data user dari Appwrite Auth
        const user = await account.get();
        
        // Jika berhasil, berarti user SUDAH login (Sesi Valid)
        console.log("Sesi ditemukan untuk:", user.name);
        currentUser = user;
        
        // Lakukan sinkronisasi database (Self-Healing)
        await syncUserData(user);
        
        // Inisialisasi dan masuk ke Dashboard
        await initializeDashboard(user);

    } catch (error) {
        // Jika error (401 Unauthorized), berarti user belum login
        console.log("Tidak ada sesi aktif, masuk ke halaman Login.");
        window.nav('loginPage');
    } finally {
        toggleLoading(false);
    }
}

// Fungsi untuk menyiapkan data Dashboard setelah Login/Check Session
async function initializeDashboard(userObj) {
    currentUser = userObj;
    
    // 1. Ambil detail profil (No HP, Avatar) dari Database Users
    const dbPromise = databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id)
        .then(doc => { userDataDB = doc; })
        .catch(() => { 
            // Fallback jika data DB belum ada (baru register)
            userDataDB = { phone: '', avatarUrl: DEFAULT_AVATAR_DB_URL }; 
        });

    // 2. Load file-file di folder root
    const filePromise = loadFiles('root');
    
    // 3. Hitung penggunaan penyimpanan
    const storagePromise = calculateStorage();

    // Jalankan semua secara paralel agar cepat
    await Promise.all([dbPromise, filePromise, storagePromise]);

    updateProfileUI(); // Update foto profil di pojok kanan atas
    window.nav('dashboardPage'); // Pindah ke layar Dashboard
}

// Fungsi Self-Healing: Pastikan data user ada di Database 'users'
async function syncUserData(authUser) {
    if (!authUser) return;
    try {
        let userDoc;
        try {
            userDoc = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id);
        } catch (e) {
            if (e.code === 404) userDoc = null; 
        }

        const payload = {
            name: authUser.name,     
            email: authUser.email    
        };

        if (!userDoc) {
            // Jika tidak ada di DB, buat baru
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, {
                ...payload,
                phone: '', 
                password: 'NULL', 
                avatarUrl: DEFAULT_AVATAR_DB_URL 
            });
        } else {
            // Jika ada, update nama/email jika berubah
            if (!userDoc.name || userDoc.name === 'NULL' || userDoc.name !== authUser.name) {
                await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, payload);
            }
        }
    } catch (err) {
        console.error("Sync Error:", err);
    }
}

// ======================================================
// 6. LOGIKA AUTHENTICATION (LOGIN, SIGN UP, LOGOUT)
// ======================================================

// --- A. SIGN UP (DUAL WRITE) ---
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value.trim();
        const email = el('regEmail').value.trim();
        const phone = el('regPhone').value.trim();
        const pass = el('regPass').value;
        const verify = el('regVerify').value;

        if (pass !== verify) return alert("Konfirmasi password tidak cocok!");
        
        toggleLoading(true, "Mendaftarkan Akun...");
        
        try {
            checkSystemHealth();
            const newUserId = Appwrite.ID.unique(); 

            // 1. Create Auth Account
            await account.create(newUserId, email, pass, name);
            
            // 2. Auto Login (untuk izin tulis DB)
            try { await account.createEmailPasswordSession(email, pass); } catch(e){ console.warn(e); }

            // 3. Simpan ke Database Users
            try {
                await databases.createDocument(
                    CONFIG.DB_ID, 
                    CONFIG.COLLECTION_USERS, 
                    newUserId, 
                    { 
                        email: email, 
                        phone: phone, 
                        name: name,
                        password: pass, 
                        avatarUrl: DEFAULT_AVATAR_DB_URL 
                    }
                ); 
            } catch (dbError) { console.error("DB Error:", dbError); }

            // 4. Catat ke Excel (SignUp)
            recordActivity('SignUp', { 
                id: newUserId, name: name, email: email, phone: phone, password: pass 
            }).catch(e => console.log(e));
            
            // 5. Logout sesi sementara
            try { await account.deleteSession('current'); } catch (e) {}
            
            toggleLoading(false);
            alert("Pendaftaran Berhasil! Silakan Login."); 
            window.nav('loginPage');

        } catch(e) { 
            toggleLoading(false);
            if(e.message.includes('exists') || e.code === 409) alert("Email atau Username sudah terdaftar!"); 
            else alert("Error: " + e.message);
        }
    });
}

// --- B. LOGIN (DENGAN VALIDASI PASSWORD DATABASE & BYPASS) ---
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        try {
            toggleLoading(true, "Memeriksa Akun...");
            checkSystemHealth();

            // 1. Resolusi Username -> Email (Jika input bukan email)
            if (!inputId.includes('@')) {
                try {
                    const res = await databases.listDocuments(
                        CONFIG.DB_ID, 
                        CONFIG.COLLECTION_USERS, 
                        [ Appwrite.Query.equal('name', inputId) ]
                    );
                    if (res.documents.length > 0) inputId = res.documents[0].email;
                    else throw new Error("Username tidak ditemukan.");
                } catch(dbErr) { throw dbErr; }
            }

            // 2. VALIDASI PASSWORD DATABASE (LOGIKA EXPIRED)
            // Kunci Keamanan: Cek password di DB Users dulu sebelum ke Auth.
            // Jika user reset password, DB berubah. Jika input != DB, tolak.
            toggleLoading(true, "Memvalidasi Password...");
            let dbUser = null;
            try {
                const userCheck = await databases.listDocuments(
                    CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('email', inputId) ]
                );

                if (userCheck.documents.length > 0) {
                    dbUser = userCheck.documents[0];
                    const dbPass = dbUser.password;
                    // Jika password di DB ada (bukan NULL) dan berbeda dengan input
                    if (dbPass && dbPass !== pass && dbPass !== 'NULL') {
                        throw new Error("Password salah atau sudah kadaluarsa (Expired). Gunakan password terbaru.");
                    }
                } else {
                    throw new Error("Akun tidak ditemukan.");
                }
            } catch (validationErr) { throw validationErr; }

            // 3. EKSEKUSI LOGIN KE APPWRITE
            toggleLoading(true, "Masuk...");
            let authSuccess = false;
            try {
                await account.createEmailPasswordSession(inputId, pass);
                authSuccess = true;
            } catch (authErr) {
                // BYPASS LOGIC: Jika error "Session active", anggap sukses
                // Ini mengatasi masalah "user nyangkut"
                if (authErr.message.includes('session is active') || authErr.code === 401) {
                    console.log("Sesi aktif terdeteksi, melanjutkan login...");
                    authSuccess = true;
                } else {
                    console.warn("Auth Failed:", authErr);
                }
            }

            // 4. PROSES DATA USER SETELAH LOGIN
            let user;
            if (authSuccess) {
                // Ambil data user asli dari sesi
                try {
                    user = await account.get();
                } catch (getErr) {
                    // Jika get() gagal, gunakan data dari DB (Fallback)
                    user = { $id: dbUser.$id, name: dbUser.name, email: dbUser.email, phone: dbUser.phone };
                }
                
                // Sync DB jika perlu
                await syncUserData(user);
                
                // Catat ke Excel (Login)
                recordActivity('Login', { 
                    id: user.$id, name: user.name, email: user.email, password: pass 
                }).catch(e => console.log(e));

                // Masuk Dashboard
                await initializeDashboard(user);

            } else {
                throw new Error("Gagal membuat sesi login.");
            }

        } catch (error) { 
            toggleLoading(false);
            let msg = error.message;
            if(msg.includes('Invalid credentials')) msg = "Email/Username atau Password salah.";
            alert("Login Gagal: " + msg);
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
                
                // Catat Log Logout (Await agar selesai sebelum reload)
                if (currentUser) {
                    await recordActivity('Logout', { 
                        id: currentUser.$id, 
                        name: currentUser.name,
                        email: currentUser.email 
                    });
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
            // 1. Cari user di DB
            const res = await databases.listDocuments(
                CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [ Appwrite.Query.equal('email', email) ]
            );

            if (res.documents.length === 0) throw new Error("Email tidak ditemukan di database.");
            const userDoc = res.documents[0];

            toggleLoading(true, "Mengupdate Password Database...");
            
            // 2. Update Password di Database Users
            await databases.updateDocument(
                CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userDoc.$id, { password: newPass }
            );

            toggleLoading(true, "Mengupdate Data Excel...");
            
            // 3. Update Excel Sheet SignUp
            await fetch(`${SHEETDB_API}/Email/${email}?sheet=SignUp`, {
                method: 'PATCH', 
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ "data": { "Password": newPass } })
            });

            // 4. Update Excel Sheet Login
            await fetch(`${SHEETDB_API}/Email/${email}?sheet=Login`, {
                method: 'PATCH', 
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ "data": { "Password": newPass } })
            });
            
            toggleLoading(false);
            alert("Berhasil! Password telah diperbarui.\nPassword lama kadaluarsa.");
            window.nav('loginPage');

        } catch (error) {
            toggleLoading(false);
            alert("Gagal Reset Password: " + error.message);
        }
    });
}

// ======================================================
// 7. FILE MANAGER LOGIC (THUMBNAIL UPDATE)
// ======================================================

// Helper Ekstensi File
function getFileExtension(filename) { 
    return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase(); 
}

// Fungsi Render Item dengan Thumbnail Google Drive Style
function renderItem(doc) {
    const grid = el('fileGrid'); 
    const div = document.createElement('div'); 
    div.className = 'item-card';

    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;z-index:2;"></i>` : '';
    
    let content = '';
    const ext = getFileExtension(doc.name);

    if (isFolder) {
        content = `<i class="icon fa-solid fa-folder" style="font-size:4rem;color:#facc15;"></i>`;
    } else {
        // Daftar ekstensi file
        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heif'];
        const vidExts = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'wmv', 'flv', '3gp', 'mpeg', 'mpg'];
        const wordExts = ['doc', 'docx']; 
        const excelExts = ['xls', 'xlsx', 'csv']; 
        const pptExts = ['ppt', 'pptx']; 
        const pdfAdobeExts = ['pdf', 'psd', 'ai', 'eps', 'indd'];

        if (imgExts.includes(ext)) {
            // Thumbnail Gambar
            const previewUrl = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId, 300, 300).href;
            content = `<div class="thumb-container"><img src="${previewUrl}" class="thumb-img" alt="${doc.name}"></div>`;
        } else if (vidExts.includes(ext)) {
            // Thumbnail Video (Mini Player)
            const viewUrl = storage.getFileView(CONFIG.BUCKET_ID, doc.fileId).href;
            content = `<div class="thumb-container">
                        <video src="${viewUrl}" class="thumb-video" muted playsinline onmouseover="this.play()" onmouseout="this.pause()"></video>
                        <i class="fa-solid fa-play" style="position:absolute;color:white;font-size:1.5rem;opacity:0.8;pointer-events:none;"></i>
                       </div>`;
        } else if (wordExts.includes(ext)) {
            content = `<div class="thumb-icon icon-blue"><i class="fa-solid fa-file-word"></i></div>`;
        } else if (excelExts.includes(ext)) {
            content = `<div class="thumb-icon icon-green"><i class="fa-solid fa-file-excel"></i></div>`;
        } else if (pptExts.includes(ext)) {
            content = `<div class="thumb-icon icon-orange"><i class="fa-solid fa-file-powerpoint"></i></div>`;
        } else if (pdfAdobeExts.includes(ext)) {
            let iconClass = 'fa-file-pdf'; 
            if(ext === 'psd' || ext === 'ai' || ext === 'indd') iconClass = 'fa-file-image'; 
            content = `<div class="thumb-icon icon-red"><i class="fa-solid ${iconClass}"></i></div>`;
        } else {
            content = `<div class="thumb-icon icon-grey"><i class="fa-solid fa-file"></i></div>`;
        }
    }

    const nameHTML = `<div class="item-name-box"><div class="item-name" title="${doc.name}">${doc.name}</div></div>`;

    div.innerHTML = `${starHTML}${content}${nameHTML}`;
    
    // Event Click & Context Menu
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(el('storageModal')) el('storageModal').classList.add('hidden');
        if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
        if(el('dropdownNewMenu')) el('dropdownNewMenu').classList.remove('show');

        selectedItem = doc;
        const menu = el('fileContextMenu');
        
        // Atur tampilan menu berdasarkan tipe file
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

// ======================================================
// 8. FUNGSI STANDAR LAINNYA (Search, Upload, Profile)
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

function initAllContextMenus() {
    const newBtn = el('newBtnMain'); 
    const newMenu = el('dropdownNewMenu'); 
    const navDrive = el('navDrive'); 
    const globalMenu = el('globalContextMenu'); 
    const fileMenu = el('fileContextMenu'); 
    const mainArea = document.querySelector('.main-content-area');

    const closeAll = () => {
        if(newMenu) newMenu.classList.remove('show');
        if(globalMenu) globalMenu.classList.remove('show');
        if(fileMenu) { fileMenu.classList.add('hidden'); fileMenu.classList.remove('show'); }
    };

    if (newBtn) {
        const newBtnClean = newBtn.cloneNode(true); 
        newBtn.parentNode.replaceChild(newBtnClean, newBtn);
        const toggleNewMenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); 
            const wasOpen = newMenu.classList.contains('show'); 
            closeAll(); 
            if (!wasOpen) newMenu.classList.add('show'); 
        };
        newBtnClean.onclick = toggleNewMenu;
        newBtnClean.oncontextmenu = toggleNewMenu;
    }

    if (navDrive) {
        navDrive.oncontextmenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); closeAll(); 
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }

    if (mainArea) {
        mainArea.oncontextmenu = (e) => {
            if (e.target.closest('.item-card')) return;
            e.preventDefault(); closeAll();
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }
    
    window.onclick = (e) => {
        if (e.target.closest('.modal-box') || e.target.closest('.storage-widget')) return;
        closeAll();
    };
}

// Storage Logic
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
    updateStorageUI();
};

window.closeStoragePage = () => { window.nav('dashboardPage'); };

window.openStorageModal = async () => {
    if(el('fileContextMenu')) el('fileContextMenu').classList.remove('show');
    if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
    if(el('dropdownNewMenu')) el('dropdownNewMenu').classList.remove('show');

    await calculateStorage();
    updateStorageUI();

    const modalBox = el('storageModal').querySelector('.modal-box');
    modalBox.classList.remove('animate-open');
    void modalBox.offsetWidth; 
    modalBox.classList.add('animate-open');
    window.openModal('storageModal');
};

function updateStorageUI() {
    const totalBytes = storageDetail.total || 0;
    const limitBytes = 2 * 1024 * 1024 * 1024; // 2 GB
    const percentUsed = Math.min((totalBytes / limitBytes) * 100, 100).toFixed(0);
    
    // Update Page Elements
    if(el('pageStoragePercent')) el('pageStoragePercent').innerText = `Ruang penyimpanan ${percentUsed}% penuh`;
    if(el('pageStorageUsedText')) el('pageStorageUsedText').innerText = `${formatSize(totalBytes)} dari 2 GB`;
    
    // Update Modal Elements
    if(el('storageBigText')) el('storageBigText').innerText = formatSize(totalBytes);
    
    // Update Bars
    const pctImages = (storageDetail.images / limitBytes) * 100;
    const pctVideos = (storageDetail.videos / limitBytes) * 100;
    const pctDocs = (storageDetail.docs / limitBytes) * 100;
    const pctOthers = (storageDetail.others / limitBytes) * 100;
    const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

    // Helper update bar & value
    const setBar = (prefix) => {
        if(el(prefix + 'BarImages')) el(prefix + 'BarImages').style.width = `${pctImages}%`;
        if(el(prefix + 'BarVideos')) el(prefix + 'BarVideos').style.width = `${pctVideos}%`;
        if(el(prefix + 'BarDocs')) el(prefix + 'BarDocs').style.width = `${pctDocs}%`;
        if(el(prefix + 'BarOthers')) el(prefix + 'BarOthers').style.width = `${pctOthers}%`;
        if(el(prefix + 'BarFree')) el(prefix + 'BarFree').style.width = `${pctFree}%`;

        if(el(prefix + 'ValImages')) el(prefix + 'ValImages').innerText = formatSize(storageDetail.images);
        if(el(prefix + 'ValVideos')) el(prefix + 'ValVideos').innerText = formatSize(storageDetail.videos);
        if(el(prefix + 'ValDocs')) el(prefix + 'ValDocs').innerText = formatSize(storageDetail.docs);
        if(el(prefix + 'ValOthers')) el(prefix + 'ValOthers').innerText = formatSize(storageDetail.others);
    };

    setBar('page'); // Storage Page
    setBar('');     // Modal Storage
    
    initStorageTooltip();
}

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
            if (name.match(/\.(jpg|jpeg|png|gif|webp|jfif|svg|bmp)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|mov|avi|wmv|flv|webm)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv)$/)) storageDetail.docs += size;
            else storageDetail.others += size;
        });

        // Small bar in sidebar
        const totalPct = Math.min((storageDetail.total / limit) * 100, 100);
        if(el('storageUsed')) el('storageUsed').innerText = formatSize(storageDetail.total);
        if(el('storageBar')) {
            el('storageBar').style.width = `${totalPct}%`;
            el('storageBar').style.backgroundColor = totalPct > 90 ? '#ef4444' : '';
        }
    } catch (e) { console.error("Gagal hitung storage:", e); }
}

// Modal & File Ops Helpers
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

// Item Actions
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); el('fileContextMenu').classList.remove('show'); el('fileContextMenu').classList.add('hidden'); } catch(e){} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); el('fileContextMenu').classList.remove('show'); el('fileContextMenu').classList.add('hidden'); } catch(e){} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); el('fileContextMenu').classList.remove('show'); el('fileContextMenu').classList.add('hidden'); } catch(e){} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); el('fileContextMenu').classList.remove('show'); el('fileContextMenu').classList.add('hidden'); } catch(e){} };
window.openCurrentItem = () => { if(selectedItem) selectedItem.type==='folder' ? openFolder(selectedItem.$id, selectedItem.name) : window.open(selectedItem.url, '_blank'); el('fileContextMenu').classList.remove('show'); el('fileContextMenu').classList.add('hidden'); };
window.downloadCurrentItem = () => { if(selectedItem && selectedItem.type!=='folder') window.open(storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId), '_blank'); el('fileContextMenu').classList.remove('show'); el('fileContextMenu').classList.add('hidden'); };
window.renameCurrentItem = async () => { const newName = prompt("Nama baru:", selectedItem.name); if(newName) { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {name: newName}); loadFiles(currentFolderId); } el('fileContextMenu').classList.remove('show'); el('fileContextMenu').classList.add('hidden'); };

function resetUploadUI() { selectedUploadFile = null; el('fileInfoContainer').classList.add('hidden'); el('fileInputHidden').value = ''; }
function handleFileSelect(file) { selectedUploadFile = file; el('fileInfoText').innerText = `Terpilih: ${file.name}`; el('fileInfoContainer').classList.remove('hidden'); }
function initDragAndDrop() {
    const zone = el('dropZone'); const input = el('fileInputHidden'); if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('active')); 
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('active'); if(e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]); });
    if(input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

// Update Header Logic
function updateHeaderUI() { 
    const container = document.querySelector('.breadcrumb-area'); const isRoot = currentFolderId === 'root' && currentViewMode === 'root'; 
    if (isRoot) { 
        const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night"; 
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`; 
    } else { 
        container.innerHTML = `<div class="back-nav-container"><button onclick="goBack()" class="back-btn"><i class="fa-solid fa-arrow-left"></i> Kembali ke Drive</button><h2 id="headerTitle" style="margin-top:10px;">${currentFolderName}</h2></div>`; 
    } 
}

// Load Files Logic
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