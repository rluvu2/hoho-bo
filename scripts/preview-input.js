#!/usr/bin/env node
/*
 * ② 입력 화면(P2) 미리보기 만들기 (Node 내장 기능만)
 *
 *   node scripts/preview-input.js   → backend/preview/input.html
 *   node scripts/serve.js           → http://localhost:8080/backend/preview/input.html
 *
 * Index.html 의 include_() 를 펼치고, google.script.run 을 가짜(브라우저 안에서 FormatCore 로
 * 서버 흉내)로 바꾼다. Gemini 는 부르지 않고 가짜 보정본을 만들어 비교 화면까지 확인할 수 있다.
 * 비밀번호: preview1234 · 주소 끝에 #k=preview-key-0000000000000000 을 붙이면 자동로그인.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INPUT = path.join(ROOT, 'backend', 'input-gas');
const OUT_DIR = path.join(ROOT, 'backend', 'preview');

// 가짜 google.script (브라우저에서 실행됨). SchemaDefaults 는 앞에 함께 넣는다.
function fakeGoogle() {
  var PW = 'preview1234';
  var KEY = 'preview-key-0000000000000000';
  var saved = [];
  var reqs = {};

  function ok(data) { return { ok: true, data: data }; }
  function err(code, message, details) { return { ok: false, error: { code: code, message: message, details: details || null } }; }
  function schema() {
    return {
      fields: SchemaDefaults.fields.map(function (f) { return { label: f.label, type: f.type, required: f.required, options: f.options, input: f.input }; }),
      forms: SchemaDefaults.forms
    };
  }
  function opts() { return { today: FormatCore.todaySeoul(), rolloverDays: 30 }; }
  function authed(key) { return key === KEY; }

  function changedFields(before, after) {
    var nth = function (recs) { var c = {}; return recs.map(function (r) { c[r.form] = (c[r.form] || 0) + 1; return r.form + '#' + c[r.form]; }); };
    var bk = nth(before.records), ak = nth(after.records), out = [];
    before.records.forEach(function (rb, i) {
      var j = ak.indexOf(bk[i]);
      if (!rb.form || j < 0) return;
      Object.keys(rb.fields).forEach(function (lb) {
        var fb = rb.fields[lb];
        if (fb.error || fb.value === '') return;
        var va = after.records[j].fields[lb] ? after.records[j].fields[lb].value : '';
        if (va !== fb.value) out.push({ record: j + 1, form: after.records[j].form, label: lb, before: fb.value, after: va });
      });
    });
    return out;
  }

  var FAKE = {
    inputLogin: function (pw) {
      return String(pw).trim() === PW ? ok({ key: KEY, role: 'user', name: '미리보기 사용자' }) : err('UNAUTHORIZED', '비밀번호가 맞지 않아요 (미리보기: ' + PW + ')');
    },
    inputMe: function (key) {
      return authed(key) ? ok({ role: 'user', name: '미리보기 사용자' }) : err('UNAUTHORIZED', '로그인이 풀렸어요');
    },
    inputSchema: function (key) {
      if (!authed(key)) return err('UNAUTHORIZED', '로그인이 필요해요');
      var s = schema();
      var blank = {};
      s.forms.forEach(function (f) { blank[f.name] = FormatCore.blankForm(s, f.name); });
      return ok({ fields: s.fields, forms: s.forms, blankForms: blank, formatVersion: FormatCore.VERSION, maxText: FormatCore.MAX_TEXT, rolloverDays: 30, today: FormatCore.todaySeoul() });
    },
    // 가짜 보정: 맞는 값은 그대로, 문제 칸은 비우고, 양식 밖 문장은 인사말이면 버리고 나머지는 메모로
    inputAiFix: function (key, text) {
      if (!authed(key)) return err('UNAUTHORIZED', '로그인이 필요해요');
      var s = schema();
      var before = FormatCore.parse(text, s, opts());
      var dropped = [], memoExtra = [], notes = ['미리보기용 가짜 보정이에요 (Gemini 를 부르지 않음)'];
      before.errors.forEach(function (e) {
        var m = /^양식에 없는 문장이에요: (.*)$/.exec(e.message);
        if (!m) return;
        if (/안녕|감사|부탁드립니다$|수고/.test(m[1])) dropped.push(m[1]); else memoExtra.push(m[1]);
      });
      var recs = before.records.filter(function (r) { return r.form; }).map(function (r) {
        var values = {};
        Object.keys(r.fields).forEach(function (lb) {
          var f = r.fields[lb];
          if (!f.error) values[lb] = f.value;
          else if (f.raw) notes.push(lb + ' "' + f.raw + '" 는 원문만으로 정할 수 없어 비워 뒀어요');
        });
        return { form: r.form, values: values };
      });
      if (recs.length && memoExtra.length) recs[0].values['메모'] = [recs[0].values['메모']].concat(memoExtra).filter(Boolean).join('\n');
      if (!recs.length) return err('AI_ERROR', 'AI가 양식을 만들지 못했어요. 직접 고쳐 주세요');
      var fixed = FormatCore.buildText(s, recs);
      var after = FormatCore.parse(fixed, s, opts());
      return ok({ text: fixed, before: before, after: after, changedFields: changedFields(before, after), notes: notes, dropped: dropped });
    },
    // 여러 칸(items)을 한 번에: 한 칸이라도 문제면 아무것도 저장하지 않는다 (서버 Submit.gs 흉내)
    inputSubmit: function (key, p) {
      if (!authed(key)) return err('UNAUTHORIZED', '로그인이 필요해요');
      if (p.formatVersion !== FormatCore.VERSION) return err('VERSION', '화면을 새로고침해 주세요', { client: p.formatVersion, server: FormatCore.VERSION });
      if (reqs[p.requestId]) return ok(reqs[p.requestId]);
      var items = p.items || [{ text: p.text, expected: p.expected }];
      var problems = [], diffs = [], parsedAll = [];
      items.forEach(function (it, b) {
        var parsed = FormatCore.parse(it.text, schema(), opts());
        parsedAll.push(parsed);
        if (!parsed.ok) {
          parsed.errors.forEach(function (e) { problems.push('답장 ' + (b + 1) + ' · ' + e.message); });
          if (!parsed.errors.length) problems.push('답장 ' + (b + 1) + ' · 칸에 문제가 있어요');
          return;
        }
        parsed.records.forEach(function (rec, i) {
          var ef = (it.expected[i] || {}).fields || {};
          Object.keys(rec.fields).forEach(function (lb) {
            if (String(ef[lb]) !== rec.fields[lb].value) diffs.push({ box: b + 1, record: i + 1, label: lb, expected: ef[lb], actual: rec.fields[lb].value });
          });
        });
      });
      if (problems.length) return err('VALIDATION', '양식에 맞지 않는 값이 있어 아무것도 저장하지 않았어요', { problems: problems });
      if (diffs.length) return err('MISMATCH', '화면과 서버가 읽은 값이 달라요', { diffs: diffs });
      var valuesOf = function (rec) { var v = {}; Object.keys(rec.fields).forEach(function (k) { v[k] = rec.fields[k].value; }); return v; };
      var keyOf = function (v) { return [v['구분'], v['날짜'], v['시간'], String(v['이름']).toLowerCase()].join('|'); };
      if (!p.allowDuplicate) {
        var dups = [];
        var seen = {};
        parsedAll.forEach(function (parsed, b) {
          parsed.records.forEach(function (rec, i) {
            var v = valuesOf(rec);
            saved.forEach(function (s) { if (keyOf(s.values) === keyOf(v)) dups.push({ box: b + 1, record: i + 1, id: s.id, summary: { '구분': s.values['구분'], '날짜': s.values['날짜'], '시간': s.values['시간'], '이름': s.values['이름'], '상태': '접수' } }); });
            if (seen[keyOf(v)]) dups.push({ box: b + 1, record: i + 1, id: '', summary: { '안내': '이번에 저장하는 글 안에 같은 예약이 또 있어요 (답장 ' + seen[keyOf(v)] + ')' } });
            else seen[keyOf(v)] = b + 1;
          });
        });
        if (dups.length) return err('DUPLICATE', '같은 예약이 이미 있어요. 그래도 저장할까요?', { duplicates: dups });
      }
      var all = [];
      var boxes = parsedAll.map(function (parsed) {
        return {
          ids: parsed.records.map(function (rec) {
            var id = FormatCore.todaySeoul().replace(/-/g, '').slice(2) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
            saved.push({ id: id, values: valuesOf(rec) });
            all.push(id);
            return id;
          })
        };
      });
      reqs[p.requestId] = { ids: all, boxes: boxes };
      return ok(reqs[p.requestId]);
    }
  };

  function Runner(okFn, failFn) { this._ok = okFn; this._fail = failFn; }
  Runner.prototype.withSuccessHandler = function (f) { return new Runner(f, this._fail); };
  Runner.prototype.withFailureHandler = function (f) { return new Runner(this._ok, f); };
  Object.keys(FAKE).forEach(function (name) {
    Runner.prototype[name] = function () {
      var args = arguments;
      var self = this;
      setTimeout(function () {
        var r;
        try { r = FAKE[name].apply(null, args); } catch (e) { if (self._fail) self._fail(e); return; }
        if (self._ok) self._ok(JSON.parse(JSON.stringify(r)));
      }, name === 'inputAiFix' ? 900 : 300);
    };
  });

  window.google = {
    script: {
      run: new Runner(null, null),
      url: { getLocation: function (cb) { setTimeout(function () { cb({ hash: location.hash.replace(/^#/, ''), parameter: {}, parameters: {} }); }, 0); } },
      history: { replace: function () { history.replaceState(null, '', location.pathname + location.search); } }
    }
  };
}

function build() {
  const read = (name) => fs.readFileSync(path.join(INPUT, name), 'utf8');
  let html = read('Index.html');
  html = html.replace(/<\?!=\s*include_\('([A-Za-z0-9_]+)'\);?\s*\?>/g, (m, name) => read(name + '.html'));
  html = html.replace(/<\?=\s*appName\s*\?>/g, '호호모빌리티 백오피스 (미리보기)');
  if (/<\?/.test(html)) throw new Error('펼치지 못한 스크립틀릿이 남았어요');
  const defaults = fs.readFileSync(path.join(ROOT, 'assets', 'js', 'schema-defaults.js'), 'utf8');
  const fake = '<script>\n' + defaults + '\n(' + fakeGoogle.toString() + ')();\n</script>\n';
  const banner = '<div style="background:#fff4d6;color:#8a5a00;padding:6px 16px;font:13px sans-serif">미리보기 — 가짜 서버 · 비밀번호 preview1234 · 저장은 이 탭 안에서만</div>\n';
  html = html.replace('<body>', '<body>\n' + banner).replace('<script>', fake + '<script>');
  html = html.replace('<head>', '<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <link rel="icon" href="data:,">');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, 'input.html');
  fs.writeFileSync(out, html, 'utf8');
  return out;
}

module.exports = { build };

if (require.main === module) {
  console.log('만듦: ' + path.relative(ROOT, build()).replace(/\\/g, '/'));
}
