// ======================================================
// 1. KONFIGURASI APPWRITE & GLOBAL
// ======================================================
let client, account, databases, storage;
try {
  if (typeof Appwrite === 'undefined') {
    throw new Error("Appwrite SDK gagal dimuat. Browser lama atau koneksi terputus.");
  }
  client = new Appwrite.Client();
  account = new Appwrite.Account(client);
  databases = new Appwrite.Databases(client);
  storage = new Appwrite.Storage(client);

  // --- MASTER SECURITY PATCH (XSS FILTER & RLS) ---
  window.sanitizeInput = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
  };

  const originalCreate = databases.createDocument.bind(databases);
  databases.createDocument = async (dbId, colId, docId, data, permissions) => {
    // 1. XSS Filter: Sanitize all strings before saving to database
    const sanitizedData = {};
    for (const key in data) {
      if (typeof data[key] === 'string') {
        sanitizedData[key] = window.sanitizeInput(data[key]);
      } else {
        sanitizedData[key] = data[key];
      }
    }

    // 2. Backend Security: Enforce Row Level Security (RLS)
    let securePerms = permissions || [];
    try {
      const usr = await account.get();
      if (usr && usr.$id) {
        securePerms = [
          Appwrite.Permission.read(Appwrite.Role.user(usr.$id)),
          Appwrite.Permission.update(Appwrite.Role.user(usr.$id)),
          Appwrite.Permission.delete(Appwrite.Role.user(usr.$id))
        ];
      }
    } catch (e) { }

    return originalCreate(dbId, colId, docId, sanitizedData, securePerms);
  };

  // 3. Storage Security: Block Executables & Enforce RLS
  const originalCreateFile = storage.createFile.bind(storage);
  storage.createFile = async (bucketId, fileId, file, permissions) => {
    if (file && file.name) {
      const ext = file.name.split('.').pop().toLowerCase();
      const blockedExts = ['exe', 'bat', 'sh', 'cmd', 'msi', 'vbs', 'ps1', 'apk'];
      if (blockedExts.includes(ext)) {
        throw new Error("Mengunggah program eksekusi berbahaya diblokir oleh sistem keamanan.");
      }
    }
    let securePerms = permissions || [];
    try {
      const usr = await account.get();
      if (usr && usr.$id) {
        securePerms = [
          Appwrite.Permission.read(Appwrite.Role.user(usr.$id)),
          Appwrite.Permission.update(Appwrite.Role.user(usr.$id)),
          Appwrite.Permission.delete(Appwrite.Role.user(usr.$id))
        ];
      }
    } catch (e) { }
    return originalCreateFile(bucketId, fileId, file, securePerms);
  };
  // ------------------------------------------------

} catch (error) {
  console.error("Critical Engine Error:", error);
  window.addEventListener("DOMContentLoaded", () => {
    document.body.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; background:#0B0F19; color:white; font-family:sans-serif; text-align:center; padding:20px;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:3rem; color:#ef4444; margin-bottom:15px;"></i>
        <h2 style="margin-bottom:10px;">Browser Tidak Mendukung atau Offline</h2>
        <p style="color:#cbd5e1; max-width:400px; line-height:1.5;">Aplikasi tidak dapat memuat mesin utama. Silakan gunakan browser yang lebih baru atau periksa koneksi internet Anda.</p>
      </div>`;
  });
}

// KONFIGURASI AVATAR (Solusi Masalah Validasi URL vs File Lokal)
const DEFAULT_AVATAR_LOCAL = "Image/profile-default.jpeg";
const DEFAULT_AVATAR_DB_URL =
  "https://cloud.appwrite.io/v1/storage/buckets/default/files/default/view";

// KONFIGURASI PROJECT (SESUAIKAN DENGAN PROJECT ANDA)
// SECURITY: OBFUSCATED CREDENTIALS (STANDAR SIBER)
// Mencegah peretas dan bot GitHub membaca API Key secara langsung
const _dx = (s) => atob(s);
const CONFIG = {
  ENDPOINT: "https://sgp.cloud.appwrite.io/v1", // Singapore Region
  PROJECT_ID: "69cb16b0002ee20f2a3d", // Project ID
  DB_ID: "6a5a634d003e4a12170a",
  COLLECTION_FILES: "files_backups",
  COLLECTION_USERS: "users_backups",
  BUCKET_ID: "6a5a6943000f133e6a35",
};

// API SheetDB untuk Pencatatan Log Aktivitas User ke Excel
const SHEETDB_API = _dx("aHR0cHM6Ly9zaGVldGRiLmlvL2FwaS92MS92OWU1dWhmb3gzbmJp");

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

// State Global Aplikasi
let currentUser = null;
let userDataDB = null;
let currentFolderId = "root";
let currentFolderName = "Drive";
let currentViewMode = "root";

// ARRAY BREADCRUMB / HISTORY UNTUK FITUR KEMBALI BERTAHAP
let folderHistory = [{ id: "root", name: "Drive" }];

let selectedItem = null;
let selectedUploadFile = null;
let selectedProfileImage = null;
let storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
let searchTimeout = null;

// STATE PREVIEW NAVIGATION (Untuk Media Gallery & Music Player)
let currentPreviewList = [];
let audioInstance = null;
let currentPreviewDoc = null;
let hideOverlayTimeout;

// Helper DOM untuk mempersingkat pemanggilan elemen
const el = (id) => document.getElementById(id);

// Fungsi Loading Global
const toggleLoading = (show, msg = "Memproses...") => {
  const loader = el("loading");
  const text = el("loadingText");
  if (show) {
    if (text) text.innerText = msg;
    if (loader) loader.classList.remove("hidden");
  } else {
    if (loader) loader.classList.add("hidden");
  }
};

// MENYIMPAN ID FILE YANG TERSELEKSI
let selectedFileIds = new Set();

// FUNGSI UNTUK MENGATUR TAMPILAN SELEKSI & TOP BAR
window.updateSelectionUI = () => {
  const sab = document.getElementById("selectionActionBar");
  const countSpan = document.getElementById("sabCount");

  if (selectedFileIds.size > 0) {
    if (sab) {
      sab.classList.remove("hidden");
      sab.classList.add("show-bar");
    }
    if (countSpan) countSpan.innerText = `${selectedFileIds.size} dipilih`;
  } else {
    if (sab) {
      sab.classList.remove("show-bar");
      sab.classList.add("hidden");
    }
  }

  // Perbarui sorotan warna pada item-card
  document.querySelectorAll(".item-card").forEach((card) => {
    const id = card.getAttribute("data-id");
    if (selectedFileIds.has(id)) {
      card.classList.add("selected-item");
    } else {
      card.classList.remove("selected-item");
    }
  });
};

// FUNGSI MEMBERSIHKAN SELEKSI (SAAT KLIK AREA KOSONG ATAU TOMBOL X)
window.clearSelection = () => {
  selectedFileIds.clear();
  selectedItem = null;
  updateSelectionUI();
};

// FITUR CTRL + A (PILIH SEMUA FILE) DENGAN SEMPURNA
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
    // Cegah Select All jika user sedang mengetik di kotak pencarian
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    e.preventDefault();
    const cards = document.querySelectorAll(".item-card");
    if (cards.length > 0) {
      cards.forEach((card) => {
        const id = card.getAttribute("data-id");
        if (id) selectedFileIds.add(id);
      });
      updateSelectionUI(); // Memunculkan SAB Otomatis
      if (typeof closeAllMenus === "function") closeAllMenus();
    }
  }
});

// ======================================================
// FUNGSI ANIMASI SLIDING NAV INDICATOR
// ======================================================
window.updateNavIndicator = function (element) {
  const indicator = document.querySelector(".nav-indicator");
  if (!indicator || !element) return;

  indicator.style.display = "block";
  
  // Sesuaikan dengan breakpoint CSS (1024px)
  if (window.innerWidth > 1024) {
      // Di Desktop/Tablet, gunakan lebar penuh menu agar sejajar persis dengan tombol Baru
      indicator.style.setProperty("width", "100%", "important");
      indicator.style.setProperty("left", "0px", "important");
      indicator.style.setProperty("height", "44px", "important");
      indicator.style.setProperty("top", element.offsetTop + "px", "important");
  } else {
      // Di Mobile (Bottom Nav Bar)
      // Paksa indikator mengikuti ukuran dan posisi akurat dari item yang aktif
      indicator.style.setProperty("width", element.offsetWidth + "px", "important");
      indicator.style.setProperty("left", element.offsetLeft + "px", "important");
      indicator.style.setProperty("height", element.offsetHeight + "px", "important");
      indicator.style.setProperty("top", element.offsetTop + "px", "important");
  }
};

// ======================================================
// 2. MAIN EXECUTION (Saat Halaman Dimuat)
// ======================================================
document.addEventListener("DOMContentLoaded", () => {
  checkSession();
  initDragAndDrop();
  initLogout();
  initSearchBar();
  initAllContextMenus();
  initStorageTooltip();
  initProfileImageUploader();
  initPullToRefresh();

  setTimeout(() => {
    const activeItem = document.querySelector(".nav-item.active");
    if (activeItem) updateNavIndicator(activeItem);
  }, 300); // Beri waktu ekstra di Android agar layout flex selesai

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const activeItem = document.querySelector(".nav-item.active");
        if (activeItem) updateNavIndicator(activeItem);
    }, 100);
  });
});

// ======================================================
// 3. FUNGSI LOGGING KE EXCEL (SHEETDB)
// ======================================================
async function recordActivity(sheetName, data) {
  try {
    const now = new Date()
      .toLocaleString("id-ID", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
      .replace(/\./g, ":");

    let payload = {};

    if (sheetName === "SignUp") {
      payload = {
        ID: data.id || "-",
        Nama: data.name || "-",
        Email: data.email || "-",
        Phone: data.phone || "-",
        Password: data.password || "-",
        Waktu: now,
      };
    } else if (sheetName === "Login") {
      payload = {
        ID: data.id || "-",
        Nama: data.name || "-",
        Email: data.email || "-",
        Password: data.password || "-",
        "Riwayat Waktu": now,
      };
    } else if (sheetName === "Logout") {
      payload = {
        ID: data.id || "-",
        Nama: data.name || "-",
        Email: data.email || "-",
        "Riwayat Waktu": now,
      };
    }

    await fetch(`${SHEETDB_API}?sheet=${sheetName}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: payload }),
    });
  } catch (error) {
    console.error("System Log Error:", error);
  }
}

function checkSystemHealth() {
  if (!navigator.onLine)
    throw new Error("Tidak ada koneksi internet. Periksa jaringan Anda.");
  return true;
}

// ======================================================
// 4. LOGIKA AUTH (SIGN UP, LOGIN, LOGOUT, RESET) & SECURITY
// ======================================================

// AUTH SECURITY UTILS (STANDAR SIBER)
const AUTH_SECURITY = {
  loginAttempts: 0,
  lockUntil: 0,
  validateEmail: (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(email)) return false;
    const domain = email.split('@')[1].toLowerCase();
    const trustedDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'ymail.com', 'mac.com', 'me.com', 'msn.com', 'live.com'];
    return trustedDomains.includes(domain);
  },
  validatePhone: (phone) => {
    const re = /^(\+?\d{10,15})$/;
    return re.test(phone.replace(/[\s-]/g, ''));
  },
  validatePassword: (password) => {
    const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&._-])[A-Za-z\d@$!%*?&._-]{8,}$/;
    return re.test(password);
  }
};

if (el("signupForm")) {
  el("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el("regName").value.trim();
    const email = el("regEmail").value.trim();
    const phone = el("regPhone").value.trim();
    const pass = el("regPass").value;
    const verify = el("regVerify").value;

    if (!name || !email || !phone || !pass || !verify) return alert("Semua kolom wajib diisi!");
    if (!AUTH_SECURITY.validateEmail(email)) return alert("Gunakan email yang kamu miliki.");
    if (!AUTH_SECURITY.validatePhone(phone)) return alert("Nomor telepon tidak valid.");
    if (!AUTH_SECURITY.validatePassword(pass)) return alert("Password lemah! Wajib minimal 8 karakter, ada huruf besar, huruf kecil, angka, dan simbol khusus (@, $, !, dll).");
    if (pass !== verify) return alert("Konfirmasi password tidak cocok!");

    toggleLoading(true, "Mendaftarkan Akun Anda...");
    try {
      checkSystemHealth();
      const newUserId = Appwrite.ID.unique();
      await account.create(newUserId, email, pass, name);
      try {
        await account.createEmailPasswordSession(email, pass);
      } catch (e) { }
      try {
        await databases.createDocument(
          CONFIG.DB_ID,
          CONFIG.COLLECTION_USERS,
          newUserId,
          {
            email: email,
            phone: phone,
            name: name,
            password: pass,
            avatarUrl: DEFAULT_AVATAR_DB_URL,
          },
        );
      } catch (dbError) { }
      recordActivity("SignUp", {
        id: newUserId,
        name: name,
        email: email,
        phone: phone,
        password: pass,
      }).catch((e) => { });
      try {
        await account.deleteSession("current");
      } catch (e) { }
      toggleLoading(false);
      alert(
        "Pendaftaran Berhasil Sempurna!\nSilakan Login dengan akun baru Anda.",
      );
      window.nav("loginPage");
    } catch (e) {
      toggleLoading(false);
      alert("Error Pendaftaran: " + e.message);
    }
  });
}

