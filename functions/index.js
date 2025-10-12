const admin = require('firebase-admin');
const functions = require('firebase-functions');
const crypto = require('crypto');

admin.initializeApp();

const { checkAdminExists, createInitialAdmin, sendOtpToPhone, verifyOtpCode, setProjectInfo, getTotalCapital, getAssignedCapitalSum, createManager } = require('./admin');
exports.checkAdminExists = checkAdminExists;
exports.createInitialAdmin = createInitialAdmin;
exports.sendOtpToPhone = sendOtpToPhone;
exports.verifyOtpCode = verifyOtpCode;
exports.setProjectInfo = setProjectInfo;
exports.getTotalCapital = getTotalCapital;
exports.getAssignedCapitalSum = getAssignedCapitalSum;
exports.createManager = createManager;

exports.loginWithPin = functions.https.onCall(async (data, context) => {
  const { phoneNumber, pin, organizationId, eventId } = data.data || data;
  
  console.log('[loginWithPin] Received:', { phoneNumber, organizationId, eventId, hasPin: !!pin });
  
  if (!phoneNumber || !pin) {
    throw new functions.https.HttpsError("invalid-argument", "请提供手机号码与PIN码");
  }
  if (!organizationId || !eventId) {
    throw new functions.https.HttpsError("invalid-argument", "请提供组织与活动信息");
  }
  
  // 使用正确的路径查询用户
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
  // 马来西亚国码是 60
  const authUid = `phone_60${phoneNumber.replace(/^0/, "")}`;
  let userRecord;
  try {
    userRecord = await admin.auth().getUser(authUid);
  } catch (error) {
    // 如果用戶不存在，創建新用戶（不設定 phoneNumber，避免衝突）
    userRecord = await admin.auth().createUser({
      uid: authUid,
      displayName: userData.basicInfo.chineseName || phoneNumber
    });
  }
  const customToken = await admin.auth().createCustomToken(authUid);
  // 確保 Firestore 的 authUid 正確更新
  console.log(`[loginWithPin] Current authUid in Firestore: ${userData.authUid}, New authUid: ${authUid}`);
  if (userData.authUid !== authUid) {
    console.log(`[loginWithPin] Updating authUid from ${userData.authUid} to ${authUid}`);
    await userDoc.ref.update({ authUid });
  }
  return {
    customToken,
    chineseName: userData.basicInfo.chineseName,
    roles: userData.roles,
    redirectUrl: getRedirectUrl(userData.roles)
  };
});

exports.changePassword = functions.https.onCall(async (data, context) => {
  const { phoneNumber, currentPassword, newPassword } = data.data || data;
  
  if (!phoneNumber || !currentPassword || !newPassword) {
    throw new functions.https.HttpsError("invalid-argument", "請提供手機號碼、當前密碼和新密碼");
  }
  
  // 驗證新密碼長度
  if (newPassword.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "新密碼長度至少需要8個字符");
  }
  
  // 驗證新密碼強度（至少包含英文和數字）
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  
  if (!hasLetter || !hasNumber) {
    throw new functions.https.HttpsError("invalid-argument", "新密碼必須包含英文字母和數字");
  }
  
  try {
    // 查詢用戶
    const usersSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
      
    if (usersSnap.empty) {
      throw new functions.https.HttpsError("not-found", "查無此手機號碼");
    }
    
    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();
    
    // 驗證當前密碼
    const passwordSalt = userData.basicInfo.passwordSalt || userData.basicInfo.pinSalt;
    const currentPasswordHash = crypto.createHash("sha256").update(currentPassword + passwordSalt).digest("hex");
    
    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    if (currentPasswordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "當前密碼錯誤");
    }
    
    // 生成新的密碼 hash（使用相同的 salt）
    const newPasswordHash = crypto.createHash("sha256").update(newPassword + passwordSalt).digest("hex");
    
    // 更新 Firestore（同時更新 passwordHash 和保留舊的 pinHash 以便向後兼容）
    await userDoc.ref.update({
      "basicInfo.passwordHash": newPasswordHash,
      "basicInfo.pinHash": newPasswordHash,  // 向後兼容
      "basicInfo.passwordSalt": passwordSalt,
      "basicInfo.pinSalt": passwordSalt       // 向後兼容
    });
    
    console.log(`[changePassword] Password changed for ${phoneNumber}`);
    return { success: true, message: "密碼修改成功" };
    
  } catch (error) {
    console.error("[changePassword] Error:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError("internal", `修改密碼失敗：${error.message}`);
  }
});

