const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// ======================================================
// 1. KONFIGURASI
// ======================================================
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',   
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// STATE VARIABLES
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedUploadFile = null;

const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// ======================================================
// 2. INISIALISASI (WAJIB JALAN PERTAMA)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Cek Login
    checkSession();
    
    // 2. Inisialisasi Tombol New (FIX UTAMA)
    initNewButton();
    
    // 3. Inisialisasi Drag & Drop
    initDragAndDrop();
    
    // 4. Inisialisasi Login Form
    initAuthForms();
});

// ======================================================
// 3. PERBAIKAN TOMBOL NEW (FIXED LOGIC)
// ======================================================
function initNewButton() {
    // Kita cari tombol secara manual lewat class
    const newBtn = document.querySelector('.new-btn');
    const dropdownMenu = el('dropdownMenu');

    if (newBtn && dropdownMenu) {
        // Hapus onclick bawaan HTML jika ada biar tidak bentrok
        newBtn.onclick = null;

        // Tambahkan Listener baru yang bersih
        newBtn.addEventListener('click', (e) => {
            // STOP PROPAGATION: Mencegah window.onclick menutup menu seketika
            e.stopPropagation(); 
            e.preventDefault();
            
            // Toggle class show
            dropdownMenu.classList.toggle('show');
        });
    }

    // Listener global untuk menutup menu jika klik di luar
    window.addEventListener('click', (e) => {
        if (!e.target.closest('.new-btn-wrapper')) {
            if (dropdownMenu && dropdownMenu.classList.contains('show')) {
                dropdownMenu.classList.remove('show');
            }
        }
    });
}

// Fungsi cadangan jika dipanggil dari HTML (Fallback)
window.toggleDropdown = (event) => {
    if(event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const menu = el('dropdownMenu');
    if(menu) menu.classList.toggle('show');
};

// ======================================================
// 4. LOGIN & SESI
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        currentFolderId = 'root';
        currentFolderName = "Drive";
        calculateStorage(); 
        loadFiles('root');  
    } catch (e) { 
        window.nav('loginPage'); 
    } finally { 
        setTimeout(hideLoading, 500); 
    }
}

function initAuthForms() {
    if(el('loginForm')) {
        el('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            let inputId = el('loginEmail').value.trim();
            const pass = el('loginPass').value;
            showLoading();
            try {
                if (!inputId.includes('@')) {
                    const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', inputId)]);
                    if (res.documents.length === 0) throw new Error("Username tidak ditemukan!");
                    inputId = res.documents[0].email;
                }
                try { await account.get(); } catch (err) { await account.createEmailPasswordSession(inputId, pass); }
                checkSession();
            } catch (error) {
                if(error.message.includes('session is active')) checkSession();
                else { alert("Login Gagal: " + error.message); hideLoading(); }
            }
        });
    }

    if(el('signupForm')) el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; const email = el('regEmail').value; const pass = el('regPass').value;
        showLoading();
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email });
            alert("Daftar Berhasil! Silakan Login."); window.nav('loginPage');
        } catch(e) { alert(e.message); } finally { hideLoading(); }
    });
}

// ======================================================
// 5. DRAG & DROP & UPLOAD
// ======================================================
function initDragAndDrop() {
    const dropZone = el('dropZone');
    const fileInput = el('fileInputHidden');

    if (!dropZone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    dropZone.addEventListener('dragover', () => dropZone.style.borderColor = '#4ade80'); // Visual Effect Hijau
    dropZone.addEventListener('dragleave', () => dropZone.style.borderColor = 'rgba(255,255,255,0.2)');

    dropZone.addEventListener('drop', (e) => {
        dropZone.style.borderColor = 'rgba(255,255,255,0.2)';
        const files = e.dataTransfer.files;
        if(files.length > 0) {
            selectedUploadFile = files[0];
            el('fileInfoText').innerText = `Siap Upload: ${selectedUploadFile.name}`;
            el('fileInfoText').style.color = '#4ade80';
        }
    });

    if(fileInput) {
        fileInput.addEventListener('change', function() {
            if(this.files.length > 0) {
                selectedUploadFile = this.files[0];
                el('fileInfoText').innerText = `Siap Upload: ${selectedUploadFile.name}`;
                el('fileInfoText').style.color = '#4ade80';
            }
        });
    }
}

// ======================================================
// 6. NAVIGASI HALAMAN
// ======================================================
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => { if(el(id)) el(id).classList.add('hidden'); });
    if(el(pageId)) el(pageId).classList.remove('hidden');
};

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[1].classList.add('active'); 
    loadFiles('root');
};

