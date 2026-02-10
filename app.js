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

// API SheetDB Anda
const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi';

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// STATE VARIABLES
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedFileToUpload = null; 

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// ======================================================
// 2. FUNGSI PENCATAT KE EXCEL (SHEETDB)
// ======================================================
async function recordActivity(sheetName, userData) {
    if (!userData) return;

    try {
        // Format Waktu: 7/2/2026, 13.33.02
        const now = new Date();
        const formattedDate = now.toLocaleString('en-US', { 
            hour12: false, 
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).replace(/:/g, '.'); // Mengganti titik dua dengan titik sesuai format gambar Anda

        // Data yang akan dikirim
        const payload = {
            ID: userData.$id || userData.id,
            NAME: userData.name,
            EMAIL: userData.email,
            DATE: formattedDate
        };

        // Kirim ke SheetDB sesuai nama Tab (sheetName)
        // Pastikan nama Tab di Google Sheet Anda persis: "SignUp", "Login", "Logout"
        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: payload })
        });

        console.log(`Berhasil mencatat ke sheet: ${sheetName}`);

    } catch (error) {
        console.error("Gagal mencatat ke Excel:", error);
    }
}

// ======================================================
// 3. INISIALISASI
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNewButton(); 
    initDragAndDrop(); 
});

// ======================================================
// 4. AUTHENTICATION (LOGIN & SIGNUP)
// ======================================================

// --- SIGN UP ---
if(el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; 
        const email = el('regEmail').value; 
        const pass = el('regPass').value;
        
        showLoading();
        try {
            // 1. Buat Akun di Appwrite
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            
            // 2. Simpan detail user ke Database Appwrite
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { name, email });
            
            // 3. CATAT KE EXCEL (Tab: SignUp)
            // Kita kirim data manual karena auth object memiliki struktur data user
            await recordActivity('SignUp', { $id: auth.$id, name: name, email: email });

            alert("Daftar Berhasil! Silakan Login."); 
            window.nav('loginPage');
        } catch(e) { 
            alert(e.message); 
        } finally { 
            hideLoading(); 
        }
    });
}

// --- LOGIN ---
if(el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let inputId = el('loginEmail').value.trim();
        const pass = el('loginPass').value;
        showLoading();
        try {
            // Cek Username jika bukan email
            if (!inputId.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', inputId)]);
                if (res.total === 0) throw new Error("User tidak ditemukan");
                inputId = res.documents[0].email;
            }

            // Proses Login
            try { 
                await account.get(); // Cek jika sesi nyangkut
            } catch (err) { 
                await account.createEmailPasswordSession(inputId, pass); 
            }
            
            // Ambil data user terbaru untuk dicatat
            const user = await account.get();
            
            // CATAT KE EXCEL (Tab: Login)
            recordActivity('Login', user); // Tidak perlu await agar login terasa cepat

            checkSession();
        } catch (error) { 
            if(error.message.includes('session is active')) {
                // Jika error karena sesi aktif, tetap catat login dan masuk
                const user = await account.get();
                recordActivity('Login', user);
                checkSession();
            } else {
                alert(error.message); 
                hideLoading(); 
            }
        }
    });
}

// --- LOGOUT ---
// Inisialisasi Logout dipindah ke sini agar lebih rapi
const logoutBtn = el('logoutBtn');
if (logoutBtn) {
    // Hapus event listener lama dengan kloning (agar tidak double)
    const newBtn = logoutBtn.cloneNode(true);
    logoutBtn.parentNode.replaceChild(newBtn, logoutBtn);

    newBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (confirm("Yakin ingin keluar?")) {
            showLoading();
            try {
                // CATAT KE EXCEL (Tab: Logout) SEBELUM HAPUS SESI
                if (currentUser) {
                    await recordActivity('Logout', currentUser);
                }

                await account.deleteSession('current');
                currentUser = null;
                window.location.reload(); 
            } catch (error) {
                console.error(error);
                window.location.reload();
            } finally {
                hideLoading();
            }
        }
    });
}

