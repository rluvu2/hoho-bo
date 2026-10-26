/*
 * 로그인 상태 — localStorage 에 키·역할·이름만 저장한다 (비밀번호는 어디에도 저장하지 않음).
 * 주소의 #k= 자동로그인 키는 이 파일이 불리자마자(다른 처리보다 먼저) 읽고 주소에서 지운다.
 */
var Auth = (function () {
  'use strict';

  var STORE = 'hoho_bo_auth';
  var FLASH = 'hoho_bo_flash';

  // #k=… 를 가장 먼저 읽고 주소에서 지운다
  var hashKey = (function () {
    var m = /(?:^#|&)k=([A-Za-z0-9_-]+)/.exec(location.hash || '');
    if (!m) return '';
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) {
      location.hash = '';
    }
    return m[1];
  })();

  function get() {
    try {
      var v = JSON.parse(localStorage.getItem(STORE) || 'null');
      return v && v.key ? v : null;
    } catch (e) {
      return null;
    }
  }

  function set(v) {
    try {
      localStorage.setItem(STORE, JSON.stringify({ key: v.key, role: v.role, name: v.name }));
    } catch (e) { /* 저장이 막히면 이번 탭에서만 동작 */ }
  }

  function clear() {
    try { localStorage.removeItem(STORE); } catch (e) { /* 무시 */ }
    try { sessionStorage.clear(); } catch (e) { /* 무시 */ }
  }

  /** 다음 화면(로그인)에 한 번 보여줄 안내 */
  function flash(msg) {
    try { sessionStorage.setItem(FLASH, msg); } catch (e) { /* 무시 */ }
  }

  function takeFlash() {
    try {
      var m = sessionStorage.getItem(FLASH) || '';
      sessionStorage.removeItem(FLASH);
      return m;
    } catch (e) {
      return '';
    }
  }

  function mockQuery() {
    return /[?&]mock=1(&|$)/.test(location.search) ? '?mock=1' : '';
  }

  /** 로그인이 필요한 화면: 없으면 로그인 화면으로 */
  function requireLogin() {
    var a = get();
    if (!a) {
      location.replace('index.html' + mockQuery());
      return null;
    }
    return a;
  }

  function logout(msg) {
    clear();
    if (msg) flash(msg);
    location.replace('index.html' + mockQuery());
  }

  return {
    hashKey: function () { return hashKey; },
    get: get,
    set: set,
    clear: clear,
    flash: flash,
    takeFlash: takeFlash,
    mockQuery: mockQuery,
    requireLogin: requireLogin,
    logout: logout
  };
})();
