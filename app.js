const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

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
let selectedFile = null; // Variabel global untuk menampung file upload

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// ======================================================
// INISIALISASI UTAMA
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNewButtonLogic();
    initDragAndDrop();
});

// Fix Tombol New & Dropdown
function initNewButtonLogic() {
    const btn = el('newBtnMain');
    const menu = el('dropdownMenu');
    
    if (btn && menu) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('show');
        });
    }

    // Klik di luar untuk menutup dropdown
    window.addEventListener('click', (e) => {
        if (menu && !btn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('show');
        }
    });
}

// Fix Drag & Drop
function initDragAndDrop() {
    const zone = el('dropZone');
    if (!zone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
    });

    zone.addEventListener('dragover', () => zone.classList.add('dragover'));
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    
    zone.addEventListener('drop', (e) => {
        zone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFileSelect(files[0]);
    });

    el('fileInputHidden').addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });
}

function handleFileSelect(file) {
    selectedFile = file;
    el('fileInfoText').innerText = `Terpilih: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
}

// ======================================================
// NAVIGASI & LOAD DATA
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        el('dashboardPage').classList.remove('hidden');
        calculateStorage();
        loadFiles('root');
    } catch (e) { el('loginPage').classList.remove('hidden'); }
    finally { setTimeout(hideLoading, 500); }
}

async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 
    updateHeaderUI();

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    if (param === 'recent') {
        queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20));
        queries.push(Appwrite.Query.equal('trashed', false));
    } else if (param === 'starred') {
        queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false));
    } else if (param === 'trash') {
        queries.push(Appwrite.Query.equal('trashed', true));
    } else {
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; opacity:0.5; margin-top:100px;">Folder Kosong</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { console.error(e); }
}

// ======================================================
// AKSI (UPLOAD, FOLDER, DELETE)
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
    if (!selectedFile) return alert("Pilih file dulu!");
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: selectedFile.size, starred: false, trashed: false
        });
        selectedFile = null; el('fileInfoText').innerText = "Belum ada file dipilih";
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// ... (Ganti handleMenuClick, renderItem, Context Menu, dan Storage dari versi stabil sebelumnya) ...

// Helper Modal
window.openModal = (id) => { el('dropdownMenu').classList.remove('show'); el(id).classList.remove('hidden'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');

// ======================================================
// 5. FITUR DRAG & DROP
// ======================================================
function initDragAndDrop() {
    const dropZone = el('dropZone');
    const fileInput = el('fileInputHidden');
    if (!dropZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        dropZone.addEventListener(name, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    dropZone.addEventListener('dragover', () => dropZone.style.background = 'rgba(74, 222, 128, 0.1)');
    dropZone.addEventListener('dragleave', () => dropZone.style.background = 'transparent');

    dropZone.addEventListener('drop', (e) => {
        dropZone.style.background = 'transparent';
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            selectedUploadFile = files[0];
            updateUploadInfo(selectedUploadFile);
        }
    });

    if (fileInput) {
        fileInput.addEventListener('change', function() {
            if (this.files.length > 0) {
                selectedUploadFile = this.files[0];
                updateUploadInfo(selectedUploadFile);
            }
        });
    }
}

function updateUploadInfo(file) {
    const infoText = el('fileInfoText');
    if (infoText) {
        infoText.innerText = `Terpilih: ${file.name}`;
        infoText.style.color = '#4ade80';
    }
}

// ======================================================
// 6. NAVIGASI DASHBOARD
// ======================================================
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => { if(el(id)) el(id).classList.add('hidden'); });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active'); // Beranda
    loadFiles('root');
};

window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode;
    currentFolderId = 'root'; 
    currentFolderName = mode === 'root' ? 'Drive' : element.innerText.trim();
    loadFiles(mode);
};

// ======================================================
// 7. DATA MANAGEMENT
// ======================================================
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    if(grid) grid.innerHTML = ''; 
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
        container.innerHTML = `<div style="display:flex; flex-direction:column; align-items:flex-start; gap:15px;"><button onclick="goBack()" class="btn-pill small" style="background:rgba(255,255,255,0.2);width:auto;padding:0 20px;border:1px solid rgba(255,255,255,0.2);"><i class="fa-solid fa-arrow-left"></i> Kembali</button><h2 id="headerTitle">${currentFolderName}</h2></div>`;
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
        document.addEventListener('click', () => menu.classList.add('hidden'), {once:true});
    };
    
    div.onclick = () => { if(!doc.trashed) isFolder ? window.openFolder(doc.$id, name) : window.open(doc.url, '_blank'); };
    div.innerHTML = `${starHTML}${content}<div class="item-name">${name}</div>`;
    grid.appendChild(div);
}

window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; currentViewMode = 'root'; loadFiles(id); };

// ======================================================
// 8. STORAGE & FOLDER ACTION
// ======================================================
window.submitCreateFolder = async () => {
    const nameInput = el('newFolderName');
    const name = nameInput.value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentFolderId);
        nameInput.value = '';
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

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
        if (el('storageUsed')) el('storageUsed').innerText = `${totalMB} MB`;
        if (el('storageBar')) el('storageBar').style.width = `${Math.min((totalMB / 2048) * 100, 100)}%`;
    } catch (e) { console.error(e); }
}

// LOGOUT
if (el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => {
    if (confirm("Keluar?")) { showLoading(); try { await account.deleteSession('current'); location.reload(); } catch (e) { hideLoading(); } }
});