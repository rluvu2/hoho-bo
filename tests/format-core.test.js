// FormatCore 테스트 — node --test
// '오늘'은 항상 고정해서 넣는다. 모든 값은 가짜다.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const FormatCore = require('../assets/js/format-core.js');
const SchemaDefaults = require('../assets/js/schema-defaults.js');

const schema = SchemaDefaults.schema();
const TODAY = '2026-10-20';
const opt = { today: TODAY, rolloverDays: 30 };
const parse = (text, o) => FormatCore.parse(text, schema, Object.assign({}, opt, o || {}));
const values = (rec) => Object.fromEntries(Object.entries(rec.fields).map(([k, v]) => [k, v.value]));
const errorsOf = (r) => {
  const out = r.errors.map((e) => e.line + ': ' + e.message);
  r.records.forEach((rec) => Object.entries(rec.fields).forEach(([k, v]) => { if (v.error) out.push(k + ': ' + v.error); }));
  return out;
};

const ARRIVAL = [
  '도착 정보 확인 요청',
  '',
  '  - 도착 날짜, 시간 : 10월 22일 17:00',
  '  - 항공 편명: ke 703',
  '  - 인원: 2명',
  '  - 짐 개수: 3개',
  '  - 이름(피케팅 네임) JOHN SMITH',
  '  - 연락처: +1 415 555 0100',
  '  - 목적지 상세 주소: 서울특별시 가상구 예시로 12'
].join('\n');

const DEPARTURE = [
  '출발 정보 확인요청',
  '',
  '- 출발 날짜: 11/2',
  '- 출발시간 : 오후 3시',
  '- 항공편명 : OZ 102',
  '- 인원,짐개수: 2명, 3개',
  '- 이름(확인용): KIM YESI',
  '- 연락처: 010 0000 1234',
  '- 출발지 상세주소: 부산광역시 가상구 샘플로 34'
].join('\n');

// ------------------------------------------------------------ 빈 양식

test('빈 양식은 고객에게 보내는 원문과 글자까지 같다', () => {
  assert.equal(FormatCore.blankForm(schema, '도착'), [
    '도착 정보 확인 요청',
    '',
    '  - 도착 날짜, 시간 :',
    '  - 항공 편명:',
    '  - 인원:',
    '  - 짐 개수:',
    '  - 이름(피케팅 네임) ',
    '  - 연락처:',
    '  - 목적지 상세 주소:'
  ].join('\n'));
  assert.equal(FormatCore.blankForm(schema, '출발'), [
    '출발 정보 확인요청',
    '',
    '- 출발 날짜:',
    '- 출발시간 :',
    '- 항공편명 :',
    '- 인원,짐개수:',
    '- 이름(확인용):',
    '- 연락처:',
    '- 출발지 상세주소:'
  ].join('\n'));
});

test('빈 양식을 그대로 붙여넣으면 필수 칸이 비어 있어 저장할 수 없다', () => {
  const r = parse(FormatCore.blankForm(schema, '도착'));
  assert.equal(r.ok, false);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].fields['이름'].error, '값이 비어 있어요');
});

// ------------------------------------------------------------ ✓ 경우

test('✓ 도착 양식', () => {
  const r = parse(ARRIVAL);
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.ok, true);
  assert.equal(r.records.length, 1);
  const v = values(r.records[0]);
  assert.equal(v['구분'], '도착');
  assert.equal(v['날짜'], '2026-10-22');
  assert.equal(v['시간'], '17:00');
  assert.equal(v['항공편'], 'KE703');
  assert.equal(v['인원'], '2');
  assert.equal(v['짐'], '3');
  assert.equal(v['이름'], 'JOHN SMITH');
  assert.equal(v['연락처'], '+1 415 555 0100');
  assert.equal(v['주소'], '서울특별시 가상구 예시로 12');
  assert.equal(r.records[0].fields['날짜'].raw, '10월 22일');
  assert.equal(r.records[0].fields['시간'].raw, '17:00');
  assert.equal(r.records[0].fields['날짜'].display, '10월 22일 (목)');
  assert.equal(r.records[0].fields['시간'].display, '17:00 (오후 5:00)');
});

