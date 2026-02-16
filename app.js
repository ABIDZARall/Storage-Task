// ======================================================
// 1. KONFIGURASI APPWRITE & GLOBAL
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// URL Foto Profil Default
const DEFAULT_AVATAR = 'profile-default.jpeg';

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
    // Cek session tanpa memicu error visual jika gagal
    checkSession(true); 
    
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus();
    initStorageTooltip();
    initProfileImageUploader(); 
});

// ======================================================
// 3. LOGIKA OTENTIKASI & SMART SYNC (DIPERBAIKI)
// ======================================================

// FUNGSI PINTAR: SINKRONISASI OTOMATIS AUTH KE DATABASE
async function syncUserData(authUser) {
    if (!authUser) return;
    
    try {
        let userDoc;
        try {
            userDoc = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id);
        } catch (e) {
            // Jika dokumen tidak ditemukan (404), kita lanjut untuk membuatnya
            if (e.code !== 404) throw e;
            userDoc = null; 
        }

        const payload = {
            name: authUser.name,     
            email: authUser.email    
        };

        if (!userDoc) {
            console.log("Smart Sync: Membuat data database baru...");
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, {
                ...payload,
                phone: '',
                avatarUrl: ''
            });
        } else {
            // Hanya update jika nama berbeda/kosong
            if (!userDoc.name || userDoc.name === 'NULL' || userDoc.name !== authUser.name) {
                console.log("Smart Sync: Sinkronisasi data...");
                await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, authUser.$id, payload);
            }
        }
    } catch (err) {
        // Error permission diabaikan agar tidak mengganggu UX login
        console.warn("Smart Sync Background Info:", err.message);
    }
}

// *** PERBAIKAN UTAMA PADA FUNGSI LOGIN ***
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        toggleLoading(true, "Sedang Masuk...");
        
        try {
            // 1. DETEKSI: Apakah input Username (tidak ada @) atau Email?
            if (!inputId.includes('@')) {
                // USER MENGETIK USERNAME
                try {
                    const res = await databases.listDocuments(
                        CONFIG.DB_ID, 
                        CONFIG.COLLECTION_USERS, 
                        [ Appwrite.Query.equal('name', inputId) ]
                    );

                    if (res.documents.length > 0) {
                        // SUKSES: Username ditemukan
                        console.log("Login via Username ditemukan ->", res.documents[0].email);
                        inputId = res.documents[0].email;
                    } else {
                        throw new Error("Username tidak ditemukan.");
                    }
                } catch(dbErr) {
                    // *** PENANGANAN ERROR SPESIFIK ***
                    // Jika errornya adalah "Missing Scopes" (401) atau Permission Denied
                    if (dbErr.code === 401 || dbErr.message.toLowerCase().includes('scope') || dbErr.message.toLowerCase().includes('permission')) {
                        toggleLoading(false);
                        alert("Untuk alasan keamanan data, harap Login menggunakan EMAIL Anda.");
                        return; // Hentikan proses
                    } else if (dbErr.message === "Username tidak ditemukan.") {
                        throw new Error("Username tidak ditemukan. Coba gunakan Email.");
                    } else {
                        // Error koneksi lain
                        throw dbErr;
                    }
                }
            }

            // 2. EKSEKUSI LOGIN (Appwrite Butuh Email)
            try {
                await account.createEmailPasswordSession(inputId, pass);
            } catch (authError) {
                // === FIX UTAMA DISINI ===
                // Jangan sembarang menangkap error 401 sebagai "sukses/session active".
                // Kita harus membedakan antara "Password Salah" dan "Sesi Sudah Aktif".
                
                const msg = authError.message ? authError.message.toLowerCase() : "";
                const isSessionActive = authError.type === 'user_session_already_active' || msg.includes('active') || msg.includes('session');

                if (isSessionActive) {
                    console.log("Sesi sudah aktif, melanjutkan...");
                } else {
                    // Jika BUKAN sesi aktif, berarti ini error Login asli (Invalid Credentials, User Missing, dll)
                    // Lempar error ini agar ditangkap oleh catch di bawah dan menampilkan alert yang benar.
                    throw authError;
                }
            }
            
            // 3. SETELAH LOGIN SUKSES
            const user = await account.get();
            await syncUserData(user); 
            
            // Log Activity (Silent)
            recordActivity('Login', { id: user.$id, name: user.name, email: user.email, phone: "-", password: "CONFIDENTIAL" }).catch(err => console.log("Log skip"));

            checkSession(); 

        } catch (error) { 
            toggleLoading(false);
            // Tampilkan pesan error yang bersih (tanpa kode teknis)
            let cleanMsg = error.message;
            
            // Translate error Appwrite yang umum
            if(cleanMsg.includes('Invalid credentials') || cleanMsg.includes('user_invalid_credentials')) {
                cleanMsg = "Email atau Password salah.";
            } else if(cleanMsg.includes('Rate limit')) {
                cleanMsg = "Terlalu banyak percobaan. Tunggu beberapa saat.";
            } else if(cleanMsg.includes('not found')) {
                 cleanMsg = "Akun tidak ditemukan.";
            }

            alert(cleanMsg);
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

        if (pass !== verify) return alert("Konfirmasi password tidak cocok!");
        
        toggleLoading(true, "Mendaftarkan...");
        try {
            // 1. Buat Akun Auth
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            
            // 2. Login Otomatis agar bisa tulis ke Database
            await account.createEmailPasswordSession(email, pass);

            // 3. Simpan Data ke Database (Sekarang sudah punya izin karena sudah login)
            try { 
                await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { 
                    email: email, 
                    phone: phone,
                    name: name,
                    avatarUrl: ''
                }); 
            } catch(dbErr) {
                console.error("Silent DB Register Error:", dbErr);
            }
            
            await recordActivity('SignUp', { id: auth.$id, name, email, phone, password: "CONFIDENTIAL" });
            
            toggleLoading(false);
            alert("Pendaftaran Berhasil!"); 
            checkSession(); // Langsung masuk dashboard
        } catch(e) { 
            toggleLoading(false);
            if(e.message.includes('exists')) alert("Email atau Username sudah terdaftar."); 
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
                } catch (error) { console.log(error); }
                window.location.reload(); 
            }
        });
    }
}

