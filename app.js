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
const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi';

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

let currentUser = null;
let currentFolderId = 'root';
let currentFolderName = "Drive";

const el = (id) => document.getElementById(id);

// === KALKULASI STORAGE OTOMATIS ===
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('type', 'file')
        ]);
        let total = 0;
        res.documents.forEach(doc => total += (doc.size || 0));
        const mb = (total / (1024 * 1024)).toFixed(2);
        const pct = Math.min((total / (2 * 1024 * 1024 * 1024)) * 100, 100);
        el('storageUsed').innerText = `${mb} MB / 2 GB`;
        el('storageBar').style.width = pct + "%";
    } catch (e) { console.error(e); }
}

// === LOAD FILES & DINAMIS JUDUL ===
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = '';
    const header = el('headerTitle');

    // Ubah Judul Header Sesuai Folder
    if(folderId === 'root') {
        updateGreeting(); 
    } else {
        header.innerHTML = `<button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 15px; margin-right:10px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button> ${currentFolderName}`;
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.error(e); }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    const isFolder = doc.type === 'folder';
    
    // Logika Thumbnail
    let preview = '';
    const namaFile = (doc.nama || "").toLowerCase();
    
    if (isFolder) {
        preview = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (namaFile.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        preview = `<img src="${url}" class="thumb-img">`;
    } else {
        preview = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    const action = isFolder ? `openFolder('${doc.$id}', '${doc.nama}')` : `window.open('${doc.url}', '_blank')`;
    
    div.className = 'item-card';
    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')"><i class="fa-solid fa-xmark"></i></button>
        <div onclick="${action}" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            ${preview}
            <div class="item-name">${doc.nama || "Tanpa Nama"}</div>
        </div>`;
    grid.appendChild(div);
}

// === ACTION FUNCTIONS ===
window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; loadFiles(id); };

window.submitCreateFolder = async () => {
    const n = el('newFolderName').value.trim(); if(!n) return;
    closeModal('folderModal'); el('loading').classList.remove('hidden');
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            nama: n, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
        });
        loadFiles(currentFolderId);
    } finally { el('loading').classList.add('hidden'); }
};

window.submitUploadFile = async () => {
    if (!window.selectedFile) return;
    closeModal('uploadModal'); el('loading').classList.remove('hidden');
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), window.selectedFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            nama: window.selectedFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: window.selectedFile.size
        });
        loadFiles(currentFolderId); calculateStorage();
    } finally { el('loading').classList.add('hidden'); }
};

// === INITIALIZATION & UI UTILS ===
async function checkSession() {
    try {
        currentUser = await account.get();
        nav('dashboardPage'); updateGreeting(); calculateStorage(); loadFiles('root');
    } catch (e) { nav('loginPage'); }
}
document.addEventListener('DOMContentLoaded', checkSession);

window.nav = (p) => { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); el(p).classList.remove('hidden'); };
window.openModal = (m) => el(m).classList.remove('hidden');
window.closeModal = (m) => el(m).classList.add('hidden');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; el('headerTitle').innerText = `Welcome In Drive ${s}`; }

// Login, Signup, Logout tetap sama seperti versi sebelumnya...
