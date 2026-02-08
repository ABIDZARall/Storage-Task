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
let currentViewMode = 'root'; // root, recent, starred, trash, shared, computer
let selectedContextItem = null; // Item yang sedang diklik kanan

const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// ======================================================
// 2. NAVIGASI MENU UTAMA (LOGIKA FITUR)
// ======================================================
window.handleMenuClick = (element, mode) => {
    // UI Update
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');

    currentViewMode = mode;
    
    // Logika Ganti Mode
    switch(mode) {
        case 'root':
            currentFolderId = 'root';
            currentFolderName = "Drive Saya";
            break;
        case 'recent':
            currentFolderName = "Terbaru";
            break;
        case 'starred':
            currentFolderName = "Berbintang";
            break;
        case 'trash':
            currentFolderName = "Sampah";
            break;
        case 'computer':
            currentFolderName = "Komputer";
            break;
        case 'shared':
            currentFolderName = "Dibagikan kepada saya";
            break;
        default:
            currentFolderName = "Drive";
    }
    
    loadFiles(mode);
};

// ======================================================
// 3. LOAD FILES (QUERY DATABASE CANGGIH)
// ======================================================
async function loadFiles(mode) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 
    updateHeader(); // Update judul halaman

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];

    try {
        // --- LOGIKA FILTERING ---
        if (mode === 'recent') {
            // 1. TERBARU: Urutkan waktu, sembunyikan sampah
            queries.push(Appwrite.Query.orderDesc('$createdAt'));
            queries.push(Appwrite.Query.equal('trashed', false)); 
            queries.push(Appwrite.Query.limit(50));
        } 
        else if (mode === 'starred') {
            // 2. BERBINTANG: Cari starred=true, sembunyikan sampah
            queries.push(Appwrite.Query.equal('starred', true));
            queries.push(Appwrite.Query.equal('trashed', false));
        } 
        else if (mode === 'trash') {
            // 3. SAMPAH: Hanya tampilkan yang trashed=true
            queries.push(Appwrite.Query.equal('trashed', true));
        } 
        else if (mode === 'root' || typeof mode === 'string') {
            // 4. DRIVE SAYA (NORMAL): Berdasarkan folder, sembunyikan sampah
            if (typeof mode === 'string' && mode !== 'root') currentFolderId = mode;
            queries.push(Appwrite.Query.equal('parentId', currentFolderId));
            queries.push(Appwrite.Query.equal('trashed', false));
        }
        else {
            // 5. FITUR BELUM ADA (Komputer/Shared)
            renderPlaceholderState(mode);
            return;
        }

        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        
        if(res.documents.length === 0) {
            renderEmptyState(mode);
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }

    } catch (e) { 
        console.error("Query Error:", e);
        // Fallback jika atribut belum dibuat di DB
        if(e.message.includes('Attribute not found')) {
            alert("Harap buat atribut 'starred' (boolean) dan 'trashed' (boolean) di Appwrite Database!");
        }
    }
}

// ======================================================
// 4. RENDER ITEM & CONTEXT MENU
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card';
    
    // Data Item
    const isFolder = doc.type === 'folder';
    const name = doc.name || "Tanpa Nama";
    const safeName = name.replace(/'/g, "\\'");
    
    // Tampilan Ikon
    let iconHTML = '';
    if (isFolder) {
        iconHTML = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (name.toLowerCase().match(/\.(jpg|jpeg|png|webp)$/)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        iconHTML = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${url}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    } else {
        iconHTML = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    // Badge Bintang
    const starBadge = doc.starred ? `<i class="fa-solid fa-star star-badge"></i>` : '';

    // Event Handler (Klik Kiri & Kanan)
    div.oncontextmenu = (e) => showContextMenu(e, doc);
    
    // Klik Kiri: Buka jika folder, Preview jika file (Kecuali di Trash)
    if (!doc.trashed) {
        div.onclick = () => {
            if (isFolder) {
                currentFolderId = doc.$id;
                currentFolderName = name;
                currentViewMode = 'root'; // Reset mode ke navigasi normal
                loadFiles(doc.$id);
                // Update sidebar active ke 'Drive Saya'
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                document.querySelectorAll('.nav-item')[1].classList.add('active');
            } else {
                window.open(doc.url, '_blank');
            }
        };
    }

    div.innerHTML = `
        ${starBadge}
        ${iconHTML}
        <div class="item-name">${name}</div>
    `;
    grid.appendChild(div);
}

// === LOGIKA MENU KLIK KANAN (CONTEXT MENU) ===
function showContextMenu(e, doc) {
    e.preventDefault();
    selectedContextItem = doc;
    
    const menu = el('contextMenu');
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;
    menu.classList.remove('hidden');

    // Atur Teks & Visibilitas Menu Berdasarkan Status
    const starText = el('starText');
    const permDeleteBtn = el('permDeleteBtn');
    const restoreBtn = el('restoreBtn');
    const normalItems = document.querySelectorAll('.menu-item:not(.delete-permanent):not(.restore-item)');

    if (doc.trashed) {
        // Mode Sampah: Hanya tampilkan Restore & Hapus Permanen
        normalItems.forEach(i => i.classList.add('hidden'));
        permDeleteBtn.classList.remove('hidden');
        restoreBtn.classList.remove('hidden');
    } else {
        // Mode Normal
        normalItems.forEach(i => i.classList.remove('hidden'));
        permDeleteBtn.classList.add('hidden');
        restoreBtn.classList.add('hidden');
        starText.innerText = doc.starred ? "Hapus dari Berbintang" : "Tambahkan ke Berbintang";
    }

    // Tutup menu jika klik di tempat lain
    document.addEventListener('click', () => menu.classList.add('hidden'), {once:true});
}

// Aksi: Toggle Bintang
window.toggleStarItem = async () => {
    if(!selectedContextItem) return;
    const newState = !selectedContextItem.starred;
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedContextItem.$id, {
            starred: newState
        });
        loadFiles(currentViewMode); // Refresh
    } catch(e) { alert("Gagal update bintang: " + e.message); }
};