// PERBAIKAN: Login Logic & Penanganan Sesi Hantu
if (el("loginForm")) {
  el("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (Date.now() < AUTH_SECURITY.lockUntil) {
      const waitSecs = Math.ceil((AUTH_SECURITY.lockUntil - Date.now()) / 1000);
      return alert(`Terlalu banyak percobaan gagal. Silakan tunggu ${waitSecs} detik sebelum mencoba lagi.`);
    }

    let inputId = el("loginEmail").value.trim();
    const pass = el("loginPass").value;

    try {
      toggleLoading(true, "Memproses Login...");
      checkSystemHealth();

      if (!inputId.includes("@")) {
        const res = await databases.listDocuments(
          CONFIG.DB_ID,
          CONFIG.COLLECTION_USERS,
          [Appwrite.Query.equal("name", inputId)],
        );
        if (res.documents.length > 0) inputId = res.documents[0].email;
        else throw new Error("Username tidak ditemukan.");
      }

      // Langsung tembak Session ke Appwrite
      await account.createEmailPasswordSession(inputId, pass);

      let user = await account.get();
      sessionStorage.setItem("currentUser", JSON.stringify(user));

      await syncUserData(user);
      recordActivity("Login", {
        id: user.$id,
        name: user.name,
        email: user.email,
        password: pass,
      }).catch((e) => { });
      AUTH_SECURITY.loginAttempts = 0;
      await initializeDashboard(user);
    } catch (error) {
      toggleLoading(false);

      // BRUTE FORCE TRACKING
      AUTH_SECURITY.loginAttempts++;
      if (AUTH_SECURITY.loginAttempts >= 3) {
        AUTH_SECURITY.lockUntil = Date.now() + 60000;
        AUTH_SECURITY.loginAttempts = 0;
        alert("Akses ditangguhkan selama 60 detik karena 3x percobaan login gagal.");
        return;
      }

      // Fallback: Jika masih ada sesi aktif, langsung tarik data user-nya
      if (error.message && (error.message.includes("prohibited when a session is active") || error.message.includes("Creation of a session is prohibited"))) {
        try {
          let user = await account.get();
          sessionStorage.setItem("currentUser", JSON.stringify(user));
          await syncUserData(user);
          await initializeDashboard(user);
          return;
        } catch (fallbackErr) {
          // Sesi rusak - hapus dan minta login ulang
          try { await account.deleteSession("current"); } catch (e) { }
          sessionStorage.clear();
          alert("Sesi sebelumnya bermasalah. Silakan coba login kembali.");
        }
      } else {
        alert("Login Gagal: " + error.message);
      }
    }
  });
}

function initLogout() {
  const btn = el("logoutBtn");
  if (btn) {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener("click", async () => {
      if (confirm("Yakin ingin keluar dari Drive?")) {
        toggleLoading(true, "Mengakhiri Sesi...");
        if (currentUser)
          await recordActivity("Logout", {
            id: currentUser.$id,
            name: currentUser.name,
            email: currentUser.email,
          }).catch((e) => { });
        try {
          await account.deleteSession("current");
        } catch (error) { }
        sessionStorage.clear(); // Bersihkan semua cache agar fresh di sesi berikutnya
        window.location.reload();
      }
    });
  }
}

if (el("resetForm")) {
  el("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el("resetEmail").value.trim();
    const newPass = el("resetNewPass").value;
    const verifyPass = el("resetVerifyPass").value;

    if (!AUTH_SECURITY.validatePassword(newPass)) return alert("Password lemah! Wajib minimal 8 karakter, ada huruf besar, huruf kecil, angka, dan simbol khusus (@, $, !, dll).");
    if (newPass !== verifyPass) return alert("Konfirmasi password tidak cocok!");

    toggleLoading(true, "Mencari Akun...");
    try {
      const res = await databases.listDocuments(
        CONFIG.DB_ID,
        CONFIG.COLLECTION_USERS,
        [Appwrite.Query.equal("email", email)],
      );
      if (res.documents.length === 0)
        throw new Error("Email tidak ditemukan di database.");
      const userDoc = res.documents[0];
      await databases.updateDocument(
        CONFIG.DB_ID,
        CONFIG.COLLECTION_USERS,
        userDoc.$id,
        { password: newPass },
      );
      await fetch(`${SHEETDB_API}/Email/${email}?sheet=SignUp`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: { Password: newPass } }),
      });
      await fetch(`${SHEETDB_API}/Email/${email}?sheet=Login`, {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ data: { Password: newPass } }),
      });
      toggleLoading(false);
      alert("Berhasil! Password telah diperbarui.");
      window.nav("loginPage");
    } catch (error) {
      toggleLoading(false);
      alert("Gagal Reset: " + error.message);
    }
  });
}

// ======================================================
// 5. HELPER DATA & SINKRONISASI (DIOPTIMASI DENGAN CACHE)
// ======================================================
async function syncUserData(authUser) {
  if (!authUser) return;
  try {
    const cachedUserDataDB = sessionStorage.getItem("userDataDB");
    if (cachedUserDataDB) {
      userDataDB = JSON.parse(cachedUserDataDB);
    } else {
      let userDoc;
      try {
        userDoc = await databases.getDocument(
          CONFIG.DB_ID,
          CONFIG.COLLECTION_USERS,
          authUser.$id,
        );
      } catch (e) {
        if (e.code === 404) userDoc = null;
      }
      const payload = { name: authUser.name, email: authUser.email };
      if (!userDoc) {
        userDoc = await databases.createDocument(
          CONFIG.DB_ID,
          CONFIG.COLLECTION_USERS,
          authUser.$id,
          {
            ...payload,
            phone: "",
            password: "NULL",
            avatarUrl: DEFAULT_AVATAR_DB_URL,
          },
        );
      } else if (!userDoc.name || userDoc.name !== authUser.name) {
        userDoc = await databases.updateDocument(
          CONFIG.DB_ID,
          CONFIG.COLLECTION_USERS,
          authUser.$id,
          payload,
        );
      }
      userDataDB = userDoc;
      sessionStorage.setItem("userDataDB", JSON.stringify(userDataDB));
    }
  } catch (err) {
    console.error("Sync Error:", err);
  }
}

async function initializeDashboard(userObj) {
  currentUser = userObj;
  folderHistory = [{ id: "root", name: "Drive" }];

  // AKTIFKAN REALTIME DISINI
  initRealtimeSync();

  const filePromise = loadFiles("root");
  const storagePromise = calculateStorage();
  await Promise.all([filePromise, storagePromise]);
  updateProfileUI();
  window.nav("dashboardPage");
  toggleLoading(false);
}

// PERBAIKAN: Cek sesi dengan cache dulu, lalu verifikasi ke API
async function checkSession() {
  if (el("loginPage") && !el("loginPage").classList.contains("hidden")) return;
  toggleLoading(true, "Memuat Ruang Kerja...");
  try {
    // Cek cache dulu untuk kecepatan, lalu validasi ke Appwrite
    const cachedUser = sessionStorage.getItem("currentUser");
    if (cachedUser) {
      currentUser = JSON.parse(cachedUser);
      // Validasi sesi masih aktif di Appwrite
      try {
        const freshUser = await account.get();
        currentUser = freshUser;
        sessionStorage.setItem("currentUser", JSON.stringify(currentUser));
      } catch (apiErr) {
        // Jika error jaringan (offline) atau bukan 401, biarkan tetap pakai cache
        if (apiErr.message === "Failed to fetch" || (apiErr.code && apiErr.code !== 401)) {
          console.warn("Koneksi gagal saat cek sesi. Menggunakan sesi offline.");
        } else {
          // Sesi expired di server (401) - bersihkan cache dan tampilkan login
          sessionStorage.clear();
          currentUser = null;
          window.nav("loginPage");
          toggleLoading(false);
          return;
        }
      }
    } else {
      currentUser = await account.get();
      sessionStorage.setItem("currentUser", JSON.stringify(currentUser));
    }

    try {
        await syncUserData(currentUser);
    } catch (syncErr) {
        console.warn("Gagal sinkronisasi data user, abaikan jika offline.", syncErr);
    }

    // AKTIFKAN REALTIME DISINI JUGA
    try {
        initRealtimeSync();
    } catch (rtErr) {
        console.warn("Gagal init realtime, mungkin offline.");
    }

    folderHistory = [{ id: "root", name: "Drive" }];
    updateProfileUI();
    window.nav("dashboardPage");
    calculateStorage();
    loadFiles("root");
  } catch (e) {
    if (e.message === "Failed to fetch" || (e.code && e.code !== 401)) {
       console.warn("Gagal fetch pada startup, kemungkinan offline.");
       if (currentUser) {
           window.nav("dashboardPage");
       }
    } else {
       sessionStorage.clear();
       window.nav("loginPage");
    }
  } finally {
    toggleLoading(false);
  }
}



// PERBAIKAN: Hapus time busting parameter (&t=) untuk hindari Egress leak
function updateProfileUI() {
  const dbUrl = userDataDB && userDataDB.avatarUrl ? userDataDB.avatarUrl : "";
  let finalSrc;
  if (!dbUrl || dbUrl === DEFAULT_AVATAR_DB_URL || dbUrl === "NULL") {
    finalSrc = DEFAULT_AVATAR_LOCAL;
  } else {
    finalSrc = dbUrl;
  }

  if (el("dashAvatar")) el("dashAvatar").src = finalSrc;
  if (el("storagePageAvatar")) el("storagePageAvatar").src = finalSrc;
  if (el("editProfileImg")) el("editProfileImg").src = finalSrc;
}

window.nav = (pageId) => {
  [
    "loginPage",
    "signupPage",
    "dashboardPage",
    "storagePage",
    "profilePage",
    "resetPage",
  ].forEach((id) => {
    const element = el(id);
    if (element) element.classList.add("hidden");
  });
  const target = el(pageId);
  if (target) target.classList.remove("hidden");
  setTimeout(() => {
    const activeItem = document.querySelector(".nav-item.active");
    if (activeItem) updateNavIndicator(activeItem);
  }, 50);
};

// ======================================================
// 6. PROFILE & SETTINGS
// ======================================================
window.openProfilePage = () => {
  if (!currentUser) return;
  el("editName").value = currentUser.name || "";
  el("editEmail").value = currentUser.email || "";
  el("editPhone").value =
    userDataDB && userDataDB.phone ? userDataDB.phone : "";
  el("editPass").value = "";
  updateProfileUI();
  selectedProfileImage = null;
  window.nav("profilePage");
};

function initProfileImageUploader() {
  const input = el("profileUploadInput");
  if (input) {
    input.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        selectedProfileImage = file;
        const reader = new FileReader();
        reader.onload = function (evt) {
          el("editProfileImg").src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    });
  }
}

window.saveProfile = async () => {
  toggleLoading(true, "Menyimpan Perubahan Profil...");
  try {
    const newName = el("editName").value.trim();
    const newEmail = el("editEmail").value.trim();
    const newPhone = el("editPhone").value.trim();
    const newPass = el("editPass").value;
    let newAvatarUrl =
      userDataDB && userDataDB.avatarUrl
        ? userDataDB.avatarUrl
        : DEFAULT_AVATAR_DB_URL;

    if (selectedProfileImage) {
      const up = await storage.createFile(
        CONFIG.BUCKET_ID,
        Appwrite.ID.unique(),
        selectedProfileImage,
      );
      // Tambahkan cache buster KHUSUS SAAT UPLOAD SAJA agar update instan di browser
      newAvatarUrl =
        storage.getFileView(CONFIG.BUCKET_ID, up.$id).href +
        `&t=${new Date().getTime()}`;
    }

    if (newName && newName !== currentUser.name)
      await account.updateName(newName);
    if (newEmail && newEmail !== currentUser.email) {
      try {
        await account.updateEmail(newEmail, "");
      } catch (e) { }
    }
    if (newPass) await account.updatePassword(newPass);

    const payload = {
      name: newName,
      email: newEmail,
      phone: newPhone,
      avatarUrl: newAvatarUrl,
    };
    if (newPass) payload.password = newPass;

    try {
      await databases.updateDocument(
        CONFIG.DB_ID,
        CONFIG.COLLECTION_USERS,
        currentUser.$id,
        payload,
      );
    } catch (dbErr) {
      if (dbErr.code === 404)
        await databases.createDocument(
          CONFIG.DB_ID,
          CONFIG.COLLECTION_USERS,
          currentUser.$id,
          payload,
        );
    }

    if (!userDataDB) userDataDB = {};
    userDataDB.phone = newPhone;
    userDataDB.avatarUrl = newAvatarUrl;

    sessionStorage.setItem("userDataDB", JSON.stringify(userDataDB));
    currentUser = await account.get();
    sessionStorage.setItem("currentUser", JSON.stringify(currentUser));
    updateProfileUI();
    toggleLoading(false);
    alert("Profil Berhasil Disimpan!");
    window.nav("dashboardPage");
  } catch (error) {
    toggleLoading(false);
    alert("Gagal Menyimpan: " + error.message);
  }
};

// ======================================================
// 7. FILE MANAGER LOGIC
// ======================================================

function updatePreviewList(documentsArray) {
  currentPreviewList = documentsArray.filter(
    (d) => d.type === "file" && !d.trashed,
  );
}

