const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// === 1. SISTEM PERBAIKAN DATA & HITUNG STORAGE ===
async function calculateStorage() {
    if (!currentUser) return;
    try {
        const [dbRes, bucketRes] = await Promise.all([
            databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.limit(100)
            ]),
            storage.listFiles(CONFIG.BUCKET_ID, [Appwrite.Query.limit(100)])
        ]);

        const realSizes = {};
        bucketRes.files.forEach(f => { realSizes[f.$id] = f.sizeOriginal; });

        let totalBytes = 0;

        for (const doc of dbRes.documents) {
            // A. LOGIKA PERBAIKAN DATA (MENGATASI KOSONGNYA GRID)
            // Jika trashed atau starred bernilai null, kita paksa jadi false agar muncul di grid
            if (doc.trashed === null || doc.starred === null || doc.size === null) {
                console.log(`Memperbaiki data atribut untuk: ${doc.name}`);
                databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, {
                    trashed: doc.trashed ?? false,
                    starred: doc.starred ?? false,
                    size: doc.size ?? (realSizes[doc.fileId] || 0)
                }).catch(() => {});
            }

            if (doc.type === 'file') {
                totalBytes += (doc.size || 0);
            }
        }

        const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
        const percentage = Math.min((parseFloat(totalMB) / 2048) * 100, 100);

        if (el('storageUsed')) el('storageUsed').innerText = `${totalMB} MB`;
        if (el('storageBar')) el('storageBar').style.width = `${percentage}%`;
    } catch (e) { console.error("Error Storage:", e); }
}

// === 2. LOAD FILES DENGAN LOGIKA NAVIGASI ===
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    // Penyesuaian Kueri Berdasarkan Menu Sidebar
    if (param === 'recent') {
        queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20));
        queries.push(Appwrite.Query.equal('trashed', false));
    } else if (param === 'starred') {
        queries.push(Appwrite.Query.equal('starred', true));
        queries.push(Appwrite.Query.equal('trashed', false));
    } else if (param === 'trash') {
        queries.push(Appwrite.Query.equal('trashed', true));
    } else {
        // Mode Drive Saya / Folder Normal
        queries.push(Appwrite.Query.equal('parentId', currentFolderId));
        queries.push(Appwrite.Query.equal('trashed', false));
    }

    updateHeaderTitle();

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if(res.documents.length === 0) {
            // Tampilan Folder Kosong yang rapi (Tanpa scrollbar permanen)
            grid.innerHTML = `
                <div style="grid-column: 1/-1; display:flex; flex-direction:column; align-items:center; justify-content:center; opacity:0.4; margin-top:80px;">
                    <i class="fa-solid fa-folder-open" style="font-size: 5rem; margin-bottom: 20px;"></i>
                    <p style="font-size: 1.2rem;">Folder Kosong</p>
                </div>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { 
        console.error("Load Error:", e);
        grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; opacity:0.5;">Data tidak dapat dimuat atau sedang diperbaiki.</p>`;
    }
}

// === 3. RENDER & KONTEKS MENU ===
function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); 
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const name = doc.name || "Tanpa Nama";
    
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute; top:12px; left:12px; color:#ffd700; font-size:1rem;"></i>` : '';

    div.oncontextmenu = (e) => {
        e.preventDefault();
        selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`;
        menu.style.left = `${e.clientX}px`;
        menu.classList.remove('hidden');
        el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
        
        // Atur Tombol Menu Konteks
        if(doc.trashed) {
            el('trashBtn').classList.add('hidden');
            el('restoreBtn').classList.remove('hidden');
            el('permDeleteBtn').classList.remove('hidden');
        } else {
            el('trashBtn').classList.remove('hidden');
            el('restoreBtn').classList.add('hidden');
            el('permDeleteBtn').classList.add('hidden');
        }
        document.onclick = () => menu.classList.add('hidden');
    };
    
    div.onclick = () => {
        if(doc.trashed) return;
        if(isFolder) {
            currentFolderId = doc.$id;
            currentFolderName = name;
            loadFiles('root');
        } else {
            window.open(doc.url, '_blank');
        }
    };

    div.innerHTML = `
        ${starHTML}
        <i class="icon fa-solid ${isFolder ? 'fa-folder' : 'fa-file-lines'}"></i>
        <div class="item-name">${name}</div>`;
    grid.appendChild(div);
}

// === 4. AKSI SIDEBAR & DASHBOARD ===
window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode;
    currentFolderId = 'root';
    currentFolderName = mode === 'root' ? 'Drive' : element.innerText.trim();
    loadFiles(mode);
};

function updateHeaderTitle() {
    const titleEl = el('headerTitle');
    if(!titleEl) return;
    
    if(currentFolderId === 'root' && currentViewMode === 'root') {
        const h = new Date().getHours();
        const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        titleEl.innerText = `Welcome In Drive ${s}`;
    } else {
        titleEl.innerText = currentFolderName;
    }
}

// Aksi Klik Kanan
window.toggleStarItem = async () => {
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred });
        loadFiles(currentViewMode === 'root' ? 'root' : currentViewMode);
    } catch(e) { alert(e.message); }
};

window.moveItemToTrash = async () => {
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true });
        loadFiles('root');
    } catch(e) { alert(e.message); }
};

window.restoreFromTrash = async () => {
    try {
        await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false });
        loadFiles('trash');
    } catch(e) { alert(e.message); }
};

window.deleteItemPermanently = async () => {
    if(!confirm("Hapus selamanya?")) return;
    showLoading();
    try {
        if(selectedItem.type === 'file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id);
        loadFiles('trash');
        calculateStorage();
    } catch(e) { alert(e.message); } finally { hideLoading(); }
};

// === 5. INITIALIZATION ===
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        el('dashboardPage').classList.remove('hidden');
        calculateStorage();
        loadFiles('root');
    } catch (e) { el('loginPage').classList.remove('hidden'); }
    finally { hideLoading(); }
}

document.addEventListener('DOMContentLoaded', checkSession);

// Aksi Modal & Auth Tetap Seperti Sebelumnya
window.openModal = (id) => el(id).classList.remove('hidden');
window.closeModal = (id) => el(id).classList.add('hidden');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
window.submitCreateFolder = async () => {
    const name = el('newFolderName').value.trim();
    if (!name) return;
    closeModal('folderModal'); showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, starred: false, trashed: false
        });
        loadFiles('root');
        el('newFolderName').value = '';
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};
window.submitUploadFile = async () => {
    if (!window.selectedFile) return;
    closeModal('uploadModal'); showLoading();
    try {
        const file = window.selectedFile;
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: file.size, starred: false, trashed: false
        });
        loadFiles('root'); calculateStorage();
    } catch (e) { alert(e.message); } finally { hideLoading(); }
};
if (el('logoutBtn')) el('logoutBtn').addEventListener('click', async () => { if (confirm("Keluar?")) { await account.deleteSession('current'); location.reload(); } });