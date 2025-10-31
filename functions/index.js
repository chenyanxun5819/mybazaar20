const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors');
const loginUniversalHttp = require('./auth/loginUniversalHttp');
// 确保只初始化一次
if (!admin.apps.length) {
  admin.initializeApp();
}

const { checkAdminExists, createInitialAdmin, sendOtpToPhone, verifyOtpCode, setProjectInfo, getTotalCapital, getAssignedCapitalSum, createManager,
  createEventManager, createEventManagerHttp, loginEventManager , createUserByEventManagerHttp} = require('./admin');
const { loginUniversalHttp } = require('./auth/loginUniversalHttp');
exports.checkAdminExists = checkAdminExists;
exports.createInitialAdmin = createInitialAdmin;
exports.sendOtpToPhone = sendOtpToPhone;
exports.verifyOtpCode = verifyOtpCode;
exports.setProjectInfo = setProjectInfo;
exports.getTotalCapital = getTotalCapital;
exports.getAssignedCapitalSum = getAssignedCapitalSum;
exports.createManager = createManager;
exports.createEventManager = createEventManager; 
exports.createEventManagerHttp = createEventManagerHttp; 
exports.loginEventManager = loginEventManager; 
exports.createUserByEventManagerHttp = createUserByEventManagerHttp;
exports.loginUniversalHttp = loginUniversalHttp;
exports.loginUniversalHttp = loginUniversalHttp.loginUniversalHttp;

// CORS 中间件配置
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://mybazaar-c4881.web.app',
  'https://mybazaar-c4881.firebaseapp.com'
];
const corsHandler = cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// 簡單健康檢查（透過 Hosting 代理用於驗證 rewrites / IAM / CORS）
exports.pingHttp = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: { code: 'method-not-allowed' } });
    }

    return res.status(200).json({ ok: true, now: new Date().toISOString() });
  });
});

// 标准化手机号码格式
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  
  let cleaned = phoneNumber.replace(/[\s\-\(\)]/g, '');
  
  if (cleaned.startsWith('+60')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('60')) {
    cleaned = cleaned.substring(2);
  }
  
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  return cleaned;
}

// 获取重定向 URL
function getRedirectUrl(roles) {
  console.log(`[getRedirectUrl] Checking roles:`, JSON.stringify(roles));
  if (!roles || !Array.isArray(roles)) return "../home/index.html";
  
  if (roles.includes("super_admin") || roles.includes("super admin")) 
    return "../admin/admin-dashboard.html";
  if (roles.includes("manager")) 
    return "../manager/admin-manage-users.html";
  if (roles.includes("merchant")) 
    return "../merchant/merchant-dashboard.html";
  if (roles.includes("seller")) 
    return "../seller/seller-dashboard.html";
  if (roles.includes("customer")) 
    return "../customer/consume.html";
  
  console.log(`[getRedirectUrl] No role matched, returning default`);
  return "../home/index.html";
}

