// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// 範例：檢查是否有 Super Admin
exports.checkAdminExists = functions.https.onCall(async (data, context) => {
  const db = admin.firestore();
  const snapshot = await db.collection('users')
    .where('role', '==', 'super_admin')
    .limit(1)
    .get();
  
  return { exists: !snapshot.empty };
});