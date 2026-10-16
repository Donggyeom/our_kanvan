import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
export function sourceHash() {
  const files = [
    "index.html",
    ".nvmrc",
    "package.json",
    "package-lock.json",
    "functions/package.json",
    "functions/package-lock.json",
    "firebase.json",
    "firestore.rules",
    "firestore.indexes.json",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.tests.json",
    "functions/tsconfig.json",
    "playwright.config.ts",
  ];
  const walk = (path) => {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name);
      if (statSync(file).isDirectory()) walk(file);
      else files.push(file);
    }
  };
  for (const path of ["src", "functions/src", "tests", "scripts"]) walk(path);
  const hash = createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file);
    hash.update(readFileSync(file));
  }
  return hash.digest("hex");
}
