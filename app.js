const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// ======================================================
// 1. KONFIGURASI
// ======================================================
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',   
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// STATE VARIABLES
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; // root, recent, starred, trash
let selectedItem = null; 

const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// ======================================================
// 2. LOGIKA LOGIN & SESI (PERBAIKAN ERROR SESSION ACTIVE)
// ======================================================
async function checkSession() {
    showLoading();
    try {
        // Coba ambil data user
        currentUser = await account.get();
        
        // Jika berhasil, langsung masuk dashboard
        window.nav('dashboardPage'); 
        currentFolderId = 'root';
        currentFolderName = "Drive";
        
        // Jalankan fungsi data
        calculateStorage(); 
        loadFiles('root');  
        
    } catch (e) { 
        // Jika gagal (belum login), tampilkan halaman login
        console.log("Belum login atau sesi habis");
        window.nav('loginPage'); 
    } finally { 
        setTimeout(hideLoading, 500); 
    }
}
// Jalankan saat halaman dimuat
document.addEventListener('DOMContentLoaded', checkSession);

// Handler Login Form
if(el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        showLoading();
        try {
            // Cek apakah sudah ada sesi aktif?
            try {
                await account.get();
                // Jika tidak error, berarti sudah login. Langsung ke dashboard.
                return checkSession();
            } catch (err) {
                // Jika error, berarti belum login. Lanjut buat sesi.
            }

            // Login dengan Email/Password
            await account.createEmailPasswordSession(email, pass);
            checkSession();
            
        } catch (error) {
            // Tangani error khusus "Session Active"
            if(error.message.includes('session is active')) {
                checkSession(); // Langsung masuk saja
            } else {
                alert("Login Gagal: " + error.message);
                hideLoading();
            }
        }
    });
}

// ======================================================
// 3. LOGIKA TOMBOL 'NEW' & DROPDOWN (YANG MACET)
// ======================================================
// Fungsi global agar bisa dipanggil dari onclick HTML
window.toggleDropdown = () => {
    const menu = el('dropdownMenu');
    if (menu) {
        menu.classList.toggle('show');
    }
};

// Menutup dropdown jika klik di luar
window.onclick = function(event) {
    if (!event.target.closest('.new-btn')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
};

// ======================================================
// 4. NAVIGASI HALAMAN & TOMBOL KEMBALI
// ======================================================
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) el(id).classList.add('hidden');
    });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

// Fungsi Kembali
window.goBack = () => {
    currentFolderId = 'root';
    currentFolderName = "Drive";
    currentViewMode = 'root';
    
    // Reset Sidebar ke 'Drive Saya'
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[1].classList.add('active'); 

    loadFiles('root');
};

// Handler Sidebar Menu
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');

    currentViewMode = mode;
    currentFolderId = 'root'; 
    
    if(mode === 'root') currentFolderName = "Drive";
    else if(mode === 'recent') currentFolderName = "Terbaru";
    else if(mode === 'starred') currentFolderName = "Berbintang";
    else if(mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();

    loadFiles(mode);
};

