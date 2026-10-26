/*
 * 로그인 (index.html) — 비밀번호, #k= 자동로그인, 이미 로그인했으면 P1 으로
 */
(function () {
  'use strict';

  var $ = UI.$;
  var NEXT = UI.withMock('data.html');

  function showMsg(text) {
    var m = $('loginMsg');
    m.textContent = text || '';
    m.hidden = !text;
  }

  function busy(on, text) {
    var b = $('loginBtn');
    b.disabled = on;
    b.textContent = on ? (text || '확인 중…') : '로그인';
  }

  $('appName').textContent = CONFIG.APP_NAME;
  document.title = '로그인 · ' + CONFIG.APP_NAME;
  $('mockHint').hidden = !Api.isMock();

  // 자동로그인 링크 (#k=)
  var linkKey = Auth.hashKey();
  if (linkKey) {
    busy(true, '링크 확인 중…');
    Auth.set({ key: linkKey, role: 'admin', name: '' });
    Api.call('auth.me', {}).then(function (me) {
      Auth.set({ key: linkKey, role: me.role, name: me.name });
      location.replace(NEXT);
    }).catch(function (err) {
      Auth.clear();
      busy(false);
      showMsg(err.code === 'UNAUTHORIZED' ? '이 링크는 더 이상 쓸 수 없어요. 비밀번호로 로그인하거나 새 링크를 받아 주세요.'
        : err.code === 'FORBIDDEN' ? '관리자 링크가 아니에요. 관리자 화면에서는 관리자 비밀번호만 쓸 수 있어요.'
          : err.message);
    });
    return;
  }

  // 이미 로그인한 상태
  if (Auth.get()) {
    location.replace(NEXT);
    return;
  }

  showMsg(Auth.takeFlash());
  $('pw').focus();

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pw = $('pw').value;
    if (!pw.trim()) {
      showMsg('비밀번호를 넣어 주세요');
      $('pw').focus();
      return;
    }
    busy(true);
    showMsg('');
    Api.call('auth.login', { password: pw }).then(function (r) {
      $('pw').value = '';
      Auth.set(r);
      location.replace(NEXT);
    }).catch(function (err) {
      busy(false);
      showMsg(err.message || '로그인하지 못했어요');
      $('pw').select();
    });
  });
})();
