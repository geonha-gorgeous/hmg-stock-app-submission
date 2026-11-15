# Android 프로토타입 호스트

`prototype/`의 React 빌드를 APK 내부에 넣어 실행합니다. 일반 Android의 표준 방향키·선택·Back과 앱에 전달된 회전 MotionEvent를 웹 입력 엔진에 연결합니다. 이 호스트는 Pleos SDK·AAOS RotaryService·실차 CCP 호환성을 검증한 앱이 아닙니다.

## 빌드와 실행

Java 17, Android SDK platform 36, build-tools 36이 필요합니다. Gradle wrapper는 9.3.1, Android Gradle Plugin은 8.12.0입니다.

```sh
cd prototype
npm ci
npm run build
cd ../android
ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew assembleDebug
```

빌드 결과는 `android/app/build/outputs/apk/debug/app-debug.apk`입니다. 빌드마다 `prototype/dist/`를 `app/src/main/assets/web/`에 복사합니다. release 서명은 아래 별도 명령을 사용합니다. App Market 제출 설정은 포함하지 않았습니다.

에뮬레이터 설치·검증은 명시한 에뮬레이터 serial에만 실행합니다.

```sh
adb -s emulator-5554 install -r app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell am start -n tech.donda.pleos.debug/tech.donda.pleos.MainActivity
node scripts/verify-emulator.mjs emulator-5554
# 앱의 예시 주문 상태를 초기화하고 주문·Back 흐름까지 실행합니다.
node scripts/verify-emulator.mjs emulator-5554 --journey
```

검증 스크립트는 실행 중인 debug 앱의 WebView에 연결합니다. `--journey`는 이 앱의 에뮬레이터 예시 주문 상태를 지운 뒤 최초 초점·매수·수량 2주·접수·하위 Back 닫기·최상위 Back 숨기기를 실행합니다. 외부 요청·이동 차단, 예시 데이터 상태, 표준키와 합성 회전 입력 전달 횟수를 확인하고 `build/verification/`에 JSON과 화면 PNG를 저장합니다. 개인 연결 기기에는 자동으로 설치하지 않습니다.

준비 상태 회귀 테스트는 `node --test scripts/devtools-readiness.test.mjs`로 실행합니다.

## release 빌드와 서명

서명된 APK는 [apk/](../apk/README.md)에 있습니다. `assembleRelease`는 미서명 APK를 만들며, 아래 명령으로 정렬 후 별도 release 키로 서명합니다. `SIGNING_KEYSTORE`와 `SIGNING_PASSWORD_FILE`에는 Git 밖의 키 파일과 비밀번호 파일 경로를 지정합니다. 두 파일은 저장소나 제출 ZIP에 포함하지 않습니다.

```sh
./gradlew assembleRelease
BUILD_TOOLS="$ANDROID_HOME/build-tools/36.0.0"
"$BUILD_TOOLS/zipalign" -f -p 4 app/build/outputs/apk/release/app-release-unsigned.apk app/build/outputs/apk/release/app-release-aligned.apk
"$BUILD_TOOLS/apksigner" sign --ks "$SIGNING_KEYSTORE" --ks-key-alias contest-release --ks-pass "file:$SIGNING_PASSWORD_FILE" --v4-signing-enabled false --out ../apk/개인_주식_release.apk app/build/outputs/apk/release/app-release-aligned.apk
"$BUILD_TOOLS/apksigner" verify --verbose --print-certs ../apk/개인_주식_release.apk
```

