const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; // root, recent, starred, trash
let selectedItem = null; // Untuk menu klik kanan

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// === NAVIGASI MENU ===
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode;
    currentFolderId = 'root';
    currentFolderName = element.innerText.trim();
    loadFiles(mode);
};

// === LOAD FILES DENGAN FILTER ===
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 

    // Query Dasar: Milik User
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
    } else {
        // Mode Folder Normal
        queries.push(Appwrite.Query.equal('parentId', currentFolderId));
        queries.push(Appwrite.Query.equal('trashed', false));
    }

    updateHeaderTitle();

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; opacity:0.5; margin-top:100px;">Folder Kosong</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { console.error(e); }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const name = doc.name || "Tanpa Nama";
    
    // Tampilan Bintang
    const starIcon = doc.starred ? `<i class="fa-solid fa-star star-icon"></i>` : '';

    div.oncontextmenu = (e) => showContextMenu(e, doc);
    
    div.onclick = () => {
        if(doc.trashed) return; // Nonaktifkan klik jika di sampah
        if(isFolder) openFolder(doc.$id, name);
        else window.open(doc.url, '_blank');
    };

    div.innerHTML = `
        ${starIcon}
        <i class="icon fa-solid ${isFolder ? 'fa-folder' : 'fa-file-lines'}"></i>
        <div class="item-name">${name}</div>`;
    grid.appendChild(div);
}

// === MENU KLIK KANAN (CONTEXT MENU) ===
function showContextMenu(e, doc) {
    e.preventDefault();
    selectedItem = doc;
    const menu = el('contextMenu');
    menu.style.top = `${e.clientY}px`;
    menu.style.left = `${e.clientX}px`;
    menu.classList.remove('hidden');

    // Update Teks Menu
    el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
    
    // Toggle Tombol Berdasarkan Mode Trash
    if(doc.trashed) {
        el('trashBtn').classList.add('hidden');
        el('restoreBtn').classList.remove('hidden');
        el('permDeleteBtn').classList.remove('hidden');
    } else {
        el('trashBtn').classList.remove('hidden');
        el('restoreBtn').classList.add('hidden');
        el('permDeleteBtn').classList.add('hidden');
    }

    document.onclick = () => menu.classList.add('hidden');
}

// === AKSI ITEM ===
window.toggleStarItem = async () => {
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred });
        loadFiles(currentViewMode === 'root' ? currentFolderId : currentViewMode);
    } catch(e) { alert(e.message); }
};

window.moveItemToTrash = async () => {
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true });
        loadFiles(currentViewMode === 'root' ? currentFolderId : currentViewMode);
    } catch(e) { alert(e.message); }
};

window.restoreFromTrash = async () => {
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false });
        loadFiles('trash');
    } catch(e) { alert(e.message); }
};

window.deleteItemPermanently = async () => {
    if(!confirm("Hapus selamanya?")) return;
    try {
        if(selectedItem.type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id);
        loadFiles('trash');
        calculateStorage();
    } catch(e) { alert(e.message); }
};

// === INITIALIZATION & UI HELPERS ===
function updateHeaderTitle() {
    const titleEl = el('headerTitle');
    const container = document.querySelector('.breadcrumb-area');
    
    if(currentFolderId === 'root' && currentViewMode === 'root') {
        const h = new Date().getHours();
        const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        titleEl.innerText = `Welcome In Drive ${s}`;
        // Hapus tombol kembali jika ada
        const backBtn = container.querySelector('button');
        if(backBtn) backBtn.remove();
    } else {
        titleEl.innerText = currentFolderName;
        // Tambahkan tombol kembali jika di dalam folder
        if(currentFolderId !== 'root' && !container.querySelector('button')) {
            const btn = document.createElement('button');
            btn.className = 'btn-pill small';
            btn.innerHTML = '<i class="fa-solid fa-arrow-left"></i> Kembali';
            btn.onclick = () => { currentFolderId = 'root'; loadFiles('root'); };
            container.prepend(btn);
        }
    }
}

async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        el('dashboardPage').classList.remove('hidden');
        loadFiles('root');
        calculateStorage();
    } catch (e) { el('loginPage').classList.remove('hidden'); }
    finally { hideLoading(); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// ... (Gunakan fungsi calculateStorage, submitUpload, logout dari versi sebelumnya) ...

window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) el(id).classList.add('hidden');
    });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

