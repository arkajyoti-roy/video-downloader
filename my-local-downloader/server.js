const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true })); 
app.use(express.static('public'));

const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
const ffmpegPath = path.join(__dirname, 'ffmpeg.exe'); // Path to FFmpeg
const downloadFolder = path.join(__dirname, 'video_downloads');

if (!fs.existsSync(downloadFolder)) fs.mkdirSync(downloadFolder);

// Helper to mimic a real browser (Helps with generic sites that block bots)
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 1. GET VIDEO INFO
app.post('/get-video', (req, res) => {
    const { url } = req.body;
    if (!fs.existsSync(ytDlpPath)) return res.status(500).json({ error: "yt-dlp.exe missing!" });

    // Added --user-agent to fool generic sites
    const ytDlp = spawn(ytDlpPath, ['--dump-json', '--no-playlist', '--user-agent', USER_AGENT, url]);
    
    let output = '';
    ytDlp.stdout.on('data', (data) => output += data.toString());
    
    ytDlp.on('close', (code) => {
        if (code !== 0) return res.status(500).json({ error: "Could not find video on this page." });
        try {
            const videoData = JSON.parse(output);
            
            // Generic sites might not list "formats" clearly, so we simplify.
            // We just grab heights if available, or default to "Best"
            const formats = videoData.formats || [];
            const availableQualities = new Set();
            formats.forEach(f => {
                if (f.height) availableQualities.add(f.height);
            });
            const sortedQualities = Array.from(availableQualities).sort((a, b) => b - a);

            res.json({
                title: videoData.title || "Unknown Video", // Generic sites sometimes lack titles
                streamUrl: videoData.url,
                qualities: sortedQualities
            });
        } catch (e) {
            res.status(500).json({ error: "Error parsing video data." });
        }
    });
});

// OPTION A: DOWNLOAD TO SERVER (Powerful mode with FFmpeg)
app.post('/download-to-server', (req, res) => {
    const { url, quality } = req.body;
    console.log(`[Server Download] Starting: ${url}`);

    // If ffmpeg is missing, warn the user
    if (!fs.existsSync(ffmpegPath)) {
        console.log("WARNING: ffmpeg.exe not found! Generic sites might fail.");
    }

    const args = [
        '--no-playlist',
        '--user-agent', USER_AGENT, // Fake browser
        '-P', downloadFolder,
        '--ffmpeg-location', __dirname, // Tell yt-dlp where ffmpeg is
    ];

    // QUALITY LOGIC CHANGED:
    // Instead of forcing "best[ext=mp4]" (which fails if site is m3u8),
    // We request "best" and then use --recode-video to force conversion to mp4.
    if (quality) {
        args.push('-f', `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`);
    }
    
    // Force output to always be MP4 (Requires FFmpeg)
    args.push('--recode-video', 'mp4');
    
    args.push(url);

    const ytDlp = spawn(ytDlpPath, args);

    ytDlp.stdout.on('data', (data) => console.log(`${data}`));
    ytDlp.stderr.on('data', (data) => console.log(`[Log]: ${data}`)); // View errors
    
    ytDlp.on('close', (code) => {
        if (code === 0) {
            res.json({ success: true, message: `Saved to folder!` });
        } else {
            res.status(500).json({ success: false, message: "Download failed. Do you have ffmpeg.exe?" });
        }
    });
});

// OPTION B: DOWNLOAD TO BROWSER (Stream)
app.post('/download-to-browser', (req, res) => {
    const { url, quality, title } = req.body;
    const safeTitle = (title || 'video').replace(/[^a-zA-Z0-9 \-_]/g, '').trim();
    const filename = `${safeTitle}.mp4`;

    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', 'video/mp4');

    const args = [
        '--no-playlist',
        '--user-agent', USER_AGENT,
        '--ffmpeg-location', __dirname,
        '-f', quality ? `best[height<=${quality}]` : 'best',
        // Note: We cannot easily "recode" to mp4 while streaming to browser.
        // So for browser downloads, we just hope the site provides a streamable format.
        // If the site is strictly m3u8, browser download might still send a .ts file or fail.
        '-o', '-', 
        url
    ];

    const ytDlp = spawn(ytDlpPath, args);
    ytDlp.stdout.pipe(res);
    ytDlp.stderr.on('data', (data) => console.log(`[Stream Log]: ${data}`));
    ytDlp.on('close', () => res.end());
});

app.listen(3000, () => console.log('Server running at http://localhost:3000'));