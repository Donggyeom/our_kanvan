import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};
export const firebaseEnabled = Boolean(
  import.meta.env.VITE_DEMO_MODE !== "true" &&
  config.apiKey &&
  config.projectId &&
  config.appId,
);
const fresh = getApps().length === 0;
const app = firebaseEnabled ? getApps()[0] || initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, "asia-northeast3") : null;
if (app && fresh && import.meta.env.VITE_USE_EMULATORS === "true") {
  if (!config.projectId.startsWith("demo-"))
    throw Error("Emulator는 demo-* 프로젝트만 허용합니다.");
  const host = import.meta.env.VITE_EMULATOR_HOST || "127.0.0.1";
  connectAuthEmulator(auth!, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db!, host, 8080);
  connectFunctionsEmulator(functions!, host, 5001);
}
