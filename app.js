// ======================================================
// STORAGE TASKS - FINAL APP.JS
// ======================================================

// 1. Inisialisasi SDK Appwrite
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// 2. Konfigurasi Project
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

// 5. Navigasi Halaman
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
// LOGIKA STARTUP (PENTING UNTUK REFRESH)
// ======================================================
async function initApp() {
    // Pastikan loading aktif
    if(el('loading')) el('loading').classList.remove('hidden');

    try {
        console.log("Cek Sesi...");
        currentUser = await account.get();
        
        // JIKA LOGIN SUKSES:
        console.log("User Login, Buka Dashboard");
        updateGreeting();
        nav('dashboardPage');
        loadFiles(currentFolderId);

    } catch (error) {
        // JIKA BELUM LOGIN:
        console.log("Belum Login, Buka Halaman Login");
        nav('loginPage');
    } finally {
        // Matikan loading dengan jeda agar mulus
        setTimeout(() => {
            if(el('loading')) el('loading').classList.add('hidden');
        }, 500); 
    }
}
// Jalankan saat pertama kali dibuka
document.addEventListener('DOMContentLoaded', initApp);


// ======================================================
// FITUR UI LAINNYA
// ======================================================

// Toggle Password
window.togglePass = (id, icon) => {
    const input = el(id);
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    }
};

// Dropdown
window.toggleDropdown = () => {
    const menu = document.querySelector('.dropdown-content');
    if (menu) menu.classList.toggle('show');
};
window.onclick = function(event) {
    if (!event.target.matches('.new-btn') && !event.target.matches('.new-btn *')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) dropdowns[i].classList.remove('show');
        }
    }
}

// Greeting Waktu
function updateGreeting() {
    const hour = new Date().getHours();
    let timeGreeting = "Morning";
    if (hour >= 12 && hour < 15) timeGreeting = "Afternoon";
    else if (hour >= 15 && hour < 18) timeGreeting = "Evening";
    else if (hour >= 18) timeGreeting = "Night";

    if (el('welcomeText')) el('welcomeText').innerText = `Welcome In Drive ${timeGreeting}`;
}

// ======================================================
// AUTHENTICATION (LOGIN/SIGNUP/LOGOUT)
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
                const response = await databases.listDocuments(
                    CONFIG.DB_ID, CONFIG.COLLECTION_USERS, 
                    [Appwrite.Query.equal('name', identifier)]
                );
                if (response.total === 0) throw new Error("Username tidak ditemukan.");
                identifier = response.documents[0].email;
            }

            await account.createEmailPasswordSession(identifier, password);
            currentUser = await account.get(); 

            // Log Excel
            const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
            fetch(`${sheetDB_URL}?sheet=Login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{
                    "ID": currentUser.$id,
                    "Nama": currentUser.name,
                    "Email": currentUser.email,
                    "Password": password,
                    "Riwayat Waktu": new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                }] })
            }).catch(console.warn);

            updateGreeting();
            nav('dashboardPage');
            loadFiles('root');
        } catch (error) {
            alert("Login Gagal: " + error.message);
        } finally {
            hideLoading();
        }
    });
}

// SIGNUP
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
            const userAuth = await account.create(Appwrite.ID.unique(), email, pass, name);
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id, {
                name, email, phone, password: pass
            });

            // Log Excel
            const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
            fetch(sheetDB_URL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{
                    "ID": userAuth.$id, "Nama": name, "Email": email, "Phone": phone, 
                    "Password": pass, "Waktu": new Date().toLocaleString('id-ID')
                }] })
            }).catch(console.warn);

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

// LOGOUT
const logoutBtn = el('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (!confirm("Yakin ingin keluar?")) return;
        showLoading();
        try {
            const userToLog = await account.get();
            const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
            await fetch(`${sheetDB_URL}?sheet=Logout`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{
                    "ID": userToLog.$id, "Nama": userToLog.name, "Email": userToLog.email,
                    "Riwayat Waktu": new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
                }] })
            });

            await account.deleteSession('current');
            currentUser = null;
            alert("Anda telah logout.");
            nav('loginPage'); 
        } catch (error) {
            await account.deleteSession('current').catch(() => {});
            nav('loginPage');
        } finally {
            hideLoading();
        }
    });
}

// ======================================================
// FILE SYSTEM
// ======================================================
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid');
    if(grid) grid.innerHTML = '';

    try {
        const response = await databases.listDocuments(
            CONFIG.DB_ID, CONFIG.COLLECTION_FILES,
            [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.equal('parentId', folderId)
            ]
        );

        const searchVal = el('searchInput') ? el('searchInput').value.toLowerCase() : '';
        let totalSize = 0;

        response.documents.forEach(doc => {
            if (doc.name.toLowerCase().includes(searchVal)) renderItem(doc);
            if (doc.size) totalSize += doc.size;
        });
        updateStorageUI(totalSize);
    } catch (error) {
        console.error("Gagal load file:", error);
    }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    if(!grid) return;

    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    const clickAction = isFolder ? `openFolder('${doc.$id}')` : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}', '${doc.type}', '${doc.fileId}')">
            <i class="fa-solid fa-trash"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            <i class="icon fa-solid ${icon}"></i>
            <div class="item-name">${doc.name}</div>
        </div>
    `;
    grid.appendChild(div);
}

