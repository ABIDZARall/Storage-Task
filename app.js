const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// 1. KONFIGURASI
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedFileToUpload = null; // Variabel global untuk upload

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// ======================================================
// 2. INISIALISASI (JALAN SAAT HALAMAN DIBUKA)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNewButton(); // Aktifkan tombol New
    initDragAndDrop(); // Aktifkan Drag & Drop
});

// === LOGIKA TOMBOL NEW & DROPDOWN (FIXED) ===
function initNewButton() {
    const btn = el('newBtnMain');
    const menu = el('dropdownMenu');
    
    if (btn && menu) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation(); // Mencegah klik menyebar ke window
            menu.classList.toggle('show');
        });
    }

    // Klik di luar untuk menutup menu
    window.addEventListener('click', (e) => {
        if (menu && !btn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('show');
        }
    });
}

// === LOGIKA DRAG & DROP (FIXED) ===
function initDragAndDrop() {
    const zone = el('dropZone');
    const input = el('fileInputHidden');

    if (!zone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
    });

    zone.addEventListener('dragover', () => zone.classList.add('active'));
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    
    zone.addEventListener('drop', (e) => {
        zone.classList.remove('active');
        const files = e.dataTransfer.files;
        if (files.length > 0) processFile(files[0]);
    });

    if (input) {
        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) processFile(e.target.files[0]);
        });
    }
}

function processFile(file) {
    selectedFileToUpload = file;
    el('fileInfoText').innerText = `Terpilih: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
    el('fileInfoText').style.color = 'var(--accent)';
}

// ======================================================
// 3. FUNGSI AUTH & LOGIN
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        calculateStorage(); 
        loadFiles('root');  
    } catch (e) { window.nav('loginPage'); } 
    finally { setTimeout(hideLoading, 500); }
}

if(el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        showLoading();
        try {
            if (!inputId.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', inputId)]);
                if (res.total === 0) throw new Error("User tidak ditemukan");
                inputId = res.documents[0].email;
            }
            try { await account.get(); } catch (err) { await account.createEmailPasswordSession(inputId, pass); }
            checkSession();
        } catch (error) { alert(error.message); hideLoading(); }
    });
}

// ======================================================
// 4. NAVIGASI & LOAD DATA
// ======================================================
window.nav = (p) => { 
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden'));
    el(p).classList.remove('hidden'); 
};

window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode;
    currentFolderId = 'root';
    currentFolderName = (mode === 'root') ? 'Drive' : element.innerText.trim();
    loadFiles(mode);
};

async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = '';
    updateHeaderUI();

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20), Appwrite.Query.equal('trashed', false));
    else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false));
    else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true));
    else {
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param;
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if (res.total === 0) grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; opacity:0.5; margin-top:50px;">Kosong</p>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.error(e); }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;"></i>` : '';
    
    div.innerHTML = `
        ${starHTML}
        <i class="icon fa-solid ${isFolder ? 'fa-folder' : 'fa-file-lines'}"></i>
        <div class="item-name">${doc.name || 'Tanpa Nama'}</div>`;

    div.oncontextmenu = (e) => {
        e.preventDefault(); selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`; menu.classList.remove('hidden');
        document.addEventListener('click', () => menu.classList.add('hidden'), {once:true});
    };
    
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    grid.appendChild(div);
}

function openFolder(id, name) { currentFolderId = id; currentFolderName = name; loadFiles(id); }

function updateHeaderUI() {
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    const h = new Date().getHours();
    const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
    el('headerTitle').innerText = isRoot ? `Welcome In Drive ${s}` : currentFolderName;
}

// ======================================================
// 5. AKSI NYATA (CREATE FOLDER & UPLOAD)
// ======================================================
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitUploadFile = async () => {
    if (!selectedFileToUpload) return alert("Pilih file dulu!");
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedFileToUpload);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedFileToUpload.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: selectedFileToUpload.size, starred: false, trashed: false
        });
        selectedFileToUpload = null; el('fileInfoText').innerText = "Belum ada file";
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file')]);
        let bytes = 0; res.documents.forEach(d => bytes += (d.size || 0));
        const mb = (bytes / 1048576).toFixed(2);
        el('storageUsed').innerText = `${mb} MB`;
        el('storageBar').style.width = `${Math.min((mb / 2048) * 100, 100)}%`;
    } catch (e) {}
}

// Helpers
// ======================================================
// HELPERS UI (DIPERBAIKI AGAR MENU TERTUTUP OTOMATIS)
// ======================================================

// Fungsi membuka modal
window.openModal = (id) => { 
    // 1. Tutup menu dropdown dulu (PENTING)
    const menu = document.getElementById('dropdownMenu');
    if(menu) menu.classList.remove('show');
    
    // 2. Baru buka modal
    const modal = document.getElementById(id);
    if(modal) modal.classList.remove('hidden'); 
};

window.closeModal = (id) => {
    const modal = document.getElementById(id);
    if(modal) modal.classList.add('hidden');
};

// Fungsi Helper Tombol
window.triggerUploadModal = () => {
    // Tutup menu dropdown secara eksplisit
    const menu = document.getElementById('dropdownMenu');
    if(menu) menu.classList.remove('show');
    
    // Buka modal
    openModal('uploadModal');
};

window.createFolder = () => {
    // Tutup menu dropdown secara eksplisit
    const menu = document.getElementById('dropdownMenu');
    if(menu) menu.classList.remove('show');
    
    // Buka modal
    openModal('folderModal');
};