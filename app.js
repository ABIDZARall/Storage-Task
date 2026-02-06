// ======================================================
// STORAGE TASKS - APP.JS (FINAL FIX V2)
// ======================================================

// 1. Inisialisasi SDK
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// 2. Konfigurasi (Pastikan ID ini benar sesuai Console Anda)
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',   
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// 3. State Global
let currentUser = null;
let currentFolderId = 'root';

// 4. Helper UI
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
// FITUR 1: OTENTIKASI (LOGIN & SIGNUP)
// ======================================================

// A. LOGIKA LOGIN (Username & Email)
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let identifier = el('loginEmail').value.trim(); // Bisa Email atau Username
        const password = el('loginPass').value;
        
        showLoading();
        
        try {
            // STEP 1: Cek apakah user input Username (tidak ada @)
            if (!identifier.includes('@')) {
                console.log("Mendeteksi Username. Mencari email...");
                
                // Cari Username di Database 'users'
                const response = await databases.listDocuments(
                    CONFIG.DB_ID, 
                    CONFIG.COLLECTION_USERS, 
                    [Appwrite.Query.equal('name', identifier)]
                );

                // Jika Username tidak ditemukan
                if (response.documents.length === 0) {
                    throw new Error("Username tidak ditemukan. Cek ejaan atau gunakan Email.");
                }
                
                // Ambil email dari hasil pencarian
                identifier = response.documents[0].email;
                console.log("Email ditemukan: " + identifier);
            }

            // STEP 2: Login menggunakan Email (Asli atau Hasil Pencarian)
            await account.createEmailPasswordSession(identifier, password);
            
            // STEP 3: Sukses, masuk ke Dashboard
            console.log("Login Berhasil!");
            checkSession(); 

        } catch (error) {
            console.error(error);
            alert("Login Gagal: " + error.message);
            hideLoading();
        }
    });
}

// B. LOGIKA SIGN UP (Menyimpan Data agar Tidak NULL)
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
            // 1. Buat Akun di Appwrite Auth
            const userAuth = await account.create(Appwrite.ID.unique(), email, pass, name);
            
            // 2. SIMPAN DATA KE DATABASE (PENTING AGAR BISA LOGIN PAKAI USERNAME NANTI)
            await databases.createDocument(
                CONFIG.DB_ID, 
                CONFIG.COLLECTION_USERS, 
                userAuth.$id, 
                { 
                    name: name,    // Menyimpan Username
                    email: email,  // Menyimpan Email
                    phone: phone,
                    password: pass 
                }
            );

            alert("Daftar Berhasil! Silakan Login.");
            el('signupForm').reset();
            nav('loginPage');
        } catch (error) {
            alert("Gagal Daftar: " + error.message);
        } finally {
            hideLoading();
        }
    });
}

// C. Cek Sesi (Saat Aplikasi Dibuka)
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        updateGreeting();
        nav('dashboardPage');
        loadFiles(currentFolderId); // Load file root
    } catch (error) {
        nav('loginPage');
    } finally {
        setTimeout(() => { hideLoading(); }, 500);
    }
}
// Jalankan saat pertama kali
document.addEventListener('DOMContentLoaded', checkSession);

// ======================================================
// FITUR 2: STORAGE (FOLDER & UPLOAD)
// ======================================================

// A. Menampilkan File (Load Files)
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    if(grid) grid.innerHTML = ''; 

    try {
        // Query ke Database Files
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

// B. Render Tampilan Item
function renderItem(doc) {
    const grid = el('fileGrid'); if(!grid) return;
    const div = document.createElement('div'); div.className = 'item-card';
    
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    const color = isFolder ? '#facc15' : '#60a5fa'; // Folder Kuning, File Biru
    
    // Klik Folder -> Masuk, Klik File -> Download/View
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

// C. Membuat Folder Baru
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return alert("Nama folder kosong!");
    closeModal('folderModal'); showLoading();
    
    try {
        await databases.createDocument(
            CONFIG.DB_ID, 
            CONFIG.COLLECTION_FILES, 
            Appwrite.ID.unique(),
            { 
                name: name, // Menggunakan 'name' (sesuai database baru)
                type: 'folder', 
                parentId: currentFolderId, 
                owner: currentUser.$id, 
                size: 0, 
                url: null, 
                fileId: null 
            }
        );
        loadFiles(currentFolderId);
    } catch (error) { alert("Gagal: " + error.message); } 
    finally { hideLoading(); }
};

// D. Upload File
window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file dulu!");
    closeModal('uploadModal'); showLoading();
    
    try {
        const file = window.selectedFile;
        // 1. Upload ke Storage Bucket
        const uploaded = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        // 2. Ambil URL File
        const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);
        
        // 3. Simpan Info ke Database
        await databases.createDocument(
            CONFIG.DB_ID, 
            CONFIG.COLLECTION_FILES, 
            Appwrite.ID.unique(),
            { 
                name: file.name, 
                type: 'file', 
                parentId: currentFolderId, 
                owner: currentUser.$id, 
                url: fileUrl.href, 
                fileId: uploaded.$id, 
                size: file.size 
            }
        );
        loadFiles(currentFolderId);
    } catch (error) { alert("Upload Gagal: " + error.message); } 
    finally { hideLoading(); }
};

// ======================================================
// UTILS & UI LISTENERS
// ======================================================

// Drag & Drop
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
    el('fileInfoText').innerText = `File Siap: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
}

// Modal System
window.openModal = (modalId) => {
    const modal = el(modalId);
    if(modal) modal.classList.remove('hidden');
    if(modalId === 'folderModal') { el('newFolderName').value = ''; el('newFolderName').focus(); }
    if(modalId === 'uploadModal') { el('fileInfoText').innerText = 'Belum ada file dipilih'; window.selectedFile = null; }
    document.querySelector('.dropdown-content').classList.remove('show');
};
window.closeModal = (modalId) => { el(modalId).classList.add('hidden'); };
window.createFolder = () => openModal('folderModal');
window.triggerUploadModal = () => openModal('uploadModal');

// Others
window.openFolder = (id) => { currentFolderId = id; loadFiles(id); };
window.deleteItem = async (docId, type, fileId) => { if(confirm("Hapus?")) { showLoading(); try { if(type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, docId); loadFiles(currentFolderId); } catch(e){ alert(e.message) } finally { hideLoading(); } } };
window.toggleDropdown = () => { document.querySelector('.dropdown-content').classList.toggle('show'); };
window.togglePass = (id, icon) => { const input = el(id); input.type = input.type === 'password' ? 'text' : 'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
function updateStorageUI(bytes) { if(el('storageUsed')) el('storageUsed').innerText = (bytes / (1024 * 1024)).toFixed(2) + ' MB'; if(el('storageBar')) el('storageBar').style.width = Math.min((bytes / (2 * 1024 * 1024 * 1024)) * 100, 100) + '%'; }
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Evening"; if(el('welcomeText')) el('welcomeText').innerText = `Welcome In Drive ${s}`; }

if(el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => { if(confirm("Keluar?")) { showLoading(); await account.deleteSession('current'); nav('loginPage'); hideLoading(); } });
if(el('searchInput')) el('searchInput').addEventListener('input', ()=>loadFiles(currentFolderId));
