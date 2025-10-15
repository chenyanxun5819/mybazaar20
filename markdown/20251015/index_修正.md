const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

// 确保只初始化一次
if (!admin.apps.length) {
  admin.initializeApp();
}

const { checkAdminExists, createInitialAdmin, sendOtpToPhone, verifyOtpCode, setProjectInfo, getTotalCapital, getAssignedCapitalSum, createManager } = require('./admin');
exports.checkAdminExists = checkAdminExists;
exports.createInitialAdmin = createInitialAdmin;
exports.sendOtpToPhone = sendOtpToPhone;
exports.verifyOtpCode = verifyOtpCode;
exports.setProjectInfo = setProjectInfo;
exports.getTotalCapital = getTotalCapital;
exports.getAssignedCapitalSum = getAssignedCapitalSum;
exports.createManager = createManager;

// 🔥 添加 CORS 中间件 - 按照 Gemini 建議明確配置
const corsHandler = cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://mybazaar-c4881.web.app',
    'https://mybazaar-c4881.firebaseapp.com'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// 标准化手机号码格式
function normalizePhoneNumber(phoneNumber) {
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

// 🔥 调试版本：loginWithPin 函数 - 带详细日志
exports.loginWithPin = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    const startTime = Date.now();
    const requestId = Math.random().toString(36).substring(7);
    
    console.log(`[${requestId}] ===== LOGIN REQUEST START =====`);
    console.log(`[${requestId}] Method: ${req.method}`);
    console.log(`[${requestId}] Headers:`, JSON.stringify(req.headers));
    console.log(`[${requestId}] Body:`, JSON.stringify(req.body));
    
    try {
      // 只接受 POST 请求
      if (req.method !== 'POST') {
        console.log(`[${requestId}] ❌ Invalid method: ${req.method}`);
        return res.status(405).json({ 
          error: { code: 'method-not-allowed', message: '只支持 POST 请求' }
        });
      }

      // 从请求体获取数据
      const { phoneNumber, pin, organizationId, eventId } = req.body;
    
      console.log(`[${requestId}] 📥 Received data:`, { 
        phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 3)}***` : 'missing',
        hasPin: !!pin,
        pinLength: pin ? pin.length : 0,
        organizationId,
        eventId
      });
    
      // 验证必填字段
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
    
      // 标准化手机号码
      const normalizedPhone = normalizePhoneNumber(phoneNumber);
      console.log(`[${requestId}] 📱 Normalized phone: ${normalizedPhone}`);
    
      // 正确的集合路径
      const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;
      console.log(`[${requestId}] 📂 Collection path: ${collectionPath}`);
    
      // 查询时尝试多种手机号格式
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
      
      // 尝试每种格式
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
        console.log(`[${requestId}] Tried variants:`, phoneVariants);
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
      
      // 详细检查密码字段
      console.log(`[${requestId}] 🔐 Password fields check:`);
      console.log(`[${requestId}]   - basicInfo exists: ${!!userData.basicInfo}`);
      console.log(`[${requestId}]   - passwordHash exists: ${!!userData.basicInfo?.passwordHash}`);
      console.log(`[${requestId}]   - pinHash exists: ${!!userData.basicInfo?.pinHash}`);
      console.log(`[${requestId}]   - passwordSalt exists: ${!!userData.basicInfo?.passwordSalt}`);
      console.log(`[${requestId}]   - pinSalt exists: ${!!userData.basicInfo?.pinSalt}`);
    
      // 验证密码
      const passwordSalt = userData.basicInfo?.passwordSalt || userData.basicInfo?.pinSalt;
      const storedHash = userData.basicInfo?.passwordHash || userData.basicInfo?.pinHash;
    
      if (!passwordSalt || !storedHash) {
        console.error(`[${requestId}] ❌ Missing password data:`, {
          hasPasswordSalt: !!userData.basicInfo?.passwordSalt,
          hasPinSalt: !!userData.basicInfo?.pinSalt,
          hasPasswordHash: !!userData.basicInfo?.passwordHash,
          hasPinHash: !!userData.basicInfo?.pinHash,
          basicInfoKeys: userData.basicInfo ? Object.keys(userData.basicInfo) : []
        });
        return res.status(412).json({ 
          error: { code: 'failed-precondition', message: '用户密码资料不完整，请联系管理员' }
        });
      }
      
      console.log(`[${requestId}] 🔒 Computing password hash...`);
      const passwordHash = crypto.createHash("sha256").update(pin + passwordSalt).digest("hex");
      console.log(`[${requestId}] Hash comparison:`, {
        computed: passwordHash.substring(0, 10) + '...',
        stored: storedHash.substring(0, 10) + '...',
        match: passwordHash === storedHash
      });
    
      if (passwordHash !== storedHash) {
        console.log(`[${requestId}] ❌ Password mismatch`);
        return res.status(403).json({ 
          error: { code: 'permission-denied', message: '密码错误' }
        });
      }
      
      console.log(`[${requestId}] ✅ Password verified`);
    
      // 生成或获取 authUid
      const authUid = `phone_60${normalizedPhone}`;
      console.log(`[${requestId}] 🔑 AuthUid: ${authUid}`);
    
      let userRecord;
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
              displayName: userData.basicInfo?.englishName || userData.basicInfo?.chineseName || phoneNumber,
              phoneNumber: `+60${normalizedPhone}`
            });
            console.log(`[${requestId}] ✅ Auth user created with phone number`);
          } catch (createError) {
            console.log(`[${requestId}] ⚠️ Failed to create with phone, trying without:`, createError.message);
            userRecord = await admin.auth().createUser({
              uid: authUid,
              displayName: userData.basicInfo?.englishName || userData.basicInfo?.chineseName || phoneNumber
            });
            console.log(`[${requestId}] ✅ Auth user created without phone number`);
          }
        } else {
          console.error(`[${requestId}] ❌ Error checking auth user:`, error);
          throw error;
        }
      }
    
      // 生成自定义令牌
      console.log(`[${requestId}] 🎫 Creating custom token...`);
      const customToken = await admin.auth().createCustomToken(authUid, {
        orgId: organizationId,
        eventId: eventId,
        userId: userDoc.id
      });
      console.log(`[${requestId}] ✅ Custom token created (length: ${customToken.length})`);
    
      // 更新用户文档的 authUid
      const currentAuthUid = userData.authUid || userData.authId || userData.accountStatus?.authUid;
      if (currentAuthUid !== authUid) {
        console.log(`[${requestId}] 📝 Updating authUid in Firestore: ${currentAuthUid} -> ${authUid}`);
        await userDoc.ref.update({ 
          authUid: authUid,
          'accountStatus.authUid': authUid,
          'accountStatus.lastLoginAt': admin.firestore.FieldValue.serverTimestamp(),
          'accountStatus.updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });
        console.log(`[${requestId}] ✅ AuthUid updated in Firestore`);
      } else {
        console.log(`[${requestId}] ℹ️ AuthUid already correct, no update needed`);
      }
    
      // 构建返回的用户资料
      const userProfile = {
        id: userDoc.id,
        orgId: organizationId,
        eventId: eventId,
        authUid: authUid,
        basicInfo: userData.basicInfo,
        roles: userData.roles || [],
        identityTag: userData.basicInfo?.identityTag || "",
        roleSpecificData: userData.roleSpecificData || {}
      };
    
      const duration = Date.now() - startTime;
      console.log(`[${requestId}] ✅ Login successful in ${duration}ms`);
      console.log(`[${requestId}] 📤 Returning user profile:`, {
        userId: userProfile.id,
        roles: userProfile.roles,
        chineseName: userData.basicInfo?.chineseName
      });
      console.log(`[${requestId}] ===== LOGIN REQUEST END =====`);
    
      // 返回 JSON 响应
      return res.status(200).json({
        success: true,
        customToken,
        userProfile,
        chineseName: userData.basicInfo?.chineseName || "",
        roles: userData.roles || [],
        redirectUrl: getRedirectUrl(userData.roles || [])
      });
    
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[${requestId}] ❌ ERROR after ${duration}ms:`, {
        name: error.name,
        message: error.message,
        code: error.code,
        stack: error.stack
      });
    
      // 返回详细的错误信息
      return res.status(500).json({ 
        error: { 
          code: error.code || 'internal',
          message: error.message || '登入失败，请稍后重试',
          requestId: requestId
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
    const currentPasswordHash = crypto.createHash("sha256").update(currentPassword + passwordSalt).digest("hex");
    
    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    if (currentPasswordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "当前密码错误");
    }
    
    const newPasswordHash = crypto.createHash("sha256").update(newPassword + passwordSalt).digest("hex");
    
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

function getRedirectUrl(roles) {
  console.log(`[getRedirectUrl] Checking roles:`, JSON.stringify(roles));
  if (!roles || !Array.isArray(roles)) return "../home/index.html";
  
  if (roles.includes("super_admin") || roles.includes("super admin")) return "../admin/admin-dashboard.html";
  if (roles.includes("manager")) return "../manager/admin-manage-users.html";
  if (roles.includes("merchant")) return "../merchant/merchant-dashboard.html";
  if (roles.includes("seller")) return "../seller/seller-dashboard.html";
  if (roles.includes("customer")) return "../customer/consume.html";
  
  console.log(`[getRedirectUrl] No role matched, returning default`);
  return "../home/index.html";
}

exports.loginAndRedirect = functions.https.onCall(async (data, context) => {
  const userUid = context.auth ? context.auth.uid : null;
  console.log(`[loginAndRedirect] User UID from context: ${userUid}`);
  
  const { phoneNumber } = data;
  
  let userSnap;
  if (userUid) {
    userSnap = await admin.firestore().collection("users").where("authUid", "==", userUid).limit(1).get();
  }
  
  if ((!userSnap || userSnap.empty) && phoneNumber) {
    console.log(`[loginAndRedirect] Fallback to phoneNumber query: ${phoneNumber}`);
    userSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
  }
  
  console.log(`[loginAndRedirect] Query result: ${userSnap && !userSnap.empty ? 'found' : 'empty'}`);
  if (!userSnap || userSnap.empty) throw new functions.https.HttpsError("not-found", "找不到使用者资料。");
  
  const userData = userSnap.docs[0].data();
  return {
    redirectUrl: getRedirectUrl(userData.roles),
    chineseName: userData.basicInfo && userData.basicInfo.chineseName ? userData.basicInfo.chineseName : "",
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

exports.testFirestoreAccess = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    console.log('=== TEST START ===');

    const { orgId, eventId, phoneNumber } = req.query;

    if (!orgId || !eventId || !phoneNumber) {
      return res.status(400).json({
        error: 'Missing parameters',
        usage: '?orgId=xxx&eventId=xxx&phoneNumber=xxx'
      });
    }

    const collectionPath = `organizations/${orgId}/events/${eventId}/users`;
    console.log('Collection path:', collectionPath);

    const allUsers = await admin.firestore()
      .collection(collectionPath)
      .limit(5)
      .get();

    console.log(`Found ${allUsers.size} users`);

    const usersList = allUsers.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        phoneNumber: data.basicInfo?.phoneNumber,
        hasPasswordHash: !!data.basicInfo?.passwordHash,
        hasPinHash: !!data.basicInfo?.pinHash,
        roles: data.roles
      };
    });

    const userQuery = await admin.firestore()
      .collection(collectionPath)
      .where('basicInfo.phoneNumber', '==', phoneNumber)
      .limit(1)
      .get();

    let foundUser = null;
    if (!userQuery.empty) {
      const doc = userQuery.docs[0];
      const data = doc.data();
      foundUser = {
        id: doc.id,
        phoneNumber: data.basicInfo?.phoneNumber,
        hasPasswordHash: !!data.basicInfo?.passwordHash,
        hasPinHash: !!data.basicInfo?.pinHash,
        basicInfoKeys: data.basicInfo ? Object.keys(data.basicInfo) : []
      };
    }

    console.log('=== TEST END ===');

    return res.status(200).json({
      success: true,
      collectionPath,
      totalUsers: allUsers.size,
      usersList,
      queriedPhone: phoneNumber,
      foundUser
    });

  } catch (error) {
    console.error('TEST ERROR:', error);
    return res.status(500).json({
      error: error.message,
      code: error.code
    });
  }
});

