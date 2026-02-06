// ======================================================
// STORAGE TASKS - APP.JS (FIXED LOGIN)
// ======================================================

const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI PROYEK
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

// UI Helpers
const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// Navigasi Halaman
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) {
            el(id).classList.add('hidden');
            el(id).classList.remove('active');
        }
    });
    if(el(pageId)) {
        el(pageId).classList.remove('hidden');
        el(pageId).classList.add('active');
    }
};

// ======================================================
// 1. LOGIKA LOGIN (USERNAME & EMAIL)
// ======================================================
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let identifier = el('loginEmail').value.trim(); // Input User
        const password = el('loginPass').value;
        
        showLoading();
        
        try {
            // LOGIKA: Jika input TIDAK mengandung '@', anggap sebagai Username
            if (!identifier.includes('@')) {
                console.log("Mendeteksi login via Username: " + identifier);
                
                // Cari Username di Database 'users'
                // Syarat: Index 'idx_name' harus ada & Permission 'Any: Read' aktif
                const response = await databases.listDocuments(
                    CONFIG.DB_ID, 
                    CONFIG.COLLECTION_USERS, 
                    [Appwrite.Query.equal('name', identifier)]
                );

                // Jika Username tidak ditemukan di database
                if (response.documents.length === 0) {
                    throw new Error("Username tidak ditemukan. Pastikan ejaan benar atau gunakan Email.");
                }
                
                // Jika ketemu, AMBIL EMAILNYA
                identifier = response.documents[0].email;
                console.log("Username ditemukan! Login menggunakan email: " + identifier);
            }

            // Eksekusi Login (Selalu menggunakan Email di belakang layar)
            await account.createEmailPasswordSession(identifier, password);
            
            console.log("Login Berhasil!");
            // Masuk ke Dashboard
            initApp(); 

        } catch (error) {
            console.error(error);
            alert("Login Gagal: " + error.message);
            hideLoading();
        }
    });
}

// ======================================================
// 2. LOGIKA SIGNUP (MENGISI DATA AGAR TIDAK NULL)
// ======================================================
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; 
        const email = el('regEmail').value;
        const phone = el('regPhone').value; 
        const pass = el('regPass').value; 
        const verify = el('regVerify').value;

        if (pass !== verify) return alert("Password verifikasi tidak cocok!");

        showLoading();
        try {
            // 1. Buat Akun Utama
            const userAuth = await account.create(Appwrite.ID.unique(), email, pass, name);
            
            // 2. Simpan Data ke Database Custom (SUPAYA KOLOM 'name' TERISI)
            await databases.createDocument(
                CONFIG.DB_ID, 
                CONFIG.COLLECTION_USERS, 
                userAuth.$id, 
                { 
                    name: name,    // INI PENTING: Mengisi kolom name agar tidak NULL
                    email: email, 
                    phone: phone,
                    password: pass 
                }
            );

            alert("Pendaftaran Berhasil! Silakan Login.");
            el('signupForm').reset();
            nav('loginPage');
        } catch (error) {
            alert("Gagal Daftar: " + error.message);
        } finally {
            hideLoading();
        }
    });
}

// ======================================================
// 3. LOGIKA LOAD FILES (Menampilkan Data)
// ======================================================
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    if(grid) grid.innerHTML = ''; 

    try {
        const response = await databases.listDocuments(
            CONFIG.DB_ID, 
            CONFIG.COLLECTION_FILES, 
            [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.equal('parentId', folderId)
            ]
        );

        const searchVal = el('searchInput') ? el('searchInput').value.toLowerCase() : '';
        let totalSize = 0;

        response.documents.forEach(doc => {
            if (doc.name.toLowerCase().includes(searchVal)) {
                renderItem(doc);
            }
            if (doc.size) totalSize += doc.size;
        });
        updateStorageUI(totalSize);

    } catch (error) {
        console.error("Gagal load file:", error);
    }
}

