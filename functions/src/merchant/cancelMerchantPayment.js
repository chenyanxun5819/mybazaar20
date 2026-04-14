/**
 * cancelMerchantPayment.js
 * 取消交易 - merchantOwner 或 merchantAsist 取消待收的交易
 * 
 * ⭐ 修复版本（2026-02-19）
 * 修复内容：
 * 1. ✅ 修正交易字段名称：transactionType（不是 type）
 * 2. ✅ 修正 statusHistory 时间戳：使用 Date 对象
 * 3. ⭐ 新增 reservedPoints 处理（关键修复）
 * 4. ⭐ 修正 Merchant 字段路径（dailyRevenue.today）
 * 5. ⭐ 增强日志便于调试
 * 
 * 功能：
 * 1. 验证交易状态为 pending
 * 2. 验证调用者权限（merchantOwner 或 merchantAsist）
 * 3. 回滚 Customer 点数（availablePoints + reservedPoints）
 * 4. 回滚 Merchant 统计
 * 5. 更新交易状态为 cancelled
 * 6. 记录取消人信息
 * 
 * 注意：Customer 不能自己取消交易（防止欺诈）
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

exports.cancelMerchantPayment = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { organizationId, eventId, transactionId, cancelReason, transactionPin } = data;

    console.log('[cancelMerchantPayment] 收到取消请求:', {
      organizationId,
      eventId,
      transactionId,
      callerUid: auth.uid,
      hasCancelReason: !!cancelReason
    });

    // ========== 3. 验证必填参数 ==========
    if (!organizationId || !eventId || !transactionId) {
      throw new HttpsError('invalid-argument', '缺少必填参数');
    }

    // ========== 3.5. 验证交易密码格式 ==========
    if (!transactionPin || !/^\d{6}$/.test(transactionPin)) {
      throw new HttpsError('invalid-argument', '请输入6位数字交易密码');
    }

    const db = admin.firestore();

    // ========== 4. 获取交易文档 ==========
    const transactionRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('transactions').doc(transactionId);

    const transactionDoc = await transactionRef.get();

    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', '交易不存在');
    }

    const transactionData = transactionDoc.data();

    // ========== 5. 验证交易状态 ==========
    if (transactionData.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `交易状态为 ${transactionData.status}，无法取消`
      );
    }

    // ========== 6. 验证交易类型 ==========
    if (transactionData.transactionType !== 'customer_to_merchant') {
      throw new HttpsError('invalid-argument', '交易类型错误');
    }

    // ========== 7. 获取调用者用户信息 ==========
    const callerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(auth.uid);

    const callerDoc = await callerRef.get();

    if (!callerDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    const callerData = callerDoc.data();
    const callerRoles = callerData.roles || [];

    // ========== 8. 验证权限（只有 merchantOwner 或 merchantAsist 可以取消）==========
    const isMerchantOwner = callerRoles.includes('merchantOwner');
    const isMerchantAsist = callerRoles.includes('merchantAsist');

    if (!isMerchantOwner && !isMerchantAsist) {
      throw new HttpsError('permission-denied', '只有商家摊主或助理可以取消交易');
    }

    // 获取调用者的 merchantId
    let callerMerchantId;
    let cancellerRole;

    if (isMerchantOwner) {
      callerMerchantId = callerData.merchantOwner?.merchantId;
      cancellerRole = 'merchantOwner';
    } else if (isMerchantAsist) {
      callerMerchantId = callerData.merchantAsist?.merchantId;
      cancellerRole = 'merchantAsist';
    }

    if (!callerMerchantId) {
      throw new HttpsError('failed-precondition', '用户未关联到商家');
    }

    // 验证交易是否属于该商家
    if (transactionData.merchantId !== callerMerchantId) {
      throw new HttpsError('permission-denied', '此交易不属于您的商家');
    }

    // ========== 8.5. 验证交易密码 ==========
    await verifyTransactionPin(auth.uid, transactionPin, organizationId, eventId);

    // ========== 9. 取消交易并回滚点数/统计 ==========
    const amount = Number(transactionData.amount) || 0;
    if (amount <= 0) {
      throw new HttpsError('failed-precondition', '交易金额无效');
    }

    // ⭐ 新增：详细日志
    console.log('[cancelMerchantPayment] 准备取消交易:', {
      transactionId,
      amount,
      merchantId: transactionData.merchantId,
      customerId: transactionData.customerId,
      cancellerRole,
      cancelReason: cancelReason || '商家取消'
    });

    const customerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(transactionData.customerId);

    const merchantRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('merchants').doc(transactionData.merchantId);

    const now = new Date();

    await db.runTransaction(async (transaction) => {
      const [txDoc, customerDoc, merchantDoc] = await Promise.all([
        transaction.get(transactionRef),
        transaction.get(customerRef),
        transaction.get(merchantRef)
      ]);

      if (!txDoc.exists) {
        throw new HttpsError('not-found', '交易不存在');
      }

      const latestTx = txDoc.data();
      if (latestTx.status !== 'pending') {
        throw new HttpsError('failed-precondition', `交易状态为 ${latestTx.status}，无法取消`);
      }

      if (!customerDoc.exists) {
        throw new HttpsError('not-found', '顾客不存在');
      }

      if (!merchantDoc.exists) {
        throw new HttpsError('not-found', '商家不存在');
      }

      // ⭐ 新增：获取当前点数状态用于日志
      const customerData = customerDoc.data();
      const currentAvailable = customerData.customer?.pointsAccount?.availablePoints || 0;
      const currentReserved = customerData.customer?.pointsAccount?.reservedPoints || 0;

      console.log('[cancelMerchantPayment] Customer 当前点数状态:', {
        customerId: transactionData.customerId,
        availablePoints: currentAvailable,
        reservedPoints: currentReserved,
        refundAmount: amount
      });

      // ========================================
      // ⭐ 关键修复：回滚 Customer 点数（包含 reservedPoints）
      // ========================================
      transaction.update(customerRef, {
        // ✅ 加回可用点数
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(amount),
        // ⭐ 释放预留点数（关键修复）
        'customer.pointsAccount.reservedPoints': admin.firestore.FieldValue.increment(-amount),
        // ✅ 减少累计消费
        'customer.pointsAccount.totalSpent': admin.firestore.FieldValue.increment(-amount),
        // ✅ 更新统计
        'customer.stats.transactionCount': admin.firestore.FieldValue.increment(-1),
        'customer.stats.merchantPaymentCount': admin.firestore.FieldValue.increment(-1),
        'customer.stats.lastActivityAt': admin.firestore.FieldValue.serverTimestamp()
      });

      console.log('[cancelMerchantPayment] Customer 点数回滚后:', {
        availablePoints: currentAvailable + amount,
        reservedPoints: Math.max(0, currentReserved - amount)
      });

      // ========================================
      // ⭐ 关键修复：回滚 Merchant 统计（修正字段路径）
      // ========================================
      const merchantData = merchantDoc.data();
      const currentTotalRevenue = merchantData.revenueStats?.totalRevenue || 0;
      const currentTodayRevenue = merchantData.dailyRevenue?.today || 0;

      console.log('[cancelMerchantPayment] Merchant 当前统计:', {
        merchantId: transactionData.merchantId,
        totalRevenue: currentTotalRevenue,
        todayRevenue: currentTodayRevenue,
        refundAmount: amount
      });

      transaction.update(merchantRef, {
        // ✅ 减少总收入
        'revenueStats.totalRevenue': admin.firestore.FieldValue.increment(-amount),
        'revenueStats.transactionCount': admin.firestore.FieldValue.increment(-1),
        'dailyRevenue.today': admin.firestore.FieldValue.increment(-amount),
        'dailyRevenue.todayTransactionCount': admin.firestore.FieldValue.increment(-1),
        'metadata.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // ========================================
      // ⭐ 新增（2026-02-27）：回滚 Event 层级汇总统计
      // 与 processCustomerPayment 的增量操作完全对称
      // ========================================
      const eventRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId);

      transaction.update(eventRef, {
        'financeSummary.points.totalSpent': admin.firestore.FieldValue.increment(-amount),
        'roleStats.customers.totalSpent':   admin.firestore.FieldValue.increment(-amount),
        'roleStats.merchants.totalRevenue': admin.firestore.FieldValue.increment(-amount),
      });

      // ========================================
      // 更新交易状态
      // ========================================
      transaction.update(transactionRef, {
        status: 'cancelled',
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        cancelledBy: auth.uid,
        cancellerRole: cancellerRole,
        cancelReason: cancelReason || '商家取消',
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status: 'cancelled',
          timestamp: now,
          updatedBy: auth.uid,
          updaterRole: cancellerRole,
          note: cancelReason || '商家取消'
        })
      });
    });

    console.log('[cancelMerchantPayment] ✅ 取消成功:', {
      transactionId,
      amount,
      cancellerRole,
      cancellerUid: auth.uid
    });

    // ========== 10. 返回成功 ==========
    return {
      success: true,
      message: '交易已取消，点数已退回顾客',
      transactionId,
      refundedAmount: amount,
      cancelledBy: auth.uid,
      cancellerRole
    };

  } catch (error) {
    console.error('[cancelMerchantPayment] ❌ 取消失败:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '取消交易失败，请重试');
  }
});