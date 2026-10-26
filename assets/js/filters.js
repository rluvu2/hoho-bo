/*
 * 필터 막대 — 필드 시트의 'P1 검색' 설정으로 자동 구성 (P1·P3 공용)
 * 키워드 입력 1칸 + 선택 필드별 드롭다운(여러 개 선택) + 기간 필드별 시작·끝 날짜, 최대 6개.
 */
var Filters = (function () {
  'use strict';

  var MAX_CONTROLS = 6;
  var EMPTY_LABEL = '(비어 있음)';
  var el = UI.el;

  /**
   * container 에 필터 막대를 만든다.
   * opts = { defaults: { q, select, range }, onChange(value) }
   * → { get(), set(value), reset() }
   */
  function create(container, schema, opts) {
    opts = opts || {};
    var fields = schema.fields || [];
    var kw = fields.filter(function (f) { return f.p1Search === '키워드'; });
    var selects = fields.filter(function (f) { return f.p1Search === '선택'; });
    var ranges = fields.filter(function (f) { return f.p1Search === '기간'; });
    var budget = MAX_CONTROLS - (kw.length ? 1 : 0);
    ranges = ranges.slice(0, budget);
    selects = selects.slice(0, Math.max(0, budget - ranges.length));

    var controls = { q: null, select: {}, range: {} };
    var form = el('form', { class: 'filters', role: 'search' });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      fire();
    });

    if (kw.length) {
      var q = el('input', { type: 'search', id: 'f-q', class: 'input', maxlength: '100', placeholder: kw.map(function (f) { return f.label; }).join('·') + ' 검색', autocomplete: 'off' });
      controls.q = q;
      form.appendChild(el('div', { class: 'filter filter-q' }, [el('label', { for: 'f-q', class: 'filter-label', text: '검색' }), q]));
    }

    ranges.forEach(function (f, i) {
      var from = el('input', { type: 'date', class: 'input', id: 'f-r' + i + 'a', 'aria-label': f.label + ' 시작' });
      var to = el('input', { type: 'date', class: 'input', id: 'f-r' + i + 'b', 'aria-label': f.label + ' 끝' });
      from.addEventListener('change', fire);
      to.addEventListener('change', fire);
      controls.range[f.label] = { from: from, to: to };
      form.appendChild(el('div', { class: 'filter filter-range' }, [
        el('label', { for: from.id, class: 'filter-label', text: f.label }),
        el('div', { class: 'range' }, [from, el('span', { class: 'muted', text: '~' }), to])
      ]));
    });

    selects.forEach(function (f, i) {
      var options = ((schema.filterOptions || {})[f.label] || f.options || []).slice();
      options.push('');
      var boxes = options.map(function (opt, j) {
        var id = 'f-s' + i + '-' + j;
        var cb = el('input', { type: 'checkbox', id: id, value: opt });
        cb.addEventListener('change', function () {
          updateSummary();
          fire();
        });
        return { cb: cb, row: el('label', { for: id, class: 'ms-option' }, [cb, el('span', { text: opt === '' ? EMPTY_LABEL : opt })]) };
      });
      var summary = el('summary', { class: 'ms-summary' });
      var details = el('details', { class: 'ms' }, [summary, el('div', { class: 'ms-panel' }, boxes.map(function (b) { return b.row; }))]);
      function updateSummary() {
        var on = boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.cb.value === '' ? EMPTY_LABEL : b.cb.value; });
        summary.textContent = on.length === 0 ? '전체' : (on.length <= 2 ? on.join(', ') : on[0] + ' 외 ' + (on.length - 1));
      }
      controls.select[f.label] = { boxes: boxes, update: updateSummary };
      updateSummary();
      form.appendChild(el('div', { class: 'filter filter-select' }, [el('span', { class: 'filter-label', text: f.label }), details]));
    });

    var resetBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: '필터 초기화' });
    resetBtn.addEventListener('click', function () {
      reset();
      fire();
    });
    form.appendChild(el('div', { class: 'filter filter-actions' }, [
      el('button', { type: 'submit', class: 'btn btn-primary', text: '검색' }),
      resetBtn
    ]));
    container.appendChild(form);

    // 바깥을 누르면 드롭다운 닫기
    document.addEventListener('click', function (e) {
      Array.prototype.forEach.call(form.querySelectorAll('details.ms[open]'), function (d) {
        if (!d.contains(e.target)) d.removeAttribute('open');
      });
    });
    form.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      Array.prototype.forEach.call(form.querySelectorAll('details.ms[open]'), function (d) {
        d.removeAttribute('open');
        d.querySelector('summary').focus();
      });
    });

    function get() {
      var v = { q: controls.q ? controls.q.value.trim() : '', select: {}, range: {} };
      Object.keys(controls.select).forEach(function (lb) {
        var on = controls.select[lb].boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.cb.value; });
        if (on.length) v.select[lb] = on;
      });
      Object.keys(controls.range).forEach(function (lb) {
        var r = controls.range[lb];
        if (r.from.value || r.to.value) v.range[lb] = { from: r.from.value, to: r.to.value };
      });
      return v;
    }

    function set(v) {
      v = v || {};
      if (controls.q) controls.q.value = v.q || '';
      Object.keys(controls.select).forEach(function (lb) {
        var want = (v.select && v.select[lb]) || [];
        controls.select[lb].boxes.forEach(function (b) { b.cb.checked = want.indexOf(b.cb.value) >= 0; });
        controls.select[lb].update();
      });
      Object.keys(controls.range).forEach(function (lb) {
        var r = (v.range && v.range[lb]) || {};
        controls.range[lb].from.value = r.from || '';
        controls.range[lb].to.value = r.to || '';
      });
    }

    function reset() {
      set(opts.defaults || {});
    }

    function fire() {
      if (opts.onChange) opts.onChange(get());
    }

    reset();
    return { get: get, set: set, reset: reset };
  }

  return { create: create };
})();
