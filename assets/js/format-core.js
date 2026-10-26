/*
 * FormatCore — 고객 양식 파싱·검증·템플릿 채우기
 *
 * 이 파일이 원본이다. backend 쪽 FormatCore.gs, FormatCoreJs.html 은
 * `node scripts/sync.js` 로 복사한 것이니 거기서 직접 고치지 않는다.
 * 규칙(읽기·검사 결과)이 바뀌면 VERSION 을 올린다. ② 입력 화면과 서버가
 * 같은 규칙인지 저장 때 이 값으로 확인한다.
 *
 * 브라우저(클래식 script), Apps Script(V8), Node(require) 에서 똑같이 돈다.
 */
var FormatCore = (function () {
  'use strict';

  var VERSION = '1.0.0';
  var MAX_TEXT = 5000;
  var DAY_MS = 86400000;
  var SEOUL_OFFSET_MS = 9 * 3600000;
  var WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var BULLET_RE = /^(?:[-•·*▪]\s*)+/;
  var COLON_RE = /^[:：]/;
  // 인원,짐개수처럼 숫자 두 개가 한 줄에 있을 때 단위 → 필드 라벨
  var DEFAULT_UNITS = { '명': '인원', '인': '인원', '개': '짐' };

  // ---------------------------------------------------------------- 공용

  function str(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function normChar(c) {
    if (c === '，') return ',';
    if (c === '：') return ':';
    return c.toLowerCase();
  }

  /** 라벨 비교용: 공백 제거, 소문자, 전각 쉼표·콜론 통일 */
  function normLabel(s) {
    var t = str(s).replace(/\s+/g, '');
    var out = '';
    for (var i = 0; i < t.length; i++) out += normChar(t.charAt(i));
    return out;
  }

  /** 줄 앞뒤 공백과 글머리(-, •, ·, *, ▪)를 지운다 */
  function stripBullets(s) {
    return str(s).trim().replace(BULLET_RE, '').trim();
  }

  /** 양식 표시 줄에서 라벨만 뽑는다 ('  - 출발시간 :' → '출발시간') */
  function labelOfLine(text) {
    return stripBullets(text).replace(/\s*[:：]\s*$/, '').trim();
  }

  // ---------------------------------------------------------------- 날짜

  /** Asia/Seoul 기준 오늘 (YYYY-MM-DD). 한국은 서머타임이 없어 +9시간 고정. */
  function todaySeoul(nowMs) {
    var d = new Date((nowMs === undefined ? Date.now() : nowMs) + SEOUL_OFFSET_MS);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  function parseIso(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }

  function isoOf(y, m, d) {
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function isValidYmd(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }

  function utcOf(iso) {
    var p = parseIso(iso);
    return Date.UTC(p.y, p.m - 1, p.d);
  }

  /** a - b (일) */
  function diffDays(a, b) {
    return Math.round((utcOf(a) - utcOf(b)) / DAY_MS);
  }

  function addDays(iso, n) {
    var t = new Date(utcOf(iso) + n * DAY_MS);
    return isoOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  function weekdayOf(iso) {
    return WEEKDAYS[new Date(utcOf(iso)).getUTCDay()];
  }

  /** 화면용: '10월 22일 (목)', 올해가 아니면 '2027년 1월 5일 (화)' */
  function displayDate(iso, today) {
    var p = parseIso(iso);
    if (!p) return str(iso);
    var t = parseIso(today || todaySeoul());
    var head = t && t.y === p.y ? '' : p.y + '년 ';
    return head + p.m + '월 ' + p.d + '일 (' + weekdayOf(iso) + ')';
  }

  var DATE_PATTERNS = [
    { re: /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/, y: 1, m: 2, d: 3 },
    { re: /^(\d{4})\s*([-./])\s*(\d{1,2})\s*\2\s*(\d{1,2})(?!\d)\.?/, y: 1, m: 3, d: 4 },
    { re: /^(\d{2})\s*([.-])\s*(\d{1,2})\s*\2\s*(\d{1,2})(?!\d)\.?/, yy: 1, m: 3, d: 4 },
    { re: /^(\d{1,2})\s*월\s*(\d{1,2})\s*일/, m: 1, d: 2 },
    { re: /^(\d{1,2})\s*([/.])\s*(\d{1,2})(?!\d)(?!\s*[/.]\s*\d)\.?/, m: 1, d: 3 }
  ];
  var WEEKDAY_RE = /^\s*[(（]?\s*([월화수목금토일])(?:요일)?\s*[)）]?(?=$|[\s,\d])/;

  /**
   * 글 앞부분에서 날짜를 읽는다.
   * → { matched, value, display, raw, rest, error }
   */
  function parseDatePrefix(text, opts) {
    var t = str(text).trim();
    for (var i = 0; i < DATE_PATTERNS.length; i++) {
      var p = DATE_PATTERNS[i];
      var m = p.re.exec(t);
      if (!m) continue;
      var consumed = m[0];
      var rest = t.slice(consumed.length);
      var mon = +m[p.m];
      var day = +m[p.d];
      var year;
      if (p.y) year = +m[p.y];
      else if (p.yy) year = 2000 + (+m[p.yy]);
      else year = inferYear(mon, day, opts);

      var wd = WEEKDAY_RE.exec(rest);
      var weekday = null;
      if (wd) {
        weekday = wd[1];
        consumed += wd[0];
        rest = rest.slice(wd[0].length);
      }
      var out = { matched: true, raw: consumed.trim(), rest: rest, value: '', display: '', error: '' };
      if (!isValidYmd(year, mon, day)) {
        out.error = '없는 날짜예요 (' + mon + '월 ' + day + '일)';
        return out;
      }
      var iso = isoOf(year, mon, day);
      if (weekday && weekdayOf(iso) !== weekday) {
        out.error = '요일이 날짜와 달라요 (' + mon + '월 ' + day + '일은 ' + weekdayOf(iso) + '요일)';
        return out;
      }
      out.value = iso;
      out.display = displayDate(iso, opts.today);
      if (!opts.allowPast && iso < opts.today) {
        out.error = '지난 날짜예요 (오늘 ' + displayDate(opts.today, opts.today) + ')';
      }
      return out;
    }
    return { matched: false, raw: '', rest: t, value: '', display: '', error: '날짜를 읽을 수 없어요 (예: 10월 22일, 10/22, 2026-10-22)' };
  }

  /** 연도 없는 날짜: 올해로 보고, 오늘보다 rolloverDays일 넘게 지났으면 내년 */
  function inferYear(mon, day, opts) {
    var t = parseIso(opts.today);
    var y = t.y;
    var guess = Date.UTC(y, mon - 1, day);
    var past = Math.round((utcOf(opts.today) - guess) / DAY_MS);
    if (past > opts.rolloverDays) y += 1;
    return y;
  }

  // ---------------------------------------------------------------- 시간

  var MIDNIGHT_MSG = "'자정'·'밤 12시'·'오전 12시'는 날짜가 헷갈려요. 00:00 또는 12:00처럼 적어 주세요";

  function hourByMarker(marker, h, leadingZero) {
    switch (marker) {
      case null:
        if (h === 0 || (h >= 12 && h <= 23)) return h;
        if (h >= 1 && h <= 11) return leadingZero ? h : { error: '오전·오후를 적어 주세요' };
        return { error: '시각이 잘못됐어요' };
      case '오전':
      case 'am':
        if (h <= 11) return h;
        if (h === 12) return { error: MIDNIGHT_MSG };
        return { error: '오전과 시각이 맞지 않아요' };
      case '새벽':
        if (h <= 6) return h;
        if (h === 12) return { error: MIDNIGHT_MSG };
        return { error: "'새벽 " + h + "시'는 확인이 필요해요. 오전·오후로 적어 주세요" };
      case '아침':
        if (h >= 5 && h <= 11) return h;
        return { error: "'아침 " + h + "시'는 확인이 필요해요. 오전·오후로 적어 주세요" };
      case '오후':
      case 'pm':
        if (h >= 1 && h <= 11) return h + 12;
        if (h >= 12 && h <= 23) return h;
        return { error: '오후와 시각이 맞지 않아요' };
      case '낮':
        if (h === 12) return 12;
        if (h >= 1 && h <= 5) return h + 12;
        return { error: "'낮 " + h + "시'는 확인이 필요해요. 오전·오후로 적어 주세요" };
      case '저녁':
        if (h >= 5 && h <= 11) return h + 12;
        if (h >= 17 && h <= 23) return h;
        return { error: "'저녁 " + h + "시'는 확인이 필요해요. 오전·오후로 적어 주세요" };
      case '밤':
        if (h >= 6 && h <= 11) return h + 12;
        if (h >= 18 && h <= 23) return h;
        if (h === 12) return { error: MIDNIGHT_MSG };
        return { error: "'밤 " + h + "시'는 날짜가 헷갈려요. '새벽 " + h + "시'처럼 적어 주세요" };
    }
    return { error: '시각을 읽을 수 없어요' };
  }

  /** 시각 글자 하나를 읽는다 → { value: 'HH:mm', display, error } */
  function parseTime(text) {
    var t = str(text).trim();
    if (!t) return { value: '', display: '', error: '시간이 없어요' };
    if (/자정/.test(t)) return { value: '', display: '', error: MIDNIGHT_MSG };
    var u = t.toLowerCase().replace(/a\.\s*m\.?/g, 'am').replace(/p\.\s*m\.?/g, 'pm');
    if (/^정오$/.test(u)) return { value: '12:00', display: displayTime('12:00'), error: '' };

    var marker = null;
    var mk = /^(오전|오후|새벽|아침|낮|저녁|밤|am|pm)\s*/.exec(u);
    if (mk) {
      marker = mk[1];
      u = u.slice(mk[0].length);
    } else {
      var mk2 = /\s*(am|pm)$/.exec(u);
      if (mk2) {
        marker = mk2[1];
        u = u.slice(0, u.length - mk2[0].length);
      }
    }

    var hourText, minute;
    var m1 = /^(\d{1,2})\s*:\s*(\d{2})$/.exec(u);
    var m2 = /^(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?$/.exec(u);
    var m3 = (marker === 'am' || marker === 'pm') ? /^(\d{1,2})$/.exec(u) : null;
    if (m1) {
      hourText = m1[1];
      minute = +m1[2];
    } else if (m2) {
      hourText = m2[1];
      minute = m2[2] !== undefined ? +m2[2] : (m2[3] ? 30 : 0);
    } else if (m3) {
      hourText = m3[1];
      minute = 0;
    } else {
      if (/(쯤|경|정도|전후|이후|이전|~|-)/.test(u)) {
        return { value: '', display: '', error: '정확한 시각 하나만 적어 주세요 (예: 17:00)' };
      }
      return { value: '', display: '', error: '시간을 읽을 수 없어요 (예: 17:00, 오후 5시)' };
    }
    if (minute > 59) return { value: '', display: '', error: '분이 잘못됐어요' };
    var leadingZero = hourText.length === 2 && hourText.charAt(0) === '0';
    var h = hourByMarker(marker, +hourText, leadingZero);
    if (typeof h !== 'number') return { value: '', display: '', error: h.error };
    var value = pad2(h) + ':' + pad2(minute);
    return { value: value, display: displayTime(value), error: '' };
  }

  /** 화면용: '17:00 (오후 5:00)' */
  function displayTime(v) {
    var m = /^(\d{2}):(\d{2})$/.exec(str(v));
    if (!m) return str(v);
    return v + ' (' + ampmOf(v) + ')';
  }

  function ampmOf(v) {
    var m = /^(\d{2}):(\d{2})$/.exec(str(v));
    if (!m) return str(v);
    var h = +m[1];
    if (h === 0) return '새벽 0:' + m[2];
    if (h < 12) return '오전 ' + h + ':' + m[2];
    return '오후 ' + (h === 12 ? 12 : h - 12) + ':' + m[2];
  }

  // ---------------------------------------------------------------- 타입별

  function parseFlight(text) {
    var v = str(text).toUpperCase().replace(/[\s\-]+/g, '');
    if (/^(?:[A-Z][A-Z0-9]|[0-9][A-Z])\d{1,4}[A-Z]?$/.test(v) || /^[A-Z]{3}\d{1,4}[A-Z]?$/.test(v)) {
      return { value: v, display: v, error: '' };
    }
    return { value: '', display: '', error: '항공편 형식이 아니에요 (예: KE703, OZ102, 7C1101)' };
  }

  function parseNumber(text) {
    var t = str(text).replace(/[,\s]/g, '').replace(/(명|개|원|대)$/, '');
    if (/^\d+$/.test(t)) {
      var v = String(parseInt(t, 10));
      return { value: v, display: v, error: '' };
    }
    return { value: '', display: '', error: '0 이상의 숫자로 적어 주세요' };
  }

  function domesticPhone(d) {
    var m = /^(010)(\d{4})(\d{4})$/.exec(d) ||
      /^(01[16789])(\d{3,4})(\d{4})$/.exec(d) ||
      /^(02)(\d{3,4})(\d{4})$/.exec(d) ||
      /^(0[3-6][1-5]|070|080|050\d)(\d{3,4})(\d{4})$/.exec(d);
    if (m) {
      var v = m[1] + '-' + m[2] + '-' + m[3];
      return { value: v, display: v, error: '' };
    }
    var r = /^(1[5-9]\d{2})(\d{4})$/.exec(d);
    if (r) {
      var v2 = r[1] + '-' + r[2];
      return { value: v2, display: v2, error: '' };
    }
    return { value: '', display: '', error: '전화번호 형식이 아니에요 (예: 010-1234-5678)' };
  }

  function parsePhone(text) {
    var t = str(text).trim();
    var compact = t.replace(/[\s\-.()]/g, '');
    if (/^(\+82|0082)/.test(compact)) {
      var rest = compact.replace(/^(\+82|0082)/, '');
      if (!/^\d+$/.test(rest)) return { value: '', display: '', error: '전화번호 형식이 아니에요' };
      if (rest.charAt(0) !== '0') rest = '0' + rest;
      return domesticPhone(rest);
    }
    if (/^(\+|00)/.test(compact)) {
      var cleaned = t.replace(/[^\d+\s-]/g, '').replace(/\s+/g, ' ').trim();
      var digits = cleaned.replace(/\D/g, '');
      if (cleaned.indexOf('+', 1) !== -1 || !/^\+?\d/.test(cleaned)) {
        return { value: '', display: '', error: '해외 전화번호 형식이 아니에요' };
      }
      if (digits.length < 8 || digits.length > 15) {
        return { value: '', display: '', error: '해외 전화번호 자릿수가 맞지 않아요 (8~15자리)' };
      }
      return { value: cleaned, display: cleaned, error: '' };
    }
    if (!/^\d+$/.test(compact)) return { value: '', display: '', error: '전화번호 형식이 아니에요 (예: 010-1234-5678)' };
    return domesticPhone(compact);
  }

  /**
   * 칸 하나 검사. ① onEdit 과 양식 파싱이 같이 쓴다.
   * options: { required, options(선택지), today, rolloverDays, allowPast }
   * → { value, display, error }
   */
  function validateValue(type, raw, options) {
    var o = normOptions(options);
    var t = str(raw).trim();
    if (t === '') return { value: '', display: '', error: o.required ? '값이 비어 있어요' : '' };
    switch (type) {
      case 'date': {
        var d = parseDatePrefix(t, o);
        if (!d.matched || d.error) return { value: '', display: '', error: d.error };
        if (d.rest.trim()) return { value: '', display: '', error: '날짜 뒤에 알 수 없는 글자가 있어요: ' + d.rest.trim() };
        return { value: d.value, display: d.display, error: '' };
      }
      case 'time':
        return parseTime(t);
      case 'flight':
        return parseFlight(t);
      case 'number':
        return parseNumber(t);
      case 'phone':
        return parsePhone(t);
      case 'email':
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { value: t, display: t, error: '' };
        return { value: '', display: '', error: '이메일 형식이 아니에요' };
      case 'select': {
        var opts = (o.options || []).map(function (x) { return str(x).trim(); });
        if (opts.indexOf(t) >= 0) return { value: t, display: t, error: '' };
        return { value: '', display: '', error: '선택지에 없는 값이에요' + (opts.length ? ' (' + opts.join(', ') + ')' : '') };
      }
      default:
        return { value: t, display: t, error: '' };
    }
  }

  function normOptions(options) {
    var o = options || {};
    var rd = parseInt(o.rolloverDays, 10);
    return {
      required: !!o.required,
      options: o.options || [],
      today: o.today || todaySeoul(),
      rolloverDays: isNaN(rd) ? 30 : rd,
      allowPast: !!o.allowPast,
      units: o.units || DEFAULT_UNITS
    };
  }

  // ---------------------------------------------------------------- 스키마

  /**
   * schema = {
   *   fields: [{ label, type, required, options, input('양식'|'시트'), ... }],
   *   forms:  [{ name, title, lines: [{ text, fields: [라벨...] }] }]
   * }
   */
  function compile(schema) {
    var fields = (schema && schema.fields) || [];
    var forms = (schema && schema.forms) || [];
    var byLabel = {};
    fields.forEach(function (f) { byLabel[f.label] = f; });
    var inLines = {};
    forms.forEach(function (f) {
      f.lines.forEach(function (l) { (l.fields || []).forEach(function (x) { inLines[x] = true; }); });
    });
    var formNames = forms.map(function (f) { return f.name; });
    var formField = null;
    var extras = [];
    fields.forEach(function (f) {
      if (f.input === '시트' || inLines[f.label]) return;
      if (!formField && f.type === 'select' && formNames.length &&
        formNames.every(function (n) { return (f.options || []).indexOf(n) >= 0; })) {
        formField = f;
        return;
      }
      extras.push(f);
    });
    var memoField = null;
    for (var i = 0; i < extras.length; i++) {
      if (extras[i].type === 'longtext') { memoField = extras[i]; break; }
    }

    var entries = [];
    function add(norm, form, line, labelText) {
      if (norm) entries.push({ norm: norm, form: form, fields: line.fields || [], labelText: labelText });
    }
    forms.forEach(function (f) {
      f.lines.forEach(function (l) {
        var lbl = labelOfLine(l.text);
        if (!lbl || !l.fields || !l.fields.length) return;
        add(normLabel(lbl), f.name, l, lbl);
        var alias = lbl.replace(/[(（][^)）]*[)）]/g, '').trim();
        if (alias && normLabel(alias) !== normLabel(lbl)) add(normLabel(alias), f.name, l, lbl);
      });
    });
    extras.forEach(function (fd) { add(normLabel(fd.label), '*', { fields: [fd.label] }, fd.label); });
    entries.sort(function (a, b) { return b.norm.length - a.norm.length; });

    var formsByName = {};
    var titles = [];
    forms.forEach(function (f) {
      formsByName[f.name] = f;
      titles.push({ norm: normLabel(stripBullets(f.title)), form: f.name });
    });
    return {
      fields: fields, byLabel: byLabel, forms: forms, formsByName: formsByName, formNames: formNames,
      formField: formField, extras: extras, memoField: memoField, entries: entries, titles: titles
    };
  }

  function blankForm(schema, formName) {
    var f = compile(schema).formsByName[formName];
    if (!f) return '';
    return [f.title, ''].concat(f.lines.map(function (l) { return l.text; })).join('\n');
  }

  // ---------------------------------------------------------------- 줄 읽기

  /** 줄이 norm 라벨로 시작하면 줄에서 라벨이 끝나는 위치, 아니면 -1 (공백 무시) */
  function matchPrefix(line, norm) {
    var i = 0;
    var j = 0;
    while (j < norm.length) {
      if (i >= line.length) return -1;
      var c = line.charAt(i);
      if (/\s/.test(c)) { i++; continue; }
      if (normChar(c) !== norm.charAt(j)) return -1;
      i++;
      j++;
    }
    return i;
  }

  function matchLine(line, C) {
    for (var k = 0; k < C.entries.length; k++) {
      var e = C.entries[k];
      var end = matchPrefix(line, e.norm);
      if (end < 0) continue;
      var rest = line.slice(end);
      var restTrim = rest.replace(/^\s+/, '');
      var value = null;
      if (COLON_RE.test(restTrim)) {
        value = restTrim.slice(1).trim();
      } else if (rest === '') {
        value = '';
      } else if (/^\s/.test(rest) || /[)）]$/.test(e.norm)) {
        // 콜론 없이 라벨 뒤에 값 ('이름(피케팅 네임) JOHN SMITH').
        // 단 '인원 수: 2' 처럼 뒤에 다른 라벨이 이어지면 이 라벨이 아니다.
        if (/^[^:：\d][^:：]{0,15}[:：]/.test(restTrim)) continue;
        value = restTrim.trim();
      } else {
        continue;
      }
      var same = C.entries.filter(function (x) { return x.norm === e.norm; });
      return { entries: same, value: value, labelText: e.labelText };
    }
    return null;
  }

  function matchTitle(line, C) {
    var n = normLabel(line);
    for (var i = 0; i < C.titles.length; i++) {
      if (C.titles[i].norm === n) return C.titles[i].form;
    }
    return null;
  }

  function isLongtextSlot(slot, C) {
    var labels = slot.entries[0].fields;
    if (labels.length !== 1) return false;
    var fd = C.byLabel[labels[0]];
    return !!fd && fd.type === 'longtext';
  }

  // ---------------------------------------------------------------- 한 줄 두 필드

  function fieldResult(raw, r, line) {
    return { raw: str(raw), value: r.value || '', display: r.display || '', line: line, error: r.error || '', note: r.note || '' };
  }

  function parseDateTime(raw, fdDate, fdTime, o, line) {
    var t = str(raw).trim();
    if (!t) {
      return [fieldResult('', { error: fdDate.required ? '값이 비어 있어요' : '' }, line),
        fieldResult('', { error: fdTime.required ? '값이 비어 있어요' : '' }, line)];
    }
    var d = parseDatePrefix(t, o);
    if (!d.matched) {
      return [fieldResult(t, { error: d.error }, line), fieldResult('', { error: '날짜를 먼저 읽을 수 있어야 해요' }, line)];
    }
    var restText = d.rest.trim();
    var tr = restText ? parseTime(restText) : { error: fdTime.required ? '시간이 없어요' : '' };
    return [fieldResult(d.raw, d, line), fieldResult(restText, tr, line)];
  }

  function parseNumberPair(raw, labels, C, o, line) {
    var t = str(raw).trim();
    var empty = labels.map(function (lb) {
      return fieldResult('', { error: C.byLabel[lb].required ? '값이 비어 있어요' : '' }, line);
    });
    if (!t) return empty;
    var allowed = t.replace(/\d+/g, '').replace(/[\s,/·、，]|명|인원|인|개|짐|수/g, '');
    var re = /(\d+)\s*(명|인(?!원)|개)?/g;
    var tokens = [];
    var m;
    while ((m = re.exec(t)) !== null) tokens.push({ text: m[0].trim(), num: String(parseInt(m[1], 10)), unit: m[2] || '' });
    var msg = labels.join('·') + '을 숫자 ' + labels.length + '개로 적어 주세요 (예: 2명, 3개)';
    if (allowed || tokens.length !== labels.length) {
      return labels.map(function () { return fieldResult(t, { error: msg }, line); });
    }
    // 단위로 정해지는 숫자를 먼저 그 칸에 넣고, 나머지는 남은 칸에 순서대로
    var res = {};
    var rest = [];
    for (var k = 0; k < tokens.length; k++) {
      var lb = tokens[k].unit ? o.units[tokens[k].unit] : null;
      if (lb && labels.indexOf(lb) >= 0) {
        if (res[lb]) return labels.map(function () { return fieldResult(t, { error: '단위가 겹쳐요. ' + msg }, line); });
        res[lb] = fieldResult(tokens[k].text, { value: tokens[k].num, display: tokens[k].num }, line);
      } else {
        rest.push(tokens[k]);
      }
    }
    labels.forEach(function (lb2) {
      if (!res[lb2]) {
        var tk = rest.shift();
        res[lb2] = fieldResult(tk.text, { value: tk.num, display: tk.num }, line);
      }
    });
    return labels.map(function (lb3) { return res[lb3]; });
  }

  function parseMulti(raw, labels, C, o, line) {
    var t = str(raw).trim();
    var types = labels.map(function (lb) { return C.byLabel[lb] ? C.byLabel[lb].type : 'text'; });
    if (labels.length === 2 && types[0] === 'date' && types[1] === 'time') {
      return parseDateTime(t, C.byLabel[labels[0]], C.byLabel[labels[1]], o, line);
    }
    if (types.every(function (x) { return x === 'number'; })) return parseNumberPair(t, labels, C, o, line);
    var parts = t ? t.split(/\s*[,，]\s*/) : [];
    if (t && parts.length !== labels.length) {
      return labels.map(function () { return fieldResult(t, { error: labels.join(', ') + '를 쉼표로 나눠 적어 주세요' }, line); });
    }
    return labels.map(function (lb, i) {
      var fd = C.byLabel[lb] || { type: 'text' };
      var r = validateValue(fd.type, parts[i] || '', { required: fd.required, options: fd.options, today: o.today, rolloverDays: o.rolloverDays, allowPast: o.allowPast });
      return fieldResult(parts[i] || '', r, line);
    });
  }

  // ---------------------------------------------------------------- parse

  /**
   * 고객 답장 글을 읽는다.
   * options: { today, rolloverDays, allowPast, units }
   */
  function parse(text, schema, options) {
    var o = normOptions(options);
    var C = compile(schema);
    var result = { ok: false, version: VERSION, records: [], errors: [], canonicalText: '' };
    var src = str(text).replace(/\r\n?/g, '\n');
    if (src.length > MAX_TEXT) {
      result.errors.push({ line: 0, message: '5,000자까지 넣을 수 있어요 (지금 ' + src.length.toLocaleString('en-US') + '자)' });
      return result;
    }
    if (!src.trim()) {
      result.errors.push({ line: 0, message: '붙여넣은 글이 없어요' });
      return result;
    }

    var lines = src.split('\n');
    var recs = [];
    var cur = null;
    var pending = null;
    var cont = null;

    function looseError(l) {
      return l.unknownLabel
        ? '알 수 없는 항목이에요: ' + l.unknownLabel
        : '양식에 없는 문장이에요: ' + l.text;
    }

    for (var i = 0; i < lines.length; i++) {
      var lineNo = i + 1;
      var stripped = stripBullets(lines[i]);
      var prevPending = pending;
      pending = null;
      if (!stripped) {
        cont = null;
        continue;
      }
      var titleForm = matchTitle(stripped, C);
      if (titleForm) {
        cur = { form: titleForm, explicit: true, titleText: lines[i].trim(), titleLine: lineNo, slots: [], loose: [] };
        recs.push(cur);
        cont = null;
        continue;
      }
      var m = matchLine(stripped, C);
      if (m) {
        if (!cur) {
          cur = { form: null, explicit: false, titleText: '', titleLine: 0, slots: [], loose: [] };
          recs.push(cur);
        }
        // 라벨 줄 앞에 남은 양식 밖 줄은 항목 사이에 끼어든 문장 → 문제
        cur.loose.forEach(function (l) { result.errors.push({ line: l.line, message: looseError(l) }); });
        cur.loose = [];
        var slot = { entries: m.entries, labelText: m.labelText, raw: m.value, line: lineNo };
        cur.slots.push(slot);
        if (m.value === '') pending = { rec: cur, slot: slot };
        cont = isLongtextSlot(slot, C) && m.value !== '' ? { rec: cur, slot: slot } : null;
        continue;
      }
      if (prevPending) {
        prevPending.slot.raw = stripped;
        cont = isLongtextSlot(prevPending.slot, C) ? prevPending : null;
        continue;
      }
      if (cont) {
        cont.slot.raw += '\n' + stripped;
        continue;
      }
      var ul = /^([^:：\d][^:：]{0,24})[:：]/.exec(stripped);
      var loose = { line: lineNo, text: stripped, unknownLabel: ul ? ul[1].trim() : null };
      if (cur) cur.loose.push(loose);
      else result.errors.push({ line: lineNo, message: looseError(loose) });
    }

    recs.forEach(function (rec) {
      result.records.push(finishRecord(rec, C, o, result.errors, looseError));
    });
    if (!recs.length && !result.errors.length) {
      result.errors.push({ line: 0, message: '양식 항목을 찾지 못했어요' });
    }

    result.errors.sort(function (a, b) { return a.line - b.line; });
    var allOk = result.records.length > 0 && result.errors.length === 0 &&
      result.records.every(function (r) {
        return !r.errors.length && Object.keys(r.fields).every(function (k) { return !r.fields[k].error; });
      });
    result.ok = allOk;
    result.canonicalText = buildText(schema, result.records.filter(function (r) { return r.form; }).map(function (r) {
      var values = {};
      Object.keys(r.fields).forEach(function (k) { values[k] = r.fields[k].value; });
      return { form: r.form, values: values };
    }));
    return result;
  }

  function finishRecord(rec, C, o, topErrors, looseError) {
    var out = { form: '', fields: {}, errors: [], line: rec.titleLine || (rec.slots[0] && rec.slots[0].line) || 0 };
    var form = rec.form;
    var formError = '';
    if (!form) {
      var possible = C.formNames.slice();
      rec.slots.forEach(function (s) {
        var fs = s.entries.map(function (e) { return e.form; }).filter(function (f) { return f !== '*'; });
        if (fs.length) possible = possible.filter(function (p) { return fs.indexOf(p) >= 0; });
      });
      var used = rec.slots.some(function (s) { return s.entries.some(function (e) { return e.form !== '*'; }); });
      if (possible.length === 1 && used) form = possible[0];
      else if (!possible.length) formError = C.formNames.join('·') + ' 양식 항목이 섞여 있어요. 제목 줄로 나눠 주세요';
      else formError = C.formNames.join('인지 ') + '인지 알 수 없어요. 제목 줄을 넣어 주세요';
    }
    out.form = form || '';

    var got = {};
    rec.slots.forEach(function (s) {
      var e = null;
      for (var k = 0; k < s.entries.length; k++) {
        var x = s.entries[k];
        if (x.form === '*' || !form || x.form === form) { e = x; break; }
      }
      if (!e) {
        topErrors.push({ line: s.line, message: form + ' 양식에 없는 항목이에요: ' + s.labelText });
        return;
      }
      var labels = e.fields;
      var results;
      if (labels.length === 1) {
        var fd = C.byLabel[labels[0]] || { type: 'text' };
        results = [fieldResult(s.raw, validateValue(fd.type, s.raw, {
          required: fd.required, options: fd.options, today: o.today, rolloverDays: o.rolloverDays, allowPast: o.allowPast
        }), s.line)];
      } else {
        results = parseMulti(s.raw, labels, C, o, s.line);
      }
      labels.forEach(function (lb, idx) {
        if (got[lb]) {
          got[lb].error = '같은 항목이 두 번 있어요 (' + got[lb].line + '번, ' + s.line + '번 줄)';
          return;
        }
        got[lb] = results[idx];
      });
    });

    // 양식 마지막 항목 아래의 글 → 메모
    if (rec.loose.length) {
      if (C.memoField) {
        var memoLabel = C.memoField.label;
        var extra = rec.loose.map(function (l) { return l.text; }).join('\n');
        if (got[memoLabel] && !got[memoLabel].error) {
          var merged = (got[memoLabel].value ? got[memoLabel].value + '\n' : '') + extra;
          got[memoLabel] = fieldResult(got[memoLabel].raw + '\n' + extra, { value: merged, display: merged, note: '양식 아래 글을 메모에 붙였어요' }, got[memoLabel].line);
        } else if (!got[memoLabel]) {
          got[memoLabel] = fieldResult(extra, { value: extra, display: extra, note: '양식 아래 글을 메모로 넣었어요' }, rec.loose[0].line);
        } else {
          rec.loose.forEach(function (l) { topErrors.push({ line: l.line, message: looseError(l) }); });
        }
      } else {
        rec.loose.forEach(function (l) { topErrors.push({ line: l.line, message: looseError(l) }); });
      }
    }

    var fields = {};
    if (C.formField) {
      fields[C.formField.label] = {
        raw: rec.titleText, value: form || '', display: form || '', line: rec.titleLine,
        error: formError, note: rec.explicit ? '' : (form ? '제목 줄이 없어 항목으로 정했어요' : '')
      };
    }
    var formDef = form ? C.formsByName[form] : null;
    var expected = {};
    if (formDef) formDef.lines.forEach(function (l) { (l.fields || []).forEach(function (x) { expected[x] = true; }); });
    C.extras.forEach(function (fd) { if (fd.required) expected[fd.label] = true; });
    C.fields.forEach(function (fd) {
      if (C.formField && fd.label === C.formField.label) return;
      if (got[fd.label]) {
        fields[fd.label] = got[fd.label];
      } else if (expected[fd.label] && formDef) {
        fields[fd.label] = { raw: '', value: '', display: '', line: 0, error: fd.required ? '항목이 없어요' : '', note: '' };
      }
    });
    out.fields = fields;
    return out;
  }

  // ---------------------------------------------------------------- 글 만들기

  function linePrefix(text) {
    var m = /^[\s\-•·*▪]*/.exec(str(text));
    return m ? m[0] : '';
  }

  function joinValues(labels, vals, C) {
    var types = labels.map(function (lb) { return C.byLabel[lb] ? C.byLabel[lb].type : 'text'; });
    var filled = vals.filter(function (v) { return v !== ''; });
    if (labels.length === 2 && types[0] === 'date' && types[1] === 'time') return filled.join(' ');
    return filled.join(', ');
  }

  /**
   * 양식 모양 그대로 값을 채운 글을 만든다 (보정본·canonicalText).
   * recs = [{ form, values: { 라벨: 값 } }]
   */
  function buildText(schema, recs) {
    var C = compile(schema);
    return (recs || []).map(function (r) {
      var f = C.formsByName[r.form];
      if (!f) return '';
      var values = r.values || {};
      var out = [f.title, ''];
      f.lines.forEach(function (l) {
        var labels = l.fields || [];
        var vals = labels.map(function (x) { return str(values[x]).trim(); });
        var joined = joinValues(labels, vals, C);
        out.push(joined ? l.text.replace(/\s+$/, '') + ' ' + joined : l.text);
      });
      var prefix = f.lines.length ? linePrefix(f.lines[f.lines.length - 1].text) : '';
      C.extras.forEach(function (fd) {
        var v = str(values[fd.label]).trim();
        if (v) out.push(prefix + fd.label + ': ' + v);
      });
      return out.join('\n');
    }).filter(function (t) { return t; }).join('\n\n');
  }

  // ---------------------------------------------------------------- 템플릿

  function formatDateTokens(iso, fmt) {
    var p = parseIso(iso);
    if (!p) return null;
    return fmt.replace(/YYYY|YY|MM|M|DD|D|ddd/g, function (tk) {
      switch (tk) {
        case 'YYYY': return String(p.y);
        case 'YY': return String(p.y).slice(2);
        case 'MM': return pad2(p.m);
        case 'M': return String(p.m);
        case 'DD': return pad2(p.d);
        case 'D': return String(p.d);
        case 'ddd': return weekdayOf(iso);
      }
      return tk;
    });
  }

  function applyFormat(v, fmt, type, label, warnings) {
    var isDate = type === 'date' || (!type && /^\d{4}-\d{2}-\d{2}$/.test(v));
    if (isDate) {
      var d = formatDateTokens(v, fmt);
      if (d !== null) return d;
    }
    if (fmt === '공백') return v.replace(/-/g, ' ');
    if (fmt === '오전오후') return ampmOf(v);
    if (fmt === '쉼표' && /^-?\d+$/.test(v)) return v.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    warnings.push({ label: label, type: 'format', message: label + '의 형식(' + fmt + ')을 알 수 없어요' });
    return v;
  }

  /**
   * '{라벨}', '{라벨:형식}', '{라벨|기본값}' 을 채운다.
   * options: { fields: [필드 정의] (타입·아는 라벨), vars: { 이름: 값 } (설정의 MSG_ 항목) }
   * → { text, warnings: [{ label, type: 'unknown'|'empty'|'format', message }] }
   */
  function fillTemplate(template, values, options) {
    var o = options || {};
    var vals = values || {};
    var vars = o.vars || {};
    var types = {};
    (o.fields || []).forEach(function (f) { types[f.label] = f.type; });
    var warnings = [];
    var text = str(template).replace(/\{([^{}\n]+)\}/g, function (all, inner) {
      var label = inner;
      var def = null;
      var fmt = null;
      var bar = label.indexOf('|');
      if (bar >= 0) { def = label.slice(bar + 1); label = label.slice(0, bar); }
      var colon = label.indexOf(':');
      if (colon >= 0) { fmt = label.slice(colon + 1).trim(); label = label.slice(0, colon); }
      label = label.trim();
      var v;
      if (has(vals, label) || has(types, label)) v = vals[label];
      else if (has(vars, label)) v = vars[label];
      else {
        warnings.push({ label: label, type: 'unknown', message: '모르는 항목이에요: {' + label + '}' });
        return all;
      }
      v = str(v).trim();
      if (v === '') {
        if (def !== null) return def;
        warnings.push({ label: label, type: 'empty', message: label + ' 값이 비어 있어요' });
        return '';
      }
      return fmt ? applyFormat(v, fmt, types[label], label, warnings) : v;
    });
    return { text: text, warnings: warnings };
  }

  // ---------------------------------------------------------------- 줄 비교 (LCS)

  /** 두 글을 줄 단위로 비교 → [{ type: 'same'|'del'|'add', text, a, b }] (a, b: 1부터 줄 번호) */
  function diffLines(a, b) {
    var A = str(a).replace(/\r\n?/g, '\n').split('\n');
    var B = str(b).replace(/\r\n?/g, '\n').split('\n');
    var n = A.length;
    var m = B.length;
    var L = [];
    for (var i = 0; i <= n; i++) {
      L.push(new Array(m + 1).fill(0));
    }
    for (var x = n - 1; x >= 0; x--) {
      for (var y = m - 1; y >= 0; y--) {
        L[x][y] = A[x] === B[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
      }
    }
    var out = [];
    var p = 0;
    var q = 0;
    while (p < n && q < m) {
      if (A[p] === B[q]) { out.push({ type: 'same', text: A[p], a: p + 1, b: q + 1 }); p++; q++; }
      else if (L[p + 1][q] >= L[p][q + 1]) { out.push({ type: 'del', text: A[p], a: p + 1, b: 0 }); p++; }
      else { out.push({ type: 'add', text: B[q], a: 0, b: q + 1 }); q++; }
    }
    while (p < n) { out.push({ type: 'del', text: A[p], a: p + 1, b: 0 }); p++; }
    while (q < m) { out.push({ type: 'add', text: B[q], a: 0, b: q + 1 }); q++; }
    return out;
  }

  // ---------------------------------------------------------------- 내보내기

  function formFieldLabel(schema) {
    var f = compile(schema).formField;
    return f ? f.label : '';
  }

  function memoFieldLabel(schema) {
    var f = compile(schema).memoField;
    return f ? f.label : '';
  }

  return {
    VERSION: VERSION,
    MAX_TEXT: MAX_TEXT,
    DEFAULT_UNITS: DEFAULT_UNITS,
    parse: parse,
    validateValue: validateValue,
    buildText: buildText,
    blankForm: blankForm,
    fillTemplate: fillTemplate,
    diffLines: diffLines,
    todaySeoul: todaySeoul,
    addDays: addDays,
    diffDays: diffDays,
    weekdayOf: weekdayOf,
    displayDate: displayDate,
    displayTime: displayTime,
    ampmOf: ampmOf,
    labelOfLine: labelOfLine,
    normLabel: normLabel,
    formFieldLabel: formFieldLabel,
    memoFieldLabel: memoFieldLabel
  };
})();

if (typeof module !== 'undefined') module.exports = FormatCore;
