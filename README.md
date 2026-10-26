# 호호모빌리티 백오피스 — 관리자 화면 (GitHub Pages)

공항 픽업·샌딩 예약을 확인하고 배차 안내 문구를 만드는 **읽기 전용** 관리자 화면입니다.
빌드 없이 그대로 올라가는 순수 HTML/CSS/JS이고, 데이터는 Google Apps Script 웹앱에서 읽어 옵니다.

| 화면 | 파일 | 내용 |
|---|---|---|
| 로그인 | `index.html` | 관리자 비밀번호, 자동로그인 링크(`#k=`) |
| 데이터 확인 | `data.html` | 필터·정렬·페이지, 행 자세히 보기 |
| 메시지 | `messages.html` | 예약별 안내 문구 미리보기·복사, 선택 복사 |
| 대시보드 | `dashboard.html` | 기간·단위, KPI 8개, 차트 4개 |

예약 수정·삭제·기사 배정은 구글 시트에서, 새 예약 입력은 별도 입력 웹앱에서 합니다 (상단 메뉴 **입력 ↗**). 백엔드 코드는 이 저장소에 없습니다.

## 설정

`assets/js/config.js` 만 고칩니다. **비밀번호·키·스프레드시트 ID·API 키는 절대 넣지 마세요** (공개 저장소).

```js
var CONFIG = {
  APP_NAME: '호호모빌리티 백오피스',
  API_URL: 'https://script.google.com/macros/s/…/exec',   // 관리 웹앱
  INPUT_URL: 'https://script.google.com/macros/s/…/exec'  // 입력 웹앱
};
```

`API_URL`이 비어 있거나 주소에 `?mock=1`을 붙이면 **목업 모드**(가짜 데이터, 비밀번호 `mockadmin`)로 동작합니다.

## 배포 (GitHub Pages)

1. 저장소 **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main** / **(root)** → Save.
2. 몇 분 뒤 `https://<아이디>.github.io/<저장소>/` 에서 열립니다. 모든 경로가 상대 경로라 저장소 이름이 바뀌어도 코드는 그대로입니다.
3. CSS·JS를 고쳤으면 push 전에 `node scripts/bump-version.js`로 캐시 버전(`?v=`)을 올립니다.

검색엔진 노출 방지(`noindex`), 리퍼러 차단, Content-Security-Policy(스크립트는 이 사이트만, 통신은 `script.google.com`·`script.googleusercontent.com`만)가 모든 페이지에 들어 있습니다. 외부 CDN은 쓰지 않습니다.

## 로컬에서 확인 (Node 22 이상, 설치할 패키지 없음)

```
node scripts/serve.js                     # http://localhost:8080/?mock=1
node scripts/serve.js 8080 --base=/hoho-bo  # 프로젝트 사이트처럼 하위 경로에서
node --test                               # FormatCore 테스트 (+ backend/ 가 있으면 백엔드 테스트)
node scripts/smoke.js --shots=./shots     # Chrome·Edge headless 로 모든 화면 확인 (콘솔 오류 0)
```

## 폴더

```
index.html  data.html  messages.html  dashboard.html
assets/css/app.css
assets/js/config.js        설정 (웹앱 주소 두 개, 앱 이름)
assets/js/auth.js          로그인 상태 (키·역할·이름만 저장), #k= 자동 로그인
assets/js/api.js           요청·오류 처리·목업 모드
assets/js/format-core.js   양식 읽기·검사·템플릿 채우기 (원본, 백엔드와 공유)
assets/js/schema-defaults.js  필드·양식·템플릿 초기값 (가짜 예시)
assets/js/ui.js · filters.js · charts.js · mock-data.js · 화면별 js
tests/                     node --test
scripts/                   복사·검사·로컬 서버·미리보기·브라우저 확인 (Node 내장 기능만)
```

화면은 데이터를 `textContent`로만 그립니다 (`innerHTML` 금지 — `node scripts/check.js`가 확인).
