import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const env = {
  ...process.env,
  VITE_DEMO_MODE: "true",
  VITE_USE_EMULATORS: "false",
};
for (const name of [
  "API_KEY",
  "AUTH_DOMAIN",
  "PROJECT_ID",
  "APP_ID",
  "STORAGE_BUCKET",
  "MESSAGING_SENDER_ID",
])
  env[`VITE_FIREBASE_${name}`] = "";
for (const args of [
  ["node_modules/typescript/bin/tsc", "-b"],
  [
    "node_modules/vite/bin/vite.js",
    "build",
    "--outDir",
    "artifacts/local-dist",
    "--base",
    "./",
  ],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
const htmlPath = "artifacts/local-dist/index.html";
writeFileSync(
  htmlPath,
  readFileSync(htmlPath, "utf8").replace(
    /<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g,
    "",
  ),
);
copyFileSync("scripts/local-start.py", "artifacts/local-dist/start.py");
writeFileSync(
  "artifacts/local-dist/사용방법.txt",
  "Flowboard — Firebase 없는 로컬 버전\n\nPython 3 설치 후 압축을 푼 폴더에서 python start.py 를 실행하세요.\nWindows에서는 py start.py 도 사용할 수 있습니다. 브라우저가 자동으로 열립니다.\n로그인이나 Firebase 설정은 필요 없습니다.\n\n현재 브라우저에만 데이터를 저장합니다. 다른 사용자/기기와 공유되지 않습니다.\n브라우저 사이트 데이터를 지우면 저장 내용도 사라집니다.\nindex.html을 더블클릭하지 말고 위 명령으로 실행하세요.\n정적 호스팅에는 이 폴더를 업로드하세요.\n",
);
