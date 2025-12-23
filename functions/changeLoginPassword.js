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
const { hashPassword, verifyPassword } = require('./utils/bcryptHelper');
const { validateLoginPassword } = require('./utils/validators');

exports.changeLoginPassword = onCall(async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const {
      userId,
      organizationId,
      eventId,
      oldPassword,
      newPassword
    } = data;

    console.log('[changeLoginPassword] 收到请求:', {
      userId,
      organizationId,
      eventId,
      hasOldPassword: !!oldPassword,
      hasNewPassword: !!newPassword
    });

    // ========== 3. 验证必填参数 ==========
    if (!userId || !organizationId || !eventId || !oldPassword || !newPassword) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    // 验证用户只能修改自己的密码
    if (auth.uid !== userId) {
      throw new HttpsError('permission-denied', '无权修改其他用户的密码');
    }

    // ========== 4. 验证新密码强度 ==========
    const passwordValidation = validateLoginPassword(newPassword);
    if (!passwordValidation.isValid) {
      throw new HttpsError('invalid-argument', passwordValidation.error);
    }

    // 检查新密码不能与旧密码相同
    if (oldPassword === newPassword) {
      throw new HttpsError('invalid-argument', '新密码不能与旧密码相同');
    }

    // ========== 5. 获取用户文档 ==========
    const db = admin.firestore();
    const userRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(userId);

    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    const userData = userDoc.data();

    // ========== 6. 验证旧密码 ==========
    const currentPasswordHash = userData.basicInfo?.passwordHash;

    if (!currentPasswordHash) {
      throw new HttpsError('failed-precondition', '用户密码未设置');
    }

    const isOldPasswordCorrect = await verifyPassword(oldPassword, currentPasswordHash);

    if (!isOldPasswordCorrect) {
      throw new HttpsError('permission-denied', '旧密码错误');
    }

    // ========== 7. 加密新密码 ==========
    const { hash: newPasswordHash, salt: newPasswordSalt } = await hashPassword(newPassword);

    // ========== 8. 更新用户文档 ==========
    const updateData = {
      'basicInfo.passwordHash': newPasswordHash,
      'basicInfo.passwordSalt': newPasswordSalt,
      'basicInfo.hasDefaultPassword': false,
      'basicInfo.passwordLastChanged': admin.firestore.FieldValue.serverTimestamp(),
      'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    };

    await userRef.update(updateData);

    console.log('[changeLoginPassword] 密码修改成功:', userId);

    // ========== 9. 返回成功 ==========
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
