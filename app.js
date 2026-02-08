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

// === 1. LOGIKA WAKTU (GREETING) ===
function updateGreeting() {
    const h = new Date().getHours();
    let timeString = "Morning";
    if (h >= 12 && h < 15) timeString = "Afternoon";
    else if (h >= 15 && h < 19) timeString = "Evening";
    else if (h >= 19 || h < 4) timeString = "Night";

    const titleElement = el('headerTitle');
    if (titleElement && currentFolderId === 'root') {
        titleElement.innerText = `Welcome In Drive ${timeString}`;
    }
}

// === 2. CEK SESI USER ===
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        currentFolderId = 'root';
        
        // Panggil hitung storage saat awal masuk
        calculateStorage(); 
        
        loadFiles('root'); 
    } catch (e) { 
        window.nav('loginPage'); 
    } finally { 
        setTimeout(hideLoading, 500); 
    }
}
document.addEventListener('DOMContentLoaded', checkSession);

// === 3. FUNGSI PENGHITUNG STORAGE CERDAS (AUTO-REPAIR) ===
async function calculateStorage() {
    if (!currentUser) return;

    try {
        // A. Ambil daftar file dari DATABASE
        const dbPromise = databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('type', 'file'),
            Appwrite.Query.limit(100) // Batas ambil 100 file untuk dihitung
        ]);

        // B. Ambil daftar file asli dari STORAGE BUCKET (Sumber kebenaran)
        // Ini untuk mendapatkan ukuran file lama yang belum tercatat di database
        const bucketPromise = storage.listFiles(CONFIG.BUCKET_ID, [
            Appwrite.Query.limit(100)
        ]);

        const [dbRes, bucketRes] = await Promise.all([dbPromise, bucketPromise]);

        // C. Buat peta ukuran file dari bucket (ID File -> Ukuran Asli)
        const realSizes = {};
        bucketRes.files.forEach(f => {
            realSizes[f.$id] = f.sizeOriginal;
        });

        let totalBytes = 0;
        let needsUpdate = false;

        // D. Loop dan Hitung
        for (const doc of dbRes.documents) {
            let size = doc.size;

            // JIKA UKURAN KOSONG/NOL (Kasus File Lama)
            if (!size || size === 0) {
                // Cari ukuran aslinya di bucket
                const realSize = realSizes[doc.fileId];
                
                if (realSize) {
                    size = realSize;
                    // AUTO-REPAIR: Simpan ukuran ini ke database agar besok tidak perlu cari lagi
                    databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, {
                        size: size
                    }).catch(err => console.log("Gagal auto-repair:", err));
                    
                    console.log(`Memperbaiki data ukuran file: ${doc.name} -> ${size} bytes`);
                }
            }
            
            totalBytes += (size || 0);
        }

        // E. Konversi ke MB dan Tampilkan
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
        const maxStorageMB = 2048; // 2 GB
        const percentage = Math.min((parseFloat(totalMB) / maxStorageMB) * 100, 100);

        // Update UI
        if (el('storageUsed')) el('storageUsed').innerText = `${totalMB} MB`;
        if (el('storageBar')) {
            el('storageBar').style.width = `${percentage}%`;
            // Ubah warna jadi merah jika hampir penuh (>90%)
            el('storageBar').style.background = percentage > 90 ? '#ff5252' : 'var(--accent)';
        }

    } catch (e) {
        console.error("Gagal menghitung storage:", e);
    }
}

// === 4. LOAD FILES & HEADER ===
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    if (grid) grid.innerHTML = ''; 

    const targetHeader = document.querySelector('.header-info') || document.querySelector('.breadcrumb-area');

    if (targetHeader) {
        if(folderId !== 'root') {
            targetHeader.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:flex-start; gap:15px;">
                    <button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 20px;">
                        <i class="fa-solid fa-arrow-left"></i> Kembali
                    </button> 
                    <h2 id="headerTitle">${currentFolderName}</h2>
                </div>`;
        } else {
            targetHeader.innerHTML = `<h2 id="headerTitle">Welcome In Drive</h2>`;
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
            grid.innerHTML = `<p style="grid-column:1/-1; width:100%; text-align:center; color:rgba(255,255,255,0.5); margin-top:50px;">Folder Kosong</p>`;
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
    const safeName = fileName.replace(/'/g, "\\'"); 

    let content = '';
    if (isFolder) {
        content = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        content = `<div class="thumb-box"><img src="${url}" class="thumb-img"></div>`;
    } else {
        content = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    const clickAction = isFolder ? `openFolder('${doc.$id}', '${safeName}')` : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')"><i class="fa-solid fa-xmark"></i></button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            ${content}<div class="item-name">${fileName}</div>
        </div>`;
    grid.appendChild(div);
}

// === 6. FUNGSI AKSI ===
window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; loadFiles(id); };

window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file!");
    closeModal('uploadModal'); showLoading();
    try {
        const file = window.selectedFile;
        // 1. Upload ke Bucket
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        
        // 2. Simpan ke Database (TERMASUK SIZE)
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: file.name, 
            type: 'file', 
            parentId: currentFolderId, 
            owner: currentUser.$id, 
            url: url.href, 
            fileId: up.$id, 
            size: file.size // <--- PENTING: Menyimpan ukuran file
        });
        
        loadFiles(currentFolderId);
        calculateStorage(); // Update bar storage
        
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.deleteItem = async (id, type, fileId) => {
    if (!confirm("Hapus item ini?")) return;
    showLoading();
    try {
        if (type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, id);
        
        loadFiles(currentFolderId);
        calculateStorage(); // Update bar storage
        
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// UI Helpers
window.nav = (p) => { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); if(el(p)) el(p).classList.remove('hidden'); };
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');

// Login Handlers
if(el('loginForm')) el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let id = el('loginEmail').value.trim(); const pw = el('loginPass').value;
    showLoading();
    try {
        if (!id.includes('@')) {
            const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', id)]);
            if(res.total===0) throw new Error("User tidak ditemukan");
            id = res.documents[0].email;
        }
        await account.createEmailPasswordSession(id, pw);
        checkSession();
    } catch(e) { alert(e.message); hideLoading(); }
});

// Drag Drop
el('dropZone').addEventListener('dragover', (e) => e.preventDefault());
el('dropZone').addEventListener('drop', (e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]); });
el('fileInputHidden').addEventListener('change', (e) => handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));