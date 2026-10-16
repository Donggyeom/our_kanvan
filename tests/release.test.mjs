import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const script = fileURLToPath(
  new URL("../scripts/release-check.mjs", import.meta.url),
);
const cwd = mkdtempSync(join(tmpdir(), "flowboard-release-tests-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("VITE_") &&
      !["GCLOUD_PROJECT", "FIREBASE_PROJECT"].includes(key),
  ),
);
const run = (extra) =>
  spawnSync(process.execPath, [script], {
    cwd,
    env: { ...env, ...extra },
    encoding: "utf8",
  });
// Public fixture strings only, never used for authentication or written to environment settings.
const config = {
  VITE_FIREBASE_API_KEY: "public-fixture",
  VITE_FIREBASE_AUTH_DOMAIN: "fixture.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "fixture",
  VITE_FIREBASE_APP_ID: "public-fixture",
};
test("release gate rejects absent web configuration", () => {
  const r = run({});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /운영 설정이 없습니다/);
});
test("release gate rejects demo/emulator builds", () => {
  for (const extra of [
    { VITE_USE_EMULATORS: "true" },
    { VITE_DEMO_MODE: "true" },
    { VITE_FIREBASE_PROJECT_ID: "demo-flowboard" },
  ]) {
    const r = run({ ...config, ...extra });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Emulator|데모/);
  }
});
test("release gate rejects mismatched CLI and web projects", () => {
  const r = run({ ...config, FIREBASE_PROJECT: "other-project" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /다릅니다/);
});
