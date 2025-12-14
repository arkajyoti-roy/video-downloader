const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(express.static('public'));

const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
const downloadFolder = path.join(__dirname, 'video_downloads');

if (!fs.existsSync(downloadFolder)){
    fs.mkdirSync(downloadFolder);
}

// 1. GET VIDEO INFO
app.post('/get-video', (req, res) => {
    const { url } = req.body;
    if (!fs.existsSync(ytDlpPath)) return res.status(500).json({ error: "yt-dlp.exe missing!" });

    // We already had --no-playlist here, which is why the preview showed only one title
    const ytDlp = spawn(ytDlpPath, ['--dump-json', '--no-playlist', url]);
    
    let output = '';
    ytDlp.stdout.on('data', (data) => output += data.toString());
    
    ytDlp.on('close', (code) => {
        if (code !== 0) return res.status(500).json({ error: "Could not fetch video info." });
        try {
            const videoData = JSON.parse(output);
            const formats = videoData.formats || [];
            const availableQualities = new Set();
            formats.forEach(f => {
                if (f.height && f.ext === 'mp4') availableQualities.add(f.height);
            });
            const sortedQualities = Array.from(availableQualities).sort((a, b) => b - a);

            res.json({
                title: videoData.title,
                streamUrl: videoData.url,
                qualities: sortedQualities
            });
        } catch (e) {
            res.status(500).json({ error: "Error parsing data." });
        }
    });
});

function getFormatArgs(quality) {
    return quality 
        ? `best[height<=${quality}][ext=mp4]/best[height<=${quality}]`
        : 'best[ext=mp4]';
}

// OPTION A: DOWNLOAD TO SERVER FOLDER
app.post('/download-to-server', (req, res) => {
    const { url, quality } = req.body;
    console.log(`[Server Download] Starting: ${url}`);

    const args = [
        '--no-playlist', // <--- FIXED: Added this to stop downloading the whole list
        '-P', downloadFolder, 
        '-f', getFormatArgs(quality),
        url
    ];

    const ytDlp = spawn(ytDlpPath, args);

    ytDlp.stdout.on('data', (data) => console.log(`[Progress]: ${data}`));
    
    ytDlp.on('close', (code) => {
        if (code === 0) {
            res.json({ success: true, message: `Saved to ${downloadFolder}` });
        } else {
            res.status(500).json({ success: false, message: "Download failed." });
        }
    });
});

// OPTION B: DOWNLOAD TO BROWSER (STREAM)
app.post('/download-to-browser', (req, res) => {
    const { url, quality, title } = req.body;
    console.log(`[Browser Stream] Starting: ${title}`);

    const safeTitle = (title || 'video').replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
    const filename = `${safeTitle}.mp4`;

    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', 'video/mp4');

    const args = [
        '--no-playlist', // <--- FIXED: Added this here too
        '-f', getFormatArgs(quality),
        '-o', '-', 
        url
    ];

    const ytDlp = spawn(ytDlpPath, args);
    ytDlp.stdout.pipe(res);
    ytDlp.on('close', () => res.end());
});

app.listen(3000, () => console.log('Server running at http://localhost:3000'));