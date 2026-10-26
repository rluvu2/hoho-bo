#!/usr/bin/env node
/*
 * 로컬 정적 서버 (Node 내장 기능만) — github.io 와 같은 상대 경로로 확인
 *
 *   node scripts/serve.js                 → http://localhost:8080/?mock=1
 *   node scripts/serve.js 9000 --base=/hoho-bo
 *       → http://localhost:9000/hoho-bo/?mock=1 (프로젝트 사이트처럼 하위 경로에서)
 *
 * 127.0.0.1 에서만 열린다. backend/preview/input.html (P2 미리보기)도 같이 보인다.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function start(port, base) {
  base = (base || '').replace(/\/+$/, '');
  const server = http.createServer((req, res) => {
    let p;
    try {
      p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch (e) {
      res.writeHead(400);
      return res.end('bad request');
    }
    if (base) {
      if (p === base) {
        res.writeHead(301, { Location: base + '/' });
        return res.end();
      }
      if (!p.startsWith(base + '/')) {
        res.writeHead(404);
        return res.end('not found (base ' + base + ')');
      }
      p = p.slice(base.length);
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end('forbidden');
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { start };

if (require.main === module) {
  const portArg = process.argv.find((a) => /^\d+$/.test(a));
  const baseArg = (process.argv.find((a) => a.startsWith('--base=')) || '').slice(7);
  const port = Number(portArg || process.env.PORT || 8080);
  start(port, baseArg).then(() => {
    const b = baseArg.replace(/\/+$/, '');
    console.log('github.io 화면(목업): http://localhost:' + port + b + '/?mock=1');
    console.log('P2 미리보기:          http://localhost:' + port + b + '/backend/preview/input.html (먼저 node scripts/preview-input.js)');
    console.log('끝내려면 Ctrl+C');
  });
}
