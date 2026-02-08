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