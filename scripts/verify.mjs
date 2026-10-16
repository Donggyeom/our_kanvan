import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { sourceHash } from "./source-hash.mjs";
mkdirSync("artifacts", { recursive: true });
const path = "artifacts/verification.json";
const startedHash = sourceHash();
writeFileSync(
  path,
  JSON.stringify({ status: "running", sourceHash: startedHash }),
);
for (const script of ["check", "test:unit", "test:emulators"]) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", script],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) {
    writeFileSync(
      path,
      JSON.stringify({
        status: "failed",
        step: script,
        sourceHash: startedHash,
      }),
    );
    process.exit(result.status || 1);
  }
}
if (sourceHash() !== startedHash) {
  writeFileSync(
    path,
    JSON.stringify({ status: "failed", step: "source-changed-during-tests" }),
  );
  throw Error("검증 도중 소스가 바뀌었습니다. 다시 검증하세요.");
}
writeFileSync(
  path,
  JSON.stringify(
    {
      status: "passed",
      verifiedAt: new Date().toISOString(),
      sourceHash: startedHash,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "검증 완료: 소스 해시와 검증 기록을 artifacts/verification.json에 저장했습니다. 배포는 실행하지 않았습니다.",
);
