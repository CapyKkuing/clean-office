# 클린오피스 (Clean Office)

**광고 없는 문서 뷰어·편집기.** PDF·워드·엑셀·파워포인트·한글(HWP/HWPX) 파일을 열고, 간단히 고쳐서 저장합니다.
안드로이드 앱과 PC(브라우저) 둘 다 쓸 수 있고, 같은 와이파이에서는 PC와 휴대폰이 파일을 주고받을 수 있습니다.

- 광고·추적·로그인 없음
- 문서는 기기 밖(외부 서버)으로 나가지 않음
- 무료, 오픈소스(MIT)

> An ad-free document viewer/editor for Android and desktop browsers (PDF, DOCX, XLSX, PPTX, HWP/HWPX), with Wi-Fi file sharing between PC and phone via QR code.

## 할 수 있는 것

| 형식 | 보기 | 편집 | 저장 |
|---|---|---|---|
| PDF | ✅ 확대/축소 | – | 원본 |
| 워드 DOCX | ✅ 원본 서식 | ✅ 글·표·그림·목록·글자색 | DOCX · PDF · TXT |
| 엑셀 XLSX · XLS · CSV | ✅ | ✅ 값·수식(SUM, AVERAGE, IF 등)·시트 추가 | XLSX · CSV · PDF |
| 파워포인트 PPTX | ✅ | – | 원본 |
| 한글 HWP · HWPX | ✅ | – | 원본 |
| TXT · 이미지 | ✅ | TXT → 문서 편집 | DOCX 등 |

아직 안 되는 것: 옛 DOC/PPT 형식, 파워포인트·한글 편집, 워드 편집 시 복잡한 레이아웃(머리말·다단) 유지.

## 설치·사용

### 안드로이드
1. [Releases](../../releases)에서 `CleanOffice-버전.apk`를 내려받습니다.
2. 설치할 때 "출처를 알 수 없는 앱 설치"를 허용합니다.
3. **파일 열기**를 누르면 폰의 기본 파일 선택창이 뜹니다. 구글 드라이브·원드라이브·드롭박스 등 폰에 설치된 클라우드 앱도 이 창에 나오므로, 거기서 열고 같은 파일에 그대로 저장할 수 있습니다.
4. 카카오톡·파일 앱 등에서 문서를 누르고 "클린오피스로 열기"를 골라도 됩니다.

### PC (윈도우)
1. [Node.js](https://nodejs.org) LTS를 설치합니다.
2. 이 저장소를 내려받아(Code → Download ZIP) 압축을 풉니다.
3. `클린오피스 실행.bat`을 더블클릭합니다. 처음엔 준비에 몇 분 걸리고, 브라우저에 클린오피스가 열립니다(`http://localhost:5192`).
4. 크롬·엣지에서는 연 파일에 바로 덮어써서 저장됩니다.

### PC ↔ 휴대폰 파일 주고받기 (같은 와이파이)
1. PC 화면에서 **폰 연결**을 누르면 QR 코드가 나옵니다.
2. 폰 앱에서 **PC 연결 → QR 코드 찍기**.
3. PC의 `문서\클린오피스` 폴더 파일을 폰에서 열고 저장할 수 있고, 폰 문서를 **PC로 보내기**할 수 있습니다.

- 처음 켤 때 윈도우 방화벽 창이 뜨면 **개인 네트워크** 허용을 눌러 주세요.
- 연결 코드는 비밀번호와 같습니다. 남에게 보여주지 마세요. PC 화면에서 언제든 새 코드로 바꿀 수 있습니다.
- 통신은 집·사무실 와이파이 안에서만 오가는 http입니다. 카페 같은 공용 와이파이에서는 쓰지 마세요.

## 개발

```
npm install
npm run dev            # 개발 서버 (http://localhost:5173)
npm run build          # 웹 빌드 (dist)
npm start              # PC 서버 (dist + 폰 연결)
npm run android        # 빌드 후 안드로이드 프로젝트에 반영
cd android && gradlew assembleRelease   # APK (JDK 21, Android SDK 필요)
```

구조
- `src/` 화면(웹앱). 같은 코드를 PC 브라우저와 안드로이드 앱(Capacitor)이 함께 씀
- `src/files.js` 기기별 열기·저장 (안드로이드 파일 선택창 / 크롬·엣지 파일 핸들 / 다운로드)
- `src/pc-link.js` PC↔폰 연결 화면, `server/server.mjs` PC 쪽 서버
- `android/.../DocFilesPlugin.java` 안드로이드 파일 선택창·같은 파일 저장·"클린오피스로 열기"

PC 서버 보안: 연결 코드가 없으면 거부, 10번 틀리면 1분 잠금, 공유 폴더 밖 접근 차단, QR·코드 정보는 그 PC(localhost)에서만 보임.

## 라이선스

[MIT](LICENSE). 사용한 오픈소스 부품과 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.
한글 문서 표시는 [rhwp](https://github.com/edwardkim/rhwp)를 사용합니다.

## 변경 기록

- **0.1.1** (2026-10-27) 보안 점검 반영: PC 서버가 다른 웹사이트·가짜 주소의 요청에 연결 코드를 내주지 않도록 출처·접속주소 검사 추가. 안드로이드 자동 백업 끔(최근 문서·연결 코드가 클라우드 백업에 안 들어감). 공용 와이파이 사용 금지 안내를 앱 화면에 표시.
- **0.1.0** (2026-10-27) 첫 공개.