window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode;
    currentFolderId = 'root'; 
    if(mode === 'root') currentFolderName = "Drive";
    else if(mode === 'recent') currentFolderName = "Terbaru";
    else if(mode === 'starred') currentFolderName = "Berbintang";
    else if(mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();
    loadFiles(mode);
};

// ======================================================
// 7. LOAD FILES & RENDER
// ======================================================
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    if(grid) grid.innerHTML = ''; 
    updateHeaderUI();

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20), Appwrite.Query.equal('trashed', false));
    else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false));
    else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true));
    else {
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param;
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if(res.documents.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { console.error("Load Error:", e); }
}

function updateHeaderUI() {
    const container = document.querySelector('.breadcrumb-area');
    if (!container) return; 
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    if (isRoot) {
        const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`;
    } else {
        container.innerHTML = `<div style="display:flex;flex-direction:column;align-items:flex-start;gap:15px;"><button onclick="goBack()" class="btn-pill small" style="background:rgba(255,255,255,0.2);width:auto;padding:0 20px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button><h2 id="headerTitle">${currentFolderName}</h2></div>`;
    }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const name = doc.name || "Tanpa Nama";
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;font-size:1rem;z-index:10;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : 
                  name.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/) ? 
                  `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>` :
                  `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;

    div.oncontextmenu = (e) => {
        e.preventDefault(); selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`; menu.classList.remove('hidden');
        if(el('starText')) el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
        
        const isTrash = doc.trashed;
        if(el('trashBtn')) el('trashBtn').classList.toggle('hidden', isTrash);
        if(el('restoreBtn')) el('restoreBtn').classList.toggle('hidden', !isTrash);
        if(el('permDeleteBtn')) el('permDeleteBtn').classList.toggle('hidden', !isTrash);
        
        document.addEventListener('click', () => menu.classList.add('hidden'), {once:true});
    };
    
    div.onclick = () => { if(!doc.trashed) isFolder ? window.openFolder(doc.$id, name) : window.open(doc.url, '_blank'); };
    div.innerHTML = `${starHTML}${content}<div class="item-name">${name}</div>`;
    grid.appendChild(div);
}

window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; currentViewMode = 'root'; loadFiles(id); };

// ======================================================
// 8. AKSI (CREATE & UPLOAD)
// ======================================================
window.submitCreateFolder = async () => {
    const nameInput = el('newFolderName');
    const name = nameInput.value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentFolderId);
        nameInput.value = '';
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitUploadFile = async () => {
    if (!selectedUploadFile) { alert("Pilih file dulu!"); return; }
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false
        });
        selectedUploadFile = null;
        if(el('fileInfoText')) el('fileInfoText').innerText = "Belum ada file dipilih";
        loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

// Logout
if (el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => {
    if (confirm("Keluar?")) { showLoading(); try { await account.deleteSession('current'); location.reload(); } catch (e) { hideLoading(); } }
});

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const [dbRes, bucketRes] = await Promise.all([
            databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]),
            storage.listFiles(CONFIG.BUCKET_ID, [Appwrite.Query.limit(100)])
        ]);
        const realSizes = {}; bucketRes.files.forEach(f => { realSizes[f.$id] = f.sizeOriginal; });
        let totalBytes = 0;
        for (const doc of dbRes.documents) {
            if (doc.trashed === null || doc.starred === null || doc.size === null) {
                databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, {
                    trashed: doc.trashed ?? false, starred: doc.starred ?? false, size: doc.size ?? (realSizes[doc.fileId] || 0)
                }).catch(()=>{});
            }
            if(doc.type === 'file') totalBytes += (doc.size || 0);
        }
        const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
        if (el('storageUsed')) el('storageUsed').innerText = `${totalMB} MB`;
        if (el('storageBar')) el('storageBar').style.width = `${Math.min((totalMB / 2048) * 100, 100)}%`;
    } catch (e) { console.error(e); }
}

// Context Actions
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles('root'); } catch(e){alert(e.message);} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); } catch(e){alert(e.message);} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); } catch(e){alert(e.message);} };

// Helpers UI
window.openModal = (id) => { 
    const menu = el('dropdownMenu');
    if(menu) menu.classList.remove('show');
    el(id).classList.remove('hidden'); 
};
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };