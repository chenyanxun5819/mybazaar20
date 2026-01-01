/**
 * changeLoginPassword.js
 * 修改登录密码
 * 
 * 用于：
 * 1. 首次登录时修改默认密码
 * 2. 用户主动修改密码
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('./utils/bcryptHelper');
const { validateLoginPassword } = require('./utils/validators');

/**
 * SHA256 哈希函数 (与 loginUniversalHttp 保持一致)
 */
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

exports.changeLoginPassword = onCall(async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const {
      organizationId,
      eventId,
      oldPassword,
      newPassword
    } = data;
    
    let userId = data.userId;

    // ✅ 修正：如果 userId 是 'universal'，尝试使用 auth.uid
    if (userId === 'universal' && auth && auth.uid) {
      console.log('[changeLoginPassword] 检测到 userId 为 universal，使用 auth.uid:', auth.uid);
      userId = auth.uid;
    }

    console.log('[changeLoginPassword] 收到请求:', {
      userId,
      organizationId,
      eventId,
      authUid: auth.uid,
      hasOldPassword: !!oldPassword,
      hasNewPassword: !!newPassword
    });

    // ========== 3. 验证必填参数 ==========
    if (!userId || !organizationId || !eventId || !oldPassword || !newPassword) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    // ========== 4. 获取用户文档（增强兼容性查询）==========
    const db = admin.firestore();
    
    let userRef = null;
    let userDoc = null;

    // 普通用户：先尝试直接用 userId (Document ID) 获取
    const directRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(userId);
    
    const directDoc = await directRef.get();

    if (directDoc.exists) {
      userRef = directRef;
      userDoc = directDoc;
    } else {
      // 如果直接获取失败，尝试通过 authUid 字段查询 (兼容 userId 传的是 authUid 的情况)
      console.log('[changeLoginPassword] 直接获取失败，尝试通过 authUid 查询:', userId);
      const querySnapshot = await db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users')
        .where('authUid', '==', userId)
        .limit(1)
        .get();

      if (!querySnapshot.empty) {
        userDoc = querySnapshot.docs[0];
        userRef = userDoc.ref;
      } else {
        // 最后尝试通过手机号查询 (如果 userId 传的是格式化后的手机号)
        console.log('[changeLoginPassword] authUid 查询失败，尝试通过手机号查询:', userId);
        const phoneQuery = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users')
          .where('basicInfo.phoneNumber', '>=', userId.replace('phone_', ''))
          .limit(1)
          .get();
        
        if (!phoneQuery.empty) {
          userDoc = phoneQuery.docs[0];
          userRef = userDoc.ref;
        }
      }
    }

    if (!userDoc || !userDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    const userData = userDoc.data();

    // ========== 5. 权限检查：允许用户修改自己的密码 ==========
    const callerAuthUid = auth.uid;                    // Firebase Auth 的 uid
    const callerUserId = auth.token?.userId;           // Custom Claims 中的 userId
    const userAuthUid = userData.authUid;              // 用户文档中的 authUid
    const userDocId = userDoc.id;                      // 用户文档 ID

    // 多重匹配检查（任一匹配即可）
    const isOwnPassword = 
      callerAuthUid === userId ||           // Firebase Auth uid 匹配请求的 userId
      callerAuthUid === userAuthUid ||      // Firebase Auth uid 匹配用户的 authUid
      callerUserId === userId ||            // Custom Claims userId 匹配请求的 userId
      callerUserId === userDocId;           // Custom Claims userId 匹配文档 ID

    console.log('[changeLoginPassword] 权限检查:', {
      callerAuthUid,
      callerUserId,
      userId,
      userAuthUid,
      userDocId,
      isOwnPassword
    });

    if (!isOwnPassword) {
      throw new HttpsError('permission-denied', '无权修改其他用户的密码');
    }

    // ========== 6. 验证新密码强度 ==========
    const passwordValidation = validateLoginPassword(newPassword);
    if (!passwordValidation.isValid) {
      throw new HttpsError('invalid-argument', passwordValidation.error);
    }

    // 检查新密码不能与旧密码相同
    if (oldPassword === newPassword) {
      throw new HttpsError('invalid-argument', '新密码不能与旧密码相同');
    }

    // ========== 7. 验证旧密码 ==========
    // 注意：这里使用 sha256 以匹配 loginUniversalHttp.js 的逻辑
    const currentPasswordHash = userData.basicInfo?.passwordHash;
    const currentPasswordSalt = userData.basicInfo?.passwordSalt;

    if (!currentPasswordHash) {
      throw new HttpsError('failed-precondition', '用户密码未设置');
    }

    // 验证旧密码 (sha256)
    const computedOldHash = sha256(String(oldPassword) + String(currentPasswordSalt || ''));
    const isOldPasswordCorrect = (computedOldHash === currentPasswordHash);

    if (!isOldPasswordCorrect) {
      // 尝试兼容 bcrypt (如果之前错误地使用了 bcrypt)
      let isBcryptMatch = false;
      try {
        isBcryptMatch = await verifyPassword(oldPassword, currentPasswordHash);
      } catch (e) {
        // 忽略 bcrypt 错误
      }

      if (!isBcryptMatch) {
        throw new HttpsError('permission-denied', '旧密码错误');
      }
    }

    // ========== 8. 加密新密码 (使用 sha256 以保持一致) ==========
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newPasswordHash = sha256(String(newPassword) + newSalt);

    // ========== 9. 更新用户文档 ==========
    const updateData = {
      'basicInfo.passwordHash': newPasswordHash,
      'basicInfo.passwordSalt': newSalt,
      'basicInfo.hasDefaultPassword': false,
      'basicInfo.isFirstLogin': false,
      'basicInfo.passwordLastChanged': admin.firestore.FieldValue.serverTimestamp(),
      'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    };

    await userRef.update(updateData);

    console.log('[changeLoginPassword] 密码修改成功:', userId);

    // ========== 10. 返回成功 ==========
    return {
      success: true,
      message: '密码修改成功',
      userId: userId
    };

  } catch (error) {
    console.error('[changeLoginPassword] 错误:', error);

    // 如果是已知的 HttpsError，直接抛出
    if (error instanceof HttpsError) {
      throw error;
    }

    // 其他错误包装成 internal 错误
    throw new HttpsError('internal', error.message || '修改密码失败，请重试');
  }
});