#!/usr/bin/env node
/*
 * 원본 → Apps Script 복사본 만들기 (Node 내장 기능만 사용)
 *
 *   node scripts/sync.js          복사본을 다시 만든다
 *   node scripts/sync.js --check  복사본이 원본과 같은지만 확인 (다르면 exit 1)
 *
 * assets/js/format-core.js     → backend/admin-gas/FormatCore.gs, backend/input-gas/FormatCore.gs,
 *                                backend/input-gas/FormatCoreJs.html (<script> 로 감쌈)
 * assets/js/schema-defaults.js → backend/admin-gas/SchemaDefaults.gs
 * backend/shared/*.js          → backend/admin-gas/*.gs, backend/input-gas/*.gs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function header(src) {
  return '// ⚠ 자동 생성 파일 — 여기서 고치지 마세요.\n' +
    '// 원본: ' + src + ' → node scripts/sync.js 로 다시 만듭니다.\n';
}

function targets() {
  const list = [];
  const fc = 'assets/js/format-core.js';
  list.push({ src: fc, dest: 'backend/admin-gas/FormatCore.gs', kind: 'gs' });
  list.push({ src: fc, dest: 'backend/input-gas/FormatCore.gs', kind: 'gs' });
  list.push({ src: fc, dest: 'backend/input-gas/FormatCoreJs.html', kind: 'html' });
  list.push({ src: 'assets/js/schema-defaults.js', dest: 'backend/admin-gas/SchemaDefaults.gs', kind: 'gs' });
  const sharedDir = path.join(ROOT, 'backend', 'shared');
  if (fs.existsSync(sharedDir)) {
    fs.readdirSync(sharedDir).filter((f) => f.endsWith('.js')).sort().forEach((f) => {
      const gs = f.replace(/\.js$/, '.gs');
      list.push({ src: 'backend/shared/' + f, dest: 'backend/admin-gas/' + gs, kind: 'gs' });
      list.push({ src: 'backend/shared/' + f, dest: 'backend/input-gas/' + gs, kind: 'gs' });
    });
  }
  return list;
}

function render(t) {
  const body = fs.readFileSync(path.join(ROOT, t.src), 'utf8').replace(/\r\n/g, '\n');
  if (t.kind === 'html') {
    if (/<\/script/i.test(body)) throw new Error(t.src + ' 안에 </script 가 있어 HTML 로 감쌀 수 없어요');
    return '<script>\n' + header(t.src) + body + '</script>\n';
  }
  return header(t.src) + body;
}

/** 원본과 다른 복사본 목록 (없으면 빈 배열) */
function stale() {
  return targets().filter((t) => {
    const dest = path.join(ROOT, t.dest);
    return !fs.existsSync(dest) || fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n') !== render(t);
  }).map((t) => t.dest + ' ← ' + t.src);
}

function write() {
  const done = [];
  targets().forEach((t) => {
    const dest = path.join(ROOT, t.dest);
    if (!fs.existsSync(path.dirname(dest))) return;
    fs.writeFileSync(dest, render(t), 'utf8');
    done.push(t.dest);
  });
  return done;
}

module.exports = { targets, render, stale, write };

if (require.main === module) {
  if (!fs.existsSync(path.join(ROOT, 'backend'))) {
    console.log('backend/ 폴더가 없어 복사할 곳이 없어요.');
    process.exit(0);
  }
  if (process.argv.includes('--check')) {
    const s = stale();
    if (s.length) {
      console.error('원본과 다른 복사본이 있어요 (node scripts/sync.js 를 실행하세요):\n  ' + s.join('\n  '));
      process.exit(1);
    }
    console.log('복사본이 모두 원본과 같아요.');
  } else {
    write().forEach((d) => console.log('만듦: ' + d));
  }
}