// ======================================================
// 4. NAVIGASI & SESI
// ======================================================
async function checkSession(isFirstLoad = false) {
    // Jangan tampilkan loading full screen saat cek sesi awal agar UX lebih halus
    if(!isFirstLoad && !el('loginPage').classList.contains('hidden')) toggleLoading(true, "Memuat Data...");

    try {
        currentUser = await account.get();
        
        // PANGGIL SMART SYNC
        await syncUserData(currentUser);

        try {
            userDataDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id);
        } catch (e) {
            userDataDB = { phone: '', avatarUrl: '' };
        }

        updateProfileUI();

        window.nav('dashboardPage'); 
        loadFiles('root');  
        calculateStorage();
        if(!isFirstLoad) toggleLoading(false);
        
    } catch (e) { 
        // Jika gagal ambil sesi (Guest), arahkan ke Login
        window.nav('loginPage'); 
        if(!isFirstLoad) toggleLoading(false);
    }
}

// UPDATE UI PROFIL
function updateProfileUI() {
    const dbUrl = (userDataDB && userDataDB.avatarUrl) ? userDataDB.avatarUrl : '';
    const avatarSrc = dbUrl || DEFAULT_AVATAR;
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
    el('editPhone').value = (userDataDB ? userDataDB.phone : '') || '';
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
                console.warn("Avatar upload failed:", err);
            }
        }

        if (newName && newName !== currentUser.name) {
            await account.updateName(newName);
        }

        if (newEmail && newEmail !== currentUser.email) {
            try {
                await account.updateEmail(newEmail, ''); 
            } catch(e) { console.warn("Email update notice:", e.message); }
        }

        if (newPass) {
            await account.updatePassword(newPass);
        }

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
        alert("Info: " + error.message);
    }
};

// ======================================================
// 6. FILE MANAGER & SEARCH
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

// Search Engine
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
    if(!currentUser) return;
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
    if(!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => doc.name.toLowerCase().includes(keyword.toLowerCase()));
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`;
        else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}

window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

// KONTROL MENU & KLIK KANAN
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

// Render Item
function renderItem(doc) {
    const grid = el('fileGrid'); const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp|jfif)$/i)) {
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }
    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(el('storageModal')) el('storageModal').classList.add('hidden');
        if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
        if(el('dropdownNewMenu')) el('dropdownNewMenu').classList.remove('show');

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

// ======================================================
// 7. STORAGE LOGIC & MODAL POPUP & TOOLTIP
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

        seg.addEventListener('mouseleave', () => {
            tooltip.classList.add('hidden');
        });
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

    const barImg = el('pageBarImages');
    const barVid = el('pageBarVideos');
    const barDoc = el('pageBarDocs');
    const barOth = el('pageBarOthers');
    const barFree = el('pageBarFree');

    barImg.style.width = `${pctImages}%`;
    barVid.style.width = `${pctVideos}%`;
    barDoc.style.width = `${pctDocs}%`;
    barOth.style.width = `${pctOthers}%`;
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

window.closeStoragePage = () => {
    window.nav('dashboardPage');
};

window.openStorageModal = async () => {
    if(el('fileContextMenu')) el('fileContextMenu').classList.remove('show');
    if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
    if(el('dropdownNewMenu')) el('dropdownNewMenu').classList.remove('show');

    await calculateStorage();

    const totalBytes = storageDetail.total || 0;
    const limitBytes = 2 * 1024 * 1024 * 1024; // 2 GB

    const formattedTotal = formatSize(totalBytes);
    el('storageBigText').innerText = formattedTotal;

    const pctImages = (storageDetail.images / limitBytes) * 100;
    const pctVideos = (storageDetail.videos / limitBytes) * 100;
    const pctDocs = (storageDetail.docs / limitBytes) * 100;
    const pctOthers = (storageDetail.others / limitBytes) * 100;
    const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

    const barImg = el('barImages');
    const barVid = el('barVideos');
    const barDoc = el('barDocs');
    const barOth = el('barOthers');
    const barFree = el('barFree');

    barImg.style.width = `${pctImages}%`;
    barVid.style.width = `${pctVideos}%`;
    barDoc.style.width = `${pctDocs}%`;
    barOth.style.width = `${pctOthers}%`;
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

            if (name.match(/\.(jpg|jpeg|png|gif|webp|jfif|svg|bmp)$/)) {
                storageDetail.images += size;
            } else if (name.match(/\.(mp4|mkv|mov|avi|wmv|flv|webm)$/)) {
                storageDetail.videos += size;
            } else if (name.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv)$/)) {
                storageDetail.docs += size;
            } else {
                storageDetail.others += size;
            }
        });

        const mb = formatSize(storageDetail.total);
        el('storageUsed').innerText = mb;
        
        const totalPct = Math.min((storageDetail.total / limit) * 100, 100);
        el('storageBar').style.width = `${totalPct}%`;

        if(totalPct > 90) el('storageBar').style.backgroundColor = '#ef4444';
        else el('storageBar').style.backgroundColor = '';

    } catch (e) {
        console.error("Gagal hitung storage:", e);
    }
}

// Utils (Modal, CRUD, Excel)
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
    const zone = el('dropZone');
    const input = el('fileInputHidden');
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('active')); 
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('active'); if(e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]); });
    if(input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
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