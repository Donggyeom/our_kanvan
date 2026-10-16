# Firebase 배포 준비 및 승인 절차

운영 배포는 아직 실행하지 않았습니다. 운영 데이터 삭제 기능이나 자동 배포 작업은 추가하지 않았습니다. 다음 설정 및 전체 통합 검증을 완료한 뒤, 배포할 프로젝트와 영향 범위를 사용자에게 제시하여 승인을 받아야 합니다.

## 1. 프로젝트 설정 (Firebase Console)

1. 테스트용과 운영용 프로젝트를 구분하고 프로젝트 ID를 확인합니다. 실제 데이터가 있는 프로젝트는 기존 설정/규칙/컬렉션을 먼저 검토합니다.
2. 웹 앱을 등록하여 Firebase 웹 구성 값을 받습니다. 서비스 계정 개인키는 프런트엔드에 사용하지 않습니다.
3. Authentication → 이메일/비밀번호 공급자를 활성화하고, Hosting의 `PROJECT_ID.web.app` 및 커스텀 도메인을 승인된 도메인으로 등록합니다. 비밀번호 재설정 템플릿/발신자도 확인합니다.
4. Cloud Firestore를 Native mode로 생성합니다. 가능한 경우 서울 `asia-northeast3`를 선택합니다. **이미 생성한 DB의 위치는 변경하지 않습니다.** 기존 DB가 다른 위치면 지연/비용을 검토합니다.
5. Cloud Functions 2세대 / Node.js 22 / `asia-northeast3`를 사용합니다. Blaze 요금제 및 Cloud Build·Artifact Registry·Cloud Run 관련 API/권한이 필요할 수 있습니다. 비용 알림과 할당량을 설정합니다. 코드의 `maxInstances: 10`은 비용 상한 보장을 의미하지 않습니다.
6. 담당 배포 계정으로 `npx firebase login --no-localhost` 또는 조직에서 승인한 인증 방식을 사용합니다. 자격증명·서비스 계정 JSON·CLI 인증 토큰을 채팅이나 Git에 붙여 넣지 않습니다. 이 환경에서 `firebase projects:list --json`은 인증 실패를 반환했습니다. 기존 ADC 변수의 존재만으로 Firebase 권한이 있다는 뜻은 아닙니다.

## 2. 웹 앱 구성

`.env.example`의 항목을 참고하여 Git에서 제외되는 `.env.production.local`을 작성합니다.

```dotenv
VITE_FIREBASE_API_KEY=<Firebase 웹 앱 apiKey>
VITE_FIREBASE_AUTH_DOMAIN=<프로젝트의 authDomain>
VITE_FIREBASE_PROJECT_ID=<실제 프로젝트 ID>
VITE_FIREBASE_APP_ID=<Firebase 웹 앱 appId>
VITE_USE_EMULATORS=false
VITE_DEMO_MODE=false
```

Storage bucket와 messaging sender ID는 이 MVP에서 필수 항목이 아닙니다. Firebase 웹 구성은 클라이언트에 포함되는 공개 식별 정보이며 권한은 Rules와 Functions에서 검증합니다. Google Cloud 서비스 계정 키는 `VITE_` 변수에 절대 넣지 않습니다. 설정 변경 후 다시 빌드해야 합니다.

## 3. 승인 전에 수행할 검수

```bash
npm ci
npm --prefix functions ci
npm run verify
FIREBASE_PROJECT=YOUR_PROJECT_ID npm run release:check
npx firebase projects:list
```

`YOUR_PROJECT_ID`는 실제 대상 ID로 바꿉니다. `verify`는 `demo-flowboard` Emulator만 이용합니다. 운영 설정이 있어도 UI 테스트는 데모/Emulator 설정을 명시하므로 운영 DB에 연결하지 않습니다. 전체 성공 기록은 소스 해시로 검사하며, 소스가 바뀌면 검증을 다시 실행해야 합니다.

필수 검수:

- 비로그인·다른 팀·보드 비참여자 접근 거부, 모든 클라이언트 직접 쓰기 거부
- 관리자/일반 팀원 권한, 이메일/만료/취소/중복/동시 수락 초대
- 같은 카드 동시 수정, 같은/다른 열 동시 드래그, 빈 열, 실패 후 최신 데이터
- 업무 변경 및 이력의 원자성, 생성·수정·이동·보관·삭제·복구 구독
- 300개 업무, 390/768/1280px, 실제 빌드 파일의 브라우저 실행

현재 클라우드에서는 Firestore Emulator 다운로드와 전체 검증 58개를 완료했습니다. `artifacts/verification.json`에 현재 소스의 성공 기록이 있습니다. `storage.googleapis.com` 허용은 환경 설정 초안에 저장했으며, JAR은 `/workspace/.cache/firebase`에 준비되어 있습니다. 소스 변경이나 다른 머신에서는 `npm run verify`를 다시 실행하고 `release:check`를 우회하지 않습니다. 실제 Firebase 웹 설정과 CLI 인증은 아직 필요합니다.

## 4. 배포 영향 검토 및 사용자 승인

배포 예정 내용: Hosting의 기존 정적 파일 교체, `firestore.rules` 읽기/쓰기 정책 및 `firestore.indexes.json` 적용, callable Functions 6개 생성/갱신. 데이터 삭제·마이그레이션·영구 삭제는 포함하지 않습니다. 기존 Functions/인덱스/규칙이 있다면 CLI의 삭제/교체 제안을 먼저 검토하고 중단하며, 별도 승인 없이 수락하지 않습니다.

특히 기존 앱이 Firestore 직접 쓰기를 사용하고 있다면 새 규칙 적용은 기존 클라이언트를 차단할 수 있습니다. 기존 운영 프로젝트에 대한 검토와 전환 계획 없이 규칙을 교체하지 않습니다.

사용자가 프로젝트 ID와 위 영향 범위를 명시적으로 승인한 후에만 다음 배포를 실행합니다.

```bash
FIREBASE_PROJECT=YOUR_PROJECT_ID npx firebase deploy --project YOUR_PROJECT_ID --only firestore,functions,hosting
```

Predeploy는 Functions 빌드, 운영 구성 및 전체 검증 기록 확인, Hosting 빌드를 실행합니다. 새 복합 인덱스가 Ready 상태가 되기까지 기다려야 합니다. Hosting만 배포하면 서버/규칙이 준비되지 않을 수 있습니다.

## 5. 배포 후 검증

실제 CLI가 반환한 Hosting URL을 기준으로 로그인, 비밀번호 재설정, 두 개의 별도 계정 초대/참여/실시간 카드 변경, 비참여 보드 차단, 보관/복구를 확인합니다. 300개 업무의 초기 로딩 3초 / 실시간 2초 목표는 운영과 유사한 네트워크에서 별도로 측정합니다. 로컬 Emulator 수치를 운영 성능으로 주장하지 않습니다.

서비스 계정 최소 권한, API 키 웹 도메인 제한, 예산 알림, Auth 메일 도메인을 점검합니다. 조직에서 App Check를 요구하면 웹 공급자 등록 및 callable의 `enforceAppCheck` 설정을 별도 검증합니다. 현재 App Check 강제는 설정하지 않았습니다.

되돌리기는 승인받은 Hosting 릴리스 및 이전 서버/규칙 버전을 사용하며 DB 삭제로 처리하지 않습니다. 배포 승인과 데이터 삭제 승인은 서로 별개입니다.
