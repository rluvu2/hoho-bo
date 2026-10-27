#!/usr/bin/env node
/*
 * 브라우저 확인 (Node 내장 기능만: http, child_process, 전역 WebSocket — Node 22 이상)
 *
 *   node scripts/smoke.js [--shots=<폴더>] [--browser=<chrome/edge 실행 파일>]
 *
 * 로컬 서버를 /hoho-bo/ 하위 경로로 띄우고(프로젝트 사이트와 같은 상대 경로), 설치된 Chrome·Edge 를
 * headless 로 열어 목업 모드의 모든 화면과 P2 미리보기를 실제로 눌러 본다.
 * 콘솔 오류·잡히지 않은 예외·CSP 위반·불러오기 실패가 하나라도 있으면 exit 1.
 * --shots 를 주면 화면마다 스크린샷(PNG)을 저장한다.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const serve = require('./serve.js');
const preview = require('./preview-input.js');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765;
const DEBUG_PORT = 9333;
const BASE = '/hoho-bo';
const ORIGIN = 'http://127.0.0.1:' + PORT + BASE;

const arg = (name) => (process.argv.find((a) => a.startsWith('--' + name + '=')) || '').slice(name.length + 3);

function findBrowser() {
  const given = arg('browser') || process.env.BROWSER;
  const list = given ? [given] : [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'
  ];
  return list.find((p) => p && fs.existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.seq = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
      this.ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message));
          else p.resolve(msg.result);
        } else if (msg.method) {
          this.listeners.forEach((fn) => fn(msg));
        }
      };
    });
  }
  send(method, params) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

async function main() {
  const browser = findBrowser();
  if (!browser) {
    console.error('Chrome·Edge 를 찾지 못했어요. --browser=<실행 파일 경로> 로 알려 주세요.');
    process.exit(2);
  }
  preview.build();
  const server = await serve.start(PORT, BASE);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hoho-bo-smoke-'));
  const proc = spawn(browser, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + DEBUG_PORT, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });

  const problems = [];
  const shots = arg('shots');
  let cdp;
  let page = '';
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      await sleep(200);
      try {
        const res = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/new?about:blank', { method: 'PUT' });
        target = await res.json();
      } catch (e) { /* 아직 안 뜸 */ }
    }
    if (!target) throw new Error('브라우저 디버깅 포트에 연결하지 못했어요');
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); // headless 에서도 focus 이벤트

    cdp.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        problems.push(page + ' 예외: ' + ((d.exception && d.exception.description) || d.text));
      } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
        problems.push(page + ' console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
      } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        problems.push(page + ' 로그: ' + m.params.entry.text + (m.params.entry.url ? ' (' + m.params.entry.url + ')' : ''));
      } else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) {
        problems.push(page + ' 불러오기 실패 ' + m.params.response.status + ': ' + m.params.response.url);
      }
    });

    const ev = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('평가 실패: ' + expr.slice(0, 80) + ' → ' + (r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
      return r.result.value;
    };
    const waitFor = async (expr, what, ms) => {
      const end = Date.now() + (ms || 8000);
      while (Date.now() < end) {
        try { if (await ev(expr)) return; } catch (e) { /* 이동 중 */ }
        await sleep(100);
      }
      throw new Error(page + ': 기다리다 시간 초과 — ' + what);
    };
    const go = async (p) => {
      page = p.split('?')[0].split('#')[0];
      // #만 다른 주소는 같은 문서 안 이동이라 스크립트가 다시 돌지 않는다 → 빈 페이지를 거쳐서 연다
      if (p.indexOf('#') >= 0) await cdp.send('Page.navigate', { url: 'about:blank' });
      await cdp.send('Page.navigate', { url: ORIGIN + '/' + p });
      await waitFor('document.readyState === "complete"', '로드');
    };
    const shot = async (name) => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      await sleep(250);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      fs.writeFileSync(path.join(shots, name + '.png'), Buffer.from(r.data, 'base64'));
    };
    const check = (cond, msg) => { if (!cond) problems.push(page + ' 확인 실패: ' + msg); };
    const click = (sel) => ev('(function(){var n=document.querySelector(' + JSON.stringify(sel) + ');if(!n)throw new Error("없음: ' + sel.replace(/"/g, '') + '");n.click();return true})()');

    // ---------------------------------------------------- 로그인
    await go('index.html?mock=1');
    await ev('localStorage.clear(); sessionStorage.clear(); true');
    await go('index.html?mock=1');
    check(await ev('!document.getElementById("mockHint").hidden'), '목업 안내가 보여야 함');
    await shot('01-login');
    await ev('document.getElementById("pw").value="틀린비번"; document.getElementById("loginForm").requestSubmit(); true');
    await waitFor('!document.getElementById("loginMsg").hidden', '틀린 비밀번호 안내');
    check(/맞지 않아요/.test(await ev('document.getElementById("loginMsg").textContent')), '틀린 비밀번호 문구');
    await ev('document.getElementById("pw").value="mockuser1"; document.getElementById("loginForm").requestSubmit(); true');
    await sleep(600);
    check(/index\.html/.test(await ev('location.pathname')), '사용자 비밀번호는 거절돼야 함');
    await ev('document.getElementById("pw").value="mockadmin"; document.getElementById("loginForm").requestSubmit(); true');
    await waitFor('/data\\.html/.test(location.pathname)', '로그인 후 P1 이동');
    page = 'data.html';

    // ---------------------------------------------------- P1
    await waitFor('document.querySelectorAll("table.data tbody tr").length > 5', 'P1 표');
    check(await ev('localStorage.getItem("hoho_bo_auth").indexOf("mockadmin") < 0'), '비밀번호가 저장되면 안 됨');
    check(await ev('document.querySelectorAll(".filters .filter").length <= 7'), '필터 최대 6개 + 버튼');
    check(await ev('!!document.querySelector(".badge-mock")'), '목업 표시');
    await shot('02-p1');
    await click('table.data tbody tr');
    await waitFor('document.getElementById("detail").open', '자세히 보기');
    await shot('03-p1-detail');
    await ev('document.getElementById("detail").close(); true');
    await ev('document.querySelectorAll(".sort-btn")[1].click(); true');
    await waitFor('document.querySelector(".sort-ind") && [...document.querySelectorAll(".sort-ind")].some(function(n){return n.textContent})', '정렬 표시');
    await ev('document.getElementById("f-q").value="HONG"; document.querySelector(".filters").requestSubmit(); true');
    await waitFor('/총 \\d+건/.test(document.getElementById("total").textContent) && [...document.querySelectorAll("table.data tbody tr")].every(function(r){return /HONG|없어요/.test(r.textContent)})', '키워드 필터');

    // ---------------------------------------------------- P3
    await go('messages.html?mock=1');
    await waitFor('document.querySelector(".filters") && (document.querySelector(".mcard") || document.querySelector("#cards .state p"))', 'P3 카드');
    await ev('document.querySelector(".filters button[type=button]").click(); true'); // 필터 초기화 = 기본값
    await waitFor('document.querySelector(".mcard") || document.querySelector("#cards .state p")', 'P3 카드 (기본 필터)');
    // 기본 필터가 비어 있을 수 있어 기간을 넓혀 카드가 나오게
    await ev('var i=document.querySelectorAll(".filters input[type=date]"); i[0].value=""; i[1].value=""; i[1].dispatchEvent(new Event("change")); true');
    await waitFor('document.querySelectorAll(".mcard").length > 3', 'P3 카드 여러 개');
    check(/• 일시: \d+월 \d+일 \d{2}:\d{2} (도착|출발)/.test(await ev('document.querySelector(".mcard-msg").textContent')), '메시지 일시 줄 모양');
    check(/고객센터: 010-0000-0000/.test(await ev('document.querySelector(".mcard-msg").textContent')), '{고객센터} 변수');
    check(await ev('[...document.querySelectorAll(".mcard-warn")].some(function(n){return /기사를 배정/.test(n.textContent)})'), '미배차 경고');
    await click('#checkAll');
    check(!(await ev('document.getElementById("copySelected").disabled')), '선택 복사 버튼');
    await shot('04-p3');

    // ---------------------------------------------------- P4
    await go('dashboard.html?mock=1');
    await waitFor('document.querySelectorAll(".kpi").length === 8', 'KPI 8개');
    await waitFor('document.querySelectorAll("svg.chart").length >= 4', '차트');
    await shot('05-p4');
    await ev('[...document.querySelectorAll("#presets button")].find(function(b){return b.textContent==="최근 30일"}).click(); true');
    await waitFor('!document.getElementById("dash").classList.contains("is-stale") && /30일/.test(document.getElementById("periodNote").textContent)', '최근 30일');
    await ev('[...document.querySelectorAll("#units button")].find(function(b){return b.textContent==="주"}).click(); true');
    await waitFor('!document.getElementById("dash").classList.contains("is-stale") && /~/.test(document.querySelector("#chCounts").textContent)', '주 단위');
    await ev('document.querySelector("#chCounts .hit").dispatchEvent(new PointerEvent("pointermove",{clientX:300,clientY:400,bubbles:true})); true');
    check(await ev('document.querySelector(".chart-tip.is-on") !== null'), '툴팁');
    await ev('document.querySelector("#chRevenue .hit").focus(); true');
    check(/원/.test(await ev('document.querySelector(".chart-tip").textContent')), '키보드 포커스 툴팁');
    await shot('06-p4-30days-week');

    // ---------------------------------------------------- 다시 들어오면 전에 본 결과 먼저 → 최신 값으로 바꿔치기
    await ev('sessionStorage.setItem("hoho_bo_mock_delay", "1500"); true'); // 응답을 늦춰 '확인 중'을 볼 수 있게
    await go('data.html?mock=1');
    await waitFor('document.querySelectorAll("table.data tbody tr").length > 5 && document.getElementById("tableBox").classList.contains("is-stale")', 'P1 전에 본 결과 먼저', 1200);
    check(/최신 값 확인 중/.test(await ev('document.getElementById("fresh").textContent')), 'P1 갱신 중 표시');
    await shot('06b-p1-stale');
    await waitFor('document.getElementById("fresh").hidden && !document.getElementById("tableBox").classList.contains("is-stale")', 'P1 최신 값으로 바꿈', 5000);

    await go('messages.html?mock=1');
    await waitFor('(document.querySelector(".mcard") || document.querySelector("#cards .state p")) && document.getElementById("cards").classList.contains("is-stale") && !document.getElementById("fresh").hidden', 'P3 전에 본 결과 먼저', 1200);
    check(await ev('document.getElementById("copySelected").disabled && document.getElementById("checkAll").disabled && [...document.querySelectorAll(".mcard .btn, .mcard input")].every(function(b){return b.disabled})'), 'P3 옛 결과에서는 선택·복사 막힘');
    await waitFor('document.getElementById("fresh").hidden && !document.getElementById("cards").classList.contains("is-stale") && !document.getElementById("checkAll").disabled', 'P3 최신 값으로 바꿈', 5000);

    await go('dashboard.html?mock=1');
    await waitFor('document.querySelectorAll(".kpi").length === 8 && document.getElementById("dash").classList.contains("is-stale") && !document.getElementById("fresh").hidden', 'P4 전에 본 결과 먼저', 1200);
    await waitFor('document.getElementById("fresh").hidden && !document.getElementById("dash").classList.contains("is-stale")', 'P4 최신 값으로 바꿈', 5000);

    // 최신 값을 못 가져오면: 전에 본 표는 흐린 채로 두고 '못 가져왔어요' + 다시 시도
    await ev('sessionStorage.setItem("hoho_bo_mock_delay", "300"); sessionStorage.setItem("hoho_bo_mock_fail", "data.query"); true');
    await go('data.html?mock=1');
    await waitFor('document.getElementById("fresh").classList.contains("is-failed")', 'P1 최신 값 실패 표시', 5000);
    check(await ev('document.querySelectorAll("table.data tbody tr").length > 5 && document.getElementById("tableBox").classList.contains("is-stale")'), '실패해도 전에 본 표는 흐린 채로 남음');
    await shot('06c-p1-failed');
    await click('#fresh button');
    await waitFor('document.getElementById("fresh").hidden && !document.getElementById("tableBox").classList.contains("is-stale") && document.querySelectorAll("table.data tbody tr").length > 5', 'P1 다시 시도', 5000);
    await ev('sessionStorage.removeItem("hoho_bo_mock_delay"); true');

    // ---------------------------------------------------- 자동로그인 링크·로그아웃
    await ev('localStorage.clear(); true');
    await go('index.html?mock=1#k=mock-key-admin-0000000000000000');
    await waitFor('/data\\.html/.test(location.pathname)', '자동로그인 → P1');
    check(!(await ev('location.hash')), '주소에서 #k= 가 지워져야 함');
    await waitFor('document.querySelectorAll(".topbar button").length > 0 && document.querySelector(".user-name").textContent', '상단 바');
    check((await ev('document.querySelector(".user-name").textContent')) === '목업 관리자', '상단 바 이름');
    await ev('[...document.querySelectorAll(".topbar button")].find(function(b){return b.textContent==="로그아웃"}).click(); true');
    await waitFor('/index\\.html/.test(location.pathname)', '로그아웃');
    check(!(await ev('localStorage.getItem("hoho_bo_auth")')), '로그아웃하면 저장값 삭제');
    check(!(await ev('sessionStorage.getItem("hoho_bo_last")')), '로그아웃하면 전에 본 결과도 삭제');
    await go('index.html?mock=1#k=wrong-key-000000000000000000');
    await waitFor('!document.getElementById("loginMsg").hidden', '틀린 링크 안내');

    // ---------------------------------------------------- 모바일 (로그인·P3)
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await go('index.html?mock=1');
    await shot('07-login-mobile');
    await ev('document.getElementById("pw").value="mockadmin"; document.getElementById("loginForm").requestSubmit(); true');
    await waitFor('/data\\.html/.test(location.pathname)', '모바일 로그인');
    await go('messages.html?mock=1');
    await waitFor('document.querySelector(".mcard") || document.querySelector("#cards .state p")', '모바일 P3');
    check(await ev('document.documentElement.scrollWidth <= window.innerWidth + 1'), '모바일 P3 가로 스크롤 없어야 함');
    await shot('08-p3-mobile');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

    // ---------------------------------------------------- P2 미리보기
    const dayAfter = (n) => {
      const d = new Date(Date.now() + 9 * 3600000 + n * 86400000);
      return { md: (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일', slash: (d.getUTCMonth() + 1) + '/' + d.getUTCDate() };
    };
    const good = ['도착 정보 확인 요청', '', '  - 도착 날짜, 시간 : ' + dayAfter(2).md + ' 17:00', '  - 항공 편명: ke 703', '  - 인원: 2명', '  - 짐 개수: 3개',
      '  - 이름(피케팅 네임) JOHN SMITH', '  - 연락처: +1 415 555 0100', '  - 목적지 상세 주소: 서울특별시 가상구 예시로 12'].join('\n');
    const good2 = ['출발 정보 확인요청', '', '- 출발 날짜: ' + dayAfter(3).slash, '- 출발시간 : 오후 3시', '- 항공편명 : OZ 102', '- 인원,짐개수: 2명, 3개',
      '- 이름(확인용): KIM YESI', '- 연락처: 010 0000 1234', '- 출발지 상세주소: 부산광역시 가상구 샘플로 34'].join('\n');
    const bad = '안녕하세요 예약 부탁드립니다\n' + good.replace(' 17:00', ' 5시') + '\n\n카시트 1개 부탁해요';
    const BOX = '#boxes .box';
    const setText = (i, t) => ev('(function(){var s=document.querySelectorAll("' + BOX + ' textarea.src")[' + i + ']; s.value=' + JSON.stringify(t) + '; s.dispatchEvent(new Event("input")); return true})()');
    const boxEv = (i, expr) => ev('(function(b){return ' + expr + '})(document.querySelectorAll("' + BOX + '")[' + i + '])');
    const summaryIs = (cls) => 'document.getElementById("summary").classList.contains("' + cls + '")';

    await go('backend/preview/input.html');
    await waitFor('!document.getElementById("loginView").hidden', 'P2 로그인 화면');
    await shot('09-p2-login');
    await ev('document.getElementById("pw").value="preview1234"; document.getElementById("loginForm").requestSubmit(); true');
    await waitFor('!document.getElementById("mainView").hidden && document.querySelectorAll("' + BOX + '").length === 1', 'P2 메인 (빈 칸 하나)');
    check(await ev('document.querySelectorAll("#copyRow button").length === 2'), '양식 복사 버튼 2개');
    check(await ev('document.getElementById("saveBtn").disabled'), '빈 화면에서는 저장 불가');

    // 칸 두 개에 한 번에
    await setText(0, good);
    await waitFor(summaryIs('ok') + ' && document.querySelectorAll("' + BOX + '").length === 2', '답장 1 ✓, 빈 칸 자동 추가');
    check(await boxEv(0, 'b.querySelector(".btn-warn").hidden'), '✓면 보정 버튼 숨김');
    const rowVal = (label) => boxEv(0, '[...b.querySelectorAll(".check tbody tr")].filter(function(r){return r.querySelector("th").textContent===' + JSON.stringify(label) + '}).map(function(r){return r.querySelector("td.val").textContent}).join("|")');
    check(/^\d+월 \d+일 \([일월화수목금토]\)$/.test(await rowVal('날짜')), '확인표 날짜(요일 포함)');
    check((await rowVal('시간')) === '17:00 (오후 5:00)', '확인표 시간(오전·오후 포함)');
    check((await rowVal('연락처')) === '+1 415 555 0100', '확인표 해외 번호 그대로');
    await setText(1, good2);
    await waitFor(summaryIs('ok') + ' && /예약 2건/.test(document.getElementById("summary").textContent) && document.querySelectorAll("' + BOX + '").length === 3', '답장 2 ✓, 예약 2건');
    check(!(await ev('document.getElementById("saveBtn").disabled')), '모두 저장 버튼 켜짐');
    await shot('10-p2-two-boxes');
    await click('#saveBtn');
    await waitFor('document.querySelector("#result .result-box.ok")', '저장 성공');
    check(/답장 1: .*\n?[\s\S]*답장 2: /.test(await ev('document.getElementById("result").textContent')), '칸마다 ID 안내');
    check(await ev('document.querySelectorAll("' + BOX + '").length === 1 && document.querySelector("' + BOX + ' textarea").value === ""'), '저장한 칸은 없어지고 빈 칸 하나');

    // 중복 (이미 저장한 예약)
    await setText(0, good);
    await waitFor(summaryIs('ok'), '다시 ✓');
    await click('#saveBtn');
    await waitFor('!document.getElementById("dupModal").hidden', '중복 경고');
    check(/답장 1 · 1번째 예약/.test(await ev('document.getElementById("dupBody").textContent')), '중복 안내에 칸 번호');
    await shot('11-p2-duplicate');
    await click('#dupConfirm');
    await waitFor('document.querySelector("#result .result-box.ok")', '그래도 저장');

    // 한 칸이라도 ✗ 면 모두 저장 불가
    await setText(0, bad);
    await waitFor(summaryIs('bad'), '✗ 표시');
    await setText(1, good2.replace('KIM YESI', 'PARK OTHER'));
    await waitFor('document.querySelectorAll("' + BOX + '").length === 3', '답장 2 입력');
    check(await ev(summaryIs('bad') + ' && /답장 1번/.test(document.getElementById("summary").textContent)'), '문제 칸 번호 안내');
    check(await boxEv(0, 'b.querySelector("textarea").classList.contains("is-invalid")'), '붉은 입력창');
    check(await ev('document.getElementById("saveBtn").disabled'), '한 칸이라도 ✗면 저장 불가');
    check(!(await boxEv(0, 'b.querySelector(".btn-warn").hidden')), '문제 칸에 보정 버튼');
    check(await boxEv(0, 'b.querySelectorAll(".problems li").length >= 2'), '문제 줄 목록');
    await shot('12-p2-bad');

    // 칸 하나 보정: 결과가 그 칸 아래 '보정 제안'으로 펼쳐진다 (창이 아님)
    await boxEv(0, 'b.querySelector(".btn-warn").click() || true');
    await waitFor('(function(b){var s=b.querySelector(".suggest");return s && !s.hidden && s.querySelector(".diff-lines li.add")})(document.querySelectorAll("' + BOX + '")[0])', '답장 1 보정 제안');
    check(/답장 1/.test(await boxEv(0, 'b.querySelector(".suggest h3").textContent')), '보정 제안에 칸 번호');
    check(await ev('!document.querySelector(".modal:not([hidden])")'), '창(모달)이 뜨지 않음');
    await shot('13-p2-fix-inline');
    await boxEv(0, 'b.querySelector(".suggest .btn-primary").click() || true');
    await waitFor('(function(b){return b.querySelector(".suggest").hidden && /메모: /.test(b.querySelector("textarea").value)})(document.querySelectorAll("' + BOX + '")[0])', '승인 → 보정본이 그 칸에 들어감');
    check(await ev(summaryIs('bad')), '시간이 비어 여전히 ✗');

    // 문제 칸 여러 개를 한 번에 보정 → 보정 모두 승인
    await setText(1, bad.replace('JOHN SMITH', 'LEE GAJJA'));
    await waitFor('!document.getElementById("fixAllBtn").hidden && /\\(2\\)/.test(document.getElementById("fixAllBtn").textContent)', '문제 칸 모두 AI 보정 (2)');
    await click('#fixAllBtn');
    await waitFor('document.querySelectorAll("' + BOX + ' .btn-warn[disabled]").length === 2', '두 칸 동시에 보정 중', 3000);
    await waitFor('[...document.querySelectorAll("' + BOX + ' .suggest")].filter(function(s){return !s.hidden}).length === 2', '두 칸 보정 제안');
    await shot('14-p2-fix-all');
    await click('#approveAllBtn');
    await waitFor('[...document.querySelectorAll("' + BOX + ' .suggest")].every(function(s){return s.hidden})', '보정 모두 승인');
    for (const i of [0, 1]) {
      await boxEv(i, '(function(s){s.value=s.value.replace(/(도착 날짜, 시간 : [^\\n]*)/, "$1 17:30"); s.dispatchEvent(new Event("input")); return true})(b.querySelector("textarea"))');
    }
    await waitFor(summaryIs('ok'), '직접 고친 뒤 모두 ✓');
    await shot('15-p2-fixed');
    await click('#saveBtn');
    await waitFor('document.querySelector("#result .result-box.ok")', '두 칸 저장');
  } catch (e) {
    problems.push('진행 중단: ' + e.message);
  } finally {
    try { if (cdp) cdp.ws.close(); } catch (e) { /* 무시 */ }
    proc.kill();
    server.close();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 브라우저가 늦게 닫히면 남을 수 있음 */ }
  }

  if (problems.length) {
    console.error('브라우저 확인 실패:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log('브라우저 확인 통과 (로그인·P1·P3·P4·자동로그인·모바일·P2 미리보기, 콘솔 오류 없음)' + (shots ? ' — 스크린샷: ' + shots : ''));
}

main();
