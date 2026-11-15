# 브라우저 프로토타입

React·TypeScript UI와 로컬 증권사 API 서버입니다. 기본 `demo` 모드는 API 키 없이 실행합니다.

## 실행

Node.js 24 환경에서 확인했습니다. 저장소 루트에서 실행합니다.

```sh
cd prototype
npm ci
npm run dev
```

화면은 `http://127.0.0.1:4174`, API 서버는 `http://127.0.0.1:4176`입니다. `UI_PORT=4175 npm run dev`로 화면 포트를 바꿀 수 있습니다. 증권사 연결 시 `APP_ORIGINS`에도 해당 주소를 설정합니다.

```sh
npm test
npm run build
npm run preview
```

빌드는 `dist/`에 생성합니다. 개발 서버와 preview 모두 로컬 API 서버를 함께 실행합니다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `src/` | 관심종목·브리핑·주문 UI, 물리 입력, 모의 주문 원장 |
| `server/` | HTTP 서버, 인증 설정, 요청 기록, 증권사별 API 연결 |
| `shared/` | 브라우저·서버 데이터 형식 |
| `scripts/dev.mjs` | UI·API 서버 실행과 종료 |
| `.env.example` | 비밀값이 없는 설정 예시 |

[데모 사용법](../docs/demo-guide.md), [API 대응](../docs/architecture.md), [검증 결과](../docs/validation.md)를 함께 참고합니다. 한국투자증권·키움의 모의투자 키 설정은 [증권사 연결](BROKER-INTEGRATION.md)에 있습니다.

`.env.local`, `.broker-data/`, `node_modules/`, `dist/`는 Git에서 제외합니다. 폰트는 npm 패키지에서 로컬 제공하며 [OFL 라이선스](public/licenses/asta-sans-OFL.txt)를 따릅니다.

배포 파일에는 [외부 라이브러리 고지](public/THIRD-PARTY-NOTICES.txt)를 포함합니다.
