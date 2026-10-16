import { loadEnv } from "vite";
import { sourceHash } from "./source-hash.mjs";
import { existsSync, readFileSync } from "node:fs";
const config = { ...loadEnv("production", process.cwd(), ""), ...process.env };
const required = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
];
const missing = required.filter((k) => !config[k]);
if (missing.length)
  throw Error(
    `Firebase 운영 설정이 없습니다: ${missing.join(", ")}. .env.production.local에 설정하세요.`,
  );
if (
  config.VITE_USE_EMULATORS === "true" ||
  config.VITE_DEMO_MODE === "true" ||
  config.VITE_FIREBASE_PROJECT_ID.startsWith("demo-")
)
  throw Error("운영 배포에 데모 또는 Emulator 설정을 사용할 수 없습니다.");
const projectArg = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT;
if (projectArg && projectArg !== config.VITE_FIREBASE_PROJECT_ID)
  throw Error("배포 대상과 웹 앱 Firebase projectId가 다릅니다.");
for (const file of [
  "firebase.json",
  "firestore.rules",
  "firestore.indexes.json",
  "functions/lib/index.js",
])
  if (!existsSync(file)) throw Error(`먼저 빌드하세요: ${file}`);
const firebase = JSON.parse(readFileSync("firebase.json", "utf8"));
if (
  firebase.hosting.public !== "dist" ||
  !firebase.firestore.rules ||
  !firebase.firestore.indexes
)
  throw Error("Hosting/Firestore 설정을 확인하세요.");
if (!existsSync("artifacts/verification.json"))
  throw Error("npm run verify 전체 검증을 먼저 통과해야 합니다.");
const verification = JSON.parse(
  readFileSync("artifacts/verification.json", "utf8"),
);
if (
  verification.status !== "passed" ||
  verification.sourceHash !== sourceHash()
)
  throw Error(
    "현재 소스의 전체 검증 기록이 없습니다. npm run verify를 다시 실행하세요.",
  );
console.log(
  "운영 설정 구조 검사 통과. 값은 출력하지 않았습니다. 이 검사는 프로젝트 접근 권한·Auth 공급자·요금제·인덱스 배포 상태를 확인하지 않습니다.",
);
