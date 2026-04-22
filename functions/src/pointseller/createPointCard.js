/**
 * Create Point Card Cloud Function - v5.2 (Updated: 2026-04-10)
 * 创建点数卡，同时写入 pointCards + transactions 集合
 *
 * 变更 (v5.2)：
 * 1. ✅ 创建 pointCards 集合文档（Merchant 查询余额用）
 * 2. ✅ 创建 transactions 集合文档（交易追踪用）
 * 3. ✅ 返回 cardId 和 cardNumber（QR Code 生成用）
 * 
 * 原有变更 (v5.0)：
 * 1. 同时写入 transactions 集合（transactionType: pointseller_card_issuance）
 * 2. 用于统一的交易追踪和数据合并
 * 
 * 原有变更 (v4.0)：
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

        // 7.3 生成 receiptNumber 和 transactionId
        const receiptNumber = generateReceiptNumber(); // RC-YYYYMMDD-XXXX
        const now = admin.firestore.FieldValue.serverTimestamp();

        // 7.4 只写入 transactions 集合用于统一交易追踪
        // ✅ v5.1：已删除 pointSellerSales 写入（架构优化：只用 transactions 追踪）
        // ⚠️ v5.0：新增 - 支持 PointSeller 销售历史的统一查询
        const transactionId = `card-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;  // 自动生成交易ID
        const cardNumber = generateCardSaleId();  // 生成卡号
        
        const transactionRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('transactions').doc(transactionId);

        const transactionData = {
          // === 交易基本信息 ===
          transactionId,
          transactionType: 'pointseller_card_issuance',  // ✅ v5.0：新增交易类型
          status: 'completed',
          
          // === 参与者 ===
          sellerId: pointSellerId,
          sellerType: 'pointSeller',
          sellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
          
          // === 交易金额 ===
          pointAmount: amount,      // 发行的点数
          cashAmount: cashReceived, // 收取的现金
          
          // === 时间戳（用于查询排序）===
          timestamp: now,  // ✅ 顶级 timestamp，用于前端查询排序
          
          // === 元数据 ===
          metadata: {
            createdAt: now,
            createdBy: pointSellerId,
            organizationId: orgId,
            eventId,
            version: '1.0',
            source: 'createPointCard'
          }
        };

        transaction.set(transactionRef, transactionData);

        // 7.5 创建 pointCards 集合文档（用于 Merchant 查询余额）
        const pointCardRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('pointCards').doc(transactionId);

        const pointCardData = {
          // === 点数卡基本信息 ===
          cardId: transactionId,
          cardNumber: cardNumber,
          
          // === 余额信息 ===
          balance: {
            initial: amount,      // 初始点数
            current: amount,      // 当前点数
            spent: 0,             // 已消费点数
            reserved: 0           // 预留点数
          },
          
          // === 状态信息 ===
          status: {
            isActive: true,       // 是否有效
            isExpired: false,      // 是否过期
            isDestroyed: false,    // 是否已销毁
            isEmpty: false,        // 是否为空
            expiresAt: expiresAt,  // 过期时间
            lastUsedAt: null       // 最后使用时间
          },
          
          // === 发行方信息 ===
          issuer: {
            pointSellerId: pointSellerId,
            pointSellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
            issuedAt: now
          },
          
          // === 交易ID关联 ===
          transactionId: transactionId,
          
          // === 版本和元数据 ===
          version: '1.0',
          createdAt: now,
          updatedAt: now
        };

        transaction.set(pointCardRef, pointCardData);

        // 7.7 更新 PointSeller 统计数据
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

          transaction.update(eventRef, {
            'globalPointsStats.totalSold': admin.firestore.FieldValue.increment(amount),
            'globalPointsStats.totalRevenue': admin.firestore.FieldValue.increment(cashReceived),
            'globalPointsStats.currentCirculation': admin.firestore.FieldValue.increment(amount),
            'globalPointsStats.lastUpdated': now,
            'financeSummary.points.totalFromPointCards': admin.firestore.FieldValue.increment(amount),
            'financeSummary.lastUpdatedAt': now,
            'financeSummary.lastUpdatedBy': pointSellerId,
            'roleStats.pointSellers.totalCardsIssued': admin.firestore.FieldValue.increment(1),
            'roleStats.pointSellers.totalPointsIssued': admin.firestore.FieldValue.increment(amount),
            'roleStats.pointSellers.totalCashReceived': admin.firestore.FieldValue.increment(cashReceived),
            'roleStats.pointSellers.lastUpdated': now
          });

        return {
          transactionId,
          cardId: transactionId,        // ✅ 新增：卡ID（用于QR Code和交易追踪）
          cardNumber: cardNumber,       // ✅ 新增：卡号显示（用户可见）
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