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

// 🔥 添加 CORS 中间件
const cors = require('cors')({
  origin: true, // 允许所有来源（开发环境）
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

// 🔥 修复：loginWithPin 函數 - 使用 v1 onCall
exports.loginWithPin = functions.https.onCall(async (data, context) => {
  try {
    // 从 data 获取数据
    const { phoneNumber, pin, organizationId, eventId } = data;
    
    console.log('[loginWithPin] Received:', { 
      phoneNumber, 
      organizationId, 
      eventId, 
      hasPin: !!pin
    });
    
    // 验证必填字段
    if (!phoneNumber || !pin) {
      throw new functions.https.HttpsError('invalid-argument', '请提供手机号码与密码');
    }
    if (!organizationId || !eventId) {
      throw new functions.https.HttpsError('invalid-argument', '请提供组织与活动信息');
    }
    
    // 标准化手机号码
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    console.log('[loginWithPin] Normalized phone:', normalizedPhone);
    
    // 正确的集合路径
    const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;
    console.log('[loginWithPin] Querying path:', collectionPath);
    
    // 查询时尝试多种手机号格式
    const phoneVariants = [
      normalizedPhone,
      `0${normalizedPhone}`,
      `60${normalizedPhone}`,
      phoneNumber
    ];
    
    console.log('[loginWithPin] Trying phone variants:', phoneVariants);
    
    let userDoc = null;
    let usersSnap = null;
    
    // 尝试每种格式
    for (const variant of phoneVariants) {
      usersSnap = await admin.firestore()
        .collection(collectionPath)
        .where("basicInfo.phoneNumber", "==", variant)
        .limit(1)
        .get();
      
      if (!usersSnap.empty) {
        userDoc = usersSnap.docs[0];
        console.log('[loginWithPin] Found user with phone variant:', variant);
        break;
      }
    }
    
    if (!userDoc) {
      console.log('[loginWithPin] User not found for any phone variant');
      throw new functions.https.HttpsError('not-found', '查无此手机号码');
    }
    
    const userData = userDoc.data();
    console.log('[loginWithPin] User data found:', {
      id: userDoc.id,
      phoneNumber: userData.basicInfo?.phoneNumber,
      roles: userData.roles
    });
    
    // 验证密码
    const passwordSalt = userData.basicInfo?.passwordSalt || userData.basicInfo?.pinSalt;
    const storedHash = userData.basicInfo?.passwordHash || userData.basicInfo?.pinHash;
    
    if (!passwordSalt || !storedHash) {
      throw new functions.https.HttpsError('failed-precondition', '用户密码资料不完整');
    }
    
    const passwordHash = crypto.createHash("sha256").update(pin + passwordSalt).digest("hex");
    
    if (passwordHash !== storedHash) {
      throw new functions.https.HttpsError('permission-denied', '密码错误');
    }
    
    // 生成或获取 authUid
    const authUid = `phone_60${normalizedPhone}`;
    console.log('[loginWithPin] Using authUid:', authUid);
    
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(authUid);
      console.log('[loginWithPin] Existing auth user found');
    } catch (error) {
      console.log('[loginWithPin] Creating new auth user');
      userRecord = await admin.auth().createUser({
        uid: authUid,
        displayName: userData.basicInfo?.englishName || userData.basicInfo?.chineseName || phoneNumber
      });
    }
    
    // 生成自定义令牌
    const customToken = await admin.auth().createCustomToken(authUid);
    
    // 更新用户文档的 authUid（如果不存在或不一致）
    const currentAuthUid = userData.authUid || userData.authId || userData.accountStatus?.authUid;
    if (currentAuthUid !== authUid) {
      console.log(`[loginWithPin] Updating authUid from ${currentAuthUid} to ${authUid}`);
      await userDoc.ref.update({ 
        authUid: authUid,
        'accountStatus.authUid': authUid,
        'accountStatus.updatedAt': new Date()
      });
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
    
    console.log('[loginWithPin] Login successful, returning profile');
    
    return {
      customToken,
      userProfile,
      chineseName: userData.basicInfo?.chineseName || "",
      roles: userData.roles || [],
      redirectUrl: getRedirectUrl(userData.roles || [])
    };
    
  } catch (error) {
    console.error('[loginWithPin] Error:', error);
    
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    
    throw new functions.https.HttpsError('internal', error.message || '登入失败，请稍后重试');
  }
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

// 导出 Firestore 资料的 Cloud Function
exports.exportFirestoreData = functions.https.onRequest(async (req, res) => {
  // 🔥 添加 CORS 支持
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    console.log('🚀 开始导出 Firestore 资料...');
    
    const exportData = {};
    const collections = await admin.firestore().listCollections();
    
    for (const collection of collections) {
      console.log(`📁 导出集合: ${collection.id}`);
      const snapshot = await collection.get();
      exportData[collection.id] = {};
      
      for (const doc of snapshot.docs) {
        exportData[collection.id][doc.id] = doc.data();
        
        const subcollections = await doc.ref.listCollections();
        if (subcollections.length > 0) {
          exportData[collection.id][doc.id]._subcollections = {};
          
          for (const subcol of subcollections) {
            const subSnapshot = await subcol.get();
            exportData[collection.id][doc.id]._subcollections[subcol.id] = {};
            
            subSnapshot.docs.forEach(subDoc => {
              exportData[collection.id][doc.id]._subcollections[subcol.id][subDoc.id] = subDoc.data();
            });
          }
        }
      }
      
      console.log(`  ✅ ${collection.id}: ${snapshot.size} 个文档`);
    }
    
    console.log('✅ 导出完成！');
    
    res.status(200).json({
      success: true,
      exportDate: new Date().toISOString(),
      data: exportData
    });
    
  } catch (error) {
    console.error('❌ 导出失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});