const fs = require('fs');
const path = require('path');

const authDir = path.join(__dirname, '.wwebjs_auth');
const cacheDir = path.join(__dirname, '.wwebjs_cache');

console.log('Cleaning up corrupted WhatsApp sessions...');

try {
    if (fs.existsSync(authDir)) {
        fs.rmSync(authDir, { recursive: true, force: true });
        console.log('Deleted .wwebjs_auth');
    }
} catch (e) {
    console.error('Failed to delete .wwebjs_auth (it might still be locked, try closing any lingering Node or Chromium processes)', e.message);
}

try {
    if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
        console.log('Deleted .wwebjs_cache');
    }
} catch (e) {
    console.error('Failed to delete .wwebjs_cache', e.message);
}

console.log('Cleanup complete! You can now run `node index.js`.');