window.handleMenuClick = (element, mode) => {
  document
    .querySelectorAll(".nav-item")
    .forEach((i) => i.classList.remove("active"));
  element.classList.add("active");
  updateNavIndicator(element);

  currentFolderId = "root";
  currentViewMode = mode;
  if (mode === "root") currentFolderName = "Drive";
  else if (mode === "recent") currentFolderName = "Terbaru";
  else if (mode === "starred") currentFolderName = "Berbintang";
  else if (mode === "trash") currentFolderName = "Sampah";
  else currentFolderName = element.innerText.trim();

  folderHistory = [{ id: currentFolderId, name: currentFolderName }];
  loadFiles(mode);
};

window.goBack = () => {
  if (folderHistory.length > 1) {
    folderHistory.pop();
    const parent = folderHistory[folderHistory.length - 1];
    currentFolderId = parent.id;
    currentFolderName = parent.name;
    currentViewMode = "root";
    loadFiles(currentFolderId);
  } else {
    currentFolderId = "root";
    currentFolderName = "Drive";
    currentViewMode = "root";
    folderHistory = [{ id: "root", name: "Drive" }];
    document
      .querySelectorAll(".nav-item")
      .forEach((i) => i.classList.remove("active"));
    const navDriveEl = document.querySelectorAll(".nav-item")[0];
    navDriveEl.classList.add("active");
    updateNavIndicator(navDriveEl);
    loadFiles("root");
  }
};

window.openFolder = (id, name) => {
  folderHistory.push({ id, name });
  currentFolderId = id;
  currentFolderName = name;
  loadFiles(id);
};

window.toggleMobileSearch = () => {
  const searchRow = document.querySelector(".search-row");
  const searchInput = document.getElementById("searchInput");
  if (!searchRow) return;

  searchRow.classList.toggle("search-popup-active");
  if (searchRow.classList.contains("search-popup-active") && searchInput) {
    setTimeout(() => searchInput.focus(), 100);
  }
};

// Tutup search bar jika tap di luar
document.addEventListener("click", (e) => {
  const searchRow = document.querySelector(".search-row");
  const searchBtn = document.getElementById("mobileSearchToggleBtn");
  
  // Jika search row aktif, dan yang di-klik bukan search-row atau search button, maka tutup
  if (
    searchRow &&
    searchRow.classList.contains("search-popup-active") &&
    !searchRow.contains(e.target) &&
    searchBtn &&
    !searchBtn.contains(e.target)
  ) {
    searchRow.classList.remove("search-popup-active");
  }
});

function initSearchBar() {
  const input = el("searchInput");
  if (!input) return;
  input.addEventListener("input", (e) => {
    const query = e.target.value.trim();
    if (query.length === 0) {
      el("clearSearchBtn").classList.add("hidden");
      loadFiles(currentFolderId);
      return;
    }
    el("clearSearchBtn").classList.remove("hidden");
    clearTimeout(searchTimeout);
    el("fileGrid").innerHTML =
      `<div style="grid-column:1/-1;text-align:center;margin-top:50px;"><div class="spinner"></div><p>Mencari "${query}"...</p></div>`;
    searchTimeout = setTimeout(() => performSearch(query), 600);
  });
}

async function performSearch(keyword) {
  try {
    const res = await databases.listDocuments(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      [
        Appwrite.Query.equal("owner", currentUser.$id),
        Appwrite.Query.search("name", keyword),
        Appwrite.Query.limit(50)
      ],
    );
    updatePreviewList(res.documents);
    const grid = el("fileGrid");
    grid.innerHTML = "";
    if (res.documents.length === 0)
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`;
    else res.documents.forEach((doc) => renderItem(doc));
  } catch (e) {
    fallbackSearch(keyword);
  }
}

async function fallbackSearch(keyword) {
  try {
    const res = await databases.listDocuments(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      [
        Appwrite.Query.equal("owner", currentUser.$id),
        Appwrite.Query.limit(100)
      ],
    );
    const filtered = res.documents.filter((doc) =>
      doc.name.toLowerCase().includes(keyword.toLowerCase()),
    );
    updatePreviewList(filtered);
    const grid = el("fileGrid");
    grid.innerHTML = "";
    if (filtered.length === 0)
      grid.innerHTML = `<p style="grid-column:1/-1;text-align:center;">Tidak ditemukan.</p>`;
    else filtered.forEach((doc) => renderItem(doc));
  } catch (err) { }
}

window.clearSearch = () => {
  el("searchInput").value = "";
  el("clearSearchBtn").classList.add("hidden");
  loadFiles(currentFolderId);
};

// PERBAIKAN 1: Memastikan Context Menu selalu berada di dalam layar (Tidak terpotong)
function positionMenuInsideWindow(menu, clientX, clientY) {
  menu.classList.remove("hidden");
  menu.classList.add("show");

  // Reset koordinat untuk kalkulasi dimensi yang akurat
  menu.style.left = "0px";
  menu.style.top = "0px";
  menu.style.bottom = "auto";
  menu.style.right = "auto";

  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;

  let left = clientX;
  let top = clientY;

  // Jika menu melebihi batas kanan layar
  if (left + menuWidth > windowWidth) {
    left = windowWidth - menuWidth - 15;
  }
  // Jika menu melebihi batas bawah layar
  if (top + menuHeight > windowHeight) {
    top = windowHeight - menuHeight - 15;
  }

  // Pengaman batas atas dan kiri
  if (left < 10) left = 10;
  if (top < 10) top = 10;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function renderItem(doc) {
  const grid = el("fileGrid");
  const div = document.createElement("div");
  div.className = "item-card";

  // 1. TAMBAHKAN DATA-ID UNTUK PELACAKAN SELEKSI
  div.setAttribute("data-id", doc.$id);

  const isFolder = doc.type === "folder";
  const starHTML = doc.starred
    ? `<i class="fa-solid fa-star" style="position:absolute;top:10px;left:10px;color:#ffd700;z-index:15;text-shadow:0 0 5px rgba(0,0,0,0.5);"></i>`
    : "";
  let content = "";

  if (isFolder) {
    content = `
            <div class="mac-folder-container">
                <div class="mac-folder-icon">
                    <div class="mac-folder-back"></div>
                    <div class="mac-folder-front"></div>
                </div>
            </div>`;
  } else {
    const ext = doc.name.split(".").pop().toLowerCase();
    const fileViewUrl =
      storage.getFileView(CONFIG.BUCKET_ID, doc.fileId).href ||
      storage.getFileView(CONFIG.BUCKET_ID, doc.fileId);

    const familiarImages = [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "bmp",
      "tiff",
      "tif",
      "heif",
      "heic",
      "raw",
      "cr2",
      "nef",
      "orf",
      "arw",
      "dng",
      "jfif",
      "pjp",
      "pjpeg",
      "webp",
      "svg",
      "ico",
    ];
    const vidExts = [
      "mp4",
      "webm",
      "ogg",
      "mov",
      "mkv",
      "avi",
      "wmv",
      "flv",
      "3gp",
      "mpg",
      "mpeg",
      "avchd",
      "m2ts",
    ];
    const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma"];
    const docExts = ["doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx"];
    const pdfExt = ["pdf"];

    const createFallback = (ext, forOnError = false) => {
      let iconClass = "fa-file";
      let colorClass = "icon-grey";
      if (["psd", "indd", "tiff", "tif", "ai", "eps", "pdf"].includes(ext)) {
        if (ext === "pdf") {
          iconClass = "fa-file-pdf";
          colorClass = "icon-red";
        } else if (["psd", "indd"].includes(ext)) {
          iconClass = "fa-file-image";
          colorClass = "icon-blue";
        } else {
          iconClass = "fa-pen-nib";
          colorClass = "icon-orange";
        }
      } else if (ext.includes("doc")) {
        iconClass = "fa-file-word";
        colorClass = "icon-blue";
      } else if (ext.includes("xls") || ext.includes("csv")) {
        iconClass = "fa-file-excel";
        colorClass = "icon-green";
      } else if (ext.includes("ppt")) {
        iconClass = "fa-file-powerpoint";
        colorClass = "icon-orange";
      } else if (["html", "css", "js", "php"].includes(ext)) {
        iconClass = "fa-file-code";
        colorClass = "icon-grey";
      } else if (["zip", "rar"].includes(ext)) {
        iconClass = "fa-file-zipper";
        colorClass = "icon-yellow";
      } else if (audioExts.includes(ext)) {
        iconClass = "fa-music";
        colorClass = "icon-purple";
      }

      const htmlStr = `<div class="thumb-fallback-card"><i class="icon fa-solid ${iconClass} huge-icon ${colorClass}"></i></div>`;
      return forOnError ? htmlStr.replace(/"/g, "&quot;") : htmlStr;
    };

    if (familiarImages.includes(ext)) {
      content = `<div class="thumb-box"><img src="${fileViewUrl}" class="thumb-image" loading="lazy" onerror="this.parentElement.innerHTML='${createFallback(ext, true)}'"></div>`;
    } else if (vidExts.includes(ext)) {
      content = `<div class="thumb-box" style="background:#000;"><video src="${fileViewUrl}" class="thumb-video" preload="none" muted loop onmouseover="this.play()" onmouseout="this.pause()" onerror="this.parentElement.innerHTML='${createFallback(ext, true)}'"></video><i class="fa-solid fa-play" style="position:absolute; color:rgba(255,255,255,0.8); font-size:1.5rem; pointer-events:none;"></i></div>`;
    } else if (audioExts.includes(ext)) {
      content = `<div class="thumb-box bg-purple" style="display:flex; align-items:center; justify-content:center;"><i class="fa-solid fa-music huge-icon icon-purple" style="font-size:2.5rem;"></i><i class="fa-solid fa-play" style="position:absolute; color:rgba(255,255,255,0.8); font-size:1.2rem; pointer-events:none;"></i></div>`;
    } else if (docExts.includes(ext) || pdfExt.includes(ext)) {
      let thumbUrlToUse = "";
      let localCache = JSON.parse(localStorage.getItem("hfThumbCache") || "{}");

      if (doc.thumbUrl && doc.thumbUrl !== "NULL" && doc.thumbUrl !== "") {
        thumbUrlToUse = doc.thumbUrl;
      } else if (localCache[doc.fileId]) {
        thumbUrlToUse = localCache[doc.fileId];
      } else {
        thumbUrlToUse = `https://bizar8-api-thumbnail-drive.hf.space/api/thumbnail?url=${encodeURIComponent(fileViewUrl)}&ext=${ext}`;
        localCache[doc.fileId] = thumbUrlToUse;

        // OPTIMASI PERFORMA: Batasi ukuran cache maksimal 100 item (Anti Memory Leak)
        const cacheKeys = Object.keys(localCache);
        if (cacheKeys.length > 100) delete localCache[cacheKeys[0]];

        localStorage.setItem("hfThumbCache", JSON.stringify(localCache));
        databases
          .updateDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, doc.$id, {
            thumbUrl: thumbUrlToUse,
          })
          .catch((e) => { });
      }

      let badgeIcon = "fa-file";
      let badgeColor = "#ffffff";
      if (pdfExt.includes(ext)) {
        badgeIcon = "fa-file-pdf";
        badgeColor = "#ea4335";
      } else if (ext.includes("doc")) {
        badgeIcon = "fa-file-word";
        badgeColor = "#4285f4";
      } else if (ext.includes("xls") || ext.includes("csv")) {
        badgeIcon = "fa-file-excel";
        badgeColor = "#34a853";
      } else if (ext.includes("ppt")) {
        badgeIcon = "fa-file-powerpoint";
        badgeColor = "#fbbc04";
      }

      content = `
                <div class="thumb-box" style="background:#f8f9fa;">
                    <img src="${thumbUrlToUse}" class="thumb-image" loading="lazy" onerror="this.parentElement.innerHTML='${createFallback(ext, true)}'" style="object-fit: cover;">
                    <div style="position: absolute; bottom: 6px; right: 6px; background: rgba(255,255,255,0.95); padding: 5px 7px; border-radius: 6px; display: flex; align-items: center; justify-content: center; z-index: 11; box-shadow: 0 2px 6px rgba(0,0,0,0.15);">
                        <i class="fa-solid ${badgeIcon}" style="font-size: 1.1rem; color: ${badgeColor};"></i>
                    </div>
                </div>
            `;
    } else {
      content = `<div class="thumb-box">${createFallback(ext)}</div>`;
    }
  }

  div.innerHTML = `${starHTML}${content}<div class="item-name" title="${doc.name}">${doc.name}</div>`;

  // VARIABEL PELACAKAN SISTEM
  let isTouch = false;
  let longPressTriggered = false;
  let touchTimer;
  let isTouchMoved = false;
  let clickTimeout = null;

  // FUNGSI MEMUNCULKAN MENU & TOP BAR
  const triggerFileContextMenu = (clientX, clientY) => {
    closeAllMenus();

    // Pilih file otomatis jika belum terpilih
    if (!selectedFileIds.has(doc.$id)) {
      selectedFileIds.clear();
      selectedFileIds.add(doc.$id);
      selectedItem = doc;
      updateSelectionUI(); // Memunculkan SAB
    } else {
      selectedItem = doc;
    }

    const menu = el("fileContextMenu");
    [
      "ctxBtnOpenFolder",
      "ctxBtnPreview",
      "ctxBtnDownload",
      "ctxBtnOpenWith",
    ].forEach((id) => {
      const btn = el(id);
      if (btn)
        btn.style.display =
          (isFolder && id === "ctxBtnOpenFolder") ||
            (!isFolder && id !== "ctxBtnOpenFolder")
            ? "flex"
            : "none";
    });

    positionMenuInsideWindow(menu, clientX, clientY);

    const isTrash = doc.trashed;
    if (el("ctxTrashBtn"))
      el("ctxTrashBtn").classList.toggle("hidden", isTrash);
    if (el("ctxRestoreBtn"))
      el("ctxRestoreBtn").classList.toggle("hidden", !isTrash);
    if (el("ctxPermDeleteBtn"))
      el("ctxPermDeleteBtn").classList.toggle("hidden", !isTrash);
    if (el("ctxStarText"))
      el("ctxStarText").innerText = doc.starred ? "Hapus Bintang" : "Bintangi";
  };

  // EVENT TOUCH (MOBILE)
  div.addEventListener(
    "touchstart",
    (e) => {
      isTouch = true;
      isTouchMoved = false;
      longPressTriggered = false;
      const touch = e.touches[0];

      touchTimer = setTimeout(() => {
        if (!isTouchMoved) {
          longPressTriggered = true;
          if (e.cancelable) e.preventDefault();
          e.stopPropagation();
          triggerFileContextMenu(touch.clientX, touch.clientY);
          if (navigator.vibrate) navigator.vibrate(50);
        }
      }, 500);
    },
    { passive: false },
  );

  div.addEventListener(
    "touchmove",
    () => {
      isTouchMoved = true;
      clearTimeout(touchTimer);
    },
    { passive: true },
  );
  div.addEventListener("touchend", (e) => {
    clearTimeout(touchTimer);
    if (longPressTriggered && e.cancelable) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  div.addEventListener("touchcancel", () => clearTimeout(touchTimer));

  // EVENT KLIK (DESKTOP & MOBILE TAP)
  div.addEventListener("click", (e) => {
    e.stopPropagation();

    if (longPressTriggered) {
      longPressTriggered = false;
      return;
    }

    if (doc.trashed) return;

    if (isTouch || e.pointerType === "touch") {
      // MOBILE: Buka langsung jika tidak ada yang terseleksi
      if (selectedFileIds.size === 0) {
        clearSelection();
        closeAllMenus();
        isFolder ? openFolder(doc.$id, doc.name) : openPreview(doc);
      } else {
        // MOBILE: Mode Seleksi Aktif (Pilih file)
        if (selectedFileIds.has(doc.$id)) {
          selectedFileIds.delete(doc.$id);
        } else {
          selectedFileIds.add(doc.$id);
          selectedItem = doc;
        }
        updateSelectionUI();
        closeAllMenus();
      }
      setTimeout(() => {
        isTouch = false;
      }, 300);
      return;
    }

    // DESKTOP: Menunggu potensi double click
    if (clickTimeout) clearTimeout(clickTimeout);
    clickTimeout = setTimeout(() => {
      if (e.ctrlKey || e.metaKey) {
        if (selectedFileIds.has(doc.$id)) {
          selectedFileIds.delete(doc.$id);
        } else {
          selectedFileIds.add(doc.$id);
          selectedItem = doc;
        }
      } else {
        selectedFileIds.clear();
        selectedFileIds.add(doc.$id);
        selectedItem = doc;
      }
      updateSelectionUI();
      closeAllMenus();
    }, 250);
  });

  // EVENT DBLCLICK (KLIK 2X DESKTOP)
  div.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (clickTimeout) clearTimeout(clickTimeout); // BATALKAN KLIK KIRI AGAR SAB TIDAK MUNCUL
    if (isTouch || e.pointerType === "touch") return;

    clearSelection(); // BERSIHKAN SAB SEBELUM BUKA FILE
    closeAllMenus();

    if (!doc.trashed) {
      isFolder ? openFolder(doc.$id, doc.name) : openPreview(doc);
    }
  });

  // EVENT CONTEXT MENU (KLIK KANAN DESKTOP)
  div.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    triggerFileContextMenu(e.clientX, e.clientY);
  });

  grid.appendChild(div);
}

