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

// 🔥 修正：不使用 .region() 或使用正确的语法
exports.loginWithPin = functions.https.onCall(async (data, context) => {
  // 🔥 恢复兼容两种传参方式
  const { phoneNumber, pin, organizationId, eventId } = data.data || data;
  
  console.log('[loginWithPin] Received:', { 
    phoneNumber, 
    organizationId, 
    eventId, 
    hasPin: !!pin,
    hasContext: !!context,
    rawData: data  // 🔥 添加这行来调试
  });
  
  if (!phoneNumber || !pin) {
    throw new functions.https.HttpsError("invalid-argument", "请提供手机号码与PIN码");
  }
  if (!organizationId || !eventId) {
    throw new functions.https.HttpsError("invalid-argument", "请提供组织与活动信息");
  }
  
  const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;
  console.log('[loginWithPin] Querying path:', collectionPath);
  
  const usersSnap = await admin.firestore()
    .collection(collectionPath)
    .where("basicInfo.phoneNumber", "==", phoneNumber)
    .limit(1)
    .get();
  
  console.log('[loginWithPin] Query result:', { empty: usersSnap.empty, size: usersSnap.size });
    
  if (usersSnap.empty) {
    throw new functions.https.HttpsError("not-found", "查无此手机号码");
  }
  
  const userDoc = usersSnap.docs[0];
  const userData = userDoc.data();
  const passwordSalt = userData.basicInfo.passwordSalt || userData.basicInfo.pinSalt;
  const passwordHash = crypto.createHash("sha256").update(pin + passwordSalt).digest("hex");
  const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
  
  if (passwordHash !== storedHash) {
    throw new functions.https.HttpsError("permission-denied", "密码错误");
  }
  
  const authUid = `phone_60${phoneNumber.replace(/^0/, "")}`;
  let userRecord;
  try {
    userRecord = await admin.auth().getUser(authUid);
  } catch (error) {
    userRecord = await admin.auth().createUser({
      uid: authUid,
      displayName: userData.basicInfo.chineseName || phoneNumber
    });
  }
  
  const customToken = await admin.auth().createCustomToken(authUid);
  
  if (userData.authUid !== authUid) {
    console.log(`[loginWithPin] Updating authUid from ${userData.authUid} to ${authUid}`);
    await userDoc.ref.update({ authUid });
  }
  
  // 🔥 返回完整的用户资料
  return {
    customToken,
    userProfile: {
      id: userDoc.id,
      orgId: organizationId,
      eventId: eventId,
      authUid: authUid,
      basicInfo: userData.basicInfo,
      roles: userData.roles,
      identityTag: userData.identityTag || ""
    },
    chineseName: userData.basicInfo.chineseName,
    roles: userData.roles,
    redirectUrl: getRedirectUrl(userData.roles)
  };
});


exports.changePassword = functions.https.onCall(async (data, context) => {
  const { phoneNumber, currentPassword, newPassword } = data;
  
  if (!phoneNumber || !currentPassword || !newPassword) {
    throw new functions.https.HttpsError("invalid-argument", "请提供手机号码、当前密码和新密码");
  }
  
  // 验证新密码长度
  if (newPassword.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "新密码长度至少需要8个字符");
  }
  
  // 验证新密码强度（至少包含英文和数字）
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  
  if (!hasLetter || !hasNumber) {
    throw new functions.https.HttpsError("invalid-argument", "新密码必须包含英文字母和数字");
  }
  
  try {
    // 查询用户
    const usersSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
      
    if (usersSnap.empty) {
      throw new functions.https.HttpsError("not-found", "查无此手机号码");
    }
    
    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();
    
    // 验证当前密码
    const passwordSalt = userData.basicInfo.passwordSalt || userData.basicInfo.pinSalt;
    const currentPasswordHash = crypto.createHash("sha256").update(currentPassword + passwordSalt).digest("hex");
    
    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    if (currentPasswordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "当前密码错误");
    }
    
    // 生成新的密码 hash（使用相同的 salt）
    const newPasswordHash = crypto.createHash("sha256").update(newPassword + passwordSalt).digest("hex");
    
    // 更新 Firestore
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

// 🔥 新增：導出 Firestore 資料的 Cloud Function（不需要認證）
exports.exportFirestoreData = functions.https.onRequest(async (req, res) => {
  // 設置 CORS
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    console.log('🚀 開始導出 Firestore 資料...');
    
    const exportData = {};
    
    // 獲取所有頂層集合
    const collections = await admin.firestore().listCollections();
    
    for (const collection of collections) {
      console.log(`📁 導出集合: ${collection.id}`);
      const snapshot = await collection.get();
      exportData[collection.id] = {};
      
      for (const doc of snapshot.docs) {
        exportData[collection.id][doc.id] = doc.data();
        
        // 遞迴導出子集合
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
      
      console.log(`  ✅ ${collection.id}: ${snapshot.size} 個文檔`);
    }
    
    console.log('✅ 導出完成！');
    
    // 返回 JSON 資料
    res.status(200).json({
      success: true,
      exportDate: new Date().toISOString(),
      data: exportData
    });
    
  } catch (error) {
    console.error('❌ 導出失敗:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});