function renderItem(doc) {
    const grid = el('fileGrid'); if(!grid) return;
    const div = document.createElement('div'); div.className = 'item-card';
    
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    const color = isFolder ? '#facc15' : '#60a5fa'; 
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}', '${doc.type}', '${doc.fileId}')">
            <i class="fa-solid fa-trash"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            <i class="icon fa-solid ${icon}" style="color: ${color}"></i>
            <div class="item-name" style="color:white; margin-top:10px;">${doc.name}</div>
        </div>
    `;
    grid.appendChild(div);
}

// ======================================================
// 4. MODAL & DRAG DROP LOGIC
// ======================================================
window.openModal = (modalId) => {
    const modal = el(modalId);
    if(modal) modal.classList.remove('hidden');
    if(modalId === 'folderModal') { el('newFolderName').value = ''; el('newFolderName').focus(); }
    if(modalId === 'uploadModal') { el('fileInfoText').innerText = 'Belum ada file dipilih'; window.selectedFile = null; }
    const dropdown = document.querySelector('.dropdown-content');
    if(dropdown) dropdown.classList.remove('show');
};
window.closeModal = (modalId) => { el(modalId).classList.add('hidden'); };
window.createFolder = () => openModal('folderModal');
window.triggerUploadModal = () => openModal('uploadModal');

window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return alert("Nama folder kosong!");
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(
            CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
            { name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, url: null, fileId: null }
        );
        loadFiles(currentFolderId);
    } catch (error) { alert("Gagal: " + error.message); } 
    finally { hideLoading(); }
};

const dropZone = el('dropZone');
const fileInputHidden = el('fileInputHidden');
if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => { dropZone.classList.remove('dragover'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
}
if (fileInputHidden) {
    fileInputHidden.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });
}
function handleFileSelect(file) {
    window.selectedFile = file;
    el('fileInfoText').innerText = `File: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
}

window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file dulu!");
    closeModal('uploadModal'); showLoading();
    try {
        const file = window.selectedFile;
        const uploaded = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
            { name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: fileUrl.href, fileId: uploaded.$id, size: file.size }
        );
        loadFiles(currentFolderId);
    } catch (error) { alert("Gagal: " + error.message); } 
    finally { hideLoading(); }
};

// ======================================================
// 5. UTILS (Init, Logout, dll)
// ======================================================
async function initApp() {
    if(el('loading')) el('loading').classList.remove('hidden');
    try {
        currentUser = await account.get();
        updateGreeting();
        nav('dashboardPage');
        loadFiles(currentFolderId);
    } catch (error) {
        nav('loginPage');
    } finally {
        setTimeout(() => { if(el('loading')) el('loading').classList.add('hidden'); }, 500);
    }
}
document.addEventListener('DOMContentLoaded', initApp);

window.toggleDropdown = () => { document.querySelector('.dropdown-content').classList.toggle('show'); };
window.togglePass = (id, icon) => { const input = el(id); input.type = input.type === 'password' ? 'text' : 'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateStorageUI(bytes) { if(el('storageUsed')) el('storageUsed').innerText = (bytes / (1024 * 1024)).toFixed(2) + ' MB'; if(el('storageBar')) el('storageBar').style.width = Math.min((bytes / (2 * 1024 * 1024 * 1024)) * 100, 100) + '%'; }
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Evening"; if(el('welcomeText')) el('welcomeText').innerText = `Welcome In Drive ${s}`; }
window.deleteItem = async (docId, type, fileId) => { if(confirm("Hapus?")) { showLoading(); try { if(type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, docId); loadFiles(currentFolderId); } catch(e){ alert(e.message) } finally { hideLoading(); } } };
window.openFolder = (id) => { currentFolderId = id; loadFiles(id); };

if(el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => { 
    if(confirm("Keluar?")) { 
        showLoading(); 
        await account.deleteSession('current'); 
        nav('loginPage'); 
        hideLoading(); 
    } 
});
if(el('searchInput')) el('searchInput').addEventListener('input', ()=>loadFiles(currentFolderId));