test('✓ 출발 양식', () => {
  const r = parse(DEPARTURE);
  assert.deepEqual(errorsOf(r), []);
  const v = values(r.records[0]);
  assert.equal(v['구분'], '출발');
  assert.equal(v['날짜'], '2026-11-02');
  assert.equal(v['시간'], '15:00');
  assert.equal(v['항공편'], 'OZ102');
  assert.equal(v['인원'], '2');
  assert.equal(v['짐'], '3');
  assert.equal(v['연락처'], '010-0000-1234');
  assert.equal(r.records[0].fields['인원'].raw, '2명');
  assert.equal(r.records[0].fields['짐'].raw, '3개');
});

test('✓ 왕복 두 블록, 다음 줄의 이름, 두 줄 주소, 메모 줄, 09:30', () => {
  const text = [
    '도착 정보 확인 요청',
    '',
    '  - 도착 날짜, 시간 : 10/22 09:30',
    '  - 항공 편명: 7C 1101',
    '  - 인원: 3',
    '  - 짐 개수: 4',
    '  - 이름(피케팅 네임)',
    'LEE GAJJA',
    '  - 연락처: 010-0000-2222',
    '  - 목적지 상세 주소: 서울특별시 가상구 예시로 1',
    '101동 1001호',
    '메모: 카시트 1개 부탁드려요',
    '',
    '출발 정보 확인요청',
    '',
    '- 출발 날짜: 2026.10.30',
    '- 출발시간 : 오전 7시 30분',
    '- 항공편명 : KE 704',
    '- 인원,짐개수: 3, 4',
    '- 이름(확인용): LEE GAJJA',
    '- 연락처: 010-0000-2222',
    '- 출발지 상세주소: 서울특별시 가상구 예시로 1 101동 1001호'
  ].join('\n');
  const r = parse(text);
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.records.length, 2);
  const a = values(r.records[0]);
  const d = values(r.records[1]);
  assert.equal(a['구분'], '도착');
  assert.equal(a['시간'], '09:30');
  assert.equal(a['항공편'], '7C1101');
  assert.equal(a['이름'], 'LEE GAJJA');
  assert.equal(a['주소'], '서울특별시 가상구 예시로 1\n101동 1001호');
  assert.equal(a['메모'], '카시트 1개 부탁드려요');
  assert.equal(d['구분'], '출발');
  assert.equal(d['날짜'], '2026-10-30');
  assert.equal(d['시간'], '07:30');
  assert.equal(d['인원'], '3');
  assert.equal(d['짐'], '4');
});

test('✓ 양식 마지막 항목 아래에 덧붙인 글은 메모로 들어간다 (확정 사항)', () => {
  const r = parse(ARRIVAL + '\n\n유아 1명 있어요. 카시트 부탁드립니다.\n요청사항: 생수 2병');
  assert.deepEqual(errorsOf(r), []);
  const memo = r.records[0].fields['메모'];
  assert.equal(memo.value, '유아 1명 있어요. 카시트 부탁드립니다.\n요청사항: 생수 2병');
  assert.equal(memo.note, '양식 아래 글을 메모로 넣었어요');
  assert.equal(memo.line, 11);
});

test('✓ 메모 줄이 있고 아래에 글이 더 있으면 메모에 이어 붙인다', () => {
  const r = parse(ARRIVAL + '\n메모: 카시트\n\n감사합니다');
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.records[0].fields['메모'].value, '카시트\n감사합니다');
});

test('✓ 제목 줄이 없으면 한 양식에만 있는 라벨로 구분을 정한다', () => {
  const r = parse(DEPARTURE.split('\n').slice(2).join('\n'));
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.records[0].form, '출발');
  assert.equal(r.records[0].fields['구분'].note, '제목 줄이 없어 항목으로 정했어요');
});

