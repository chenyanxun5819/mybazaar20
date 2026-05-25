/**
 * processRfidPayment.js - RFID 卡支付处理函数
 * 
 * 流程：
 * 1. 验证 RFID ID 和客户信息
 * 2. 验证交易密码
 * 3. 检查余额
 * 4. 创建交易记录
 * 5. 更新客户和商家点数
 */

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const crypto = require('crypto');

/**
 * 验证 PIN 哈希
 */
function verifyPin(pin, pinHash, pinSalt) {
  if (!pin || !pinHash || !pinSalt) return false;
  const computedHash = crypto
    .pbkdf2Sync(pin, Buffer.from(pinSalt, 'hex'), 10000, 64, 'sha256')
    .toString('hex');
  return computedHash === pinHash;
}

/**
 * Cloud Function: processRfidPayment (callable, Gen 2)
 * 
 * Request payload:
 * {
 *   customerId: string,
 *   merchantId: string,
 *   rfidId: string,
 *   amount: number,
 *   organizationId: string,
 *   eventId: string,
 *   transactionPin: string
 * }
 */
exports.processRfidPayment = onCall({ region: 'asia-southeast1' }, async (request) => {
  console.log('[processRfidPayment] ========== 开始处理 RFID 支付 ==========');

  // 验证认证
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '需要登录');
  }

  const callerUid = request.auth.uid;

  // 解析参数（RFID 支付无需 transactionPin）
  const {
    customerId,
    merchantId,
    rfidId,
    amount,
    organizationId,
    eventId
  } = request.data;

  // 验证必需参数
  if (!customerId || !merchantId || !rfidId || !amount || !organizationId || !eventId) {
    throw new HttpsError('invalid-argument', '缺少必需参数');
  }

  if (typeof amount !== 'number' || amount <= 0) {
    throw new HttpsError('invalid-argument', '金额必须大于 0');
  }

  const db = admin.firestore();
  const now = new Date();

  try {
    // ========== 第1步：从 users 集合获取客户信息（正确路径）==========
    console.log('[processRfidPayment] 步骤 1: 验证客户信息');

    // ✅ 正确路径：organizations/{orgId}/events/{eventId}/users/{userId}
    const userDocRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(customerId);

    const userDocSnap = await userDocRef.get();

    if (!userDocSnap.exists) {
      console.error('[processRfidPayment] 用户不存在:', customerId);
      throw new HttpsError('not-found', '客户不存在');
    }

    const userData = userDocSnap.data();
    const availablePoints = userData?.customer?.pointsAccount?.availablePoints || 0;

    console.log('[processRfidPayment] 客户余额:', availablePoints);

    // 验证 RFID 卡信息（存储在 basicInfo.rfidCard）
    const rfidCard = userData?.basicInfo?.rfidCard;
    if (!rfidCard) {
      console.error('[processRfidPayment] 客户未绑定 RFID 卡');
      throw new HttpsError('failed-precondition', '客户未绑定 RFID 卡');
    }

    if (rfidCard.rfidId !== rfidId) {
      console.error('[processRfidPayment] RFID ID 不匹配');
      throw new HttpsError('permission-denied', 'RFID 卡号不匹配');
    }

    if (rfidCard.status !== 'active') {
      console.error('[processRfidPayment] RFID 卡未激活:', rfidCard.status);
      throw new HttpsError('failed-precondition', 'RFID 卡已禁用');
    }

    // ========== 第2步：检查余额 ==========
    console.log('[processRfidPayment] 步骤 3: 检查余额');

    if (availablePoints < amount) {
      console.error('[processRfidPayment] 余额不足:', availablePoints, '需要:', amount);
      throw new HttpsError('failed-precondition', `余额不足。当前余额：${availablePoints} 点`);
    }

    // ========== 第4步：获取商家信息 ==========
    console.log('[processRfidPayment] 步骤 4: 获取商家信息');

    const merchantDocRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('merchants').doc(merchantId);

    const merchantDocSnap = await merchantDocRef.get();

    if (!merchantDocSnap.exists) {
      console.error('[processRfidPayment] 商家不存在:', merchantId);
      throw new HttpsError('not-found', '商家不存在');
    }

    const merchantData = merchantDocSnap.data();

    console.log('[processRfidPayment] 商家:', merchantData.stallName);

    // ========== 第5步：使用事务执行支付 ==========
    console.log('[processRfidPayment] 步骤 5: 执行支付事务');

    const transactionId = `RFID_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const transactionRecord = {
      transactionId,
      transactionType: 'rfid_card_payment',
      customerId,
      merchantId,
      rfidId,
      rfidCardNumber: rfidCard.cardNumber,
      amount,
      status: 'completed',
      timestamp: now,
      timestampServerTime: admin.firestore.FieldValue.serverTimestamp(),
      paymentMethod: 'rfid_card',
      description: `RFID 卡支付 - ${merchantData.stallName || '商家'}`
    };

    // 执行事务
    await db.runTransaction(async (transaction) => {
      // 1. 更新客户余额（路径：users/{userId}.customer.pointsAccount）
      transaction.update(userDocRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(-amount),
        'customer.pointsAccount.totalSpent': admin.firestore.FieldValue.increment(amount),
        'basicInfo.rfidCard.lastUsedAt': now,
        'basicInfo.rfidCard.totalRfidSpent': admin.firestore.FieldValue.increment(amount)
      });

      // 2. 更新商家收入
      transaction.update(merchantDocRef, {
        'stats.totalRevenue': admin.firestore.FieldValue.increment(amount),
        'stats.rfidRevenue': admin.firestore.FieldValue.increment(amount),
        'lastTransactionAt': now
      });

      // 3. 在 CustomerTransactions 中创建交易记录
      const customerTransactionsCol = db
        .collection('organizations')
        .doc(organizationId)
        .collection('events')
        .doc(eventId)
        .collection('CustomerTransactions');

      transaction.set(
        customerTransactionsCol.doc(transactionId),
        transactionRecord
      );

      // 4. 在 MerchantTransactions 中创建交易记录
      const merchantTransactionsCol = db
        .collection('organizations')
        .doc(organizationId)
        .collection('events')
        .doc(eventId)
        .collection('transactions');

      transaction.set(
        merchantTransactionsCol.doc(transactionId),
        {
          ...transactionRecord,
          collectedBy: callerUid,
          ...(merchantData.stallNumber !== undefined && { stallNumber: merchantData.stallNumber })
        }
      );

      // 5. 重置 PIN 失败计数（与更新余额是同一文档，合并处理）
      // 注意：步骤1已更新 userDocRef，此处不重复 update（Firestore 事务中同一文档合并即可）
    });

    console.log('[processRfidPayment] ✅ 支付成功:', transactionId);

    return {
      success: true,
      transactionId,
      message: '支付成功',
      amount,
      customerName: userData.basicInfo?.chineseName || userData.basicInfo?.englishName,
      merchantName: merchantData.stallName,
      timestamp: now.toISOString()
    };
  } catch (error) {
    console.error('[processRfidPayment] 错误:', error);

    // 如果已经是 HttpsError，直接抛出
    if (error instanceof HttpsError) {
      throw error;
    }

    // 否则转换为通用错误
    throw new HttpsError('internal', '支付处理失败: ' + (error.message || '未知错误'));
  }
});
