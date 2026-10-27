/*
 * P1 데이터 확인 — 필터, 정렬, 50건씩 페이지, 행 자세히 (읽기 전용)
 */
(function () {
  'use strict';

  if (!Auth.requireLogin()) return;
  UI.topbar('data');

  var el = UI.el;
  var $ = UI.$;
  var PAGE_SIZE = 50;
  var state = { schema: null, filters: {}, sort: null, page: 1, seq: 0, res: null, types: {} };
  var box = $('tableBox');

  // 첫 화면: 필터가 비어 있는 기본값이라 스키마를 기다리지 않고 데이터도 동시에 요청한다
  UI.loading(box, '불러오는 중…');
  var seq = ++state.seq;
  Promise.all([
    UI.getSchema(),
    Api.call('data.query', { filters: { q: '', select: {}, range: {} }, sort: null, page: 1, pageSize: PAGE_SIZE, view: 'p1' })
  ]).then(function (out) {
    var sc = out[0];
    state.schema = sc;
    sc.fields.forEach(function (f) { state.types[f.label] = f.type; });
    var bar = Filters.create($('filters'), sc, {
      defaults: {},
      onChange: function (v) {
        state.filters = v;
        state.page = 1;
        load();
      }
    });
    state.filters = bar.get();
    if (seq !== state.seq) return;
    state.res = out[1];
    render(out[1]);
  }).catch(function (err) {
    UI.error(box, err, function () { location.reload(); });
  });

  function load() {
    var seq = ++state.seq;
    UI.loading(box);
    $('total').textContent = '';
    UI.clear($('pager'));
    Api.call('data.query', { filters: state.filters, sort: state.sort, page: state.page, pageSize: PAGE_SIZE, view: 'p1' }).then(function (res) {
      if (seq !== state.seq) return;
      state.res = res;
      render(res);
    }).catch(function (err) {
      if (seq !== state.seq) return;
      UI.error(box, err, load);
    });
  }

  function sortBy(label) {
    if (state.sort && state.sort.field === label) state.sort = { field: label, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' };
    else state.sort = { field: label, dir: 'asc' };
    state.page = 1;
    load();
  }

  function cell(v, type, label) {
    var td = el('td');
    if (v === '' || v === null || v === undefined) return td;
    if (type === 'date') {
      td.className = 'nowrap';
      td.textContent = UI.fmtDateShort(v);
    } else if (type === 'time') {
      td.className = 'nowrap';
      td.appendChild(document.createTextNode(String(v)));
      if (/^\d{2}:\d{2}$/.test(String(v))) td.appendChild(el('span', { class: 'sub', text: FormatCore.ampmOf(v) }));
    } else if (type === 'number') {
      td.className = 'num';
      td.textContent = UI.fmtNumber(v);
    } else if (type === 'select' && (label === '상태' || label === '구분')) {
      td.appendChild(el('span', { class: 'badge badge-' + String(v), text: String(v) }));
    } else if (type === 'longtext') {
      td.className = 'clip';
      td.textContent = String(v).replace(/\n/g, ' ');
      td.setAttribute('title', String(v));
    } else {
      td.className = type === 'phone' || type === 'flight' ? 'nowrap' : '';
      td.textContent = String(v);
    }
    return td;
  }

  function render(res) {
    UI.clear(box);
    $('total').textContent = '총 ' + res.total.toLocaleString('ko-KR') + '건';
    var cols = res.columns.concat([{ label: 'ID', type: 'text' }]);
    var head = el('tr', null, cols.map(function (c) {
      var active = state.sort && state.sort.field === c.label;
      var dir = active ? state.sort.dir : '';
      var btn = el('button', { type: 'button', class: 'sort-btn', 'aria-label': c.label + ' 정렬' }, [
        el('span', { text: c.label }),
        el('span', { class: 'sort-ind', 'aria-hidden': 'true', text: dir === 'asc' ? '▲' : (dir === 'desc' ? '▼' : '') })
      ]);
      btn.addEventListener('click', function () { sortBy(c.label); });
      return el('th', { scope: 'col', 'aria-sort': dir === 'asc' ? 'ascending' : (dir === 'desc' ? 'descending' : null) }, [btn]);
    }));
    var body = el('tbody');
    if (!res.rows.length) {
      body.appendChild(el('tr', { class: 'empty-row' }, [el('td', { colspan: String(cols.length), text: '조건에 맞는 예약이 없어요' })]));
    }
    res.rows.forEach(function (row) {
      var tr = el('tr', { tabindex: '0', 'aria-label': (row['이름'] || '') + ' 예약 자세히 보기' });
      res.columns.forEach(function (c) { tr.appendChild(cell(row[c.label], c.type, c.label)); });
      tr.appendChild(el('td', { class: 'id', text: row.ID }));
      tr.addEventListener('click', function () { openDetail(row, res.columns); });
      tr.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetail(row, res.columns);
        }
      });
      body.appendChild(tr);
    });
    box.appendChild(el('table', { class: 'data' }, [el('thead', null, [head]), body]));
    renderPager(res);
  }

  function renderPager(res) {
    var p = $('pager');
    UI.clear(p);
    if (res.pages <= 1) return;
    var prev = el('button', { type: 'button', class: 'btn btn-sm', text: '← 이전', disabled: res.page <= 1 });
    var next = el('button', { type: 'button', class: 'btn btn-sm', text: '다음 →', disabled: res.page >= res.pages });
    prev.addEventListener('click', function () { state.page = res.page - 1; load(); });
    next.addEventListener('click', function () { state.page = res.page + 1; load(); });
    p.appendChild(prev);
    p.appendChild(el('span', { class: 'muted', text: res.page + ' / ' + res.pages + ' 페이지' }));
    p.appendChild(next);
  }

  function openDetail(row, columns) {
    var dl = $('detailList');
    UI.clear(dl);
    columns.concat([{ label: 'ID', type: 'text' }]).forEach(function (c) {
      var v = UI.fmtValue(row[c.label], c.type);
      dl.appendChild(el('dt', { text: c.label }));
      dl.appendChild(el('dd', { text: v === '' ? '—' : v }));
    });
    $('detailTitle').textContent = (row['이름'] || '예약') + ' · ' + (row['구분'] || '');
    $('detail').showModal();
    $('detailClose').focus();
  }

  $('detailClose').addEventListener('click', function () { $('detail').close(); });
  $('detail').addEventListener('click', function (e) {
    if (e.target === $('detail')) $('detail').close(); // 바깥(배경) 누르면 닫기
  });
})();
