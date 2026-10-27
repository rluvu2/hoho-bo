#!/usr/bin/env node
/*
 * 백엔드를 Apps Script 로 올리기 — clasp(구글 공식 CLI)를 부르는 도우미 (이 스크립트는 Node 내장 기능만)
 * clasp 는 프로젝트 코드가 아니라 소유자 PC 의 배포 도구다: npm install -g @google/clasp
 *
 *   node scripts/push.js                 복사본 만들기 → 테스트·구조 검사 → ①② 모두 clasp push
 *   node scripts/push.js admin|input     한쪽만
 *   node scripts/push.js --deploy        push 뒤 웹앱 배포도 새 버전으로 (URL 그대로)
 *   node scripts/push.js --skip-tests    테스트 건너뛰기 (급할 때만)
 *
 * 필요한 것: clasp login, backend/admin-gas/.clasp.json, backend/input-gas/.clasp.json (스크립트 ID)
 * 웹앱 배포 ID 는 backend/deploy.json 에 저장한다 (처음 --deploy 때 새로 만들고, 그 뒤로는 같은 배포를 새 버전으로).
 * 처음 한 번은 편집기에서 setup(①)·doGet(②)을 실행해 권한을 승인해야 웹앱이 동작한다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEPLOY_FILE = path.join(ROOT, 'backend', 'deploy.json');
const PROJECTS = {
  admin: { dir: path.join(ROOT, 'backend', 'admin-gas'), name: '① 관리' },
  input: { dir: path.join(ROOT, 'backend', 'input-gas'), name: '② 입력' }
};

function claspCmd() {
  if (process.platform === 'win32') {
    const local = path.join(process.env.APPDATA || '', 'npm', 'clasp.cmd');
    return fs.existsSync(local) ? local : 'clasp.cmd';
  }
  return 'clasp';
}

function quote(s) {
  return '"' + String(s).replace(/"/g, '""') + '"';
}

function run(cmd, args, cwd, capture) {
  const opts = { cwd: cwd || ROOT, stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' };
  // Windows 의 .cmd 는 셸로만 실행된다 → 인자를 직접 따옴표로 묶어 한 줄로 넘긴다
  const r = process.platform === 'win32' && /\.cmd$/i.test(cmd)
    ? spawnSync([cmd].concat(args).map(quote).join(' '), Object.assign({ shell: true }, opts))
    : spawnSync(cmd, args, opts);
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (capture && r.stdout) process.stdout.write(r.stdout);
    throw new Error(path.basename(cmd) + ' ' + args.join(' ') + ' 실패 (exit ' + r.status + ')');
  }
  return capture ? r.stdout : '';
}

function clasp(args, cwd, capture) {
  return run(claspCmd(), args, cwd, capture);
}

function readDeploy() {
  try { return JSON.parse(fs.readFileSync(DEPLOY_FILE, 'utf8')); } catch (e) { return {}; }
}

function stamp() {
  const d = new Date(Date.now() + 9 * 3600000);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function deploy(key, p) {
  const saved = readDeploy();
  const desc = 'push ' + stamp();
  if (saved[key]) {
    clasp(['update-deployment', saved[key], '-d', desc], p.dir);
  } else {
    const out = clasp(['--json', 'create-deployment', '-d', desc], p.dir, true);
    let id = '';
    try {
      const j = JSON.parse(out);
      id = j.deploymentId || (j.deployment && j.deployment.deploymentId) || '';
    } catch (e) {
      const m = /AKfy[\w-]{20,}/.exec(out);
      id = m ? m[0] : '';
    }
    if (!id) throw new Error(p.name + ' 배포 ID 를 읽지 못했어요. clasp deployments 로 확인해 backend/deploy.json 에 적어 주세요:\n' + out);
    saved[key] = id;
    fs.writeFileSync(DEPLOY_FILE, JSON.stringify(saved, null, 2) + '\n', 'utf8');
  }
  console.log(p.name + ' 웹앱: https://script.google.com/macros/s/' + saved[key] + '/exec');
}

function main() {
  const argv = process.argv.slice(2);
  const only = argv.find((a) => PROJECTS[a]);
  const keys = only ? [only] : Object.keys(PROJECTS);
  keys.forEach((k) => {
    if (!fs.existsSync(path.join(PROJECTS[k].dir, '.clasp.json'))) {
      throw new Error(PROJECTS[k].name + ' 프로젝트에 .clasp.json 이 없어요 (backend/README.md 의 clasp 준비 참고)');
    }
  });

  console.log('1) 복사본 만들기');
  run(process.execPath, ['scripts/sync.js']);
  if (!argv.includes('--skip-tests')) {
    console.log('2) 테스트·구조 검사');
    run(process.execPath, ['--test']);
    run(process.execPath, ['scripts/check.js']);
  }
  keys.forEach((k) => {
    const p = PROJECTS[k];
    console.log('3) ' + p.name + ' 올리기');
    clasp(['push', '--force'], p.dir);
    if (argv.includes('--deploy')) deploy(k, p);
  });
  if (!argv.includes('--deploy')) {
    console.log('\n코드만 올렸어요. 웹앱에 반영하려면: node scripts/push.js --deploy (또는 편집기에서 배포 관리 → 새 버전)');
  }
}

try {
  main();
} catch (e) {
  console.error('\n중단: ' + e.message);
  process.exit(1);
}
