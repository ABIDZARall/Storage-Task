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
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedUploadFile = null; // Menyimpan file yang akan diupload

const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// ======================================================
// 2. LOGIKA LOGIN (USERNAME & EMAIL)
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        currentFolderId = 'root';
        currentFolderName = "Drive";
        calculateStorage(); 
        loadFiles('root');  
    } catch (e) { 
        window.nav('loginPage'); 
    } finally { 
        setTimeout(hideLoading, 500); 
    }
}
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initDragAndDrop(); // Inisialisasi Drag & Drop saat load
});

if(el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        showLoading();
        try {
            if (!inputId.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', inputId)]);
                if (res.documents.length === 0) throw new Error("Username tidak ditemukan!");
                inputId = res.documents[0].email;
            }
            try { await account.get(); } catch (err) { await account.createEmailPasswordSession(inputId, pass); }
            checkSession();
        } catch (error) {
            if(error.message.includes('session is active')) checkSession();
            else { alert("Login Gagal: " + error.message); hideLoading(); }
        }
    });
}

if(el('signupForm')) el('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('regName').value; const email = el('regEmail').value; const pass = el('regPass').value;
    showLoading();
    try {
        const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email });
        alert("Daftar Berhasil! Silakan Login."); window.nav('loginPage');
    } catch(e) { alert(e.message); } finally { hideLoading(); }
});

// ======================================================
// 3. PERBAIKAN TOMBOL NEW & DROPDOWN (PENTING)
// ======================================================
// Membuka/Tutup Menu Dropdown
window.toggleDropdown = (event) => {
    // Mencegah event bubbling agar tidak langsung ditutup oleh window.onclick
    if(event) event.stopPropagation();
    
    const menu = el('dropdownMenu');
    if (menu) menu.classList.toggle('show');
};

// Menutup dropdown jika klik di luar area tombol
window.onclick = function(event) {
    if (!event.target.closest('.new-btn-wrapper')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) {
                dropdowns[i].classList.remove('show');
            }
        }
    }
};

