const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// 1. KONFIGURASI
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

// STATE VARIABLES
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedUploadFile = null; 
let storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
let searchTimeout = null;

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// ======================================================
// 2. INISIALISASI (SOLUSI KONFLIK BUTTON NEW)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    // initNewButtonLogic(); <--- HAPUS INI (Penyebab konflik)
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus(); // <--- Menangani Klik Kiri & Kanan Sekaligus
});

// ======================================================
// 3. LOGIKA BUTTON NEW & CONTEXT MENUS (DIPERBAIKI)
// ======================================================
function initAllContextMenus() {
    const globalMenu = el('globalContextMenu');
    const newBtnMenu = el('dropdownMenu');
    const fileMenu = el('contextMenu');
    
    const newBtn = el('newBtnMain');
    const navDrive = el('navDrive');
    const mainArea = document.querySelector('.main-content-area');

    // Fungsi Tutup Semua Menu
    const closeAllMenus = () => {
        if(globalMenu) globalMenu.classList.remove('show');
        if(newBtnMenu) newBtnMenu.classList.remove('show');
        if(fileMenu) fileMenu.classList.add('hidden');
    };

    // A. LOGIKA TOMBOL NEW (GABUNGAN KLIK KIRI & KANAN)
    if (newBtn) {
        // Hapus listener lama dengan cara cloning node (PENTING AGAR TIDAK MACET)
        const newBtnClean = newBtn.cloneNode(true);
        newBtn.parentNode.replaceChild(newBtnClean, newBtn);

        // Handler Klik Kiri (Buka/Tutup Menu)
        newBtnClean.addEventListener('click', (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            
            // Logika Toggle: Jika terbuka -> tutup, jika tertutup -> buka
            const isOpen = newBtnMenu.classList.contains('show');
            closeAllMenus(); // Tutup yang lain dulu
            
            if (!isOpen) {
                newBtnMenu.classList.add('show');
            }
        });

        // Handler Klik Kanan (Buka Menu juga)
        newBtnClean.addEventListener('contextmenu', (e) => {
            e.preventDefault(); 
            e.stopPropagation();
            closeAllMenus();
            newBtnMenu.classList.add('show');
        });
    }

    // B. Klik Kanan Sidebar Drive Saya
    if (navDrive) {
        navDrive.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            closeAllMenus();
            globalMenu.style.top = `${e.clientY}px`;
            globalMenu.style.left = `${e.clientX}px`;
            globalMenu.classList.add('show');
        });
    }

    // C. Klik Kanan Area Kosong
    if (mainArea) {
        mainArea.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.item-card')) return; // Biarkan file handle sendiri
            e.preventDefault();
            closeAllMenus();
            globalMenu.style.top = `${e.clientY}px`;
            globalMenu.style.left = `${e.clientX}px`;
            globalMenu.classList.add('show');
        });
    }

    // D. Klik Kiri di mana saja (Tutup Menu)
    window.addEventListener('click', (e) => {
        if (e.target.closest('.dropdown-content') || e.target.closest('.context-menu-modern')) return;
        closeAllMenus();
    });
}

// ======================================================
// 4. RENDER ITEM & MENU FILE (LOGIKA SAMPAH FIXED)
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp|jfif)$/i)) {
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    
    // CONTEXT MENU FILE
    div.oncontextmenu = (e) => { 
        e.preventDefault(); e.stopPropagation();
        
        // Tutup menu global
        el('globalContextMenu').classList.remove('show');
        el('dropdownMenu').classList.remove('show');

        selectedItem = doc; 
        
        const menu = el('contextMenu'); 
        menu.style.top = `${e.clientY}px`; 
        menu.style.left = `${e.clientX}px`; 
        
        // Update Isi Menu (Bintang & SAMPAH)
        updateContextMenuUI(doc);
        
        // Tampilkan Menu
        menu.classList.remove('hidden');
    };
    grid.appendChild(div);
}

