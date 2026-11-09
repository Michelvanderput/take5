'use strict';
// Lokale server: statische bestanden + dezelfde API met geheugenopslag (of Redis als env gezet is).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { handle } = require('./api');
const { defaultStore } = require('./store');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const store = defaultStore();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/game' && req.method === 'POST') {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 4096) req.destroy(); });
    req.on('end', async () => {
      let body = null;
      try { body = JSON.parse(data); } catch {}
      const { status, json } = await handle(store, body);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(json));
    });
    return;
  }
  const full = path.normalize(path.join(PUBLIC, url.pathname === '/' ? '/index.html' : url.pathname));
  if (!full.startsWith(PUBLIC)) return res.writeHead(403).end();
  fs.readFile(full, (err, d) => {
    if (err) return res.writeHead(404).end('Niet gevonden');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(d);
  });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`Take 5! op http://localhost:${port}`));
}
module.exports = { server };
