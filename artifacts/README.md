# Android debug APK

[stock-app-debug.apk](stock-app-debug.apk)는 브라우저 UI를 포함한 Android 예시 앱입니다. 일반 Android 9(API 28) 이상을 설치 대상으로 하며, 검증 환경은 Pixel API 36 에뮬레이터입니다. 증권사 계좌 연결 없이 예시 시세·모의 주문과 표준 키·회전 입력을 확인합니다.

## 설치

Android SDK의 `adb devices`로 테스트 에뮬레이터를 확인한 뒤 해당 serial을 사용합니다. 저장소 루트에서 실행합니다.

```sh
adb -s emulator-5554 install -r artifacts/stock-app-debug.apk
adb -s emulator-5554 shell am start -n tech.donda.pleos.debug/tech.donda.pleos.MainActivity
```

서명은 개발용 debug 서명입니다. 별도 release 키로 서명한 APK는 [apk/](../apk/README.md)에 있습니다.

## 파일 정보

- 빌드일: 2026-11-04
- 버전: 0.1.0, versionCode 1
- applicationId: `tech.donda.pleos.debug`
- 크기: 2,378,505 bytes
- SHA-256: `a4866eb65055615ce6b4c3037b77109ac9e30af10c23aed413c719a40154e6cb`
- 빌드: Node.js 24, Java 17, Android SDK 36, Gradle 9.3.1

APK 내부의 `assets/web/THIRD-PARTY-NOTICES.txt`와 `assets/web/licenses/asta-sans-OFL.txt`에 외부 라이브러리·폰트 라이선스를 포함했습니다. [빌드 방법](../android/README.md)과 [검증 범위](../docs/validation.md)를 참고합니다.
