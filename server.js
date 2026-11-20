const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, 'public');
const PORT = process.env.PORT || 10000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http
  .createServer((req, res) => {
    const head = req.method === 'HEAD';
    let pathname = '/';
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Bad request');
    }

    if (pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(head ? undefined : 'ok');
    }

    let rel = pathname.replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Forbidden');
    }

    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(head ? undefined : 'Not found');
      }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(head ? undefined : data);
    });
  })
  .listen(PORT, '0.0.0.0', () => console.log('listening on 0.0.0.0:' + PORT));