test('✓ 라벨 공백·콜론 차이, 괄호 뺀 라벨, 전각 콜론', () => {
  const text = [
    '도착정보 확인요청',
    '도착날짜,시간: 2026-10-22 오후 5시',
    '항공편명 : KE703',
    '인원 ： 2',
    '짐개수: 3',
    '이름: JOHN SMITH',
    '• 연락처: 010-0000-1234',
    '* 목적지 상세주소: 가상시 예시동'
  ].join('\n');
  const r = parse(text);
  assert.deepEqual(errorsOf(r), []);
  assert.equal(values(r.records[0])['시간'], '17:00');
  assert.equal(values(r.records[0])['이름'], 'JOHN SMITH');
});

test('✓ 인원,짐개수 단위로 나누기', () => {
  const line = (v) => DEPARTURE.replace('- 인원,짐개수: 2명, 3개', '- 인원,짐개수: ' + v);
  const pair = (v) => { const rec = parse(line(v)).records[0]; return [rec.fields['인원'], rec.fields['짐']]; };
  assert.deepEqual(pair('3개, 2명').map((f) => f.value), ['2', '3']);
  assert.deepEqual(pair('3개, 2').map((f) => f.value), ['2', '3']);
  assert.deepEqual(pair('2 / 3').map((f) => f.value), ['2', '3']);
  assert.deepEqual(pair('인원 2명 짐 3개').map((f) => f.value), ['2', '3']);
  assert.ok(pair('2명, 3명')[0].error);
  assert.ok(pair('2명, 캐리어 3개')[0].error, '모르는 말이 섞이면 문제');
});

test('canonicalText 는 다시 읽어도 같은 값이 나온다', () => {
  const r = parse(ARRIVAL + '\n\n' + DEPARTURE);
  const again = parse(r.canonicalText);
  assert.deepEqual(errorsOf(again), []);
  assert.deepEqual(again.records.map(values), r.records.map(values));
  assert.ok(r.canonicalText.startsWith('도착 정보 확인 요청\n\n  - 도착 날짜, 시간 : 2026-10-22 17:00'));
  assert.ok(r.canonicalText.includes('  - 이름(피케팅 네임) JOHN SMITH'));
});

// ------------------------------------------------------------ ✗ 경우

test('✗ 양식 위에 인사말이 섞인 경우', () => {
  const r = parse('안녕하세요 예약 부탁드립니다\n\n' + ARRIVAL);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].line, 1);
  assert.match(r.errors[0].message, /양식에 없는 문장/);
});

test('✗ 항목 사이에 끼어든 문장', () => {
  const text = ARRIVAL.replace('  - 인원: 2명', '  - 인원: 2명\n\n아이도 있어요\n');
  const r = parse(text);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /아이도 있어요/);
});

test('✗ 오전·오후 없는 1~11시 (5시, 9:30, 10:30)', () => {
  for (const t of ['5시', '9:30', '10:30']) {
    const r = parse(ARRIVAL.replace('10월 22일 17:00', '10월 22일 ' + t));
    assert.equal(r.ok, false, t);
    assert.equal(r.records[0].fields['시간'].error, '오전·오후를 적어 주세요', t);
  }
});

test('✗ 지난 날짜', () => {
  const r = parse(ARRIVAL.replace('10월 22일 17:00', '10월 19일 17:00'));
  assert.equal(r.ok, false);
  assert.match(r.records[0].fields['날짜'].error, /지난 날짜/);
  // 시트에서 소유자가 고칠 때는 허용
  assert.equal(FormatCore.validateValue('date', '10월 19일', Object.assign({ allowPast: true }, opt)).value, '2026-10-19');
});

test('✗ 콜론이 있는 모르는 라벨 (항목 사이)', () => {
  const r = parse(ARRIVAL.replace('  - 인원: 2명', '  - 인원: 2명\n  - 요청사항: 카시트'));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /알 수 없는 항목이에요: 요청사항/);
});

