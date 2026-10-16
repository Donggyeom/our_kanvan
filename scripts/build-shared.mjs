import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
const env = {
  ...process.env,
  VITE_DEMO_MODE: "true",
  VITE_SHARED_MODE: "true",
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
    "artifacts/shared-dist",
  ],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
const path = "artifacts/shared-dist/index.html";
writeFileSync(
  path,
  readFileSync(path, "utf8").replace(
    /<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g,
    "",
  ),
);
mkdirSync("artifacts/shared-server", { recursive: true });
for (const name of ["local-backend", "types"]) {
  const output = ts
    .transpileModule(readFileSync(`src/${name}.ts`, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replaceAll('"./types"', '"./types.mjs"');
  writeFileSync(`artifacts/shared-server/${name}.mjs`, output);
}
