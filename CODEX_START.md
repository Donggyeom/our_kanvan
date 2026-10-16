# Flowboard 작업 시작

1. AGENTS.md, 협업툴 PRD.txt, README.md, docs/IMPLEMENTATION.md, docs/TEST-RESULTS.md를 읽습니다.
2. 이 클라우드 작업은 이미 격리되어 있습니다. `/workspace/our_kanvan`의 기존 체크아웃을 사용하고 사용자가 요청하지 않으면 Git worktree를 만들지 않습니다.
3. Node.js 22와 Java 21을 사용합니다. 클라우드에서는 필요 시 `export PATH=/workspace/.tools/node_modules/node/bin:$PATH`, `export XDG_CONFIG_HOME=/workspace/.config`, `export FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase`를 적용합니다. npm 캐시는 `/workspace/.npm-cache`를 사용할 수 있습니다.
4. 루트/Functions `npm ci`와 빌드 후 `npm run dev:demo`를 실행합니다. 실제 Firebase 검사/개발은 README의 Emulator 절차를 따릅니다.
5. 운영 Firebase 및 운영 데이터에 쓰거나 삭제하지 않습니다. 테스트는 demo-flowboard Emulator만 사용합니다. `.env`나 자격증명을 출력/커밋하지 않습니다.
6. 전체 `npm run verify`는 현재 소스에서 58개 검사를 통과했습니다. Firestore JAR은 `/workspace/.cache/firebase`에 준비되어 있고 새 다운로드에는 `storage.googleapis.com` 접근이 필요합니다. 코드 변경 후 전체 서버/2인 브라우저 검증을 다시 실행하고 검증 기록을 수동으로 성공 처리하지 않습니다.
7. 운영 배포는 docs/DEPLOYMENT.md의 설정·검증·영향 검토와 별도 사용자 승인 후에만 진행합니다.
