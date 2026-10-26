#!/usr/bin/env node
/*
 * 구조 검사 (Node 내장 기능만 사용) — 하나라도 실패하면 exit 1
 *
 *   node scripts/check.js
 *
 * 1. 복사본(FormatCore.gs, FormatCoreJs.html, SchemaDefaults.gs, shared)이 원본과 같은지
 * 2. 모든 .gs 와 HTML 안 <script> 문법 검사
 * 3. ② 에서 _ 로 끝나지 않는 최상위 함수가 doGet + 다섯 개뿐인지
 * 4. ① 코드에 HtmlService 가 없는지, ① API 표에 쓰기 액션이 없는지
 * 5. 화면 코드에 innerHTML 같은 HTML 문자열 삽입이 없는지
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sync = require('./sync.js');

const ROOT = path.resolve(__dirname, '..');
const ADMIN = path.join(ROOT, 'backend', 'admin-gas');
const INPUT = path.join(ROOT, 'backend', 'input-gas');

const INPUT_PUBLIC = ['doGet', 'inputLogin', 'inputMe', 'inputSchema', 'inputAiFix', 'inputSubmit'];
const ADMIN_READ_ACTIONS = ['auth.login', 'auth.me', 'schema.get', 'data.query', 'messages.templates', 'dashboard.get'];
const HTML_SINKS = /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write\s*\(/;

function files(dir, ext) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => path.join(dir, f));
}

function read(f) {
  return fs.readFileSync(f, 'utf8');
}

function rel(f) {
  return path.relative(ROOT, f).replace(/\\/g, '/');
}

/** 주석을 지운 코드 (문자열 안의 // 는 남긴다) */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

function scriptsInHtml(html) {
  const out = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

/** 프로젝트의 .gs 를 한 컨텍스트에 불러온다 (GAS 처럼 전역 공유). */
function loadProject(dir, extra) {
  const ctx = vm.createContext(Object.assign({ console }, extra || {}));
  const before = new Set(Object.keys(ctx));
  files(dir, '.gs').forEach((f) => vm.runInContext(read(f), ctx, { filename: rel(f) }));
  return { ctx, globals: Object.keys(ctx).filter((k) => !before.has(k)) };
}

function run() {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  if (!fs.existsSync(path.join(ROOT, 'backend'))) {
    return { problems, skipped: ['backend/ 폴더가 없어 백엔드 검사를 건너뜀'] };
  }

  // 1. 복사본
  sync.stale().forEach((s) => fail('복사본이 원본과 달라요: ' + s));

  // 2. 문법
  [ADMIN, INPUT, path.join(ROOT, 'backend', 'shared')].forEach((dir) => {
    files(dir, dir.endsWith('shared') ? '.js' : '.gs').forEach((f) => {
      try { new vm.Script(read(f), { filename: rel(f) }); } catch (e) { fail('문법 오류 ' + rel(f) + ': ' + e.message); }
    });
  });
  files(INPUT, '.html').forEach((f) => {
    scriptsInHtml(read(f)).forEach((code, i) => {
      try { new vm.Script(code, { filename: rel(f) + '#script' + i }); } catch (e) { fail('문법 오류 ' + rel(f) + ': ' + e.message); }
    });
  });
  if (problems.length) return { problems, skipped: [] };

  // 3. ② 공개 함수
  try {
    const p = loadProject(INPUT);
    p.globals.forEach((name) => {
      if (typeof p.ctx[name] === 'function' && !name.endsWith('_') && !INPUT_PUBLIC.includes(name)) {
        fail('② 에 공개 함수가 더 있어요 (이름 끝에 _ 를 붙이거나 객체 안으로): ' + name);
      }
    });
    INPUT_PUBLIC.forEach((name) => {
      if (typeof p.ctx[name] !== 'function') fail('② 에 ' + name + ' 함수가 없어요');
    });
    ['onEdit', 'onOpen', 'setup', 'syncCalendar'].forEach((name) => {
      if (p.globals.includes(name)) fail('② 에 두면 안 되는 함수가 있어요: ' + name);
    });
  } catch (e) {
    fail('② 를 불러오지 못했어요: ' + e.message);
  }

  // 4. ① HtmlService·쓰기 액션
  files(ADMIN, '.gs').forEach((f) => {
    if (/HtmlService/.test(stripComments(read(f)))) fail('① 코드에 HtmlService 가 있어요: ' + rel(f));
  });
  try {
    const p = loadProject(ADMIN);
    const actions = Object.keys((p.ctx.AdminApi && p.ctx.AdminApi.ACTIONS) || {});
    if (!actions.length) fail('① AdminApi.ACTIONS 를 찾지 못했어요');
    actions.forEach((a) => {
      if (!ADMIN_READ_ACTIONS.includes(a)) fail('① API 에 허용 목록 밖의 액션이 있어요 (쓰기 액션 금지): ' + a);
    });
    ['doGet', 'doPost', 'onEdit', 'onOpen', 'setup', 'syncCalendar'].forEach((name) => {
      if (typeof p.ctx[name] !== 'function') fail('① 에 ' + name + ' 함수가 없어요');
    });
  } catch (e) {
    fail('① 을 불러오지 못했어요: ' + e.message);
  }

  // 5. HTML 문자열 삽입 금지 (github.io 와 ② 화면)
  const front = files(path.join(ROOT, 'assets', 'js'), '.js').concat(files(INPUT, '.html'));
  front.forEach((f) => {
    if (HTML_SINKS.test(stripComments(read(f)))) fail('innerHTML 같은 HTML 삽입이 있어요: ' + rel(f));
  });

  return { problems, skipped: [] };
}

module.exports = { run, loadProject, files, INPUT_PUBLIC, ADMIN_READ_ACTIONS };

if (require.main === module) {
  const r = run();
  r.skipped.forEach((s) => console.log('건너뜀: ' + s));
  if (r.problems.length) {
    console.error('구조 검사 실패:\n  - ' + r.problems.join('\n  - '));
    process.exit(1);
  }
  console.log('구조 검사 통과');
}