test('✗ 제목 없이 두 양식 라벨이 섞인 경우', () => {
  const text = [
    '출발 날짜: 11/2',
    '출발시간: 오후 3시',
    '항공 편명: KE703',
    '인원: 2',
    '짐 개수: 3',
    '이름: KIM',
    '연락처: 010-0000-1234',
    '목적지 상세 주소: 가상시'
  ].join('\n');
  const r = parse(text);
  assert.equal(r.ok, false);
  assert.match(r.records[0].fields['구분'].error, /섞여 있어요/);
});

test('✗ 제목이 있는 블록에 다른 양식의 항목', () => {
  const r = parse(DEPARTURE.replace('- 인원,짐개수: 2명, 3개', '- 인원: 2'));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /출발 양식에 없는 항목이에요: 인원/.test(e.message)));
});

test('✗ 항공편 형식 틀림', () => {
  for (const f of ['703', 'KOREAN AIR', 'KE70312', 'K']) {
    const r = parse(ARRIVAL.replace('ke 703', f));
    assert.equal(r.ok, false, f);
    assert.match(r.records[0].fields['항공편'].error, /항공편 형식/, f);
  }
});

test('✗ 인원,짐개수에 숫자가 하나', () => {
  const r = parse(DEPARTURE.replace('2명, 3개', '2명'));
  assert.equal(r.ok, false);
  assert.ok(r.records[0].fields['인원'].error);
  assert.ok(r.records[0].fields['짐'].error);
});

test('✗ 필수 칸 빈 값과 빠진 항목', () => {
  const r1 = parse(ARRIVAL.replace('  - 연락처: +1 415 555 0100', '  - 연락처:'));
  assert.equal(r1.records[0].fields['연락처'].error, '값이 비어 있어요');
  const r2 = parse(ARRIVAL.replace('  - 연락처: +1 415 555 0100\n', ''));
  assert.equal(r2.records[0].fields['연락처'].error, '항목이 없어요');
  assert.equal(r1.ok || r2.ok, false);
});

test('✗ 같은 항목이 두 번', () => {
  const r = parse(ARRIVAL + '\n  - 인원: 3');
  assert.equal(r.ok, false);
  assert.match(r.records[0].fields['인원'].error, /두 번/);
});

test('✗ "이름은 …" 같은 문장은 라벨로 읽지 않는다', () => {
  const r = parse(ARRIVAL.replace('  - 이름(피케팅 네임) JOHN SMITH', '이름은 홍길동입니다'));
  assert.equal(r.ok, false);
  assert.equal(r.records[0].fields['이름'].error, '항목이 없어요');
});

test('✗ 빈 글, 너무 긴 글', () => {
  assert.equal(parse('  \n ').ok, false);
  const r = parse('가'.repeat(5001));
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /5,000자/);
});

// ------------------------------------------------------------ 연도 추정

test('연도 추정: 오늘이 12월 20일이면 1월 5일은 다음 해', () => {
  const o = { today: '2026-12-20', rolloverDays: 30 };
  assert.equal(FormatCore.validateValue('date', '1월 5일', o).value, '2027-01-05');
  assert.equal(FormatCore.validateValue('date', '12/25', o).value, '2026-12-25');
  // 30일 이내로 지난 날짜는 올해 (P2에서는 지난 날짜라 문제)
  const past = FormatCore.validateValue('date', '12월 1일', o);
  assert.match(past.error, /지난 날짜/);
  assert.equal(FormatCore.validateValue('date', '12월 1일', Object.assign({ allowPast: true }, o)).value, '2026-12-01');
  assert.equal(FormatCore.validateValue('date', '1월 5일', o).display, '2027년 1월 5일 (화)');
});

// ------------------------------------------------------------ 타입별

