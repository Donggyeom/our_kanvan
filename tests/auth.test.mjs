import { test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  confirmPasswordReset,
  onAuthStateChanged,
} from "firebase/auth";
assert.equal(process.env.GCLOUD_PROJECT, "demo-flowboard");
test("Auth Emulator: registration, duplicate account, invalid login, reset, restored session and sign-out", async () => {
  const app = initializeApp(
    { apiKey: "demo-flowboard-key", projectId: "demo-flowboard" },
    "auth-" + Date.now(),
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const email = `auth-only-${Date.now()}@example.com`,
    password = "Flowboard-123";
  try {
    const { user } = await createUserWithEmailAndPassword(
      auth,
      email,
      password,
    );
    assert.equal(user.email, email);
    const uid = user.uid;
    await assert.rejects(
      createUserWithEmailAndPassword(auth, email, password),
      (e) => e.code === "auth/email-already-in-use",
    );
    await signOut(auth);
    assert.equal(auth.currentUser, null);
    await assert.rejects(signInWithEmailAndPassword(auth, email, "bad"), (e) =>
      ["auth/wrong-password", "auth/invalid-credential"].includes(e.code),
    );
    await sendPasswordResetEmail(auth, email);
    const response = await fetch(
      "http://127.0.0.1:9099/emulator/v1/projects/demo-flowboard/oobCodes",
    );
    assert.ok(response.ok);
    const { oobCodes } = await response.json();
    const reset = oobCodes.find(
      (c) => c.email === email && c.requestType === "PASSWORD_RESET",
    );
    assert.ok(reset);
    await confirmPasswordReset(auth, reset.oobCode, "New-flowboard-123");
    await assert.rejects(signInWithEmailAndPassword(auth, email, password));
    await signInWithEmailAndPassword(auth, email, "New-flowboard-123");
    assert.equal(auth.currentUser.uid, uid);
    const observed = await new Promise((resolve) => {
      const stop = onAuthStateChanged(auth, (u) => {
        stop();
        resolve(u?.uid);
      });
    });
    assert.equal(observed, uid);
    await signOut(auth);
    assert.equal(auth.currentUser, null);
  } finally {
    await deleteApp(app);
  }
});
