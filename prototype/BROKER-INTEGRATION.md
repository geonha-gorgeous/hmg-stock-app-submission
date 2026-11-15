# 공개 증권 API 연결

한국투자증권·키움의 국내주식 모의투자 API 연결 모듈과 로컬 서버를 브라우저 프로토타입에 연결했습니다.

현재 검증은 자동 테스트와 로컬 테스트 응답을 이용한 브라우저 조작까지입니다. 실제 증권사 API 키를 사용한 인증·조회·모의 주문·취소는 실행하지 않았습니다.

## 실행과 계좌 설정

Node.js 24에서 다음 명령으로 화면과 API 서버를 함께 실행합니다.

```sh
cd prototype
npm ci
cp .env.example .env.local
npm run dev
```

이미 `.env.local`이 있으면 복사 명령을 생략합니다. 화면은 `http://127.0.0.1:4174`, API 서버는 `http://127.0.0.1:4176`입니다. 초기 `BROKER_PROVIDER=demo`는 기존 예시 데이터와 브라우저 내부 주문을 사용합니다.

증권사 연결에는 `.env.local`의 `BROKER_PROVIDER`를 `kis` 또는 `kiwoom`으로 변경하고 아래 값을 직접 설정합니다. 키와 계좌 정보는 대화·화면 입력창·Git 저장소에 전달하지 않습니다. 설정 변경 후 실행 중인 서버를 종료하고 다시 시작합니다.

| 항목 | 한국투자증권 | 키움증권 |
| --- | --- | --- |
| `BROKER_PROVIDER` | `kis` | `kiwoom` |
| 모의 키 | `KIS_APP_KEY`, `KIS_APP_SECRET` | `KIWOOM_APP_KEY`, `KIWOOM_APP_SECRET` |
| 계좌 설정 | `KIS_ACCOUNT_NUMBER` 8자리, `KIS_ACCOUNT_PRODUCT` 2자리 | 발급 키에 연결된 계좌 |
| 신청·등록 | API 및 모의투자 이용 신청 | API·모의투자 신청, 서버의 외부 통신 IP 등록 |
| 환경 | `BROKER_ENV=paper` | `BROKER_ENV=paper` |