test('date 형식들', () => {
  const v = (s) => FormatCore.validateValue('date', s, opt);
  assert.equal(v('2026-11-03').value, '2026-11-03');
  assert.equal(v('2026.11.3').value, '2026-11-03');
  assert.equal(v('2026/11/03').value, '2026-11-03');
  assert.equal(v('26.11.03').value, '2026-11-03');
  assert.equal(v('11.3').value, '2026-11-03');
  assert.equal(v('2026년 11월 3일').value, '2026-11-03');
  assert.equal(v('11월 3일 (화)').value, '2026-11-03');
  assert.match(v('11월 3일 (수)').error, /요일이 날짜와 달라요/);
  assert.match(v('2월 30일').error, /없는 날짜/);
  assert.match(v('내일').error, /날짜를 읽을 수 없어요/);
  assert.match(v('11/3 오후').error, /날짜 뒤에/);
});

test('time 형식들', () => {
  const v = (s) => FormatCore.validateValue('time', s);
  const ok = {
    '17:00': '17:00', '09:30': '09:30', '17시': '17:00', '17시 30분': '17:30', '오후 5시': '17:00',
    '오전 9:30': '09:30', '새벽 2시': '02:00', '저녁 7시': '19:00', '5pm': '17:00', '5:30 PM': '17:30',
    'pm 5:30': '17:30', '0:30': '00:30', '00:30': '00:30', '오후 12시': '12:00', '정오': '12:00',
    '오후 5시 반': '17:30', '12:00': '12:00', '23:59': '23:59', '밤 11시': '23:00', '오전 0시 10분': '00:10'
  };
  for (const [k, want] of Object.entries(ok)) assert.equal(v(k).value, want, k);
  const bad = ['5시', '9:30', '11시', '5시 반', '자정', '밤 12시', '오전 12시', '새벽 12시', '밤 2시', '5시쯤', '17:00-18:00', '25:00', '17:75', '오전 17시', '오후'];
  for (const k of bad) assert.ok(v(k).error, k);
  assert.equal(v('17:00').display, '17:00 (오후 5:00)');
  assert.equal(v('09:30').display, '09:30 (오전 9:30)');
});

test('flight 형식들', () => {
  const v = (s) => FormatCore.validateValue('flight', s);
  assert.equal(v('ke 703').value, 'KE703');
  assert.equal(v('oz-102').value, 'OZ102');
  assert.equal(v('7C1101').value, '7C1101');
  assert.equal(v('KAL703').value, 'KAL703');
  assert.equal(v('KE703A').value, 'KE703A');
});

test('number 형식들', () => {
  const v = (s) => FormatCore.validateValue('number', s);
  assert.equal(v('2명').value, '2');
  assert.equal(v('35,000원').value, '35000');
  assert.equal(v('0').value, '0');
  assert.ok(v('-1').error);
  assert.ok(v('두명').error);
  assert.ok(v('1.5').error);
});

test('phone 형식들', () => {
  const v = (s) => FormatCore.validateValue('phone', s);
  assert.equal(v('01000001234').value, '010-0000-1234');
  assert.equal(v('010 0000 1234').value, '010-0000-1234');
  assert.equal(v('+82 10-0000-1234').value, '010-0000-1234');
  assert.equal(v('+82 010 0000 1234').value, '010-0000-1234');
  assert.equal(v('02 123 4567').value, '02-123-4567');
  assert.equal(v('031-1234-5678').value, '031-1234-5678');
  assert.equal(v('1588-0000').value, '1588-0000');
  assert.equal(v('+1 415 555 0100').value, '+1 415 555 0100');
  assert.equal(v('+1 (415) 555-0100').value, '+1 415 555-0100');
  assert.equal(v('001 415 555 0100').value, '001 415 555 0100');
  assert.ok(v('12345').error);
  assert.ok(v('+1 23').error);
  assert.ok(v('010-1234').error);
});

