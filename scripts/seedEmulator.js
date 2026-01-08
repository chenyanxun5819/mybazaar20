const admin = require('firebase-admin');
const crypto = require('crypto');

// 連接到 Firestore Emulator
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8081';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

admin.initializeApp({
  projectId: 'mybazaar-c4881'
});

const db = admin.firestore();

async function seedTestData() {
  console.log('🌱 開始添加測試數據到 Firestore Emulator...');

  const organizationId = 'fVgHtUwjh5s8AVJu5cMqn';
  const eventId = 'zcaMnsF3zTNeqZ738x2V';
  
  // 測試用戶數據
  const testPhoneNumber = '0123456789';
  const testPin = '12345678';
  const salt = crypto.randomBytes(16).toString('hex');
  const pinHash = crypto.createHash('sha256').update(testPin + salt).digest('hex');

  const testUser = {
    basicInfo: {
      phoneNumber: testPhoneNumber,
      chineseName: '測試用戶',
      passwordSalt: salt,
      passwordHash: pinHash,
      pinSalt: salt,
      pinHash: pinHash
    },
    roles: {
      isAdmin: false,
      isManager: false,
      isVolunteer: true
    },
    authUid: `phone_60${testPhoneNumber.replace(/^0/, '')}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  // 添加測試用戶
  const userPath = `organizations/${organizationId}/events/${eventId}/users`;
  await db.collection(userPath).add(testUser);

  console.log('✅ 測試數據添加成功!');
  console.log('\n測試帳號:');
  console.log(`  手機號碼: ${testPhoneNumber}`);
  console.log(`  密碼: ${testPin}`);
  console.log(`  組織 ID: ${organizationId}`);
  console.log(`  活動 ID: ${eventId}`);
  console.log('\n現在可以使用這些憑證登入了!');
  
  process.exit(0);
}

seedTestData().catch(error => {
  console.error('❌ 錯誤:', error);
  process.exit(1);
});