// Aksi: Pindahkan ke Sampah (Soft Delete)
window.moveItemToTrash = async () => {
    if(!selectedContextItem) return;
    if(!confirm(`Pindahkan "${selectedContextItem.name}" ke Sampah?`)) return;
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedContextItem.$id, {
            trashed: true
        });
        loadFiles(currentViewMode);
    } catch(e) { alert("Gagal memindahkan ke sampah"); }
};

// Aksi: Pulihkan dari Sampah
window.restoreFromTrash = async () => {
    if(!selectedContextItem) return;
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedContextItem.$id, {
            trashed: false
        });
        loadFiles('trash'); // Refresh halaman sampah
    } catch(e) { alert("Gagal memulihkan"); }
};

// Aksi: Hapus Permanen
window.deleteItemPermanently = async () => {
    if(!selectedContextItem) return;
    if(!confirm(`HAPUS PERMANEN "${selectedContextItem.name}"? File tidak bisa dikembalikan!`)) return;
    
    showLoading();
    try {
        if(selectedContextItem.type === 'file') {
            await storage.deleteFile(CONFIG.BUCKET_ID, selectedContextItem.fileId);
        }
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedContextItem.$id);
        calculateStorage();
        loadFiles('trash');
    } catch(e) { alert("Gagal hapus permanen: " + e.message); }
    finally { hideLoading(); }
};

// ======================================================
// 5. HELPER UI (HEADER & EMPTY STATES)
// ======================================================
function updateHeader() {
    const container = document.querySelector('.header-info') || document.querySelector('.breadcrumb-area');
    
    if (currentViewMode === 'root' && currentFolderId === 'root') {
        // Halaman Utama
        const h = new Date().getHours();
        const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`;
    } else {
        // Halaman Lain (Terbaru, Sampah, Folder)
        const showBack = currentFolderId !== 'root';
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:10px;">
                ${showBack ? `<button onclick="handleMenuClick(this,'root')" class="btn-pill small back-btn" style="width:fit-content; background:rgba(255,255,255,0.2);"><i class="fa-solid fa-arrow-left"></i> Kembali</button>` : ''}
                <h2 id="headerTitle">${currentFolderName}</h2>
                ${currentViewMode === 'trash' ? '<small style="opacity:0.7;">Item di sampah akan dihapus selamanya setelah 30 hari (Manual)</small>' : ''}
            </div>`;
    }
}

function renderEmptyState(mode) {
    const grid = el('fileGrid');
    let icon = 'fa-folder-open';
    let msg = 'Folder Kosong';

    if (mode === 'recent') { icon = 'fa-clock'; msg = 'Belum ada file terbaru'; }
    if (mode === 'starred') { icon = 'fa-star'; msg = 'Belum ada file berbintang'; }
    if (mode === 'trash') { icon = 'fa-trash-can'; msg = 'Sampah kosong'; }

    grid.innerHTML = `
        <div style="grid-column:1/-1; height:300px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:rgba(255,255,255,0.3);">
            <i class="fa-regular ${icon}" style="font-size:4rem; margin-bottom:20px;"></i>
            <p style="font-size:1.2rem;">${msg}</p>
        </div>`;
}

