/**
 * Create Point Card Cloud Function - 修复版 v3.0
 * 创建点数卡
 * 
 * 修复：
 * 1. 修正数据结构与 Firestore 架构一致
 * 2. balance.spent 代替 balance.used
 * 3. 添加完整的 status 字段
 * 4. 添加 issuer.receiptNumber
 * 5. 修正 pointSeller 统计字段
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

// 生成卡号：CARD-YYYYMMDD-XXXXX
function generateCardNumber() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase(); // 5位随机字符
  return `CARD-${dateStr}-${randomStr}`;
}

// 生成收据编号
function generateReceiptNumber(orgId, eventId) {
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
    
    // 7. 使用事务创建点数卡
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

        // 7.2 读取 Event 数据
        const eventDoc = await transaction.get(eventRef);
        let expiresAt = null;
        if (eventDoc.exists) {
          const eventData = eventDoc.data();
          expiresAt = eventData.endDate || null;
        }
        
        // 7.3 生成卡号和相关编号
        const cardNumber = generateCardNumber();
        const cardId = `CARD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const receiptNumber = generateReceiptNumber(orgId, eventId);
        
        // 7.4 创建点数卡文档（按 Firestore 架构）
        const pointCardRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('pointCards').doc(cardId);
        
        const now = admin.firestore.FieldValue.serverTimestamp();
        
        const pointCardData = {
          // 基本信息
          cardId,
          cardNumber,
          organizationId: orgId,
          eventId: eventId,
          
          // 点数信息（✅ 使用 spent 而不是 used）
          balance: {
            initial: amount,
            current: amount,
            spent: 0,  // ✅ 修正：使用 spent
            reserved: 0
          },
          
          // 状态信息（✅ 完整的状态字段）
          status: {
            isActive: true,
            isExpired: false,
            isDestroyed: false,
            isEmpty: false,
            expiresAt: expiresAt,
            lastUsedAt: null,
            destroyedAt: null,
            destroyedBy: null
          },
          
          // QR Code 信息
          qrCodeData: {
            type: 'POINT_CARD',
            version: '1.0',
            cardId: cardId,
            eventId: eventId,
            organizationId: orgId,
            generatedAt: now
          },
          
          // 发行人信息（✅ 添加 receiptNumber）
          issuer: {
            pointSellerId: pointSellerId,
            pointSellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
            issuedAt: now,
            cashReceived: cashReceived,
            receiptNumber: receiptNumber,  // ✅ 新增
            note: note || ''
          },
          
          // 使用记录
          transactions: [],
          
          // 元数据
          metadata: {
            createdAt: now,
            updatedAt: now,
            version: '1.0',
            source: 'createPointCard',
            eventId: eventId,
            organizationId: orgId
          }
        };
        
        transaction.set(pointCardRef, pointCardData);
        
        // 7.5 更新 PointSeller 统计数据（✅ 修正字段名称）
        const updateData = {
          // 今日统计
          'pointSeller.todayStats.cardsIssued': admin.firestore.FieldValue.increment(1),
          'pointSeller.todayStats.totalPointsIssued': admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.totalCashReceived': admin.firestore.FieldValue.increment(cashReceived),
          'pointSeller.todayStats.lastIssueAt': now,
          
          // 累计统计
          'pointSeller.totalStats.totalCardsIssued': admin.firestore.FieldValue.increment(1),
          'pointSeller.totalStats.totalPointsIssued': admin.firestore.FieldValue.increment(amount),
          'pointSeller.totalStats.totalCashReceived': admin.firestore.FieldValue.increment(cashReceived),
          
          // 现金管理（✅ 新增）
          'pointSeller.cashManagement.cashOnHand': admin.firestore.FieldValue.increment(cashReceived),
          'pointSeller.cashManagement.pendingSubmission': admin.firestore.FieldValue.increment(cashReceived),
          
          'updatedAt': now
        };

        // 如果是首次发行，设置 firstIssueAt
        if (!pointSellerData.pointSeller?.todayStats?.firstIssueAt) {
          updateData['pointSeller.todayStats.firstIssueAt'] = now;
        }
        
        transaction.update(pointSellerRef, updateData);
        
        return {
          cardId,
          cardNumber,
          receiptNumber,
          balance: {
            initial: amount,
            current: amount
          },
          issuer: {
            pointSellerId: pointSellerId,
            pointSellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
            cashReceived: cashReceived,
            receiptNumber: receiptNumber
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