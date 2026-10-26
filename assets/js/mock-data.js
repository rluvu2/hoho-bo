/*
 * 목업 모드 — API_URL 이 비어 있거나 주소에 ?mock=1 이 있으면 api.js 가 여기로 보낸다.
 * 모든 값은 가짜다 (실제 고객·기사 정보 아님). 비밀번호: mockadmin
 * 서버 집계·필터를 흉내만 낸 것이라 실제 결과와 세부가 다를 수 있다.
 */
var MockApi = (function () {
  'use strict';

  var ADMIN_PW = 'mockadmin';
  var USER_PW = 'mockuser1';
  var ADMIN_KEY = 'mock-key-admin-0000000000000000';
  var DELAY_MS = 350;
  var rowsCache = null;

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function pick(r, list) {
    return list[Math.floor(r() * list.length)];
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function fields() {
    return SchemaDefaults.fields.map(function (f) {
      var c = Object.assign({}, f);
      if (c.optionsFrom) c.options = ['김예시', '박샘플', '최테스트'];
      return c;
    });
  }

  function rows() {
    if (rowsCache) return rowsCache;
    var r = rng(20261026);
    var names = ['HONG GILDONG', 'KIM YESI', 'LEE GAJJA', 'PARK SAMPLE', 'CHOI TEST', 'JUNG DUMMY', '김가짜', '이예시', 'JOHN DOE', 'JANE ROE'];
    var flights = ['KE703', 'OZ102', '7C1101', 'LJ201', 'TW301', 'KE5', 'OZ741', 'ZE601'];
    var drivers = [['김예시', '010-0000-5678', '카니발', '00가 0000'], ['박샘플', '010-0000-6789', '스타리아', '11나 1111'], ['최테스트', '010-0000-7890', '카니발', '22다 2222']];
    var today = FormatCore.todaySeoul();
    var out = [];
    for (var i = 0; i < 70; i++) {
      var date = FormatCore.addDays(today, Math.floor(r() * 60) - 40);
      var past = date < today;
      var status = past ? pick(r, ['운행완료', '운행완료', '운행완료', '취소']) : pick(r, ['접수', '접수', '배차완료', '배차완료', '취소']);
      var d = status === '접수' ? null : pick(r, drivers);
      var fee = 40000 + Math.floor(r() * 6) * 10000;
      var memo = r() < 0.2 ? pick(r, ['카시트 1개 요청', '유아 동반', '골프백 2개']) : '';
      out.push({
        id: date.replace(/-/g, '').slice(2) + '-' + ('M' + i + 'XYZ').slice(0, 4),
        values: {
          '구분': r() < 0.55 ? '도착' : '출발',
          '날짜': date,
          '시간': pad2(5 + Math.floor(r() * 18)) + ':' + pick(r, ['00', '15', '30', '45']),
          '항공편': pick(r, flights),
          '인원': 1 + Math.floor(r() * 5),
          '짐': Math.floor(r() * 6),
          '이름': pick(r, names),
          '연락처': '010-0000-' + (1000 + Math.floor(r() * 8999)),
          '주소': '서울특별시 가상구 예시로 ' + (1 + Math.floor(r() * 99)),
          '메모': memo,
          '상태': status,
          '기사': d ? d[0] : '',
          '기사 연락처': d ? d[1] : '',
          '차종': d ? d[2] : '',
          '차량번호': d ? d[3] : '',
          '요금': status === '취소' ? '' : fee,
          '기사 정산액': d && status !== '취소' ? fee * 0.8 : '',
          '정산': past && r() < 0.7 ? '완료' : '대기'
        }
      });
    }
    rowsCache = out;
    return out;
  }

  function fail(code, message) {
    return Promise.reject({ code: code, message: message, details: null });
  }

  function later(data) {
    return new Promise(function (resolve) { setTimeout(function () { resolve(data); }, DELAY_MS); });
  }

  // ------------------------------------------------------------ 서버 흉내

  function schema() {
    var fs = fields();
    var opts = {};
    fs.forEach(function (f) {
      if (f.p1Search !== '선택') return;
      var seen = {};
      var list = [];
      f.options.concat(rows().map(function (r) { return r.values[f.label]; })).forEach(function (v) {
        if (v && !seen[v]) { seen[v] = true; list.push(v); }
      });
      opts[f.label] = list;
    });
    return { fields: fs, forms: SchemaDefaults.forms, filterOptions: opts, formatVersion: FormatCore.VERSION, today: FormatCore.todaySeoul() };
  }

  function query(p) {
    var fs = fields();
    var view = p.view === 'p3' ? 'p3' : 'p1';
    var shown = fs.filter(function (f) { return view === 'p3' ? f.p3Show : f.p1Show; });
    var flt = p.filters || {};
    var q = String(flt.q || '').toLowerCase().replace(/[\s-]+/g, '');
    var kw = fs.filter(function (f) { return f.p1Search === '키워드'; });
    var list = rows().filter(function (r) {
      var v = r.values;
      var ok = Object.keys(flt.select || {}).every(function (lb) { return flt.select[lb].indexOf(String(v[lb] || '')) >= 0; });
      ok = ok && Object.keys(flt.range || {}).every(function (lb) {
        var x = flt.range[lb];
        return (!x.from || v[lb] >= x.from) && (!x.to || v[lb] <= x.to);
      });
      ok = ok && (!q || kw.some(function (f) { return String(v[f.label]).toLowerCase().replace(/[\s-]+/g, '').indexOf(q) >= 0; }));
      return ok;
    });
    var sort = p.sort || {};
    var dir = sort.dir === 'desc' ? -1 : 1;
    list.sort(function (a, b) {
      var keys = sort.field ? [sort.field, '날짜', '시간'] : ['날짜', '시간'];
      for (var i = 0; i < keys.length; i++) {
        var x = a.values[keys[i]];
        var y = b.values[keys[i]];
        if (x === y) continue;
        if (x === '' || y === '') return x === '' ? 1 : -1;
        var c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
        return (i === 0 || !sort.field) ? c * dir : c;
      }
      return 0;
    });
    var pageSize = Math.min(200, Math.max(1, p.pageSize || 50));
    var pages = Math.max(1, Math.ceil(list.length / pageSize));
    var page = Math.min(pages, Math.max(1, p.page || 1));
    return {
      view: view,
      columns: shown.map(function (f) { return { label: f.label, type: f.type }; }),
      rows: list.slice((page - 1) * pageSize, page * pageSize).map(function (r) {
        var o = { ID: r.id };
        shown.forEach(function (f) { o[f.label] = r.values[f.label]; });
        return o;
      }),
      total: list.length,
      page: page,
      pageSize: pageSize,
      pages: pages
    };
  }

  function dashboard(p) {
    var from = p.from;
    var to = p.to;
    var unit = p.unit || 'day';
    var days = FormatCore.diffDays(to, from) + 1;
    var prevTo = FormatCore.addDays(from, -1);
    var prevFrom = FormatCore.addDays(from, -days);
    var live = rows().filter(function (r) { return r.values['상태'] !== '취소'; });
    var inRange = function (a, b) { return live.filter(function (r) { return r.values['날짜'] >= a && r.values['날짜'] <= b; }); };
    var num = function (v) { return typeof v === 'number' ? v : 0; };
    var sum = function (list) {
      var t = { count: 0, arrive: 0, depart: 0, pax: 0, revenue: 0, payout: 0, unpaid: 0, unassigned: 0 };
      list.forEach(function (r) {
        var v = r.values;
        t.count++;
        if (v['구분'] === '도착') t.arrive++; else t.depart++;
        t.pax += num(v['인원']);
        t.revenue += num(v['요금']);
        t.payout += num(v['기사 정산액']);
        if (v['정산'] === '대기') t.unpaid += num(v['기사 정산액']);
        if (!v['기사']) t.unassigned++;
      });
      return t;
    };
    var cur = inRange(from, to);
    var tc = sum(cur);
    var tp = sum(inRange(prevFrom, prevTo));
    var growth = function (a, b) { return b ? Math.round(((a - b) / b) * 1000) / 10 : null; };
    var kpi = function (key, label, format, value, prev, change) { return { key: key, label: label, format: format, value: value, prev: prev, change: change }; };
    var bucketOf = function (iso) {
      if (unit === 'month') return iso.slice(0, 7);
      if (unit === 'week') {
        var wd = '일월화수목금토'.indexOf(FormatCore.weekdayOf(iso));
        return FormatCore.addDays(iso, -((wd + 6) % 7));
      }
      return iso;
    };
    var keys = [];
    for (var d = from; d <= to; d = FormatCore.addDays(d, 1)) {
      var k = bucketOf(d);
      if (keys.indexOf(k) < 0) keys.push(k);
    }
    var label = function (k) {
      if (unit === 'month') return +k.slice(0, 4) + '.' + +k.slice(5, 7);
      if (unit === 'week' && k < from) k = from;
      return +k.slice(5, 7) + '/' + +k.slice(8, 10) + (unit === 'week' ? '~' : '');
    };
    var revenue = keys.map(function () { return 0; });
    var arrive = keys.map(function () { return 0; });
    var depart = keys.map(function () { return 0; });
    var hours = [];
    for (var h = 0; h < 24; h++) hours.push(0);
    var drivers = {};
    cur.forEach(function (r) {
      var v = r.values;
      var i = keys.indexOf(bucketOf(v['날짜']));
      revenue[i] += num(v['요금']);
      if (v['구분'] === '도착') arrive[i]++; else depart[i]++;
      hours[+v['시간'].slice(0, 2)]++;
      if (v['기사']) {
        drivers[v['기사']] = drivers[v['기사']] || { name: v['기사'], count: 0, payout: 0 };
        drivers[v['기사']].count++;
        drivers[v['기사']].payout += num(v['기사 정산액']);
      }
    });
    return {
      period: { from: from, to: to, prevFrom: prevFrom, prevTo: prevTo, unit: unit, days: days },
      kpis: [
        kpi('count', '예약 건수', 'count', tc.count, tp.count, growth(tc.count, tp.count)),
        kpi('arriveDepart', '도착·출발', 'pair', { arrive: tc.arrive, depart: tc.depart }, { arrive: tp.arrive, depart: tp.depart }, growth(tc.count, tp.count)),
        kpi('pax', '총 인원', 'people', tc.pax, tp.pax, growth(tc.pax, tp.pax)),
        kpi('revenue', '매출', 'won', tc.revenue, tp.revenue, growth(tc.revenue, tp.revenue)),
        kpi('revenueGrowth', '매출 증감률', 'percent', growth(tc.revenue, tp.revenue), tp.revenue, null),
        kpi('payout', '기사 정산액', 'won', tc.payout, tp.payout, growth(tc.payout, tp.payout)),
        kpi('unpaid', '미지급 정산액', 'won', tc.unpaid, tp.unpaid, growth(tc.unpaid, tp.unpaid)),
        kpi('unassigned', '미배차', 'count', tc.unassigned, tp.unassigned, growth(tc.unassigned, tp.unassigned))
      ],
      charts: {
        revenue: { labels: keys.map(label), values: revenue },
        counts: { labels: keys.map(label), arrive: arrive, depart: depart, arriveLabel: '도착', departLabel: '출발' },
        drivers: Object.keys(drivers).map(function (k) { return drivers[k]; }).sort(function (a, b) { return b.count - a.count; }),
        hours: hours
      }
    };
  }

  /** api.js 가 부른다 → Promise */
  function handle(action, payload, auth) {
    if (action === 'auth.login') {
      var pw = String(payload.password || '').trim();
      if (pw === ADMIN_PW) return later({ key: ADMIN_KEY, role: 'admin', name: '목업 관리자' });
      if (pw === USER_PW) return later(null).then(function () { return fail('UNAUTHORIZED', '비밀번호가 맞지 않아요'); });
      return later(null).then(function () { return fail('UNAUTHORIZED', '비밀번호가 맞지 않아요'); });
    }
    if (!auth || auth.key !== ADMIN_KEY) return fail('UNAUTHORIZED', '로그인이 필요해요');
    switch (action) {
      case 'auth.me': return later({ role: 'admin', name: '목업 관리자' });
      case 'schema.get': return later(schema());
      case 'data.query': return later(query(payload));
      case 'messages.templates': return later({ templates: SchemaDefaults.templates.filter(function (t) { return t.active; }), vars: { '고객센터': '010-0000-0000' } });
      case 'dashboard.get': return later(dashboard(payload));
    }
    return fail('BAD_REQUEST', '알 수 없는 요청이에요');
  }

  return { handle: handle, ADMIN_PW: ADMIN_PW };
})();