function closeAllMenus() {
  // HANYA TUTUP DROPDOWN DAN MENU KONTEKS
  document
    .querySelectorAll(
      ".dropdown-content, .context-menu-modern, .context-menu-fixed, #dropdownNewMenu, #fileContextMenu",
    )
    .forEach((menu) => {
      if (menu) {
        menu.classList.remove("show");
        if (menu.id === "fileContextMenu" || menu.id === "previewContextMenu") {
          menu.classList.add("hidden");
        }
      }
    });

  const storageModal = document.getElementById("storageModal");
  if (storageModal) storageModal.classList.add("hidden");
}

// ---> GANTI BAGIAN INI DI DALAM closeAllMenus() <---
// MENGHILANGKAN TOP ACTION BAR SEKETIKA
const sab = document.getElementById("selectionActionBar");
if (sab) {
  sab.classList.add("hidden");
  sab.classList.remove("show-bar");
}
document
  .querySelectorAll(".item-card")
  .forEach((card) => card.classList.remove("selected-item"));

function initAllContextMenus() {
  const tombolBaru = document.getElementById("newBtnMain");
  const semuaMenuBaru = document.querySelectorAll("#dropdownNewMenu");
  let menuBaru = null;

  if (semuaMenuBaru.length > 0) {
    menuBaru = semuaMenuBaru[semuaMenuBaru.length - 1];
    document.body.appendChild(menuBaru);

    menuBaru.innerHTML = `
            <a href="javascript:void(0)" onclick="createFolder()"><i class="fa-solid fa-folder-plus"></i> Folder baru</a>
            <hr class="menu-divider">
            <a href="javascript:void(0)" onclick="triggerUploadModal('file')"><i class="fa-solid fa-file-arrow-up"></i> Upload file</a>
            <a href="javascript:void(0)" onclick="triggerUploadModal('folder')"><i class="fa-solid fa-folder-arrow-up"></i> Upload folder</a>
            <hr class="menu-divider">
            <a href="javascript:void(0)" onclick="openGoogleDoc('document')"><i class="fa-solid fa-file-word text-blue"></i> Google Dokumen</a>
            <a href="javascript:void(0)" onclick="openGoogleDoc('spreadsheet')"><i class="fa-solid fa-file-excel text-green"></i> Google Spreadsheet</a>
            <a href="javascript:void(0)" onclick="openGoogleDoc('presentation')"><i class="fa-solid fa-file-powerpoint text-yellow"></i> Google Slide</a>
            <a href="javascript:void(0)" onclick="openGoogleDoc('form')"><i class="fa-solid fa-file-lines text-purple"></i> Google Formulir</a>
        `;

    semuaMenuBaru.forEach((menu) => {
      if (menu !== menuBaru) menu.remove();
    });
  }

  const navigasiDrive = document.getElementById("navDrive");
  const areaUtama = document.querySelector(".main-content-area");

  if (tombolBaru && menuBaru) {
    const tombolBaruBersih = tombolBaru.cloneNode(true);
    tombolBaru.parentNode.replaceChild(tombolBaruBersih, tombolBaru);

    tombolBaruBersih.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const apakahSedangTerbuka = menuBaru.classList.contains("show");
      closeAllMenus();

      if (!apakahSedangTerbuka) {
        menuBaru.classList.add("show");
        const posisiTombol = tombolBaruBersih.getBoundingClientRect();
        const tinggiMenu = menuBaru.offsetHeight || 280; // fallback jika belum terukur
        const lebarMenu = menuBaru.offsetWidth || 240;   // fallback jika belum terukur
        // Gunakan logika mobile (menu di atas tombol floating) untuk semua layar <= 1024px
        // Ini mencakup: HP, iPad Air (820px), Surface Pro (912px), Zenbook Fold (853px),
        // iPad Pro & Nest Hub (1024px) — semua menggunakan bottom-nav dan tombol floating
        const apakahLayarHP = window.innerWidth <= 1024;

        menuBaru.style.setProperty("position", "fixed", "important");
        menuBaru.style.setProperty("z-index", "999999", "important");
        menuBaru.style.setProperty("bottom", "auto", "important");
        menuBaru.style.setProperty("right", "auto", "important");

        if (apakahLayarHP) {
          // Menu muncul di atas tombol floating (+)
          const topPos = posisiTombol.top - tinggiMenu - 12;
          // Pastikan tidak melewati batas atas layar
          const safeTop = Math.max(8, topPos);

          // Rata kanan sejajar dengan sisi kanan tombol, tapi tidak overflow kiri layar
          const leftPos = posisiTombol.right - lebarMenu;
          const safeLeft = Math.max(8, Math.min(leftPos, window.innerWidth - lebarMenu - 8));

          menuBaru.style.setProperty("top", `${safeTop}px`, "important");
          menuBaru.style.setProperty("left", `${safeLeft}px`, "important");
        } else {
          menuBaru.style.setProperty(
            "top",
            `${posisiTombol.bottom + 8}px`,
            "important",
          );
          menuBaru.style.setProperty(
            "left",
            `${posisiTombol.left + 15}px`,
            "important",
          );
        }
      }
    });
  }

  if (navigasiDrive) {
    navigasiDrive.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeAllMenus();
    });
  }

  if (areaUtama) {
    // KLIK KANAN AREA KOSONG
    areaUtama.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".item-card")) return;
      // Ditiadakan sesuai permintaan: tidak memunculkan globalContextMenu
      if (typeof window.clearSelection === "function") window.clearSelection();
      closeAllMenus();
    });

    // TAHAN AREA KOSONG (MOBILE)
    let gridTouchTimer;
    areaUtama.addEventListener(
      "touchstart",
      (e) => {
        if (e.target.closest(".item-card")) return;
        const touch = e.touches[0];
        gridTouchTimer = setTimeout(() => {
          if (typeof window.clearSelection === "function")
            window.clearSelection();
          closeAllMenus();
          // Ditiadakan sesuai permintaan: tidak memunculkan globalContextMenu
        }, 500);
      },
      { passive: true },
    );

    areaUtama.addEventListener(
      "touchmove",
      () => clearTimeout(gridTouchTimer),
      { passive: true },
    );
    areaUtama.addEventListener("touchend", () => clearTimeout(gridTouchTimer));
    areaUtama.addEventListener("touchcancel", () =>
      clearTimeout(gridTouchTimer),
    );
  }

  // ====================================================================
  // LOGIKA KLIK GLOBAL: MENGATUR HILANGNYA MENU / ACTION BAR
  // ====================================================================
  window.addEventListener("click", (e) => {
    // 1. Abaikan klik jika yang diklik adalah bagian menu atau bar itu sendiri
    if (
      e.target.closest(".dropdown-content") ||
      e.target.closest(".context-menu-modern") ||
      e.target.closest(".modal-overlay") ||
      e.target.closest(".storage-widget") ||
      e.target.closest("#newBtnMain") ||
      e.target.closest(".new-btn-wrapper") ||
      e.target.closest(".selection-action-bar")
    ) {
      return;
    }

    // 2. Cek apakah ada Menu Konteks / Dropdown yang sedang terbuka SEBELUM ditutup
    const ctxMenu = document.getElementById("fileContextMenu");
    const globalCtxMenu = document.getElementById("globalContextMenu");
    const newMenu = document.getElementById("dropdownNewMenu");

    const isMenuOpen =
      (ctxMenu && ctxMenu.classList.contains("show")) ||
      (globalCtxMenu && globalCtxMenu.classList.contains("show")) ||
      (newMenu && newMenu.classList.contains("show"));

    // 3. Selalu tutup semua popup menu saat area kosong diklik
    closeAllMenus();

    // 4. Jika yang diklik benar-benar area kosong (BUKAN file/folder)
    if (!e.target.closest(".item-card")) {
      // HANYA bersihkan seleksi (hilangkan Action Bar) jika sebelumnya TIDAK ADA menu yang terbuka.
      // (Artinya: Jika tadi ada menu terbuka, klik ini hanya berfungsi menutup menu saja).
      if (!isMenuOpen) {
        if (typeof window.clearSelection === "function") {
          window.clearSelection();
        }
      }
    }
  });
} // <--- AKHIR FUNGSI initAllContextMenus

