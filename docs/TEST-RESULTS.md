# 실제 검증 결과 — 2026-10-16 (Asia/Seoul)

검증 위치: `/workspace/our_kanvan`. Node.js 22.23.3, Java 21.0.12.1, Chromium 154.0.8037.57(시스템 브라우저), Firebase CLI 15.34.0.

최종 `npm run verify`는 **총 58개 테스트를 통과**했다. 실패·skip 0개이며, 검증 중 소스가 바뀌지 않았음을 해시로 확인했다. 검증 시각: 2026-10-16 11:37:38 KST. 기록: `artifacts/verification.json`, 실행 로그: `artifacts/final-verification.log`. 운영 배포·운영 데이터 삭제·GitHub push는 수행하지 않았다.

## 요청한 단계별 결과

| 단계                 | 변경 및 실제 검사                                                                                                                                       | 결과                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. 의존성·타입·빌드  | 루트/Functions 잠금 파일과 `npm ci` 재현, 미사용 import·카드 이동 호출 타입 수정                                                                        | 앱+브라우저 테스트 TypeScript 및 루트/Functions 빌드 통과                                                                       |
| 2. PRD 기능 보완     | 보드 설명·참여자 체크박스, 가입 초기화 경합 방지, 초대 중복·취소 경합, 순서 버전, 충돌 재조회, 연결/저장 상태, 한국어 이력 등                           | 브라우저 및 서버 기능 검사 통과                                                                                                 |
| 3. 인증·초대·권한    | 실제 Auth/Functions/Firestore Emulator: 가입/로그인/재설정/로그아웃, 인증 거부, 팀·보드 격리, 직접 쓰기 금지, 초대 이메일·만료·취소·중복·동시 수락·정원 | 통과. 실제 운영 프로젝트의 공급자/권한 설정은 별도 필요                                                                         |
| 4. 카드 동시성       | 업무 버전+보드 순서 버전, 트랜잭션 정렬 계획, 시작 시 버전 고정, 같은 카드 동시 저장 및 다른 카드 동시 이동                                             | 서버 경합·동일/다른/빈 열·오래된 대상 거부·고유 위치 보존 통과. 브라우저의 키보드/터치 이동과 충돌 거부·최신 내용 불러오기 통과 |
| 5. 실시간·이력       | 두 계정의 생성/수정/이동/보관/삭제/복구 구독, 변경 이력 원자성, 브라우저 오프라인·재연결, 권한 회수                                                     | 통과. 로컬 요청+구독 반영 최댓값 약 85ms, 300개 카드 조회 약 80ms                                                               |
| 6. 반응형            | 390/768/1280px, 4열/가로 스크롤/모바일 탭, 레이블·포커스·Escape, 실제 touchStart/Move/End                                                               | 개발 서버 16개 및 실제 배포 빌드 3개 검사 통과. 페이지 가로 넘침 없음                                                           |
| 7. Hosting·배포 준비 | SPA rewrite, JS asset, 보안·캐시 헤더, Node22 Functions, 복합 인덱스, 환경/소스 검증 게이트, CI                                                         | Hosting Emulator 및 잘못된 배포 설정 차단 검사 통과. 실제 프로젝트 설정·CLI 인증·사용자 승인은 필요                             |

## 최종 실행 명령과 테스트 수

- 루트 및 Functions `npm ci`: 성공. 쓰기 가능한 캐시 `/workspace/.npm-cache`를 사용하여 설치 스크립트 전체를 실제 재실행했다.
- `npm run check`: 성공. 앱과 Playwright 테스트의 TypeScript를 모두 확인했다.
- `npm run format:check`: 성공.
- `npm run build`, `npm run build:functions`: 성공. 최종 Vite 빌드는 순환 chunk 경고 없이 생성됐다. 앱 JS 약 51.5KB와 Firebase/vendor chunk로 분리했다(전체 크기가 51.5KB라는 뜻은 아님).
- `npm run verify`: 종료 코드 **0**.
  - `test:unit`: **11/11 통과**. 순서 계획 7개, 서울 날짜 경계 1개, 운영 설정/데모/프로젝트 불일치 배포 차단 3개.
  - Auth/Functions/Firestore/Hosting Emulator: **27/27 통과**. 서버 통합 23개와 Auth 1개, callable 인증·입력 검증 2개, Hosting 1개.
  - 실제 Chromium: **20/20 통과**, 약 40.9초. 데모 16개(모바일·태블릿 실제 터치 이벤트 드래그 포함), 실제 빌드 3개, Firebase 모드 두 브라우저 1개.
- `npm run release:check`: 실제 Firebase 웹 설정이 없어 **의도대로 실패**. 전체 테스트 성공 기록은 현재 존재하며 소스와 일치한다.
- `firebase projects:list --json`: **인증 실패**(`Failed to authenticate`). 재시작 후에도 동일하게 확인했다. ADC 변수 존재만으로 Firebase 접근 권한을 판단하지 않았으며 자격증명 값은 출력하지 않았다.

