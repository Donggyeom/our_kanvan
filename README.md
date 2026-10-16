# Flowboard — 팀 협업 칸반보드

## Firebase 없이 바로 사용하기

```bash
npm ci
npm run dev:local
```

로그인이나 Firebase 설정 없이 바로 보드가 열립니다. 카드와 변경사항은 현재 브라우저의 localStorage에 저장됩니다. 다른 사용자·기기와의 공유, 실제 팀원 인증·초대·실시간 동기화는 제공하지 않습니다. 브라우저 사이트 데이터를 지우면 저장한 내용도 삭제되므로 주의하세요.

정적 호스팅용 파일은 `npm run build:local`로 생성합니다. `artifacts/local-dist` 폴더를 정적 호스팅에 업로드하면 됩니다. 이 명령은 기존 Firebase 환경 변수가 있어도 Firebase 연결을 끕니다. `npm run preview:local`로 빌드 결과를 실행할 수 있습니다.

React 19 / TypeScript / Vite / Firebase Auth·Firestore·Functions·Hosting 기반의 6~30명 팀용 협업 보드입니다. Coral Orange `#F97316`와 고정 4개 상태(To Do, In Progress, Done, Issue)를 유지합니다.

## 개발 시작

Node.js 22(`.nvmrc`), npm, Java 21(전체 Emulator 검사 시)이 필요합니다.

```bash
npm ci
npm --prefix functions ci
npm run check
npm run build
npm run build:functions
npm run dev:demo
```

데모 모드는 localStorage만 사용하며 초기 관리자 계정으로 열립니다. 로그아웃 후 `demo@flowboard.app`으로 비밀번호 없이 다시 들어갈 수 있습니다. 실제 인증·권한·여러 기기 간 동기화는 Firebase 모드에서만 제공합니다. `dev:demo`는 운영 환경 변수가 있어도 실제 Firebase에 연결하지 않습니다.

## Firebase Emulator로 개발·검증

```bash
npm run test:unit     # 순서 계획·서울 날짜·배포 차단 조건
npm run test:ui       # 실제 Chromium: 데모 UI와 배포 빌드 UI
npm run test:auth     # 실제 Auth/Functions/Hosting Emulator, Firestore 불필요
npm run verify       # TypeScript + 단위 + 전체 Emulator + 2인 브라우저 테스트
```

첫 브라우저 설치는 `npx playwright install chromium`(CI는 `--with-deps`)입니다. `/usr/bin/chromium`이 있으면 이를 사용합니다. Java 21과 최초 Firestore JAR 다운로드(`storage.googleapis.com`)가 필요합니다. 현재 클라우드의 경로·네트워크 관련 주의점과 실제 검사 결과는 [TEST-RESULTS](docs/TEST-RESULTS.md)를 참조하세요.

전체 수동 개발은 별도 터미널에서 다음을 실행합니다.

```bash
npm run build:functions
npx firebase emulators:start --only auth,firestore,functions --project demo-flowboard
npm run dev:emulator
```

`dev:emulator`는 public dummy 웹 설정과 `demo-flowboard` ID를 명시적으로 사용합니다. 모든 테스트는 `demo-*` ID·로컬 Emulator만 허용하며 기존 DB를 초기화/삭제하지 않습니다. 프로세스를 종료하면 메모리의 테스트 데이터는 유지되지 않습니다. 테스트에서 만든 사용자·문서는 고유 이름을 사용합니다.

## 구현한 기능

- 이메일 가입·로그인·재설정·로그아웃, 워크스페이스 생성
- 관리자 초대 링크(7일, 이메일 일치, 해시 저장, 중복 거부, 단일 수락, 취소), 보드 CRUD·복구·참여자 선택
- 업무 CRUD, 담당자·기한·우선순위, 4열/키보드·터치 드래그, 검색·필터·정렬, 여러 보드의 내 업무
- 업무 버전 및 보드 순서 버전 검사, 서버 순서 재계산, 충돌 시 최신 내용 불러오기
- Firestore 구독, 저장·오프라인·재연결 상태, 트랜잭션 변경 이력
- 관리자 전용 완료 업무 보관·소프트 삭제·복구, 삭제 보드의 업무 접근 차단
- 390/768/1280px 레이아웃, 모바일 상태 탭, 접근 가능한 모달과 키보드 조작

보드의 활성 업무 한도는 300개입니다. 보드에서 팀원을 제외하려면 해당 팀원의 활성 업무 담당자를 먼저 변경하세요. 보관/삭제된 업무의 담당자는 과거 기록으로 남을 수 있습니다. 초대 이메일 자동 발송, 댓글, 첨부 파일, 영구 삭제는 MVP 범위에 포함하지 않습니다.

## 실제 Firebase와 배포

웹 앱 설정, 인증 공급자, 결제 요금제, Firestore 위치 및 배포 전 검수는 [DEPLOYMENT](docs/DEPLOYMENT.md)에 정리했습니다. 공개 웹 앱 설정만 `.env.production.local`에 입력하고, 서비스 계정 키나 CLI 토큰을 저장소에 넣지 마세요.

```bash
npm run verify
npm run release:check
```

전체 검증 성공 시 현재 소스 해시를 `artifacts/verification.json`에 기록합니다. Hosting 배포 전 검사는 실제 Firebase 설정과 이 검증 기록이 없거나 소스가 변경되면 실패합니다. CI는 검증만 수행하며 자동 배포하지 않습니다. 운영 배포와 운영 데이터 변경·삭제에는 사용자의 별도 승인이 필요합니다.

현재 실제 프로젝트 배포는 수행하지 않았습니다. 전체 로컬 검증 58개는 통과했으며, 남은 실제 프로젝트 설정과 검증 한계는 [TEST-RESULTS](docs/TEST-RESULTS.md)를 확인하세요.