// 登录函数 - 使用 corsHandler
exports.loginWithPin = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    
    console.log(`[${requestId}] ===== LOGIN REQUEST START =====`);
    console.log(`[${requestId}] Method: ${req.method}`);
    
    try {
      if (req.method !== 'POST') {
        console.log(`[${requestId}] ❌ Invalid method: ${req.method}`);
        return res.status(405).json({ 
          error: { code: 'method-not-allowed', message: '只支持 POST 请求' }
        });
      }

      const { phoneNumber, pin, organizationId, eventId } = req.body;
    
      console.log(`[${requestId}] 📥 Received data:`, { 
        phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 3)}***` : 'missing',
        hasPin: !!pin,
        pinLength: pin ? pin.length : 0,
        organizationId,
        eventId
      });
    
      if (!phoneNumber || !pin) {
        console.log(`[${requestId}] ❌ Missing phone or pin`);
        return res.status(400).json({ 
          error: { code: 'invalid-argument', message: '请提供手机号码与密码' }
        });
      }
      
      if (!organizationId || !eventId) {
        console.log(`[${requestId}] ❌ Missing organizationId or eventId`);
        return res.status(400).json({ 
          error: { code: 'invalid-argument', message: '请提供组织与活动信息' }
        });
      }
    
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log(`[${requestId}] 📱 Normalized phone: ${normalizedPhone}`);
    
      const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;
      console.log(`[${requestId}] 📂 Collection path: ${collectionPath}`);
    
      const phoneVariants = [
        normalizedPhone,
        `0${normalizedPhone}`,
        `60${normalizedPhone}`,
        `+60${normalizedPhone}`,
        phoneNumber
      ];
    
      console.log(`[${requestId}] 🔍 Trying phone variants:`, phoneVariants);
    
      let userDoc = null;
      let usedVariant = null;
      
      for (const variant of phoneVariants) {
        console.log(`[${requestId}] 🔎 Querying with variant: ${variant}`);
        
        try {
          const usersSnap = await admin.firestore()
            .collection(collectionPath)
            .where("basicInfo.phoneNumber", "==", variant)
            .limit(1)
            .get();
          
          console.log(`[${requestId}] Query result for ${variant}: ${usersSnap.size} documents`);
          
          if (!usersSnap.empty) {
            userDoc = usersSnap.docs[0];
            usedVariant = variant;
            console.log(`[${requestId}] ✅ Found user with variant: ${variant}, Doc ID: ${userDoc.id}`);
            break;
          }
        } catch (queryError) {
          console.error(`[${requestId}] ❌ Query error for ${variant}:`, queryError);
        }
      }
    
      if (!userDoc) {
        console.log(`[${requestId}] ❌ User not found for any phone variant`);
        return res.status(404).json({ 
          error: { code: 'not-found', message: '查无此手机号码' }
        });
      }
    
      const userData = userDoc.data();
      console.log(`[${requestId}] 📄 User data structure:`, {
        id: userDoc.id,
        hasBasicInfo: !!userData.basicInfo,
        phoneNumber: userData.basicInfo?.phoneNumber,
        hasPasswordHash: !!userData.basicInfo?.passwordHash,
        hasPinHash: !!userData.basicInfo?.pinHash,
        hasPasswordSalt: !!userData.basicInfo?.passwordSalt,
        hasPinSalt: !!userData.basicInfo?.pinSalt,
        roles: userData.roles,
        topLevelKeys: Object.keys(userData)
      });
    
      const passwordSalt = userData.basicInfo?.passwordSalt || userData.basicInfo?.pinSalt;
      const storedHash = userData.basicInfo?.passwordHash || userData.basicInfo?.pinHash;
    
      if (!passwordSalt || !storedHash) {
        console.error(`[${requestId}] ❌ Missing password data`);
        return res.status(412).json({ 
          error: { code: 'failed-precondition', message: '用户密码资料不完整，请联系管理员' }
        });
      }
      
      console.log(`[${requestId}] 🔒 Computing password hash...`);
      const passwordHash = crypto.createHash("sha256")
        .update(pin + passwordSalt)
        .digest("hex");
    
      if (passwordHash !== storedHash) {
        console.log(`[${requestId}] ❌ Password mismatch`);
        return res.status(403).json({ 
          error: { code: 'permission-denied', message: '密码错误' }
        });
      }
      
      console.log(`[${requestId}] ✅ Password verified`);
    
      const authUid = `phone_60${normalizedPhone}`;
      console.log(`[${requestId}] 🔑 AuthUid: ${authUid}`);
    
      let userRecord;
      let skipAuthUserOps = false;
      try {
        console.log(`[${requestId}] 🔍 Checking if auth user exists...`);
        userRecord = await admin.auth().getUser(authUid);
        console.log(`[${requestId}] ✅ Existing auth user found`);
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          console.log(`[${requestId}] 📝 Creating new auth user...`);
          try {
            userRecord = await admin.auth().createUser({
              uid: authUid,
              displayName: userData.basicInfo?.englishName || 
                          userData.basicInfo?.chineseName || 
                          phoneNumber
            });
            console.log(`[${requestId}] ✅ Auth user created`);
          } catch (createError) {
            console.error(`[${requestId}] ❌ Failed to create auth user:`, createError);
            throw createError;
          }
        } else if (error.code === 'app/invalid-credential') {
          console.warn(`[${requestId}] ⚠️ Auth not configured, skipping getUser/createUser`);
          skipAuthUserOps = true;
        } else {
          console.error(`[${requestId}] ❌ Auth error:`, error);
          throw error;
        }
      }
      
      console.log(`[${requestId}] 🎫 Generating custom token...`);
      let customToken;
      try {
        customToken = await admin.auth().createCustomToken(authUid);
        console.log(`[${requestId}] ✅ Custom token generated`);
      } catch (tokenError) {
        console.error(`[${requestId}] ❌ Token generation failed:`, tokenError);
        throw tokenError;
      }
    
      const userId = userDoc.id;
      console.log(`[${requestId}] 🔄 Updating last active time...`);
      
      await admin.firestore()
        .collection(collectionPath)
        .doc(userId)
        .update({ 'activityData.lastActiveAt': new Date() });
    
      const duration = Date.now() - startTime;
      console.log(`[${requestId}] ✅ Login successful in ${duration}ms`);
      console.log(`[${requestId}] ===== LOGIN REQUEST END =====`);
    
      return res.status(200).json({
        success: true,
        customToken,
        userId,
        organizationId,
        eventId,
        englishName: userData.basicInfo?.englishName || '',
        chineseName: userData.basicInfo?.chineseName || '',
        message: '登录成功',
        elapsedMs: duration
      });
    } catch (error) {
      console.error(`[${requestId}] ❌ Unexpected error:`, error);
      return res.status(500).json({
        error: {
          code: error.code || 'internal',
          message: error.message || '登录失败'
        }
      });
    }
  });
});

// Event Manager HTTP 登录端点
exports.loginEventManagerHttp = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    
    console.log(`[${requestId}] ===== EVENT MANAGER LOGIN START =====`);
    
    try {
      if (req.method !== 'POST') {
        return res.status(405).json({ 
          error: { code: 'method-not-allowed', message: '只支持 POST 请求' }
        });
      }

      // 支援兩種呼叫方式：可直接用 organizationId/eventId（document id），
      // 或用 orgCode/eventCode（人可讀代碼）由 server 端查找對應 id。
      let { organizationId, eventId, phoneNumber, password, orgCode, eventCode } = req.body || {};

      console.log(`[${requestId}] 📥 Received data (raw):`, {
        organizationId,
        eventId,
        orgCode,
        eventCode,
        phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 3)}***` : 'missing',
        hasPassword: !!password
      });

      // 如果沒有提供 document id，但有提供 orgCode/eventCode，則查出對應的 ids
      if ((!organizationId || !eventId) && orgCode && eventCode) {
        console.log(`[${requestId}] 🔎 Looking up organizationId/eventId from orgCode/eventCode`);

        // 查 orgCode -> organizationId
        const orgsSnap = await admin.firestore()
          .collection('organizations')
          .where('orgCode', '==', String(orgCode).toLowerCase())
          .limit(1)
          .get();

        if (orgsSnap.empty) {
          return res.status(404).json({ error: { code: 'not-found', message: '找不到该组织' } });
        }

        const orgDoc = orgsSnap.docs[0];
        organizationId = orgDoc.id;
        console.log(`[${requestId}] ✅ Resolved organizationId: ${organizationId}`);

        // 查 eventCode -> eventId
        const eventsSnap = await admin.firestore()
          .collection('organizations').doc(organizationId)
          .collection('events')
          .where('eventCode', '==', String(eventCode))
          .limit(1)
          .get();

        if (eventsSnap.empty) {
          return res.status(404).json({ error: { code: 'not-found', message: '找不到该活动' } });
        }

        eventId = eventsSnap.docs[0].id;
        console.log(`[${requestId}] ✅ Resolved eventId: ${eventId}`);
      }

      // 最終檢查必填欄位
      if (!organizationId || !eventId || !phoneNumber || !password) {
        return res.status(400).json({ 
          error: { code: 'invalid-argument', message: '请提供所有必填字段' }
        });
      }

      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;

      const phoneVariants = [
        normalizedPhone,
        `0${normalizedPhone}`,
        `60${normalizedPhone}`,
        `+60${normalizedPhone}`,
        phoneNumber
      ];

      let userDoc = null;
      
      for (const variant of phoneVariants) {
        const usersSnap = await admin.firestore()
          .collection(collectionPath)
          .where("basicInfo.phoneNumber", "==", variant)
          .limit(1)
          .get();
        
        if (!usersSnap.empty) {
          userDoc = usersSnap.docs[0];
          break;
        }
      }

      if (!userDoc) {
        return res.status(404).json({ 
          error: { code: 'not-found', message: '查无此用户' }
        });
      }

      const userData = userDoc.data();

      if (!userData.roles || !userData.roles.includes('event_manager')) {
        return res.status(403).json({ 
          error: { code: 'permission-denied', message: '您不是此活动的 Event Manager' }
        });
      }

      const passwordSalt = userData.basicInfo?.passwordSalt;
      const storedHash = userData.basicInfo?.passwordHash;

      if (!passwordSalt || !storedHash) {
        return res.status(412).json({ 
          error: { code: 'failed-precondition', message: '密码数据缺失' }
        });
      }

      const passwordHash = crypto.createHash("sha256")
        .update(password + passwordSalt)
        .digest("hex");

      if (passwordHash !== storedHash) {
        return res.status(403).json({ 
          error: { code: 'permission-denied', message: '密码错误' }
        });
      }

      const authUid = userData.authUid || userDoc.id;

      try {
        await admin.auth().getUser(authUid);
      } catch (error) {
        if (error.code === 'auth/user-not-found') {
          await admin.auth().createUser({
            uid: authUid,
            displayName: userData.basicInfo?.englishName || 'Event Manager',
            disabled: false
          });
        }
      }

      const customToken = await admin.auth().createCustomToken(authUid);
      const userId = userDoc.id;

      await admin.firestore()
        .collection(collectionPath)
        .doc(userId)
        .update({ 'activityData.lastActiveAt': new Date() });

      // 可選：若存在組織層 users 彙總文件，才更新其 lastActiveAt，避免 NOT_FOUND 造成 500
      try {
        const orgUserRef = admin.firestore()
          .collection('organizations').doc(organizationId)
          .collection('users').doc(userId);
        const orgUserSnap = await orgUserRef.get();
        if (orgUserSnap.exists) {
          await orgUserRef.update({ 'activityData.lastActiveAt': new Date() });
        } else {
          console.log(`[${requestId}] Org-level user doc missing, skip update`);
        }
      } catch (orgUpdateErr) {
        console.warn(`[${requestId}] Skip org-level users update due to error:`, orgUpdateErr?.message);
      }

      const duration = Date.now() - startTime;
      return res.status(200).json({
        success: true,
        customToken,
        userId,
        organizationId,
        eventId,
        englishName: userData.basicInfo?.englishName || '',
        chineseName: userData.basicInfo?.chineseName || '',
        message: '登录成功',
        elapsedMs: duration
      });
    } catch (error) {
      console.error('[loginEventManagerHttp] Error:', error);
      return res.status(500).json({
        error: {
          code: error.code || 'internal',
          message: error.message || '登录失败'
        }
      });
    }
  });
});