## Firebase 모드 두 브라우저에서 확인한 흐름

서로 다른 브라우저 컨텍스트(관리자 1280px, 팀원 390px)에서 다음을 실제 수행했다.

1. 관리자 가입, 워크스페이스/보드 생성, 팀원 초대 링크 생성.
2. 초대 링크에서 팀원 가입 및 같은 이메일 계정으로 자동 수락.
3. 관리자 카드 생성 및 팀원 화면의 새로고침 없는 반영.
4. 두 사용자 동시 상세 열기 → 관리자 저장 → 팀원의 오래된 초안 저장은 충돌로 거부.
5. 사용자가 확인한 후 최신 내용 불러오기 → 상태 변경 → 관리자 화면에 반영.
6. 팀원 브라우저 오프라인 → 관리자 수정 → 재연결 후 최신 카드/이력 확인.
7. 담당자를 먼저 변경한 뒤 보드 참여자 제외 → 팀원 화면에서 카드와 새 업무 버튼이 사라짐.

테스트는 고유 이름의 `demo-flowboard` 로컬 데이터만 생성하며 기존 DB를 초기화하거나 운영 데이터를 삭제하지 않는다. Emulator 종료 후 메모리 테스트 데이터의 보존을 전제로 하지 않는다.

## 해결한 초기 문제

- 기본 npm 캐시(`/home/agent/.npm`) 쓰기 실패: `/workspace/.npm-cache` 사용으로 해결.
- 전달본 TypeScript 미사용 import 및 이동 호출 형식: 수정 후 타입/빌드 확인.
- 브라우저 테스트의 폼 선택자가 필터와 상세 양쪽을 가리키는 모호성: 모달 내부로 범위를 제한하고 전체 검증 재실행.
- 초기 Firestore JAR 다운로드 정책 차단: 환경 재시작 후 공식 다운로드 주소의 HTTP 200 응답을 확인하고 CLI의 기본 TLS/체크섬 검증을 유지하여 설치. `firebase setup:emulators:firestore`도 실제 실행했다. JAR은 `/workspace/.cache/firebase`에 준비되어 있으며 새 다운로드용 `storage.googleapis.com` 허용은 설정 초안에 저장되어 있다.

네트워크 상태 API의 관측과 실제 요청 결과는 구분했다. 특정 다운로드의 성공이 모든 Firebase/Google API 접근을 입증하지는 않는다.

## 의존성 보안 검사와 남은 운영 검수

루트 및 Functions의 `npm audit --omit=dev`: 취약점 **각 0개**. Firebase SDK를 갱신하고 grpc-js 및 Functions의 uuid에 보안 수정 버전을 적용했다. 이후 실제 Functions·Firestore 호출과 전체 검증을 수행했다.

개발 도구까지 포함한 루트 audit에는 **10개(높음 3, 보통 7)**가 남아 있다. Firebase CLI의 chokidar/braces, Pub/Sub/OpenTelemetry 및 uuid 의존성에서 발생한다. 호환 범위의 `npm audit fix`는 적용했으며 CLI를 강제 하향하거나 비호환 의존성을 일괄 대체하지 않았다. 웹/Functions의 운영 의존성에는 포함되지 않는다. 개발 도구 취약점은 후속 검토 대상이다.

실제 Firebase 프로젝트의 웹 설정·Auth 이메일 공급자·승인 도메인·요금제·배포 권한·인덱스 Ready 상태는 아직 검증하지 못했다. 운영과 유사한 네트워크의 초기 로딩 3초/실시간 2초 목표, 공개 Hosting URL도 배포 후 별도로 확인해야 한다. 로컬 Emulator 수치를 운영 성능으로 주장하지 않는다. App Check 강제는 별도 조직 요구에 따라 검토한다.

## 주요 변경 파일

- `src/App.tsx`, `BoardEditor.tsx`, `dialog.ts`, `store.ts`, `firebase.ts`, `styles.css`: UI·상태·구독·충돌·접근성.
- `functions/src/index.ts`, `ordering.ts`, `firestore.rules`, `firestore.indexes.json`: 서버 권한·초대·원자성·순서 계획·쿼리 규칙.
- `firebase.json`, `scripts/`, `tests/`, `playwright.config.ts`, `.github/workflows/ci.yml`: 재현 가능한 검사 및 승인 전 배포 준비.
- `package*.json`, `functions/package*.json`, `.nvmrc`, TypeScript 설정: 도구/의존성/타입 검사.
- `docs/DEPLOYMENT.md`, `docs/IMPLEMENTATION.md`, `README.md`, `CODEX_START.md`: 후속 개발과 설정 절차.

스크린샷: `artifacts/board-390.png`, `board-768.png`, `board-1280.png`, `firebase-desktop.png`, `firebase-mobile.png`. 결과 HTML: `playwright-report/index.html`. AGENTS.md와 PRD 원문은 유지했다. 압축 파일에서 깨져 있던 PRD 파일명은 `협업툴 PRD.txt`로 복원했다.
