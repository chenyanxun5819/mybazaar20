/**
 * verifyTransactionPin.js
 * 验证交易密码
 * 
 * 用于：
 * 1. Seller 卖点数给 Customer 时验证
 * 2. Customer 支付给 Merchant 时验证
 * 3. Customer 转让点数给其他 Customer 时验证
 * 
 * 安全机制：
 * - 5次错误后锁定1小时
 * - 验证成功后重置错误次数
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyPin } = require('./utils/bcryptHelper');

// 最大错误次数
const MAX_FAILED_ATTEMPTS = 5;

// 锁定时长（毫秒）：1小时
const LOCK_DURATION_MS = 60 * 60 * 1000;

exports.verifyTransactionPin = onCall({ region: 'asia-southeast1' }, async (request) => {
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
      transactionPin
    } = data;
    
    let userId = data.userId;

    // ✅ 修正：如果 userId 是 'universal'，尝试使用 auth.uid
    if (userId === 'universal' && auth && auth.uid) {
      console.log('[verifyTransactionPin] 检测到 userId 为 universal，使用 auth.uid:', auth.uid);
      userId = auth.uid;
    }

    console.log('[verifyTransactionPin] 收到验证请求:', {
      userId,
      organizationId,
      eventId,
      hasPin: !!transactionPin
    });

    // ========== 3. 验证必填参数 ==========
    if (!userId || !organizationId || !eventId || !transactionPin) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    // 验证用户只能验证自己的 PIN
    const callerUserId = auth.token?.userId;
    if (auth.uid !== userId && callerUserId !== userId) {
      throw new HttpsError('permission-denied', '无权验证其他用户的交易密码');
    }

    // ========== 4. 获取用户文档 ==========
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
    const basicInfo = userData.basicInfo || {};

    // ========== 5. 检查是否设置了 PIN ==========
    const pinHash = basicInfo.transactionPinHash;

    if (!pinHash) {
      throw new HttpsError('failed-precondition', '交易密码未设置，请先设置交易密码');
    }

    // ========== 6. 检查是否被锁定 ==========
    const pinLockedUntil = basicInfo.pinLockedUntil;
    const now = admin.firestore.Timestamp.now();

    if (pinLockedUntil && pinLockedUntil.toMillis() > now.toMillis()) {
      const remainingMinutes = Math.ceil((pinLockedUntil.toMillis() - now.toMillis()) / 60000);
      throw new HttpsError(
        'failed-precondition',
        `交易密码已被锁定，请在 ${remainingMinutes} 分钟后重试`
      );
    }

    // ========== 7. 验证 PIN ==========
    const isPinCorrect = await verifyPin(transactionPin, pinHash);

    const pinFailedAttempts = basicInfo.pinFailedAttempts || 0;

    if (isPinCorrect) {
      // ========== 验证成功：重置错误次数 ==========
      await userRef.update({
        'basicInfo.pinFailedAttempts': 0,
        'basicInfo.pinLockedUntil': null,
        'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('[verifyTransactionPin] 验证成功:', userId);

      return {
        success: true,
        message: '验证成功',
        verified: true
      };

    } else {
      // ========== 验证失败：增加错误次数 ==========
      const newFailedAttempts = pinFailedAttempts + 1;
      const updateData = {
        'basicInfo.pinFailedAttempts': newFailedAttempts,
        'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      };

      // 如果达到最大错误次数，锁定账户
      if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        updateData['basicInfo.pinLockedUntil'] = admin.firestore.Timestamp.fromDate(lockUntil);

        await userRef.update(updateData);

        console.log('[verifyTransactionPin] 达到最大错误次数，账户已锁定:', userId);

        throw new HttpsError(
          'failed-precondition',
          '交易密码错误次数过多，账户已被锁定1小时'
        );
      }

      await userRef.update(updateData);

      const remainingAttempts = MAX_FAILED_ATTEMPTS - newFailedAttempts;

      console.log('[verifyTransactionPin] 验证失败:', {
        userId,
        failedAttempts: newFailedAttempts,
        remainingAttempts
      });

      throw new HttpsError(
        'permission-denied',
        `交易密码错误，剩余尝试次数：${remainingAttempts}`
      );
    }

  } catch (error) {
    console.error('[verifyTransactionPin] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '验证交易密码失败，请重试');
  }
});
