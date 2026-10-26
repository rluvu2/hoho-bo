/*
 * ① 관리 웹앱 호출 — 요청, 오류 처리, 목업 모드
 *
 * 본문은 JSON 문자열 그대로 보낸다 (Content-Type 기본값 text/plain).
 * 커스텀 헤더·Authorization 헤더를 넣으면 프리플라이트(OPTIONS)가 생기는데 GAS 는 이를 처리하지 못한다.
 * 키는 항상 본문으로 보낸다. GAS 는 응답을 googleusercontent 로 리다이렉트하므로 따라가게 둔다.
 */
var Api = (function () {
  'use strict';

  var TIMEOUT_MS = 30000;

  function isMock() {
    return /[?&]mock=1(&|$)/.test(location.search) || !CONFIG.API_URL;
  }

  function apiError(code, message, details) {
    return { code: code, message: message, details: details || null };
  }

  function requestId() {
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  /** action 을 부른다 → Promise(data). 실패하면 { code, message, details } 로 reject */
  function call(action, payload) {
    var auth = Auth.get();
    if (isMock()) return MockApi.handle(action, payload || {}, auth);
    var body = JSON.stringify({ action: action, key: auth ? auth.key : '', payload: payload || {}, requestId: requestId() });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(CONFIG.API_URL, {
      method: 'POST',
      body: body,
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text();
    }).then(function (text) {
      var json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw apiError('SERVER_ERROR', '서버가 JSON 대신 다른 응답을 보냈어요. ① 웹앱 배포의 액세스가 "모든 사용자"인지 확인해 주세요');
      }
      if (!json || json.ok !== true) {
        throw (json && json.error) || apiError('SERVER_ERROR', '서버 응답이 올바르지 않아요');
      }
      return json.data;
    }).catch(function (e) {
      if (e && e.code) throw e;
      if (e && e.name === 'AbortError') throw apiError('SERVER_ERROR', '응답이 너무 늦어요. 잠시 뒤 다시 시도해 주세요');
      throw apiError('SERVER_ERROR', '서버에 연결하지 못했어요. 인터넷 연결이나 config.js 의 API_URL 을 확인해 주세요');
    }).then(function (data) {
      clearTimeout(timer);
      return data;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  return {
    isMock: isMock,
    call: call,
    error: apiError
  };
})();
