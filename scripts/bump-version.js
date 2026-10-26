#!/usr/bin/env node
/*
 * 정적 파일 캐시 버전 올리기 (Node 내장 기능만)
 *
 *   node scripts/bump-version.js
 *
 * 루트 HTML 의 assets/…?v=값 을 지금 시각(yyyyMMddHHmm, 서울)으로 바꾼다.
 * CSS·JS 를 고친 뒤 push 하기 전에 실행하면 브라우저가 옛 파일을 쓰지 않는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const d = new Date(Date.now() + 9 * 3600000);
const pad = (n) => (n < 10 ? '0' : '') + n;
const v = d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes());

fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).forEach((f) => {
  const file = path.join(ROOT, f);
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(/(assets\/[^"'?]+\?v=)[0-9A-Za-z._-]+/g, '$1' + v);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(f + ' → v=' + v);
  }
});