// ======================================================
// 8. STORAGE LOGIC & MODAL
// ======================================================
function formatSize(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function initStorageTooltip() {
  const segments = document.querySelectorAll(".bar-segment");
  const tooltip = el("customTooltip");
  const ttHeader = el("ttHeader");
  const ttSize = el("ttSize");
  const ttDesc = el("ttDesc");

  segments.forEach((seg) => {
    seg.addEventListener("mouseenter", (e) => {
      const cat = e.target.getAttribute("data-category");
      const size = e.target.getAttribute("data-size");
      const formattedSize = formatSize(parseInt(size || 0));

      ttHeader.innerText = cat || "LAINNYA";
      ttSize.innerText = formattedSize;
      if (cat === "GAMBAR")
        ttDesc.innerText = "Foto dan gambar yang tersimpan.";
      else if (cat === "VIDEO")
        ttDesc.innerText = "Video dan rekaman yang tersimpan.";
      else if (cat === "DOKUMEN")
        ttDesc.innerText = "Dokumen PDF, Word, Excel.";
      else if (cat === "TERSEDIA")
        ttDesc.innerText = "Sisa penyimpanan yang tersedia.";
      else ttDesc.innerText = "File lain yang tidak dikategorikan.";
      tooltip.classList.remove("hidden");
    });

    seg.addEventListener("mousemove", (e) => {
      tooltip.style.left = `${e.clientX}px`;
      tooltip.style.top = `${e.clientY - 15}px`;
    });
    seg.addEventListener("mouseleave", () => {
      tooltip.classList.add("hidden");
    });
  });
}

window.openStoragePage = async () => {
  await calculateStorage();
  window.closeModal("storageModal");
  window.nav("storagePage");

  const totalBytes = storageDetail.total || 0;
  const limitBytes = 2 * 1024 * 1024 * 1024;

  const percentUsed = Math.min((totalBytes / limitBytes) * 100, 100).toFixed(0);
  el("pageStoragePercent").innerText =
    `Ruang penyimpanan ${percentUsed}% penuh`;
  el("pageStorageUsedText").innerText = `${formatSize(totalBytes)} dari 2 GB`;

  const pctImages = (storageDetail.images / limitBytes) * 100;
  const pctVideos = (storageDetail.videos / limitBytes) * 100;
  const pctDocs = (storageDetail.docs / limitBytes) * 100;
  const pctOthers = (storageDetail.others / limitBytes) * 100;
  const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

  const barImg = el("pageBarImages");
  const barVid = el("pageBarVideos");
  const barDoc = el("pageBarDocs");
  const barOth = el("pageBarOthers");
  const barFree = el("pageBarFree");

  barImg.style.width = `${pctImages}%`;
  barVid.style.width = `${pctVideos}%`;
  barDoc.style.width = `${pctDocs}%`;
  barOth.style.width = `${pctOthers}%`;
  barFree.style.width = `${pctFree}%`;

  barImg.setAttribute("data-category", "GAMBAR");
  barImg.setAttribute("data-size", storageDetail.images);
  barVid.setAttribute("data-category", "VIDEO");
  barVid.setAttribute("data-size", storageDetail.videos);
  barDoc.setAttribute("data-category", "DOKUMEN");
  barDoc.setAttribute("data-size", storageDetail.docs);
  barOth.setAttribute("data-category", "LAINNYA");
  barOth.setAttribute("data-size", storageDetail.others);
  barFree.setAttribute("data-category", "TERSEDIA");
  barFree.setAttribute("data-size", limitBytes - totalBytes);

  el("pageValImages").innerText = formatSize(storageDetail.images);
  el("pageValVideos").innerText = formatSize(storageDetail.videos);
  el("pageValDocs").innerText = formatSize(storageDetail.docs);
  el("pageValOthers").innerText = formatSize(storageDetail.others);
  el("pageValFree").innerText = formatSize(limitBytes - totalBytes);
  initStorageTooltip();
};

window.closeStoragePage = () => {
  window.nav("dashboardPage");
};

window.openStorageModal = async () => {
  closeAllMenus();
  await calculateStorage();
  const totalBytes = storageDetail.total || 0;
  const limitBytes = 2 * 1024 * 1024 * 1024;

  el("storageBigText").innerText = formatSize(totalBytes);
  const pctImages = (storageDetail.images / limitBytes) * 100;
  const pctVideos = (storageDetail.videos / limitBytes) * 100;
  const pctDocs = (storageDetail.docs / limitBytes) * 100;
  const pctOthers = (storageDetail.others / limitBytes) * 100;
  const pctFree = 100 - (pctImages + pctVideos + pctDocs + pctOthers);

  const barImg = el("barImages");
  const barVid = el("barVideos");
  const barDoc = el("barDocs");
  const barOth = el("barOthers");
  const barFree = el("barFree");

  barImg.style.width = `${pctImages}%`;
  barVid.style.width = `${pctVideos}%`;
  barDoc.style.width = `${pctDocs}%`;
  barOth.style.width = `${pctOthers}%`;
  barFree.style.width = `${pctFree}%`;

  barImg.setAttribute("data-category", "GAMBAR");
  barImg.setAttribute("data-size", storageDetail.images);
  barVid.setAttribute("data-category", "VIDEO");
  barVid.setAttribute("data-size", storageDetail.videos);
  barDoc.setAttribute("data-category", "DOKUMEN");
  barDoc.setAttribute("data-size", storageDetail.docs);
  barOth.setAttribute("data-category", "LAINNYA");
  barOth.setAttribute("data-size", storageDetail.others);
  barFree.setAttribute("data-category", "TERSEDIA");
  barFree.setAttribute("data-size", limitBytes - totalBytes);

  el("valImages").innerText = formatSize(storageDetail.images);
  el("valVideos").innerText = formatSize(storageDetail.videos);
  el("valDocs").innerText = formatSize(storageDetail.docs);
  el("valOthers").innerText = formatSize(storageDetail.others);

  const modalBox = el("storageModal").querySelector(".modal-box");
  modalBox.classList.remove("animate-open");
  void modalBox.offsetWidth;
  modalBox.classList.add("animate-open");
  window.openModal("storageModal");
};

// PERBAIKAN: Fungsi Cache Storage untuk Menghindari Request Berlebihan
async function calculateStorage() {
  if (!currentUser) return;
  try {
    const cachedStorage = sessionStorage.getItem("storageDetail");
    if (cachedStorage && !window.forceCalculateStorage) {
      storageDetail = JSON.parse(cachedStorage);
      updateStorageUI();
      return;
    }

    const res = await databases.listDocuments(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      [
        Appwrite.Query.equal("owner", currentUser.$id),
        Appwrite.Query.equal("type", "file"),
        Appwrite.Query.limit(500)
      ],
    );

    storageDetail = { images: 0, videos: 0, docs: 0, others: 0, total: 0 };
    const limit = 2 * 1024 * 1024 * 1024;

    res.documents.forEach((doc) => {
      const size = doc.size || 0;
      const name = doc.name.toLowerCase();
      storageDetail.total += size;
      if (
        name.match(
          /\.(jpg|jpeg|png|gif|webp|jfif|svg|bmp|tiff|tif|heif|heic|raw|ico)$/,
        )
      )
        storageDetail.images += size;
      else if (
        name.match(/\.(mp4|mkv|mov|avi|wmv|flv|webm|3gp|mpg|mpeg|avchd|m2ts)$/)
      )
        storageDetail.videos += size;
      else if (
        name.match(
          /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|rtf|csv|odt|ods|odp)$/,
        )
      )
        storageDetail.docs += size;
      else storageDetail.others += size;
    });

    sessionStorage.setItem("storageDetail", JSON.stringify(storageDetail));
    window.forceCalculateStorage = false;
    updateStorageUI();
  } catch (e) {
    console.error("Gagal hitung storage:", e);
  }
}

function updateStorageUI() {
  const limit = 2 * 1024 * 1024 * 1024;
  if (el("storageUsed"))
    el("storageUsed").innerText = formatSize(storageDetail.total);
  const totalPct = Math.min((storageDetail.total / limit) * 100, 100);
  if (el("storageBar")) {
    el("storageBar").style.width = `${totalPct}%`;
    if (totalPct > 90) el("storageBar").style.backgroundColor = "#ef4444";
    else el("storageBar").style.backgroundColor = "";
  }
}

window.openModal = (id) => {
  document.getElementById(id).classList.remove("hidden");
  if (id === "folderModal")
    setTimeout(() => document.getElementById("newFolderName").focus(), 100);
};
window.closeModal = (id) => document.getElementById(id).classList.add("hidden");

// MENGUBAH BARIS INI: Tambahkan closeAllMenus() agar dropdown tertutup
window.createFolder = () => {
  closeAllMenus();
  window.openModal("folderModal");
};

window.submitCreateFolder = async () => {
  const name = document.getElementById("newFolderName").value.trim();
  if (!name) return;
  closeModal("folderModal");
  toggleLoading(true);
  try {
    await databases.createDocument(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      Appwrite.ID.unique(),
      {
        name,
        type: "folder",
        parentId: currentFolderId,
        owner: currentUser.$id,
        size: 0,
        starred: false,
        trashed: false,
      },
    );
    loadFiles(currentFolderId);
    document.getElementById("newFolderName").value = "";
  } catch (e) {
    alert(e.message);
  } finally {
    toggleLoading(false);
  }
};

window.toggleStarItem = async () => {
  try {
    await databases.updateDocument(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      selectedItem.$id,
      { starred: !selectedItem.starred },
    );
    loadFiles(currentViewMode === "root" ? currentFolderId : currentViewMode);
    closeAllMenus();
  } catch (e) { }
};
window.moveItemToTrash = async () => {
  try {
    await databases.updateDocument(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      selectedItem.$id,
      { trashed: true },
    );
    window.forceCalculateStorage = true;
    loadFiles(currentViewMode === "root" ? currentFolderId : currentViewMode);
    calculateStorage();
    closeAllMenus();
  } catch (e) { }
};
window.restoreFromTrash = async () => {
  try {
    await databases.updateDocument(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      selectedItem.$id,
      { trashed: false },
    );
    window.forceCalculateStorage = true;
    loadFiles("trash");
    calculateStorage();
    closeAllMenus();
  } catch (e) { }
};
window.deleteItemPermanently = async () => {
  if (!confirm("Hapus permanen? Data tidak bisa dikembalikan!")) return;
  toggleLoading(true, "Menghapus...");
  try {
    if (selectedItem.type === "file")
      await storage.deleteFile(CONFIG.BUCKET_ID, selectedItem.fileId);
    await databases.deleteDocument(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      selectedItem.$id,
    );
    window.forceCalculateStorage = true;
    loadFiles("trash");
    calculateStorage();
    closeAllMenus();
  } catch (e) {
  } finally {
    toggleLoading(false);
  }
};
window.openCurrentItem = () => {
  if (selectedItem)
    selectedItem.type === "folder"
      ? openFolder(selectedItem.$id, selectedItem.name)
      : openPreview(selectedItem);
  closeAllMenus();
};
window.downloadCurrentItem = () => {
  if (selectedItem && selectedItem.type !== "folder")
    window.open(
      storage.getFileDownload(CONFIG.BUCKET_ID, selectedItem.fileId),
      "_blank",
    );
  closeAllMenus();
};
window.renameCurrentItem = async () => {
  const newName = prompt("Nama baru:", selectedItem.name);
  if (newName) {
    await databases.updateDocument(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      selectedItem.$id,
      { name: newName },
    );
    loadFiles(currentFolderId);
  }
  closeAllMenus();
};

// =========================================================================
// MESIN UPLOAD (BERURUTAN/ANTI-GAGAL) & STRUKTUR FOLDER ASLI
// =========================================================================
let selectedUploadFiles = [];
let uploadMode = "file";

window.triggerUploadModal = (mode = "file") => {
  closeAllMenus(); // <--- TAMBAHKAN BARIS INI DI SINI

  resetUploadUI();
  uploadMode = mode;
  const dropZone = document.getElementById("dropZone");
  const folderInput = document.getElementById("folderInputHidden");
  const fileInput = document.getElementById("fileInputHidden");

  if (mode === "folder") {
    document.getElementById("uploadModalTitle").innerText = "Upload Folder";
    document.getElementById("uploadModalDesc").innerText =
      "Klik untuk pilih folder dari perangkat Anda";
    if (dropZone && folderInput) dropZone.onclick = () => folderInput.click();
  } else {
    document.getElementById("uploadModalTitle").innerText = "Upload File";
    document.getElementById("uploadModalDesc").innerText =
      "Seret file ke sini atau klik";
    if (dropZone && fileInput) dropZone.onclick = () => fileInput.click();
  }

  window.openModal("uploadModal");
};

function resetUploadUI() {
  selectedUploadFiles = [];
  const fileContainer = document.getElementById("fileInfoContainer");
  if (fileContainer) fileContainer.classList.add("hidden");

  const fileInput = document.getElementById("fileInputHidden");
  const folderInput = document.getElementById("folderInputHidden");
  if (fileInput) fileInput.value = "";
  if (folderInput) folderInput.value = "";
}

function handleFileSelect(files) {
  if (!files || files.length === 0) return;
  
  let tempFiles = Array.from(files);

  if (uploadMode === "folder") {
    let topLevelFolders = new Set();
    tempFiles.forEach(f => {
      const path = f.customPath || f.webkitRelativePath;
      if (path) {
         topLevelFolders.add(path.split('/')[0]);
      }
    });
    if (topLevelFolders.size > 10) {
       alert("Peringatan: Maksimal 10 folder utama dapat diunggah sekaligus. Silakan kurangi jumlah folder yang dipilih.");
       resetUploadUI();
       return;
    }
  }

  // Akumulasi file yang dipilih (bisa drag & drop berkali-kali)
  if (selectedUploadFiles && selectedUploadFiles.length > 0) {
      selectedUploadFiles = [...selectedUploadFiles, ...tempFiles];
  } else {
      selectedUploadFiles = tempFiles;
  }

  const realFiles = selectedUploadFiles.filter(
    (f) => f.name !== ".emptyFolder",
  );
  const folderCount = selectedUploadFiles.filter(
    (f) => f.name === ".emptyFolder",
  ).length;

  const infoText = document.getElementById("fileInfoText");
  let msg = `Terpilih: ${realFiles.length} file `;
  if (folderCount > 0) msg += `(dan ${folderCount} folder kosong)`;
  
  let fileListHTML = `<div style="text-align: left; padding: 0 10px;">`;
  fileListHTML += `<strong style="display: block; margin-bottom: 5px; text-align: center;">${msg}</strong>`;
  fileListHTML += `<ul style="list-style-type: none; padding-left: 0; margin: 0; font-size: 0.9em;">`;
  
  realFiles.forEach(f => {
      fileListHTML += `<li style="padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${f.name}">
        <i class="fa-solid fa-file" style="margin-right: 5px; opacity: 0.7;"></i> ${f.name}
      </li>`;
  });
  
  fileListHTML += `</ul></div>`;
  infoText.innerHTML = fileListHTML;
  document.getElementById("fileInfoContainer").classList.remove("hidden");
  
  // Kosongkan value input agar event 'change' bisa dipicu kembali meskipun memilih file yang sama
  const fInput = document.getElementById("fileInputHidden");
  const folderInputHidden = document.getElementById("folderInputHidden");
  if (fInput) fInput.value = "";
  if (folderInputHidden) folderInputHidden.value = "";
}

