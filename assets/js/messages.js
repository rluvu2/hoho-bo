/*
 * P3 메시지 — 예약 카드 + 템플릿으로 만든 안내 문구 미리보기·복사 (메시지는 화면에서 만든다)
 */
(function () {
  'use strict';

  if (!Auth.requireLogin()) return;
  UI.topbar('messages');

  var el = UI.el;
  var $ = UI.$;
  var MAX_ROWS = 200;
  var TPL_STORE = 'hoho_bo_template';
  // 이 칸이 비어 있으면 "시트에서 기사를 배정해 주세요" (필드 이름이 바뀌면 여기만)
  var DRIVER_LABELS = ['기사', '기사 연락처', '차종', '차량번호'];
  var state = { schema: null, templates: [], vars: {}, rows: [], seq: 0, selected: {}, filters: {} };
  var cards = $('cards');

  // 첫 화면: 기본 필터를 공개 초기값(SchemaDefaults)으로 짐작해 데이터도 동시에 요청한다.
  // 실제 스키마로 만든 기본 필터가 짐작과 같으면 그 결과를 쓰고, 다르면 다시 요청한다.
  var guess = defaultsFor({
    fields: SchemaDefaults.fields,
    filterOptions: { '상태': (SchemaDefaults.fields.filter(function (f) { return f.label === '상태'; })[0] || { options: [] }).options }
  });
  var seq = ++state.seq;
  var guessReq = Api.call('data.query', { filters: guess, view: 'p3', page: 1, pageSize: MAX_ROWS });
  guessReq.catch(function () { /* 짐작이 틀리면 쓰지 않으니 여기서 실패해도 그대로 둔다 */ });

  UI.loading(cards, '불러오는 중…');
  Promise.all([UI.getSchema(), Api.call('messages.templates', {})]).then(function (out) {
    state.schema = out[0];
    state.templates = out[1].templates || [];
    state.vars = out[1].vars || {};
    setupTemplates();
    var bar = Filters.create($('filters'), state.schema, {
      defaults: defaultsFor(state.schema),
      onChange: function (v) {
        state.filters = v;
        load();
      }
    });
    state.filters = bar.get();
    if (sameFilters(state.filters, guess)) {
      return guessReq.then(function (res) {
        if (seq !== state.seq) return;
        applyResult(res);
      });
    }
    load();
  }).catch(function (err) {
    UI.error(cards, err, function () { location.reload(); });
  });

  /** 기본 필터: 날짜 오늘~내일, 상태 접수·배차완료 */
  function defaultsFor(schema) {
    var d = { q: '', select: {}, range: {} };
    var today = UI.today();
    schema.fields.forEach(function (f) {
      if (f.p1Search === '기간' && f.type === 'date' && !Object.keys(d.range).length) {
        d.range[f.label] = { from: today, to: FormatCore.addDays(today, 1) };
      }
    });
    var opts = (schema.filterOptions || {})['상태'] || [];
    var want = ['접수', '배차완료'].filter(function (s) { return opts.indexOf(s) >= 0; });
    if (want.length) d.select['상태'] = want;
    return d;
  }

  /** 키 순서와 상관없이 같은 필터인지 */
  function sameFilters(a, b) {
    var canon = function (v) {
      if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
      if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(v[k]); }).join(',') + '}';
      return JSON.stringify(v);
    };
    return canon(a) === canon(b);
  }

  function applyResult(res) {
    state.rows = res.rows;
    state.columns = res.columns;
    state.total = res.total;
    state.selected = {};
    renderCards();
  }

  function setupTemplates() {
    var sel = $('tpl');
    UI.clear(sel);
    if (!state.templates.length) {
      sel.appendChild(el('option', { value: '', text: '사용 중인 템플릿이 없어요' }));
      sel.disabled = true;
      return;
    }
    var saved = '';
    try { saved = localStorage.getItem(TPL_STORE) || ''; } catch (e) { saved = ''; }
    state.templates.forEach(function (t, i) {
      sel.appendChild(el('option', { value: String(i), text: t.name, selected: t.name === saved }));
    });
    sel.addEventListener('change', function () {
      try { localStorage.setItem(TPL_STORE, currentTemplate() ? currentTemplate().name : ''); } catch (e) { /* 무시 */ }
      renderCards();
    });
  }

  function currentTemplate() {
    var i = parseInt($('tpl').value, 10);
    return isNaN(i) ? null : state.templates[i];
  }

  function load() {
    var seq = ++state.seq;
    UI.loading(cards);
    $('total').textContent = '';
    Api.call('data.query', { filters: state.filters, view: 'p3', page: 1, pageSize: MAX_ROWS }).then(function (res) {
      if (seq !== state.seq) return;
      applyResult(res);
    }).catch(function (err) {
      if (seq !== state.seq) return;
      UI.error(cards, err, load);
    });
  }

  function build(row) {
    var t = currentTemplate();
    if (!t) return { text: '', warnings: [] };
    var r = FormatCore.fillTemplate(t.body, row, { fields: state.schema.fields, vars: state.vars });
    var lines = [];
    var driverMissing = false;
    r.warnings.forEach(function (w) {
      if (w.type === 'empty' && DRIVER_LABELS.indexOf(w.label) >= 0) driverMissing = true;
      else lines.push(w.message);
    });
    if (driverMissing) lines.unshift('시트에서 기사를 배정해 주세요');
    return { text: r.text, warnings: lines };
  }

  function summaryItems(row) {
    var v = function (k) { return row[k] === undefined || row[k] === null ? '' : String(row[k]); };
    var items = [];
    var add = function (label, value) { if (value) items.push([label, value]); };
    add('항공편', v('항공편'));
    if (v('인원') || v('짐')) add('인원·짐', (v('인원') ? v('인원') + '명' : '') + (v('짐') !== '' ? ' · 짐 ' + v('짐') + '개' : ''));
    add('이름', v('이름'));
    add('연락처', v('연락처'));
    add('주소', v('주소'));
    var driver = [v('기사'), v('차종'), v('차량번호')].filter(function (x) { return x; }).join(' · ');
    add('기사', driver || '미배차');
    add('기사 연락처', v('기사 연락처'));
    return items;
  }

  function renderCards() {
    UI.clear(cards);
    var n = state.rows.length;
    $('total').textContent = state.total > n ? '총 ' + state.total + '건 중 ' + n + '건 (필터를 좁혀 주세요)' : '총 ' + n + '건';
    if (!n) {
      cards.appendChild(el('div', { class: 'state' }, [el('p', { text: '조건에 맞는 예약이 없어요' })]));
      updateSelection();
      return;
    }
    state.rows.forEach(function (row) {
      var msg = build(row);
      var id = row.ID;
      var cb = el('input', { type: 'checkbox', 'aria-label': (row['이름'] || '') + ' 선택', checked: !!state.selected[id] });
      var card = el('article', { class: 'mcard' + (state.selected[id] ? ' is-selected' : '') });
      cb.addEventListener('change', function () {
        if (cb.checked) state.selected[id] = true;
        else delete state.selected[id];
        card.classList.toggle('is-selected', cb.checked);
        updateSelection();
      });
      var when = [UI.fmtDate(row['날짜']), row['시간'] ? UI.fmtTime(row['시간']) : ''].filter(function (x) { return x; }).join(' ');
      var sum = el('dl', { class: 'mcard-sum' });
      summaryItems(row).forEach(function (it) {
        sum.appendChild(el('dt', { text: it[0] }));
        sum.appendChild(el('dd', { text: it[1] }));
      });
      var copyBtn = el('button', { type: 'button', class: 'btn', text: '복사', disabled: !msg.text });
      copyBtn.addEventListener('click', function () { UI.copyWithFeedback(build(row).text, '메시지를 복사했어요'); });
      card.appendChild(el('div', { class: 'mcard-head' }, [
        cb,
        row['구분'] ? el('span', { class: 'badge badge-' + row['구분'], text: row['구분'] }) : null,
        el('span', { class: 'mcard-when', text: when }),
        row['상태'] ? el('span', { class: 'badge badge-' + row['상태'], text: row['상태'] }) : null,
        el('span', { class: 'mcard-id', text: id })
      ]));
      card.appendChild(sum);
      if (msg.text) card.appendChild(el('pre', { class: 'mcard-msg', text: msg.text }));
      if (msg.warnings.length) {
        card.appendChild(el('ul', { class: 'mcard-warn', role: 'note' }, msg.warnings.map(function (w) { return el('li', { text: w }); })));
      }
      card.appendChild(el('div', { class: 'mcard-foot' }, [copyBtn]));
      cards.appendChild(card);
    });
    updateSelection();
  }

  function selectedRows() {
    return state.rows.filter(function (r) { return state.selected[r.ID]; });
  }

  function updateSelection() {
    var sel = selectedRows().length;
    var btn = $('copySelected');
    btn.disabled = !sel || !currentTemplate();
    btn.textContent = sel ? '선택 복사 (' + sel + ')' : '선택 복사';
    var all = $('checkAll');
    all.checked = sel > 0 && sel === state.rows.length;
    all.indeterminate = sel > 0 && sel < state.rows.length;
  }

  $('checkAll').addEventListener('change', function () {
    var on = $('checkAll').checked;
    state.selected = {};
    if (on) state.rows.forEach(function (r) { state.selected[r.ID] = true; });
    renderCards();
  });

  $('copySelected').addEventListener('click', function () {
    var texts = selectedRows().map(function (r) { return build(r).text; }).filter(function (t) { return t; });
    if (texts.length) UI.copyWithFeedback(texts.join('\n\n'), texts.length + '건을 복사했어요');
  });
})();