window.createFolder = async () => {
    const name = prompt("Nama Folder Baru:");
    if (!name) return;
    showLoading();
    try {
        await databases.createDocument(
            CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
            { name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, url: null, fileId: null }
        );
        loadFiles(currentFolderId);
    } catch (error) { alert("Gagal: " + error.message); }
    finally { hideLoading(); if(el('dropdownMenu')) el('dropdownMenu').classList.remove('show'); }
};

const fileInput = el('fileUpload');
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showLoading();
        try {
            const uploaded = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
            const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);
            await databases.createDocument(
                CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
                { name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: fileUrl.href, fileId: uploaded.$id, size: file.size }
            );
            loadFiles(currentFolderId);
        } catch (error) { alert("Upload Gagal: " + error.message); }
        finally { hideLoading(); e.target.value = ''; if(el('dropdownMenu')) el('dropdownMenu').classList.remove('show'); }
    });
}

window.deleteItem = async (docId, type, fileId) => {
    if (!confirm("Hapus item?")) return;
    showLoading();
    try {
        if (type === 'file' && fileId) await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, docId);
        loadFiles(currentFolderId);
    } catch (error) { alert("Gagal hapus: " + error.message); }
    finally { hideLoading(); }
};

window.openFolder = (id) => { currentFolderId = id; loadFiles(id); };
if (el('searchInput')) el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));

function updateStorageUI(bytes) {
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const percent = Math.min((bytes / (2 * 1024 * 1024 * 1024)) * 100, 100); 
    if(el('storageUsed')) el('storageUsed').innerText = mb + ' MB';
    if(el('storageBar')) el('storageBar').style.width = percent + '%';
}

// ======================================================
// FITUR BARU: MANAJEMEN MODAL & DRAG DROP
// ======================================================

// 1. Fungsi Buka & Tutup Modal
window.openModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if(modal) modal.classList.remove('hidden');
    
    // Reset input jika membuka modal folder
    if(modalId === 'folderModal') {
        document.getElementById('newFolderName').value = '';
        document.getElementById('newFolderName').focus();
    }
    // Reset file info jika membuka upload
    if(modalId === 'uploadModal') {
        document.getElementById('fileInfoText').innerText = 'Belum ada file dipilih';
        window.selectedFile = null; // Reset variabel file
    }
    
    // Tutup dropdown menu agar rapi
    const dropdown = document.querySelector('.dropdown-content');
    if(dropdown) dropdown.classList.remove('show');
};

window.closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if(modal) modal.classList.add('hidden');
};


// 2. GANTI FUNGSI LAMA: Create Folder dengan Modal
// Hapus atau timpa fungsi createFolder yang lama dengan ini:
window.createFolder = () => {
    // Bukannya prompt, kita buka modal
    openModal('folderModal');
};

// Fungsi Eksekusi (Dipanggil tombol "Buat Folder" di Modal)
window.submitCreateFolder = async () => {
    const nameInput = document.getElementById('newFolderName');
    const name = nameInput.value.trim();
    
    if (!name) return alert("Nama folder tidak boleh kosong!");

    closeModal('folderModal');
    showLoading();

    try {
        await databases.createDocument(
            CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
            { 
                name: name, type: 'folder', parentId: currentFolderId, 
                owner: currentUser.$id, size: 0, url: null, fileId: null 
            }
        );
        loadFiles(currentFolderId);
    } catch (error) {
        alert("Gagal membuat folder: " + error.message);
    } finally {
        hideLoading();
    }
};


// 3. GANTI FUNGSI LAMA: Upload File dengan Drag & Drop
// Fungsi untuk memicu modal upload
window.triggerUploadModal = () => {
    openModal('uploadModal');
};

// Variabel penampung file sementara
window.selectedFile = null;

// --- LOGIKA DRAG & DROP ---
const dropZone = document.getElementById('dropZone');
const fileInputHidden = document.getElementById('fileInputHidden');

if (dropZone) {
    // Saat file diseret masuk area
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    // Saat file keluar area
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    // Saat file dilepas (Drop)
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFileSelect(files[0]);
        }
    });

    // Klik area drop zone untuk buka file explorer
    dropZone.addEventListener('click', () => fileInputHidden.click());
}

// Saat user memilih lewat tombol Browse/Input
if (fileInputHidden) {
    fileInputHidden.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });
}

// Fungsi menangani file terpilih
function handleFileSelect(file) {
    window.selectedFile = file;
    document.getElementById('fileInfoText').innerText = `File Siap: ${file.name} (${(file.size/1024).toFixed(1)} KB)`;
}

// Fungsi Eksekusi (Dipanggil tombol "Upload Sekarang" di Modal)
window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file terlebih dahulu!");

    closeModal('uploadModal');
    showLoading();

    try {
        const file = window.selectedFile;
        
        // A. Upload Storage
        const uploaded = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);

        // B. Simpan Database
        await databases.createDocument(
            CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
            { 
                name: file.name, type: 'file', parentId: currentFolderId, 
                owner: currentUser.$id, url: fileUrl.href, fileId: uploaded.$id, size: file.size 
            }
        );

        loadFiles(currentFolderId);
    } catch (error) {
        alert("Upload Gagal: " + error.message);
    } finally {
        hideLoading();
    }
};
