import { spawn } from "node:child_process";
const env = {
  ...process.env,
  VITE_DEMO_MODE: "true",
  VITE_SHARED_MODE: "false",
};
const vite = "node_modules/vite/bin/vite.js";
let child = spawn(
  process.execPath,
  [vite, "build", "--outDir", "artifacts/demo-dist"],
  { stdio: "inherit", env },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  if (code !== 0) {
    process.exitCode = code || 1;
    return;
  }
  child = spawn(
    process.execPath,
    [
      vite,
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--outDir",
      "artifacts/demo-dist",
    ],
    { stdio: "inherit", env },
  );
  child.on("exit", (code) => {
    process.exitCode = code || 0;
  });
});