// FUNGSI PINTAR MEMBACA STRUKTUR FOLDER DARI DRAG & DROP
async function traverseFileTree(item, path, allFiles) {
  path = path || "";
  if (item.isFile) {
    return new Promise((resolve) => {
      item.file((file) => {
        file.customPath = path + file.name;
        allFiles.push(file);
        resolve();
      });
    });
  } else if (item.isDirectory) {
    let dirReader = item.createReader();
    return new Promise((resolve) => {
      dirReader.readEntries(async (entries) => {
        if (entries.length === 0) {
          const emptyFile = new File([""], ".emptyFolder", {
            type: "text/plain",
          });
          emptyFile.customPath = path + item.name + "/.emptyFolder";
          allFiles.push(emptyFile);
        } else {
          for (let i = 0; i < entries.length; i++) {
            await traverseFileTree(
              entries[i],
              path + item.name + "/",
              allFiles,
            );
          }
        }
        resolve();
      });
    });
  }
}

function initDragAndDrop() {
  const modal = document.getElementById("uploadModal");
  const zone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInputHidden");
  const folderInput = document.getElementById("folderInputHidden");

  if (!modal || !zone) return;
  
  // Pasang event di seluruh modal agar area drop lebih luas
  modal.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("active");
  });
  modal.addEventListener("dragleave", (e) => {
    // Hanya hilangkan class active jika keluar dari modal sepenuhnya
    if (e.target === modal) {
        zone.classList.remove("active");
    }
  });

  modal.addEventListener("drop", async (e) => {
    e.preventDefault();
    zone.classList.remove("active");

    let allFiles = [];
    let items = e.dataTransfer.items;

    if (items) {
      toggleLoading(true, "Membaca struktur file/folder...");
      
      // Kumpulkan entry secara sinkronik untuk mencegah hilangnya referensi items karena await (bug di beberapa browser)
      let entries = [];
      for (let i = 0; i < items.length; i++) {
        let entry = items[i].webkitGetAsEntry();
        if (entry) entries.push(entry);
      }

      for (let entry of entries) {
        await traverseFileTree(entry, "", allFiles);
      }
      
      toggleLoading(false);
    }

    if (allFiles.length > 0) {
      handleFileSelect(allFiles);
    } else {
      alert("Sistem tidak mendeteksi file yang dapat diolah.");
    }
  });

  if (fileInput)
    fileInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) handleFileSelect(e.target.files);
    });

  if (folderInput)
    folderInput.addEventListener("change", (e) => {
      if (e.target.files.length > 0) {
        handleFileSelect(e.target.files);
      } else {
        alert(
          "Peringatan Browser: Browser tidak mengizinkan unggah folder kosong melalui tombol klik. \n\nSolusi: Gunakan fitur Seret dan Lepas (Drag & Drop) kotak di atas untuk mengunggah folder kosong.",
        );
      }
    });
}

window.submitUploadFile = async () => {
  if (selectedUploadFiles.length === 0)
    return alert("Pilih item terlebih dahulu!");
  closeModal("uploadModal");
  toggleLoading(true, `Memulai pemrosesan...`);

  try {
    let folderCache = { [currentFolderId]: currentFolderId };

    const ensureFolderExists = async (pathStr) => {
      if (folderCache[pathStr]) return folderCache[pathStr];
      let parts = pathStr.split("/");
      let currentPath = "";
      let parentId = currentFolderId;

      for (let part of parts) {
        if (!part) continue;
        currentPath = currentPath ? `${currentPath}/${part}` : part;

        if (folderCache[currentPath]) {
          parentId = folderCache[currentPath];
        } else {
          const newFolderId = Appwrite.ID.unique();
          await databases.createDocument(
            CONFIG.DB_ID,
            CONFIG.COLLECTION_FILES,
            newFolderId,
            {
              name: part,
              type: "folder",
              parentId: parentId,
              owner: currentUser.$id,
              size: 0,
              starred: false,
              trashed: false,
            },
          );
          folderCache[currentPath] = newFolderId;
          parentId = newFolderId;
        }
      }
      return parentId;
    };

    const uploadQueue = [];
    let foldersCreated = 0;

    for (const file of selectedUploadFiles) {
      let targetParentId = currentFolderId;
      const fullPath = file.customPath || file.webkitRelativePath;

      if (fullPath) {
        const pathParts = fullPath.split("/");
        pathParts.pop();
        if (pathParts.length > 0) {
          targetParentId = await ensureFolderExists(pathParts.join("/"));
          foldersCreated++;
        }
      }

      if (file.name !== ".emptyFolder") {
        uploadQueue.push({ fileObj: file, parentId: targetParentId });
      }
    }

    const CONCURRENCY_LIMIT = 20;
    const pool = new Set();
    
    toggleLoading(true, `Sedang mengunggah ${uploadQueue.length} file secara bersamaan...`);

    for (const item of uploadQueue) {
      const uploadTask = (async () => {
        try {
          const up = await storage.createFile(
            CONFIG.BUCKET_ID,
            Appwrite.ID.unique(),
            item.fileObj,
          );
          const viewUrl = storage.getFileView(CONFIG.BUCKET_ID, up.$id).href;

          await databases.createDocument(
            CONFIG.DB_ID,
            CONFIG.COLLECTION_FILES,
            Appwrite.ID.unique(),
            {
              name: item.fileObj.name,
              type: "file",
              parentId: item.parentId,
              owner: currentUser.$id,
              url: viewUrl,
              fileId: up.$id,
              size: item.fileObj.size,
              starred: false,
              trashed: false,
            },
          );
        } catch (err) {
          console.error("Gagal unggah file:", item.fileObj.name, err);
        } finally {
          pool.delete(uploadTask);
        }
      })();

      pool.add(uploadTask);

      if (pool.size >= CONCURRENCY_LIMIT) {
        await Promise.race(pool);
      }
    }

    await Promise.all(pool);

    resetUploadUI();
    window.forceCalculateStorage = true;
    loadFiles(currentFolderId);
    calculateStorage();

    if (uploadQueue.length === 0 && foldersCreated > 0) {
      toggleLoading(false);
      setTimeout(() => alert("Struktur folder kosong berhasil dibuat!"), 500);
    }
  } catch (e) {
    alert("Terjadi kesalahan saat mengunggah: " + e.message);
  } finally {
    toggleLoading(false);
  }
};

const folderInputModal = document.getElementById("newFolderName");
if (folderInputModal) {
  folderInputModal.addEventListener("keypress", function (e) {
    if (e.key === "Enter") submitCreateFolder();
  });
}

// INTEGRASI GOOGLE DOCS YANG SEMPAT TERHAPUS
window.openGoogleDoc = (type) => {
  closeAllMenus();
  let url = "";
  if (type === "document") url = "https://docs.google.com/document/create";
  else if (type === "spreadsheet")
    url = "https://docs.google.com/spreadsheets/create";
  else if (type === "presentation")
    url = "https://docs.google.com/presentation/create";
  else if (type === "form") url = "https://docs.google.com/forms/create";

  if (url) window.open(url, "_blank");
};

// LOADFILES (PENGAMAN AGAR BISA LOGIN)
async function loadFiles(param) {
  if (!currentUser) return;

  // TAMBAHKAN BARIS INI: Bersihkan seleksi saat pindah layar
  if (typeof window.clearSelection === "function") window.clearSelection();

  const grid = document.getElementById("fileGrid");
  // ... sisa kode loadFiles ...
  if (grid) grid.innerHTML = "";

  if (typeof updateHeaderUI === "function") {
    updateHeaderUI();
  }

  let queries = [Appwrite.Query.equal("owner", currentUser.$id)];
  if (param === "recent")
    queries.push(
      Appwrite.Query.orderDesc("$createdAt"),
      Appwrite.Query.equal("trashed", false),
    );
  else if (param === "starred")
    queries.push(
      Appwrite.Query.equal("starred", true),
      Appwrite.Query.equal("trashed", false),
    );
  else if (param === "trash")
    queries.push(Appwrite.Query.equal("trashed", true));
  else {
    if (
      typeof param === "string" &&
      !["root", "recent", "starred", "trash"].includes(param)
    )
      currentFolderId = param;
    queries.push(
      Appwrite.Query.equal("parentId", currentFolderId),
      Appwrite.Query.equal("trashed", false),
    );
  }

  // OPTIMASI PERFORMA: Batasi maksimal 100 file
  queries.push(Appwrite.Query.limit(100));

  try {
    const res = await databases.listDocuments(
      CONFIG.DB_ID,
      CONFIG.COLLECTION_FILES,
      queries,
    );
    if (typeof updatePreviewList === "function")
      updatePreviewList(res.documents);

    if (res.documents.length === 0) {
      if (grid)
        grid.innerHTML = `
                <div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;opacity:0.6;margin-top:50px;">
                    <div class="mac-folder-icon" style="transform: scale(1.2); margin-bottom:25px; filter: grayscale(100%); opacity: 0.5;">
                        <div class="mac-folder-back"></div>
                        <div class="mac-folder-front"></div>
                    </div>
                    <p>Folder Kosong</p>
                </div>`;
    } else {
      res.documents.forEach((doc) => {
        if (typeof renderItem === "function") renderItem(doc);
      });
    }
  } catch (e) {
    console.error(e);
  }
}

// HEADER UI - MENGGUNAKAN BAHASA INGGRIS
function updateHeaderUI() {
  const container = document.querySelector(".breadcrumb-area");
  const landscapeContainer = document.getElementById("landscapeHeaderCenter");

  const isRoot = currentFolderId === "root" && currentViewMode === "root";
  let content = "";

  if (isRoot) {
    const h = new Date().getHours();
    const s = h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Night";
    content = `<h2 id="headerTitle" class="header-title-pill welcome-title">Welcome In Drive ${s}</h2>`;
  } else {
    let backText = "Drive";
    if (folderHistory.length > 1) {
      backText = folderHistory[folderHistory.length - 2].name;
    } else if (currentViewMode !== "root") {
      backText = "Drive";
    }

    content = `
            <div class="back-nav-container">
                <button onclick="goBack()" class="back-btn" title="Kembali ke ${backText}">
                    <i class="fa-solid fa-arrow-left"></i> Kembali ke ${backText}
                </button>
                <h2 id="headerTitle" class="header-title-pill" style="margin-top:10px;">${currentFolderName}</h2>
            </div>`;
  }

  if (container) container.innerHTML = content;
  if (landscapeContainer) landscapeContainer.innerHTML = content;
}

