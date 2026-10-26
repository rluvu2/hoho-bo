/*
 * 화면 공통 — 요소 만들기, 상단 바, 로딩·오류, 날짜·시간 표시, 스키마 캐시, 복사
 * 데이터를 그릴 때 innerHTML 을 쓰지 않는다 (textContent, createElement 만).
 */
var UI = (function () {
  'use strict';

  var SCHEMA_CACHE = 'hoho_bo_schema';
  var SCHEMA_TTL_MS = 10 * 60 * 1000;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    setAttrs(n, attrs);
    append(n, children);
    return n;
  }

  function svg(tag, attrs, children) {
    var n = document.createElementNS(SVG_NS, tag);
    setAttrs(n, attrs);
    append(n, children);
    return n;
  }

  function setAttrs(n, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.setAttribute('class', v);
      else if (k === 'text') n.textContent = v;
      else if (k.indexOf('on') === 0 && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    });
  }

  function append(n, children) {
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ------------------------------------------------------------ 표시 형식

  function today() {
    return FormatCore.todaySeoul();
  }

  function fmtDate(iso) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? FormatCore.displayDate(iso, today()) : String(iso || '');
  }

  function fmtDateShort(iso) {
    var s = String(iso || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return +s.slice(5, 7) + '/' + +s.slice(8, 10) + ' (' + FormatCore.weekdayOf(s) + ')';
  }

  function fmtTime(v) {
    return /^\d{2}:\d{2}$/.test(String(v)) ? FormatCore.displayTime(v) : String(v || '');
  }

  function fmtNumber(v) {
    if (typeof v === 'number' && isFinite(v)) return v.toLocaleString('ko-KR');
    return String(v === null || v === undefined ? '' : v);
  }

  /** 필드 타입에 맞춘 글자 (긴 형식) */
  function fmtValue(v, type) {
    if (v === '' || v === null || v === undefined) return '';
    if (type === 'date') return fmtDate(v);
    if (type === 'time') return fmtTime(v);
    if (type === 'number') return fmtNumber(v);
    return String(v);
  }

  // ------------------------------------------------------------ 상단 바

  function withMock(href) {
    return href + Auth.mockQuery();
  }

  function topbar(active) {
    var auth = Auth.get();
    var bar = $('topbar');
    clear(bar);
    var links = [
      ['data', 'data.html', '데이터 확인'],
      ['messages', 'messages.html', '메시지'],
      ['dashboard', 'dashboard.html', '대시보드']
    ];
    var nav = el('nav', { class: 'nav', 'aria-label': '메뉴' }, links.map(function (l) {
      return el('a', { href: withMock(l[1]), class: 'nav-link' + (l[0] === active ? ' is-active' : ''), 'aria-current': l[0] === active ? 'page' : null, text: l[2] });
    }));
    var input = el('a', { href: '#', class: 'nav-link nav-ext', text: '입력 ↗', title: '예약 입력 화면을 새 탭으로 열어요' });
    input.addEventListener('click', function (e) {
      e.preventDefault();
      openInput();
    });
    nav.appendChild(input);
    bar.appendChild(el('div', { class: 'topbar-inner' }, [
      el('a', { href: withMock('data.html'), class: 'brand', text: CONFIG.APP_NAME }),
      Api.isMock() ? el('span', { class: 'badge badge-mock', title: 'API_URL 이 비어 있거나 ?mock=1 — 가짜 데이터', text: '목업 모드' }) : null,
      nav,
      el('div', { class: 'topbar-user' }, [
        el('span', { class: 'user-name', text: auth ? auth.name : '' }),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '로그아웃', onclick: function () { Auth.logout(''); } })
      ])
    ]));
    document.title = (document.title.split(' · ')[0]) + ' · ' + CONFIG.APP_NAME;
  }

  /** ② 입력 화면을 새 탭으로, #k= 로 관리자 키를 넘겨 바로 로그인 */
  function openInput() {
    var auth = Auth.get();
    if (!CONFIG.INPUT_URL) {
      toast(Api.isMock() ? '목업 모드에서는 입력 화면이 없어요 (scripts/preview-input.js 로 미리보기)' : 'config.js 에 INPUT_URL(② 웹앱 주소)이 없어요');
      return;
    }
    var w = window.open(CONFIG.INPUT_URL + '#k=' + encodeURIComponent(auth ? auth.key : ''), '_blank', 'noopener,noreferrer');
    if (w) w.opener = null;
  }

  // ------------------------------------------------------------ 로딩·오류

  function loading(box, text) {
    clear(box);
    box.appendChild(el('div', { class: 'state state-loading', role: 'status' }, [
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      el('span', { text: text || '불러오는 중…' })
    ]));
  }

  /** 오류 안내 + 다시 시도. UNAUTHORIZED 면 로그인 화면으로. */
  function error(box, err, retry) {
    if (handleAuth(err)) return;
    clear(box);
    var msg = err && err.code === 'FORBIDDEN' ? '권한이 없어요. 관리자 비밀번호로 로그인해 주세요.' : (err && err.message) || '문제가 생겼어요';
    box.appendChild(el('div', { class: 'state state-error', role: 'alert' }, [
      el('p', { text: msg }),
      retry ? el('button', { type: 'button', class: 'btn', text: '다시 시도', onclick: retry }) : null
    ]));
  }

  function handleAuth(err) {
    if (err && err.code === 'UNAUTHORIZED') {
      Auth.logout(err.message || '다시 로그인해 주세요');
      return true;
    }
    return false;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    if (!t) {
      t = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-on'); }, 2200);
  }

  // ------------------------------------------------------------ 스키마 (sessionStorage 10분)

  function getSchema() {
    try {
      var c = JSON.parse(sessionStorage.getItem(SCHEMA_CACHE) || 'null');
      if (c && Date.now() - c.at < SCHEMA_TTL_MS && c.mock === Api.isMock()) return Promise.resolve(c.data);
    } catch (e) { /* 캐시 없음 */ }
    return Api.call('schema.get', {}).then(function (data) {
      try { sessionStorage.setItem(SCHEMA_CACHE, JSON.stringify({ at: Date.now(), mock: Api.isMock(), data: data })); } catch (e) { /* 무시 */ }
      return data;
    });
  }

  // ------------------------------------------------------------ 복사

  function fallbackCopy(text) {
    var ta = el('textarea', { class: 'offscreen', readonly: true, 'aria-hidden': 'true' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /** → Promise(true|false) */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  /** 복사가 막혔을 때: 글을 보여주고 직접 복사하게 */
  function manualCopy(text) {
    var dlg = el('dialog', { class: 'dialog' }, [
      el('div', { class: 'dialog-head' }, [el('h2', { text: '직접 복사해 주세요' })]),
      el('div', { class: 'dialog-body' }, [
        el('p', { class: 'muted', text: '이 브라우저에서는 자동 복사가 막혀 있어요. 아래 글을 선택해 복사해 주세요.' })
      ])
    ]);
    var ta = el('textarea', { class: 'copy-area', readonly: true });
    ta.value = text;
    dlg.querySelector('.dialog-body').appendChild(ta);
    dlg.appendChild(el('div', { class: 'dialog-foot' }, [
      el('button', { type: 'button', class: 'btn btn-primary', text: '닫기', onclick: function () { dlg.close(); } })
    ]));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    ta.focus();
    ta.select();
  }

  function copyWithFeedback(text, okMsg) {
    return copyText(text).then(function (ok) {
      if (ok) toast(okMsg || '복사했어요');
      else manualCopy(text);
      return ok;
    });
  }

  return {
    $: $,
    el: el,
    svg: svg,
    clear: clear,
    today: today,
    fmtDate: fmtDate,
    fmtDateShort: fmtDateShort,
    fmtTime: fmtTime,
    fmtNumber: fmtNumber,
    fmtValue: fmtValue,
    withMock: withMock,
    topbar: topbar,
    loading: loading,
    error: error,
    handleAuth: handleAuth,
    toast: toast,
    getSchema: getSchema,
    copyText: copyText,
    copyWithFeedback: copyWithFeedback
  };
})();