// FUNGSI UPDATE UI MENU (LOGIKA TOMBOL HAPUS)
function updateContextMenuUI(doc) {
    // 1. Atur Bintang
    const starText = el('ctxStarText'); const starIcon = el('ctxStarIcon');
    if (doc.starred) { 
        starText.innerText = "Hapus dari Berbintang"; 
        starIcon.style.color = '#ffd700'; 
        starIcon.classList.remove('fa-regular'); starIcon.classList.add('fa-solid');
    } else { 
        starText.innerText = "Tambahkan ke Berbintang"; 
        starIcon.style.color = 'rgba(255,255,255,0.7)'; 
    }

    // 2. Atur Tombol Sampah (Pindahkan vs Pulihkan)
    const isTrash = doc.trashed; // Boolean: true jika di sampah, false jika tidak
    const btnTrash = el('ctxTrashBtn');
    const btnRestore = el('ctxRestoreBtn');
    const btnPermDel = el('ctxPermDeleteBtn');

    if (isTrash) {
        // Jika file di Sampah: Sembunyikan tombol "Pindahkan ke Sampah"
        btnTrash.classList.add('hidden');
        // Tampilkan tombol Restore & Hapus Permanen
        btnRestore.classList.remove('hidden');
        btnPermDel.classList.remove('hidden');
    } else {
        // Jika file Normal: Tampilkan tombol "Pindahkan ke Sampah"
        btnTrash.classList.remove('hidden');
        // Sembunyikan tombol Restore & Hapus Permanen
        btnRestore.classList.add('hidden');
        btnPermDel.classList.add('hidden');
    }
}

// AKSI HAPUS KE SAMPAH
window.moveItemToTrash = async () => {
    if (!selectedItem) return;
    if(!confirm(`Pindahkan "${selectedItem.name}" ke Sampah?`)) return;

    try {
        await databases.updateDocument(
            CONFIG.DB_ID, 
            CONFIG.COLLECTION_FILES, 
            selectedItem.$id, 
            { trashed: true } // Set flag trashed = true
        );
        el('contextMenu').classList.add('hidden'); // Tutup menu
        loadFiles(currentViewMode === 'root' ? currentFolderId : currentViewMode); // Refresh list
    } catch(e) {
        alert("Gagal menghapus: " + e.message);
    }
};

// ... (Sisa fungsi loadFiles, search, auth tetap sama seperti sebelumnya) ...
// (Pastikan fungsi restoreFromTrash dan deleteItemPermanently juga ada di bawah ini)

window.restoreFromTrash = async () => { 
    try { 
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); 
        el('contextMenu').classList.add('hidden');
        loadFiles('trash'); 
    } catch(e){alert(e.message);} 
};

window.deleteItemPermanently = async () => { 
    if(!confirm("Hapus permanen selamanya?")) return; 
    try { 
        if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); 
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); 
        el('contextMenu').classList.add('hidden');
        loadFiles('trash'); calculateStorage(); 
    } catch(e){alert(e.message);} 
};

// FUNGSI NAVIGASI & SEARCH YANG HILANG (DIKEMBALIKAN)
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active');
    currentViewMode = mode; currentFolderId = 'root'; currentFolderName = (mode === 'root') ? 'Drive' : element.innerText.trim();
    loadFiles(mode);
};

window.goBack = () => { currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root'; document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); document.querySelectorAll('.nav-item')[0].classList.add('active'); loadFiles('root'); };
window.openFolder = (id, name) => { currentFolderId = id; currentFolderName = name; loadFiles(id); };

function initSearchBar() {
    const input = el('searchInput'); const clearBtn = el('clearSearchBtn');
    if (!input) return;
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 0) clearBtn.classList.remove('hidden'); else { clearBtn.classList.add('hidden'); loadFiles(currentFolderId); return; }
        clearTimeout(searchTimeout);
        el('fileGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;margin-top:50px;"><div class="spinner"></div><p>Mencari...</p></div>`;
        searchTimeout = setTimeout(() => performSearch(query), 600);
    });
}

