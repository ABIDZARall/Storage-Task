// ======================================================
// STORAGE TASKS - FIXED & DEBUGGED VERSION
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

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

let currentUser = null;
let currentFolderId = 'root';

// UI Helpers
const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// Navigasi
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
// CORE LOGIC - MEMPERBAIKI LOAD FILES
// ======================================================

async function loadFiles(folderId) {
    if (!currentUser) return;
    
    // Debugging: Cek ID yang sedang aktif
    console.log("Memuat file untuk User:", currentUser.$id, " di Folder:", folderId);

    const grid = el('fileGrid'); 
    if(grid) grid.innerHTML = '<p style="color:white; text-align:center; width:100%;">Memuat data...</p>';

    try {
        // PERBAIKAN QUERY:
        // Pastikan Index 'owner' dan 'parentId' sudah dibuat di Appwrite Console!
        const response = await databases.listDocuments(
            CONFIG.DB_ID, 
            CONFIG.COLLECTION_FILES, 
            [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.equal('parentId', folderId)
            ]
        );

        console.log("Data diterima dari Appwrite:", response); // LIHAT INI DI CONSOLE

        if(grid) grid.innerHTML = ''; // Bersihkan loading

        if (response.documents.length === 0) {
            grid.innerHTML = '<p style="color:rgba(255,255,255,0.5); text-align:center; width:100%; margin-top:20px;">Folder ini kosong.</p>';
            updateStorageUI(0);
            return;
        }

        const searchVal = el('searchInput') ? el('searchInput').value.toLowerCase() : '';
        let totalSize = 0;

        response.documents.forEach(doc => {
            // Filter pencarian di sisi client
            if (doc.name.toLowerCase().includes(searchVal)) {
                renderItem(doc);
            }
            // Hitung size aman (cegah error jika size null)
            if (doc.size) totalSize += doc.size;
        });
        
        updateStorageUI(totalSize);

    } catch (error) {
        console.error("GAGAL MEMUAT FILE:", error); // Error akan muncul merah di console
        if(grid) grid.innerHTML = `<p style="color:#ff6b6b; text-align:center; width:100%;">Gagal memuat data.<br><small>${error.message}</small></p>`;
        
        // Deteksi Error Khusus Index Missing
        if (error.message.includes("Index not found")) {
            alert("SISTEM ERROR: Anda belum membuat Index di Database Appwrite.\nSilakan buat Index untuk 'owner' dan 'parentId'.");
        }
    }
}

// 2. Render Item (Tampilan Kotak File)
function renderItem(doc) {
    const grid = el('fileGrid'); if(!grid) return;
    const div = document.createElement('div'); div.className = 'item-card';
    
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    // Perbaikan warna icon
    const iconColor = isFolder ? '#facc15' : '#60a5fa'; 
    
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}', '${doc.type}', '${doc.fileId}')">
            <i class="fa-solid fa-trash"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer;">
            <i class="icon fa-solid ${icon}" style="color: ${iconColor}"></i>
            <div class="item-name" style="margin-top:10px; font-size:0.9rem; color:white;">${doc.name}</div>
        </div>
    `;
    grid.appendChild(div);
}

// ======================================================
// FUNGSI LAINNYA (MODAL, AUTH, DLL)
// ======================================================

// ... (Bagian Auth dan Modal sama seperti sebelumnya, pastikan fungsi ini ada) ...

// Start App
async function initApp() {
    if(el('loading')) el('loading').classList.remove('hidden');
    try {
        console.log("Cek sesi user...");
        currentUser = await account.get();
        console.log("User Login:", currentUser);
        
        updateGreeting();
        nav('dashboardPage');
        loadFiles(currentFolderId);
    } catch (error) {
        console.log("Belum login atau sesi habis.");
        nav('loginPage');
    } finally {
        setTimeout(() => { if(el('loading')) el('loading').classList.add('hidden'); }, 500);
    }
}
document.addEventListener('DOMContentLoaded', initApp);

// Modal Helpers
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

// Create Folder Logic
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return alert("Nama folder kosong!");
    closeModal('folderModal'); showLoading();
    try {
        // Kita isi size 0 dan url/fileId null agar sesuai struktur
        await databases.createDocument(
            CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
            { name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, url: null, fileId: null }
        );
        console.log("Folder berhasil dibuat!");
        loadFiles(currentFolderId);
    } catch (error) { 
        console.error(error);
        alert("Gagal: " + error.message); 
    } finally { hideLoading(); }
};

// Upload Logic
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
        // 1. Upload Fisik
        const uploaded = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        // 2. Ambil URL
        const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);
        // 3. Simpan Metadata
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(),
            { name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: fileUrl.href, fileId: uploaded.$id, size: file.size }
        );
        console.log("File berhasil diupload!");
        loadFiles(currentFolderId);
    } catch (error) { 
        console.error(error);
        alert("Gagal: " + error.message); 
    } finally { hideLoading(); }
};

// Helper UI Lainnya
window.toggleDropdown = () => { document.querySelector('.dropdown-content').classList.toggle('show'); };
window.togglePass = (id, icon) => { const input = el(id); input.type = input.type === 'password' ? 'text' : 'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };
window.openFolder = (id) => { currentFolderId = id; loadFiles(id); };
window.deleteItem = async (docId, type, fileId) => { if(confirm("Hapus?")) { showLoading(); try { if(type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, docId); loadFiles(currentFolderId); } catch(e){ alert(e.message) } finally { hideLoading(); } } };
function updateStorageUI(bytes) { if(el('storageUsed')) el('storageUsed').innerText = (bytes / (1024 * 1024)).toFixed(2) + ' MB'; if(el('storageBar')) el('storageBar').style.width = Math.min((bytes / (2 * 1024 * 1024 * 1024)) * 100, 100) + '%'; }
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Evening"; if(el('welcomeText')) el('welcomeText').innerText = `Welcome In Drive ${s}`; }

// Listeners Form
if(el('loginForm')) el('loginForm').addEventListener('submit', async (e)=>{ e.preventDefault(); showLoading(); try { await account.createEmailPasswordSession(el('loginEmail').value, el('loginPass').value); initApp(); } catch(err){ alert(err.message); hideLoading(); } });
if(el('logoutBtn')) el('logoutBtn').addEventListener('click', async ()=>{ if(confirm("Logout?")){ await account.deleteSession('current'); nav('loginPage'); } });
if(el('searchInput')) el('searchInput').addEventListener('input', ()=>loadFiles(currentFolderId));
