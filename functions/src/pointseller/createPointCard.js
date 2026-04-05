/**
 * Create Point Card Cloud Function - v4.0
 * 创建点数卡，写入统一销售集合 pointSellerSales
 *
 * 变更：
 * 1. 集合从 pointCards 改为 pointSellerSales
 * 2. 文档ID 改为 card-YYYYMMDD-XXXXX（与 saleNumber 相同）
 * 3. 数据结构对齐新架构（saleType='card'，card 子对象）
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

// 生成销售ID（文档ID）和销售编号：card-YYYYMMDD-XXXXX
function generateCardSaleId() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const randomStr = Math.random().toString(36).slice(2, 7).toUpperCase(); // 5位随机大写字母
  return `card-${dateStr}-${randomStr}`;
}

// 生成收据编号：RC-YYYYMMDD-XXXX
function generateReceiptNumber() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const timeStr = now.getTime().toString().slice(-4); // 后4位时间戳
  return `RC-${dateStr}-${timeStr}`;
}

exports.createPointCard = onCall({ region: 'asia-southeast1' }, async (request) => {
    // 1. 身份验证
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '用户未登录');
    }

    const { orgId, eventId, amount, cashReceived, transactionPin, note } = request.data;
    const pointSellerId = request.auth.uid;

    // 2. 参数验证
    if (!orgId || !eventId || !amount || cashReceived === undefined) {
      throw new HttpsError('invalid-argument', '缺少必要参数');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw new HttpsError('invalid-argument', '金额必须大于 0');
    }

    if (typeof cashReceived !== 'number' || cashReceived < 0) {
      throw new HttpsError('invalid-argument', '现金金额无效');
    }

    // 3. 单笔限额验证
    const MAX_PER_TRANSACTION = 100;
    if (amount > MAX_PER_TRANSACTION) {
      throw new HttpsError(
        'invalid-argument',
        `单笔发行不能超过 ${MAX_PER_TRANSACTION} 点`
      );
    }

    // 4. 验证交易密码
    await verifyTransactionPin(pointSellerId, transactionPin, orgId, eventId);

    const db = admin.firestore();

    // 6. 获取 PointSeller 引用
    const pointSellerRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId)
      .collection('users').doc(pointSellerId);

    // 获取 Event 信息（用于过期时间）
    const eventRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId);

    // 7. 使用事务创建点数卡销售记录
    try {
      const result = await db.runTransaction(async (transaction) => {
        // 7.1 读取 PointSeller 数据
        const pointSellerDoc = await transaction.get(pointSellerRef);
        if (!pointSellerDoc.exists) {
          throw new HttpsError('not-found', 'PointSeller 不存在');
        }

        const pointSellerData = pointSellerDoc.data();

        // 验证角色
        if (!pointSellerData.roles || !pointSellerData.roles.includes('pointSeller')) {
          throw new HttpsError('permission-denied', '用户不是 PointSeller');
        }

        // 7.2 读取 Event 数据（获取过期时间）
        const eventDoc = await transaction.get(eventRef);
        let expiresAt = null;
        if (eventDoc.exists) {
          expiresAt = eventDoc.data().endDate || null;
        }

        // 7.3 生成 saleId（文档ID = 销售编号）和收据编号
        const saleId = generateCardSaleId();           // card-YYYYMMDD-XXXXX
        const receiptNumber = generateReceiptNumber(); // RC-YYYYMMDD-XXXX

        // 7.4 写入 pointSellerSales 集合
        const saleRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('pointSellerSales').doc(saleId);

        const now = admin.firestore.FieldValue.serverTimestamp();

        const saleData = {
          // === 基本信息 ===
          saleId,
          saleNumber: saleId,           // 人类可读编号，与文档ID相同
          saleType: 'card',
          organizationId: orgId,
          eventId,

          // === 金额信息 ===
          amount,
          cashReceived,

          // === 发行人信息 ===
          issuer: {
            pointSellerId,
            pointSellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
            issuedAt: now,
            receiptNumber,
            note: note || ''
          },

          // === card 类型专属字段 ===
          card: {
            balance: {
              initial: amount,
              current: amount,
              spent: 0,
              reserved: 0
            },
            status: {
              isActive: true,
              isExpired: false,
              isDestroyed: false,
              isEmpty: false,
              expiresAt,
              lastUsedAt: null,
              destroyedAt: null,
              destroyedBy: null
            },
            qrCodeData: {
              type: 'POINT_CARD',
              version: '1.0',
              saleId,
              eventId,
              organizationId: orgId,
              generatedAt: now
            },
            usageStats: {
              transactionCount: 0,
              merchantsUsed: [],
              firstUsedAt: null,
              lastUsedAt: null
            }
          },

          // === 元数据 ===
          metadata: {
            createdAt: now,
            updatedAt: now,
            createdBy: pointSellerId,
            version: '1.0',
            source: 'createPointCard',
            eventId,
            organizationId: orgId
          }
        };

        transaction.set(saleRef, saleData);

        // 7.5 更新 PointSeller 统计数据
        const updateData = {
          // --- 点数卡（card）当日 ---
          'pointSeller.todayStats.cardCount':   admin.firestore.FieldValue.increment(1),
          'pointSeller.todayStats.cardPoints':  admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.cardCash':    admin.firestore.FieldValue.increment(cashReceived),
          // --- 合计当日 ---
          'pointSeller.todayStats.totalPoints': admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.totalCash':   admin.firestore.FieldValue.increment(cashReceived),
          'pointSeller.todayStats.lastSaleAt':  now,

          // --- 点数卡（card）累计 ---
          'pointSeller.totalStats.totalCardCount':  admin.firestore.FieldValue.increment(1),
          'pointSeller.totalStats.totalCardPoints': admin.firestore.FieldValue.increment(amount),
          'pointSeller.totalStats.totalCardCash':   admin.firestore.FieldValue.increment(cashReceived),
          // --- 合计累计 ---
          'pointSeller.totalStats.totalPoints': admin.firestore.FieldValue.increment(amount),
          'pointSeller.totalStats.totalCash':   admin.firestore.FieldValue.increment(cashReceived),

          'pointSeller.cashManagement.cashOnHand':        admin.firestore.FieldValue.increment(cashReceived),
          'pointSeller.cashManagement.pendingSubmission': admin.firestore.FieldValue.increment(cashReceived),

          'updatedAt': now
        };

        if (!pointSellerData.pointSeller?.todayStats?.firstSaleAt) {
          updateData['pointSeller.todayStats.firstSaleAt'] = now;
        }

        transaction.update(pointSellerRef, updateData);

        return {
          saleId,
          saleNumber: saleId,
          receiptNumber,
          amount,
          cashReceived,
          issuer: {
            pointSellerId,
            pointSellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
            cashReceived,
            receiptNumber
          }
        };
      });

      return {
        success: true,
        data: result,
        message: '点数卡创建成功'
      };

    } catch (error) {
      console.error('[createPointCard] 创建点数卡失败:', error);

      if (error.code) {
        throw error;
      }

      throw new HttpsError('internal', `创建失败: ${error.message}`);
    }
  });