서명 뒤 APK를 수정하면 서명이 무효가 됩니다. [Android 서명 도구 안내](https://developer.android.com/tools/apksigner)를 따릅니다. 같은 앱을 업데이트할 때는 같은 서명키를 사용합니다.

## 입력 계약

네이티브는 아래 입력의 DOWN·UP을 소비하고 웹에 `CustomEvent('pleos-ccp-input', { detail: { action, source: 'android' } })`를 보냅니다. 같은 입력을 브라우저 기본 키 이벤트로 다시 전달하지 않습니다. 선택·Back은 길게 눌러도 반복 실행하지 않습니다.

| 네이티브 입력 | action |
| --- | --- |
| Tab / Shift+Tab | next / previous |
| D-pad 위·아래·왼쪽·오른쪽 | up / down / left / right |
| D-pad center / Enter / numpad Enter | select |
| Android Back / Escape | back |
| SOURCE_ROTARY_ENCODER의 SCROLL, VSCROLL, HSCROLL | 음수 next, 양수 previous |

회전 입력은 소수 잔여량을 모으며 정수 단계마다 이벤트를 보냅니다. 한 MotionEvent의 변환은 24단계로 제한합니다. 볼륨·통화·음성·미디어·Home 등 표에 없는 키는 Android 기본 처리로 넘깁니다. 텍스트 편집·숫자 조절 동작과 화면별 초점은 웹 입력 엔진이 처리합니다.

웹은 하위 화면·팝업의 back을 처리한 뒤 최상위일 때 `window.PleosNative.hideApp()`을 호출합니다. 네이티브는 `moveTaskToBack(true)`로 앱을 숨기며 `finish()`를 호출하지 않습니다. 앱이 아직 로드되지 않은 상태의 Back도 앱을 숨깁니다. Android 13 이상 시스템 Back은 `OnBackInvokedDispatcher`에 연결했습니다.

## 웹 자산과 API

웹 자산은 앱 내부 파일을 `https://appassets.androidplatform.net/` 출처로 제공합니다. WebView의 파일·콘텐츠 접근과 mixed content를 끄고, 외부 이동·외부 자원 요청을 차단합니다. 외부 페이지에는 JavaScript bridge를 노출하지 않습니다. debug 빌드에서만 WebView 디버깅을 켭니다.

APK는 서버 없이 기존 예시 시세와 앱 내부 모의 주문을 실행합니다. 로컬 `GET /api/status`는 provider=`demo`, environment=`paper`, configured=`false`를 반환하고, 나머지 `/api/`는 `NOT_CONFIGURED`로 응답합니다. 증권사 서버·인증키·계좌 연결·실주문 경로를 APK에 포함하지 않았습니다. 브라우저 개발 서버의 증권사 연결 기능과 APK 실행 범위가 다릅니다.

## 검증 범위

일반 Pixel API 36 에뮬레이터에서 표준 키·합성 회전 입력, 예시 2주 주문, 하위 Back 닫기, 최상위 Back 숨기기와 프로세스 유지를 확인했습니다. 현재 결과와 재현 명령은 [검증 문서](../docs/validation.md)에 있습니다.

Pleos CCP의 실제 키 전달, RotaryService, FocusParkingView·FocusArea·DirectManipulation 연계는 미검증입니다. Pleos SDK·음성 서비스·증권사 서버 연결과 계기판 출력은 이 APK에 포함하지 않았습니다.

## 공식 근거

- [Pleos CCP 개발 가이드](https://document.pleos.ai/en/docs/pleos-only/vehicle-app-developer-guide/ccp-rotary-controller-development): 사용자 설치 앱은 CCP 지원 여부를 선택할 수 있습니다. 최상위 Back에는 ‘the app must be hidden, not terminated’가 적용됩니다. 가이드는 표준 Back 전달을 먼저 확인하도록 요구하며 WebView 내부 초점 제약도 명시합니다.
- [AOSP rotary 앱 개발](https://source.android.com/docs/automotive/hmi/rotary_controller/app_developers): AAOS는 FocusParkingView·FocusArea를 요구하며 일반 앱 초점 이동, 회전 스크롤, DirectManipulation을 구분합니다. 이 호스트의 MotionEvent 변환만으로 RotaryService 통합을 대신했다고 간주할 수 없습니다.
