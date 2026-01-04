/**
 * setupTransactionPin.js
 * 设置交易密码（Transaction PIN）
 * 
 * 用于：
 * 1. 首次登录时设置交易密码
 * 2. 完成初始化设置流程
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { hashPin } = require('./utils/bcryptHelper');
const { validateTransactionPin } = require('./utils/validators');

exports.setupTransactionPin = onCall({ region: 'asia-southeast1' }, async (request) => {
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
      console.log('[setupTransactionPin] 检测到 userId 为 universal，使用 auth.uid:', auth.uid);
      userId = auth.uid;
    }

    console.log('[setupTransactionPin] 收到请求:', {
      userId,
      organizationId,
      eventId,
      hasPin: !!transactionPin
    });

    // ========== 3. 验证必填参数 ==========
    if (!userId || !organizationId || !eventId || !transactionPin) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    // 验证用户只能设置自己的 PIN
    const callerUserId = auth.token?.userId;
    if (auth.uid !== userId && callerUserId !== userId) {
      throw new HttpsError('permission-denied', '无权设置其他用户的交易密码');
    }

    // ========== 4. 验证 PIN 格式 ==========
    const pinValidation = validateTransactionPin(transactionPin);
    if (!pinValidation.isValid) {
      throw new HttpsError('invalid-argument', pinValidation.error);
    }

    // ========== 5. 获取用户文档 ==========
    // 🔧 修复：eventManager 就是普通用户，存储在 users 集合中（roles 包含 "eventManager"）
    // 不需要特殊检查，所有用户都在同一个结构中
    const db = admin.firestore();
    const userRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(userId);

    const userDoc = await userRef.get();

    if (!userDoc || !userDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    const userData = userDoc.data();

    // ========== 6. 检查是否已设置过 PIN ==========
    // 注意：这里允许重新设置 PIN，但在生产环境中可能需要额外验证
    const existingPinHash = userData.basicInfo?.transactionPinHash;
    
    if (existingPinHash) {
      console.log('[setupTransactionPin] 用户已有 PIN，将进行更新');
    }

    // ========== 7. 加密 PIN ==========
    const { hash: pinHash, salt: pinSalt } = await hashPin(transactionPin);

    // ========== 8. 更新用户文档 ==========
    // 🔧 修复：所有用户（包括 eventManager）都用相同的更新逻辑
    // 因为 eventManager 存储在 users 集合中，与普通用户结构相同
    const updateData = {
      'basicInfo.transactionPinHash': pinHash,
      'basicInfo.transactionPinSalt': pinSalt,
      'basicInfo.isFirstLogin': false,  // 设置 PIN 后，首次登录标记改为 false
      'basicInfo.pinFailedAttempts': 0,  // 重置错误次数
      'basicInfo.pinLockedUntil': null,  // 清除锁定
      'basicInfo.pinLastChanged': admin.firestore.FieldValue.serverTimestamp(),
      'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
    };
    await userRef.update(updateData);

    console.log('[setupTransactionPin] 交易密码设置成功:', userId);

    // ========== 9. 返回成功 ==========
    return {
      success: true,
      message: '交易密码设置成功',
      userId: userId
    };

  } catch (error) {
    console.error('[setupTransactionPin] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '设置交易密码失败，请重试');
  }
});
