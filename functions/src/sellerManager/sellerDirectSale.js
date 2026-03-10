/**
 * Seller Direct Sale Cloud Function
 * Seller 直接销售点数给 Customer（含交易密码验证）
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

exports.sellerDirectSale = onCall({ region: 'asia-southeast1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '用户未登录');
  }

  const { orgId, eventId, customerId, amount, transactionPin, note } = request.data;
  const sellerId = request.auth.uid;

  if (!orgId || !eventId || !customerId || !amount || !transactionPin) {
    throw new HttpsError('invalid-argument', '缺少必要参数');
  }

  if (typeof amount !== 'number' || amount <= 0) {
    throw new HttpsError('invalid-argument', '金额必须大于 0');
  }

  if (!/^\d{6}$/.test(transactionPin)) {
    throw new HttpsError('invalid-argument', '交易密码必须是6位数字');
  }

  await verifyTransactionPin(sellerId, transactionPin, orgId, eventId);

  const db = admin.firestore();
  const sellerRef = db
    .collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(sellerId);

  const customerRef = db
    .collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(customerId);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const sellerDoc = await transaction.get(sellerRef);
      if (!sellerDoc.exists) {
        throw new HttpsError('not-found', 'Seller 不存在');
      }

      const sellerData = sellerDoc.data();
      if (!sellerData.roles || !sellerData.roles.includes('seller')) {
        throw new HttpsError('permission-denied', '用户不是 Seller');
      }

      const sellerBalanceBefore = sellerData.seller?.availablePoints || 0;
      if (sellerBalanceBefore < amount) {
        throw new HttpsError('failed-precondition', `点数库存不足，当前仅有 ${sellerBalanceBefore} 点`);
      }

      const customerDoc = await transaction.get(customerRef);
      if (!customerDoc.exists) {
        throw new HttpsError('not-found', '客户不存在');
      }

      const customerData = customerDoc.data();
      if (!customerData.roles || !customerData.roles.includes('customer')) {
        throw new HttpsError('permission-denied', '目标用户不是客户');
      }

      const customerBalanceBefore = customerData.customer?.pointsAccount?.availablePoints || 0;
      const transactionId = `S2C_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const transactionRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('transactions').doc(transactionId);

      const now = admin.firestore.FieldValue.serverTimestamp();

      transaction.set(transactionRef, {
        transactionId,
        type: 'seller_to_customer',
        organizationId: orgId,
        eventId,
        sellerId,
        sellerName: sellerData.basicInfo?.chineseName || sellerData.basicInfo?.englishName || 'Seller',
        sellerRole: 'seller',
        customerId,
        customerName: customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName || 'Customer',
        amount,
        points: amount,
        paymentMethod: 'cash',
        status: 'completed',
        note: note || '',
        sellerBalanceBefore,
        sellerBalanceAfter: sellerBalanceBefore - amount,
        customerBalanceBefore,
        customerBalanceAfter: customerBalanceBefore + amount,
        timestamp: now,
        createdAt: now,
        metadata: {
          source: 'sellerDirectSale',
          createdAt: now
        }
      });

      transaction.update(sellerRef, {
        'seller.availablePoints': admin.firestore.FieldValue.increment(-amount),
        'seller.totalPointsSold': admin.firestore.FieldValue.increment(amount),
        'seller.totalRevenue': admin.firestore.FieldValue.increment(amount),
        'seller.totalCashCollected': admin.firestore.FieldValue.increment(amount),
        'seller.pendingCollection': admin.firestore.FieldValue.increment(amount),
        'seller.lastSaleAt': now,
        updatedAt: now
      });

      transaction.update(customerRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(amount),
        'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(amount),
        'customer.pointsAccount.lastTransactionAt': now,
        updatedAt: now
      });

      // ⭐ 新增（2026-02-27）：更新 Event 层级全局统计
      // Seller 销售给 Customer = 已售出，计入 totalSold
      const eventRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId);

      transaction.update(eventRef, {
        'globalPointsStats.totalSold':     admin.firestore.FieldValue.increment(amount),
        'globalPointsStats.lastUpdated':   admin.firestore.FieldValue.serverTimestamp(),
        'financeSummary.points.totalSold': admin.firestore.FieldValue.increment(amount)
      });

      return {
        transactionId,
        amount,
        sellerBalanceAfter: sellerBalanceBefore - amount,
        customerBalanceAfter: customerBalanceBefore + amount
      };
    });

    return {
      success: true,
      data: result,
      message: '销售成功'
    };
  } catch (error) {
    console.error('[sellerDirectSale] 销售失败:', error);

    if (error.code) {
      throw error;
    }

    throw new HttpsError('internal', `销售失败: ${error.message}`);
  }
});