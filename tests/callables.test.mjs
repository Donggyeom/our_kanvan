import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
assert.equal(process.env.GCLOUD_PROJECT, "demo-flowboard");
test("Functions Emulator rejects unauthenticated access to all six deployed endpoints", async () => {
  const app = initializeApp(
    { apiKey: "demo-key", projectId: "demo-flowboard" },
    "anonymous-callables",
  );
  const f = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(f, "127.0.0.1", 5001);
  try {
    for (const endpoint of [
      "bootstrap",
      "registerUser",
      "createWorkspace",
      "inviteMember",
      "acceptInvitation",
      "mutate",
    ])
      await assert.rejects(
        httpsCallable(f, endpoint)({}),
        (e) => e.code === "functions/unauthenticated",
      );
  } finally {
    await deleteApp(app);
  }
});
test("Functions Emulator validates authenticated requests before touching Firestore", async () => {
  const app = initializeApp(
    { apiKey: "demo-key", projectId: "demo-flowboard" },
    "validated-callables",
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const f = getFunctions(app, "asia-northeast3");
  connectFunctionsEmulator(f, "127.0.0.1", 5001);
  try {
    await createUserWithEmailAndPassword(
      auth,
      `callables-${Date.now()}@example.com`,
      "Test-password-123",
    );
    for (const [endpoint, data] of [
      ["createWorkspace", { name: "" }],
      ["inviteMember", { email: "invalid" }],
      ["acceptInvitation", { token: "invalid" }],
      ["mutate", { op: "forged" }],
    ])
      await assert.rejects(
        httpsCallable(f, endpoint)(data),
        (e) => e.code === "functions/invalid-argument",
      );
  } finally {
    await deleteApp(app);
  }
});
