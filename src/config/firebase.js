// src/config/firebase.js
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: "AIzaSyBG283nab1vBZ1uWD9n043K2FXpkiba6wQ",
  authDomain: "mybazaar-c4881.firebaseapp.com",
  projectId: "mybazaar-c4881",
  storageBucket: "mybazaar-c4881.firebasestorage.app",
  messagingSenderId: "1069326034581",
  appId: "1:1069326034581:web:2e01401e103a54cd295d9c",
  measurementId: "G-JWBMQVNGHL"
};
// 初始化 Firebase
const app = initializeApp(firebaseConfig);

// 導出服務實例
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);

// 在本地開發時連接到 Emulator（可選）
if (import.meta.env.DEV) {
  // connectAuthEmulator(auth, 'http://localhost:9099');
  // connectFirestoreEmulator(db, 'localhost', 8080);
  // connectFunctionsEmulator(functions, 'localhost', 5001);
}