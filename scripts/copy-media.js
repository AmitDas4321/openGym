import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();
const srcMedia = path.join(rootDir, 'media');
const distMedia = path.join(rootDir, 'dist', 'media');
const distImg = path.join(rootDir, 'dist', 'img');
const distGif = path.join(rootDir, 'dist', 'gif');

function copyFolderSync(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  const entries = fs.readdirSync(from, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyFolderSync(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. If media/ exists at root, copy it to dist/media
if (fs.existsSync(srcMedia)) {
  console.log('[Build] Copying media folder into dist...');
  copyFolderSync(srcMedia, distMedia);

  // If media/img exists, also mirror to dist/img for direct static asset serving
  const srcImg = path.join(srcMedia, 'img');
  if (fs.existsSync(srcImg)) {
    copyFolderSync(srcImg, distImg);
  }

  // If media/gif exists, also mirror to dist/gif
  const srcGif = path.join(srcMedia, 'gif');
  if (fs.existsSync(srcGif)) {
    copyFolderSync(srcGif, distGif);
  }
  console.log('[Build] Media assets successfully copied to dist.');
}
