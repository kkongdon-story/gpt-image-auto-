Cardnews Studio 2.0.0 배포 안내
문서 갱신일: 2026-07-18

1. 일반 사용자에게 전달할 파일

설치형을 권장합니다.

- Lite: Cardnews-Studio-Lite-Setup-2.0.0.exe
- Pro: Cardnews-Studio-Pro-Setup-2.0.0.exe
- 해당 버전의 HTML 사용설명서
- SHA256SUMS.txt

설치 EXE 안에는 앱 실행에 필요한 Electron 런타임, 기본 폰트와 필수 리소스가 포함되어 있습니다.
일반 사용자는 설치 EXE 하나로 설치할 수 있습니다. HTML 설명서와 SHA256SUMS.txt는 사용 안내와 전송 무결성 확인을 위해 함께 전달합니다.

2. Lite와 Pro를 구분해서 전달하세요

- Lite: 콘텐츠·디자인 편집, 이미지·영상 사용, PNG·MP4 내보내기
- Pro: Lite 기능 + AI 도우미, CSV 대량 생성 및 Pro 전용 도구

동일한 사용자에게 두 설치 파일을 동시에 보낼 필요는 없습니다. 사용할 에디션 하나만 전달하세요.

3. 무설치 버전

무설치 버전은 win-unpacked 폴더 전체가 한 프로그램입니다.
폴더 안의 Cardnews Studio Lite.exe 또는 Cardnews Studio Pro.exe만 따로 보내면 실행되지 않습니다.

배포할 때는 다음 중 하나를 사용하세요.

- Portable ZIP 파일 전체를 전달
- win-unpacked 폴더 전체를 전달

받는 사람은 ZIP을 완전히 푼 뒤 폴더 안의 EXE를 실행해야 합니다.

4. 사용자 데이터와 추가 파일

- 기본 프리셋, 기본 폰트와 앱 필수 파일은 배포본에 포함됩니다.
- 사용자가 나중에 추가한 배경 이미지, 영상, 폰트와 작업 기록은 다른 컴퓨터로 자동 이동하지 않습니다.
- 다른 PC로 작업을 옮길 때는 원본 미디어 파일 또는 Pro 프로젝트 내보내기 자료를 별도로 전달해야 합니다.
- AI 기능을 사용하려면 지원되는 외부 CLI가 해당 PC에 별도로 설치되고 로그인되어 있어야 합니다.

5. Windows 경고

현재 배포본은 상용 코드 서명 인증서로 서명되지 않았습니다.
Windows SmartScreen 경고가 표시될 수 있습니다.
출처가 확실한 공식 배포 파일인지 확인하고, 공식 채널에 게시된 SHA-256 값과 비교한 뒤 실행하세요.

SHA256SUMS.txt는 파일 전송 중 손상 여부를 확인하는 자료이며, 배포자 신원 자체를 보증하지는 않습니다.

6. 이번 배포 후보의 검증 범위

- Lite/Pro 소스 빌드와 에디션 분리 검증
- 패키지 보안 검사
- Lite/Pro 무설치 앱 실제 실행과 4:5 PNG 렌더
- Lite/Pro 설치 EXE 자동 설치, 실제 실행, 4:5 PNG 렌더, 제거와 잔여 파일 확인

현재 PC 검증은 통과했습니다.
서로 다른 깨끗한 Windows 가상머신 또는 다른 실제 PC에서의 최종 설치 확인은 별도 단계입니다.
대규모 공개 배포 전에는 배포전-최종체크리스트.txt의 다른 PC 검증을 완료하세요.

문의

- AX 문의·강의 문의: https://open.kakao.com/me/kkongdon
- Threads: @kkongdon_story
