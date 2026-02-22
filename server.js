const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { fromPath } = require('pdf2pic');
const libre = require('libreoffice-convert');
const { promisify } = require('util');
const os = require('os');

const libreConvert = promisify(libre.convert);
const app = express();

// Mengizinkan domain web Vercel Anda mengambil gambar dari backend ini
app.use(cors({ origin: '*' }));

app.get('/api/thumbnail', async (req, res) => {
    const { url, ext } = req.query;
    if (!url || !ext) return res.status(400).send('URL dan Ekstensi wajib diisi');

    const tempId = Date.now() + Math.floor(Math.random() * 1000);
    const tempPdfPath = path.join(os.tmpdir(), `pdf_${tempId}.pdf`);

    try {
        // 1. Download file mentah dari Appwrite
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        let fileBuffer = Buffer.from(response.data);
        
        // 2. Jika format Word/Excel/PPT, ubah menjadi PDF menggunakan LibreOffice
        const officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'];
        if (officeExts.includes(ext.toLowerCase())) {
            fileBuffer = await libreConvert(fileBuffer, '.pdf', undefined);
        }

        // 3. Simpan PDF sementara di memori server
        await fs.writeFile(tempPdfPath, fileBuffer);

        // 4. Ubah halaman pertama PDF menjadi gambar JPG resolusi tinggi
        const options = {
            density: 150, // Kualitas ketajaman teks
            saveFilename: `thumb_${tempId}`,
            savePath: os.tmpdir(),
            format: "jpg",
            width: 600,
            height: 600
        };

        const storeAsImage = fromPath(tempPdfPath, options);
        const result = await storeAsImage(1); // Angka 1 = Rendering Halaman Pertama
        
        const imageBuffer = await fs.readFile(result.path);

        // 5. Bersihkan file sampah agar server tidak jebol/penuh
        fs.unlink(tempPdfPath).catch(()=>{});
        fs.unlink(result.path).catch(()=>{});

        // 6. Kirim gambar langsung ke web browser Anda
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Meminta browser menyimpan cache selama 24 Jam
        res.send(imageBuffer);

    } catch (error) {
        console.error("Kesalahan Server Backend:", error);
        res.status(500).send('Gagal memproses thumbnail');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend API Thumbnail menyala di port ${PORT}`));