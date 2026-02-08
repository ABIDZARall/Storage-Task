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
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// STATE VARIABLES (Menyimpan Status Aplikasi)
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; // root, recent, starred, trash
let selectedItem = null; 

const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// ======================================================
// 2. LOGIKA TOMBOL 'NEW' & DROPDOWN (YANG MACET)
// ======================================================
// Fungsi ini harus ada di global window agar onClick di HTML bisa menemukannya
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
// 3. LOGIKA TOMBOL 'KEMBALI' & NAVIGASI
// ======================================================
// Fungsi khusus untuk tombol Kembali agar Reset-nya bersih
window.goBack = () => {
    // Reset semua status ke awal
    currentFolderId = 'root';
    currentFolderName = "Drive";
    currentViewMode = 'root';
    
    // Kembalikan highlight menu sidebar ke 'Drive Saya'
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[1].classList.add('active'); // Index 1 = Drive Saya

    loadFiles('root');
};

// Handler Menu Sidebar
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');

    currentViewMode = mode;
    currentFolderId = 'root'; // Reset folder saat ganti menu
    
    // Set Nama Judul
    if(mode === 'root') currentFolderName = "Drive";
    else if(mode === 'recent') currentFolderName = "Terbaru";
    else if(mode === 'starred') currentFolderName = "Berbintang";
    else if(mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();

    loadFiles(mode);
};

// ======================================================
// 4. LOAD FILES & UPDATE HEADER
// ======================================================
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 

    // Update Header (Tombol Kembali digenerate di sini)
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
    } catch (e) { 
        console.error("Load Error:", e);
    }
}

// Fungsi Update Header & Tombol Kembali
function updateHeaderUI() {
    const container = document.querySelector('.breadcrumb-area');
    if (!container) return; // Safety check

    const headerTitle = el('headerTitle');
    
    // Cek apakah perlu tombol kembali
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    
    if (isRoot) {
        // Mode Root: Tampilkan Greeting, Hapus Tombol Kembali
        const h = new Date().getHours();
        const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`;
    } else {
        // Mode Folder/Menu: Tampilkan Tombol Kembali & Judul Folder
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:flex-start; gap:15px;">
                <button onclick="goBack()" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 20px; border:1px solid rgba(255,255,255,0.2);">
                    <i class="fa-solid fa-arrow-left"></i> Kembali
                </button> 
                <h2 id="headerTitle">${currentFolderName}</h2>
            </div>`;
    }
}

// ======================================================
// 5. RENDER ITEM & CONTEXT MENU
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const name = doc.name || "Tanpa Nama";
    
    // Indikator Bintang
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute; top:12px; left:12px; color:#ffd700; font-size:1rem; z-index:10;"></i>` : '';

    // Konten Icon/Thumbnail
    let content = '';
    if(isFolder) {
        content = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (name.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${url}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    } else {
        content = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    // Klik Kanan
    div.oncontextmenu = (e) => {
        e.preventDefault();
        selectedItem = doc;
        const menu = el('contextMenu');
        if(menu) {
            menu.style.top = `${e.clientY}px`;
            menu.style.left = `${e.clientX}px`;
            menu.classList.remove('hidden');
            
            // Update teks menu
            if(el('starText')) el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
            
            // Logic trash button
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
    
    // Klik Kiri (Buka)
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

// Fungsi Buka Folder (Global)
window.openFolder = (id, nama) => {
    currentFolderId = id;
    currentFolderName = nama;
    currentViewMode = 'root'; // Paksa mode jadi root saat masuk folder
    loadFiles(id);
};

// ======================================================
// 6. STORAGE CALCULATION (DENGAN AUTO REPAIR)
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
            // AUTO REPAIR: Jika data trashed/starred/size hilang, perbaiki
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
// 7. AKSI (CREATE, UPLOAD, DELETE, CONTEXT)
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

// Context Menu Actions
window.toggleStarItem = async () => {
    try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);}
};
window.moveItemToTrash = async () => {
    try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);}
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
// 8. SESSION & HELPERS
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        el('dashboardPage').classList.remove('hidden');
        calculateStorage();
        loadFiles('root');
    } catch (e) { el('loginPage').classList.remove('hidden'); }
    finally { hideLoading(); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// UI Helpers
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');

// Drag & Drop
el('dropZone').addEventListener('dragover', (e) => e.preventDefault());
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }

// Logout
if (el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => { if (confirm("Keluar?")) { await account.deleteSession('current'); location.reload(); } });

// Login Form
if(el('loginForm')) el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        let id = el('loginEmail').value.trim();
        if (!id.includes('@')) {
            const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', id)]);
            if(res.total===0) throw new Error("User tidak ditemukan");
            id = res.documents[0].email;
        }
        await account.createEmailPasswordSession(id, el('loginPass').value);
        checkSession();
    } catch(e) { alert(e.message); }
});