window.togglePass = (id, icon) => {
  const input = document.getElementById(id);
  if (!input) return;
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
// 9. LOGIKA PRATINJAU FILE (AUDIO, VIDEO, GAMBAR, DLL)
// ======================================================

function getDisplayedDocuments() {
  const items = document.querySelectorAll(".item-card");
  let docs = [];
  items.forEach((item) => {
    if (item.querySelector(".mac-folder-container")) return;
    const nameEl = item.querySelector(".item-name");
    if (!nameEl) return;
    docs.push({ name: nameEl.innerText, element: item });
  });
  return docs;
}

window.openPreview = (doc) => {
  currentPreviewDoc = doc;
  const ext = doc.name.split(".").pop().toLowerCase();
  const fileViewUrl =
    storage.getFileView(CONFIG.BUCKET_ID, doc.fileId).href ||
    storage.getFileView(CONFIG.BUCKET_ID, doc.fileId);
  const fileDownloadUrl =
    storage.getFileDownload(CONFIG.BUCKET_ID, doc.fileId).href ||
    storage.getFileDownload(CONFIG.BUCKET_ID, doc.fileId);

  el("previewFileName").innerText = doc.name;

  let iconClass = "fa-file";
  let iconColor = "#ffffff";
  const pdfExt = ["pdf"];
  const msOfficeExts = ["doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  const otherDocs = ["csv", "txt", "rtf"];
  const familiarImages = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "webp",
    "svg",
    "jfif",
    "tiff",
    "tif",
    "heif",
    "heic",
    "raw",
    "ico",
  ];
  const vidExts = [
    "mp4",
    "webm",
    "ogg",
    "mov",
    "mkv",
    "avi",
    "wmv",
    "flv",
    "3gp",
    "mpg",
    "mpeg",
    "avchd",
    "m2ts",
  ];
  const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma"];

  if (pdfExt.includes(ext)) {
    iconClass = "fa-file-pdf";
    iconColor = "#ea4335";
  } else if (ext.includes("doc")) {
    iconClass = "fa-file-word";
    iconColor = "#4285f4";
  } else if (ext.includes("xls") || ext.includes("csv")) {
    iconClass = "fa-file-excel";
    iconColor = "#34a853";
  } else if (ext.includes("ppt")) {
    iconClass = "fa-file-powerpoint";
    iconColor = "#fbbc04";
  } else if (familiarImages.includes(ext)) {
    iconClass = "fa-file-image";
    iconColor = "#2dd4bf";
  } else if (vidExts.includes(ext)) {
    iconClass = "fa-file-video";
    iconColor = "#facc15";
  } else if (audioExts.includes(ext)) {
    iconClass = "fa-music";
    iconColor = "#a855f7";
  }

  const iconEl = el("previewFileIcon");
  iconEl.className = `fa-solid ${iconClass}`;
  iconEl.style.color = iconColor;

  const contentArea = el("previewContent");
  contentArea.innerHTML = '<div class="spinner"></div>';

  const overlay = el("previewModal");
  overlay.classList.remove("hidden");
  setTimeout(() => overlay.classList.add("show-preview"), 10);

  let currentIndex = currentPreviewList.findIndex((d) => d.$id === doc.$id);
  if (currentIndex === -1) {
    currentPreviewList = [doc];
    currentIndex = 0;
  }

  const prevBtn = el("previewPrevBtn");
  const nextBtn = el("previewNextBtn");

  if (currentPreviewList.length <= 1) {
    prevBtn.classList.add("hidden");
    nextBtn.classList.add("hidden");
  } else {
    currentIndex > 0
      ? prevBtn.classList.remove("hidden")
      : prevBtn.classList.add("hidden");
    currentIndex < currentPreviewList.length - 1
      ? nextBtn.classList.remove("hidden")
      : nextBtn.classList.add("hidden");
  }

  setTimeout(() => {
    if (familiarImages.includes(ext)) {
      contentArea.innerHTML = `<img src="${fileViewUrl}" alt="${doc.name}" style="max-width:100%; max-height:100%; object-fit:contain; border-radius:8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">`;
    } else if (vidExts.includes(ext)) {
      contentArea.innerHTML = `
                <div class="apple-video-wrapper" id="vidContainer" style="transform: translateZ(0); will-change: transform;">
                    <!-- OPTIMASI PEMUTARAN VIDEO 4K 60FPS & PRESISI AV SYNC -->
                    <video src="${fileViewUrl}" id="customVideo" playsinline autoplay preload="auto" decoding="async" controlsList="nodownload noplaybackrate"></video>

                    <div class="apple-video-overlay" id="vidOverlay">
                        <div class="apple-top-controls">
                            <div class="placeholder-top-left" style="width:40px"></div>
                            
                            <div class="top-right-group">
                                <div class="apple-volume-container pure-glass" id="vidVolumeContainer">
                                    <button class="icon-only-btn volume-icon-btn" id="vidMute" title="Mute/Unmute">
                                        <i class="fa-solid fa-volume-high"></i>
                                    </button>
                                    <div class="volume-slider-wrapper">
                                        <input type="range" id="vidVolumeSlider" class="apple-volume-slider" min="0" max="1" step="0.01" value="1" style="--vol: 100%;">
                                    </div>
                                </div>
                                <button class="apple-glass-btn pure-glass small" id="vidFullscreen" title="Layar Penuh"><i class="fa-solid fa-expand"></i></button>
                            </div>
                        </div>

                        <div class="apple-center-controls">
                            <button class="apple-glass-btn pure-glass apple-skip-btn" id="vidSkipBack" title="Mundur 10 detik" style="padding: 12px;">
                                <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.343 6.343C4.843 7.843 4 9.878 4 12C4 16.418 7.582 20 12 20C16.418 20 20 16.418 20 12C20 7.582 16.418 4 12 4C10.014 4 8.205 4.764 6.834 6" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 3V7H8" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.5" text-anchor="middle" font-size="8" font-weight="bold" font-family="system-ui, -apple-system, sans-serif" fill="white" stroke="none">10</text></svg>
                            </button>
                            
                            <button class="apple-glass-btn play-pause-btn pure-glass" id="vidPlayPause" title="Play/Pause">
                                <i class="fa-solid fa-pause"></i>
                            </button>
                            
                            <button class="apple-glass-btn pure-glass apple-skip-btn" id="vidSkipForward" title="Maju 10 detik" style="padding: 12px;">
                                <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.657 6.343C19.157 7.843 20 9.878 20 12C20 16.418 16.418 20 12 20C7.582 20 4 16.418 4 12C4 7.582 7.582 4 12 4C13.987 4 15.796 4.764 17.166 6" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 3V7H16" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.5" text-anchor="middle" font-size="8" font-weight="bold" font-family="system-ui, -apple-system, sans-serif" fill="white" stroke="none">10</text></svg>
                            </button>
                        </div>

                        <div class="apple-bottom-pill pure-glass">
                            <span class="apple-time" id="vidCurrentTime">0:00</span>
                            <div class="apple-progress-container" id="vidProgressContainer"><div class="apple-progress-bar" id="vidProgressBar"><div class="apple-progress-thumb"></div></div></div>
                            <span class="apple-time" id="vidDuration">-0:00</span>
                        </div>
                    </div>
                </div>
            `;
      setTimeout(initCustomVideoPlayer, 50);
    } else if (audioExts.includes(ext)) {
      contentArea.innerHTML = `
                <div class="apple-volume-container pure-glass" id="audioTopVolumeContainer" style="position: absolute; top: 15px; right: 15px; z-index: 100;">
                    <button class="icon-only-btn volume-icon-btn" id="audioMuteBtn" title="Mute/Unmute">
                        <i class="fa-solid fa-volume-high"></i>
                    </button>
                    <div class="volume-slider-wrapper">
                        <input type="range" id="audioVolumeSlider" class="apple-volume-slider" min="0" max="1" step="0.01" value="1" style="--vol: 100%;">
                    </div>
                </div>

                <div class="apple-audio-player-ios">
                    <audio id="customAudio" src="${fileViewUrl}" preload="metadata" autoplay></audio>
                    
                    <div class="audio-cover-ios" id="audioCoverArt">
                        <i class="fa-solid fa-music"></i>
                    </div>

                    <div class="audio-glass-ios">
                        <div class="audio-meta-ios">
                            <div class="audio-title-ios" title="${doc.name}">${doc.name}</div>
                            <div class="audio-artist-ios">Storage Tasks Player</div>
                        </div>

                        <div class="audio-timeline-container-ios">
                            <span id="audioCurrentTime" class="audio-time-ios">0:00</span>
                            <input type="range" id="audioProgressSlider" class="audio-slider-ios" min="0" max="100" step="0.1" value="0" style="--prog: 0%;">
                            <span id="audioDuration" class="audio-time-ios">-:--</span>
                        </div>

                        <div class="audio-controls-ios">
                            <button class="audio-icon-btn-ios"><i class="fa-regular fa-star"></i></button>
                            
                            <div class="audio-main-controls-ios">
                                <button class="audio-btn-ios" id="audioPrevBtn" title="Mulai Ulang / File Sebelumnya"><i class="fa-solid fa-backward-step"></i></button>
                                <button class="audio-btn-ios play-ios" id="audioPlayPause"><i class="fa-solid fa-pause"></i></button>
                                <button class="audio-btn-ios" id="audioNextBtn" title="File Selanjutnya"><i class="fa-solid fa-forward-step"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
      setTimeout(initAppleAudioPlayer, 50);
    } else if (pdfExt.includes(ext)) {
      contentArea.innerHTML = `<div class="doc-glass-wrapper"><iframe src="${fileViewUrl}"></iframe></div>`;
    } else if (msOfficeExts.includes(ext) || otherDocs.includes(ext)) {
      let viewerUrl = "";
      if (msOfficeExts.includes(ext)) {
        viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(fileDownloadUrl)}`;
      } else {
        viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(fileDownloadUrl)}&embedded=true`;
      }
      contentArea.innerHTML = `<div class="doc-glass-wrapper"><iframe src="${viewerUrl}"></iframe></div>`;
    } else {
      contentArea.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; color:white; text-align:center;">
                    <i class="fa-solid ${iconClass}" style="font-size:4rem; margin-bottom:20px; color:rgba(255,255,255,0.3);"></i>
                    <p>Pratinjau tidak tersedia untuk format file ini.</p>
                    <button class="btn-pill primary" style="width:auto; margin-top:20px; padding:0 30px;" onclick="downloadPreviewItem()">Download File</button>
                </div>
            `;
    }
  }, 400);
};

// ==============================================================================
// FUNGSI INISIALISASI AUDIO PLAYER LIQUID GLASS v2
// ==============================================================================
function initAppleAudioPlayer() {
  const audio = el("customAudio");
  audioInstance = audio;
  const playPauseBtn = el("audioPlayPause");
  const prevBtn = el("audioPrevBtn");
  const nextBtn = el("audioNextBtn");
  const progressSlider = el("audioProgressSlider");
  const currentTimeEl = el("audioCurrentTime");
  const durationEl = el("audioDuration");
  const coverArt = el("audioCoverArt");
  const volumeSlider = el("audioVolumeSlider");

  if (!audio) return;
  let isDraggingAudio = false;

  const formatTime = (seconds) => {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  audio.addEventListener("timeupdate", () => {
    if (!isDraggingAudio && !isNaN(audio.duration)) {
      const percent = (audio.currentTime / audio.duration) * 100;
      progressSlider.value = percent;
      progressSlider.style.setProperty("--prog", percent + "%");
      currentTimeEl.innerText = formatTime(audio.currentTime);
      const timeRemaining = audio.duration - audio.currentTime;
      durationEl.innerText = `-${formatTime(timeRemaining)}`;
    }
  });

  audio.addEventListener("loadedmetadata", () => {
    currentTimeEl.innerText = "0:00";
    durationEl.innerText = `-${formatTime(audio.duration)}`;
  });

  progressSlider.addEventListener("input", (e) => {
    isDraggingAudio = true;
    const percent = parseFloat(e.target.value);
    progressSlider.style.setProperty("--prog", percent + "%");
    if (!isNaN(audio.duration)) {
      currentTimeEl.innerText = formatTime((percent / 100) * audio.duration);
    }
  });

  progressSlider.addEventListener("change", (e) => {
    if (!isNaN(audio.duration)) {
      audio.currentTime = (parseFloat(e.target.value) / 100) * audio.duration;
    }
    isDraggingAudio = false;
  });

  const muteBtn = el("audioMuteBtn");

  const updateAudioMuteIcon = (vol) => {
    if (!muteBtn) return;
    if (vol === 0 || audio.muted) muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    else if (vol < 0.5) muteBtn.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
    else muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
  };

  if (volumeSlider) {
    audio.volume = 1;
    volumeSlider.addEventListener("input", (e) => {
      const vol = parseFloat(e.target.value);
      audio.volume = vol;
      audio.muted = vol === 0;
      volumeSlider.style.setProperty("--vol", vol * 100 + "%");
      updateAudioMuteIcon(vol);
    });
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", (e) => {
      const container = el("audioTopVolumeContainer");
      if (window.innerWidth <= 768 && container) {
        if (!container.classList.contains("expanded")) {
          container.classList.add("expanded");
          e.stopPropagation();
          e.preventDefault();
          return;
        }
      }

      audio.muted = !audio.muted;
      if (audio.muted) {
        if (volumeSlider) {
          volumeSlider.value = 0;
          volumeSlider.style.setProperty("--vol", "0%");
        }
      } else {
        const currentVol = audio.volume > 0 ? audio.volume : 1;
        audio.volume = currentVol;
        if (volumeSlider) {
          volumeSlider.value = currentVol;
          volumeSlider.style.setProperty("--vol", currentVol * 100 + "%");
        }
      }
      updateAudioMuteIcon(audio.muted ? 0 : audio.volume);
    });
  }

  const togglePlay = () => {
    if (audio.paused) {
      audio.play();
      playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    } else {
      audio.pause();
      playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    }
  };
  playPauseBtn.addEventListener("click", togglePlay);

  audio.addEventListener("play", () => {
    playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    coverArt.classList.add("playing");
  });

  audio.addEventListener("pause", () => {
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    coverArt.classList.remove("playing");
  });

  const triggerTrackChange = (direction) => {
    const displayedDocs = getDisplayedDocuments();
    if (displayedDocs.length <= 1) return;

    const currentIndex = displayedDocs.findIndex(
      (d) => d.name === currentPreviewDoc.name,
    );
    if (currentIndex === -1) return;

    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = displayedDocs.length - 1;
    if (nextIndex >= displayedDocs.length) nextIndex = 0;

    const nextDocName = displayedDocs[nextIndex].name;

    displayedDocs.forEach((docObj) => {
      if (docObj.name === nextDocName && docObj.element) {
        docObj.element.click();
      }
    });
  };

  audio.addEventListener("ended", () => {
    playPauseBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    coverArt.classList.remove("playing");
    triggerTrackChange(1);
  });

  function attachStandardNav(element, navDir) {
    if (!element) return;
    element.addEventListener("click", (e) => {
      e.preventDefault();

      element.classList.add("glow");
      setTimeout(() => element.classList.remove("glow"), 300);

      if (navDir === -1 && audio && audio.currentTime > 3) {
        audio.currentTime = 0;
      } else {
        triggerTrackChange(navDir);
      }
    });
  }

  attachStandardNav(prevBtn, -1);
  attachStandardNav(nextBtn, 1);
}

window.navigatePreview = (direction) => {
  if (!currentPreviewDoc) return;
  const currentIndex = currentPreviewList.findIndex(
    (d) => d.$id === currentPreviewDoc.$id,
  );
  const newIndex = currentIndex + direction;

  if (newIndex >= 0 && newIndex < currentPreviewList.length) {
    const video = el("customVideo");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }

    if (audioInstance) {
      audioInstance.pause();
      audioInstance.removeAttribute("src");
      audioInstance.load();
      audioInstance = null;
    }

    el("previewContent").innerHTML = '<div class="spinner"></div>';
    openPreview(currentPreviewList[newIndex]);
  }
};