function renderPlaceholderState(title) {
    const grid = el('fileGrid');
    updateHeader();
    grid.innerHTML = `
        <div style="grid-column:1/-1; height:300px; display:flex; flex-direction:column; align-items:center; justify-content:center; color:rgba(255,255,255,0.3);">
            <img src="https://cdni.iconscout.com/illustration/premium/thumb/computer-maintenance-5353842-4469608.png" style="width:200px; opacity:0.6; filter:grayscale(100%);">
            <p style="font-size:1.2rem; margin-top:20px;">Fitur "${title}" Belum Tersedia</p>
            <small>Sedang dalam pengembangan</small>
        </div>`;
}

// ======================================================
// 6. INITIALIZATION & SESSION
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        currentFolderId = 'root';
        currentViewMode = 'root';
        calculateStorage(); 
        loadFiles('root');  
    } catch (e) { window.nav('loginPage'); } 
    finally { setTimeout(hideLoading, 500); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// Storage & Upload Logic (Sama seperti sebelumnya, disingkat untuk efisiensi)
async function calculateStorage() {
    if(!currentUser) return;
    try {
        // ... (Logika hitung storage sama persis dengan kode sebelumnya) ...
        // Bagian ini tidak berubah dari versi "Storage Fix"
        const [dbRes, bucketRes] = await Promise.all([
            databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file'), Appwrite.Query.limit(100)]),
            storage.listFiles(CONFIG.BUCKET_ID, [Appwrite.Query.limit(100)])
        ]);
        const realSizes = {}; bucketRes.files.forEach(f => realSizes[f.$id] = f.sizeOriginal);
        let total = 0;
        dbRes.documents.forEach(doc => {
            let s = doc.size; 
            if(!s && realSizes[doc.fileId]) { s = realSizes[doc.fileId]; databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, {size:s}).catch(()=>{}); }
            total += (s||0);
        });
        const mb = (total/1048576).toFixed(2);
        const pct = Math.min((parseFloat(mb)/2048)*100, 100);
        if(el('storageUsed')) el('storageUsed').innerText = `${mb} MB`;
        if(el('storageBar')) el('storageBar').style.width = `${pct}%`;
    } catch(e){}
}

// Create, Upload, Delete (Standar)
window.submitCreateFolder = async () => {
    const n = el('newFolderName').value.trim(); if(!n) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: n, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentViewMode); el('newFolderName').value = '';
    } catch(e){ alert(e.message); } finally { hideLoading(); }
};

window.submitUploadFile = async () => {
    if (!window.selectedFile) return alert("Pilih file!");
    closeModal('uploadModal'); showLoading();
    try {
        const f = window.selectedFile;
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), f);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: f.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: f.size, starred: false, trashed: false
        });
        loadFiles(currentViewMode); calculateStorage();
    } catch(e){ alert(e.message); } finally { hideLoading(); }
};

// ... (Auth, Logout, DragDrop, Helpers sama seperti sebelumnya) ...
// Pastikan bagian Helper UI dan Auth tetap ada di file Anda
window.nav = (p) => { document.querySelectorAll('section').forEach(s=>s.classList.add('hidden')); if(el(p)) el(p).classList.remove('hidden'); };
window.openModal = (id) => { el(id).classList.remove('hidden'); el('dropdownMenu').classList.remove('show'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => openModal('uploadModal');
window.createFolder = () => openModal('folderModal');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
if(el('logoutBtn')) el('logoutBtn').addEventListener('click', async()=>{ if(confirm('Keluar?')) { await account.deleteSession('current'); window.nav('loginPage'); }});
el('dropZone').addEventListener('dragover', (e)=>{e.preventDefault();});
el('dropZone').addEventListener('drop', (e)=>{e.preventDefault(); handleFileSelect(e.dataTransfer.files[0]);});
el('fileInputHidden').addEventListener('change', (e)=>handleFileSelect(e.target.files[0]));
function handleFileSelect(f) { window.selectedFile = f; el('fileInfoText').innerText = `File: ${f.name}`; }
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));
if(el('loginForm')) el('loginForm').addEventListener('submit', async(e)=>{ e.preventDefault(); try{ await account.createEmailPasswordSession(el('loginEmail').value, el('loginPass').value); checkSession(); }catch(err){alert(err.message);} });
if(el('signupForm')) el('signupForm').addEventListener('submit', async(e)=>{ e.preventDefault(); try{ const a = await account.create(Appwrite.ID.unique(), el('regEmail').value, el('regPass').value, el('regName').value); await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, a.$id, {name:el('regName').value, email:el('regEmail').value}); alert('Sukses'); nav('loginPage'); }catch(err){alert(err.message);} });