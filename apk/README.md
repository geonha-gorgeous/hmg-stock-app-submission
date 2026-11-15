# Release APK

[개인_주식_release.apk](개인_주식_release.apk)는 예시 시세와 모의 주문으로 동작하는 Android 앱입니다. 증권사 서버나 Pleos SDK에는 연결하지 않습니다. debug APK와 별도의 release 구성·서명키를 사용합니다.

```sh
adb -s emulator-5554 install -r apk/개인_주식_release.apk
adb -s emulator-5554 shell am start -n tech.donda.pleos/tech.donda.pleos.MainActivity
```

- 버전: 0.1.0, versionCode 1
- applicationId: `tech.donda.pleos`
- 최소 Android: 9(API 28)
- 빌드·서명일: 2026-11-15
- SHA-256: `743dc7a5aadb806cd69a4cd1a20758a4d6dd9d29cfdd1cbd2f22ba0890e812b9`
- 서명 인증서 SHA-256: `549dc011a83bcc885e7909a5620799151985695775cc61c0fe78251eb00a0a97`
- 검증: APK 서명 검증, API 36 에뮬레이터 설치·기동·화면 표시, DEBUGGABLE 없음

현재 파일명의 ‘개인’은 개인 출품용 구분자입니다. 공식 안내는 `팀명_앱이름_release.apk` 형식이며 개인 참가자의 팀명 대체 규칙은 명시하지 않았습니다. [제출 안내](https://appdevchallenge.auto-hmg.io/guide/submission)

[빌드·서명 방법](../android/README.md), [전체 검증 범위](../docs/validation.md)