// ======================================================
// 4. PERBAIKAN DRAG & DROP DAN UPLOAD
// ======================================================
function initDragAndDrop() {
    const dropZone = el('dropZone');
    const fileInput = el('fileInputHidden');

    if (dropZone) {
        // Mencegah browser membuka file saat di-drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        // Efek visual saat file ditarik
        dropZone.addEventListener('dragover', () => dropZone.style.borderColor = '#4ade80');
        dropZone.addEventListener('dragleave', () => dropZone.style.borderColor = 'rgba(255,255,255,0.2)');

        // Saat file dilepas (Dropped)
        dropZone.addEventListener('drop', (e) => {
            dropZone.style.borderColor = 'rgba(255,255,255,0.2)';
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', function() {
            handleFiles(this.files);
        });
    }
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handleFiles(files) {
    if (files.length > 0) {
        selectedUploadFile = files[0]; // Simpan file ke variabel global
        const infoText = el('fileInfoText');
        if (infoText) {
            infoText.innerText = `Terpilih: ${selectedUploadFile.name} (${(selectedUploadFile.size/1024).toFixed(1)} KB)`;
            infoText.style.color = '#4ade80'; // Hijau tanda sukses pilih
        }
    }
}

// ======================================================
// 5. NAVIGASI HALAMAN & FOLDER
// ======================================================
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => { if(el(id)) el(id).classList.add('hidden'); });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[1].classList.add('active'); 
    loadFiles('root');
};

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
// 6. LOAD FILES
// ======================================================
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 
    updateHeaderUI();

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    if (param === 'recent') {
        queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20), Appwrite.Query.equal('trashed', false));
    } else if (param === 'starred') {
        queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false));
    } else if (param === 'trash') {
        queries.push(Appwrite.Query.equal('trashed', true));
    } else if (param === 'root' || typeof param === 'string') {
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param;
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if(res.documents.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`;
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
        const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`;
    } else {
        container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:15px;"><button onclick="goBack()" class="btn-pill small" style="background:rgba(255,255,255,0.2);width:auto;padding:0 20px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button><h2 id="headerTitle">${currentFolderName}</h2></div>`;
    }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const name = doc.name || "Tanpa Nama";
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;font-size:1rem;z-index:10;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : 
                  name.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/) ? 
                  `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>` :
                  `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;

    div.oncontextmenu = (e) => {
        e.preventDefault(); selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`; menu.classList.remove('hidden');
        if(el('starText')) el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
        const isTrash = doc.trashed;
        el('trashBtn').classList.toggle('hidden', isTrash);
        el('restoreBtn').classList.toggle('hidden', !isTrash);
        el('permDeleteBtn').classList.toggle('hidden', !isTrash);
        document.addEventListener('click', () => menu.classList.add('hidden'), {once:true});
    };
    
    div.onclick = () => { if(!doc.trashed) isFolder ? window.openFolder(doc.$id, name) : window.open(doc.url, '_blank'); };
    div.innerHTML = `${starHTML}${content}<div class="item-name">${name}</div>`;
    grid.appendChild(div);
}

window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; currentViewMode = 'root'; loadFiles(id); };

// ======================================================
// 7. AKSI: CREATE FOLDER & UPLOAD FILE (FIXED)
// ======================================================

// Dipanggil oleh tombol "Buat" di modal folder
window.submitCreateFolder = async () => {
    const nameInput = el('newFolderName');
    const name = nameInput.value.trim();
    
    if (!name) { alert("Nama folder tidak boleh kosong!"); return; }
    
    closeModal('folderModal'); 
    showLoading();

    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, 
            type: 'folder', 
            parentId: currentFolderId, 
            owner: currentUser.$id, 
            size: 0, 
            starred: false, 
            trashed: false
        });
        loadFiles(currentFolderId);
        nameInput.value = ''; // Reset input
    } catch (e) { 
        alert("Gagal Buat Folder: " + e.message); 
    } finally { 
        hideLoading(); 
    }
};

// Dipanggil oleh tombol "Upload" di modal upload
window.submitUploadFile = async () => {
    // Gunakan variabel global 'selectedUploadFile' yang diset oleh handleFiles
    if (!selectedUploadFile) {
        alert("Silakan pilih file terlebih dahulu!"); 
        return;
    }

    closeModal('uploadModal'); 
    showLoading();

    try {
        // 1. Upload ke Storage Bucket
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        
        // 2. Ambil URL View
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        
        // 3. Simpan Metadata ke Database
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedUploadFile.name, 
            type: 'file', 
            parentId: currentFolderId, 
            owner: currentUser.$id, 
            url: url.href, 
            fileId: up.$id, 
            size: selectedUploadFile.size, 
            starred: false, 
            trashed: false
        });
        
        // 4. Reset & Refresh
        selectedUploadFile = null; // Kosongkan file terpilih
        if(el('fileInfoText')) {
            el('fileInfoText').innerText = "Belum ada file dipilih";
            el('fileInfoText').style.color = "white";
        }
        
        loadFiles(currentFolderId); 
        calculateStorage();

    } catch (e) { 
        alert("Gagal Upload: " + e.message); 
    } finally { 
        hideLoading(); 
    }
};

// Logout
if (el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => {
    if (confirm("Keluar?")) { showLoading(); try { await account.deleteSession('current'); currentUser = null; window.nav('loginPage'); } catch (e) { alert("Gagal: " + e.message); } finally { hideLoading(); } }
});

// ======================================================
// 8. STORAGE & AUTO REPAIR
// ======================================================
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const [dbRes, bucketRes] = await Promise.all([
            databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]),
            storage.listFiles(CONFIG.BUCKET_ID, [Appwrite.Query.limit(100)])
        ]);
        const realSizes = {}; bucketRes.files.forEach(f => { realSizes[f.$id] = f.sizeOriginal; });
        let totalBytes = 0;
        for (const doc of dbRes.documents) {
            if (doc.trashed === null || doc.starred === null || doc.size === null) {
                databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, {
                    trashed: doc.trashed ?? false, starred: doc.starred ?? false, size: doc.size ?? (realSizes[doc.fileId] || 0)
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

// Context Actions
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles('root'); } catch(e){alert(e.message);} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); } catch(e){alert(e.message);} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); } catch(e){alert(e.message);} };

// Helpers UI
window.openModal = (id) => { 
    // Tutup dropdown menu dulu sebelum buka modal
    const menu = el('dropdownMenu');
    if(menu) menu.classList.remove('show');
    
    el(id).classList.remove('hidden'); 
};
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');