실전 키와 모의 키를 구분합니다. [KIS 공식 시작 안내](https://github.com/koreainvestment/open-trading-api), [키움 이용안내](https://openapi.kiwoom.com/intro/serviceInfo), [키움 모의투자 안내](https://openapi.kiwoom.com/intro/mockInvestInfo)

이 구현의 주문 대상은 모의투자 계좌이며 실전 호스트·실전 주문 설정은 구현하지 않았습니다. `BROKER_ENV=live`를 지정하면 시작 시 오류를 반환합니다.

키가 없으면 화면에 필요한 환경변수 이름을 표시합니다. 시세·잔고는 미조회 상태로 남고 예시 가격으로 대체하지 않습니다. 서버를 종료한 경우에도 연결 실패를 표시합니다.

## 연결 후 확인 순서

1. 화면 상단에서 선택한 증권사와 모의투자 표시를 확인합니다.
2. 관심종목의 시세와 계좌 보유 수량이 조회되는지 확인합니다. 화면의 시각은 응답 수신 시각이며 거래소 체결 시각으로 표시하지 않습니다.
3. 매수 창에서 종목·가격별 주문 가능 금액을 조회합니다. KIS의 계좌 전체 주문 가능 금액은 `-`로 표시하고 종목별 조회값을 사용합니다.
4. 모의 주문 버튼을 누르면 서버가 요청을 기록한 뒤 증권사로 전송합니다. 접수 응답만으로 체결 처리하지 않습니다.
5. 주문내역을 새로고침해 접수·부분 체결·체결을 확인합니다. 취소 요청은 취소 확인 중으로 표시하고, 조회 응답에서 완료 여부를 확인합니다.

전체 갱신은 60초 간격이며 수동 새로고침도 가능합니다. API 서버는 요청을 직렬화하고 최소 1.1초 간격으로 호출합니다. 과거 시세 차트·시장 지수·뉴스 API는 이번 연결 범위에 포함하지 않았으며, 모의투자 연결 화면에서 해당 데이터를 만들어 표시하지 않습니다. 브리핑에는 조회한 관심종목 시세를 사용합니다.

## 서버와 주문 처리

```text
브라우저 화면 → /api 요청 → 로컬 API 서버 → 증권사 모의투자 API
```

- API 키·토큰은 서버에서만 사용합니다. 브라우저에 서버 세션 식별자만 전달하며, 주문 요청은 세션과 출처를 검사합니다.
- 서버는 `127.0.0.1`에만 열립니다. 이 실행 방식은 개발자 한 명의 로컬 계좌 연결용이며 다중 고객용 로그인·권한 모델은 포함하지 않습니다.
- 주문 요청 UUID를 소문자로 정규화하고 전송 전에 기록합니다. 동일 UUID·동일 입력은 기존 결과를 반환하고, 같은 UUID에 다른 입력을 보내면 거절합니다.
- 통신 단절이나 성공 응답의 필수 필드 누락은 결과 확인 중으로 남깁니다. 자동 재전송하지 않습니다. 증권사 주문번호를 받은 요청은 후속 조회로 체결·취소를 반영합니다.
- 취소는 증권사 주문번호를 기준으로 중복 요청을 합칩니다. 인증·사전조회 실패로 실제 취소 요청을 보내지 않았음을 확인한 경우에만 재시도를 허용합니다.
- 서버·계좌 범위가 바뀌면 화면의 이전 시세·잔고·주문과 열린 주문창을 초기화합니다. 이전 세션의 늦은 응답을 새 계좌 화면에 반영하지 않습니다.

주문 기록은 `.broker-data/`에 저장하며 파일 권한은 `0600`입니다. `.env.local`과 함께 Git에서 제외합니다. KIS 기록은 계좌번호·상품코드의 해시로 분리하고, 키움은 공개 인증에서 제공한 App Key의 해시로 분리합니다. 키움 키를 재발급하면 새 기록 범위가 됩니다. 키 재발급 전에 결과 확인 중인 주문을 별도로 확인해야 합니다.

서버는 기록 파일에 잠금을 사용합니다. 비정상 종료로 `.lock` 파일이 남으면 동일 기록을 사용하는 프로세스가 없는지 확인하고 잠금 파일만 제거합니다. 주문 기록 JSON을 지우면 중복 요청 확인 이력을 잃습니다.

## HTTP 경로

| 경로 | 용도 |
| --- | --- |
| `GET /api/status` | 증권사·설정 누락·세션 확인 |
| `GET /api/quotes?symbols=005930,000660` | 최대 4개 종목의 현재가 |
| `GET /api/account` | 보유 종목·매도 가능 수량 |
| `GET /api/buying-power?symbol=005930&price=70000` | 종목·가격별 매수 가능 금액 |
| `GET /api/orders` | 증권사 KST 당일 주문과 로컬 요청 기록 |
| `POST /api/orders` | 지정가 모의 주문 |
| `POST /api/orders/:id/cancel` | 잔여 수량 모의 취소 |

POST는 JSON 및 `X-Donda-Session` 헤더가 필요합니다. 외부 URL·계좌·토큰을 임의로 지정하는 HTTP 경로는 없습니다. 개발 포트를 바꿀 때는 `.env.local`의 `API_PORT`, `APP_ORIGINS`와 화면 실행의 `UI_PORT`를 맞춥니다.

## 검증과 남은 확인

자동 테스트와 웹 빌드를 통과했습니다. 최신 실행 결과는 [검증 문서](../docs/validation.md)에 있습니다. 테스트는 공식 명세를 바탕으로 만든 응답을 사용했으며 실제 증권사 서버 검증을 대체하지 않습니다.

브라우저에서는 기존 데모 주문, 키 누락 표시, 조회값 표시, 주문 접수, 부분 체결 후 잔량 취소, 서버·계좌 변경 시 화면 초기화, 서버 종료 오류를 확인했습니다. 부분 체결·취소 화면은 로컬 테스트 서버 응답으로 검사했습니다.

실제 모의 키를 설정한 뒤 각 증권사의 인증, 최신 모의 TR 수용, 계좌 필드, 체결·취소 상태를 검증해야 합니다. 키움 명세에는 일부 주문 상태 필드의 전체 코드값 설명이 없어 해석할 수 없는 응답은 결과 확인 중으로 표시합니다. KIS 취소는 접수 조직번호를 우선 보존하고 공식 샘플의 조회 필드를 보조로 사용하므로 실제 응답으로 호환성을 확인해야 합니다.

접수 응답을 잃어 주문번호가 없는 요청은 종목·수량·가격만으로 다른 주문과 자동 결합하지 않습니다. 현재 구현은 해당 결과 확인 중 기록을 남기고 증권사 주문내역을 함께 표시합니다. Android APK에는 이 증권사 서버 연결을 포함하지 않았습니다.

## 구현 근거

- [KIS 현금주문 공식 샘플](https://github.com/koreainvestment/open-trading-api/blob/3a9be59a3ed8745720dc3aa9d584bdf3b7830362/examples_llm/domestic_stock/order_cash/order_cash.py): 모의 매수 `VTTC0012U`, 모의 매도 `VTTC0011U`.
- [KIS 주문조회 공식 샘플](https://github.com/koreainvestment/open-trading-api/blob/3a9be59a3ed8745720dc3aa9d584bdf3b7830362/examples_llm/domestic_stock/inquire_daily_ccld/inquire_daily_ccld.py): 모의 조회 `VTTC0081R`, 당일 조회·연속 조회.
- [KIS 취소 공식 샘플](https://github.com/koreainvestment/open-trading-api/blob/3a9be59a3ed8745720dc3aa9d584bdf3b7830362/examples_llm/domestic_stock/order_rvsecncl/order_rvsecncl.py), [조직번호 매핑 샘플](https://github.com/koreainvestment/open-trading-api/blob/3a9be59a3ed8745720dc3aa9d584bdf3b7830362/legacy/rest/kis_api.py).
- [키움 공식 JSON 명세](https://github.com/Kiwoom-Securities/Kiwoom-REST-API/blob/953e5dbff123f437ab4d11a78a95191a685eb51f/kiwoom/_data/kiwoom_api_spec.json): 시세 `ka10001`, 잔고 `kt00018`, 주문가능현금 `kt00005`, 매수가능금액 `kt00011`, 주문조회 `kt00007`, 매수·매도·취소 `kt10000`·`kt10001`·`kt10003`.

개인 API의 구현 결과와 제3자 대상 서비스 이용 권한은 별도입니다. 기존 [한국투자증권 제휴 안내](https://apiportal.koreainvestment.com/provider)의 적용 범위 검토를 실제 연결 성공으로 대체하지 않습니다.
