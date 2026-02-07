const client = new Appwrite.Client();
const account = new Appwrite.Account(client);
const databases = new Appwrite.Databases(client);
const storage = new Appwrite.Storage(client);

const CONFIG = {
    ENDPOINT: 'https://sgp.cloud.appwrite.io/v1',
    PROJECT_ID: '697f71b40034438bb559', 
    DB_ID: 'storagedb',
    COLLECTION_FILES: 'files',   
    COLLECTION_USERS: 'users',   
    BUCKET_ID: 'taskfiles'
};

client.setEndpoint(CONFIG.ENDPOINT).setProject(CONFIG.PROJECT_ID);

let currentUser = null;
let currentFolderId = 'root';
let currentFolderName = "Drive";

const el = (id) => document.getElementById(id);

// === LOAD & RENDER FILES (PERBAIKAN FOLDER HILANG) ===
async function loadFiles(folderId) {
    if (!currentUser) return;
    const grid = el('fileGrid'); 
    grid.innerHTML = ''; 
    const header = el('headerTitle');

    if(folderId === 'root') {
        updateGreeting(); 
    } else {
        header.innerHTML = `<button onclick="loadFiles('root')" class="btn-pill small" style="background:rgba(255,255,255,0.2); width:auto; padding:0 10px; margin-right:15px; display:inline-flex;"><i class="fa-solid fa-arrow-left"></i> Kembali</button> ${currentFolderName}`;
    }

    try {
        const res = await databases.listDocuments(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, [
            Appwrite.Query.equal('owner', currentUser.$id),
            Appwrite.Query.equal('parentId', folderId)
        ]);
        
        if(res.documents.length === 0) {
            grid.innerHTML = `<p style="color:rgba(255,255,255,0.4); text-align:center; grid-column: 1/-1; margin-top:50px;">Folder ini kosong</p>`;
        } else {
            res.documents.forEach(doc => renderItem(doc));
        }
    } catch (e) { console.error(e); }
}

function renderItem(doc) {
    const grid = el('fileGrid');
    const div = document.createElement('div');
    const isFolder = doc.type === 'folder';
    
    // FIX: Gunakan 'name' karena ini nama atribut di database Anda
    const fileName = doc.name || doc.nama || "Item"; 
    
    let content = '';
    if (isFolder) {
        content = `<i class="icon fa-solid fa-folder"></i>`;
    } else if (fileName.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/)) {
        const url = storage.getFilePreview(CONFIG.BUCKET_ID, doc.fileId);
        content = `<div class="thumb-box"><img src="${url}" class="thumb-img"></div>`;
    } else {
        content = `<i class="icon fa-solid fa-file-lines" style="color:#60a5fa"></i>`;
    }

    const action = isFolder ? `openFolder('${doc.$id}', '${fileName}')` : `window.open('${doc.url}', '_blank')`;
    div.className = 'item-card';
    div.innerHTML = `
        <button class="del-btn" onclick="deleteItem('${doc.$id}','${doc.type}','${doc.fileId}')"><i class="fa-solid fa-xmark"></i></button>
        <div onclick="${action}" style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            ${content}
            <div class="item-name">${fileName}</div>
        </div>`;
    grid.appendChild(div);
}

// === FOLDER ACTIONS ===
window.openFolder = (id, nama) => { currentFolderId = id; currentFolderName = nama; loadFiles(id); };

window.submitCreateFolder = async () => {
    const n = el('newFolderName').value.trim(); if(!n) return;
    closeModal('folderModal'); el('loading').classList.remove('hidden');
    try {
        await databases.createDocument(CONFIG.DB_ID, CONFIG.COLLECTION_FILES, Appwrite.ID.unique(), {
            name: n, type: 'folder', parentId: currentFolderId, owner: currentUser.$id, size: 0
        });
        loadFiles(currentFolderId);
    } catch (e) { alert(e.message); } finally { el('loading').classList.add('hidden'); }
};

// === INITIALIZATION ===
async function checkSession() {
    try {
        currentUser = await account.get();
        nav('dashboardPage'); updateGreeting(); loadFiles('root');
    } catch (e) { nav('loginPage'); }
}
document.addEventListener('DOMContentLoaded', checkSession);

// (Login, Signup, Modal utils tetap sama seperti sebelumnya...)
window.nav = (p) => { document.querySelectorAll('section').forEach(s => s.classList.add('hidden')); el(p).classList.remove('hidden'); };
window.closeModal = (m) => el(m).classList.add('hidden');
window.toggleDropdown = () => el('dropdownMenu').classList.toggle('show');
function updateGreeting() { const h = new Date().getHours(); let s = "Morning"; if(h>=12) s="Afternoon"; if(h>=18) s="Night"; el('headerTitle').innerText = `Welcome In Drive ${s}`; }