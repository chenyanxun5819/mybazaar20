/**
 * Point Seller Direct Sale Cloud Function - v5.0
 * PointSeller 直接销售点数给 Customer（手机直销）
 *
 * 变更（v5.0）：
 * 1. pointSeller 统计字段全面重构为 card/mobile 前缀命名
 * 2. todayStats：mobileCount / mobilePoints / mobileCash / totalPoints / totalCash / lastSaleAt / firstSaleAt
 * 3. totalStats：totalMobileCount / totalMobilePoints / totalMobileCash / totalPoints / totalCash
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

// 生成销售ID（文档ID）和销售编号：cash-YYYYMMDD-XXXXX
function generateCashSaleId() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const randomStr = Math.random().toString(36).slice(2, 7).toUpperCase(); // 5位随机大写字母
  return `cash-${dateStr}-${randomStr}`;
}

// 生成收据编号：RC-YYYYMMDD-XXXX
function generateReceiptNumber() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const timeStr = now.getTime().toString().slice(-4); // 后4位时间戳
  return `RC-${dateStr}-${timeStr}`;
}

exports.pointSellerDirectSale = onCall({ region: 'asia-southeast1' }, async (request) => {
    // 1. 身份验证
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '用户未登录');
    }

    const { orgId, eventId, customerId, amount, transactionPin, note } = request.data;
    const pointSellerId = request.auth.uid;

    // 2. 参数验证
    if (!orgId || !eventId || !customerId || !amount) {
      throw new HttpsError('invalid-argument', '缺少必要参数');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw new HttpsError('invalid-argument', '金额必须大于 0');
    }

    // 3. 单笔限额验证
    const MAX_PER_TRANSACTION = 100;
    if (amount > MAX_PER_TRANSACTION) {
      throw new HttpsError(
        'invalid-argument',
        `单笔销售不能超过 ${MAX_PER_TRANSACTION} 点`
      );
    }

    // 4. 验证交易密码
    await verifyTransactionPin(pointSellerId, transactionPin, orgId, eventId);

    const db = admin.firestore();

    const pointSellerRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId)
      .collection('users').doc(pointSellerId);

    const customerRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId)
      .collection('users').doc(customerId);

    try {
      const result = await db.runTransaction(async (transaction) => {
        // 7.1 读取 PointSeller 数据
        const pointSellerDoc = await transaction.get(pointSellerRef);
        if (!pointSellerDoc.exists) {
          throw new HttpsError('not-found', 'PointSeller 不存在');
        }

        const pointSellerData = pointSellerDoc.data();

        if (!pointSellerData.roles || !pointSellerData.roles.includes('pointSeller')) {
          throw new HttpsError('permission-denied', '用户不是 PointSeller');
        }

        // 7.2 读取 Customer 数据
        const customerDoc = await transaction.get(customerRef);
        if (!customerDoc.exists) {
          throw new HttpsError('not-found', '客户不存在');
        }

        const customerData = customerDoc.data();

        if (!customerData.roles || !customerData.roles.includes('customer')) {
          throw new HttpsError('permission-denied', '目标用户不是客户');
        }

        const now = admin.firestore.FieldValue.serverTimestamp();
        const customerBalanceBefore = customerData.customer?.pointsAccount?.availablePoints || 0;
        const customerName = customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName || 'Customer';
        const customerPhone = customerData.basicInfo?.phoneNumber || '';
        const pointSellerName = pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller';

        // 7.3 生成 ID
        const transactionId = `PS2C_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const saleId = generateCashSaleId();           // cash-YYYYMMDD-XXXXX
        const receiptNumber = generateReceiptNumber(); // RC-YYYYMMDD-XXXX

        // 7.4 创建 transactions 交易记录
        const transactionRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('transactions').doc(transactionId);

        transaction.set(transactionRef, {
          transactionId,
          type: 'pointseller_to_customer',
          organizationId: orgId,
          eventId,

          sellerId: pointSellerId,
          sellerName: pointSellerName,
          sellerRole: 'pointSeller',

          customerId,
          customerName,

          amount,
          points: amount,
          note: note || '',

          sellerBalanceBefore: 0,
          sellerBalanceAfter: 0,
          customerBalanceBefore,
          customerBalanceAfter: customerBalanceBefore + amount,

          timestamp: now,
          status: 'completed',

          metadata: {
            createdAt: now,
            source: 'pointSellerDirectSale'
          }
        });

        // 7.5 写入 pointSellerSales 集合（saleType='cash'）
        const saleRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('pointSellerSales').doc(saleId);

        transaction.set(saleRef, {
          // === 基本信息 ===
          saleId,
          saleNumber: saleId,
          saleType: 'cash',
          organizationId: orgId,
          eventId,

          // === 金额信息 ===
          amount,
          cashReceived: amount, // 直接销售：现金金额 = 点数金额（1:1）

          // === 发行人信息 ===
          issuer: {
            pointSellerId,
            pointSellerName,
            issuedAt: now,
            receiptNumber,
            note: note || ''
          },

          // === cash 类型专属字段 ===
          cash: {
            customerId,
            customerName,
            customerPhone,
            transactionId
          },

          // === 元数据 ===
          metadata: {
            createdAt: now,
            updatedAt: now,
            createdBy: pointSellerId,
            version: '1.0',
            source: 'pointSellerDirectSale',
            eventId,
            organizationId: orgId
          }
        });

        // 7.6 更新 Customer 点数
        transaction.update(customerRef, {
          'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(amount),
          'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(amount),
          'customer.pointsAccount.lastTransactionAt': now,
          'updatedAt': now
        });

        // 7.7 更新 PointSeller 统计数据
        const updateData = {
          // --- 手机直销（mobile）当日 ---
          'pointSeller.todayStats.mobileCount': admin.firestore.FieldValue.increment(1),
          'pointSeller.todayStats.mobilePoints': admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.mobileCash': admin.firestore.FieldValue.increment(amount),
          // --- 合计当日 ---
          'pointSeller.todayStats.totalPoints': admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.totalCash': admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.lastSaleAt': now,

          // --- 手机直销（mobile）累计 ---
          'pointSeller.totalStats.totalMobileCount': admin.firestore.FieldValue.increment(1),
          'pointSeller.totalStats.totalMobilePoints': admin.firestore.FieldValue.increment(amount),
          'pointSeller.totalStats.totalMobileCash': admin.firestore.FieldValue.increment(amount),
          // --- 合计累计 ---
          'pointSeller.totalStats.totalPoints': admin.firestore.FieldValue.increment(amount),
          'pointSeller.totalStats.totalCash': admin.firestore.FieldValue.increment(amount),

          'pointSeller.cashManagement.cashOnHand': admin.firestore.FieldValue.increment(amount),
          'pointSeller.cashManagement.pendingSubmission': admin.firestore.FieldValue.increment(amount),

          'updatedAt': now
        };

        if (!pointSellerData.pointSeller?.todayStats?.firstSaleAt) {
          updateData['pointSeller.todayStats.firstSaleAt'] = now;
        }

        transaction.update(pointSellerRef, updateData);

        return {
          transactionId,
          saleId,
          saleNumber: saleId,
          receiptNumber,
          amount,
          customerBalanceAfter: customerBalanceBefore + amount
        };
      });

      return {
        success: true,
        data: result,
        message: '销售成功'
      };

    } catch (error) {
      console.error('[pointSellerDirectSale] 销售失败:', error);

      if (error.code) {
        throw error;
      }

      throw new HttpsError('internal', `销售失败: ${error.message}`);
    }
  });