// ======================================================
// 5. LOAD FILES & UPDATE HEADER
// ======================================================
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 

    updateHeaderUI();

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    // Logika Filter
    if (param === 'recent') {
        queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20));
        queries.push(Appwrite.Query.equal('trashed', false));
    } else if (param === 'starred') {
        queries.push(Appwrite.Query.equal('starred', true));
        queries.push(Appwrite.Query.equal('trashed', false));
    } else if (param === 'trash') {
        queries.push(Appwrite.Query.equal('trashed', true));
    } else if (param === 'root' || typeof param === 'string') {
        // Mode Folder Normal
        if (typeof param === 'string' && param !== 'root' && param !== 'recent' && param !== 'starred' && param !== 'trash') {
            currentFolderId = param;
        }
        queries.push(Appwrite.Query.equal('parentId', currentFolderId));
        queries.push(Appwrite.Query.equal('trashed', false));
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        
        if(res.documents.length === 0) {
            grid.innerHTML = `
                <div style="grid-column: 1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; opacity:0.5; margin-top:50px;">
                    <i class="fa-solid fa-folder-open" style="font-size: 4rem; margin-bottom: 20px;"></i>
                    <p>Folder Kosong</p>
                </div>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { console.error("Load Error:", e); }
}

function updateHeaderUI() {
    const container = document.querySelector('.breadcrumb-area');
    if (!container) return; 

    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    
    if (isRoot) {
        const h = new Date().getHours();
        const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`;
    } else {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:flex-start; gap:15px;">
                <button onclick="goBack()" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 20px;">
                    <i class="fa-solid fa-arrow-left"></i> Kembali
                </button> 
                <h2 id="headerTitle">${currentFolderName}</h2>
            </div>`;
    }
}

// ======================================================
// 6. RENDER ITEM
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const name = doc.name || "Tanpa Nama";
    
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute; top:12px; left:12px; color:#ffd700; font-size:1rem; z-index:10;"></i>` : '';

    let content = '';
    if(isFolder) {
        content = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (name.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${url}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    } else {
        content = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    // Klik Kanan Context Menu
    div.oncontextmenu = (e) => {
        e.preventDefault();
        selectedItem = doc;
        const menu = el('contextMenu');
        if(menu) {
            menu.style.top = `${e.clientY}px`;
            menu.style.left = `${e.clientX}px`;
            menu.classList.remove('hidden');
            
            if(el('starText')) el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
            
            if(doc.trashed) {
                if(el('trashBtn')) el('trashBtn').classList.add('hidden');
                if(el('restoreBtn')) el('restoreBtn').classList.remove('hidden');
                if(el('permDeleteBtn')) el('permDeleteBtn').classList.remove('hidden');
            } else {
                if(el('trashBtn')) el('trashBtn').classList.remove('hidden');
                if(el('restoreBtn')) el('restoreBtn').classList.add('hidden');
                if(el('permDeleteBtn')) el('permDeleteBtn').classList.add('hidden');
            }
        }
        document.addEventListener('click', () => menu.classList.add('hidden'), {once:true});
    };
    
    // Klik Kiri Buka Item
    div.onclick = () => {
        if(doc.trashed) return; 
        if(isFolder) {
            window.openFolder(doc.$id, name);
        } else {
            window.open(doc.url, '_blank');
        }
    };

    div.innerHTML = `
        ${starHTML}
        ${content}
        <div class="item-name">${name}</div>`;
    grid.appendChild(div);
}

// Fungsi Global Buka Folder
window.openFolder = (id, nama) => {
    currentFolderId = id;
    currentFolderName = nama;
    currentViewMode = 'root'; 
    loadFiles(id);
};

// ======================================================
// 7. STORAGE & AUTO REPAIR
// ======================================================
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const [dbRes, bucketRes] = await Promise.all([
            databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.limit(100)
            ]),
            storage.listFiles(CONFIG.BUCKET_ID, [Appwrite.Query.limit(100)])
        ]);

        const realSizes = {};
        bucketRes.files.forEach(f => { realSizes[f.$id] = f.sizeOriginal; });

        let totalBytes = 0;
        for (const doc of dbRes.documents) {
            // AUTO REPAIR DATA
            if (doc.trashed === null || doc.starred === null || doc.size === null) {
                databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, {
                    trashed: doc.trashed ?? false,
                    starred: doc.starred ?? false,
                    size: doc.size ?? (realSizes[doc.fileId] || 0)
                }).catch(()=>{});
            }
            if(doc.type === 'file') totalBytes += (doc.size || 0);
        }

        const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
        const percentage = Math.min((parseFloat(totalMB) / 2048) * 100, 100);

        if (el('storageUsed')) el('storageUsed').innerText = `${totalMB} MB`;
        if (el('storageBar')) el('storageBar').style.width = `${percentage}%`;
    } catch (e) { console.error(e); }
}

// ======================================================
// 8. AKSI (CREATE, UPLOAD, DELETE, LOGOUT)
// ======================================================
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentFolderId);
        el('newFolderName').value = '';
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file");
    closeModal('uploadModal'); showLoading();
    try {
        const file = window.selectedFile;
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: file.size, starred: false, trashed: false
        });
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// Logout
if (el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => {
    if (confirm("Keluar?")) {
        showLoading();
        try {
            await account.deleteSession('current'); 
            currentUser = null;
            window.nav('loginPage'); 
        } catch (e) { alert("Gagal Logout: " + e.message); } 
        finally { hideLoading(); }
    }
});

// Context Menu Actions
window.toggleStarItem = async () => {
    try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);}
};
window.moveItemToTrash = async () => {
    try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles('root'); } catch(e){alert(e.message);}
};
window.restoreFromTrash = async () => {
    try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); } catch(e){alert(e.message);}
};
window.deleteItemPermanently = async () => {
    if(!confirm("Hapus permanen?")) return;
    try { 
        if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id);
        loadFiles('trash'); calculateStorage();
    } catch(e){alert(e.message);}
};

// ======================================================
// 9. HELPERS
// ======================================================
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');

el('dropZone').addEventListener('dragover', (e) => e.preventDefault());
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }