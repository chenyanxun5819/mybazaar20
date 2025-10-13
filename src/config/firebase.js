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
console.log('🔥 [Firebase] 初始化 Firebase...');
const app = initializeApp(firebaseConfig);

// 初始化服务
export const auth = getAuth(app);
export const db = getFirestore(app);

// 🔥 直接使用 Production Cloud Functions，指定 us-central1 region
export const functions = getFunctions(app, 'us-central1');

console.log('☁️ [Firebase] 使用 Firebase 生產環境');
console.log('📍 [Firebase] Project ID:', firebaseConfig.projectId);
console.log('🌎 [Firebase] Functions Region: us-central1');
console.log('✅ [Firebase] 初始化完成');

export default app;