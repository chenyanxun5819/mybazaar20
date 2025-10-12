// scripts/initTestUsers.js
/**
 * 初始化測試用戶腳本（使用 Firebase CLI 認證）
 * 
 * 使用方法：
 * 1. 確保已登入 Firebase CLI: firebase login
 * 2. 修改 CONFIG 中的 organizationId 和 eventId
 * 3. 運行: node scripts/initTestUsers.js
 */

import admin from 'firebase-admin';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 讀取 Application Default Credentials
const credentialsPath = join(process.env.APPDATA || process.env.HOME, '.config', 'gcloud', 'application_default_credentials.json');
let credential;

try {
  credential = admin.credential.applicationDefault();
} catch (error) {
  console.error('❌ 無法取得認證，請先執行: gcloud auth application-default login');
  process.exit(1);
}

admin.initializeApp({
  credential: credential,
  projectId: 'mybazaar-c4881'
});

const db = admin.firestore();
const auth = admin.auth();

// 生成密碼 Hash
function generatePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
  return { hash, salt };
}

// 測試用戶數據
const testUsers = [
  {
    phoneNumber: '0123456789',
    password: 'Test1234',
    englishName: 'Alice Customer',
    chineseName: '顧客小愛',
    email: 'alice@test.com',
    roles: ['customer'],
    identityTag: 'student'
  },
  {
    phoneNumber: '0123456788',
    password: 'Test1234',
    englishName: 'Bob Seller',
    chineseName: '銷售員小博',
    email: 'bob@test.com',
    roles: ['seller', 'customer'],
    identityTag: 'staff'
  },
  {
    phoneNumber: '0123456787',
    password: 'Test1234',
    englishName: 'Charlie Merchant',
    chineseName: '商家小查',
    email: 'charlie@test.com',
    roles: ['merchant'],
    identityTag: 'teacher'
  },
  {
    phoneNumber: '0123456786',
    password: 'Test1234',
    englishName: 'Diana Manager',
    chineseName: '管理員小黛',
    email: 'diana@test.com',
    roles: ['manager'],
    identityTag: 'staff'
  }
];

// ⚠️ 配置：你的組織和活動 ID
const CONFIG = {
  organizationId: 'fVqHtUWjh58HVJu5cMAn',  // 從 Firebase Console 複製
  eventId: 'zcaWnsF3zTNeqZ738x2V'        // 從 Firebase Console 複製
};

async function createTestUser(userData, orgId, eventId) {
  const { phoneNumber, password, englishName, chineseName, email, roles, identityTag } = userData;
  
  // 生成 authUid（馬來西亞國碼 60）
  const authUid = `phone_60${phoneNumber.replace(/^0/, '')}`;
  
  // 生成密碼 hash
  const { hash: passwordHash, salt: passwordSalt } = generatePasswordHash(password);
  
  try {
    console.log(`\n創建用戶: ${englishName} (${phoneNumber})`);
    
    // 創建 Firestore 用戶文檔（跳過 Firebase Auth）
    const userDocPath = `organizations/${orgId}/events/${eventId}/users/${authUid}`;
    const userDoc = {
      authUid,
      roles,
      identityTag,
      basicInfo: {
        phoneNumber,
        englishName,
        chineseName: chineseName || '',
        email: email || '',
        passwordHash,
        passwordSalt,
        isPhoneVerified: true
      },
      roleSpecificData: {},
      accountStatus: {
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    };
    
    // 根據角色初始化 roleSpecificData
    if (roles.includes('customer')) {
      userDoc.roleSpecificData.customer = {
        currentBalance: 1000,
        totalPointsPurchased: 1000,
        totalPointsConsumed: 0
      };
    }
    
    if (roles.includes('seller')) {
      userDoc.roleSpecificData.seller = {
        totalPointsSold: 0,
        currentSalesAmount: 0
      };
      if (!userDoc.roleSpecificData.customer) {
        userDoc.roleSpecificData.customer = {
          currentBalance: 5000,
          totalPointsPurchased: 5000,
          totalPointsConsumed: 0
        };
      }
    }
    
    if (roles.includes('merchant')) {
      userDoc.roleSpecificData.merchant = {
        totalReceivedPoints: 0,
        monthlyReceivedPoints: 0
      };
    }
    
    if (roles.includes('manager')) {
      userDoc.roleSpecificData.manager = {
        managerId: `M${Date.now()}`,
        assignedCapital: 100000,
        allocatedToSellers: 0,
        availableCapital: 100000
      };
    }
    
    await db.doc(userDocPath).set(userDoc);
    console.log(`  ✅ 創建 Firestore 文檔`);
    console.log(`  📱 手機號: ${phoneNumber}`);
    console.log(`  🔑 密碼: ${password}`);
    console.log(`  👤 角色: ${roles.join(', ')}`);
    
  } catch (error) {
    console.error(`  ❌ 創建失敗:`, error.message);
  }
}

async function main() {
  console.log('🚀 開始初始化測試用戶...\n');
  console.log('📍 配置信息:');
  console.log(`   專案 ID: mybazaar-c4881`);
  console.log(`   組織 ID: ${CONFIG.organizationId}`);
  console.log(`   活動 ID: ${CONFIG.eventId}`);
  
  // 驗證配置
  if (CONFIG.organizationId === 'YOUR_ORG_ID' || CONFIG.eventId === 'YOUR_EVENT_ID') {
    console.error('\n❌ 錯誤: 請先配置 organizationId 和 eventId');
    console.log('\n如何獲取:');
    console.log('1. 打開 Firebase Console → Firestore Database');
    console.log('2. 找到你的組織文檔，複製文檔 ID');
    console.log('3. 展開組織 → events 子集合 → 複製活動文檔 ID');
    console.log('4. 修改腳本的 CONFIG 對象\n');
    process.exit(1);
  }
  
  console.log('\n⚠️  這將在真實 Firebase 中創建數據！');
  console.log('按 Ctrl+C 取消，或等待 3 秒繼續...\n');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 創建所有測試用戶
  for (const userData of testUsers) {
    await createTestUser(userData, CONFIG.organizationId, CONFIG.eventId);
  }
  
  console.log('\n✅ 完成！');
  console.log('\n📋 測試帳號:');
  console.log('┌─────────────┬──────────────┬──────────────────┐');
  console.log('│ 手機號      │ 密碼         │ 角色             │');
  console.log('├─────────────┼──────────────┼──────────────────┤');
  testUsers.forEach(u => {
    console.log(`│ ${u.phoneNumber} │ ${u.password.padEnd(12)} │ ${u.roles.join(', ').padEnd(16)} │`);
  });
  console.log('└─────────────┴──────────────┴──────────────────┘\n');
  
  process.exit(0);
}

main().catch(console.error);