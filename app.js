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
// 2. INISIALISASI (Fungsi Utama)
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNewButtonLogic();
    initDragAndDrop();
    initLogout(); // Perbaikan Logout dipanggil di sini
});

// ======================================================
// 3. FUNGSI LOGOUT (DIPERBAIKI)
// ======================================================
function initLogout() {
    const btn = document.getElementById('logoutBtn');
    if (btn) {
        // Hapus listener lama (bersih-bersih)
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm("Yakin ingin keluar dari aplikasi?")) {
                showLoading();
                try {
                    await account.deleteSession('current');
                    currentUser = null;
                    window.location.reload(); // Refresh halaman agar bersih
                } catch (error) {
                    console.error("Logout Error:", error);
                    // Force reload jika gagal, agar user tetap keluar secara visual
                    window.location.reload();
                } finally {
                    hideLoading();
                }
            }
        });
    }
}

// ======================================================
// 4. LOGIKA TOMBOL NEW & DROPDOWN
// ======================================================
function initNewButtonLogic() {
    const btn = el('newBtnMain');
    const menu = el('dropdownMenu');

    if (btn && menu) {
        // Klik tombol New
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            menu.classList.toggle('show');
        });

        // Klik item di dalam menu (Folder Baru / Upload)
        const links = menu.querySelectorAll('a');
        links.forEach(link => {
            link.addEventListener('click', () => {
                menu.classList.remove('show'); // Tutup menu setelah diklik
            });
        });
    }

    // Tutup menu jika klik di luar
    window.addEventListener('click', (e) => {
        if (menu && menu.classList.contains('show')) {
            if (!btn.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
            }
        }
    });
}

// ======================================================
// 5. HELPER MODAL (MEMPERBAIKI POSISI POPUP)
// ======================================================
window.openModal = (id) => { 
    // Tutup dropdown menu jika masih terbuka
    const menu = el('dropdownMenu');
    if(menu) menu.classList.remove('show');
    
    // Tampilkan Modal
    const modal = el(id);
    if(modal) {
        modal.classList.remove('hidden');
        // Pastikan input nama folder fokus otomatis
        if(id === 'folderModal') {
            setTimeout(() => el('newFolderName').focus(), 100);
        }
    }
};

window.closeModal = (id) => {
    const modal = el(id);
    if(modal) modal.classList.add('hidden');
};

window.triggerUploadModal = () => window.openModal('uploadModal');
window.createFolder = () => window.openModal('folderModal');

// ======================================================
// 6. LOGIN & SIGNUP
// ======================================================
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

async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        currentFolderId = 'root';
        loadFiles('root');  
        calculateStorage();
    } catch (e) { 
        window.nav('loginPage'); 
    } finally { 
        setTimeout(hideLoading, 500); 
    }
}

// ======================================================
// 7. DRAG & DROP & UPLOAD
// ======================================================
function initDragAndDrop() {
    const zone = el('dropZone');
    const input = el('fileInputHidden');

    if (!zone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); });
    });

    // Menambah animasi saat file masuk/keluar
    ['dragenter', 'dragover'].forEach(evt => {
        zone.addEventListener(evt, () => zone.classList.add('active'));
    });

    ['dragleave', 'drop'].forEach(evt => {
        zone.addEventListener(evt, () => zone.classList.remove('active'));
    });
    
    zone.addEventListener('drop', (e) => {
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });

    if (input) input.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
    });
}

function handleFileSelect(file) {
    selectedUploadFile = file;
    const infoText = el('fileInfoText');
    const infoContainer = el('fileInfoContainer');
    
    if (infoText && infoContainer) {
        let sizeFormatted = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        if (file.size < 1024 * 1024) sizeFormatted = (file.size / 1024).toFixed(1) + ' KB';

        infoText.innerText = `${file.name} (${sizeFormatted})`;
        infoContainer.classList.remove('hidden'); // Memunculkan kotak hijau sukses
    }
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
        selectedUploadFile = null; el('fileInfoText').innerText = "Belum ada file";
        loadFiles(currentFolderId); calculateStorage();
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

// ======================================================
// 8. NAVIGASI & DATA
// ======================================================
window.nav = (p) => { ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden')); el(p).classList.remove('hidden'); };

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[1].classList.add('active'); 
    loadFiles('root');
};

window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode; currentFolderId = 'root'; 
    currentFolderName = mode === 'root' ? 'Drive' : element.innerText.trim();
    loadFiles(mode);
};

async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); if(grid) grid.innerHTML = ''; 
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
        if(res.documents.length === 0) grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.error("Load Error:", e); }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp)$/i)) {
        content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    }

    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    
    div.oncontextmenu = (e) => {
        e.preventDefault(); selectedItem = doc;
        const menu = el('contextMenu');
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`; menu.classList.remove('hidden');
        if(el('starText')) el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
        
        const isTrash = doc.trashed;
        el('trashBtn').classList.toggle('hidden', isTrash);
        el('restoreBtn').classList.toggle('hidden', !isTrash);
        el('permDeleteBtn').classList.toggle('hidden', !isTrash);
        document.addEventListener('click', () => menu.classList.add('hidden'), {once:true});
    };
    grid.appendChild(div);
}

function updateHeaderUI() {
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
    el('headerTitle').innerText = isRoot ? `Welcome In Drive ${s}` : currentFolderName;
    const btn = document.querySelector('.breadcrumb-area button');
    if(btn) btn.style.display = isRoot ? 'none' : 'flex';
}

function openFolder(id, name) { currentFolderId = id; currentFolderName = name; currentViewMode = 'root'; loadFiles(id); }

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file')]);
        let total = 0; res.documents.forEach(d => total += (d.size || 0));
        const mb = (total / 1048576).toFixed(2);
        el('storageUsed').innerText = `${mb} MB`;
        el('storageBar').style.width = `${Math.min((mb / 2048) * 100, 100)}%`;
    } catch (e) {}
}