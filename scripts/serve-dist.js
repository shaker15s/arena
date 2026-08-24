#!/usr/bin/env node
// scripts/serve-dist.js — سيرفر ثابت بصفر اعتماديات لمعاينة dist/ (SPA fallback)
// الاستخدام: node scripts/serve-dist.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 8081);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

if (!fs.existsSync(ROOT)) {
  console.error('✗ dist/ غير موجود — شغّل أولًا: npm run export:web');
  process.exit(1);
}

http
  .createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400).end(); // URI مشوّه — كان يُسقط السيرفر بالكامل
      return;
    }
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    let filePath = path.resolve(ROOT, '.' + path.posix.normalize('/' + urlPath));
    // فحص traversal صحيح: المقارنة بحدود مجلد (ROOT + فاصل) وليس prefix خام
    // — `startsWith(ROOT)` وحدها كانت تسمح بمسار شقيق مثل `${ROOT}-evil`.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA: أي مسار مجهول يرجع index.html
      filePath = path.join(ROOT, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const immutable = urlPath.startsWith('/_expo/') || urlPath.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    });
    stream.pipe(res);
  })
  .listen(PORT, '0.0.0.0', () => console.log(`✓ مسار (production) على http://0.0.0.0:${PORT}`));