test('select, email, text', () => {
  assert.equal(FormatCore.validateValue('select', ' 접수 ', { options: ['접수', '취소'] }).value, '접수');
  assert.ok(FormatCore.validateValue('select', '대기중', { options: ['접수', '취소'] }).error);
  assert.equal(FormatCore.validateValue('email', 'a@example.com').value, 'a@example.com');
  assert.ok(FormatCore.validateValue('email', 'a@b').error);
  assert.equal(FormatCore.validateValue('text', '  홍 길동 ').value, '홍 길동');
  assert.equal(FormatCore.validateValue('text', '', { required: true }).error, '값이 비어 있어요');
  assert.equal(FormatCore.validateValue('text', '', { required: false }).error, '');
});

// ------------------------------------------------------------ 템플릿

test('템플릿: 0-6 배차 안내', () => {
  const tpl = SchemaDefaults.templates[0].body;
  const row = {
    '구분': '도착', '날짜': '2026-10-22', '시간': '17:00', '차종': '카니발',
    '기사': '김예시', '기사 연락처': '010-8600-0000', '차량번호': '00가 0000'
  };
  const r = FormatCore.fillTemplate(tpl, row, { fields: schema.fields, vars: { '고객센터': '010-0000-9999' } });
  assert.deepEqual(r.warnings, []);
  assert.ok(r.text.includes('• 일시: 10월 22일 17:00 도착'));
  assert.ok(r.text.includes('\n010 8600 0000\n'));
  assert.ok(r.text.includes('(고객센터: 010-0000-9999)'));
  assert.ok(r.text.endsWith('00가 0000'));
});

test('템플릿: 기본값, 빈 값 경고, 모르는 라벨, 날짜 토큰', () => {
  const f = (tpl, vals) => FormatCore.fillTemplate(tpl, vals, { fields: schema.fields });
  assert.equal(f('{기사|미배차}', { '기사': '' }).text, '미배차');
  const empty = f('[{기사}]', { '기사': '' });
  assert.equal(empty.text, '[]');
  assert.deepEqual(empty.warnings.map((w) => w.type), ['empty']);
  const unknown = f('{없는칸}', {});
  assert.equal(unknown.text, '{없는칸}');
  assert.equal(unknown.warnings[0].type, 'unknown');
  assert.equal(f('{날짜:M/D (ddd)}', { '날짜': '2026-10-22' }).text, '10/22 (목)');
  assert.equal(f('{날짜:YYYY-MM-DD}', { '날짜': '2026-10-02' }).text, '2026-10-02');
  assert.equal(f('{시간:오전오후}', { '시간': '17:00' }).text, '오후 5:00');
  assert.equal(f('{요금:쉼표}원', { '요금': '50000' }).text, '50,000원');
  const cal = FormatCore.fillTemplate(SchemaDefaults.calendar.title,
    { '구분': '출발', '이름': 'KIM', '항공편': 'OZ102', '인원': 2, '짐': 3, '기사': '' }, { fields: schema.fields });
  assert.equal(cal.text, '[출발] KIM OZ102 2명·짐3 / 미배차');
});

// ------------------------------------------------------------ 기타

test('diffLines: 줄 단위 LCS', () => {
  const d = FormatCore.diffLines('a\nb\nc', 'a\nx\nc\nd');
  assert.deepEqual(d.map((x) => x.type + ':' + x.text), ['same:a', 'del:b', 'add:x', 'same:c', 'add:d']);
});

test('todaySeoul 은 Asia/Seoul 기준', () => {
  // 2026-10-20 15:30 UTC = 2026-10-21 00:30 KST
  assert.equal(FormatCore.todaySeoul(Date.UTC(2026, 9, 20, 15, 30)), '2026-10-21');
  assert.equal(FormatCore.todaySeoul(Date.UTC(2026, 9, 20, 14, 59)), '2026-10-20');
});

test('구분·메모 필드는 필드 정의로 정해진다', () => {
  assert.equal(FormatCore.formFieldLabel(schema), '구분');
  assert.equal(FormatCore.memoFieldLabel(schema), '메모');
});
