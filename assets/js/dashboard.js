/*
 * P4 대시보드 — 기간 프리셋·단위, KPI 8개, 차트 4개 (집계는 서버 dashboard.get)
 */
(function () {
  'use strict';

  if (!Auth.requireLogin()) return;
  UI.topbar('dashboard');

  var el = UI.el;
  var $ = UI.$;
  var PRESETS = [['today', '오늘'], ['week', '이번 주'], ['month', '이번 달'], ['lastMonth', '지난달'], ['last30', '최근 30일'], ['custom', '직접 선택']];
  var UNITS = [['day', '일'], ['week', '주'], ['month', '월']];
  var UP_IS_BAD = ['unpaid', 'unassigned']; // 늘면 나쁜 지표
  var state = { preset: 'month', unit: 'day', from: '', to: '', data: null, seq: 0, loaded: false };

  // ------------------------------------------------------------ 기간

  function lastDayOf(iso) {
    var y = +iso.slice(0, 4);
    var m = +iso.slice(5, 7);
    return iso.slice(0, 8) + ('0' + new Date(Date.UTC(y, m, 0)).getUTCDate()).slice(-2);
  }

  function rangeOf(preset) {
    var t = UI.today();
    switch (preset) {
      case 'today': return [t, t];
      case 'week': {
        var wd = '일월화수목금토'.indexOf(FormatCore.weekdayOf(t));
        var mon = FormatCore.addDays(t, -((wd + 6) % 7));
        return [mon, FormatCore.addDays(mon, 6)];
      }
      case 'month': return [t.slice(0, 8) + '01', lastDayOf(t)];
      case 'lastMonth': {
        var prevEnd = FormatCore.addDays(t.slice(0, 8) + '01', -1);
        return [prevEnd.slice(0, 8) + '01', prevEnd];
      }
      case 'last30': return [FormatCore.addDays(t, -29), t];
    }
    return [state.from || t, state.to || t];
  }

  function autoUnit(from, to) {
    var days = FormatCore.diffDays(to, from) + 1;
    return days > 186 ? 'month' : (days > 62 ? 'week' : 'day');
  }

  function segButtons(box, items, current, onPick) {
    UI.clear(box);
    items.forEach(function (it) {
      var b = el('button', { type: 'button', 'aria-pressed': it[0] === current ? 'true' : 'false', text: it[1] });
      b.addEventListener('click', function () { onPick(it[0]); });
      box.appendChild(b);
    });
  }

  function renderControls() {
    segButtons($('presets'), PRESETS, state.preset, function (p) {
      state.preset = p;
      if (p !== 'custom') {
        var r = rangeOf(p);
        state.from = r[0];
        state.to = r[1];
        state.unit = autoUnit(state.from, state.to);
      }
      renderControls();
      load();
    });
    segButtons($('units'), UNITS, state.unit, function (u) {
      state.unit = u;
      renderControls();
      load();
    });
    $('customBox').hidden = state.preset !== 'custom';
    $('from').value = state.from;
    $('to').value = state.to;
  }

  function onCustomChange() {
    var f = $('from').value;
    var t = $('to').value;
    if (!f || !t) return;
    if (f > t) {
      $('periodNote').textContent = '시작 날짜가 끝 날짜보다 늦어요';
      return;
    }
    state.from = f;
    state.to = t;
    load();
  }
  $('from').addEventListener('change', onCustomChange);
  $('to').addEventListener('change', onCustomChange);

  // ------------------------------------------------------------ 불러오기

  function load() {
    var seq = ++state.seq;
    var dash = $('dash');
    if (state.loaded) dash.classList.add('is-stale'); // 이전 그림을 흐리게 유지 (깜빡임 없음)
    else UI.loading($('kpis'), '집계하는 중…');
    $('periodNote').textContent = shortRange(state.from, state.to) + ' 집계 중…';
    Api.call('dashboard.get', { from: state.from, to: state.to, unit: state.unit }).then(function (d) {
      if (seq !== state.seq) return;
      state.data = d;
      state.loaded = true;
      dash.classList.remove('is-stale');
      render(d);
    }).catch(function (err) {
      if (seq !== state.seq) return;
      dash.classList.remove('is-stale');
      UI.error($('kpis'), err, load);
      $('periodNote').textContent = '';
    });
  }

  function shortRange(a, b) {
    return a === b ? UI.fmtDate(a) : UI.fmtDate(a) + ' ~ ' + UI.fmtDate(b);
  }

  // ------------------------------------------------------------ KPI

  function fmtKpi(v, format) {
    if (v === null || v === undefined) return '—';
    switch (format) {
      case 'count': return v.toLocaleString('ko-KR') + '건';
      case 'people': return v.toLocaleString('ko-KR') + '명';
      case 'won': return v.toLocaleString('ko-KR') + '원';
      case 'percent': return (v > 0 ? '+' : '') + v.toLocaleString('ko-KR') + '%';
      case 'pair': return '도착 ' + v.arrive + ' · 출발 ' + v.depart;
    }
    return String(v);
  }

  function kpiCard(k, period) {
    var delta = el('div', { class: 'kpi-delta' });
    if (k.key === 'revenueGrowth') {
      delta.appendChild(document.createTextNode('직전 기간 매출 ' + fmtKpi(k.prev, 'won')));
    } else if (k.change === null || k.change === undefined) {
      delta.appendChild(document.createTextNode('직전 기간 ' + fmtKpi(k.prev, k.format)));
    } else if (k.change === 0) {
      delta.appendChild(document.createTextNode('직전 기간과 같아요'));
    } else {
      var up = k.change > 0;
      var good = up !== (UP_IS_BAD.indexOf(k.key) >= 0);
      delta.appendChild(el('span', { class: good ? 'up' : 'down', text: (up ? '▲ ' : '▼ ') + Math.abs(k.change) + '%' }));
      delta.appendChild(document.createTextNode(' 직전 ' + fmtKpi(k.prev, k.format)));
    }
    return el('div', { class: 'kpi' }, [
      el('div', { class: 'kpi-label', text: k.label }),
      el('div', { class: 'kpi-value' + (k.format === 'pair' ? ' is-pair' : ''), text: fmtKpi(k.value, k.format) }),
      delta
    ]);
  }

  // ------------------------------------------------------------ 그리기

  function render(d) {
    var p = d.period;
    $('periodNote').textContent = shortRange(p.from, p.to) + ' (' + p.days + '일) · 비교: 직전 같은 기간 ' +
      UI.fmtDateShort(p.prevFrom) + ' ~ ' + UI.fmtDateShort(p.prevTo);
    var kp = $('kpis');
    UI.clear(kp);
    d.kpis.forEach(function (k) { kp.appendChild(kpiCard(k, p)); });
    drawCharts(d);
  }

  function drawCharts(d) {
    var c = d.charts;
    Charts.hideTip();
    Charts.line($('chRevenue'), { labels: c.revenue.labels, values: c.revenue.values, name: '매출', kind: 'won' });
    Charts.table($('tbRevenue'), ['기간', '매출'], c.revenue.labels.map(function (lb, i) { return [lb, Charts.full(c.revenue.values[i], 'won')]; }));

    var lg = $('lgCounts');
    UI.clear(lg);
    lg.appendChild(el('span', null, [el('i', { class: 'k1', 'aria-hidden': 'true' }), document.createTextNode(c.counts.arriveLabel)]));
    lg.appendChild(el('span', null, [el('i', { class: 'k2', 'aria-hidden': 'true' }), document.createTextNode(c.counts.departLabel)]));
    Charts.grouped($('chCounts'), {
      labels: c.counts.labels,
      kind: 'count',
      series: [
        { name: c.counts.arriveLabel, values: c.counts.arrive, cls: 's1' },
        { name: c.counts.departLabel, values: c.counts.depart, cls: 's2' }
      ]
    });
    Charts.table($('tbCounts'), ['기간', c.counts.arriveLabel, c.counts.departLabel], c.counts.labels.map(function (lb, i) {
      return [lb, Charts.full(c.counts.arrive[i], 'count'), Charts.full(c.counts.depart[i], 'count')];
    }));

    var top = c.drivers.slice(0, 10);
    Charts.hbars($('chDrvCount'), { name: '운행 건수', kind: 'count', rows: top.map(function (x) { return { label: x.name, value: x.count }; }) });
    Charts.hbars($('chDrvPay'), { name: '정산액', kind: 'won', rows: top.map(function (x) { return { label: x.name, value: x.payout }; }) });
    Charts.table($('tbDrivers'), ['기사', '운행 건수', '정산액'], c.drivers.map(function (x) {
      return [x.name, Charts.full(x.count, 'count'), Charts.full(x.payout, 'won')];
    }));

    var hourLabels = c.hours.map(function (_, h) { return String(h); });
    Charts.columns($('chHours'), {
      labels: hourLabels,
      tipLabels: c.hours.map(function (_, h) { return h + '시대'; }),
      values: c.hours, name: '예약', kind: 'count'
    });
    Charts.table($('tbHours'), ['시간대', '예약'], c.hours.map(function (v, h) { return [h + '시', Charts.full(v, 'count')]; }));
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (state.data) drawCharts(state.data); }, 200);
  });

  // 시작: 이번 달
  var r = rangeOf(state.preset);
  state.from = r[0];
  state.to = r[1];
  state.unit = autoUnit(state.from, state.to);
  renderControls();
  load();
})();
