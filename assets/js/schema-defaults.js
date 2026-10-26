/*
 * SchemaDefaults — 필드·양식·메시지 템플릿의 초기값
 *
 * 이 파일이 원본이다. ①의 setup() 이 시트가 없을 때만 이 값으로 채우고,
 * 그 뒤로는 시트가 기준이다 (코드 수정 없이 시트에서 바꾼다).
 * github.io 목업 모드와 테스트도 이 값을 쓴다. 공개 저장소에 올라가므로
 * 실제 고객·기사 정보나 비밀값을 넣지 않는다. 예시 값은 모두 가짜다.
 */
var SchemaDefaults = (function () {
  'use strict';

  // 라벨 | 타입 | 필수 | 선택지 | 예시 | 입력 | P1 표시 | P1 검색 | P3 표시 | AI 가림
  // 선택지 '@기사' = 기사 시트에서 사용 체크된 이름 목록
  var FIELD_ROWS = [
    ['구분', 'select', true, '도착,출발', '도착', '양식', true, '선택', true, false],
    ['날짜', 'date', true, '', '2026-10-22', '양식', true, '기간', true, false],
    ['시간', 'time', true, '', '17:00', '양식', true, '없음', true, false],
    ['항공편', 'flight', true, '', 'KE703', '양식', true, '키워드', true, false],
    ['인원', 'number', true, '', '2', '양식', true, '없음', true, false],
    ['짐', 'number', true, '', '3', '양식', true, '없음', true, false],
    ['이름', 'text', true, '', 'HONG GILDONG', '양식', true, '키워드', true, true],
    ['연락처', 'phone', true, '', '010-0000-1234', '양식', true, '키워드', true, true],
    ['주소', 'longtext', true, '', '서울특별시 가상구 예시로 12, 101동 1001호', '양식', true, '키워드', true, true],
    ['메모', 'longtext', false, '', '카시트 1개 요청', '양식', true, '없음', false, false],
    ['상태', 'select', false, '접수,배차완료,운행완료,취소', '접수', '시트', true, '선택', true, false],
    ['기사', 'select', false, '@기사', '김예시', '시트', true, '선택', true, false],
    ['기사 연락처', 'phone', false, '', '010-0000-5678', '시트', false, '없음', true, false],
    ['차종', 'text', false, '', '카니발', '시트', false, '없음', true, false],
    ['차량번호', 'text', false, '', '00가 0000', '시트', false, '없음', true, false],
    ['요금', 'number', false, '', '50000', '시트', true, '없음', false, false],
    ['기사 정산액', 'number', false, '', '40000', '시트', true, '없음', false, false],
    ['정산', 'select', false, '대기,완료', '대기', '시트', true, '선택', false, false]
  ];

  var fields = FIELD_ROWS.map(function (r) {
    var from = r[3].charAt(0) === '@' ? r[3].slice(1) : '';
    return {
      label: r[0], type: r[1], required: r[2],
      options: r[3] && !from ? r[3].split(',') : [],
      optionsFrom: from,
      example: r[4], input: r[5], p1Show: r[6], p1Search: r[7], p3Show: r[8], aiMask: r[9]
    };
  });

  // 고객에게 보내는 원문 그대로 (앞 공백, '-', 콜론 위치, 끝 공백 포함)
  var forms = [
    {
      name: '도착',
      title: '도착 정보 확인 요청',
      lines: [
        { text: '  - 도착 날짜, 시간 :', fields: ['날짜', '시간'] },
        { text: '  - 항공 편명:', fields: ['항공편'] },
        { text: '  - 인원:', fields: ['인원'] },
        { text: '  - 짐 개수:', fields: ['짐'] },
        { text: '  - 이름(피케팅 네임) ', fields: ['이름'] },
        { text: '  - 연락처:', fields: ['연락처'] },
        { text: '  - 목적지 상세 주소:', fields: ['주소'] }
      ]
    },
    {
      name: '출발',
      title: '출발 정보 확인요청',
      lines: [
        { text: '- 출발 날짜:', fields: ['날짜'] },
        { text: '- 출발시간 :', fields: ['시간'] },
        { text: '- 항공편명 :', fields: ['항공편'] },
        { text: '- 인원,짐개수:', fields: ['인원', '짐'] },
        { text: '- 이름(확인용):', fields: ['이름'] },
        { text: '- 연락처:', fields: ['연락처'] },
        { text: '- 출발지 상세주소:', fields: ['주소'] }
      ]
    }
  ];

  // {고객센터} 는 설정 시트의 MSG_고객센터 값으로 채워진다 (번호는 공개 코드에 두지 않음)
  var templates = [
    {
      name: '배차 안내',
      body: [
        '안녕하세요 호호모빌리티입니다.',
        '예약하신 배차 정보 안내해 드립니다.',
        '기사님이 미리 대기할 예정이며, 문의 사항은 언제든 연락해 주세요.',
        '',
        '(고객센터: {고객센터})',
        '',
        '편안하게 모시겠습니다. 감사합니다.',
        '',
        '[배차 정보]',
        '• 일시: {날짜:M월 D일} {시간} {구분}',
        '',
        '■배차정보■',
        '',
        '{차종}',
        '{기사}',
        '{기사 연락처:공백}',
        '{차량번호}'
      ].join('\n'),
      active: true
    }
  ];

  var calendar = {
    title: '[{구분}] {이름} {항공편} {인원}명·짐{짐} / {기사|미배차}',
    desc: ['연락처: {연락처}', '주소: {주소}', '차량: {차종} {차량번호}', '메모: {메모}'].join('\n')
  };

  return {
    fields: fields,
    forms: forms,
    templates: templates,
    calendar: calendar,
    schema: function () { return { fields: fields, forms: forms }; }
  };
})();

if (typeof module !== 'undefined') module.exports = SchemaDefaults;
