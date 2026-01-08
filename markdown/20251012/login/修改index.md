exports.loginWithPin = functions
  .region('us-central1')  // 使用你的实际区域
  .https
  .onCall(async (data, context) => {
    const { phoneNumber, pin, organizationId, eventId } = data;
    
    console.log('[loginWithPin] Received:', { 
      phoneNumber, 
      organizationId, 
      eventId, 
      hasPin: !!pin
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
        identityTag: userData.identityTag || "",
        // 添加其他需要的字段
      },
      redirectUrl: getRedirectUrl(userData.roles)
    };
  });

function getRedirectUrl(roles) {
  console.log(`[getRedirectUrl] Checking roles:`, JSON.stringify(roles));
  if (roles.includes("super_admin") || roles.includes("super admin")) return "../admin/admin-dashboard.html";
  if (roles.includes("manager")) return "../manager/admin-manage-users.html";
  if (roles.includes("merchant")) return "../merchant/merchant-dashboard.html";
  if (roles.includes("seller")) return "../seller/seller-dashboard.html";
  if (roles.includes("customer")) return "../customer/consume.html";
  return "../home/index.html";
}