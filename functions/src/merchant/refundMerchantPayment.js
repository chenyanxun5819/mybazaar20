/**
 * refundMerchantPayment.js
 * 退款 - 仅 merchantOwner 可以退款已完成的交易
 * 
 * 功能：
 * 1. 验证交易状态为 completed
 * 2. 验证调用者权限（仅 merchantOwner）
 * 3. 退回 customer 点数
 * 4. 扣除 merchant 收入统计
 * 5. 扣除收款人统计
 * 6. 更新交易状态为 refunded
 * 
 * 注意：merchantAsist 不能退款
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.refundMerchantPayment = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { organizationId, eventId, transactionId, refundReason } = data;

    console.log('[refundMerchantPayment] 收到退款请求:', {
      organizationId,
      eventId,
      transactionId,
      callerUid: auth.uid,
      hasRefundReason: !!refundReason
    });

    // ========== 3. 验证必填参数 ==========
    if (!organizationId || !eventId || !transactionId || !refundReason) {
      throw new HttpsError('invalid-argument', '缺少必填参数（退款原因必填）');
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
    if (transactionData.status !== 'completed') {
      throw new HttpsError(
        'failed-precondition',
        `交易状态为 ${transactionData.status}，只能退款已完成的交易`
      );
    }

    // ========== 6. 验证交易类型 ==========
    if (transactionData.type !== 'customer_to_merchant') {
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

    // ========== 8. 验证权限（仅 merchantOwner 可以退款）==========
    const isMerchantOwner = callerRoles.includes('merchantOwner');

    if (!isMerchantOwner) {
      throw new HttpsError('permission-denied', '只有商家摊主可以退款');
    }

    // 获取调用者的 merchantId
    const callerMerchantId = callerData.merchantOwner?.merchantId;

    if (!callerMerchantId) {
      throw new HttpsError('failed-precondition', '用户未关联到商家');
    }

    // 验证交易是否属于该商家
    if (transactionData.merchantId !== callerMerchantId) {
      throw new HttpsError('permission-denied', '此交易不属于您的商家');
    }

    // ========== 9. 获取 Customer 和 Merchant 文档 ==========
    const customerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(transactionData.customerId);

    const merchantRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('merchants').doc(transactionData.merchantId);

    const [customerDoc, merchantDoc] = await Promise.all([
      customerRef.get(),
      merchantRef.get()
    ]);

    if (!customerDoc.exists) {
      throw new HttpsError('not-found', '顾客不存在');
    }

    if (!merchantDoc.exists) {
      throw new HttpsError('not-found', '商家不存在');
    }

    const customerData = customerDoc.data();
    const merchantData = merchantDoc.data();
    const amount = transactionData.amount;
    const collectorRole = transactionData.collectorRole;
    const collectedBy = transactionData.collectedBy;

    // ========== 10. 使用事务执行操作 ==========
    await db.runTransaction(async (transaction) => {
      // 10.1 退回 Customer 点数
      const newCustomerBalance = (customerData.customer?.availablePoints || 0) + amount;
      const newCustomerTotalSpent = Math.max(0, (customerData.customer?.totalPointsSpent || 0) - amount);

      transaction.update(customerRef, {
        'customer.availablePoints': newCustomerBalance,
        'customer.totalPointsSpent': newCustomerTotalSpent,
        'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 10.2 扣除 Merchant 收入
      const newTotalRevenue = Math.max(0, (merchantData.revenueStats?.totalRevenue || 0) - amount);
      const newTransactionCount = Math.max(0, (merchantData.revenueStats?.transactionCount || 0) - 1);
      const newTodayRevenue = Math.max(0, (merchantData.dailyRevenue?.today || 0) - amount);
      const newTodayTransactionCount = Math.max(0, (merchantData.dailyRevenue?.todayTransactionCount || 0) - 1);

      // 10.3 根据原收款人角色扣除分类收入
      let ownerUpdate = {};
      let asistUpdate = {};

      if (collectorRole === 'merchantOwner') {
        const newOwnerRevenue = Math.max(0, (merchantData.revenueStats?.ownerCollectedRevenue || 0) - amount);
        const newTodayOwnerCollected = Math.max(0, (merchantData.dailyRevenue?.todayOwnerCollected || 0) - amount);
        ownerUpdate = {
          'revenueStats.ownerCollectedRevenue': newOwnerRevenue,
          'dailyRevenue.todayOwnerCollected': newTodayOwnerCollected
        };
      } else if (collectorRole === 'merchantAsist') {
        const newAsistsRevenue = Math.max(0, (merchantData.revenueStats?.asistsCollectedRevenue || 0) - amount);
        const newTodayAsistsCollected = Math.max(0, (merchantData.dailyRevenue?.todayAsistsCollected || 0) - amount);
        asistUpdate = {
          'revenueStats.asistsCollectedRevenue': newAsistsRevenue,
          'dailyRevenue.todayAsistsCollected': newTodayAsistsCollected
        };
      }

      transaction.update(merchantRef, {
        'revenueStats.totalRevenue': newTotalRevenue,
        'revenueStats.transactionCount': newTransactionCount,
        'dailyRevenue.today': newTodayRevenue,
        'dailyRevenue.todayTransactionCount': newTodayTransactionCount,
        ...ownerUpdate,
        ...asistUpdate,
        'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });

      // 10.4 更新交易状态
      transaction.update(transactionRef, {
        status: 'refunded',
        refundedAt: admin.firestore.FieldValue.serverTimestamp(),
        refundedBy: auth.uid,
        refundReason: refundReason,
        statusHistory: admin.firestore.FieldValue.arrayUnion({
          status: 'refunded',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: auth.uid,
          updaterRole: 'merchantOwner',
          note: refundReason
        })
      });

      // 10.5 扣除原收款人统计（如果是 merchantAsist）
      if (collectorRole === 'merchantAsist' && collectedBy) {
        const collectorRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(collectedBy);

        const collectorDoc = await collectorRef.get();

        if (collectorDoc.exists) {
          const collectorData = collectorDoc.data();
          const newPersonalTotal = Math.max(0, (collectorData.merchantAsist?.statistics?.totalCollected || 0) - amount);
          const newPersonalCount = Math.max(0, (collectorData.merchantAsist?.statistics?.transactionCount || 0) - 1);
          const newPersonalToday = Math.max(0, (collectorData.merchantAsist?.statistics?.todayCollected || 0) - amount);
          const newPersonalTodayCount = Math.max(0, (collectorData.merchantAsist?.statistics?.todayTransactionCount || 0) - 1);

          transaction.update(collectorRef, {
            'merchantAsist.statistics.totalCollected': newPersonalTotal,
            'merchantAsist.statistics.transactionCount': newPersonalCount,
            'merchantAsist.statistics.todayCollected': newPersonalToday,
            'merchantAsist.statistics.todayTransactionCount': newPersonalTodayCount,
            'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    });

    console.log('[refundMerchantPayment] 退款成功:', {
      transactionId,
      amount,
      refundedBy: auth.uid,
      refundReason
    });

    // ========== 11. 返回成功 ==========
    return {
      success: true,
      message: '退款成功',
      transactionId,
      amount,
      refundedBy: auth.uid,
      newCustomerBalance: (customerData.customer?.availablePoints || 0) + amount
    };

  } catch (error) {
    console.error('[refundMerchantPayment] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '退款失败，请重试');
  }
});