// changePassword 函数
exports.changePassword = functions.https.onCall(async (data, context) => {
  const { phoneNumber, currentPassword, newPassword } = data;
  
  if (!phoneNumber || !currentPassword || !newPassword) {
    throw new functions.https.HttpsError("invalid-argument", "请提供手机号码、当前密码和新密码");
  }
  
  if (newPassword.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "新密码长度至少需要8个字符");
  }
  
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  
  if (!hasLetter || !hasNumber) {
    throw new functions.https.HttpsError("invalid-argument", "新密码必须包含英文字母和数字");
  }
  
  try {
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const phoneVariants = [
      normalizedPhone,
      `0${normalizedPhone}`,
      `60${normalizedPhone}`,
      phoneNumber
    ];
    
    let userDoc = null;
    
    for (const variant of phoneVariants) {
      const usersSnap = await admin.firestore().collection("users")
        .where("basicInfo.phoneNumber", "==", variant)
        .limit(1)
        .get();
      
      if (!usersSnap.empty) {
        userDoc = usersSnap.docs[0];
        break;
      }
    }
    
    if (!userDoc) {
      throw new functions.https.HttpsError("not-found", "查无此手机号码");
    }
    
    const userData = userDoc.data();
    
    const passwordSalt = userData.basicInfo.passwordSalt || userData.basicInfo.pinSalt;
    const currentPasswordHash = crypto.createHash("sha256")
      .update(currentPassword + passwordSalt)
      .digest("hex");
    
    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    if (currentPasswordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "当前密码错误");
    }
    
    const newPasswordHash = crypto.createHash("sha256")
      .update(newPassword + passwordSalt)
      .digest("hex");
    
    await userDoc.ref.update({
      "basicInfo.passwordHash": newPasswordHash,
      "basicInfo.pinHash": newPasswordHash,
      "basicInfo.passwordSalt": passwordSalt,
      "basicInfo.pinSalt": passwordSalt
    });
    
    console.log(`[changePassword] Password changed for ${phoneNumber}`);
    return { success: true, message: "密码修改成功" };
    
  } catch (error) {
    console.error("[changePassword] Error:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError("internal", `修改密码失败：${error.message}`);
  }
});