// ======================================================
// 5. SESSION CHECK
// ======================================================
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        window.nav('dashboardPage'); 
        calculateStorage(); 
        loadFiles('root');  
    } catch (e) { 
        window.nav('loginPage'); 
    } finally { 
        setTimeout(hideLoading, 500); 
    }
}

// ======================================================
// 6. TOMBOL NEW & DROPDOWN
// ======================================================
function initNewButton() {
    const btn = el('newBtnMain');
    const menu = el('dropdownMenu');
    
    if (btn && menu) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.toggle('show');
        });
    }
    window.addEventListener('click', (e) => {
        if (menu && !btn.contains(e.target) && !menu.contains(e.target)) {
            menu.classList.remove('show');
        }
    });
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

    zone.addEventListener('dragover', () => zone.classList.add('active'));
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    
    zone.addEventListener('drop', (e) => {
        zone.classList.remove('active');
        const files = e.dataTransfer.files;
        if (files.length > 0) handleFileSelect(files[0]);
    });

    if (input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

function handleFileSelect(file) {
    selectedFileToUpload = file;
    const infoText = el('fileInfoText');
    const infoContainer = el('fileInfoContainer');
    
    if (infoText && infoContainer) {
        let sizeFormatted = (file.size < 1024 * 1024) 
            ? (file.size / 1024).toFixed(1) + ' KB' 
            : (file.size / (1024 * 1024)).toFixed(2) + ' MB';

        infoText.innerText = `${file.name} (${sizeFormatted})`;
        infoContainer.classList.remove('hidden');
    }
}

function resetUploadUI() {
    selectedFileToUpload = null;
    const infoContainer = el('fileInfoContainer');
    if(infoContainer) infoContainer.classList.add('hidden');
    if(el('fileInputHidden')) el('fileInputHidden').value = '';
}

// ======================================================
// 8. ACTIONS: UPLOAD & FOLDER
// ======================================================
window.submitUploadFile = async () => {
    if (!selectedFileToUpload) return alert("Pilih file dulu!");
    closeModal('uploadModal'); showLoading();
    try {
        const up = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), selectedFileToUpload);
        const url = storage.getFileView(CONFIG.BUCKET_ID, up.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: selectedFileToUpload.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, url: url.href, fileId: up.$id, size: selectedFileToUpload.size, starred: false, trashed: false
        });
        
        resetUploadUI(); // Reset UI setelah sukses
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
// 9. NAVIGASI & DATA LOADING
// ======================================================
window.nav = (p) => { ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden')); el(p).classList.remove('hidden'); };

window.goBack = () => {
    currentFolderId = 'root'; currentFolderName = "Drive"; currentViewMode = 'root';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[1].classList.add('active'); 
    loadFiles('root');
};

window.handleMenuClick = (element, mode) => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    element.classList.add('active');
    currentViewMode = mode; currentFolderId = 'root'; 
    currentFolderName = (mode === 'root') ? 'Drive' : element.innerText.trim();
    loadFiles(mode);
};

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

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if (res.total === 0) grid.innerHTML = `<p style="grid-column:1/-1; text-align:center; opacity:0.5; margin-top:50px;">Kosong</p>`;
        else res.documents.forEach(doc => renderItem(doc));
    } catch (e) { console.error(e); }
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

function openFolder(id, name) { currentFolderId = id; currentFolderName = name; currentViewMode = 'root'; loadFiles(id); }
function updateHeaderUI() {
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    const h = new Date().getHours(); const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
    el('headerTitle').innerText = isRoot ? `Welcome In Drive ${s}` : currentFolderName;
    const btn = document.querySelector('.breadcrumb-area button');
    if(btn) btn.style.display = isRoot ? 'none' : 'flex';
}

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

// Helpers
window.openModal = (id) => { el('dropdownMenu').classList.remove('show'); el(id).classList.remove('hidden'); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');
window.togglePass = (id, icon) => { const i = el(id); i.type = i.type==='password'?'text':'password'; icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash'); };

// Context Actions
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles('root'); } catch(e){alert(e.message);} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); } catch(e){alert(e.message);} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); } catch(e){alert(e.message);} };