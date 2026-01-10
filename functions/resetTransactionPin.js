/**
 * resetTransactionPin.js
 * 重置交易密码（忘记密码时使用）
 * 
 * 用于：
 * 1. 用户忘记交易密码时重置
 * 2. 需要先通过 OTP 验证
 * 
 * 安全机制：
 * - 必须先验证 OTP
 * - 验证通过后才能设置新 PIN
 * - 重置后清除错误次数和锁定状态
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { hashPin } = require('./utils/bcryptHelper');
const { validateTransactionPin } = require('./utils/validators');

exports.resetTransactionPin = onCall({ region: 'asia-southeast1' }, async (request) => {
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
      otpCode,
      newTransactionPin
    } = data;
    
    let userId = data.userId;

    // ✅ 修正：如果 userId 是 'universal'，尝试使用 auth.uid
    if (userId === 'universal' && auth && auth.uid) {
      console.log('[resetTransactionPin] 检测到 userId 为 universal，使用 auth.uid:', auth.uid);
      userId = auth.uid;
    }

    console.log('[resetTransactionPin] 收到重置请求:', {
      userId,
      organizationId,
      eventId,
      hasOtp: !!otpCode,
      hasNewPin: !!newTransactionPin
    });

    // ========== 3. 验证必填参数 ==========
    if (!userId || !organizationId || !eventId || !otpCode || !newTransactionPin) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    // 验证用户只能重置自己的 PIN
    const callerUserId = auth.token?.userId;
    if (auth.uid !== userId && callerUserId !== userId) {
      throw new HttpsError('permission-denied', '无权重置其他用户的交易密码');
    }

    // ========== 4. 验证新 PIN 格式 ==========
    const pinValidation = validateTransactionPin(newTransactionPin);
    if (!pinValidation.isValid) {
      throw new HttpsError('invalid-argument', pinValidation.error);
    }

    // ========== 5. 验证 OTP ==========
    // 注意：这里需要调用你现有的 OTP 验证逻辑
    // 假设你有一个 verifyOtp 函数或者 otp_sessions 集合
    const db = admin.firestore();
    
    const otpSessionsRef = db.collection('otp_sessions');
    const otpQuery = await otpSessionsRef
      .where('phoneNumber', '==', auth.token.phone_number)
      .where('otpCode', '==', otpCode)
      .where('purpose', '==', 'resetPin')
      .where('verified', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (otpQuery.empty) {
      throw new HttpsError('permission-denied', 'OTP 验证码无效或已过期');
    }

    const otpDoc = otpQuery.docs[0];
    const otpData = otpDoc.data();

    // 检查 OTP 是否过期（通常是5分钟）
    const now = admin.firestore.Timestamp.now();
    const otpAge = now.toMillis() - otpData.createdAt.toMillis();
    const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5分钟

    if (otpAge > OTP_EXPIRY_MS) {
      throw new HttpsError('permission-denied', 'OTP 验证码已过期，请重新获取');
    }

    // 标记 OTP 为已验证
    await otpDoc.ref.update({
      verified: true,
      verifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // ========== 6. 获取用户文档 ==========
    const userRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(userId);

    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    // ========== 7. 加密新 PIN ==========
    const { hash: newPinHash, salt: newPinSalt } = await hashPin(newTransactionPin);

    // ========== 7. 更新用户文档 ==========
    // ✅ 修复：newPinSalt 现在是空字符串（表示 bcrypt 新格式），可以安全地存储或忽略
    const updateData = {
      'basicInfo.transactionPinHash': newPinHash,
      'basicInfo.transactionPinSalt': newPinSalt || null,  // ✅ 如果 salt 为空字符串，存 null
      'basicInfo.pinFailedAttempts': 0,  // 重置错误次数
      'basicInfo.pinLockedUntil': null,  // 清除锁定
      'basicInfo.pinLastChanged': admin.firestore.FieldValue.serverTimestamp(),
      'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    };

    await userRef.update(updateData);

    console.log('[resetTransactionPin] 交易密码重置成功:', userId);

    // ========== 8. 返回成功 ==========
    return {
      success: true,
      message: '交易密码重置成功',
      userId: userId
    };

  } catch (error) {
    console.error('[resetTransactionPin] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '重置交易密码失败，请重试');
  }
});