exports.loginAndRedirect = functions.https.onCall(async (data, context) => {
  const userUid = context.auth ? context.auth.uid : null;
  console.log(`[loginAndRedirect] User UID from context: ${userUid}`);
  
  const { phoneNumber } = data;
  
  let userSnap;
  if (userUid) {
    userSnap = await admin.firestore().collection("users")
      .where("authUid", "==", userUid)
      .limit(1)
      .get();
  }
  
  if ((!userSnap || userSnap.empty) && phoneNumber) {
    console.log(`[loginAndRedirect] Fallback to phoneNumber query: ${phoneNumber}`);
    userSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
  }
  
  console.log(`[loginAndRedirect] Query result: ${userSnap && !userSnap.empty ? 'found' : 'empty'}`);
  if (!userSnap || userSnap.empty) {
    throw new functions.https.HttpsError("not-found", "找不到使用者资料。");
  }
  
  const userData = userSnap.docs[0].data();
  return {
    redirectUrl: getRedirectUrl(userData.roles),
    chineseName: userData.basicInfo?.chineseName || "",
    roles: userData.roles,
    identityTag: userData.identityTag || "",
  };
});

exports.getManagers = functions.https.onCall(async (data, context) => {
  try {
    const managersSnap = await admin.firestore().collection("managers").get();
    const managers = [];

    managersSnap.forEach(doc => {
      managers.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return { managers };
  } catch (error) {
    console.error("Error fetching managers:", error);
    throw new functions.https.HttpsError("internal", "Unable to fetch managers.");
  }
});

// functions/migrateIdentityTags.js
exports.migrateIdentityTags = functions.https.onRequest(async (req, res) => {
  try {
    const db = admin.firestore();
    
    // 获取所有 Organizations
    const orgsSnapshot = await db.collection('organizations').get();
    
    const batch = db.batch();
    let updateCount = 0;
    const now = new Date().toISOString(); // ✅ 使用固定的时间戳字符串
    
    for (const orgDoc of orgsSnapshot.docs) {
      const orgData = orgDoc.data();
      
      // 检查是否已有 identityTags
      if (!orgData.identityTags) {
        // 添加默认的身份标签
        const defaultIdentityTags = [
          {
            id: 'staff',
            name: {
              'en': 'Staff',
              'zh-CN': '职员'
            },
            displayOrder: 1,
            isActive: true,
            createdAt: now // ✅ 使用字符串而不是 serverTimestamp()
          },
          {
            id: 'student',
            name: {
              'en': 'Student',
              'zh-CN': '学生'
            },
            displayOrder: 2,
            isActive: true,
            createdAt: now
          },
          {
            id: 'teacher',
            name: {
              'en': 'Teacher',
              'zh-CN': '教师'
            },
            displayOrder: 3,
            isActive: true,
            createdAt: now
          }
        ];
        
        batch.update(orgDoc.ref, {
          identityTags: defaultIdentityTags,
          updatedAt: admin.firestore.FieldValue.serverTimestamp() // ✅ 这里可以用 serverTimestamp
        });
        
        updateCount++;
      }
    }
    
    await batch.commit();
    
    res.json({
      success: true,
      message: `成功更新 ${updateCount} 个组织的身份标签`,
      totalOrgs: orgsSnapshot.size,
      timestamp: now
    });
    
  } catch (error) {
    console.error('迁移失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});