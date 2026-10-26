/*
 * 직접 그리는 SVG 차트 (CDN 없음) — 선, 묶은 막대, 가로 막대, 세로 막대
 * 규칙: 축은 하나, 막대 두께 24px 이하·끝만 4px 둥글게, 선 2px, 격자는 얇은 실선,
 * 마우스·키보드 툴팁(값이 앞, 이름이 뒤), 모든 차트에 '표로 보기'. 글자는 textContent 로만.
 * 색: 1번 #2a78d6, 2번 #eb6834 (흰 배경에서 검증함, app.css 의 --c1·--c2)
 */
var Charts = (function () {
  'use strict';

  var el = UI.el;
  var svg = UI.svg;
  var H = 240;
  var M = { top: 18, right: 18, bottom: 30, left: 52 };
  var BAR_MAX = 24;
  var GAP = 2;
  var tipEl = null;

  // ------------------------------------------------------------ 눈금·형식

  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var f = raw / p;
    var nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * p;
  }

  /** 0 부터 max 를 덮는 깔끔한 눈금 (정수만) */
  function ticks(max, count) {
    if (!(max > 0)) return [0, 1];
    var step = Math.max(1, niceStep(max / (count || 4)));
    var out = [];
    for (var v = 0; v <= max + step * 0.999; v += step) out.push(Math.round(v));
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }

  /** 축 눈금용 짧은 글자: 원은 만·억 단위 */
  function compact(v, kind) {
    if (kind !== 'won') return v.toLocaleString('ko-KR');
    if (v >= 100000000) return +(v / 100000000).toFixed(1) + '억';
    if (v >= 10000) return +(v / 10000).toFixed(1) + '만';
    return v.toLocaleString('ko-KR');
  }

  function full(v, kind) {
    var n = (v || 0).toLocaleString('ko-KR');
    if (kind === 'won') return n + '원';
    if (kind === 'count') return n + '건';
    return n;
  }

  // ------------------------------------------------------------ 툴팁 (하나를 같이 씀)

  function tip() {
    if (!tipEl) {
      tipEl = el('div', { class: 'chart-tip', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }

  /** rows: [{ value, label, key }] — 값이 앞(굵게), 이름이 뒤 */
  function showTip(title, rows, x, y) {
    var t = tip();
    UI.clear(t);
    t.appendChild(el('div', { class: 'chart-tip-title', text: title }));
    rows.forEach(function (r) {
      t.appendChild(el('div', { class: 'chart-tip-row' }, [
        r.key ? el('span', { class: 'chart-tip-key ' + r.key, 'aria-hidden': 'true' }) : null,
        el('strong', { text: r.value }),
        el('span', { class: 'chart-tip-name', text: r.label })
      ]));
    });
    t.classList.add('is-on');
    var w = t.offsetWidth;
    var h = t.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 12));
    var top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    t.style.left = left + 'px';
    t.style.top = top + 'px';
  }

  function hideTip() {
    if (tipEl) tipEl.classList.remove('is-on');
  }

  function centerOf(node) {
    var r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top };
  }

  /** 마우스·포커스 모두 같은 툴팁 */
  function bindTip(node, getTip) {
    node.addEventListener('pointermove', function (e) { var t = getTip(); showTip(t.title, t.rows, e.clientX, e.clientY); });
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', function () { var t = getTip(); var c = centerOf(node); showTip(t.title, t.rows, c.x, c.y); });
    node.addEventListener('blur', hideTip);
  }

  // ------------------------------------------------------------ 공통 틀

  function frame(container, height) {
    UI.clear(container);
    var width = Math.max(280, container.clientWidth || 600);
    var root = svg('svg', { class: 'chart', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img' });
    container.appendChild(root);
    return { root: root, width: width, height: height, pw: width - M.left - M.right, ph: height - M.top - M.bottom };
  }

  function yAxis(f, max, kind) {
    var ts = ticks(max, 4);
    var top = ts[ts.length - 1];
    var y = function (v) { return M.top + f.ph - (v / top) * f.ph; };
    ts.forEach(function (t) {
      f.root.appendChild(svg('line', { class: t === 0 ? 'axis' : 'grid', x1: M.left, x2: M.left + f.pw, y1: y(t), y2: y(t) }));
      f.root.appendChild(svg('text', { x: M.left - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'tick', text: compact(t, kind) }));
    });
    return y;
  }

  /** x 라벨: 겹치지 않게 솎아서 */
  function xLabels(f, labels, xAt) {
    var n = labels.length;
    var every = Math.ceil(n / Math.max(2, Math.floor(f.pw / 46)));
    var shown = [];
    for (var i = 0; i < n; i += every) shown.push(i);
    if (shown[shown.length - 1] !== n - 1) {
      if (shown.length > 1 && n - 1 - shown[shown.length - 1] < every * 0.6) shown.pop();
      shown.push(n - 1);
    }
    shown.forEach(function (j) {
      f.root.appendChild(svg('text', { x: xAt(j), y: M.top + f.ph + 18, 'text-anchor': 'middle', class: 'tick', text: labels[j] }));
    });
  }

  /** 위만 4px 둥근 세로 막대 (바닥은 각짐) */
  function colPath(x, yTop, w, yBase) {
    var h = yBase - yTop;
    if (h <= 0) return '';
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ',' + yBase + 'V' + (yTop + r) + 'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop +
      'H' + (x + w - r) + 'Q' + (x + w) + ',' + yTop + ' ' + (x + w) + ',' + (yTop + r) + 'V' + yBase + 'Z';
  }

  /** 오른쪽 끝만 4px 둥근 가로 막대 */
  function barPath(x0, y, len, h) {
    if (len <= 0) return '';
    var r = Math.min(4, h / 2, len);
    var x1 = x0 + len;
    return 'M' + x0 + ',' + y + 'H' + (x1 - r) + 'Q' + x1 + ',' + y + ' ' + x1 + ',' + (y + r) +
      'V' + (y + h - r) + 'Q' + x1 + ',' + (y + h) + ' ' + (x1 - r) + ',' + (y + h) + 'H' + x0 + 'Z';
  }

  function emptyState(container, text) {
    UI.clear(container);
    container.appendChild(el('p', { class: 'chart-empty', text: text || '이 기간에는 보여줄 값이 없어요' }));
  }

  // ------------------------------------------------------------ 선 (기간별 매출)

  function line(container, d) {
    var values = d.values;
    if (!values.length || values.every(function (v) { return !v; })) return emptyState(container);
    var f = frame(container, H);
    f.root.setAttribute('aria-label', d.name + ' 선 차트');
    var y = yAxis(f, Math.max.apply(null, values), d.kind);
    var n = values.length;
    var xAt = function (i) { return n === 1 ? M.left + f.pw / 2 : M.left + (i * f.pw) / (n - 1); };
    xLabels(f, d.labels, xAt);
    var pts = values.map(function (v, i) { return xAt(i).toFixed(1) + ',' + y(v).toFixed(1); });
    f.root.appendChild(svg('polyline', { class: 'line', points: pts.join(' ') }));
    // 최댓값 하나만 직접 라벨 (나머지는 축·툴팁·표)
    var last = n - 1;
    var top = values.indexOf(Math.max.apply(null, values));
    var anchor = xAt(top) > M.left + f.pw * 0.75 ? 'end' : (xAt(top) < M.left + f.pw * 0.25 ? 'start' : 'middle');
    f.root.appendChild(svg('circle', { class: 'dot-ring', cx: xAt(top), cy: y(values[top]), r: 6 }));
    f.root.appendChild(svg('circle', { class: 'dot', cx: xAt(top), cy: y(values[top]), r: 4 }));
    f.root.appendChild(svg('text', { class: 'val', x: xAt(top) + (anchor === 'end' ? -8 : anchor === 'start' ? 8 : 0), y: y(values[top]) - 10, 'text-anchor': anchor, text: '최고 ' + full(values[top], d.kind) }));
    // 십자선 + 툴팁
    var cross = svg('line', { class: 'cross', x1: 0, x2: 0, y1: M.top, y2: M.top + f.ph, visibility: 'hidden' });
    var hot = svg('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    f.root.appendChild(cross);
    f.root.appendChild(hot);
    var overlay = svg('rect', { class: 'hit', x: M.left - 6, y: M.top, width: f.pw + 12, height: f.ph, tabindex: '0', 'aria-label': d.name + ' — 화살표 키로 값을 볼 수 있어요' });
    f.root.appendChild(overlay);
    var cur = last;
    var at = function (i, cx, cy) {
      cur = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', xAt(cur));
      cross.setAttribute('x2', xAt(cur));
      cross.setAttribute('visibility', 'visible');
      hot.setAttribute('cx', xAt(cur));
      hot.setAttribute('cy', y(values[cur]));
      hot.setAttribute('visibility', 'visible');
      var box = f.root.getBoundingClientRect();
      showTip(d.labels[cur], [{ value: full(values[cur], d.kind), label: d.name, key: 'k-line' }],
        cx !== undefined ? cx : box.left + xAt(cur), cy !== undefined ? cy : box.top + y(values[cur]));
    };
    var off = function () {
      cross.setAttribute('visibility', 'hidden');
      hot.setAttribute('visibility', 'hidden');
      hideTip();
    };
    overlay.addEventListener('pointermove', function (e) {
      var box = f.root.getBoundingClientRect();
      var px = e.clientX - box.left - M.left;
      at(n === 1 ? 0 : Math.round((px / f.pw) * (n - 1)), e.clientX, e.clientY);
    });
    overlay.addEventListener('pointerleave', off);
    overlay.addEventListener('focus', function () { at(cur); });
    overlay.addEventListener('blur', off);
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); at(cur - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); at(cur + 1); }
    });
  }

  // ------------------------------------------------------------ 묶은 막대 (도착·출발)

  function grouped(container, d) {
    var all = [];
    d.series.forEach(function (s) { all = all.concat(s.values); });
    if (!all.length || all.every(function (v) { return !v; })) return emptyState(container);
    var f = frame(container, H);
    f.root.setAttribute('aria-label', d.series.map(function (s) { return s.name; }).join('·') + ' 묶은 막대 차트');
    var y = yAxis(f, Math.max.apply(null, all), d.kind);
    var n = d.labels.length;
    var band = f.pw / n;
    var k = d.series.length;
    var bw = Math.max(2, Math.min(BAR_MAX, (band * 0.72 - GAP * (k - 1)) / k));
    var groupW = bw * k + GAP * (k - 1);
    var xAt = function (i) { return M.left + band * i + band / 2; };
    xLabels(f, d.labels, xAt);
    var base = M.top + f.ph;
    for (var i = 0; i < n; i++) {
      var gx = xAt(i) - groupW / 2;
      d.series.forEach(function (s, j) {
        var p = colPath(gx + j * (bw + GAP), y(s.values[i]), bw, base);
        if (p) f.root.appendChild(svg('path', { class: 'bar ' + s.cls, d: p }));
      });
      (function (idx) {
        var hit = svg('rect', { class: 'hit', x: M.left + band * idx, y: M.top, width: band, height: f.ph, tabindex: '0', 'aria-label': d.labels[idx] + ' ' + d.series.map(function (s) { return s.name + ' ' + full(s.values[idx], d.kind); }).join(', ') });
        bindTip(hit, function () {
          return { title: d.labels[idx], rows: d.series.map(function (s) { return { value: full(s.values[idx], d.kind), label: s.name, key: 'k-' + s.cls }; }) };
        });
        f.root.appendChild(hit);
      })(i);
    }
  }

  // ------------------------------------------------------------ 세로 막대 (시간대)

  function columns(container, d) {
    var values = d.values;
    if (!values.length || values.every(function (v) { return !v; })) return emptyState(container);
    var f = frame(container, H);
    f.root.setAttribute('aria-label', d.name + ' 막대 차트');
    var max = Math.max.apply(null, values);
    var y = yAxis(f, max, d.kind);
    var n = values.length;
    var band = f.pw / n;
    var bw = Math.max(2, Math.min(BAR_MAX, band - GAP));
    var xAt = function (i) { return M.left + band * i + band / 2; };
    var every = band < 22 ? 3 : 1;
    d.labels.forEach(function (lb, i) {
      if (i % every === 0) f.root.appendChild(svg('text', { x: xAt(i), y: M.top + f.ph + 18, 'text-anchor': 'middle', class: 'tick', text: lb }));
    });
    var base = M.top + f.ph;
    var maxIdx = values.indexOf(max);
    values.forEach(function (v, i) {
      var p = colPath(xAt(i) - bw / 2, y(v), bw, base);
      if (p) f.root.appendChild(svg('path', { class: 'bar s1', d: p }));
      if (i === maxIdx) f.root.appendChild(svg('text', { class: 'val', x: xAt(i), y: y(v) - 6, 'text-anchor': 'middle', text: full(v, d.kind) }));
      var hit = svg('rect', { class: 'hit', x: M.left + band * i, y: M.top, width: band, height: f.ph, tabindex: '0', 'aria-label': d.labels[i] + ' ' + full(v, d.kind) });
      bindTip(hit, function () { return { title: d.tipLabels ? d.tipLabels[i] : d.labels[i], rows: [{ value: full(v, d.kind), label: d.name, key: 'k-s1' }] }; });
      f.root.appendChild(hit);
    });
  }

  // ------------------------------------------------------------ 가로 막대 (기사별, 작은 여러 개)

  function hbars(container, d) {
    var rows = d.rows;
    if (!rows.length) return emptyState(container, '이 기간에 배정된 기사가 없어요');
    UI.clear(container);
    var width = Math.max(220, container.clientWidth || 300);
    var rowH = 28;
    var barH = 16;
    var labelW = Math.min(96, Math.max(56, width * 0.3));
    var valueW = d.kind === 'won' ? 92 : 44;
    var height = rows.length * rowH + 8;
    var root = svg('svg', { class: 'chart', width: width, height: height, viewBox: '0 0 ' + width + ' ' + height, role: 'img', 'aria-label': d.name + ' 가로 막대 차트' });
    container.appendChild(root);
    var plotW = width - labelW - valueW - 8;
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    rows.forEach(function (r, i) {
      var yTop = 4 + i * rowH;
      var len = (r.value / max) * plotW;
      root.appendChild(svg('text', { x: labelW - 8, y: yTop + barH / 2 + 4, 'text-anchor': 'end', class: 'label', text: r.label }));
      var p = barPath(labelW, yTop, len, barH);
      if (p) root.appendChild(svg('path', { class: 'bar s1', d: p }));
      root.appendChild(svg('text', { x: labelW + len + 6, y: yTop + barH / 2 + 4, class: 'val', text: full(r.value, d.kind) }));
      var hit = svg('rect', { class: 'hit', x: 0, y: yTop - 6, width: width, height: rowH, tabindex: '0', 'aria-label': r.label + ' ' + full(r.value, d.kind) });
      bindTip(hit, function () { return { title: r.label, rows: [{ value: full(r.value, d.kind), label: d.name, key: 'k-s1' }] }; });
      root.appendChild(hit);
    });
    root.appendChild(svg('line', { class: 'axis', x1: labelW, x2: labelW, y1: 0, y2: height }));
  }

  // ------------------------------------------------------------ 표로 보기

  function table(container, headers, rows) {
    UI.clear(container);
    var t = el('table', { class: 'data data-compact' }, [
      el('thead', null, [el('tr', null, headers.map(function (h, i) { return el('th', { scope: 'col', class: i ? 'num' : '', text: h }); }))]),
      el('tbody', null, rows.map(function (r) {
        return el('tr', null, r.map(function (c, i) { return el(i ? 'td' : 'th', { scope: i ? null : 'row', class: i ? 'num' : '', text: c }); }));
      }))
    ]);
    container.appendChild(el('details', { class: 'table-view' }, [el('summary', { text: '표로 보기' }), el('div', { class: 'table-view-body' }, [t])]));
  }

  return {
    line: line,
    grouped: grouped,
    columns: columns,
    hbars: hbars,
    table: table,
    full: full,
    hideTip: hideTip
  };
})();