async function performSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.search('name', keyword), Appwrite.Query.limit(50)]);
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;margin-top:50px;">Tidak ditemukan</p>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { fallbackSearch(keyword); }
}

async function fallbackSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => doc.name.toLowerCase().includes(keyword.toLowerCase()));
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan</p>`;
        else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}

window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

// ... (Fungsi Helper, Auth, Storage, DragDrop tetap sama) ...
window.openModal = (id) => { const globalMenu = el('globalContextMenu'); const newBtnMenu = el('dropdownMenu'); const fileMenu = el('contextMenu'); if(globalMenu) globalMenu.classList.remove('show'); if(newBtnMenu) newBtnMenu.classList.remove('show'); if(fileMenu) fileMenu.classList.add('hidden'); el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); el('contextMenu').classList.add('hidden'); } catch(e){alert(e.message);} };
function resetUploadUI() { selectedUploadFile = null; el('fileInfoContainer').classList.add('hidden'); el('fileInputHidden').value = ''; }
function handleFileSelect(file) { selectedUploadFile = file; el('fileInfoText').innerText = `Terpilih: ${file.name}`; el('fileInfoContainer').classList.remove('hidden'); }
function initDragAndDrop() { const zone = el('dropZone'); const input = el('fileInputHidden'); if (!zone) return; ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); })); zone.addEventListener('dragover', () => zone.classList.add('active')); zone.addEventListener('dragleave', () => zone.classList.remove('active')); zone.addEventListener('drop', (e) => { zone.classList.remove('active'); handleFileSelect(e.dataTransfer.files[0]); }); if (input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); }); }
window.submitUploadFile = async () => { if (!selectedUploadFile) return alert("Pilih file!"); closeModal('uploadModal'); showLoading(); try { const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile); await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: storage.getFileView(CONFIG.BUCKET_ID, up.$id).href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false }); resetUploadUI(); loadFiles(currentFolderId); calculateStorage(); } catch (e) { alert(e.message); } finally { hideLoading(); } };
window.submitCreateFolder = async () => { const name = el('newFolderName').value.trim(); if (!name) return; closeModal('folderModal'); showLoading(); try { await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false }); loadFiles(currentFolderId); el('newFolderName').value = ''; } catch (e) { alert(e.message); } finally { hideLoading(); } };
async function loadFiles(param) { if (!currentUser) return; const grid = el('fileGrid'); grid.innerHTML = ''; updateHeaderUI(); let queries = [Appwrite.Query.equal('owner', currentUser.$id)]; if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20), Appwrite.Query.equal('trashed', false)); else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false)); else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true)); else { if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param; queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false)); } updateHeaderUI(); try { const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries); if (res.documents.length === 0) grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`; else res.documents.forEach(doc => renderItem(doc)); } catch (e) { console.error(e); } }
function updateHeaderUI() { const container = document.querySelector('.breadcrumb-area'); const isRoot = currentFolderId === 'root' && currentViewMode === 'root'; if (isRoot) { const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night"; container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`; } else { container.innerHTML = `<div class="back-nav-container"><button onclick="goBack()" class="back-btn"><i class="fa-solid fa-arrow-left"></i> Kembali ke Drive</button><h2 id="headerTitle" style="margin-top:10px;">${currentFolderName}</h2></div>`; } }
window.openCurrentItem = () => { if(selectedItem) selectedItem.type==='folder' ? openFolder(selectedItem.$id, selectedItem.name) : window.open(selectedItem.url, '_blank'); el('contextMenu').classList.add('hidden'); };
window.downloadCurrentItem = () => { if(selectedItem && selectedItem.type!=='folder') window.open(storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId), '_blank'); el('contextMenu').classList.add('hidden'); };
window.renameCurrentItem = async () => { const newName = prompt("Nama baru:", selectedItem.name); if(newName) { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {name: newName}); loadFiles(currentFolderId); } el('contextMenu').classList.add('hidden'); };