function getRedirectUrl(roles) {
  console.log(`[getRedirectUrl] Checking roles:`, JSON.stringify(roles));
  // super_admin 去 admin-dashboard.html（管理後台總覽）
  if (roles.includes("super_admin") || roles.includes("super admin")) return "../admin/admin-dashboard.html";
  // manager 去 admin-manage-users.html（用戶管理頁面）
  if (roles.includes("manager")) return "../manager/admin-manage-users.html";
  // merchant 去 merchant-dashboard.html（商家儀表板）
  if (roles.includes("merchant")) return "../merchant/merchant-dashboard.html";
  // seller 去 seller-dashboard.html（銷售員儀表板）
  if (roles.includes("seller")) return "../seller/seller-dashboard.html";
  if (roles.includes("customer")) return "../customer/consume.html";
  console.log(`[getRedirectUrl] No role matched, returning default`);
  return "../home/index.html";
}

exports.loginAndRedirect = functions.https.onCall(async (data, context) => {
  const userUid = context.auth ? context.auth.uid : null;
  console.log(`[loginAndRedirect] User UID from context: ${userUid}`);
  
  // 如果 context.auth 是 null（emulator 常見問題），嘗試從 data 取得 phoneNumber
  const { phoneNumber } = data.data || data;
  
  let userSnap;
  if (userUid) {
    // 優先用 authUid 查詢
    userSnap = await admin.firestore().collection("users").where("authUid", "==", userUid).limit(1).get();
  }
  
  // 如果 authUid 查不到，且有 phoneNumber，改用 phoneNumber 查詢
  if ((!userSnap || userSnap.empty) && phoneNumber) {
    console.log(`[loginAndRedirect] Fallback to phoneNumber query: ${phoneNumber}`);
    userSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
  }
  
  console.log(`[loginAndRedirect] Query result: ${userSnap && !userSnap.empty ? 'found' : 'empty'}`);
  if (!userSnap || userSnap.empty) throw new functions.https.HttpsError("not-found", "找不到使用者資料。");
  
  const userData = userSnap.docs[0].data();
  return {
    redirectUrl: getRedirectUrl(userData.roles),
    chineseName: userData.basicInfo && userData.basicInfo.chineseName ? userData.basicInfo.chineseName : "",
    roles: userData.roles,
    identityTag: userData.identityTag || "",
  };
});

exports.sendOtpToPhone = functions.https.onCall(async (data, context) => {
    const { phoneNumber, pinCode } = data.data || data;
    if (!phoneNumber || !pinCode) {
        throw new functions.https.HttpsError("invalid-argument", "請提供手機號和PIN");
    }
    // 產生 6 位數 OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // 產生 sessionId
    const sessionId = crypto.randomUUID();
    const expirationTime = Date.now() + 5 * 60 * 1000;
    await admin.firestore().collection("otp_sessions").doc(sessionId).set({
        phoneNumber,
        pinCode,
        otp,
        expirationTime,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (process.env.FUNCTIONS_EMULATOR === "true") {
        console.log(`[EMULATOR] OTP for ${phoneNumber}: ${otp} (sessionId: ${sessionId})`);
    }
    // Twilio 發送略（正式环境可补充）
    return { sessionId, success: true, message: "OTP已發送" };
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
