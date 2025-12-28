// src/config/firebase.js
import { initializeApp } from 'firebase/app';
import { initializeAuth, browserLocalPersistence, indexedDBLocalPersistence } from 'firebase/auth';
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

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FUNCTIONS_REGION = 'asia-southeast1';

// 版本戳記（用於驗證部署是否最新）
// 注意：這是執行時生成的時間，如果需要真正「建置時間」可改為在 build 腳本寫入環境變數再嵌入。
export const BUILD_TIMESTAMP = '2025-11-30T' + new Date().toLocaleTimeString('en-GB', { hour12: false });

// 初始化 Firebase
console.log('🔥 [Firebase] 初始化 Firebase...');
console.log('🧾 [Build] Version Timestamp:', BUILD_TIMESTAMP);

// 禁用 Google API 预加载（避免超时延迟）
if (window.gapi && window.gapi.load) {
  // 仅在需要时加载
  window.gapi.__disableAutoload = true;
}

const app = initializeApp(firebaseConfig);

// 初始化服务（顯式禁用 Popup/Redirect 解析器，避免 gapi 載入）
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  // 不啟用 popup/redirect 流程，避免載入 apis.google.com 的 gapi 腳本
  popupRedirectResolver: undefined
});
export const db = getFirestore(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

// 禁用 Firebase Auth 的 Google 库预加载（解决 apis.google.com 超时）
if (auth) {
  // 延迟初始化 persistence 以避免阻塞
  auth.setPersistence = auth.setPersistence || (() => Promise.resolve());
}

// 🔧 立即挂载到 window（确保生产构建后也能工作）
(function() {
  window.auth = auth;
  window.db = db;
  window.functions = functions;
  console.log('✅ [Firebase] window.auth 已挂载，可在 Console 获取 Token');
})();

console.log('☁️ [Firebase] 使用 Firebase 生產環境');
console.log('📍 [Firebase] Project ID:', firebaseConfig.projectId);
console.log('🌎 [Firebase] Functions Region:', FUNCTIONS_REGION);
console.log('✅ [Firebase] 初始化完成');

export default app;