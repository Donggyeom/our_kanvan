import { spawn } from "node:child_process";
const mode = process.argv[2];
if (!["demo", "emulator"].includes(mode))
  throw Error("Expected demo or emulator");
const env = {
  ...process.env,
  VITE_DEMO_MODE: mode === "demo" ? "true" : "false",
  VITE_SHARED_MODE: "false",
};
if (mode === "emulator")
  Object.assign(env, {
    VITE_FIREBASE_API_KEY: "demo-flowboard-key",
    VITE_FIREBASE_AUTH_DOMAIN: "demo-flowboard.firebaseapp.com",
    VITE_FIREBASE_PROJECT_ID: "demo-flowboard",
    VITE_FIREBASE_APP_ID: "1:123:web:demo",
    VITE_USE_EMULATORS: "true",
    VITE_EMULATOR_HOST: "127.0.0.1",
  });
const child = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "0.0.0.0",
    ...(mode === "emulator" ? ["--mode", "emulator", "--port", "5174"] : []),
    ...process.argv.slice(3),
  ],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
