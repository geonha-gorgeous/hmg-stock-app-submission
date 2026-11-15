# 구조와 API 대응

## 실행 구성

```text
브라우저 React UI → 로컬 HTTP 서버 → 한국투자증권 또는 키움 모의투자 API
Android WebView → APK에 포함한 React UI와 예시 데이터
```

`prototype/src/`는 화면·초점·모의 주문 상태를 관리합니다. `server/`는 증권사 인증·조회·주문과 요청 기록을 담당하고 `shared/`는 브라우저와 서버의 데이터 형식을 정의합니다. `android/`는 웹 빌드를 포함하는 Android 호스트입니다.

기본 `demo` 모드는 브라우저 메모리에 주문을 저장합니다. 증권사 모드는 서버의 `.broker-data/`에 요청을 기록하며 API 키와 토큰은 서버에서만 사용합니다. 동일 주문 요청의 중복 전송과 계좌 변경 후 이전 응답 표시를 방지합니다. [설정과 주문 처리](../prototype/BROKER-INTEGRATION.md)

## 차량·입력 API

| 기능 | 연결 대상 | 현재 구현 |
| --- | --- | --- |
| 기어·속도 | AAOS `CarPropertyManager`, `GEAR_SELECTION`, `PERF_VEHICLE_SPEED` | 독립된 시뮬레이션 값. 속도는 m/s로 저장하고 km/h로 표시합니다. |
| UX 제한 | `CarUxRestrictionsManager` | 제한값 시뮬레이션, 수량 타이핑 제한과 간소화 보기입니다. |
| 음성 입력 | Pleos `SpeechToText` | ‘빠른 실행’ 버튼으로 시세·브리핑을 열거나 주문 입력을 채웁니다. 마이크·STT를 호출하지 않습니다. |
| 음성 읽기 | Pleos `TextToSpeech` | 브라우저 Web Speech API입니다. APK의 음성 출력은 검증하지 않았습니다. |
| 물리 버튼 | Android KeyEvent·MotionEvent, Pleos CCP | 표준 방향키·선택·Back과 앱에 전달된 회전 이벤트를 변환합니다. 실제 CCP·RotaryService 연결은 미검증입니다. |
| 주문 | KIS·키움 REST API | 모의투자 연결 코드와 테스트 응답 검증입니다. 실제 키 호출은 미검증입니다. |

기어·속도는 AAOS 표준 속성입니다. STT·TTS 연결에는 각 Pleos 서비스의 초기화 결과와 권한을 확인해야 합니다. 현재 Android 앱에는 Pleos SDK를 포함하지 않았습니다.

계기판 동시 표시는 구현하지 않았습니다. 조사한 공개 문서에서는 일반 주식앱의 계기판 위젯 등록 API·권한을 확인하지 못했습니다. Android의 공개 cluster 지원은 내비게이션 지도용입니다.

## 화면 구성

관심종목·브리핑·주문내역 메뉴는 가로 화면의 왼쪽에, 좁은 화면의 하단에 표시합니다. 주요 조작은 큰 버튼으로 배치하고 초점과 선택 상태를 구분합니다. 물리 입력을 사용할 때 주문창에 수량 편집과 종료 방법을 표시합니다.

Asta Sans 폰트를 사용하며 주간·야간·분할 화면을 지원합니다. Pleos와 Tesla 공식 화면을 참고했지만 CSS px 값을 차량 dp 규격이나 실차 가독성 검증 결과로 취급하지 않습니다.

## 참고 문서

- [Pleos CCP 개발 가이드](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/ccp-rotary-controller-development)
- [AOSP rotary 앱 개발](https://source.android.com/docs/automotive/hmi/rotary_controller/app_developers)
- [AAOS 차량 속성](https://developer.android.com/reference/android/car/VehiclePropertyIds), [UX 제한](https://developer.android.com/reference/android/car/drivingstate/CarUxRestrictionsManager)
- [Pleos STT](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/SpeechToText/intro), [Pleos TTS](https://document.pleos.ai/en/docs/pleos-only/connect-sdk-pleos/TextToSpeech/intro)
- [Pleos 화면 구성](https://document.pleos.ai/docs/connect/guide/docs-design/getting-started/layout), [타이포그래피](https://document.pleos.ai/en/docs/connect/guide/docs-design/foundations/typography)
- [Tesla 터치스크린 안내](https://www.tesla.com/ownersmanual/model3/en_us/GUID-518C51C1-E9AC-4A68-AE12-07F4FF8C881E.html)
- [Pleos Widgets](https://document.pleos.ai/en/docs/connect/guide/docs-design/components/widgets), [Android cluster 지원](https://developer.android.com/training/cars/apps/navigation#drawing_to_the_cluster_display)