function updateGreeting() {
    const h = new Date().getHours();
    let timeString = "Morning";
    if (h >= 12 && h < 15) timeString = "Afternoon";
    else if (h >= 15 && h < 19) timeString = "Evening";
    else if (h >= 19 || h < 4) timeString = "Night";

    const titleElement = el('headerTitle');
    if (titleElement && currentFolderId === 'root' && currentViewMode === 'root') {
        titleElement.innerText = `Welcome In Drive ${timeString}`;
    } else if (titleElement) {
        titleElement.innerText = currentFolderName;
    }
}

// ======================================================
// STORAGE CALCULATION
// ======================================================
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const [dbRes, bucketRes] = await Promise.all([
            databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.equal('type', 'file'),
                Appwrite.Query.limit(100)
            ]),
            storage.listFiles(CONFIG.BUCKET_ID, [Appwrite.Query.limit(100)])
        ]);

        const realSizes = {};
        bucketRes.files.forEach(f => { realSizes[f.$id] = f.sizeOriginal; });

        let totalBytes = 0;
        for (const doc of dbRes.documents) {
            let size = doc.size;
            if (!size || size === 0) {
                const realSize = realSizes[doc.fileId];
                if (realSize) {
                    size = realSize;
                    databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, { size: size }).catch(()=>{});
                }
            }
            totalBytes += (size || 0);
        }

        const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
        const percentage = Math.min((parseFloat(totalMB) / 2048) * 100, 100);

        if (el('storageUsed')) el('storageUsed').innerText = `${totalMB} MB`;
        if (el('storageBar')) el('storageBar').style.width = `${percentage}%`;
    } catch (e) { console.error(e); }
}

// ======================================================
// LOAD FILES & RENDER
// ======================================================
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    if (grid) grid.innerHTML = ''; 

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    // Logika Filter Berdasarkan View Mode
    if (param === 'recent') {
        queries.push(Appwrite.Query.orderDesc('$createdAt'));
        queries.push(Appwrite.Query.limit(20));
    } else if (param === 'starred') {
        queries.push(Appwrite.Query.equal('starred', true)); // Pastikan ada atribut 'starred' di DB
    } else if (param === 'trash') {
        queries.push(Appwrite.Query.equal('trashed', true)); // Pastikan ada atribut 'trashed' di DB
    } else if (param === 'root' || typeof param === 'string') {
        queries.push(Appwrite.Query.equal('parentId', currentFolderId));
    }

    updateGreeting();

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; opacity:0.5; margin-top:50px; font-size:1.1rem; font-style:italic;">Belum ada item untuk ditampilkan</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { 
        console.error(e);
        grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; opacity:0.5;">Data tidak tersedia</p>`;
    }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const fileName = doc.name || doc.nama || "Tanpa Nama";
    const safeName = fileName.replace(/'/g, "\\'"); 

    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : 
                  fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/) ? 
                  `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>` :
                  `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;

    const action = isFolder ? `openFolder('${doc.$id}', '${safeName}')` : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')"><i class="fa-solid fa-xmark"></i></button>
        <div onclick="${action}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            ${content}<div class="item-name">${fileName}</div>
        </div>`;
    grid.appendChild(div);
}

window.openFolder = (id, nama) => { 
    currentFolderId = id; 
    currentFolderName = nama; 
    currentViewMode = 'root'; // Masuk ke folder berarti kembali ke navigasi 'Drive Saya'
    loadFiles(id); 
};

// ACTIONS (CREATE, UPLOAD, DELETE)
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
        });
        loadFiles(currentFolderId);
        el('newFolderName').value = '';
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file!");
    closeModal('uploadModal'); showLoading();
    try {
        const file = window.selectedFile;
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: file.size 
        });
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus item ini?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// AUTH HANDLERS
if(el('loginForm')) el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let id = el('loginEmail').value.trim();
    showLoading();
    try {
        if (!id.includes('@')) {
            const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', id)]);
            if(res.total===0) throw new Error("User tidak ditemukan");
            id = res.documents[0].email;
        }
        await account.createEmailPasswordSession(id, el('loginPass').value);
        checkSession();
    } catch(e) { alert(e.message); hideLoading(); }
});

const logoutBtn = el('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (confirm("Yakin ingin keluar?")) {
            showLoading();
            try { await account.deleteSession('current'); currentUser = null; window.nav('loginPage'); } 
            catch (e) { alert(e.message); } finally { hideLoading(); }
        }
    });
}

// HELPERS UI
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };

// Drag & Drop
el('dropZone').addEventListener('dragover', (e) => e.preventDefault());
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));