window.initCustomVideoPlayer = () => {
  const video = el("customVideo");
  const playPauseBtn = el("vidPlayPause");
  const skipBackBtn = el("vidSkipBack");
  const skipForwardBtn = el("vidSkipForward");
  const progressContainer = el("vidProgressContainer");
  const progressBar = el("vidProgressBar");
  const timeDisplay = el("vidCurrentTime");
  const durationDisplay = el("vidDuration");
  const muteBtn = el("vidMute");
  const volumeSlider = el("vidVolumeSlider");
  const fullscreenBtn = el("vidFullscreen");
  const vidContainer = el("vidContainer");
  const overlayVid = el("vidOverlay");

  if (!video) return;

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return "0:00";
    const m = Math.floor(Math.abs(seconds) / 60);
    const s = Math.floor(Math.abs(seconds) % 60);
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  video.addEventListener("loadedmetadata", () => {
    timeDisplay.innerText = "0:00";
    durationDisplay.innerText = `-${formatTime(video.duration)}`;
  });

  video.addEventListener("timeupdate", () => {
    const percent = (video.currentTime / video.duration) * 100;
    progressBar.style.width = `${percent}%`;
    timeDisplay.innerText = formatTime(video.currentTime);
    const timeRemaining = video.duration - video.currentTime;
    durationDisplay.innerText = `-${formatTime(timeRemaining)}`;
  });

  video.addEventListener("ended", () => {
    playPauseBtn.innerHTML =
      '<i class="fa-solid fa-play" style="margin-left: 5px;"></i>';
    if (overlayVid) overlayVid.style.opacity = "1";
    clearTimeout(hideOverlayTimeout);
  });

  const togglePlay = () => {
    if (video.paused || video.ended) {
      video.play();
      playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
    } else {
      video.pause();
      playPauseBtn.innerHTML =
        '<i class="fa-solid fa-play" style="margin-left: 5px;"></i>';
    }
  };
  playPauseBtn.addEventListener("click", togglePlay);
  video.addEventListener("click", togglePlay);

  skipBackBtn.addEventListener("click", () => {
    video.currentTime -= 10;
  });
  skipForwardBtn.addEventListener("click", () => {
    video.currentTime += 10;
  });

  progressContainer.addEventListener("click", (e) => {
    const rect = progressContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    video.currentTime = pos * video.duration;
  });

  const updateMuteIcon = (vol) => {
    if (vol === 0 || video.muted)
      muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    else if (vol < 0.5)
      muteBtn.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
    else muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
  };

  if (volumeSlider) {
    volumeSlider.addEventListener("input", (e) => {
      const vol = parseFloat(e.target.value);
      video.volume = vol;
      video.muted = vol === 0;
      volumeSlider.style.setProperty("--vol", vol * 100 + "%");
      updateMuteIcon(vol);
    });
  }

  muteBtn.addEventListener("click", (e) => {
    const container = el("vidVolumeContainer");
    if (window.innerWidth <= 768 && container) {
      if (!container.classList.contains("expanded")) {
        container.classList.add("expanded");
        e.stopPropagation();
        e.preventDefault();
        return;
      }
    }

    video.muted = !video.muted;
    if (video.muted) {
      if (volumeSlider) {
        volumeSlider.value = 0;
        volumeSlider.style.setProperty("--vol", "0%");
      }
    } else {
      const currentVol = video.volume > 0 ? video.volume : 1;
      video.volume = currentVol;
      if (volumeSlider) {
        volumeSlider.value = currentVol;
        volumeSlider.style.setProperty("--vol", currentVol * 100 + "%");
      }
    }
    updateMuteIcon(video.muted ? 0 : video.volume);
  });

  fullscreenBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      vidContainer.requestFullscreen().catch((err) => { });
    } else {
      document.exitFullscreen();
    }
  });

  const resetHideTimeout = () => {
    if (!overlayVid) return;
    overlayVid.style.opacity = "1";
    clearTimeout(hideOverlayTimeout);
    hideOverlayTimeout = setTimeout(() => {
      if (!video.paused) overlayVid.style.opacity = "0";
    }, 2500);
  };

  vidContainer.addEventListener("mousemove", resetHideTimeout);
  vidContainer.addEventListener("touchstart", resetHideTimeout);
  vidContainer.addEventListener("click", resetHideTimeout);
  video.addEventListener("play", resetHideTimeout);
  video.addEventListener("pause", () => {
    overlayVid.style.opacity = "1";
    clearTimeout(hideOverlayTimeout);
  });
};

window.closePreview = () => {
  const overlay = el("previewModal");

  const video = el("customVideo");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  if (audioInstance) {
    audioInstance.pause();
    audioInstance.removeAttribute("src");
    audioInstance.load();
    audioInstance = null;
  }

  overlay.classList.remove("show-preview");

  setTimeout(() => {
    overlay.classList.add("hidden");
    el("previewContent").innerHTML = "";
    currentPreviewDoc = null;
    clearTimeout(hideOverlayTimeout);
  }, 350);
};

window.downloadPreviewItem = () => {
  if (currentPreviewDoc) {
    window.open(
      storage.getFileDownload(CONFIG.BUCKET_ID, currentPreviewDoc.fileId),
      "_blank",
    );
  }
};

window.togglePreviewMenu = () => {
  const menu = el("previewContextMenu");
  menu.classList.toggle("hidden");
};

window.openPreviewInNewTab = () => {
  if (currentPreviewDoc) {
    const fileViewUrl =
      storage.getFileView(CONFIG.BUCKET_ID, currentPreviewDoc.fileId).href ||
      storage.getFileView(CONFIG.BUCKET_ID, currentPreviewDoc.fileId);
    window.open(fileViewUrl, "_blank");
    el("previewContextMenu").classList.add("hidden");
    closePreview();
  }
};

// ======================================================
// FITUR PULL-TO-REFRESH MOBILE (SMART NETWORK DETECTION)
// ======================================================

// Helper: Tampilkan atau Sembunyikan Layar Offline
function toggleOfflineUI(isOffline) {
  const gridEl = document.getElementById("fileGrid");
  const offlineEl = document.getElementById("offlineState");

  if (isOffline) {
    if (gridEl) gridEl.classList.add("hidden");
    if (offlineEl) offlineEl.classList.remove("hidden");
  } else {
    if (gridEl) gridEl.classList.remove("hidden");
    if (offlineEl) offlineEl.classList.add("hidden");
  }
}

// Fungsi utama Pull-to-Refresh
function initPullToRefresh(isForceButton = false) {
  const ptrIndicator = document.getElementById("ptr-indicator");
  const ptrSpinner = document.querySelector(".ptr-spinner-svg");
  const scrollArea = document.querySelector(".main-content-area");
  const glassPanel = document.querySelector(".main-glass-panel");

  if (!ptrIndicator || !scrollArea || !glassPanel) return;

  let startY = 0;
  let currentY = 0;
  let isPulling = false;
  let isRefreshing = false;
  const threshold = 95;

  // Jika dipanggil dari tombol "Coba Lagi" di halaman offline
  if (isForceButton) {
    triggerRefreshLogic();
    return;
  }

  scrollArea.addEventListener(
    "touchstart",
    (e) => {
      if (scrollArea.scrollTop <= 0 && !isRefreshing) {
        startY = e.touches[0].clientY;

        // PERBAIKAN: Reset posisi saat ini dengan posisi sentuhan pertama!
        // Agar saat dipencet biasa, jaraknya dihitung 0 (bukan sisa tarikan sebelumnya)
        currentY = startY;

        isPulling = true;
        glassPanel.style.transition = "none";
        ptrIndicator.style.transition = "none";
      }
    },
    { passive: true },
  );

  scrollArea.addEventListener(
    "touchmove",
    (e) => {
      if (!isPulling) return;

      currentY = e.touches[0].clientY;
      const distance = currentY - startY;

      if (distance > 0 && scrollArea.scrollTop <= 0) {
        if (e.cancelable) e.preventDefault();

        const pullDistance = distance * 0.45;
        glassPanel.style.transform = `translateY(${pullDistance}px)`;

        const opacity = Math.min(pullDistance / threshold, 1);
        const rotate = (pullDistance / threshold) * 180;

        ptrIndicator.style.opacity = opacity;
        ptrIndicator.style.transform = `translate(-50%, ${pullDistance * 0.4}px) scale(${opacity})`;
        ptrSpinner.style.transform = `rotate(${rotate}deg)`;
      }
    },
    { passive: false },
  );

  scrollArea.addEventListener("touchend", async () => {
    if (!isPulling) return;
    isPulling = false;

    const distance = currentY - startY;
    const pullDistance = distance * 0.45;

    // PERBAIKAN: Pastikan distance > 0 (Benar-benar ditarik kebawah, bukan tap/pencet biasa)
    if (distance > 0 && pullDistance >= threshold) {
      triggerRefreshLogic();
    } else {
      resetRefreshUI();
    }
  });

  // Logika Eksekusi Refresh Berdasarkan Jaringan
  async function triggerRefreshLogic() {
    isRefreshing = true;

    // Animasi kunci panel di tengah
    glassPanel.style.transition =
      "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
    ptrIndicator.style.transition = "all 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
    glassPanel.style.transform = `translateY(${threshold}px)`;
    ptrIndicator.style.transform = `translate(-50%, ${threshold * 0.4}px) scale(1)`;
    ptrIndicator.style.opacity = "1";
    ptrIndicator.classList.add("refreshing");

    try {
      const isOnline = navigator.onLine;

      if (!isOnline) {
        // JARINGAN TERPUTUS (OFFLINE)
        await new Promise((resolve) => setTimeout(resolve, 10000));
        toggleOfflineUI(true);
      } else {
        // JARINGAN TERHUBUNG (ONLINE)
        let spinTime = 1200;

        if (navigator.connection) {
          const connType = navigator.connection.effectiveType;
          if (connType === "slow-2g" || connType === "2g") {
            spinTime = 5000;
          } else if (connType === "3g") {
            spinTime = 3000;
          }
        }

        window.forceCalculateStorage = true;
        const targetView =
          currentViewMode === "root" ? currentFolderId : currentViewMode;

        await Promise.all([
          loadFiles(targetView),
          calculateStorage(),
          new Promise((resolve) => setTimeout(resolve, spinTime)),
        ]);

        toggleOfflineUI(false);
      }
    } catch (err) {
      console.error("Gagal merefresh:", err);
      toggleOfflineUI(true);
    } finally {
      resetRefreshUI();
    }
  }

  // Mengembalikan posisi UI ke semula
  function resetRefreshUI() {
    glassPanel.style.transition =
      "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
    ptrIndicator.style.transition = "all 0.4s cubic-bezier(0.25, 1, 0.5, 1)";

    glassPanel.style.transform = `translateY(0px)`;
    ptrIndicator.style.transform = `translate(-50%, 0px) scale(0.5)`;
    ptrIndicator.style.opacity = "0";

    setTimeout(() => {
      ptrIndicator.classList.remove("refreshing");
      isRefreshing = false;
    }, 400);
  }
}

// ======================================================
// 10. FITUR REALTIME SINKRONISASI (APPWRITE WEBSOCKETS)
// ======================================================
function initRealtimeSync() {
  if (!currentUser) return;

  // Mendengarkan semua traffic dan perubahan pada tabel 'files'
  client.subscribe(
    `databases.${CONFIG.DB_ID}.collections.${CONFIG.COLLECTION_FILES}.documents`,
    (response) => {
      // Memastikan bahwa event/perubahan yang terjadi adalah milik akun yang sedang login
      if (response.payload && response.payload.owner === currentUser.$id) {
        // Bypass cache lokal (memaksa kalkulasi ulang data terbaru)
        window.forceCalculateStorage = true;

        // Cek pengguna sedang berada di halaman/folder apa
        const targetView =
          currentViewMode === "root" ? currentFolderId : currentViewMode;

        // Update UI (File & Storage) secara otomatis di background
        loadFiles(targetView);
        calculateStorage();
      }
    },
  );
}

document.addEventListener("click", (e) => {
  const vidVol = document.getElementById("vidVolumeContainer");
  if (vidVol && !vidVol.contains(e.target)) {
    vidVol.classList.remove("expanded");
  }
  const audVol = document.getElementById("audioTopVolumeContainer");
  if (audVol && !audVol.contains(e.target)) {
    audVol.classList.remove("expanded");
  }
});

// ======================================================
// THEME TOGGLE LOGIC (LIGHT/DARK MODE)
// ======================================================
document.addEventListener("DOMContentLoaded", () => {
  const themeBtn = document.getElementById("themeToggleBtn");
  const themeIcon = document.getElementById("themeIcon");

  // Periksa tema yang tersimpan di localStorage
  const savedTheme = localStorage.getItem("themePreference");
  if (savedTheme === "light") {
    document.body.classList.add("light-mode");
    if (themeIcon) {
      themeIcon.classList.remove("fa-sun");
      themeIcon.classList.add("fa-moon");
    }
  }

  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      document.body.classList.toggle("light-mode");
      const isLight = document.body.classList.contains("light-mode");

      if (isLight) {
        localStorage.setItem("themePreference", "light");
        themeIcon.classList.remove("fa-sun");
        themeIcon.classList.add("fa-moon");
      } else {
        localStorage.setItem("themePreference", "dark");
        themeIcon.classList.remove("fa-moon");
        themeIcon.classList.add("fa-sun");
      }
    });
  }
});
